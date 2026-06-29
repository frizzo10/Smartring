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
    // The confirmed working sequence from the one successful session:
    // SMP wake → SMP ping → HBand on F0080003 → got activity data on F0080002
    
    // SMP ping (triggers 7C48 response which may unlock F008)
    BLE.emit('raw', '[SMP] Sending ping...');
    if (BLE.chars.smp) {
      try {
        await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xbf, 0xff]));
        BLE.emit('raw', '[SMP] Ping sent ✓');
      } catch(e) { BLE.emit('raw', '[SMP ERR] ' + e.message); }
    }
    await BLE.sleep(1200);

    // Send HBand commands on F0080003 — this is what triggered the a0 activity response
    BLE.emit('raw', '[F008] Sending HBand commands...');
    const hbandCmds = [
      { b: [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00], name: 'battery' },
      { b: [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x01, 0x00], name: 'hr-start' },
      { b: [0xAB, 0x00, 0x04, 0xFF, 0x85, 0x80, 0x01, 0x00], name: 'spo2-start' },
      { b: [0xAB, 0x00, 0x04, 0xFF, 0x86, 0x80, 0x01, 0x00], name: 'bp-start' },
      { b: [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x03, 0x00], name: 'steps' },
    ];

    for (const cmd of hbandCmds) {
      if (!BLE.chars.f008tx) {
        BLE.emit('raw', '[!] No F0080003');
        break;
      }
      const hex = cmd.b.map(b => b.toString(16).padStart(2,'0')).join(' ');
      BLE.emit('raw', '[→F008/' + cmd.name + '] ' + hex);
      try {
        await BLE.chars.f008tx.writeValueWithoutResponse(new Uint8Array(cmd.b));
      } catch(e) {
        try { await BLE.chars.f008tx.writeValue(new Uint8Array(cmd.b)); }
        catch(e2) { BLE.emit('raw', '[!F008] ' + e2.message); }
      }
      await BLE.sleep(1000);
    }

    BLE.emit('raw', '[DONE] Watching all channels...');
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

    // FEA1 auto-push: 01 1a 01 00 — connection status
    if (src === 'FEA1' && bytes[0] === 0x01 && bytes.length === 4) {
      BLE.emit('raw', '[FEA1] status packet: ' + bytes[1].toString(16));
    }

    // Activity packet confirmed: hdr=a0
    // a0 00 00 00 [batt] [steps_lo] [steps_hi] 01 [cal_lo] [cal_hi] ...
    if (bytes[0] === 0xa0 && bytes.length >= 10) {
      const batt = bytes[4];           // 0x4a = 74%
      const steps = (bytes[6] << 8) | bytes[5];  // 0x014a = 330 steps -- wait check ordering
      const cal = ((bytes[9] << 8) | bytes[8]) / 10;
      BLE.emit('raw', '[ACTIVITY] batt=' + batt + '% steps=' + steps + ' cal=' + cal);
      if (batt > 0 && batt <= 100) {
        BLE.readings.battery = batt;
        BLE.emit('battery', batt);
      }
      if (steps >= 0) {
        BLE.readings.steps = steps;
        BLE.emit('steps', steps);
      }
      BLE.updateDashboard();
    }

    // Log all non-zero non-FEA1 responses
    if (src !== 'FEA1' && bytes.some(b => b !== 0)) {
      BLE.emit('raw', '[DATA ' + src + '] ' + hex);
      for (let i = 1; i < bytes.length; i++) {
        const v = bytes[i];
        if (v >= 40 && v <= 220) BLE.emit('raw', '  b[' + i + ']=' + v);
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
