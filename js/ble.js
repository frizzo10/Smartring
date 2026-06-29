/* myDrSage — V80 — Listen mode: subscribe then wait for ring to push data */

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

    // Subscribe to everything
    const services = await BLE.server.getPrimaryServices();
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const char of chars) {
        const uuid = char.uuid.toLowerCase();
        if (char.properties.notify || char.properties.indicate) {
          try {
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', BLE.onData);
            BLE.emit('raw', '[SUB] ' + char.uuid.slice(-4).toUpperCase());
          } catch(e) {}
        }
        if (uuid.includes('fec7')) BLE.chars.fec7 = char;
        if (uuid.includes('da2e7828')) BLE.chars.smp = char;
        if (uuid.includes('f0080003')) BLE.chars.f008tx = char;
      }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    // Just wait 3 seconds — does ring push anything automatically?
    BLE.emit('raw', '[WAIT] Listening for auto-push data...');
    await BLE.sleep(3000);
    BLE.emit('raw', '[WAIT] 3s done');

    // Now try SMP wake only — no other commands
    BLE.emit('raw', '[SMP] Wake...');
    if (BLE.chars.smp) {
      try {
        await BLE.chars.smp.writeValueWithoutResponse(new Uint8Array([0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0xbf,0xff]));
        BLE.emit('raw', '[SMP] ✓');
      } catch(e) { BLE.emit('raw', '[SMP ERR] ' + e.message); }
    }
    await BLE.sleep(2000);
    BLE.emit('raw', '[WAIT] Post-SMP 2s done');

    // Now try just ONE thing on FEC7 — the status request
    BLE.emit('raw', '[FEC7] status request...');
    if (BLE.chars.fec7) {
      try {
        await BLE.chars.fec7.writeValue(new Uint8Array([0x01, 0x00, 0x00, 0x00]));
        BLE.emit('raw', '[FEC7] ✓');
      } catch(e) { BLE.emit('raw', '[FEC7 ERR] ' + e.message); }
    }
    await BLE.sleep(2000);
    BLE.emit('raw', '[DONE] All done — watching...');

    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  startPeriodicRefresh() {
    BLE._refreshTimer = setInterval(async () => {
      if (!BLE.connected) return;
      BLE.emit('raw', '[POLL] polling...');
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

    // FEA1 connection status
    if (src === 'FEA1') {
      BLE.emit('raw', '[FEA1] ' + hex);
    }

    // Activity packet: hdr=a0
    if (bytes[0] === 0xa0 && bytes.length >= 10) {
      const batt  = bytes[4];
      const steps = (bytes[6] << 8) | bytes[5];
      const cal   = ((bytes[9] << 8) | bytes[8]) / 10;
      BLE.emit('raw', '[ACTIVITY] batt=' + batt + '% steps=' + steps + ' cal=' + cal);
      BLE.readings.battery = batt;
      BLE.readings.steps   = steps;
      BLE.emit('battery', batt);
      BLE.emit('steps', steps);
      BLE.updateDashboard();
    }

    // Non-zero non-all-zeros response — log everything
    if (bytes.some(b => b !== 0) && bytes[0] !== 0x01) {
      BLE.emit('raw', '[DATA ' + src + '] ' + hex);
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
      const h = Math.round((r.battery / 100) * 96);
      const proj = Math.floor(h/24) > 0 ? Math.floor(h/24) + 'd ' + (h%24) + 'h remaining' : h + 'h remaining';
      set('ring-batt-projection', proj);
      const bt = document.getElementById('ble-status-text');
      if (bt) bt.textContent = 'V80 connected · ' + r.battery + '% · ' + proj;
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
