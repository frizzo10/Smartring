/* ─────────────────────────────────────────────────────────
   myDrSage — Colmi R02 BLE Module

   REAL, DOCUMENTED protocol — confirmed against three
   independent open-source implementations (tahnok/colmi_r02_client,
   Freeyourgadget/Gadgetbridge, smithandrewk/colmi-r02-data-collector)
   plus the Halo iOS reference project. No auth handshake, no
   password wall — this is the opposite situation from the V80.

   Service:  6e40fff0-b5a3-f393-e0a9-e50e24dcca9e
   Write:    6e400002-b5a3-f393-e0a9-e50e24dcca9e  (RX)
   Notify:   6e400003-b5a3-f393-e0a9-e50e24dcca9e  (TX)

   Packet format (16 bytes, both directions):
     byte 0:     command
     bytes 1-14: payload
     byte 15:    checksum = sum(bytes 0-14) mod 256 (i.e. `sum & 255`)

   Real-time reading command (CMD_START_REAL_TIME = 0x69 / 105):
     request:  [105, readingType, action, 0,0,0,0,0,0,0,0,0,0, checksum]
     response: [105, kind, errorCode, value, ...]
     readingType: HEART_RATE=1, SPO2=3 (the two the community
     confirms are trustworthy — same conclusion our own hrv.js
     validation reached independently: HRV/BP/glucose from this
     class of ring are not something to build product trust on)
     action: START=1, CONTINUE=3, STOP=4

   Battery command (CMD_BATTERY = 0x03 / 3):
     request:  [3, 0,0,0,0,0,0,0,0,0,0,0,0,0, checksum]
     response: [3, batteryLevel, charging(0/1), ...]

   Heart rate log command (CMD_READ_HEART_RATE = 0x15 / 21) — pulls the
   ring's own on-device logged HR history for a given day, independent
   of any live connection. The ring auto-pushes today's log on every
   connect without being asked. Multi-packet response, see hrLog below.
   ───────────────────────────────────────────────────────── */

