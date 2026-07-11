/* ─────────────────────────────────────────────────────────
   Dashboard controller — mirrors the QRing app's own layout
   (screenshots supplied July 10): Activity arc, Sleep arc +
   timeline, Heart Rate line chart, Blood Oxygen bar chart, plus
   a battery banner.

   Not built: Sport Record, Body Temperature, HRV — none have a
   working read command in any reference client tonight; HRV
   itself reports "please wear device" in QRing's own app.

   QRing's Activity/Sleep "score" numbers (e.g. "36 Moderate
   exercise", "76 Good") come from an internal algorithm we don't
   have — not fabricated here. The Activity arc instead fills
   toward a plain 10,000-step goal, and the Sleep arc fills toward
   total time asleep (light+deep+REM), both real numbers from the
   ring's own log.

   Reuses ColmiBLE as-is. Snapshot writes reuse sh_ring_latest;
   app.js sendChat() only reads .hrLog and .steps, so the extra
   fields written here (spo2Log, sleep, battery) don't change what
   feeds the AI chat.
   ───────────────────────────────────────────────────────── */

const Dashboard = {
  saveSnapshot(partial) {
    try {
      const existing = JSON.parse(localStorage.getItem('sh_ring_latest') || '{}');
      const merged = { ...existing, ...partial, updatedAt: new Date().toISOString() };
      localStorage.setItem('sh_ring_latest', JSON.stringify(merged));
    } catch (e) { /* localStorage unavailable — fail silently, this is a bonus, not critical path */ }
  },

  setStatus(msg) {
    document.getElementById('status-line').textContent = msg;
  },

  todayLabel() {
    return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  // ── ARC GAUGE (semicircle, top half) ───────────────────────
  // viewBox 220x130. Arc spans from (10,120) to (210,120) over the
  // top, radius 100. Full arc length = pi*r. Progress is expressed
  // as fraction 0..1 of that length via stroke-dasharray.
  drawArc(bgPathEl, fgPathEl, fraction) {
    const r = 100, cx = 110, cy = 120;
    const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    const len = Math.PI * r;
    const frac = Math.max(0, Math.min(1, fraction));
    bgPathEl.setAttribute('d', d);
    fgPathEl.setAttribute('d', d);
    fgPathEl.setAttribute('stroke-dasharray', `${frac * len} ${len}`);
  },

  // ── LINE CHART (Heart Rate) ─────────────────────────────────
  renderLineChart(svgEl, values, gridVals) {
    const w = 300, h = 130, padL = 26, padR = 4, padT = 8, padB = 8;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const min = Math.min(...gridVals), max = Math.max(...gridVals);

    let grid = '';
    gridVals.forEach(v => {
      const y = padT + plotH - ((v - min) / (max - min)) * plotH;
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="chart-grid-line"/>`;
      grid += `<text x="${w - padR}" y="${y - 2}" text-anchor="end" class="chart-grid-label">${v}</text>`;
    });

    const nonZeroIdx = values.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
    let line = '';
    if (nonZeroIdx.length > 1) {
      const points = nonZeroIdx.map(i => {
        const x = padL + (i / (values.length - 1)) * plotW;
        const clamped = Math.max(min, Math.min(max, values[i]));
        const y = padT + plotH - ((clamped - min) / (max - min)) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      line = `<polyline points="${points}" fill="none" stroke="#E86A5C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    svgEl.innerHTML = grid + line;
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  },

  // ── BAR CHART (Blood Oxygen) ────────────────────────────────
  renderBarChart(svgEl, hourlyValues, gridVals, color) {
    const w = 300, h = 130, padL = 26, padR = 4, padT = 8, padB = 8;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const min = Math.min(...gridVals), max = Math.max(...gridVals);
    const barW = plotW / hourlyValues.length * 0.6;
    const gap = plotW / hourlyValues.length;

    let grid = '';
    gridVals.forEach(v => {
      const y = padT + plotH - ((v - min) / (max - min)) * plotH;
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="chart-grid-line"/>`;
      grid += `<text x="${w - padR}" y="${y - 2}" text-anchor="end" class="chart-grid-label">${v}</text>`;
    });

    let bars = '';
    hourlyValues.forEach((v, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      if (v <= 0) return;
      const clamped = Math.max(min, Math.min(max, v));
      const yVal = padT + plotH - ((clamped - min) / (max - min)) * plotH;
      const barH = (padT + plotH) - yVal;
      bars += `<rect x="${x.toFixed(1)}" y="${yVal.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${color}"/>`;
    });

    svgEl.innerHTML = grid + bars;
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  },

  // ── ACTIVITY ─────────────────────────────────────────────────
  renderActivity(entries) {
    const totalSteps = entries.reduce((sum, e) => sum + e.steps, 0);
    const totalCal = entries.reduce((sum, e) => sum + e.calories, 0);
    const totalDistM = entries.reduce((sum, e) => sum + e.distance, 0);

    document.getElementById('activity-date').textContent = Dashboard.todayLabel();
    document.getElementById('activity-steps').textContent = totalSteps.toLocaleString();
    document.getElementById('activity-cal').textContent = totalCal.toLocaleString();
    document.getElementById('activity-steps-sub').textContent = totalSteps.toLocaleString();
    document.getElementById('activity-dist').textContent = (totalDistM / 1000).toFixed(2);
    document.getElementById('activity-empty').style.display = 'none';

    Dashboard.drawArc(
      document.getElementById('activity-arc-bg'),
      document.getElementById('activity-arc-fg'),
      totalSteps / 10000
    );
  },

  // ── SLEEP ────────────────────────────────────────────────────
  renderSleep(sleepLog) {
    const period = sleepLog.periods.find(p => p.daysPrevious === 0) || sleepLog.periods[0];
    if (!period) {
      document.getElementById('sleep-empty').textContent = 'No sleep periods returned.';
      return;
    }
    const BLE = window.ColmiBLE;
    const totalMin = period.phases.reduce((sum, ph) => sum + ph.durationMin, 0);
    const asleepMin = period.phases
      .filter(ph => ph.type === 2 || ph.type === 3 || ph.type === 4) // light, deep, REM
      .reduce((sum, ph) => sum + ph.durationMin, 0);

    const fmtTime = mins => {
      const h = Math.floor(mins / 60) % 24, m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    document.getElementById('sleep-date').textContent = Dashboard.todayLabel();
    document.getElementById('sleep-hours').textContent = `${Math.floor(asleepMin / 60)}h ${asleepMin % 60}m`;
    document.getElementById('sleep-start').textContent = fmtTime(period.startMins);
    document.getElementById('sleep-end').textContent = fmtTime(period.endMins);

    const segClass = { 2: 'seg-light', 3: 'seg-deep', 4: 'seg-rem', 5: 'seg-awake' };
    const timeline = document.getElementById('sleep-timeline');
    timeline.innerHTML = period.phases
      .filter(ph => segClass[ph.type] && totalMin > 0)
      .map(ph => `<div class="${segClass[ph.type]}" style="width:${(ph.durationMin / totalMin) * 100}%"></div>`)
      .join('');

    Dashboard.drawArc(
      document.getElementById('sleep-arc-bg'),
      document.getElementById('sleep-arc-fg'),
      asleepMin / (8 * 60) // fraction of an 8h reference night
    );

    document.getElementById('sleep-empty').style.display = 'none';
    document.getElementById('sleep-body').style.display = 'block';

    Dashboard.saveSnapshot({
      sleep: { totalMin, asleepMin, startMins: period.startMins, endMins: period.endMins, date: new Date().toISOString().slice(0, 10) },
    });
  },

  // ── HEART RATE ───────────────────────────────────────────────
  renderHeartRate(heartRates) {
    const nonZero = heartRates.filter(v => v > 0);
    if (!nonZero.length) {
      document.getElementById('heart-empty').textContent = 'No nonzero heart rate samples yet today.';
      return;
    }
    const min = Math.min(...nonZero), max = Math.max(...nonZero);
    const current = nonZero[nonZero.length - 1];
    const gridMin = Math.max(0, Math.floor((min - 15) / 5) * 5);
    const gridMax = Math.ceil((max + 15) / 5) * 5;
    const gridVals = [gridMin, Math.round((gridMin + gridMax) / 2), gridMax];

    document.getElementById('heart-date').textContent = Dashboard.todayLabel();
    document.getElementById('heart-current').textContent = current;
    document.getElementById('heart-range').textContent = `Range ${min}-${max} bpm`;
    document.getElementById('heart-empty').style.display = 'none';
    document.getElementById('heart-chart-wrap').style.display = 'block';
    document.getElementById('heart-metric-row').style.display = 'flex';

    Dashboard.renderLineChart(document.getElementById('heart-chart'), heartRates, gridVals);
  },

  // ── BLOOD OXYGEN ─────────────────────────────────────────────
  renderOxygen(spo2Log) {
    const today = spo2Log.days.find(d => d.daysPrevious === 0) || spo2Log.days[0];
    if (!today) {
      document.getElementById('oxygen-empty').textContent = 'No SpO2 log days returned.';
      return;
    }
    const readings = today.hourly.filter(h => h.max > 0);
    if (!readings.length) {
      document.getElementById('oxygen-empty').textContent = 'No nonzero SpO2 readings yet today.';
      return;
    }
    const vals = readings.flatMap(h => [h.max, h.min]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const current = readings[readings.length - 1].max;
    const hourly = today.hourly.map(h => h.max);
    const gridVals = [80, 90, 100];

    document.getElementById('oxygen-date').textContent = Dashboard.todayLabel();
    document.getElementById('oxygen-current').textContent = current + '%';
    document.getElementById('oxygen-range').textContent = `Range ${min}-${max}%`;
    document.getElementById('oxygen-empty').style.display = 'none';
    document.getElementById('oxygen-chart-wrap').style.display = 'block';
    document.getElementById('oxygen-metric-row').style.display = 'flex';

    Dashboard.renderBarChart(document.getElementById('oxygen-chart'), hourly, gridVals, '#BFD8F5');

    Dashboard.saveSnapshot({
      spo2Log: { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), min, max, date: new Date().toISOString().slice(0, 10) },
    });
  },

  // ── BATTERY ──────────────────────────────────────────────────
  renderBattery(b) {
    const banner = document.getElementById('battery-banner');
    banner.style.display = 'flex';
    document.getElementById('battery-pct').textContent = `${b.level}% Battery${b.charging ? ' (charging)' : ''}`;
    document.getElementById('battery-fill').style.width = b.level + '%';
    document.getElementById('battery-fill').style.background = b.level <= 20 ? '#E86A5C' : '#5FA97A';
  },

  async connect() {
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    const BLE = window.ColmiBLE;

    BLE.on('status', s => {
      Dashboard.setStatus('[status] ' + s);
      if (s === 'connected') {
        disconnectBtn.style.display = 'block';
        connectBtn.textContent = 'Connected';
      }
      if (s === 'disconnected') {
        disconnectBtn.style.display = 'none';
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Colmi R02';
      }
    });

    BLE.on('battery', b => {
      Dashboard.renderBattery(b);
      Dashboard.saveSnapshot({ battery: b.level });
    });

    BLE.on('heartRateLog', log => {
      Dashboard.renderHeartRate(log.heartRates);
      const nonZero = log.heartRates.filter(v => v > 0);
      if (nonZero.length) {
        Dashboard.saveSnapshot({
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

    BLE.on('steps', entries => {
      if (entries.length) {
        Dashboard.renderActivity(entries);
        const totalSteps = entries.reduce((sum, e) => sum + e.steps, 0);
        const totalCal = entries.reduce((sum, e) => sum + e.calories, 0);
        const totalDist = entries.reduce((sum, e) => sum + e.distance, 0);
        const last = entries[entries.length - 1];
        Dashboard.saveSnapshot({
          steps: {
            total: totalSteps, calories: totalCal, distance: totalDist,
            date: `${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}`,
          },
        });
      }
    });
    BLE.on('stepsNoData', () => {
      document.getElementById('activity-empty').textContent = 'No step data for today yet.';
    });

    BLE.on('spo2Log', log => Dashboard.renderOxygen(log));
    BLE.on('sleepLog', log => Dashboard.renderSleep(log));

    try {
      const name = await BLE.connect();
      Dashboard.setStatus('[connected] ' + name);
      await BLE.readHeartRateLog();
      await BLE.readSteps(0);
      try {
        await BLE.readSpO2Log();
      } catch (e) {
        document.getElementById('oxygen-empty').textContent = e.message;
      }
      try {
        await BLE.readSleepLog();
      } catch (e) {
        document.getElementById('sleep-empty').textContent = e.message;
      }
    } catch (e) {
      Dashboard.setStatus(`[error] ${e.name || 'Error'}: ${e.message || '(no message)'}`);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect failed — tap to retry';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('connect-btn').addEventListener('click', Dashboard.connect);
  document.getElementById('disconnect-btn').addEventListener('click', () => window.ColmiBLE.disconnect());
});
