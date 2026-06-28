/* ─────────────────────────────────────────────────────────
   myDrSage — V80 Ring BLE Connection (Web Bluetooth API)
   Works in: Bluefy iOS, Chrome desktop/Android
   
   V80 GATT Map (confirmed via nRF Connect):
   Service:  FEE7
   FEC7    → Write (commands to ring)
   FEC8    → Indicate (ring confirms commands)
   FEC9    → Read (device info)
   FEA1    → Read + Notify (sensor data stream)
   FEA2    → Read + Write + Indicate (bidirectional)
   ───────────────────────────────────────────────────────── */

const BLE = {
  // UUIDs
  SERVICE:   'fee7',
  CMD_WRITE: 'fec7',   // Write commands here
  CMD_RESP:  'fec8',   // Ring responds here (Indicate)
  DEV_INFO:  'fec9',   // Device info (Read)
  DATA_OUT:  'fea1',   // Sensor data stream (Notify)
  DATA_BIDIR:'fea2',   // Bidirectional (Read/Write/Indicate)

  // HBand command bytes (standard HBand SDK protocol)
  CMD: {
    GET_BATTERY:    [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00],
    GET_STEPS:      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x03, 0x00],
    START_HR:       [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x01, 0x00],
    STOP_HR:        [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x00, 0x00],
    START_SPO2:     [0xAB, 0x00, 0x04, 0xFF, 0x85, 0x80, 0x01, 0x00],
    STOP_SPO2:      [0xAB, 0x00, 0x04, 0xFF, 0x85, 0x80, 0x00, 0x00],
    START_BP:       [0xAB, 0x00, 0x04, 0xFF, 0x86, 0x80, 0x01, 0x00],
    STOP_BP:        [0xAB, 0x00, 0x04, 0xFF, 0x86, 0x80, 0x00, 0x00],
    START_TEMP:     [0xAB, 0x00, 0x04, 0xFF, 0x87, 0x80, 0x01, 0x00],
    STOP_TEMP:      [0xAB, 0x00, 0x04, 0xFF, 0x87, 0x80, 0x00, 0x00],
    GET_SLEEP:      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x1A, 0x00],
    SYNC_HISTORY:   [0xAB, 0x00, 0x04, 0xFF, 0x52, 0x80, 0x00, 0x00],
  },

  // State
  device: null,
  server: null,
  service: null,
  chars: {},
  connected: false,
  listeners: {},
  rawBuffer: [],

  // Live readings
  readings: {
    hr: null, spo2: null, bp_sys: null, bp_dia: null,
    temp_c: null, steps: null, battery: null,
    hrv: null, glucose_mgdl: null, glucose_mmol: null, stress: null, stress_label: null, timestamp: null
  },

  // ── CONNECT ─────────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported. Please use Bluefy browser.');
    }

    BLE.emit('status', 'scanning');
    BLE.device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'V80' },
        { services: ['fee7'] }
      ],
      optionalServices: ['fee7', 'fec7', 'fec8', 'fec9', 'fea1', 'fea2',
                         '0000fee7-0000-1000-8000-00805f9b34fb']
    });

    BLE.device.addEventListener('gattserverdisconnected', BLE.onDisconnected);

    BLE.emit('status', 'connecting');
    BLE.server = await BLE.device.gatt.connect();
    BLE.service = await BLE.server.getPrimaryService('fee7');

    // Get all characteristics
    BLE.chars.write    = await BLE.service.getCharacteristic('fec7');
    BLE.chars.indicate = await BLE.service.getCharacteristic('fec8');
    BLE.chars.devinfo  = await BLE.service.getCharacteristic('fec9');
    BLE.chars.notify   = await BLE.service.getCharacteristic('fea1');
    BLE.chars.bidir    = await BLE.service.getCharacteristic('fea2');

    // Subscribe to data stream (FEA1 - Notify)
    await BLE.chars.notify.startNotifications();
    BLE.chars.notify.addEventListener('characteristicvaluechanged', BLE.onData);

    // Subscribe to command responses (FEC8 - Indicate)
    await BLE.chars.indicate.startNotifications();
    BLE.chars.indicate.addEventListener('characteristicvaluechanged', BLE.onResponse);

    // Subscribe to bidirectional channel (FEA2 - Indicate)
    try {
      await BLE.chars.bidir.startNotifications();
      BLE.chars.bidir.addEventListener('characteristicvaluechanged', BLE.onData);
    } catch(e) { console.log('FEA2 subscribe:', e.message); }

    BLE.connected = true;
    BLE.emit('status', 'connected');
    BLE.emit('connected', BLE.device.name);

    BLE.startPeriodicRefresh();
    // BRUTE FORCE PROBE: try common packet formats to find what the ring responds to
    console.log('V80 brute force probe starting...');
    BLE.bruteProbe();

    return BLE.device.name;
  },

  // ── DISCONNECT ───────────────────────────────────────────
  async disconnect() {
    BLE.stopPeriodicRefresh();
    await BLE.stopAllMeasurements();
    if (BLE.device && BLE.device.gatt.connected) {
      BLE.device.gatt.disconnect();
    }
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
  },

  onDisconnected() {
    BLE.connected = false;
    BLE.emit('status', 'disconnected');
    // Auto-reconnect after 3 seconds
    setTimeout(() => {
      if (!BLE.connected) BLE.emit('status', 'reconnecting');
    }, 3000);
  },

  // ── SEND COMMAND ─────────────────────────────────────────
  async sendCmd(bytes) {
    const data = new Uint8Array(bytes);
    // Try FEC7 (primary write channel)
    if (BLE.chars.write) {
      try {
        await BLE.chars.write.writeValueWithoutResponse(data);
      } catch(e) {
        console.log('FEC7 write error:', e.message);
      }
    }
    // Also try FEA2 (bidirectional) if FEC7 fails to get response
    if (BLE.chars.bidir) {
      try {
        await BLE.chars.bidir.writeValueWithoutResponse(data);
      } catch(e) {
        // FEA2 write failed — that's ok, FEC7 may have worked
      }
    }
  },

  // ── START / STOP MEASUREMENTS ────────────────────────────
  async startAllMeasurements() {
    await BLE.sendCmd(BLE.CMD.START_HR);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_SPO2);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_BP);
    await BLE.sleep(200);
    await BLE.sendCmd(BLE.CMD.START_TEMP);
  },

  async syncDayHistory() {
    await BLE.sendCmd(BLE.CMD.SYNC_HISTORY);
    await BLE.sleep(300);
    await BLE.sendCmd([0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x04, 0x00]); // HR history
    await BLE.sleep(300);
    await BLE.sendCmd([0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x05, 0x00]); // BP history
    await BLE.sleep(300);
    await BLE.sendCmd([0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x06, 0x00]); // SpO2 history
  },

  startPeriodicRefresh() {
    // LISTEN-ONLY MODE: just emit a heartbeat so the app knows we're still connected
    BLE._refreshTimer = setInterval(async () => {
      if (!BLE.connected) return;
      console.log('V80 still connected, listening...');
      BLE.emit('readings', { ...BLE.readings });
    }, 120000); // every 2 minutes
  },

  stopPeriodicRefresh() {
    if (BLE._refreshTimer) { clearInterval(BLE._refreshTimer); BLE._refreshTimer = null; }
  },

  async stopAllMeasurements() {
    await BLE.sendCmd(BLE.CMD.STOP_HR);
    await BLE.sendCmd(BLE.CMD.STOP_SPO2);
    await BLE.sendCmd(BLE.CMD.STOP_BP);
    await BLE.sendCmd(BLE.CMD.STOP_TEMP);
  },

  // ── PARSE INCOMING DATA ──────────────────────────────────
  onData(event) {
    const val = event.target.value;
    const bytes = new Uint8Array(val.buffer);
    BLE.rawBuffer.push(bytes);

    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const src = event.target.uuid?.slice(-4).toUpperCase() || 'UNK';
    BLE.emit('raw', '[' + src + '] ' + hex);
    console.log('V80 data [' + src + ']:', hex);

    BLE.parsePacket(bytes);
  },

  onResponse(event) {
    const val = event.target.value;
    const bytes = new Uint8Array(val.buffer);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
    BLE.emit('response', hex);
    BLE.parsePacket(bytes);
  },

  parsePacket(bytes) {
    if (bytes.length < 4) return;

    // HBand packet header: AB 00 [len] FF [cmd_hi] [cmd_lo] [data...]
    if (bytes[0] !== 0xAB) return;

    const cmdHi = bytes[4];
    const cmdLo = bytes[5];
    const cmd = (cmdHi << 8) | cmdLo;

    switch(cmd) {
      // Heart rate
      case 0x8480:
      case 0x0480:
        if (bytes.length >= 8) {
          const hr = bytes[7];
          if (hr > 30 && hr < 220) {
            BLE.readings.hr = hr;
            BLE.readings.timestamp = Date.now();
            BLE.emit('hr', hr);
            BLE.updateDashboard();
          }
        }
        break;

      // SpO2
      case 0x8580:
      case 0x0580:
        if (bytes.length >= 8) {
          const spo2 = bytes[7];
          if (spo2 >= 70 && spo2 <= 100) {
            BLE.readings.spo2 = spo2;
            BLE.emit('spo2', spo2);
            BLE.updateDashboard();
          }
        }
        break;

      // Blood pressure
      case 0x8680:
      case 0x0680:
        if (bytes.length >= 9) {
          const sys = bytes[7];
          const dia = bytes[8];
          if (sys > 60 && sys < 220 && dia > 40 && dia < 140) {
            BLE.readings.bp_sys = sys;
            BLE.readings.bp_dia = dia;
            BLE.emit('bp', { sys, dia });
            BLE.updateDashboard();
          }
        }
        break;

      // Temperature
      case 0x8780:
      case 0x0780:
        if (bytes.length >= 9) {
          const tempRaw = (bytes[7] << 8) | bytes[8];
          const temp_c = tempRaw / 100;
          if (temp_c > 30 && temp_c < 43) {
            BLE.readings.temp_c = temp_c;
            const temp_f = (temp_c * 9/5) + 32;
            BLE.emit('temp', { c: temp_c, f: temp_f });
            BLE.updateDashboard();
          }
        }
        break;

      // Battery
      case 0x5180:
        if (bytes.length >= 8 && bytes[6] === 0x01) {
          const battery = bytes[7];
          BLE.readings.battery = battery;
          BLE.emit('battery', battery);
        }
        break;

      // Steps
      case 0x5180 + 0x02:
        if (bytes.length >= 10) {
          const steps = (bytes[7] << 24) | (bytes[8] << 16) | (bytes[9] << 8) | bytes[10];
          BLE.readings.steps = steps;
          BLE.emit('steps', steps);
        }
        break;

      // Blood Glucose (mmol/L → convert to mg/dL for US display)
      case 0x8880:
      case 0x0880:
        if (bytes.length >= 9) {
          const rawMmol = ((bytes[7] << 8) | bytes[8]) / 100;
          if (rawMmol > 1 && rawMmol < 30) {
            const mgdl = Math.round(rawMmol * 18.0182);
            BLE.readings.glucose_mgdl = mgdl;
            BLE.readings.glucose_mmol = rawMmol;
            BLE.emit('glucose', { mgdl, mmol: rawMmol });
            BLE.updateDashboard();
          }
        }
        break;

      // Stress / EDA
      case 0x8980:
      case 0x0980:
        if (bytes.length >= 8) {
          const stress = bytes[7];
          const stressLabel = stress < 30 ? 'Relaxed' : stress < 60 ? 'Normal' : stress < 80 ? 'Elevated' : 'High';
          BLE.readings.stress = stress;
          BLE.readings.stress_label = stressLabel;
          BLE.emit('stress', { value: stress, label: stressLabel });
          BLE.updateDashboard();
        }
        break;

      // HRV
      case 0x8A80:
      case 0x0A80:
        if (bytes.length >= 9) {
          const hrv = (bytes[7] << 8) | bytes[8];
          if (hrv > 10 && hrv < 200) {
            BLE.readings.hrv = hrv;
            BLE.emit('hrv', hrv);
            BLE.updateDashboard();
          }
        }
        break;
    }
  },

  // ── UPDATE DASHBOARD ─────────────────────────────────────
  updateDashboard() {
    const r = BLE.readings;

    // Update metric tiles
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
    if (r.temp_c) {
      const temp_f = (r.temp_c * 9/5) + 32;
      const el = document.getElementById('tile-temp');
      if (el) el.textContent = '+' + (temp_f - 98.6).toFixed(1);
    }

    // Glucose tile
    if (r.glucose_mgdl) {
      const gEl = document.getElementById('tile-glucose');
      if (gEl) gEl.textContent = r.glucose_mgdl;
      const gSt = document.getElementById('tile-glucose-status');
      if (gSt) {
        const status = r.glucose_mgdl < 100 ? 'Normal' : r.glucose_mgdl < 126 ? 'Pre-range' : 'Elevated';
        const cls = r.glucose_mgdl < 100 ? 'normal' : 'watch';
        gSt.textContent = status;
        gSt.className = 'mt-status ' + cls;
      }
    }

    // Stress tile
    if (r.stress !== null) {
      const sEl = document.getElementById('tile-stress');
      if (sEl) sEl.textContent = r.stress;
      const sSt = document.getElementById('tile-stress-status');
      if (sSt) {
        sSt.textContent = r.stress_label || 'Normal';
        sSt.className = 'mt-status ' + (r.stress < 60 ? 'normal' : 'watch');
      }
    }

    // Show ring online dot
    const dot = document.getElementById('ring-online-dot');
    if (dot) dot.style.display = 'block';

    // Update ring status in profile
    const rs = document.getElementById('ring-status-text');
    if (rs) rs.textContent = 'Connected · live data';
    const model = document.getElementById('ring-model-name');
    if (model) model.textContent = 'V80 Smart Ring';
    if (r.battery) {
      // Battery percentage
      const batt = document.getElementById('ring-batt-pct');
      if (batt) batt.textContent = r.battery + '%';
      const battBar = document.getElementById('ring-batt-bar');
      if (battBar) {
        battBar.style.width = r.battery + '%';
        battBar.style.background = r.battery > 40 ? 'var(--normal)' : r.battery > 20 ? 'var(--watch)' : 'var(--urgent)';
      }

      // Project hours remaining — V80 rated 4 days = 96h at full charge
      const hoursLeft = Math.round((r.battery / 100) * 96);
      const daysLeft  = Math.floor(hoursLeft / 24);
      const hrsLeft   = hoursLeft % 24;
      const projection = daysLeft > 0
        ? daysLeft + 'd ' + hrsLeft + 'h remaining'
        : hoursLeft + 'h remaining';

      const battProj = document.getElementById('ring-batt-projection');
      if (battProj) battProj.textContent = projection;

      // Also show in connect bar
      const bleText = document.getElementById('ble-status-text');
      if (bleText && BLE.connected) {
        bleText.textContent = 'V80 connected · ' + r.battery + '% · ' + projection;
      }
    }

    // Emit combined reading for signal engine
    BLE.emit('readings', { ...r });
  },

  // ── EVENT EMITTER ────────────────────────────────────────
  on(event, fn) {
    if (!BLE.listeners[event]) BLE.listeners[event] = [];
    BLE.listeners[event].push(fn);
  },
  emit(event, data) {
    (BLE.listeners[event] || []).forEach(fn => fn(data));
  },
  off(event, fn) {
    if (!BLE.listeners[event]) return;
    BLE.listeners[event] = BLE.listeners[event].filter(f => f !== fn);
  },

  // ── BRUTE FORCE PROBE ────────────────────────────────────
  // Try known Chinese smart ring packet formats one by one.
  // Listen for any response after each — first response tells us the protocol.
  async bruteProbe() {
    const probes = [
      // Format 1: SmartHealth / Yucheng — 0xAB header, 8 bytes
      [0xAB, 0x00, 0x04, 0xFF, 0x51, 0x80, 0x01, 0x00],  // battery
      [0xAB, 0x00, 0x04, 0xFF, 0x84, 0x80, 0x01, 0x00],  // HR
      // Format 2: 0xCD header
      [0xCD, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      [0xCD, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // Format 3: 16-byte 0xFC header (R9/soumya style)
      [0xFC,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
      [0xFC,0x0F,0x05,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
      [0xFC,0x0A,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
      // Format 4: 0xAA header
      [0xAA, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xAA],
      [0xAA, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xAA],
      // Format 5: 0xFF header
      [0xFF, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // Format 6: single byte probes
      [0x01], [0x02], [0x10], [0x15], [0x20], [0x51], [0x84], [0xA0],
    ];

    for (const probe of probes) {
      if (!BLE.connected) break;
      const hex = probe.map(b => b.toString(16).padStart(2,'0')).join(' ');
      BLE.emit('raw', '[PROBE→] ' + hex);
      try {
        await BLE.chars.write.writeValueWithoutResponse(new Uint8Array(probe));
      } catch(e) { /* ignore */ }
      await BLE.sleep(800); // wait 800ms for response
    }
    BLE.emit('raw', '[PROBE] Done. Check above for any ← responses.');
  },

  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

// Export globally
window.BLE = BLE;
