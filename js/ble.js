/* myDrSage — V80 Ring BLE — SMP + FEA2 focused */

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
        '0000ae00-0000-1000-8000-00805f9b34fb',
        'a6ed0401-d344-460a-8075-b9e8ec90d71b',
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

    // Get all services and subscribe
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
            } catch(e) {}
          }
          if (uuid.includes('fea2')) BLE.chars.fea2 = char;
          if (uuid.includes('fec7')) BLE.chars.fec7 = char;
          if (uuid.includes('f0080003')) BLE.chars.f008 = char;
          if (uuid.includes('f0020003')) BLE.chars.f002 = char;
          if (uuid.includes('da2e7828')) BLE.chars.smp = char;
        }
      }
      BLE.emit('raw', '[READY] fea2=' + !!BLE.chars.fea2 + ' fec7=' + !!BLE.chars.fec7 + ' smp=' + !!BLE.chars.smp);
    } catch(e) {
      BLE.emit('raw', '[ERR] ' + e.message);
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    await BLE.sleep(500);

    // Step 1: Try FEA2 — this is the Veepoo bidirectional channel
    // FEA2 supports Read+Write+Indicate — most likely the real command channel
    if (BLE.chars.fea2) {
      BLE.emit('raw', '[FEA2] Trying read first...');
      try {
        const val = await BLE.chars.fea2.readValue();
        const hex = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[FEA2 READ] ' + hex);
      } catch(e) { BLE.emit('raw', '[FEA2 READ ERR] ' + e.message); }

      await BLE.sleep(300);

      // Send Veepoo password bind on FEA2
      const pwd = [0x30,0x30,0x30,0x30,0x30,0x30];
      const binds = [
        [0x00, 0x00, 0x01, 0x01, ...pwd],
        [0x01, 0x01, ...pwd],
        [0xAB, 0x00, 0x04, 0xFF, 0x63, 0x00, 0x01, 0x00],
      ];
      for (const b of binds) {
        await BLE.writeChar(BLE.chars.fea2, b, 'FEA2');
        await BLE.sleep(1000);
      }
    }

    await BLE.sleep(500);

    // Step 2: Try FEC9 read — device info
    if (BLE.chars.fec9) {
      try {
        const val = await BLE.chars.fec9.readValue();
        const hex = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[FEC9 READ] ' + hex);
      } catch(e) { BLE.emit('raw', '[FEC9 ERR] ' + e.message); }
    }

    await BLE.sleep(500);

    // Step 3: Try SMP ping
    if (BLE.chars.smp) {
      BLE.emit('raw', '[SMP] Sending ping...');
      // SMP echo request: op=0 flags=0 len=0 group=0 seq=0 id=0
      await BLE.writeChar(BLE.chars.smp, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 'SMP');
      await BLE.sleep(1000);
    }

    // Step 4: Try F008 with HBand commands
    if (BLE.chars.f008) {
      BLE.emit('raw', '[F008] Trying HBand battery cmd...');
      await BLE.writeChar(BLE.chars.f008, [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00], 'F008');
      await BLE.sleep(1000);
      await BLE.writeChar(BLE.chars.f008, [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x01, 0x00], 'F008');
      await BLE.sleep(1000);
    }

    BLE.emit('raw', '[DONE] Waiting for ring responses...');
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  async writeChar(char, bytes, name) {
    const data = new Uint8Array(bytes);
    const hex = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→' + name + '] ' + hex);
    try {
      if (char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(data);
      } else {
        await char.writeValue(data);
      }
    } catch(e) { BLE.emit('raw', '[!' + name + '] ' + e.message); }
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
    const src = event.target.uuid?.slice(-4).toUpperCase() || 'UNK';
    BLE.emit('raw', '[← ' + src + '] ' + hex);
    console.log('V80 data [' + src + ']:', hex);
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 2) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');

    // HBand format
    if (bytes[0] === 0xAB && bytes.length >= 8) {
      const cmd = (bytes[4] << 8) | bytes[5];
      BLE.emit('raw', '[HBAND cmd=0x' + cmd.toString(16) + '] ' + hex);
      if (cmd === 0x8480 && bytes[7] > 30) { BLE.readings.hr = bytes[7]; BLE.emit('hr', bytes[7]); BLE.updateDashboard(); }
      if (cmd === 0x8580 && bytes[7] >= 70) { BLE.readings.spo2 = bytes[7]; BLE.emit('spo2', bytes[7]); BLE.updateDashboard(); }
      if (cmd === 0x5180 && bytes[6] === 0x01) { BLE.readings.battery = bytes[7]; BLE.emit('battery', bytes[7]); BLE.updateDashboard(); }
    }

    // Veepoo format
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes.length >= 4) {
      const cmd = bytes[2];
      BLE.emit('raw', '[VEEPOO cmd=0x' + cmd.toString(16) + '] ' + hex);
      if (cmd === 0x01) BLE.emit('raw', '[PWD STATUS] ' + bytes[3]);
      if (cmd === 0x04 && bytes[3] <= 100) { BLE.readings.battery = bytes[3]; BLE.emit('battery', bytes[3]); BLE.updateDashboard(); }
      if (cmd === 0x11 && bytes[3] > 30) { BLE.readings.hr = bytes[3]; BLE.emit('hr', bytes[3]); BLE.updateDashboard(); }
    }

    // Scan for any plausible values
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 50 && bytes[i] <= 180) BLE.emit('raw', '[VAL?] [' + i + ']=0x' + bytes[i].toString(16) + '(' + bytes[i] + ') in ' + hex);
    }
  },

  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (r.hr) { set('tile-rhr', r.hr); }
    if (r.spo2) { set('tile-spo2', r.spo2); }
    if (r.battery) { set('ring-batt-pct', r.battery + '%'); }
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