const ColmiBLE = {
  SERVICE_UUID: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e',
  WRITE_UUID:   '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  NOTIFY_UUID:  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',

  CMD_BATTERY: 3,
  CMD_START_REAL_TIME: 105,
  CMD_STOP_REAL_TIME: 106,
  // Confirmed from tahnok/colmi_r02_client source directly: the
  // "continue" keepalive uses a DIFFERENT command byte than start/stop —
  // this was the actual bug behind every reading coming back 0 tonight.
  // Our continueRealTime() was sending CMD_START_REAL_TIME (105) with
  // action=CONTINUE, which the docs also show as valid via
  // get_continue_packet() — but the reference client's own
  // CONTINUE_HEART_RATE_PACKET constant, the one actually exercised in
  // their working CLI tool, uses CMD_REAL_TIME_HEART_RATE (30) with
  // payload just [0x33] ('3' ascii). Using the documented-but-apparently-
  // less-tested get_continue_packet() path was silently accepted by the
  // ring (no error) but never kept the stream alive, so it fell back to 0
  // after the first poke interval.
  CMD_REAL_TIME_HEART_RATE: 30,

  // Confirmed from hr.py (CMD_READ_HEART_RATE = 21 / 0x15). This is the
  // exact packet type that showed up unprompted in every session tonight
  // right after connecting — the ring auto-pushes today's logged HR data
  // on connect without us ever requesting it. Multi-packet response:
  // sub_type 0 = header (size = packet count, range = minutes per
  // sample), sub_type 1 = 4-byte timestamp + first 9 samples, sub_type
  // 2..N-1 = 13 samples each, last packet (sub_type === size-1) closes
  // out the log.
  CMD_READ_HEART_RATE: 21,

  READING_HEART_RATE: 1,
  READING_SPO2: 3,

  ACTION_START: 1,
  ACTION_PAUSE: 2,
  ACTION_CONTINUE: 3,
  ACTION_STOP: 4,

  device: null,
  server: null,
  writeChar: null,
  notifyChar: null,
  connected: false,
  listeners: {},

  // State machine for the multi-packet heart rate log response —
  // mirrors hr.py's HeartRateLogParser class exactly.
  hrLog: {
    rawHeartRates: [],
    timestamp: null,
    size: 0,
    index: 0,
    range: 5,

    reset() {
      ColmiBLE.hrLog.rawHeartRates = [];
      ColmiBLE.hrLog.timestamp = null;
      ColmiBLE.hrLog.size = 0;
      ColmiBLE.hrLog.index = 0;
      ColmiBLE.hrLog.range = 5;
    },

    // Returns a completed log object once the final packet arrives,
    // otherwise null (still accumulating).
    parse(bytes) {
      const log = ColmiBLE.hrLog;
      const subType = bytes[1];

      if (subType === 255) {
        log.reset();
        return { error: true };
      }

      if (subType === 0) {
        // Header: byte[2] = expected packet count, byte[3] = minutes
        // per sample (range).
        log.size = bytes[2];
        log.range = bytes[3];
        log.rawHeartRates = new Array(log.size * 13).fill(-1);
        log.index = 0;
        return null;
      }

      if (subType === 1) {
        // 4-byte little-endian unix timestamp at offset 2, then the
        // first 9 samples fill bytes[6:15].
        const ts = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
        log.timestamp = new Date(ts * 1000);
        for (let i = 0; i < 9; i++) log.rawHeartRates[i] = bytes[6 + i];
        log.index = 9;
        return null;
      }

      // subType 2..N-1: 13 samples per packet, bytes[2:15].
      for (let i = 0; i < 13; i++) log.rawHeartRates[log.index + i] = bytes[2 + i];
      log.index += 13;

      if (subType === log.size - 1) {
        const result = {
          heartRates: ColmiBLE.hrLog.normalize(),
          timestamp: log.timestamp,
          size: log.size,
          range: log.range,
        };
        log.reset();
        return result;
      }
      return null;
    },

    // Pads/truncates to 288 samples (24h at 5-min intervals) and zeroes
    // out any slots that are still in the future for "today" — matches
    // hr.py's heart_rates property.
    normalize() {
      let hr = ColmiBLE.hrLog.rawHeartRates.slice();
      if (hr.length > 288) hr = hr.slice(0, 288);
      else while (hr.length < 288) hr.push(0);

      const ts = ColmiBLE.hrLog.timestamp;
      if (ts) {
        const now = new Date();
        const isToday = ts.getUTCFullYear() === now.getUTCFullYear()
          && ts.getUTCMonth() === now.getUTCMonth()
          && ts.getUTCDate() === now.getUTCDate();
        if (isToday) {
          const midnightUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
          const minutesSoFar = Math.round((now.getTime() - midnightUTC) / 60000) + 1;
          const slotsSoFar = Math.floor(minutesSoFar / 5);
          for (let i = slotsSoFar; i < hr.length; i++) hr[i] = 0;
        }
      }
      return hr;
    },
  },

  // ── PACKET BUILDING ────────────────────────────────────────
  checksum(bytes15) {
    // Verified directly against colmi_r02_client's packet.py:
    // `sum(packet) & 255` — i.e. mod 256, NOT mod 255. Our previous
    // % 255 implementation happened to match every packet we'd tested
    // so far only because those payloads were small enough that the
    // sum never crossed 255. Confirmed the bug against a real captured
    // packet: '69 01 00 5b 00 00 8d 02 00...54' sums to 340 —
    // 340 % 256 = 84 = 0x54 (matches the real checksum byte),
    // 340 % 255 = 85 (would have been wrong). The heart rate log
    // request below carries a 4-byte timestamp, easily large enough
    // to expose this, so fixing it now before relying on it.
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += bytes15[i] || 0;
    return sum & 255;
  },

  makePacket(command, payload = []) {
    const packet = new Uint8Array(16);
    packet[0] = command;
    for (let i = 0; i < Math.min(payload.length, 14); i++) {
      packet[i + 1] = payload[i];
    }
    packet[15] = ColmiBLE.checksum(packet);
    return packet;
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) throw new Error('Use Bluefy browser for Web Bluetooth.');

    ColmiBLE.emit('status', 'scanning');

    // IMPORTANT: requestDevice() must be called synchronously within
    // the user-gesture (the click handler) or the browser throws
    // SecurityError. A try/catch that awaits a failed strict-filter
    // call before retrying with acceptAllDevices breaks that chain —
    // found the hard way tonight: the fallback call was being
    // silently blocked with no picker ever appearing, on BOTH
    // Bluefy iOS and desktop Chrome, because by the time the catch
    // block ran, the gesture context had already expired.
    // acceptAllDevices going first, single call, avoids this entirely
    // and also sidesteps rings (like this one) whose advertisement
    // doesn't expose the service UUID list needed for a filtered scan.
    ColmiBLE.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [ColmiBLE.SERVICE_UUID],
    });

    ColmiBLE.device.addEventListener('gattserverdisconnected', ColmiBLE.onDisconnected);
    ColmiBLE.emit('status', 'connecting');
    ColmiBLE.server = await ColmiBLE.device.gatt.connect();

    let service;
    try {
      service = await ColmiBLE.server.getPrimaryService(ColmiBLE.SERVICE_UUID);
    } catch (e) {
      ColmiBLE.device.gatt.disconnect();
      throw new Error(`That device doesn't have the ring's service — probably picked the wrong one from the list. Try again and pick a different device.`);
    }
    ColmiBLE.writeChar = await service.getCharacteristic(ColmiBLE.WRITE_UUID);
    ColmiBLE.notifyChar = await service.getCharacteristic(ColmiBLE.NOTIFY_UUID);

    await ColmiBLE.notifyChar.startNotifications();
    ColmiBLE.notifyChar.addEventListener('characteristicvaluechanged', ColmiBLE.onData);

    ColmiBLE.connected = true;
    ColmiBLE.emit('status', 'connected');
    ColmiBLE.emit('connected', ColmiBLE.device.name);

    // No auth handshake needed — this is the real, documented
    // difference from the V80. Straight to reading data.
    await ColmiBLE.sleep(300);
    await ColmiBLE.readBattery();

    return ColmiBLE.device.name;
  },

  async disconnect() {
    if (ColmiBLE.connected) {
      await ColmiBLE.stopRealTime(ColmiBLE.READING_HEART_RATE);
      await ColmiBLE.stopRealTime(ColmiBLE.READING_SPO2);
    }
    if (ColmiBLE.device?.gatt.connected) ColmiBLE.device.gatt.disconnect();
    ColmiBLE.connected = false;
    ColmiBLE.emit('status', 'disconnected');
  },

  onDisconnected() {
    ColmiBLE.connected = false;
    ColmiBLE.emit('status', 'disconnected');
  },

  // ── COMMANDS ───────────────────────────────────────────────
  async write(packet) {
    if (!ColmiBLE.writeChar) return;
    await ColmiBLE.writeChar.writeValue(packet);
  },

  async readBattery() {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_BATTERY);
    await ColmiBLE.write(packet);
  },

  async startRealTime(readingType) {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_START_REAL_TIME, [readingType, ColmiBLE.ACTION_START]);
    await ColmiBLE.write(packet);
  },

  async continueRealTime(readingType) {
    // Matches CONTINUE_HEART_RATE_PACKET from the reference client
    // exactly: cmd=30 (0x1e), payload=[0x33] ('3' ascii), verified
    // checksum 0x51 (81) against the documented literal bytes.
    // This single-byte payload is used for continuing ANY real-time
    // reading type in the reference implementation, not just heart
    // rate — the ring's firmware treats it as a generic "keep going" poke.
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_REAL_TIME_HEART_RATE, [0x33]);
    await ColmiBLE.write(packet);
  },

  async stopRealTime(readingType) {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_STOP_REAL_TIME, [readingType, 0, 0]);
    await ColmiBLE.write(packet);
  },

  // Requests the ring's own logged HR history for a given date.
  // Defaults to today. Per date_utils.py, the reference client always
  // uses midnight UTC (the ring's clock is set in UTC via set_time.js),
  // not local midnight.
  async readHeartRateLog(date = new Date()) {
    const midnightUTC = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000);
    const payload = [
      midnightUTC & 0xff,
      (midnightUTC >> 8) & 0xff,
      (midnightUTC >> 16) & 0xff,
      (midnightUTC >> 24) & 0xff,
    ];
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_READ_HEART_RATE, payload);
    await ColmiBLE.write(packet);
  },

  // Start a real-time HR or SpO2 stream and auto-poke it with
  // "continue" every 2s to keep it flowing, for the given duration.
  async streamReading(readingType, durationSec, onReading) {
    await ColmiBLE.startRealTime(readingType);
    const handler = (reading) => { if (reading.kind === readingType) onReading(reading.value); };
    ColmiBLE.on('reading', handler);

    const pokeInterval = setInterval(() => {
      ColmiBLE.continueRealTime(readingType);
    }, 2000);

    await ColmiBLE.sleep(durationSec * 1000);

    clearInterval(pokeInterval);
    ColmiBLE.off('reading', handler);
    await ColmiBLE.stopRealTime(readingType);
  },

  // ── PARSE INCOMING DATA ──────────────────────────────────
  onData(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    const cmd = bytes[0];

    // Universal debug trace — every incoming packet, not just unrecognized
    // ones. Added so we can tell a genuine reading response apart from a
    // stale/echoed battery packet during real-time streaming debugging
    // (see myDrSage_Colmi_R02_Handoff.docx, July 10 session).
    ColmiBLE.emit('debugPacket', {
      cmd,
      cmdHex: '0x' + cmd.toString(16).padStart(2, '0'),
      hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '),
      timestamp: new Date().toISOString(),
    });

    if (cmd === ColmiBLE.CMD_BATTERY) {
      const level = bytes[1];
      const charging = !!bytes[2];
      ColmiBLE.emit('battery', { level, charging });
      return;
    }

    if (cmd === ColmiBLE.CMD_START_REAL_TIME) {
      const kind = bytes[1];
      const errorCode = bytes[2];
      if (errorCode !== 0) {
        ColmiBLE.emit('readingError', { kind, code: errorCode });
        return;
      }
      const value = bytes[3];
      // bytes[6:8] observed moving sample-to-sample during the July 10
      // session (e.g. af02, 8802, 8102...) while bytes[3] (the value
      // position per the reference client's parse_real_time_reading)
      // stayed 0 the whole time. Looks like a live raw sample separate
      // from wherever the final settled reading lands — surfacing it
      // here so it's visible without decoding hex by hand.
      const rawSample = bytes[6] | (bytes[7] << 8);
      ColmiBLE.emit('reading', { kind, value, rawSample, rawSampleHex: rawSample.toString(16).padStart(4, '0') });
      return;
    }

    if (cmd === ColmiBLE.CMD_READ_HEART_RATE) {
      const result = ColmiBLE.hrLog.parse(bytes);
      if (result) {
        if (result.error) ColmiBLE.emit('heartRateLogError', {});
        else ColmiBLE.emit('heartRateLog', result);
      }
      return;
    }

    // Unrecognized command — log for future protocol expansion
    // (steps, sleep log, heart rate log are separate multi-packet
    // commands not yet wired up here; see colmi_r02_client's
    // steps.py / hr.py for reference when we get to historical sync)
    ColmiBLE.emit('raw', Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn)     { if (!ColmiBLE.listeners[event]) ColmiBLE.listeners[event] = []; ColmiBLE.listeners[event].push(fn); },
  emit(event, data) { (ColmiBLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn)    { if (!ColmiBLE.listeners[event]) return; ColmiBLE.listeners[event] = ColmiBLE.listeners[event].filter(f => f !== fn); },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

if (typeof window !== 'undefined') window.ColmiBLE = ColmiBLE;
if (typeof module !== 'undefined') module.exports = ColmiBLE;
