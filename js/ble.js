/* myDrSage — V80 Ring BLE — Working protocol: FEC7 write → F0080002 response */

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
        if (uuid.includes('f0080003')) BLE.chars.f008tx = char;
        if (uuid.includes('da2e7828')) BLE.chars.smp = char;
      }
    }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);
    await BLE.sleep(300);

    // SMP wake
    await BLE.writeSMP([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xbf, 0xff]);
    await BLE.sleep(800);

    // CONFIRMED WORKING: FEC7 write → F0080002 (0000) response
    // 01 00 00 00 → activity data (steps/calories)
    // Now probe for HR, SpO2, BP, battery

    const probes = [
      // Activity/steps confirmed working
      { b: [0x01, 0x00, 0x00, 0x00], name: 'activity' },
      // Try incrementing second byte
      { b: [0x01, 0x01, 0x00, 0x00], name: 'cmd-0101' },
      { b: [0x01, 0x02, 0x00, 0x00], name: 'cmd-0102' },
      { b: [0x01, 0x03, 0x00, 0x00], name: 'cmd-0103' },
      { b: [0x01, 0x04, 0x00, 0x00], name: 'battery?' },
      { b: [0x01, 0x05, 0x00, 0x00], name: 'cmd-0105' },
      { b: [0x01, 0x06, 0x00, 0x00], name: 'cmd-0106' },
      { b: [0x01, 0x07, 0x00, 0x00], name: 'cmd-0107' },
      { b: [0x01, 0x08, 0x00, 0x00], name: 'cmd-0108' },
      { b: [0x01, 0x09, 0x00, 0x00], name: 'cmd-0109' },
      { b: [0x01, 0x0a, 0x00, 0x00], name: 'cmd-010a' },
      { b: [0x01, 0x0b, 0x00, 0x00], name: 'cmd-010b' },
      { b: [0x01, 0x0c, 0x00, 0x00], name: 'cmd-010c' },
      { b: [0x01, 0x0d, 0x00, 0x00], name: 'cmd-010d' },
      { b: [0x01, 0x0e, 0x00, 0x00], name: 'cmd-010e' },
      { b: [0x01, 0x0f, 0x00, 0x00], name: 'cmd-010f' },
      { b: [0x01, 0x10, 0x00, 0x00], name: 'hr-start?' },
      { b: [0x01, 0x11, 0x00, 0x00], name: 'cmd-0111' },
      { b: [0x01, 0x12, 0x00, 0x00], name: 'spo2?' },
      { b: [0x01, 0x13, 0x00, 0x00], name: 'bp?' },
      { b: [0x01, 0x14, 0x00, 0x00], name: 'temp?' },
      { b: [0x01, 0x15, 0x00, 0x00], name: 'hrv?' },
      { b: [0x01, 0x1a, 0x00, 0x00], name: 'cmd-011a' },
      { b: [0x01, 0x1a, 0x01, 0x00], name: 'echo-fea1' },
      // Try first byte variations
      { b: [0x02, 0x00, 0x00, 0x00], name: 'cmd-0200' },
      { b: [0x03, 0x00, 0x00, 0x00], name: 'cmd-0300' },
      { b: [0x04, 0x00, 0x00, 0x00], name: 'cmd-0400' },
      { b: [0x05, 0x00, 0x00, 0x00], name: 'cmd-0500' },
    ];

    for (const probe of probes) {
      await BLE.writeFEC7(probe.b, probe.name);
      await BLE.sleep(600);
    }

    BLE.emit('raw', '[DONE] Probe complete');
    BLE.startPeriodicRefresh();
    return BLE.device.name;
  },

  async writeFEC7(bytes, name) {
    if (!BLE.chars.fec7) return;
    const hex = bytes.map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('raw', '[→FEC7/' + name + '] ' + hex);
    try {
      // FEC7 is Write (with response) only
      await BLE.chars.fec7.writeValue(new Uint8Array(bytes));
      BLE.emit('raw', '[FEC7 OK]');
    } catch(e) {
      // Try without response as fallback
      try { await BLE.chars.fec7.writeValueWithoutResponse(new Uint8Array(bytes)); }
      catch(e2) { BLE.emit('raw', '[!FEC7] ' + e2.message); }
    }
  },

  async writeSMP(bytes) {
    if (!BLE.chars.smp) return;
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
    BLE._refreshTimer = setInterval(async () => {
      if (!BLE.connected) return;
      // Periodically poll activity + HR
      await BLE.writeFEC7([0x01, 0x00, 0x00, 0x00], 'activity-poll');
      await BLE.sleep(500);
      await BLE.writeFEC7([0x01, 0x10, 0x00, 0x00], 'hr-poll');
      BLE.emit('readings', { ...BLE.readings });
    }, 30000);
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
    console.log('V80 [' + src + ']:', hex);
    BLE.parsePacket(bytes, src, hex);
  },

  parsePacket(bytes, src, hex) {
    if (bytes.length < 4) return;

    // F0080002 (0000) is our confirmed data channel
    if (src === '0000' || src === 'FEA1') {
      // Decode the activity packet we confirmed:
      // a0 00 00 00 4a 01 4a 01 44 0f 00 00 00 00 12 00 00 00 00 00
      // bytes[4,5] = steps little-endian? 4a 01 = 0x014a = 330
      // bytes[6,7] = ? 4a 01 = 330 again
      // bytes[8,9] = 44 0f = 0x0f44 = 3908? or calories*10?
      // bytes[14] = 0x12 = 18

      if (bytes[0] === 0xa0) {
        // Activity packet
        const steps = (bytes[5] << 8) | bytes[4];
        const cal10 = (bytes[9] << 8) | bytes[8];
        const val14 = bytes[14];
        BLE.emit('raw', '[ACTIVITY] steps=' + steps + ' cal/10=' + cal10 + ' b14=' + val14);
        BLE.readings.steps = steps;
        BLE.emit('steps', steps);
        BLE.updateDashboard();
      } else {
        // Unknown packet — log all byte values looking for health data
        BLE.emit('raw', '[PKT ' + src + '] hdr=0x' + bytes[0].toString(16) + ' len=' + bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          const v = bytes[i];
          if (v > 0 && v <= 100 && i > 0) BLE.emit('raw', '  [' + i + ']=0x' + v.toString(16) + '(' + v + ')' + (v >= 50 && v <= 100 ? ' ← spo2?' : '') + (v >= 40 && v < 50 ? ' ← batt?' : ''));
          if (v > 50 && v < 200 && i > 0) BLE.emit('raw', '  [' + i + ']=0x' + v.toString(16) + '(' + v + ')' + (v >= 60 && v <= 120 ? ' ← hr?' : ''));
        }
      }
    }
  },

  updateDashboard() {
    const r = BLE.readings;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (r.hr != null) { set('tile-rhr', r.hr); set('tile-rhr-status', r.hr < 80 ? 'Normal' : 'Elevated'); }
    if (r.spo2 != null) { set('tile-spo2', r.spo2); }
    if (r.bp_sys != null) { set('tile-bp-s', r.bp_sys); set('tile-bp-d', '/' + r.bp_dia); }
    if (r.battery != null) { set('ring-batt-pct', r.battery + '%'); }
    if (r.steps != null) { const el = document.getElementById('tile-steps'); if (el) el.textContent = r.steps; }
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
