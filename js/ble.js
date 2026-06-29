/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE (CRPSmartRing SDK Protocol)
   Works in: Bluefy iOS, Chrome desktop/Android

   V80 GATT Map (confirmed via nRF Connect + Android SDK decompile):

   PRIMARY DATA SERVICE:
   A6ED0401-D344-460A-8075-B9E8EC90D71B
     A6ED0402  → Notify  (ring → phone data)
     A6ED0403  → Write Without Response (phone → ring commands)

   LEGACY SERVICE (FEE7) — kept for compatibility fallback

   PROTOCOL: CRPSmartRing SDK (CRREPA)
   Packet format: [0xAB, 0x00, len_hi, len_lo, cmd, sub, ...data]
   ───────────────────────────────────────────────────────── */

const BLE = {

  // ── CRP SERVICE UUIDs (confirmed from Android SDK) ──────
  SVC:        'a6ed0401-d344-460a-8075-b9e8ec90d71b',
  CHAR_RX:    'a6ed0402-d344-460a-8075-b9e8ec90d71b',  // ring → phone
  CHAR_TX:    'a6ed0403-d344-460a-8075-b9e8ec90d71b',  // phone → ring

  // Legacy FEE7 fallback
  SVC_LEGACY: 'fee7',

  // ── CRP COMMAND DEFINITIONS ──────────────────────────────
  // Format: [0xAB, 0x00, 0x00, dataLen, cmd, sub, ...data]
  // Based on CRPSmartRing SDK protocol reverse engineering

  CMD: {
    // System
    SYNC_TIME:      (ts) => {
      const d = new Date(ts || Date.now());
      return [0xAB, 0x00, 0x00, 0x08, 0x01, 0x00,
              d.getFullYear() - 2000, d.getMonth() + 1, d.getDate(),
              d.getHours(), d.getMinutes(), d.getSeconds(), 0x00, 0x00];
    },
    QUERY_BATTERY:  [0xAB, 0x00, 0x00, 0x01, 0x03, 0x00, 0x01],
    FIRST_CONNECT:  [0xAB, 0x00, 0x00, 0x01, 0x63, 0x00, 0x01],
    QUERY_FIRMWARE: [0xAB, 0x00, 0x00, 0x01, 0x01, 0x00, 0x01],

    // Heart Rate
    START_HR:       [0xAB, 0x00, 0x00, 0x02, 0x15, 0x01, 0x01, 0x01],
    STOP_HR:        [0xAB, 0x00, 0x00, 0x02, 0x15, 0x01, 0x00, 0x01],

    // SpO2
    START_SPO2:     [0xAB, 0x00, 0x00, 0x02, 0x15, 0x02, 0x01, 0x01],
    STOP_SPO2:      [0xAB, 0x00, 0x00, 0x02, 0x15, 0x02, 0x00, 0x01],

    // Blood Pressure
    START_BP:       [0xAB, 0x00, 0x00, 0x02, 0x15, 0x04, 0x01, 0x01],
    STOP_BP:        [0xAB, 0x00, 0x00, 0x02, 0x15, 0x04, 0x00, 0x01],

    // Temperature
    START_TEMP:     [0xAB, 0x00, 0x00, 0x02, 0x15, 0x08, 0x01, 0x01],
    STOP_TEMP:      [0xAB, 0x00, 0x00, 0x02, 0x15, 0x08, 0x00, 0x01],

    // HRV
    START_HRV:      [0xAB, 0x00, 0x00, 0x02, 0x15, 0x10, 0x01, 0x01],
    STOP_HRV:       [0xAB, 0x00, 0x00, 0x02, 0x15, 0x10, 0x00, 0x01],

    // Stress
    START_STRESS:   [0xAB, 0x00, 0x00, 0x02, 0x15, 0x20, 0x01, 0x01],
    STOP_STRESS:    [0xAB, 0x00, 0x00, 0x02, 0x15, 0x20, 0x00, 0x01],

    // Steps
    QUERY_STEPS:    [0xAB, 0x00, 0x00, 0x01, 0x07, 0x00, 0x01],

    // Sleep
    QUERY_SLEEP:    [0xAB, 0x00, 0x00, 0x01, 0x09, 0x00, 0x01],
  },

  // State
  device: null,
  server: null,
  chars: {},
  connected: false,
  listeners: {},
  rawBuffer: [],

  // Live readings
  readings: {
    hr: null, spo2: null, bp_sys: null, bp_dia: null,
    temp_c: null, steps: null, battery: null,
    hrv: null, glucose_mgdl: null, stress: null, stress_label: null,
    timestamp: null
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) throw new Error('Use Bluefy browser for Web Bluetooth.');

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'V80' }],
      optionalServices: [
        'a6ed0401-d344-460a-8075-b9e8ec90d71b',
        'fee7'
      ]
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);
    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();

    // ── Primary A6ED service ──
    let connected = false;
    try {
      const svc = await BLE.server.getPrimaryService('a6ed0401-d344-460a-8075-b9e8ec90d71b');
      BLE.chars.rx = await svc.getCharacteristic('a6ed0402-d344-460a-8075-b9e8ec90d71b');
      BLE.chars.tx = await svc.getCharacteristic('a6ed0403-d344-460a-8075-b9e8ec90d71b');
      await BLE.chars.rx.startNotifications();
      BLE.chars.rx.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.emit('raw', '[A6ED] Service connected ✓');
      connected = true;
    } catch(e) {
      BLE.emit('raw', '[A6ED] Failed: ' + e.message);
    }

    // ── Legacy FEE7 fallback ──
    if (!connected) {
      try {
        const svc = await BLE.server.getPrimaryService('fee7');
        BLE.chars.rx = await svc.getCharacteristic('fea1');
        BLE.chars.tx = await svc.getCharacteristic('fec7');
        await BLE.chars.rx.startNotifications();
        BLE.chars.rx.addEventListener('characteristicvaluechanged', BLE.onData);
        BLE.emit('raw', '[FEE7] Legacy service connected ✓');
      } catch(e) {
        BLE.emit('raw', '[FEE7] Failed: ' + e.message);
      }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Handshake sequence
    await BLE.sleep(300);
    await BLE.sendCmd(BLE.CMD.FIRST_CONNECT);
    await BLE.sleep(300);
    await BLE.sendCmd(BLE.CMD.SYNC_TIME());
    await BLE.sleep(300);
    await BLE.sendCmd(BLE.CMD.QUERY_BATTERY);
    await BLE.sleep(300);
    await BLE.sendCmd(BLE.CMD.QUERY_STEPS);
    await BLE.sleep(300);
    await BLE.startMeasurements();

    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  // ── SEND COMMAND ─────────────────────────────────────────
  async sendCmd(bytes) {
    if (!BLE.chars.tx || !BLE.connected) return;
    const data = new Uint8Array(Array.isArray(bytes) ? bytes : bytes);
    const hex = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→] ' + hex);
    try {
      await BLE.chars.tx.writeValueWithoutResponse(data);
    } catch(e) {
      try { await BLE.chars.tx.writeValue(data); } catch(e2) {
        BLE.emit('raw', '[!] Write failed: ' + e2.message);
      }
    }
  },

  async startMeasurements() {
    await BLE.sendCmd(BLE.CMD.START_HR);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_SPO2);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_BP);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_TEMP);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_HRV);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_STRESS);
  },

  async stopMeasurements() {
    await BLE.sendCmd(BLE.CMD.STOP_HR);
    await BLE.sendCmd(BLE.CMD.STOP_SPO2);
    await BLE.sendCmd(BLE.CMD.STOP_BP);
    await BLE.sendCmd(BLE.CMD.STOP_TEMP);
    await BLE.sendCmd(BLE.CMD.STOP_HRV);
    await BLE.sendCmd(BLE.CMD.STOP_STRESS);
  },

  // ── DISCONNECT ───────────────────────────────────────────
  async disconnect() {
    BLE.stopPeriodicRefresh();
    await BLE.stopMeasurements();
    if (BLE.device && BLE.device.gatt.connected) BLE.device.gatt.disconnect();
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
      await BLE.sendCmd(BLE.CMD.QUERY_BATTERY);
      await BLE.sleep(200);
      await BLE.sendCmd(BLE.CMD.QUERY_STEPS);
      BLE.emit('readings', { ...BLE.readings });
    }, 120000);
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
  },

  // ── PARSE INCOMING DATA ──────────────────────────────────
  onData(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    BLE.rawBuffer.push(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[←] ' + hex);
    console.log('V80 data:', hex);
    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 4) return;

    // CRP packet: AB 00 [len_hi] [len_lo] [cmd] [sub] [...data]
    if (bytes[0] === 0xAB && bytes[1] === 0x00) {
      const cmd = bytes[4];
      const sub = bytes[5];
      const data = bytes.slice(6);
      BLE.parseCRP(cmd, sub, data, bytes);
      return;
    }

    // Log unknown for debugging
    BLE.emit('raw', '[?] Unknown format: hdr=' + bytes[0].toString(16));
  },

  parseCRP(cmd, sub, data, raw) {
    switch(cmd) {
      case 0x03: // Battery
        if (data.length >= 1) {
          const batt = data[0];
          if (batt >= 0 && batt <= 100) {
            BLE.readings.battery = batt;
            BLE.emit('battery', batt);
            BLE.updateDashboard();
          }
        }
        break;

      case 0x15: // Measurement result
        switch(sub) {
          case 0x01: // Heart Rate
            if (data.length >= 1 && data[0] > 30 && data[0] < 220) {
              BLE.readings.hr = data[0];
              BLE.readings.timestamp = Date.now();
              BLE.emit('hr', data[0]);
              BLE.updateDashboard();
            }
            break;
          case 0x02: // SpO2
            if (data.length >= 1 && data[0] >= 70 && data[0] <= 100) {
              BLE.readings.spo2 = data[0];
              BLE.emit('spo2', data[0]);
              BLE.updateDashboard();
            }
            break;
          case 0x04: // Blood Pressure
            if (data.length >= 2) {
              const sys = data[0], dia = data[1];
              if (sys > 60 && sys < 220 && dia > 40 && dia < 140) {
                BLE.readings.bp_sys = sys;
                BLE.readings.bp_dia = dia;
                BLE.emit('bp', { sys, dia });
                BLE.updateDashboard();
              }
            }
            break;
          case 0x08: // Temperature
            if (data.length >= 2) {
              const tempRaw = (data[0] << 8) | data[1];
              const temp_c = tempRaw / 100;
              if (temp_c > 30 && temp_c < 43) {
                BLE.readings.temp_c = temp_c;
                BLE.emit('temp', { c: temp_c, f: (temp_c * 9/5) + 32 });
                BLE.updateDashboard();
              }
            }
            break;
          case 0x10: // HRV
            if (data.length >= 2) {
              const hrv = (data[0] << 8) | data[1];
              if (hrv > 10 && hrv < 200) {
                BLE.readings.hrv = hrv;
                BLE.emit('hrv', hrv);
                BLE.updateDashboard();
              }
            }
            break;
          case 0x20: // Stress
            if (data.length >= 1) {
              const stress = data[0];
              const label = stress < 30 ? 'Relaxed' : stress < 60 ? 'Normal' : stress < 80 ? 'Elevated' : 'High';
              BLE.readings.stress = stress;
              BLE.readings.stress_label = label;
              BLE.emit('stress', { value: stress, label });
              BLE.updateDashboard();
            }
            break;
        }
        break;

      case 0x07: // Steps
        if (data.length >= 4) {
          const steps = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
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
    if (r.hr != null) {
      const el = document.getElementById('tile-rhr'); if (el) el.textContent = r.hr;
      const s = document.getElementById('tile-rhr-status');
      if (s) { s.textContent = r.hr < 60 ? 'Athletic' : r.hr < 80 ? 'Normal' : 'Elevated'; s.className = 'mt-status ' + (r.hr < 80 ? 'normal' : 'watch'); }
    }
    if (r.spo2 != null) {
      const el = document.getElementById('tile-spo2'); if (el) el.textContent = r.spo2;
      const s = document.getElementById('tile-spo2-status');
      if (s) { s.textContent = r.spo2 >= 95 ? 'Normal' : 'Watch'; s.className = 'mt-status ' + (r.spo2 >= 95 ? 'normal' : 'watch'); }
    }
    if (r.bp_sys != null) {
      const s = document.getElementById('tile-bp-s'); if (s) s.textContent = r.bp_sys;
      const d = document.getElementById('tile-bp-d'); if (d) d.textContent = '/' + r.bp_dia;
      const st = document.getElementById('tile-bp-status');
      if (st) { st.textContent = r.bp_sys < 120 ? 'Optimal' : r.bp_sys < 130 ? 'Normal' : 'Elevated'; st.className = 'mt-status ' + (r.bp_sys < 130 ? 'normal' : 'watch'); }
    }
    if (r.temp_c != null) {
      const el = document.getElementById('tile-temp');
      if (el) el.textContent = '+' + ((r.temp_c * 9/5 + 32) - 98.6).toFixed(1);
    }
    if (r.stress != null) {
      const el = document.getElementById('tile-stress'); if (el) el.textContent = r.stress;
      const st = document.getElementById('tile-stress-status');
      if (st) { st.textContent = r.stress_label || 'Normal'; st.className = 'mt-status ' + (r.stress < 60 ? 'normal' : 'watch'); }
    }
    if (r.battery != null) {
      const batt = document.getElementById('ring-batt-pct'); if (batt) batt.textContent = r.battery + '%';
      const hoursLeft = Math.round((r.battery / 100) * 96);
      const proj = Math.floor(hoursLeft/24) > 0 ? Math.floor(hoursLeft/24) + 'd ' + (hoursLeft%24) + 'h remaining' : hoursLeft + 'h remaining';
      const battProj = document.getElementById('ring-batt-projection'); if (battProj) battProj.textContent = proj;
      const bleText = document.getElementById('ble-status-text');
      if (bleText && BLE.connected) bleText.textContent = 'V80 connected · ' + r.battery + '% · ' + proj;
    }
    const dot = document.getElementById('ring-online-dot'); if (dot) dot.style.display = 'block';
    const rs = document.getElementById('ring-status-text'); if (rs) rs.textContent = 'Connected · live data';
    const model = document.getElementById('ring-model-name'); if (model) model.textContent = 'V80 Smart Ring';
    BLE.emit('readings', { ...r });
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn)     { if (!BLE.listeners[event]) BLE.listeners[event] = []; BLE.listeners[event].push(fn); },
  emit(event, data) { (BLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn)    { if (!BLE.listeners[event]) return; BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn); },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.BLE = BLE;
