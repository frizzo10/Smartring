/* myDrSage — V80 Ring BLE — SMP wake + systematic FEC7 probe */

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

    // Get characteristics
    try {
      const services = await BLE.server.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const char of chars) {
          const uuid = char.uuid.toLowerCase();
          if (char.properties.notify || char.properties.indicate) {
            try { 
              await char.startNotifications(); 
              char.addEventListener('characteristicvaluechanged', BLE.onData);
              BLE.emit('raw', '[SUB] ' + uuid.slice(-4).toUpperCase());
            } catch(e) { BLE.emit('raw', '[SUB ERR] ' + uuid.slice(-4).toUpperCase() + ' ' + e.message); }
          }
          if (uuid.includes('fec7')) BLE.chars.fec7 = char;
          if (uuid.includes('fec8')) BLE.chars.fec8 = char;
          if (uuid.includes('fea1')) BLE.chars.fea1 = char;
          if (uuid.includes('fea2')) BLE.chars.fea2 = char;
          if (uuid.includes('f0080002')) BLE.chars.f008rx = char;
          if (uuid.includes('f0080003')) BLE.chars.f008tx = char;
          if (uuid.includes('f0020002')) BLE.chars.f002rx = char;
          if (uuid.includes('f0020003')) BLE.chars.f002tx = char;
          if (uuid.includes('da2e7828')) BLE.chars.smp = char;
        }
      }
      BLE.emit('raw', '[CHARS] fec7=' + !!BLE.chars.fec7 + ' smp=' + !!BLE.chars.smp);
    } catch(e) {
      BLE.emit('raw', '[ERR] ' + e.message);
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // STEP 1: SMP wake - CRITICAL
    await BLE.sleep(500);
    if (BLE.chars.smp) {
      BLE.emit('raw', '[SMP] Sending wake...');
      try {
        await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xbf, 0xff]));
        BLE.emit('raw', '[SMP] Wake sent ✓');
      } catch(e) { BLE.emit('raw', '[SMP ERR] ' + e.message); }
    } else {
      BLE.emit('raw', '[SMP] Not found!');
    }

    await BLE.sleep(1500);

    // STEP 2: Confirmed working command
    BLE.emit('raw', '[PROBE] Starting FEC7 probe...');
    const probes = [
      [0x01, 0x00, 0x00, 0x00],
      [0x01, 0x01, 0x00, 0x00],
      [0x01, 0x02, 0x00, 0x00],
      [0x01, 0x03, 0x00, 0x00],
      [0x01, 0x04, 0x00, 0x00],
      [0x01, 0x05, 0x00, 0x00],
      [0x01, 0x06, 0x00, 0x00],
      [0x01, 0x07, 0x00, 0x00],
      [0x01, 0x08, 0x00, 0x00],
      [0x01, 0x09, 0x00, 0x00],
      [0x01, 0x0a, 0x00, 0x00],
      [0x01, 0x0b, 0x00, 0x00],
      [0x01, 0x0c, 0x00, 0x00],
      [0x01, 0x0d, 0x00, 0x00],
      [0x01, 0x0e, 0x00, 0x00],
      [0x01, 0x0f, 0x00, 0x00],
      [0x01, 0x10, 0x00, 0x00],
      [0x01, 0x11, 0x00, 0x00],
      [0x01, 0x12, 0x00, 0x00],
      [0x01, 0x13, 0x00, 0x00],
      [0x01, 0x14, 0x00, 0x00],
      [0x01, 0x15, 0x00, 0x00],
      [0x01, 0x1a, 0x00, 0x00],
      [0x02, 0x00, 0x00, 0x00],
      [0x03, 0x00, 0x00, 0x00],
      [0x04, 0x00, 0x00, 0x00],
      [0x05, 0x00, 0x00, 0x00],
    ];

    for (const b of probes) {
      if (!BLE.chars.fec7) { BLE.emit('raw', '[!] No FEC7'); break; }
      const hex = b.map(x => x.toString(16).padStart(2,'0')).join(' ');
      BLE.emit('raw', '[→FEC7] ' + hex);
      try {
        await BLE.chars.fec7.writeValue(new Uint8Array(b));
      } catch(e) {
        try { await BLE.chars.fec7.writeValueWithoutResponse(new Uint8Array(b)); }
        catch(e2) { BLE.emit('raw', '[!] ' + e2.message); }
      }
      await BLE.sleep(700);
    }

    BLE.emit('raw', '[PROBE] Complete');
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  startPeriodicRefresh() {
    BLE._refreshTimer = setInterval(async () => {
      if (!BLE.connected) return;
      if (BLE.chars.smp) {
        try { await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array([0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0xbf,0xff])); } catch(e) {}
      }
      await BLE.sleep(500);
      if (BLE.chars.fec7) {
        try { await BLE.chars.fec7.writeValue(new Uint8Array([0x01, 0x00, 0x00, 0x00])); } catch(e) {}
      }
      BLE.emit('readings', { ...BLE.readings });
    }, 30000);
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
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

  onData(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    BLE.rawBuffer.push(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const src = event.target.uuid?.slice(-4).toUpperCase() || 'UNK';
    BLE.emit('raw', '[← ' + src + '] ' + hex);
    console.log('V80 [' + src + ']:', hex);
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 2) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');

    // Activity packet (confirmed): hdr=a0
    if (bytes[0] === 0xa0 && bytes.length >= 15) {
      const steps = (bytes[5] << 8) | bytes[4];
      const cal = ((bytes[9] << 8) | bytes[8]) / 10;
      const batt = bytes[14];
      BLE.emit('raw', '[ACTIVITY] steps=' + steps + ' cal=' + cal + ' b14=' + batt);
      BLE.readings.steps = steps;
      if (batt > 0 && batt <= 100) { BLE.readings.battery = batt; BLE.emit('battery', batt); }
      BLE.emit('steps', steps);
      BLE.updateDashboard();
    }

    // Log ALL non-zero responses for analysis
    if (bytes.some(b => b !== 0)) {
      BLE.emit('raw', '[DATA ' + src + '] hdr=0x' + bytes[0].toString(16));
      // Look for health values
      for (let i = 1; i < bytes.length; i++) {
        const v = bytes[i];
        if (v >= 40 && v <= 220) BLE.emit('raw', '  [' + i + ']=0x' + v.toString(16) + '(' + v + ')');
      }
    }
  },

  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (r.hr != null) set('tile-rhr', r.hr);
    if (r.spo2 != null) set('tile-spo2', r.spo2);
    if (r.steps != null) { const el = document.getElementById('tile-steps'); if (el) el.textContent = r.steps; }
    if (r.battery != null) {
      set('ring-batt-pct', r.battery + '%');
      const bt = document.getElementById('ble-status-text');
      if (bt) bt.textContent = 'V80 connected · ' + r.battery + '%';
    }
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
