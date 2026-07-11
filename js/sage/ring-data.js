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

  // Same central repository dashboard.js writes to — every collection
  // point on this page now lands in the same place, not just the ones
  // that happen to feed the dashboard's daily cards.
  async syncToCloud() {
    try {
      const snapshot = JSON.parse(localStorage.getItem('sh_ring_latest') || 'null');
      if (!snapshot) return;
      const res = await fetch('/.netlify/functions/ring-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (res.ok) {
        RingData.setStatus(document.getElementById('status-line').textContent + ' · synced to cloud ✓');
      } else {
        const body = await res.text();
        console.error('cloud sync failed', res.status, body);
        RingData.setStatus(document.getElementById('status-line').textContent + ` · cloud sync failed (${res.status})`);
      }
    } catch (e) {
      console.error('cloud sync failed (non-fatal)', e);
      RingData.setStatus(document.getElementById('status-line').textContent + ' · cloud sync failed (network)');
    }
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
      RingData.saveSnapshot({ battery: { level: b.level, charging: b.charging } });
      RingData.syncToCloud();
    });

    BLE.on('reading', r => {
      const cardId = RingData.cardIdForKind(r.kind);
      if (!cardId) return;
      const rawNote = r.rawSample ? `\nraw@6-7: ${r.rawSampleHex}` : '';
      RingData.showResult(cardId, `value: ${r.value}${rawNote}`);
      // Not fed to the AI layer (single spot-check, and most of these
      // are undecoded) — but this is collection phase, not analysis
      // phase, so it still gets stored in the central repository under
      // its own kind. Keyed by cmd name so repeated reads of the same
      // type overwrite rather than pile up under a single snapshot key.
      const cmd = Object.keys(RingData.REALTIME_KINDS).find(k => BLE[RingData.REALTIME_KINDS[k]] === r.kind);
      if (cmd) {
        RingData.saveSnapshot({
          diagnosticReadings: {
            ...(JSON.parse(localStorage.getItem('sh_ring_latest') || '{}').diagnosticReadings || {}),
            [cmd]: { value: r.value, rawSample: r.rawSample ?? null, rawSampleHex: r.rawSampleHex ?? null, recordedAt: new Date().toISOString() },
          },
        });
        RingData.syncToCloud();
      }
    });

    BLE.on('readingError', e => {
      const cardId = RingData.cardIdForKind(e.kind);
      if (!cardId) return;
      RingData.showResult(cardId, `error code: ${e.code}`);
      RingData.setButtonBusy(cardId, false);
      const cmd = Object.keys(RingData.REALTIME_KINDS).find(k => BLE[RingData.REALTIME_KINDS[k]] === e.kind);
      if (cmd) {
        RingData.saveSnapshot({
          diagnosticReadings: {
            ...(JSON.parse(localStorage.getItem('sh_ring_latest') || '{}').diagnosticReadings || {}),
            [cmd]: { errorCode: e.code, recordedAt: new Date().toISOString() },
          },
        });
        RingData.syncToCloud();
      }
    });

    BLE.on('heartRateLog', log => {
      const nonZero = log.heartRates.filter(v => v > 0);
      const summary = nonZero.length
        ? `${nonZero.length} samples, range ${Math.min(...nonZero)}-${Math.max(...nonZero)} bpm\ntimestamp: ${log.timestamp?.toLocaleString() || 'n/a'}\nlog interval: ${log.range} min`
        : 'no nonzero samples yet today';
      RingData.showResult('card-hrlog', summary);
      RingData.setButtonBusy('card-hrlog', false);
      if (nonZero.length) {
        const dateStr = log.timestamp ? log.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
        RingData.saveSnapshot({
          hrLog: {
            count: nonZero.length,
            min: Math.min(...nonZero),
            max: Math.max(...nonZero),
            avg: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length),
            date: log.timestamp ? log.timestamp.toISOString() : null,
          },
          heartSeries: log.heartRates,
          heartDate: dateStr,
        });
        RingData.syncToCloud();
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
        const dateStr = new Date(last.year, last.month - 1, last.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        RingData.saveSnapshot({
          steps: { total: totalSteps, calories: totalCal, distance: totalDist, date: `${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}` },
          activity: { totalSteps, totalCal, totalDistM: totalDist, date: dateStr },
          activityEntries: entries,
        });
        RingData.syncToCloud();
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

        const today = log.days.find(d => d.daysPrevious === 0) || log.days[0];
        const hourly = today.hourly.map(h => h.max);
        if (hourly.some(v => v > 0)) {
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          RingData.saveSnapshot({
            spo2Log: {
              avg: Math.round(hourly.filter(v => v > 0).reduce((a, b) => a + b, 0) / hourly.filter(v => v > 0).length),
              min: Math.min(...hourly.filter(v => v > 0)),
              max: Math.max(...hourly.filter(v => v > 0)),
              date: new Date().toISOString().slice(0, 10),
            },
            oxygenHourly: hourly,
            oxygenHourlyDetail: today.hourly,
            oxygenDate: dateStr,
          });
          RingData.syncToCloud();
        }
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

        const period = log.periods.find(p => p.daysPrevious === 0) || log.periods[0];
        const totalMin = period.phases.reduce((s, ph) => s + ph.durationMin, 0);
        const asleepMin = period.phases.filter(ph => ph.type === 2 || ph.type === 3 || ph.type === 4).reduce((s, ph) => s + ph.durationMin, 0);
        const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        RingData.saveSnapshot({
          sleep: { totalMin, asleepMin, startMins: period.startMins, endMins: period.endMins, date: new Date().toISOString().slice(0, 10) },
          sleepDetail: { phases: period.phases, startMins: period.startMins, endMins: period.endMins, date: dateStr },
          sleepPeriods: log.periods,
        });
        RingData.syncToCloud();
      }
      RingData.setButtonBusy('card-sleep', false);
    });

    // Raw sensor stream — accumulate counts + latest sample of each
    // kind while streaming; runCommand('rawsensor') below reads these
    // after the 10s window closes.
    RingData.rawCounts = { ppg: 0, spo2: 0, accel: 0 };
    RingData.rawLatest = { ppg: null, spo2: null, accel: null };
    BLE.on('rawPpgSample', s => { RingData.rawCounts.ppg++; RingData.rawLatest.ppg = s; });
    BLE.on('rawSpo2Sample', s => { RingData.rawCounts.spo2++; RingData.rawLatest.spo2 = s; });
    BLE.on('rawAccelSample', s => { RingData.rawCounts.accel++; RingData.rawLatest.accel = s; });

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

    if (cmd === 'hrvcomputed') {
      RingData.setButtonBusy(cardId, true, 'Capturing (60s)...');
      const ppgSamples = [];
      const timestamps = [];
      const handler = s => { ppgSamples.push(s.ppg); timestamps.push(performance.now()); };
      BLE.on('rawPpgSample', handler);

      await BLE.startRawSensor();
      setTimeout(async () => {
        await BLE.stopRawSensor();
        BLE.off('rawPpgSample', handler);

        if (ppgSamples.length < 20) {
          RingData.showResult(cardId, `Only ${ppgSamples.length} PPG samples received in 60s — not enough to compute anything. Check the ring is snug and the raw stream is actually running.`);
          RingData.setButtonBusy(cardId, false);
          return;
        }

        // Measured sample rate from actual arrival timestamps, not
        // assumed — BLE notification timing isn't perfectly uniform,
        // this is the real average rate over the capture window.
        const durationSec = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
        const sampleRateHz = ppgSamples.length / durationSec;

        const result = window.HRV.computeHRV(ppgSamples, sampleRateHz);

        const lines = [`${ppgSamples.length} PPG samples over ${durationSec.toFixed(1)}s (measured ${sampleRateHz.toFixed(1)} Hz)`];
        if (result.reason === 'ok') {
          lines.push(`RMSSD: ${result.rmssd} ms`);
          lines.push(`beats detected: ${result.beatsDetected}, clean: ${result.cleanBeats}, rejected: ${(result.rejectionRate * 100).toFixed(1)}%`);
          lines.push(`mean RR interval: ${result.meanRR} ms`);
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          RingData.saveSnapshot({
            hrvComputed: { rmssd: result.rmssd, beatsDetected: result.beatsDetected, cleanBeats: result.cleanBeats, rejectionRate: result.rejectionRate, meanRR: result.meanRR, date: dateStr },
          });
          RingData.syncToCloud();
        } else {
          lines.push(`No result — reason: ${result.reason}`);
          if (result.beatsDetected !== undefined) lines.push(`beats detected: ${result.beatsDetected}`);
          if (result.rejectionRate !== undefined) lines.push(`rejection rate: ${(result.rejectionRate * 100).toFixed(1)}%`);
        }
        RingData.showResult(cardId, lines.join('\n'));
        RingData.setButtonBusy(cardId, false);
      }, 60000);
      return;
    }

    if (cmd === 'rawsensor') {
      RingData.setButtonBusy(cardId, true, 'Streaming (10s)...');
      RingData.rawCounts = { ppg: 0, spo2: 0, accel: 0 };
      RingData.rawLatest = { ppg: null, spo2: null, accel: null };
      await BLE.startRawSensor();
      setTimeout(async () => {
        await BLE.stopRawSensor();
        const { ppg, spo2, accel } = RingData.rawCounts;
        const l = RingData.rawLatest;
        const lines = [`${ppg} PPG samples, ${spo2} SpO2 samples, ${accel} accel samples in 10s`];
        if (l.ppg) lines.push(`latest PPG: ${l.ppg.ppg} (max ${l.ppg.max}, min ${l.ppg.min}, diff ${l.ppg.diff})`);
        if (l.spo2) lines.push(`latest SpO2 raw: ${l.spo2.spo2} (max ${l.spo2.max}, min ${l.spo2.min}, diff ${l.spo2.diff})`);
        if (l.accel) lines.push(`latest accel: x=${l.accel.accX} y=${l.accel.accY} z=${l.accel.accZ}`);
        if (ppg + spo2 + accel === 0) lines.push('no raw sensor packets received — command may not be supported on this firmware');
        RingData.showResult(cardId, lines.join('\n'));
        RingData.setButtonBusy(cardId, false);
        if (ppg + spo2 + accel > 0) {
          RingData.saveSnapshot({
            rawSensorTest: { ppgCount: ppg, spo2Count: spo2, accelCount: accel, latest: l, recordedAt: new Date().toISOString() },
          });
          RingData.syncToCloud();
        }
      }, 10000);
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
      RingData.syncToCloud();
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
