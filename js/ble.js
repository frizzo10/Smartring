/* myDrSage — V80 Ring BLE — SMP Protocol */

const BLE = {
  device: null, server: null, chars: {}, connected: false,
  listeners: {}, rawBuffer: [],

  readings: {
    hr: null, spo2: null, bp_sys: null, bp_dia: null,
    temp_c: null, steps: null, battery: null,
    hrv: null, stress: null, stress_label: null,
    glucose_mgdl: null, timestamp: null
  },

  async connect() {
    if (!navigator.bluetooth) throw new Error('Use Bluefy browser.');

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
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
    BLE.emit('raw', '[CONNECTED] ' + BLE.device.name);

    const services = await BLE.server.getPrimaryServices();
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const char of chars) {
        const uuid = char.uuid.toLowerCase();
        if (char.properties.notify || char.properties.indicate) {
          try { await char.startNotifications(); char.addEventListener('characteristicvaluechanged', BLE.onData); } catch(e) {}
        }
        if (uuid.includes('fea2')) BLE.chars.fea2 = char;
        if (uuid.includes('fec7')) BLE.chars.fec7 = char;
        if (uuid.includes('fea1')) BLE.chars.fea1 = char;
        if (uuid.includes('fec9')) BLE.chars.fec9 = char;
        if (uuid.includes('f0080003')) BLE.chars.f008 = char;
        if (uuid.includes('f0020003')) BLE.chars.f002 = char;
        if (uuid.includes('da2e7828')) BLE.chars.smp = char;
      }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    await BLE.sleep(300);

    // ── SMP Protocol probing ─────────────────────────────
    // SMP frame: [op(1), flags(1), len_hi(1), len_lo(1), group_hi(1), group_lo(1), seq(1), id(1), payload...]
    // op=0 read, op=2 write
    // group=0 OS mgmt, group=1 image, group=8 custom/health

    BLE.emit('raw', '[SMP] Probing device info...');

    // OS mgmt echo (group=0, id=0) — confirms comms
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xbf, 0xff], 'echo');
    await BLE.sleep(1000);

    // OS mgmt taskstat (group=0, id=2)
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0xbf, 0xff], 'taskstat');
    await BLE.sleep(1000);

    // Custom health group (group=8, id=0) — try reading health data
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x00, 0xbf, 0xff], 'health-read');
    await BLE.sleep(1000);

    // Custom group=1 id=0 — try image/firmware info
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xbf, 0xff], 'img-info');
    await BLE.sleep(1000);

    // Try FEC9 read for device info
    if (BLE.chars.fec9) {
      try {
        const val = await BLE.chars.fec9.readValue();
        const hex = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2,'0')).join(' ');
        const ascii = Array.from(new Uint8Array(val.buffer)).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
        BLE.emit('raw', '[FEC9] ' + hex);
        BLE.emit('raw', '[FEC9 ASCII] ' + ascii);
      } catch(e) { BLE.emit('raw', '[FEC9 ERR] ' + e.message); }
    }

    // Try FEA1 read
    if (BLE.chars.fea1) {
      try {
        const val = await BLE.chars.fea1.readValue();
        const hex = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[FEA1 READ] ' + hex);
      } catch(e) { BLE.emit('raw', '[FEA1 ERR] ' + e.message); }
    }

    BLE.emit('raw', '[DONE] Watching for responses...');
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  async writeSMP(bytes, label) {
    if (!BLE.chars.smp) return;
    const hex = bytes.map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→SMP/' + label + '] ' + hex);
    try {
      await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array(bytes));
    } catch(e) { BLE.emit('raw', '[!SMP] ' + e.message); }
  },

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
    BLE._refreshTimer = setInterval(() => {
      if (!BLE.connected) return;
      BLE.emit('readings', { ...BLE.readings });
    }, 120000);
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
  },

  onData(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    BLE.rawBuffer.push(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(bytes).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    const src = event.target.uuid?.slice(-4).toUpperCase() || 'UNK';
    BLE.emit('raw', '[← ' + src + '] ' + hex);
    BLE.emit('raw', '[← ' + src + ' ASCII] ' + ascii);
    console.log('V80 [' + src + ']:', hex);
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 2) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');

    // SMP response on 7C48
    if (src === '7C48') {
      BLE.emit('raw', '[SMP RESP] op=' + bytes[0] + ' group=' + ((bytes[4]<<8)|bytes[5]) + ' id=' + bytes[7]);
      // Try to decode CBOR payload
      if (bytes.length > 8) {
        const payload = bytes.slice(8);
        const payloadHex = Array.from(payload).map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[SMP CBOR] ' + payloadHex);
      }
    }

    // F008/F002 responses
    if (bytes[0] !== 0x00 || bytes.some(b => b !== 0)) {
      // Non-zero response — interesting
      BLE.emit('raw', '[DATA] ' + src + ': ' + hex);
      // Scan for plausible health values
      for (let i = 0; i < bytes.length; i++) {
        const v = bytes[i];
        if (v >= 50 && v <= 180) BLE.emit('raw', '[VAL] [' + i + ']=' + v + ' (HR/SpO2 range)');
        if (v >= 90 && v <= 170 && i > 0) BLE.emit('raw', '[BP?] [' + i + ']=' + v);
      }
    }

    // HBand
    if (bytes[0] === 0xAB && bytes.length >= 8) {
      const cmd = (bytes[4] << 8) | bytes[5];
      if (cmd === 0x8480 && bytes[7] > 30) { BLE.readings.hr = bytes[7]; BLE.emit('hr', bytes[7]); BLE.updateDashboard(); }
      if (cmd === 0x8580 && bytes[7] >= 70) { BLE.readings.spo2 = bytes[7]; BLE.emit('spo2', bytes[7]); BLE.updateDashboard(); }
      if (cmd === 0x5180) { BLE.readings.battery = bytes[7]; BLE.emit('battery', bytes[7]); BLE.updateDashboard(); }
    }
  },

  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (r.hr) set('tile-rhr', r.hr);
    if (r.spo2) set('tile-spo2', r.spo2);
    if (r.battery) set('ring-batt-pct', r.battery + '%');
    const dot = document.getElementById('ring-online-dot'); if (dot) dot.style.display = 'block';
    set('ring-status-text', 'Connected · live data');
    BLE.emit('readings', { ...r });
  },

  on(event, fn)     { if (!BLE.listeners[event]) BLE.listeners[event] = []; BLE.listeners[event].push(fn); },
  emit(event, data) { (BLE.listeners[event] || []).forEach(fn => fn(data)); },
  off(event, fn)    { if (!BLE.listeners[event]) return; BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn); },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.BLE = BLE;
