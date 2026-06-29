/* myDrSage — V80 Ring BLE — Service Discovery Mode */

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
        '0000f003-0000-1000-8000-00805f9b34fb',
        '0000f031-0000-1000-8000-00805f9b34fb',
        '8d53dc1d-1db7-4cd3-868b-8a527a2ada5c'
      ]
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);
    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();
    BLE.emit('raw', '[CONNECTED] Device: ' + BLE.device.name);

    // Discover ALL services
    try {
      const services = await BLE.server.getPrimaryServices();
      BLE.emit('raw', '[SERVICES] Found ' + services.length + ' services:');
      
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
            BLE.emit('raw', '  [CHAR] ' + char.uuid + ' [' + props.join(',') + ']');

            // Subscribe to all notify/indicate characteristics
            if (char.properties.notify || char.properties.indicate) {
              try {
                await char.startNotifications();
                char.addEventListener('characteristicvaluechanged', BLE.onData);
                BLE.emit('raw', '  → Subscribed');
                // Save first writable notify char as tx
                if (!BLE.chars.rx) BLE.chars.rx = char;
              } catch(e) {
                BLE.emit('raw', '  → Subscribe failed: ' + e.message);
              }
            }

            // Save first writable char as tx
            if ((char.properties.write || char.properties.writeWithoutResponse) && !BLE.chars.tx) {
              BLE.chars.tx = char;
              BLE.emit('raw', '  → Saved as TX');
            }
          }
        } catch(e) {
          BLE.emit('raw', '  [CHARS] Error: ' + e.message);
        }
      }
    } catch(e) {
      BLE.emit('raw', '[SERVICES] Discovery failed: ' + e.message);
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Try sending bind with default password on whatever TX we found
    await BLE.sleep(500);
    if (BLE.chars.tx) {
      BLE.emit('raw', '[BIND] Trying password 000000...');
      const pwd = '000000'.split('').map(c => c.charCodeAt(0));
      await BLE.write([0x00, 0x00, 0x01, 0x01, ...pwd]);
      await BLE.sleep(300);
      await BLE.write([0x01, 0x01, ...pwd]);
    } else {
      BLE.emit('raw', '[BIND] No TX characteristic found');
    }

    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

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
    console.log('V80 data:', hex);
    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 2) return;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[PARSE] ' + hex);

    // Try all known patterns
    const b = bytes;
    // Check for HR-like values
    for (let i = 0; i < b.length; i++) {
      if (b[i] > 40 && b[i] < 200) {
        BLE.emit('raw', '[HR?] byte[' + i + ']=' + b[i]);
      }
    }

    // Standard patterns
    if (b[0] === 0x00 && b[1] === 0x00 && b.length >= 4) {
      const cmd = b[2];
      BLE.emit('raw', '[CMD] 0x' + cmd.toString(16));
      if (cmd === 0x04 && b[3] <= 100) { BLE.readings.battery = b[3]; BLE.emit('battery', b[3]); BLE.updateDashboard(); }
      if (cmd === 0x11 && b[3] > 30 && b[3] < 220) { BLE.readings.hr = b[3]; BLE.emit('hr', b[3]); BLE.updateDashboard(); }
      if (cmd === 0x12 && b[3] >= 70) { BLE.readings.spo2 = b[3]; BLE.emit('spo2', b[3]); BLE.updateDashboard(); }
      if (cmd === 0x13 && b.length >= 5) { BLE.readings.bp_sys = b[3]; BLE.readings.bp_dia = b[4]; BLE.emit('bp', {sys:b[3],dia:b[4]}); BLE.updateDashboard(); }
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
