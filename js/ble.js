/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE Connection (Web Bluetooth API)
   Works in: Bluefy iOS, Chrome desktop/Android

   V80 GATT Map (confirmed via nRF Connect 2026-06-28):
   Service FEE7:
     FEC7  Write
     FEC8  Indicate
     FEC9  Read
     FEA1  Read + Notify
   Service F0080001: F0080002 (Notify) + F0080003 (Write)
   Service F0020001: F0020002 (Notify) + F0020003 (Write)

   NOTE: Protocol not yet known — awaiting supplier SDK.
   Connection and subscriptions are live; commands pending.
   ───────────────────────────────────────────────────────── */

const BLE = {
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
    hrv: null, glucose_mgdl: null, glucose_mmol: null,
    stress: null, stress_label: null, timestamp: null
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported. Please use Bluefy browser.');
    }

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'V80' }],
      optionalServices: [
        'fee7',
        'f0080001-0451-4000-b000-000000000000',
        'f0020001-0451-4000-b000-000000000000',
        '8d53dc1d-1db7-4cd3-868b-8a527a2ada5c'
      ]
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);
    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();

    // Subscribe to all known notify characteristics
    // Protocol commands pending supplier SDK response

    try {
      const svc = await BLE.server.getPrimaryService('fee7');
      BLE.chars.fea1 = await svc.getCharacteristic('fea1');
      await BLE.chars.fea1.startNotifications();
      BLE.chars.fea1.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.chars.fec7 = await svc.getCharacteristic('fec7');
    } catch(e) { console.log('FEE7:', e.message); }

    try {
      const svc2 = await BLE.server.getPrimaryService('f0080001-0451-4000-b000-000000000000');
      BLE.chars.f008notify = await svc2.getCharacteristic('f0080002-0451-4000-b000-000000000000');
      await BLE.chars.f008notify.startNotifications();
      BLE.chars.f008notify.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.chars.f008write = await svc2.getCharacteristic('f0080003-0451-4000-b000-000000000000');
    } catch(e) { console.log('F008:', e.message); }

    try {
      const svc3 = await BLE.server.getPrimaryService('f0020001-0451-4000-b000-000000000000');
      BLE.chars.f002notify = await svc3.getCharacteristic('f0020002-0451-4000-b000-000000000000');
      await BLE.chars.f002notify.startNotifications();
      BLE.chars.f002notify.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.chars.f002write = await svc3.getCharacteristic('f0020003-0451-4000-b000-000000000000');
    } catch(e) { console.log('F002:', e.message); }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);
    BLE.startPeriodicRefresh();

    return BLE.device.name;
  },

  // ── DISCONNECT ───────────────────────────────────────────
  async disconnect() {
    BLE.stopPeriodicRefresh();
    if (BLE.device && BLE.device.gatt.connected) {
      BLE.device.gatt.disconnect();
    }
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
  },

  onDisconnected() {
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
    setTimeout(() => {
      if (!BLE.connected) BLE.emit('status', 'reconnecting');
    }, 3000);
  },

  startPeriodicRefresh() {
    BLE._refreshTimer = setInterval(() => {
      if (!BLE.connected) return;
      BLE.emit('readings', { ...BLE.readings });
    }, 120000);
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
  },

  // ── PARSE INCOMING DATA ──────────────────────────────────
  onData(event) {
    const val   = event.target.value;
    const bytes = new Uint8Array(val.buffer);
    BLE.rawBuffer.push(bytes);

    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const src = event.target.uuid?.slice(-4).toUpperCase() || 'UNK';
    BLE.emit('raw', '[' + src + '] ' + hex);
    console.log('V80 data [' + src + ']:', hex);

    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 4) return;
    if (bytes[0] !== 0xAB) return;

    const cmd = (bytes[4] << 8) | bytes[5];

    switch(cmd) {
      case 0x8480: case 0x0480:
        if (bytes.length >= 8 && bytes[7] > 30 && bytes[7] < 220) {
          BLE.readings.hr = bytes[7];
          BLE.readings.timestamp = Date.now();
          BLE.emit('hr', bytes[7]);
          BLE.updateDashboard();
        }
        break;
      case 0x8580: case 0x0580:
        if (bytes.length >= 8 && bytes[7] >= 70 && bytes[7] <= 100) {
          BLE.readings.spo2 = bytes[7];
          BLE.emit('spo2', bytes[7]);
          BLE.updateDashboard();
        }
        break;
      case 0x8680: case 0x0680:
        if (bytes.length >= 9) {
          BLE.readings.bp_sys = bytes[7];
          BLE.readings.bp_dia = bytes[8];
          BLE.emit('bp', { sys: bytes[7], dia: bytes[8] });
          BLE.updateDashboard();
        }
        break;
      case 0x8780: case 0x0780:
        if (bytes.length >= 9) {
          const tempRaw = (bytes[7] << 8) | bytes[8];
          const temp_c = tempRaw / 100;
          if (temp_c > 30 && temp_c < 43) {
            BLE.readings.temp_c = temp_c;
            BLE.emit('temp', { c: temp_c, f: (temp_c * 9/5) + 32 });
            BLE.updateDashboard();
          }
        }
        break;
      case 0x5180:
        if (bytes.length >= 8 && bytes[6] === 0x01) {
          BLE.readings.battery = bytes[7];
          BLE.emit('battery', bytes[7]);
          BLE.updateDashboard();
        }
        break;
      case 0x8880: case 0x0880:
        if (bytes.length >= 9) {
          const rawMmol = ((bytes[7] << 8) | bytes[8]) / 100;
          if (rawMmol > 1 && rawMmol < 30) {
            const mgdl = Math.round(rawMmol * 18.0182);
            BLE.readings.glucose_mgdl = mgdl;
            BLE.readings.glucose_mmol = rawMmol;
            BLE.emit('glucose', { mgdl, mmol: rawMmol });
            BLE.updateDashboard();
          }
        }
        break;
      case 0x8980: case 0x0980:
        if (bytes.length >= 8) {
          const stress = bytes[7];
          const label = stress < 30 ? 'Relaxed' : stress < 60 ? 'Normal' : stress < 80 ? 'Elevated' : 'High';
          BLE.readings.stress = stress;
          BLE.readings.stress_label = label;
          BLE.emit('stress', { value: stress, label });
          BLE.updateDashboard();
        }
        break;
      case 0x8A80: case 0x0A80:
        if (bytes.length >= 9) {
          const hrv = (bytes[7] << 8) | bytes[8];
          if (hrv > 10 && hrv < 200) {
            BLE.readings.hrv = hrv;
            BLE.emit('hrv', hrv);
            BLE.updateDashboard();
          }
        }
        break;
    }
  },

  // ── UPDATE DASHBOARD ─────────────────────────────────────
  updateDashboard() {
    const r = BLE.readings;
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
    if (r.glucose_mgdl) {
      const el = document.getElementById('tile-glucose');
      if (el) el.textContent = r.glucose_mgdl;
      const st = document.getElementById('tile-glucose-status');
      if (st) { st.textContent = r.glucose_mgdl < 100 ? 'Normal' : r.glucose_mgdl < 126 ? 'Pre-range' : 'Elevated'; st.className = 'mt-status ' + (r.glucose_mgdl < 100 ? 'normal' : 'watch'); }
    }
    if (r.stress !== null) {
      const el = document.getElementById('tile-stress');
      if (el) el.textContent = r.stress;
      const st = document.getElementById('tile-stress-status');
      if (st) { st.textContent = r.stress_label || 'Normal'; st.className = 'mt-status ' + (r.stress < 60 ? 'normal' : 'watch'); }
    }
    if (r.battery) {
      const batt = document.getElementById('ring-batt-pct');
      if (batt) batt.textContent = r.battery + '%';
      const hoursLeft = Math.round((r.battery / 100) * 96);
      const daysLeft = Math.floor(hoursLeft / 24);
      const hrsLeft = hoursLeft % 24;
      const projection = daysLeft > 0 ? daysLeft + 'd ' + hrsLeft + 'h remaining' : hoursLeft + 'h remaining';
      const battProj = document.getElementById('ring-batt-projection');
      if (battProj) battProj.textContent = projection;
      const bleText = document.getElementById('ble-status-text');
      if (bleText && BLE.connected) bleText.textContent = 'V80 connected · ' + r.battery + '% · ' + projection;
    }
    const dot = document.getElementById('ring-online-dot');
    if (dot) dot.style.display = 'block';
    const rs = document.getElementById('ring-status-text');
    if (rs) rs.textContent = 'Connected · live data';
    const model = document.getElementById('ring-model-name');
    if (model) model.textContent = 'V80 Smart Ring';
    BLE.emit('readings', { ...r });
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn)  { if (!BLE.listeners[event]) BLE.listeners[event] = []; BLE.listeners[event].push(fn); },
  emit(event, data) { (BLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn) { if (!BLE.listeners[event]) return; BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn); },

  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.BLE = BLE;
