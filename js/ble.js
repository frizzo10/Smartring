/* myDrSage — V80 Ring BLE — Full Discovery + Multi-channel Bind */

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

    // Discover ALL services and subscribe to everything
    const services = await BLE.server.getPrimaryServices();
    BLE.emit('raw', '[SERVICES] ' + services.length + ' found');

    for (const svc of services) {
      BLE.emit('raw', '[SVC] ' + svc.uuid);
      try {
        const chars = await svc.getCharacteristics();
        for (const char of chars) {
          const props = [];
          if (char.properties.read) props.push('R');
          if (char.properties.write) props.push('W');
          if (char.properties.writeWithoutResponse) props.push('WoR');
          if (char.properties.notify) props.push('N');
          if (char.properties.indicate) props.push('I');
          BLE.emit('raw', '  [CHAR] ' + char.uuid.slice(-4).toUpperCase() + ' [' + props.join(',') + ']');

          // Subscribe to all notifiable chars
          if (char.properties.notify || char.properties.indicate) {
            try {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', BLE.onData);
              BLE.emit('raw', '  → Subscribed ✓');
            } catch(e) { BLE.emit('raw', '  → Sub fail: ' + e.message); }
          }

          // Save writable chars by UUID
          const uuid = char.uuid.toLowerCase();
          if (uuid.includes('fea2')) BLE.chars.fea2 = char;
          if (uuid.includes('fec7')) BLE.chars.fec7 = char;
          if (uuid.includes('f0080003')) BLE.chars.f008tx = char;
          if (uuid.includes('f0020003')) BLE.chars.f002tx = char;
          if (uuid.includes('da2e7828')) BLE.chars.smp = char;
        }
      } catch(e) { BLE.emit('raw', '  [ERR] ' + e.message); }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Try bind on ALL write channels
    await BLE.sleep(500);
    await BLE.tryAllBinds();
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  async tryAllBinds() {
    // Veepoo password = 000000 in ASCII = 30 30 30 30 30 30
    const pwd = [0x30,0x30,0x30,0x30,0x30,0x30];

    const formats = [
      // Format 1: Veepoo standard
      [0x00, 0x00, 0x01, 0x01, ...pwd],
      // Format 2: Short Veepoo
      [0x01, 0x01, ...pwd],
      // Format 3: HBand style
      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00],
      // Format 4: Just password
      [...pwd],
      // Format 5: Single byte ping
      [0x01],
      [0x00],
    ];

    const channels = [
      { char: BLE.chars.fea2,  name: 'FEA2' },
      { char: BLE.chars.fec7,  name: 'FEC7' },
      { char: BLE.chars.f008tx, name: 'F0080003' },
      { char: BLE.chars.f002tx, name: 'F0020003' },
      { char: BLE.chars.smp,   name: 'SMP' },
    ];

    for (const ch of channels) {
      if (!ch.char) continue;
      BLE.emit('raw', '[BIND] Trying ' + ch.name + '...');
      for (const fmt of formats) {
        const hex = fmt.map(b => b.toString(16).padStart(2,'0')).join(' ');
        BLE.emit('raw', '[→' + ch.name + '] ' + hex);
        try {
          if (ch.char.properties.writeWithoutResponse) {
            await ch.char.writeValueWithoutResponse(new Uint8Array(fmt));
          } else {
            await ch.char.writeValue(new Uint8Array(fmt));
          }
        } catch(e) { BLE.emit('raw', '[!] ' + e.message); }
        await BLE.sleep(800);
      }
    }
    BLE.emit('raw', '[BIND] All formats tried — watching for responses...');
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
    console.log('V80:', hex);
    BLE.parsePacket(bytes, src);
  },

  parsePacket(bytes, src) {
    if (bytes.length < 1) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[PARSE ' + src + '] len=' + bytes.length + ' | ' + hex);

    // Look for any plausible HR value
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] > 40 && bytes[i] < 200) {
        BLE.emit('raw', '[HR?] byte[' + i + ']=' + bytes[i] + ' in: ' + hex);
      }
    }

    // Try Veepoo format
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes.length >= 4) {
      const cmd = bytes[2];
      if (cmd === 0x01) BLE.emit('raw', '[PWD] Status=' + bytes[3]);
      if (cmd === 0x04 && bytes[3] <= 100) { BLE.readings.battery = bytes[3]; BLE.emit('battery', bytes[3]); BLE.updateDashboard(); }
      if (cmd === 0x11 && bytes[3] > 30) { BLE.readings.hr = bytes[3]; BLE.emit('hr', bytes[3]); BLE.updateDashboard(); }
      if (cmd === 0x12 && bytes[3] >= 70) { BLE.readings.spo2 = bytes[3]; BLE.emit('spo2', bytes[3]); BLE.updateDashboard(); }
      if (cmd === 0x13 && bytes.length >= 5) { BLE.readings.bp_sys = bytes[3]; BLE.readings.bp_dia = bytes[4]; BLE.updateDashboard(); }
    }

    // Try HBand format
    if (bytes[0] === 0xAB && bytes.length >= 8) {
      const cmd = (bytes[4] << 8) | bytes[5];
      BLE.emit('raw', '[HBAND] cmd=0x' + cmd.toString(16));
      if (cmd === 0x8480 && bytes[7] > 30) { BLE.readings.hr = bytes[7]; BLE.emit('hr', bytes[7]); BLE.updateDashboard(); }
      if (cmd === 0x8580 && bytes[7] >= 70) { BLE.readings.spo2 = bytes[7]; BLE.emit('spo2', bytes[7]); BLE.updateDashboard(); }
    }
  },

  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (r.hr) { set('tile-rhr', r.hr); set('tile-rhr-status', r.hr < 80 ? 'Normal' : 'Elevated'); }
    if (r.spo2) { set('tile-spo2', r.spo2); }
    if (r.bp_sys) { set('tile-bp-s', r.bp_sys); set('tile-bp-d', '/' + r.bp_dia); }
    if (r.battery) {
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
