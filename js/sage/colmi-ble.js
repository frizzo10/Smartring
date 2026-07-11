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

  // A SECOND, entirely separate BLE service — confirmed from
  // smittytone/RingCLI (a third independent open-source client, Go-
  // based). This is where SpO2 history and sleep data actually live —
  // neither ever showed up in any capture tonight because we'd never
  // connected to this service at all. Different packet framing too:
  // 6-byte request [0xBC magic, requestId, 0,0, 0xFF,0xFF] instead of
  // the 16-byte command packets used on the main service.
  DATA_SERVICE_UUID: 'de5bf728-d711-4e47-af26-65e3012a5dc7',
  DATA_WRITE_UUID:   'de5bf72a-d711-4e47-af26-65e3012a5dc7',
  DATA_NOTIFY_UUID:  'de5bf729-d711-4e47-af26-65e3012a5dc7',
  DATA_REQUEST_MAGIC: 0xBC,
  DATA_REQUEST_SLEEP: 0x27,
  DATA_REQUEST_OXYGEN: 0x2A,

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

  // Confirmed from steps.py (CMD_GET_STEP_SOMEDAY = 67 / 0x43). Same
  // story as the HR log: this packet type was already showing up
  // unprompted in every session tonight, right after connecting —
  // verified our parser against a real captured packet and got back
  // today's actual date and a plausible step count.
  CMD_GET_STEP_SOMEDAY: 67,

  // Raw sensor streaming — confirmed from edgeimpulse/example-data-
  // collection-colmi-r02's ring.py, a working, published tool that
  // logs actual PPG, SpO2, and accelerometer samples straight off the
  // ring for ML data collection. This is a genuinely different tier
  // from every other reading kind above: not a settled value, not an
  // undecoded black-box composite, but the literal sensor samples the
  // ring's own algorithms are built from. No firmware flash required
  // to get this — the repo's custom firmware is only for a *faster*
  // stream, the base command works on stock firmware. Same command
  // service we already use (6e40fff0...), not the second data service.
  CMD_RAW_SENSOR: 0xA1,
  RAW_SENSOR_ENABLE: 0x04,
  RAW_SENSOR_DISABLE: 0x02,

  // Full RealTimeReading enum from real_time.py / colmi.puxtril.com.
  // HEART_RATE and SPO2 are the two the community (and our own testing
  // tonight) confirms as trustworthy. The rest are real protocol slots —
  // the ring will respond to a request — but that's a claim about the
  // PROTOCOL, not the sensor. The reference client's own author flags
  // HRV/ECG/blood pressure/blood sugar as not something you can trust
  // from this class of hardware. Including them here so we can actually
  // see what comes back rather than guess.
  READING_HEART_RATE: 1,
  READING_BLOOD_PRESSURE: 2,
  READING_SPO2: 3,
  READING_FATIGUE: 4,
  READING_HEALTH_CHECK: 5,
  READING_ECG: 7,
  READING_PRESSURE: 8,
  READING_BLOOD_SUGAR: 9,
  READING_HRV: 10,

  ACTION_START: 1,
  ACTION_PAUSE: 2,
  ACTION_CONTINUE: 3,
  ACTION_STOP: 4,

  device: null,
  server: null,
  writeChar: null,
  notifyChar: null,
  dataWriteChar: null,
  dataNotifyChar: null,
  dataServiceAvailable: false,
  connected: false,
  rawSensorActive: false,
  listeners: {},

  // Reassembly buffer for the data-service responses. Unlike the main
  // 16-byte command protocol (one complete packet per notification),
  // this service's responses can be longer than a single BLE
  // notification's MTU, so we accumulate raw bytes across notifications
  // until we've received the full length declared in the packet header.
  dataBuffer: {
    bytes: [],
    expectedTotal: null,
    requestId: null,
    reset() {
      ColmiBLE.dataBuffer.bytes = [];
      ColmiBLE.dataBuffer.expectedTotal = null;
      ColmiBLE.dataBuffer.requestId = null;
    },
  },

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

  // State machine for the multi-packet step/activity log response —
  // mirrors steps.py's SportDetailParser exactly. Verified against a
  // real captured packet from tonight: decoded to today's actual date
  // (2026-07-10) at a plausible time slot, steps=13, calories=35,
  // distance=7m.
  stepsLog: {
    newCalorieProtocol: false,
    index: 0,
    details: [],

    reset() {
      ColmiBLE.stepsLog.newCalorieProtocol = false;
      ColmiBLE.stepsLog.index = 0;
      ColmiBLE.stepsLog.details = [];
    },

    bcdToDecimal(b) {
      return ((b >> 4) & 15) * 10 + (b & 15);
    },

    parse(bytes) {
      const log = ColmiBLE.stepsLog;

      if (log.index === 0 && bytes[1] === 255) {
        log.reset();
        return { noData: true };
      }

      if (log.index === 0 && bytes[1] === 240) {
        log.newCalorieProtocol = bytes[3] === 1;
        log.index += 1;
        return null;
      }

      const year = log.bcdToDecimal(bytes[1]) + 2000;
      const month = log.bcdToDecimal(bytes[2]);
      const day = log.bcdToDecimal(bytes[3]);
      const timeIndex = bytes[4];
      const hour = Math.floor(timeIndex / 4);
      const minute = (timeIndex % 4) * 15;
      let calories = bytes[7] | (bytes[8] << 8);
      if (log.newCalorieProtocol) calories *= 10;
      const steps = bytes[9] | (bytes[10] << 8);
      const distance = bytes[11] | (bytes[12] << 8);

      log.details.push({ year, month, day, hour, minute, calories, steps, distance });

      if (bytes[5] === bytes[6] - 1) {
        const result = { entries: log.details.slice() };
        log.reset();
        return result;
      }
      log.index += 1;
      return null;
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
      // DATA_SERVICE_UUID must be listed here too — Web Bluetooth
      // blocks getPrimaryService() for any UUID not declared at
      // requestDevice() time, even on an already-connected device.
      optionalServices: [ColmiBLE.SERVICE_UUID, ColmiBLE.DATA_SERVICE_UUID],
    });

    return ColmiBLE.attachToDevice();
  },

  // Everything after device selection — split out so forceReconnect()
  // can reuse it on the SAME already-picked device without re-prompting
  // the browser's device chooser.
  async attachToDevice() {
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

    // Second service — SpO2 history and sleep data live here, not on
    // the main command service. Non-fatal if unavailable: the ring's
    // core features (battery, HR, SpO2 spot-check, HR log, steps) all
    // work fine without it.
    try {
      const dataService = await ColmiBLE.server.getPrimaryService(ColmiBLE.DATA_SERVICE_UUID);
      ColmiBLE.dataWriteChar = await dataService.getCharacteristic(ColmiBLE.DATA_WRITE_UUID);
      ColmiBLE.dataNotifyChar = await dataService.getCharacteristic(ColmiBLE.DATA_NOTIFY_UUID);
      await ColmiBLE.dataNotifyChar.startNotifications();
      ColmiBLE.dataNotifyChar.addEventListener('characteristicvaluechanged', ColmiBLE.onDataServicePacket);
      ColmiBLE.dataServiceAvailable = true;
      ColmiBLE.emit('status', 'data service connected');
    } catch (e) {
      ColmiBLE.dataServiceAvailable = false;
      ColmiBLE.emit('status', 'data service unavailable: ' + (e.message || e));
    }

    ColmiBLE.connected = true;
    ColmiBLE.rawSensorActive = false; // fresh GATT session — ring-side state may have reset too
    ColmiBLE.emit('status', 'connected');
    ColmiBLE.emit('connected', ColmiBLE.device.name);

    // No auth handshake needed — this is the real, documented
    // difference from the V80. Straight to reading data.
    await ColmiBLE.sleep(300);
    await ColmiBLE.readBattery();

    return ColmiBLE.device.name;
  },

  // A Gadgetbridge developer (independent codebase, same ring family)
  // reported the exact symptom we hit tonight — LED stuck on after a
  // raw/continuous stream — and found that a straight reconnect cleared
  // it, not a specific stop command. This does that: disconnect from
  // the current GATT session and reconnect fresh on the SAME device,
  // no picker re-prompt. Real fix, not a guessed command byte.
  async forceReconnect() {
    if (ColmiBLE.device?.gatt.connected) {
      ColmiBLE.device.gatt.disconnect();
    }
    await ColmiBLE.sleep(1500);
    return ColmiBLE.attachToDevice();
  },

  async disconnect() {
    if (ColmiBLE.connected) {
      await ColmiBLE.stopRealTime(ColmiBLE.READING_HEART_RATE);
      await ColmiBLE.stopRealTime(ColmiBLE.READING_SPO2);
      if (ColmiBLE.rawSensorActive) await ColmiBLE.stopRawSensor();
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

  // Requests the ring's own logged step/activity data for a given day
  // offset from today (0 = today, 1 = yesterday, etc). The trailing
  // bytes are constants copied directly from steps.py — the reference
  // author notes they don't fully understand what they do either, but
  // they're required for the ring to respond correctly.
  async readSteps(dayOffset = 0) {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_GET_STEP_SOMEDAY, [dayOffset, 0x0f, 0x00, 0x5f, 0x01]);
    await ColmiBLE.write(packet);
  },

  // Starts the raw PPG/SpO2/accelerometer sensor stream. Ring responds
  // with a continuous flow of 0xA1-prefixed packets (routed in onData
  // below) until stopRawSensor() is called.
  async startRawSensor() {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_RAW_SENSOR, [ColmiBLE.RAW_SENSOR_ENABLE]);
    await ColmiBLE.write(packet);
    ColmiBLE.rawSensorActive = true;
  },

  async stopRawSensor() {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_RAW_SENSOR, [ColmiBLE.RAW_SENSOR_DISABLE]);
    // Sent 3x with a short gap — the ring is actively streaming raw
    // samples at high volume during this window, and a single stop
    // write has shown itself unreliable against that traffic (LEDs
    // staying on after a real capture completed). Redundant writes
    // are harmless; a dropped stop write leaves the sensors running.
    for (let i = 0; i < 3; i++) {
      await ColmiBLE.write(packet);
      await ColmiBLE.sleep(150);
    }
    ColmiBLE.rawSensorActive = false;
  },
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

  // ── DATA SERVICE (SpO2 history, sleep) ───────────────────────
  // Different framing from the command service: 6-byte request, no
  // per-packet checksum byte. Confirmed against smittytone/RingCLI.
  makeDataPacket(requestId) {
    return new Uint8Array([ColmiBLE.DATA_REQUEST_MAGIC, requestId, 0x00, 0x00, 0xFF, 0xFF]);
  },

  async readSpO2Log() {
    if (!ColmiBLE.dataServiceAvailable) throw new Error('Data service not connected — SpO2 log unavailable this session.');
    ColmiBLE.dataBuffer.reset();
    await ColmiBLE.dataWriteChar.writeValue(ColmiBLE.makeDataPacket(ColmiBLE.DATA_REQUEST_OXYGEN));
  },

  async readSleepLog() {
    if (!ColmiBLE.dataServiceAvailable) throw new Error('Data service not connected — sleep log unavailable this session.');
    ColmiBLE.dataBuffer.reset();
    await ColmiBLE.dataWriteChar.writeValue(ColmiBLE.makeDataPacket(ColmiBLE.DATA_REQUEST_SLEEP));
  },

  onDataServicePacket(event) {
    const bytes = Array.from(new Uint8Array(event.target.value.buffer));
    const buf = ColmiBLE.dataBuffer;

    ColmiBLE.emit('debugPacket', {
      cmd: 'data-' + bytes[0]?.toString(16),
      cmdHex: '0x' + (bytes[0] || 0).toString(16).padStart(2, '0'),
      hex: bytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
      timestamp: new Date().toISOString(),
    });

    if (buf.bytes.length === 0) {
      // First chunk carries the header: [magic, requestId, lenLSB, lenMSB, crcLSB, crcMSB, ...payload]
      if (bytes[0] !== ColmiBLE.DATA_REQUEST_MAGIC) return; // not a data-service header, ignore
      buf.requestId = bytes[1];
      const dataLength = bytes[2] | (bytes[3] << 8);
      buf.expectedTotal = 6 + dataLength;
    }

    buf.bytes.push(...bytes);

    if (buf.expectedTotal !== null && buf.bytes.length >= buf.expectedTotal) {
      const complete = buf.bytes.slice(0, buf.expectedTotal);
      const requestId = buf.requestId;
      buf.reset();

      if (requestId === ColmiBLE.DATA_REQUEST_OXYGEN) {
        ColmiBLE.emit('spo2Log', ColmiBLE.parseSpO2Log(complete));
      } else if (requestId === ColmiBLE.DATA_REQUEST_SLEEP) {
        ColmiBLE.emit('sleepLog', ColmiBLE.parseSleepLog(complete));
      }
    }
  },

  // Mirrors oxygen.go's ParseBloodOxygenDataResponse exactly. Each day's
  // block: 1 byte "days previous" + 48 bytes (24 hourly slots x 2 bytes
  // max/min).
  parseSpO2Log(bytes) {
    const days = [];
    let index = 6;
    while (index < bytes.length) {
      const daysPrevious = bytes[index];
      index += 1;
      const hourly = [];
      for (let h = 0; h < 24; h++) {
        hourly.push({ hour: h, max: bytes[index + h * 2], min: bytes[index + 1 + h * 2] });
      }
      days.push({ daysPrevious, hourly });
      index += 48;
    }
    return { days };
  },

  // Mirrors sleep.go's ParseSleepDataResponse exactly. Sleep types:
  // 0=no data, 1=error, 2=light, 3=deep, 4=REM, 5=awake.
  parseSleepLog(bytes) {
    const periods = [];
    let index = 7;
    while (index < bytes.length) {
      const daysPrevious = bytes[index];
      const dataCount = (bytes[index + 1] - 4) >> 1;
      const startMins = bytes[index + 2] | (bytes[index + 3] << 8);
      const endMins = bytes[index + 4] | (bytes[index + 5] << 8);
      index += 6;

      const phases = [];
      for (let i = 0; i < dataCount; i++) {
        phases.push({ type: bytes[index], durationMin: bytes[index + 1] });
        index += 2;
      }
      periods.push({ daysPrevious, startMins, endMins, phases });
    }
    return { periods };
  },

  SLEEP_TYPE_NAMES: { 0: 'no data', 1: 'error', 2: 'light', 3: 'deep', 4: 'REM', 5: 'awake' },

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

    if (cmd === ColmiBLE.CMD_GET_STEP_SOMEDAY) {
      const result = ColmiBLE.stepsLog.parse(bytes);
      if (result) {
        if (result.noData) ColmiBLE.emit('stepsNoData', {});
        else ColmiBLE.emit('steps', result.entries);
      }
      return;
    }

    if (cmd === ColmiBLE.CMD_RAW_SENSOR) {
      const subtype = bytes[1];

      if (subtype === 0x01) {
        // SpO2 raw sample — formula copied verbatim from ring.py's
        // handle_notification(), byte offsets confirmed against a
        // working, published data logger.
        ColmiBLE.emit('rawSpo2Sample', {
          spo2: (bytes[2] << 8) | bytes[3],
          max: bytes[5],
          min: bytes[7],
          diff: bytes[9],
        });
        return;
      }

      if (subtype === 0x02) {
        // PPG raw sample — the actual light-sensor waveform value HR/
        // SpO2 are derived from internally. This is the closest thing
        // to true raw sensor data this ring exposes over BLE.
        ColmiBLE.emit('rawPpgSample', {
          ppg: (bytes[2] << 8) | bytes[3],
          max: (bytes[4] << 8) | bytes[5],
          min: (bytes[6] << 8) | bytes[7],
          diff: (bytes[8] << 8) | bytes[9],
        });
        return;
      }

      if (subtype === 0x03) {
        // Accelerometer raw sample — 12-bit nibble-packed values per
        // axis. Sign-check and offset copied verbatim from ring.py;
        // not independently re-derived, just carried over exactly as
        // the working reference has it.
        const decode12 = (hi, lo) => {
          const v = (hi << 4) | (lo & 0xF);
          return (hi & 0x8) ? v - (1 << 11) : v;
        };
        ColmiBLE.emit('rawAccelSample', {
          accY: decode12(bytes[2], bytes[3]),
          accZ: decode12(bytes[4], bytes[5]),
          accX: decode12(bytes[6], bytes[7]),
        });
        return;
      }

      // Unrecognized 0xA1 subtype — surface it rather than drop it.
      ColmiBLE.emit('raw', Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
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

// ── SAFETY NET ─────────────────────────────────────────────
// If the raw sensor stream is left running when the page closes,
// backgrounds, or the person navigates away mid-capture (e.g. during
// the 60s HRV window), the ring's own firmware doesn't know to stop —
// it just leaves the green/red LEDs on indefinitely. Best-effort stop
// on both pagehide and visibilitychange (backgrounding on iOS fires
// visibilitychange reliably, pagehide covers actual navigation/close).
if (typeof window !== 'undefined') {
  const emergencyStop = () => {
    if (ColmiBLE.rawSensorActive && ColmiBLE.connected) {
      // Fire-and-forget — page may be gone before this resolves, that's
      // fine, the write is what matters, not waiting for a response.
      ColmiBLE.stopRawSensor().catch(() => {});
    }
  };
  window.addEventListener('pagehide', emergencyStop);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') emergencyStop();
  });
}
if (typeof module !== 'undefined') module.exports = ColmiBLE;
