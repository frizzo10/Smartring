/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE (Veepoo Protocol)
   Works in: Bluefy iOS, Chrome desktop/Android

   V80 REAL GATT Map (confirmed via Veepoo SDK decompile):
   Service:  0000ae00-0000-1000-8000-00805f9b34fb
   AE01    → Notify  (ring → phone)
   AE02    → Write Without Response (phone → ring)

   Protocol: Veepoo VP Protocol
   Password: 000000 (default)
   Bind sequence: confirmDevicePwd → then measurements
   ───────────────────────────────────────────────────────── */

const BLE = {

  SVC:      '0000ae00-0000-1000-8000-00805f9b34fb',
  CHAR_RX:  '0000ae01-0000-1000-8000-00805f9b34fb',
  CHAR_TX:  '0000ae02-0000-1000-8000-00805f9b34fb',

  // Veepoo default password
  PASSWORD: '000000',

  // State
  device: null, server: null, chars: {}, connected: false,
  listeners: {}, rawBuffer: [], bound: false,

  readings: {
    hr: null, spo2: null, bp_sys: null, bp_dia: null,
    temp_c: null, steps: null, battery: null,
    hrv: null, stress: null, stress_label: null,
    glucose_mgdl: null, timestamp: null
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) throw new Error('Use Bluefy browser.');

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'V80' }],
      optionalServices: [
        '0000ae00-0000-1000-8000-00805f9b34fb',
        'a6ed0401-d344-460a-8075-b9e8ec90d71b',
        'f0080001-0451-4000-b000-000000000000'
      ]
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);
    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();

    // Try Veepoo AE service first
    let connected = false;
    try {
      const svc = await BLE.server.getPrimaryService('0000ae00-0000-1000-8000-00805f9b34fb');
      BLE.chars.rx = await svc.getCharacteristic('0000ae01-0000-1000-8000-00805f9b34fb');
      BLE.chars.tx = await svc.getCharacteristic('0000ae02-0000-1000-8000-00805f9b34fb');
      await BLE.chars.rx.startNotifications();
      BLE.chars.rx.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.emit('raw', '[AE00] Veepoo service connected ✓');
      connected = true;
    } catch(e) {
      BLE.emit('raw', '[AE00] Failed: ' + e.message);
    }

    // Fallback to A6ED service
    if (!connected) {
      try {
        const svc = await BLE.server.getPrimaryService('a6ed0401-d344-460a-8075-b9e8ec90d71b');
        BLE.chars.rx = await svc.getCharacteristic('a6ed0402-d344-460a-8075-b9e8ec90d71b');
        BLE.chars.tx = await svc.getCharacteristic('a6ed0403-d344-460a-8075-b9e8ec90d71b');
        await BLE.chars.rx.startNotifications();
        BLE.chars.rx.addEventListener('characteristicvaluechanged', BLE.onData);
        BLE.emit('raw', '[A6ED] Fallback service connected ✓');
        connected = true;
      } catch(e) {
        BLE.emit('raw', '[A6ED] Failed: ' + e.message);
      }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Veepoo bind sequence
    await BLE.sleep(300);
    await BLE.bindDevice();
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  // ── BIND DEVICE (confirmDevicePwd) ───────────────────────
  // Veepoo requires password confirmation before any data flows
  // Password: 000000 → bytes [0x30,0x30,0x30,0x30,0x30,0x30]
  // Packet format: [0x00, 0x00, cmd, is24H, pwd0, pwd1, pwd2, pwd3, pwd4, pwd5]
  async bindDevice() {
    const pwd = BLE.PASSWORD.split('').map(c => c.charCodeAt(0));
    const is24H = 0x01; // 24-hour format

    // Veepoo confirmDevicePwd packet
    const bindPacket = [0x00, 0x00, 0x01, is24H, ...pwd];
    BLE.emit('raw', '[BIND] Sending password bind...');
    await BLE.write(bindPacket);
    await BLE.sleep(500);

    // Also try alternative packet format
    const altPacket = [0x01, is24H, ...pwd];
    await BLE.write(altPacket);
    await BLE.sleep(500);

    // Request battery and time sync after bind
    await BLE.syncTime();
    await BLE.sleep(300);
    await BLE.readBattery();
    await BLE.sleep(300);
    await BLE.startMeasurements();
  },

  // ── TIME SYNC ────────────────────────────────────────────
  async syncTime() {
    const d = new Date();
    const packet = [
      0x00, 0x00, 0x03,
      d.getFullYear() - 2000, d.getMonth() + 1, d.getDate(),
      d.getHours(), d.getMinutes(), d.getSeconds()
    ];
    await BLE.write(packet);
  },

  // ── READ BATTERY ─────────────────────────────────────────
  async readBattery() {
    await BLE.write([0x00, 0x00, 0x04]);
  },

  // ── START MEASUREMENTS ───────────────────────────────────
  async startMeasurements() {
    await BLE.write([0x00, 0x00, 0x11, 0x01]); // HR start
    await BLE.sleep(200);
    await BLE.write([0x00, 0x00, 0x12, 0x01]); // SpO2 start
    await BLE.sleep(200);
    await BLE.write([0x00, 0x00, 0x13, 0x01]); // BP start
    await BLE.sleep(200);
    await BLE.write([0x00, 0x00, 0x14, 0x01]); // Temp start
    await BLE.sleep(200);
    await BLE.write([0x00, 0x00, 0x15, 0x01]); // HRV start
    await BLE.sleep(200);
    await BLE.write([0x00, 0x00, 0x16, 0x01]); // Stress start
  },

  // ── WRITE ────────────────────────────────────────────────
  async write(bytes) {
    if (!BLE.chars.tx || !BLE.connected) return;
    const data = new Uint8Array(bytes);
    const hex = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→] ' + hex);
    try {
      await BLE.chars.tx.writeValueWithoutResponse(data);
    } catch(e) {
      try { await BLE.chars.tx.writeValue(data); } catch(e2) {
        BLE.emit('raw', '[!] ' + e2.message);
      }
    }
  },

  // ── DISCONNECT ───────────────────────────────────────────
  async disconnect() {
    BLE.stopPeriodicRefresh();
    if (BLE.device?.gatt.connected) BLE.device.gatt.disconnect();
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
  },

  onDisconnected() {
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
    setTimeout(() => { if (!BLE.connected) BLE.emit('status', 'reconnecting'); }, 3000);
  },

  startPeriodicRefresh() {
    BLE._refreshTimer = setInterval(async () => {
      if (!BLE.connected) return;
      await BLE.readBattery();
      BLE.emit('readings', { ...BLE.readings });
    }, 120000);
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
  },

  // ── PARSE DATA ───────────────────────────────────────────
  onData(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    BLE.rawBuffer.push(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[←] ' + hex);
    console.log('V80 Veepoo data:', hex);
    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 2) return;
    BLE.emit('raw', '[PARSE] len=' + bytes.length + ' cmd=' + bytes[2]?.toString(16));

    const cmd = bytes[2];

    switch(cmd) {
      case 0x01: // Bind/pwd response
        BLE.emit('raw', '[BIND] Status: ' + bytes[3]);
        BLE.bound = true;
        break;

      case 0x04: // Battery
        if (bytes.length >= 4) {
          const batt = bytes[3];
          if (batt >= 0 && batt <= 100) {
            BLE.readings.battery = batt;
            BLE.emit('battery', batt);
            BLE.updateDashboard();
          }
        }
        break;

      case 0x11: // Heart Rate
        if (bytes.length >= 4 && bytes[3] > 30 && bytes[3] < 220) {
          BLE.readings.hr = bytes[3];
          BLE.readings.timestamp = Date.now();
          BLE.emit('hr', bytes[3]);
          BLE.updateDashboard();
        }
        break;

      case 0x12: // SpO2
        if (bytes.length >= 4 && bytes[3] >= 70 && bytes[3] <= 100) {
          BLE.readings.spo2 = bytes[3];
          BLE.emit('spo2', bytes[3]);
          BLE.updateDashboard();
        }
        break;

      case 0x13: // Blood Pressure
        if (bytes.length >= 5) {
          const sys = bytes[3], dia = bytes[4];
          if (sys > 60 && sys < 220 && dia > 40 && dia < 140) {
            BLE.readings.bp_sys = sys;
            BLE.readings.bp_dia = dia;
            BLE.emit('bp', { sys, dia });
            BLE.updateDashboard();
          }
        }
        break;

      case 0x14: // Temperature
        if (bytes.length >= 5) {
          const temp_c = ((bytes[3] << 8) | bytes[4]) / 100;
          if (temp_c > 30 && temp_c < 43) {
            BLE.readings.temp_c = temp_c;
            BLE.emit('temp', { c: temp_c, f: (temp_c * 9/5) + 32 });
            BLE.updateDashboard();
          }
        }
        break;

      case 0x15: // HRV
        if (bytes.length >= 5) {
          const hrv = (bytes[3] << 8) | bytes[4];
          if (hrv > 5 && hrv < 300) {
            BLE.readings.hrv = hrv;
            BLE.emit('hrv', hrv);
            BLE.updateDashboard();
          }
        }
        break;

      case 0x16: // Stress
        if (bytes.length >= 4) {
          const stress = bytes[3];
          const label = stress < 30 ? 'Relaxed' : stress < 60 ? 'Normal' : stress < 80 ? 'Elevated' : 'High';
          BLE.readings.stress = stress;
          BLE.readings.stress_label = label;
          BLE.emit('stress', { value: stress, label });
          BLE.updateDashboard();
        }
        break;

      case 0x05: // Steps
        if (bytes.length >= 6) {
          const steps = (bytes[3] << 24) | (bytes[4] << 16) | (bytes[5] << 8) | (bytes[6] || 0);
          BLE.readings.steps = steps;
          BLE.emit('steps', steps);
          BLE.updateDashboard();
        }
        break;
    }
  },

  // ── UPDATE DASHBOARD ─────────────────────────────────────
  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    const cls = (id, c) => { const el = document.getElementById(id); if (el) el.className = 'mt-status ' + c; };

    if (r.hr != null) {
      set('tile-rhr', r.hr);
      const s = r.hr < 60 ? 'Athletic' : r.hr < 80 ? 'Normal' : 'Elevated';
      set('tile-rhr-status', s); cls('tile-rhr-status', r.hr < 80 ? 'normal' : 'watch');
    }
    if (r.spo2 != null) {
      set('tile-spo2', r.spo2);
      set('tile-spo2-status', r.spo2 >= 95 ? 'Normal' : 'Watch'); cls('tile-spo2-status', r.spo2 >= 95 ? 'normal' : 'watch');
    }
    if (r.bp_sys != null) {
      set('tile-bp-s', r.bp_sys); set('tile-bp-d', '/' + r.bp_dia);
      const s = r.bp_sys < 120 ? 'Optimal' : r.bp_sys < 130 ? 'Normal' : 'Elevated';
      set('tile-bp-status', s); cls('tile-bp-status', r.bp_sys < 130 ? 'normal' : 'watch');
    }
    if (r.temp_c != null) {
      set('tile-temp', '+' + ((r.temp_c * 9/5 + 32) - 98.6).toFixed(1));
    }
    if (r.stress != null) {
      set('tile-stress', r.stress); set('tile-stress-status', r.stress_label);
      cls('tile-stress-status', r.stress < 60 ? 'normal' : 'watch');
    }
    if (r.battery != null) {
      set('ring-batt-pct', r.battery + '%');
      const h = Math.round((r.battery / 100) * 96);
      const proj = Math.floor(h/24) > 0 ? Math.floor(h/24) + 'd ' + (h%24) + 'h remaining' : h + 'h remaining';
      set('ring-batt-projection', proj);
      const bt = document.getElementById('ble-status-text');
      if (bt && BLE.connected) bt.textContent = 'V80 connected · ' + r.battery + '% · ' + proj;
    }
    const dot = document.getElementById('ring-online-dot'); if (dot) dot.style.display = 'block';
    set('ring-status-text', 'Connected · live data');
    set('ring-model-name', 'V80 Smart Ring');
    BLE.emit('readings', { ...r });
  },

  on(event, fn)     { if (!BLE.listeners[event]) BLE.listeners[event] = []; BLE.listeners[event].push(fn); },
  emit(event, data) { (BLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn)    { if (!BLE.listeners[event]) return; BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn); },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.BLE = BLE;
