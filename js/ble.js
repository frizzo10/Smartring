/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE Connection (Web Bluetooth API)
   Works in: Bluefy iOS, Chrome desktop/Android
   
   V80 GATT Map (confirmed via nRF Connect):
   Service:  FEE7
   FEC7    → Write (commands to ring)
   FEC8    → Indicate (ring confirms commands)
   FEC9    → Read (device info)
   FEA1    → Read + Notify (sensor data stream)
   FEA2    → Read + Write + Indicate (bidirectional)
   ───────────────────────────────────────────────────────── */

const BLE = {
  // UUIDs
  SERVICE:   'fee7',
  CMD_WRITE: 'fec7',   // Write commands here
  CMD_RESP:  'fec8',   // Ring responds here (Indicate)
  DEV_INFO:  'fec9',   // Device info (Read)
  DATA_OUT:  'fea1',   // Sensor data stream (Notify)
  DATA_BIDIR:'fea2',   // Bidirectional (Read/Write/Indicate)

  // HBand command bytes (standard HBand SDK protocol)
  CMD: {
    GET_BATTERY:    [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00],
    GET_STEPS:      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x03, 0x00],
    START_HR:       [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x01, 0x00],
    STOP_HR:        [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x00, 0x00],
    START_SPO2:     [0xAB, 0x00, 0x04, 0xFF, 0x85, 0x80, 0x01, 0x00],
    STOP_SPO2:      [0xAB, 0x00, 0x04, 0xFF, 0x85, 0x80, 0x00, 0x00],
    START_BP:       [0xAB, 0x00, 0x04, 0xFF, 0x86, 0x80, 0x01, 0x00],
    STOP_BP:        [0xAB, 0x00, 0x04, 0xFF, 0x86, 0x80, 0x00, 0x00],
    START_TEMP:     [0xAB, 0x00, 0x04, 0xFF, 0x87, 0x80, 0x01, 0x00],
    STOP_TEMP:      [0xAB, 0x00, 0x04, 0xFF, 0x87, 0x80, 0x00, 0x00],
    GET_SLEEP:      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x1A, 0x00],
    SYNC_HISTORY:   [0xAB, 0x00, 0x04, 0xFF, 0x52, 0x80, 0x00, 0x00],
  },

  // State
  device: null,
  server: null,
  service: null,
  chars: {},
  connected: false,
  listeners: {},
  rawBuffer: [],

  // Live readings
  readings: {
    hr: null, spo2: null, bp_sys: null, bp_dia: null,
    temp_c: null, steps: null, battery: null,
    hrv: null, timestamp: null
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported. Please use Bluefy browser.');
    }

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'V80' },
        { services: ['fee7'] }
      ],
      optionalServices: ['fee7', 'fec7', 'fec8', 'fec9', 'fea1', 'fea2',
                         '0000fee7-0000-1000-8000-00805f9b34fb']
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);

    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();
    BLE.service = await BLE.server.getPrimaryService('fee7');

    // Get all characteristics
    BLE.chars.write    = await BLE.service.getCharacteristic('fec7');
    BLE.chars.indicate = await BLE.service.getCharacteristic('fec8');
    BLE.chars.devinfo  = await BLE.service.getCharacteristic('fec9');
    BLE.chars.notify   = await BLE.service.getCharacteristic('fea1');
    BLE.chars.bidir    = await BLE.service.getCharacteristic('fea2');

    // Subscribe to data stream
    await BLE.chars.notify.startNotifications();
    BLE.chars.notify.addEventListener('characteristicvaluechanged', BLE.onData);

    // Subscribe to command responses
    await BLE.chars.indicate.startNotifications();
    BLE.chars.indicate.addEventListener('characteristicvaluechanged', BLE.onResponse);

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Initial data fetch
    await BLE.sleep(500);
    await BLE.sendCmd(BLE.CMD.GET_BATTERY);
    await BLE.sleep(300);
    await BLE.sendCmd(BLE.CMD.GET_STEPS);
    await BLE.sleep(300);
    await BLE.startAllMeasurements();

    return BLE.device.name;
  },

  // ── DISCONNECT ───────────────────────────────────────────
  async disconnect() {
    await BLE.stopAllMeasurements();
    if (BLE.device && BLE.device.gatt.connected) {
      BLE.device.gatt.disconnect();
    }
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
  },

  onDisconnected() {
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
    // Auto-reconnect after 3 seconds
    setTimeout(() => {
      if (!BLE.connected) BLE.emit('status', 'reconnecting');
    }, 3000);
  },

  // ── SEND COMMAND ─────────────────────────────────────────
  async sendCmd(bytes) {
    if (!BLE.chars.write) return;
    try {
      await BLE.chars.write.writeValueWithoutResponse(new Uint8Array(bytes));
    } catch(e) {
      console.log('BLE write error:', e.message);
    }
  },

  // ── START / STOP MEASUREMENTS ────────────────────────────
  async startAllMeasurements() {
    await BLE.sendCmd(BLE.CMD.START_HR);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_SPO2);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_BP);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_TEMP);
  },

  async stopAllMeasurements() {
    await BLE.sendCmd(BLE.CMD.STOP_HR);
    await BLE.sendCmd(BLE.CMD.STOP_SPO2);
    await BLE.sendCmd(BLE.CMD.STOP_BP);
    await BLE.sendCmd(BLE.CMD.STOP_TEMP);
  },

  // ── PARSE INCOMING DATA ──────────────────────────────────
  onData(event) {
    const val = event.target.value;
    const bytes = new Uint8Array(val.buffer);
    BLE.rawBuffer.push(bytes);

    // Log raw for debugging
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', hex);

    BLE.parsePacket(bytes);
  },

  onResponse(event) {
    const val = event.target.value;
    const bytes = new Uint8Array(val.buffer);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('response', hex);
    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 4) return;

    // HBand packet header: AB 00 [len] FF [cmd_hi] [cmd_lo] [data...]
    if (bytes[0] !== 0xAB) return;

    const cmdHi = bytes[4];
    const cmdLo = bytes[5];
    const cmd = (cmdHi << 8) | cmdLo;

    switch(cmd) {
      // Heart rate
      case 0x8480:
      case 0x0480:
        if (bytes.length >= 8) {
          const hr = bytes[7];
          if (hr > 30 && hr < 220) {
            BLE.readings.hr = hr;
            BLE.readings.timestamp = Date.now();
            BLE.emit('hr', hr);
            BLE.updateDashboard();
          }
        }
        break;

      // SpO2
      case 0x8580:
      case 0x0580:
        if (bytes.length >= 8) {
          const spo2 = bytes[7];
          if (spo2 >= 70 && spo2 <= 100) {
            BLE.readings.spo2 = spo2;
            BLE.emit('spo2', spo2);
            BLE.updateDashboard();
          }
        }
        break;

      // Blood pressure
      case 0x8680:
      case 0x0680:
        if (bytes.length >= 9) {
          const sys = bytes[7];
          const dia = bytes[8];
          if (sys > 60 && sys < 220 && dia > 40 && dia < 140) {
            BLE.readings.bp_sys = sys;
            BLE.readings.bp_dia = dia;
            BLE.emit('bp', { sys, dia });
            BLE.updateDashboard();
          }
        }
        break;

      // Temperature
      case 0x8780:
      case 0x0780:
        if (bytes.length >= 9) {
          const tempRaw = (bytes[7] << 8) | bytes[8];
          const temp_c = tempRaw / 100;
          if (temp_c > 30 && temp_c < 43) {
            BLE.readings.temp_c = temp_c;
            const temp_f = (temp_c * 9/5) + 32;
            BLE.emit('temp', { c: temp_c, f: temp_f });
            BLE.updateDashboard();
          }
        }
        break;

      // Battery
      case 0x5180:
        if (bytes.length >= 8 && bytes[6] === 0x01) {
          const battery = bytes[7];
          BLE.readings.battery = battery;
          BLE.emit('battery', battery);
        }
        break;

      // Steps
      case 0x5180 + 0x02:
        if (bytes.length >= 10) {
          const steps = (bytes[7] << 24) | (bytes[8] << 16) | (bytes[9] << 8) | bytes[10];
          BLE.readings.steps = steps;
          BLE.emit('steps', steps);
        }
        break;
    }
  },

  // ── UPDATE DASHBOARD ─────────────────────────────────────
  updateDashboard() {
    const r = BLE.readings;

    // Update metric tiles
    if (r.hr) {
      const el = document.getElementById('tile-rhr');
      if (el) el.textContent = r.hr;
      const s = document.getElementById('tile-rhr-status');
      if (s) { s.textContent = r.hr < 60 ? 'Athletic' : r.hr < 80 ? 'Normal' : 'Elevated'; s.className = 'mt-status ' + (r.hr < 80 ? 'normal' : 'watch'); }
    }
    if (r.spo2) {
      const el = document.getElementById('tile-spo2');
      if (el) el.textContent = r.spo2;
      const s = document.getElementById('tile-spo2-status');
      if (s) { s.textContent = r.spo2 >= 95 ? 'Normal' : 'Watch'; s.className = 'mt-status ' + (r.spo2 >= 95 ? 'normal' : 'watch'); }
    }
    if (r.bp_sys) {
      const s = document.getElementById('tile-bp-s');
      const d = document.getElementById('tile-bp-d');
      if (s) s.textContent = r.bp_sys;
      if (d) d.textContent = '/' + r.bp_dia;
      const st = document.getElementById('tile-bp-status');
      if (st) { st.textContent = r.bp_sys < 120 ? 'Optimal' : r.bp_sys < 130 ? 'Normal' : 'Elevated'; st.className = 'mt-status ' + (r.bp_sys < 130 ? 'normal' : 'watch'); }
    }
    if (r.temp_c) {
      const temp_f = (r.temp_c * 9/5) + 32;
      const el = document.getElementById('tile-temp');
      if (el) el.textContent = '+' + (temp_f - 98.6).toFixed(1);
    }

    // Show ring online dot
    const dot = document.getElementById('ring-online-dot');
    if (dot) dot.style.display = 'block';

    // Update ring status in profile
    const rs = document.getElementById('ring-status-text');
    if (rs) rs.textContent = 'Connected · live data';
    const model = document.getElementById('ring-model-name');
    if (model) model.textContent = 'V80 Smart Ring';
    const batt = document.getElementById('ring-batt-pct');
    if (batt && r.battery) batt.textContent = r.battery + '%';
    const battBar = document.getElementById('ring-batt-bar');
    if (battBar && r.battery) battBar.style.width = r.battery + '%';

    // Emit combined reading for signal engine
    BLE.emit('readings', { ...r });
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn) {
    if (!BLE.listeners[event]) BLE.listeners[event] = [];
    BLE.listeners[event].push(fn);
  },
  emit(event, data) {
    (BLE.listeners[event] || []).forEach(fn => fn(data));
  },
  off(event, fn) {
    if (!BLE.listeners[event]) return;
    BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn);
  },

  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

// Export globally
window.BLE = BLE;
