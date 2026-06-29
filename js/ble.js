/* myDrSage — V80 Ring BLE — FEC7 command probing after SMP wake */

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

    // Step 1: SMP echo to wake ring
    BLE.emit('raw', '[STEP1] SMP wake...');
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xbf, 0xff]);
    await BLE.sleep(1000);

    // Step 2: Send commands on FEC7 — the real Veepoo write channel
    BLE.emit('raw', '[STEP2] FEC7 commands...');
    const cmds = [
      // Veepoo-style: try different byte 1 values
      { bytes: [0x01, 0x1a, 0x01, 0x00], name: 'echo-back' },   // mirrors what FEA1 sends us
      { bytes: [0x01, 0x01, 0x00, 0x00], name: 'cmd-01' },
      { bytes: [0x01, 0x02, 0x00, 0x00], name: 'cmd-02' },
      { bytes: [0x01, 0x03, 0x00, 0x00], name: 'battery' },
      { bytes: [0x01, 0x04, 0x00, 0x00], name: 'cmd-04' },
      { bytes: [0x01, 0x10, 0x00, 0x00], name: 'hr-start' },
      { bytes: [0x01, 0x11, 0x00, 0x00], name: 'hr-start2' },
      { bytes: [0x01, 0x20, 0x00, 0x00], name: 'cmd-20' },
      { bytes: [0x02, 0x00, 0x00, 0x00], name: 'cmd-02-00' },
      { bytes: [0x03, 0x00, 0x00, 0x00], name: 'cmd-03-00' },
      // Try sending same 4 bytes as FEA1 response
      { bytes: [0x01, 0x00, 0x00, 0x00], name: 'status-req' },
    ];

    for (const cmd of cmds) {
      if (BLE.chars.fec7) {
        const hex = cmd.bytes.map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[→FEC7/' + cmd.name + '] ' + hex);
        try {
          await BLE.chars.fec7.writeValue(new Uint8Array(cmd.bytes));
        } catch(e) { BLE.emit('raw', '[!FEC7] ' + e.message); }
        await BLE.sleep(800);
      }
    }

    // Step 3: Try FEA2 write with similar patterns
    BLE.emit('raw', '[STEP3] FEA2 commands...');
    const fea2cmds = [
      [0x01, 0x1a, 0x01, 0x00],
      [0x01, 0x01, 0x00, 0x00],
      [0x01, 0x03, 0x00, 0x00],
      [0x01, 0x10, 0x00, 0x00],
    ];
    for (const b of fea2cmds) {
      if (BLE.chars.fea2) {
        const hex = b.map(x => x.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[→FEA2] ' + hex);
        try {
          await BLE.chars.fea2.writeValue(new Uint8Array(b));
        } catch(e) { BLE.emit('raw', '[!FEA2] ' + e.message); }
        await BLE.sleep(800);
      }
    }

    BLE.emit('raw', '[DONE] Watching FEA1 for responses...');
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  async writeSMP(bytes) {
    if (!BLE.chars.smp) return;
    const hex = bytes.map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→SMP] ' + hex);
    try { await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array(bytes)); } catch(e) {}
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
    BLE.emit('raw', '[← ' + src + '] ' + hex + ' | ' + ascii);
    console.log('V80 [' + src + ']:', hex);
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 2) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');

    // FEA1 is the data channel - parse everything from it
    if (src === 'FEA1') {
      BLE.emit('raw', '[FEA1 PARSE] b0=' + bytes[0].toString(16) + ' b1=' + bytes[1].toString(16) + ' b2=' + bytes[2].toString(16) + ' b3=' + bytes[3].toString(16));

      // 0x01 0x1a = may be HR notification: b1=0x1a=26bpm? unlikely
      // Check if b1 is a valid HR
      if (bytes[0] === 0x01 && bytes[2] === 0x01) {
        const val = bytes[1];
        BLE.emit('raw', '[FEA1 VAL] 0x' + val.toString(16) + ' (' + val + ')');
        if (val > 40 && val < 200) {
          BLE.emit('raw', '[HR CANDIDATE] ' + val + ' bpm');
          BLE.readings.hr = val;
          BLE.emit('hr', val);
          BLE.updateDashboard();
        }
        if (val >= 70 && val <= 100) {
          BLE.emit('raw', '[SPO2 CANDIDATE] ' + val + '%');
        }
      }
    }

    // SMP responses
    if (src === '7C48') {
      const group = (bytes[4] << 8) | bytes[5];
      const rc = bytes.length > 9 ? bytes[9] : '?';
      BLE.emit('raw', '[SMP] group=' + group + ' rc=' + rc);
    }

    // HBand
    if (bytes[0] === 0xAB && bytes.length >= 8) {
      const cmd = (bytes[4] << 8) | bytes[5];
      if (cmd === 0x8480 && bytes[7] > 30) { BLE.readings.hr = bytes[7]; BLE.emit('hr', bytes[7]); BLE.updateDashboard(); }
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
