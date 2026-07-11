/* ─────────────────────────────────────────────────────────
   Ring Data Explorer controller

   Purely a diagnostics tool: connect once, tap Read on any card,
   see the raw parsed result. Reuses ColmiBLE as-is — no new
   protocol logic lives here, just wiring + display.
   ───────────────────────────────────────────────────────── */

const RingData = {
  // Persists real ring readings so the main Dr. Sage chat (app.js
  // sendChat()) can use them instead of — or alongside — SimRing's
  // fabricated data. Merges rather than overwrites, since HR, SpO2,
  // HR log, and steps arrive from separate events at separate times.
  saveSnapshot(partial) {
    try {
      const existing = JSON.parse(localStorage.getItem('sh_ring_latest') || '{}');
      const merged = { ...existing, ...partial, updatedAt: new Date().toISOString() };
      localStorage.setItem('sh_ring_latest', JSON.stringify(merged));
    } catch (e) { /* localStorage unavailable — fail silently, this is a bonus, not critical path */ }
  },

  // Maps each card's data-cmd to a real-time READING_* kind, for the
  // cards that go through the generic streamReading() path.
  REALTIME_KINDS: {
    hr: 'READING_HEART_RATE',
    spo2: 'READING_SPO2',
    bp: 'READING_BLOOD_PRESSURE',
    ecg: 'READING_ECG',
    hrv: 'READING_HRV',
    bloodsugar: 'READING_BLOOD_SUGAR',
    fatigue: 'READING_FATIGUE',
    healthcheck: 'READING_HEALTH_CHECK',
  },

  setStatus(msg) {
    document.getElementById('status-line').textContent = msg;
  },

  showResult(cardId, text) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const result = card.querySelector('.result');
    result.textContent = text;
    result.classList.add('visible');
  },

  setButtonBusy(cardId, busy, label) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const btn = card.querySelector('.read-btn');
    if (!btn) return;
    if (busy) {
      btn.dataset.origLabel = btn.textContent;
      btn.textContent = label || 'Reading...';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.origLabel || 'Read';
      btn.disabled = false;
    }
  },

  enableAllButtons() {
    document.querySelectorAll('.read-btn[data-cmd]').forEach(btn => { btn.disabled = false; });
  },

  async connect() {
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    const BLE = window.ColmiBLE;

    BLE.on('status', s => {
      RingData.setStatus('[status] ' + s);
      if (s === 'connected') {
        disconnectBtn.style.display = 'block';
        connectBtn.textContent = 'Connected';
        RingData.enableAllButtons();
      }
      if (s === 'disconnected') {
        disconnectBtn.style.display = 'none';
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Colmi R02';
      }
    });

    BLE.on('battery', b => {
      RingData.showResult('card-battery', `${b.level}%${b.charging ? ' (charging)' : ''}`);
      RingData.setButtonBusy('card-battery', false);
      RingData.saveSnapshot({ battery: b.level });
    });

    BLE.on('reading', r => {
      const cardId = RingData.cardIdForKind(r.kind);
      if (!cardId) return;
      const rawNote = r.rawSample ? `\nraw@6-7: ${r.rawSampleHex}` : '';
      RingData.showResult(cardId, `value: ${r.value}${rawNote}`);
      // Live spot-check readings are NOT saved into the Dr. Sage snapshot
      // — a single point-in-time value isn't representative history.
      // Only the ring's own logged data (heartRateLog, steps) feeds the
      // AI interpretation; this page is diagnostics-only for the rest.
    });

    BLE.on('readingError', e => {
      const cardId = RingData.cardIdForKind(e.kind);
      if (!cardId) return;
      RingData.showResult(cardId, `error code: ${e.code}`);
      RingData.setButtonBusy(cardId, false);
    });

    BLE.on('heartRateLog', log => {
      const nonZero = log.heartRates.filter(v => v > 0);
      const summary = nonZero.length
        ? `${nonZero.length} samples, range ${Math.min(...nonZero)}-${Math.max(...nonZero)} bpm\ntimestamp: ${log.timestamp?.toLocaleString() || 'n/a'}\nlog interval: ${log.range} min`
        : 'no nonzero samples yet today';
      RingData.showResult('card-hrlog', summary);
      RingData.setButtonBusy('card-hrlog', false);
      if (nonZero.length) {
        RingData.saveSnapshot({
          hrLog: {
            count: nonZero.length,
            min: Math.min(...nonZero),
            max: Math.max(...nonZero),
            avg: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length),
            date: log.timestamp ? log.timestamp.toISOString() : null,
          },
        });
      }
    });
    BLE.on('heartRateLogError', () => {
      RingData.showResult('card-hrlog', 'error response from ring');
      RingData.setButtonBusy('card-hrlog', false);
    });

    BLE.on('steps', entries => {
      if (!entries.length) {
        RingData.showResult('card-steps', 'no entries returned');
      } else {
        const totalSteps = entries.reduce((sum, e) => sum + e.steps, 0);
        const totalCal = entries.reduce((sum, e) => sum + e.calories, 0);
        const totalDist = entries.reduce((sum, e) => sum + e.distance, 0);
        const last = entries[entries.length - 1];
        RingData.showResult('card-steps',
          `${entries.length} time-slot entries for ${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}\n`
          + `total steps: ${totalSteps}\ntotal calories: ${totalCal}\ntotal distance: ${totalDist}m`);
        RingData.saveSnapshot({ steps: { total: totalSteps, calories: totalCal, distance: totalDist, date: `${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}` } });
      }
      RingData.setButtonBusy('card-steps', false);
    });
    BLE.on('stepsNoData', () => {
      RingData.showResult('card-steps', 'no step data for this day');
      RingData.setButtonBusy('card-steps', false);
    });

    BLE.on('spo2Log', log => {
      if (!log.days.length) {
        RingData.showResult('card-spo2log', 'no days returned');
      } else {
        const lines = log.days.map(d => {
          const readings = d.hourly.filter(h => h.max > 0);
          if (!readings.length) return `${d.daysPrevious === 0 ? 'today' : d.daysPrevious + 'd ago'}: no readings`;
          const vals = readings.flatMap(h => [h.max, h.min]);
          return `${d.daysPrevious === 0 ? 'today' : d.daysPrevious + 'd ago'}: ${readings.length} hourly slots, range ${Math.min(...vals)}-${Math.max(...vals)}%`;
        });
        RingData.showResult('card-spo2log', lines.join('\n'));
      }
      RingData.setButtonBusy('card-spo2log', false);
    });

    BLE.on('sleepLog', log => {
      if (!log.periods.length) {
        RingData.showResult('card-sleep', 'no sleep periods returned');
      } else {
        const lines = log.periods.map(p => {
          const startH = Math.floor(p.startMins / 60), startM = p.startMins % 60;
          const endH = Math.floor(p.endMins / 60), endM = p.endMins % 60;
          const totalMin = p.phases.reduce((sum, ph) => sum + ph.durationMin, 0);
          const phaseCounts = {};
          p.phases.forEach(ph => {
            const name = BLE.SLEEP_TYPE_NAMES[ph.type] || 'type' + ph.type;
            phaseCounts[name] = (phaseCounts[name] || 0) + ph.durationMin;
          });
          const phaseStr = Object.entries(phaseCounts).map(([k, v]) => `${k}: ${v}min`).join(', ');
          return `${p.daysPrevious === 0 ? 'last night' : p.daysPrevious + 'd ago'}: ${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}-${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')} (${totalMin}min)\n${phaseStr}`;
        });
        RingData.showResult('card-sleep', lines.join('\n\n'));
      }
      RingData.setButtonBusy('card-sleep', false);
    });

    try {
      const name = await BLE.connect();
      RingData.setStatus('[connected] ' + name);
    } catch (e) {
      RingData.setStatus(`[error] ${e.name || 'Error'}: ${e.message || '(no message)'}`);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect failed — tap to retry';
    }
  },

  cardIdForKind(kind) {
    const BLE = window.ColmiBLE;
    for (const [cmd, constName] of Object.entries(RingData.REALTIME_KINDS)) {
      if (BLE[constName] === kind) return 'card-' + cmd;
    }
    return null;
  },

  async runCommand(cmd) {
    const BLE = window.ColmiBLE;
    const cardId = 'card-' + cmd;

    if (cmd === 'battery') {
      RingData.setButtonBusy(cardId, true);
      await BLE.readBattery();
      return;
    }

    if (cmd === 'hrlog') {
      RingData.setButtonBusy(cardId, true);
      await BLE.readHeartRateLog();
      return;
    }

    if (cmd === 'spo2log') {
      RingData.setButtonBusy(cardId, true);
      try {
        await BLE.readSpO2Log();
      } catch (e) {
        RingData.showResult(cardId, e.message);
        RingData.setButtonBusy(cardId, false);
      }
      return;
    }

    if (cmd === 'sleep') {
      RingData.setButtonBusy(cardId, true);
      try {
        await BLE.readSleepLog();
      } catch (e) {
        RingData.showResult(cardId, e.message);
        RingData.setButtonBusy(cardId, false);
      }
      return;
    }

    if (cmd === 'steps') {
      RingData.setButtonBusy(cardId, true);
      await BLE.readSteps(0);
      return;
    }

    // Real-time reading types — HR, SpO2, and everything in the
    // "unreliable" tier all go through the same generic pipeline.
    // Short 15s window since we're just seeing what comes back, not
    // waiting for a fully-settled value like the main app does.
    const kindConst = RingData.REALTIME_KINDS[cmd];
    if (kindConst) {
      RingData.setButtonBusy(cardId, true, 'Reading (15s)...');
      await BLE.streamReading(BLE[kindConst], 15, () => {});
      RingData.setButtonBusy(cardId, false);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('connect-btn').addEventListener('click', RingData.connect);
  document.getElementById('disconnect-btn').addEventListener('click', () => window.ColmiBLE.disconnect());
  document.querySelectorAll('.read-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => RingData.runCommand(btn.dataset.cmd));
  });
});
