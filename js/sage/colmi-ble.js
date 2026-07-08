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
     byte 15:    checksum = sum(bytes 0-14) mod 255

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
   ───────────────────────────────────────────────────────── */

const ColmiBLE = {
  SERVICE_UUID: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e',
  WRITE_UUID:   '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  NOTIFY_UUID:  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',

  CMD_BATTERY: 3,
  CMD_START_REAL_TIME: 105,
  CMD_STOP_REAL_TIME: 106,

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

  // ── PACKET BUILDING ────────────────────────────────────────
  checksum(bytes15) {
    // sum of the first 15 bytes, mod 255 — verified against the
    // documented example: battery request [3,0,0...] checksum=3;
    // battery response [3,64,0,...] checksum=67 (0x43, ASCII 'C')
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += bytes15[i] || 0;
    return sum % 255;
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
    ColmiBLE.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [ColmiBLE.SERVICE_UUID] }],
      optionalServices: [ColmiBLE.SERVICE_UUID],
    });

    ColmiBLE.device.addEventListener('gattserverdisconnected', ColmiBLE.onDisconnected);
    ColmiBLE.emit('status', 'connecting');
    ColmiBLE.server = await ColmiBLE.device.gatt.connect();

    const service = await ColmiBLE.server.getPrimaryService(ColmiBLE.SERVICE_UUID);
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
    // The ring's real-time stream needs periodic "continue" pokes
    // to keep flowing — confirmed pattern from the reference client
    // (CONTINUE_HEART_RATE_PACKET is sent repeatedly, not once)
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_START_REAL_TIME, [readingType, ColmiBLE.ACTION_CONTINUE]);
    await ColmiBLE.write(packet);
  },

  async stopRealTime(readingType) {
    const packet = ColmiBLE.makePacket(ColmiBLE.CMD_STOP_REAL_TIME, [readingType, 0, 0]);
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
      ColmiBLE.emit('reading', { kind, value });
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
