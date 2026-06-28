/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE Connection (Web Bluetooth API)
   Works in: Bluefy iOS, Chrome desktop/Android

   V80 REAL GATT Map (confirmed via nRF Connect 2026-06-28):
   
   SMP Service:  8D53DC1D-1DB7-4CD3-868B-8A527...
     DA2E7828-FBCE-4E01-AE9E-261174997C48  Write Without Response + Notify

   F0080001-0451-4000-B000-000000000000  (PRIMARY — health data)
     F0080002...  Notify       ← ring sends data here
     F0080003...  Write/WoR    ← we send commands here

   F0020001-0451-4000-B000-000000000000  (SECONDARY)
     F0020002...  Notify
     F0020003...  Write/WoR

   FEE7  (legacy, kept for compatibility)
     FEC7  Write
     FEC8  Indicate
     FEC9  Read
     FEA1  Read + Notify
   ───────────────────────────────────────────────────────── */

const BLE = {
  // Primary data service UUIDs (confirmed real)
  SVC_PRIMARY:  'f0080001-0451-4000-b000-000000000000',
  CHAR_NOTIFY:  'f0080002-0451-4000-b000-000000000000',
  CHAR_WRITE:   'f0080003-0451-4000-b000-000000000000',

  // Secondary service
  SVC_SECONDARY: 'f0020001-0451-4000-b000-000000000000',
  CHAR_NOTIFY2:  'f0020002-0451-4000-b000-000000000000',
  CHAR_WRITE2:   'f0020003-0451-4000-b000-000000000000',

  // Legacy FEE7 (kept)
  SVC_LEGACY:   'fee7',

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
        'f0080001-0451-4000-b000-000000000000',
        'f0020001-0451-4000-b000-000000000000',
        'fee7',
        '8d53dc1d-1db7-4cd3-868b-8a527a2ada5c'
      ]
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);
    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();

    // ── Primary F008 service ──
    try {
      const svc = await BLE.server.getPrimaryService('f0080001-0451-4000-b000-000000000000');
      BLE.chars.notify  = await svc.getCharacteristic('f0080002-0451-4000-b000-000000000000');
      BLE.chars.write   = await svc.getCharacteristic('f0080003-0451-4000-b000-000000000000');
      await BLE.chars.notify.startNotifications();
      BLE.chars.notify.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.emit('raw', '[INIT] F008 service connected');
    } catch(e) {
      BLE.emit('raw', '[INIT] F008 failed: ' + e.message);
    }

    // ── Secondary F002 service ──
    try {
      const svc2 = await BLE.server.getPrimaryService('f0020001-0451-4000-b000-000000000000');
      BLE.chars.notify2 = await svc2.getCharacteristic('f0020002-0451-4000-b000-000000000000');
      BLE.chars.write2  = await svc2.getCharacteristic('f0020003-0451-4000-b000-000000000000');
      await BLE.chars.notify2.startNotifications();
      BLE.chars.notify2.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.emit('raw', '[INIT] F002 service connected');
    } catch(e) {
      BLE.emit('raw', '[INIT] F002 failed: ' + e.message);
    }

    // ── Legacy FEE7 ──
    try {
      const svcL = await BLE.server.getPrimaryService('fee7');
      BLE.chars.legacyNotify = await svcL.getCharacteristic('fea1');
      await BLE.chars.legacyNotify.startNotifications();
      BLE.chars.legacyNotify.addEventListener('characteristicvaluechanged', BLE.onData);
      BLE.chars.legacyWrite = await svcL.getCharacteristic('fec7');
      BLE.emit('raw', '[INIT] FEE7 legacy service connected');
    } catch(e) {
      BLE.emit('raw', '[INIT] FEE7 failed: ' + e.message);
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Probe all write channels
    await BLE.sleep(500);
    await BLE.probeAllChannels();
    BLE.startPeriodicRefresh();

    return BLE.device.name;
  },

  // ── PROBE ALL CHANNELS ───────────────────────────────────
  // Send simple probes on every write char and log any response
  async probeAllChannels() {
    const probes = [
      [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      [0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00],
    ];

    const channels = [
      { char: BLE.chars.write,  name: 'F0080003' },
      { char: BLE.chars.write2, name: 'F0020003' },
      { char: BLE.chars.legacyWrite, name: 'FEC7' },
    ];

    for (const ch of channels) {
      if (!ch.char) continue;
      for (const probe of probes) {
        const hex = probe.map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[→' + ch.name + '] ' + hex);
        try {
          await ch.char.writeValueWithoutResponse(new Uint8Array(probe));
        } catch(e) {
          try { await ch.char.writeValue(new Uint8Array(probe)); } catch(e2) {}
        }
        await BLE.sleep(600);
      }
    }
    BLE.emit('raw', '[PROBE] Complete — watching for responses...');
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
    BLE.emit('raw', '[←' + src + '] ' + hex);
    console.log('V80 data [' + src + ']:', hex);

    // Try to parse — log raw first, identify protocol from responses
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 2) return;

    const h = bytes[0];

    // Log header byte to help identify protocol
    BLE.emit('raw', '[PARSE] hdr=0x' + h.toString(16) + ' len=' + bytes.length);

    // Try common patterns
    // Pattern A: first byte is HR-range value (passive)
    if (bytes.length === 1 && bytes[0] > 30 && bytes[0] < 220) {
      BLE.readings.hr = bytes[0];
      BLE.readings.timestamp = Date.now();
      BLE.emit('hr', bytes[0]);
      BLE.updateDashboard();
      return;
    }

    // Pattern B: 0xAB HBand
    if (h === 0xAB && bytes.length >= 8) {
      const cmd = (bytes[4] << 8) | bytes[5];
      BLE.parseHBand(bytes, cmd);
      return;
    }

    // Pattern C: 0xFC (R9 style)
    if (h === 0xFC && bytes.length >= 3) {
      BLE.emit('raw', '[FC] cmd=' + bytes[1].toString(16) + ' sub=' + bytes[2].toString(16));
      return;
    }

    // Pattern D: length-prefixed
    if (bytes[1] === bytes.length - 2 || bytes[1] === bytes.length) {
      BLE.emit('raw', '[LEN-PREFIX] possible length-prefixed packet');
    }
  },

  parseHBand(bytes, cmd) {
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
      case 0x5180:
        if (bytes.length >= 8 && bytes[6] === 0x01) {
          BLE.readings.battery = bytes[7];
          BLE.emit('battery', bytes[7]);
          BLE.updateDashboard();
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
    if (r.battery) {
      const batt = document.getElementById('ring-batt-pct');
      if (batt) batt.textContent = r.battery + '%';
      const bleText = document.getElementById('ble-status-text');
      if (bleText && BLE.connected) bleText.textContent = 'V80 connected · ' + r.battery + '%';
    }
    const dot = document.getElementById('ring-online-dot');
    if (dot) dot.style.display = 'block';
    const rs = document.getElementById('ring-status-text');
    if (rs) rs.textContent = 'Connected · live data';
    BLE.emit('readings', { ...r });
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn)  { if (!BLE.listeners[event]) BLE.listeners[event] = []; BLE.listeners[event].push(fn); },
  emit(event, data) { (BLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn) { if (!BLE.listeners[event]) return; BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn); },

  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.BLE = BLE;
