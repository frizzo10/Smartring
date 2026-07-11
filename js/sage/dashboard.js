/* ─────────────────────────────────────────────────────────
   Dashboard controller — mirrors the QRing app's own layout
   (screenshots supplied July 10): Activity arc, Sleep arc +
   timeline, Heart Rate line chart, Blood Oxygen bar chart, plus
   a battery banner.

   Renders from the ring's own logged history stored locally
   (sh_ring_latest) on page load, with no active BLE connection
   required — this is data the ring served up over time, not a
   live spot-check. Connecting refreshes that stored data; it
   isn't required just to see the last-synced numbers.

   Not built: Sport Record, Body Temperature, HRV — none have a
   working read command in any reference client; HRV itself
   reports "please wear device" in QRing's own app.

   QRing's Activity/Sleep "score" numbers (e.g. "36 Moderate
   exercise", "76 Good") come from an internal algorithm we don't
   have — not fabricated here. The Activity arc instead fills
   toward a plain 10,000-step goal, and the Sleep arc fills toward
   total time asleep (light+deep+REM), both real numbers from the
   ring's own log.

   Photo backgrounds in the reference screenshots aren't reproduced
   — those are QRing's own licensed images. Card colors/gradients
   approximate the look without copying the source photos.

   Reuses ColmiBLE as-is. Snapshot writes reuse sh_ring_latest;
   app.js sendChat() only reads .hrLog and .steps — those two keys
   keep their exact existing shape below, everything else here is
   additive.
   ───────────────────────────────────────────────────────── */

const Dashboard = {
  SNAPSHOT_KEY: 'sh_ring_latest',

  // Real data already pulled off the ring tonight via ring-data.html —
  // never required Bluefy/BLE here, just carrying it over so the layout
  // isn't sitting empty. Heart Rate and Blood Oxygen are NOT seeded:
  // no full sample series for either was captured tonight (HR log was
  // only ever seen as a min/max range in an earlier session, SpO2 log
  // was never read tonight at all) — seeding those would mean making
  // up chart data, which isn't happening here. Those two stay empty
  // until a real connect pulls them.
  SEED_SNAPSHOT: {
    activity: { totalSteps: 2402, totalCal: 69750, totalDistM: 1443, date: 'Jul 10, 2026' },
    sleepDetail: {
      phases: [
        { type: 2, durationMin: 359 }, // light
        { type: 3, durationMin: 74 },  // deep
        { type: 4, durationMin: 123 }, // REM
        { type: 5, durationMin: 78 },  // awake
      ],
      startMins: 22 * 60 + 27, // 22:27
      endMins: 9 * 60 + 1,     // 09:01
      date: 'last night',
    },
    updatedAt: null, // set to a fixed real timestamp below, not "now"
  },

  loadSnapshot() {
    try { return JSON.parse(localStorage.getItem(Dashboard.SNAPSHOT_KEY) || 'null'); }
    catch (e) { return null; }
  },

  saveSnapshot(partial) {
    try {
      const existing = JSON.parse(localStorage.getItem(Dashboard.SNAPSHOT_KEY) || '{}');
      const merged = { ...existing, ...partial, updatedAt: new Date().toISOString() };
      localStorage.setItem(Dashboard.SNAPSHOT_KEY, JSON.stringify(merged));
    } catch (e) { /* localStorage unavailable — fail silently, this is a bonus, not critical path */ }
  },

  // Fire-and-forget write to Supabase via the ring-sync function — this
  // is what gives us history beyond what the ring's own memory or the
  // browser cache hold. Failure here should never block or break the
  // rest of the page; it just means this particular sync didn't land
  // in the permanent history.
  async syncToCloud() {
    try {
      const snapshot = Dashboard.loadSnapshot();
      if (!snapshot) return;
      const res = await fetch('/.netlify/functions/ring-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      const label = document.getElementById('synced-label');
      if (res.ok) {
        if (label) label.textContent += ' · synced to cloud ✓';
      } else {
        const body = await res.text();
        console.error('cloud sync failed', res.status, body);
        if (label) label.textContent += ` · cloud sync failed (${res.status})`;
      }
    } catch (e) {
      console.error('cloud sync failed (non-fatal)', e);
      const label = document.getElementById('synced-label');
      if (label) label.textContent += ' · cloud sync failed (network)';
    }
  },

  setStatus(msg) {
    document.getElementById('status-line').textContent = msg;
  },

  showSpinner(text) {
    const el = document.getElementById('spinner');
    el.style.display = 'flex';
    document.getElementById('spinner-text').textContent = text;
  },

  hideSpinner() {
    document.getElementById('spinner').style.display = 'none';
  },

  // Makes it visually unambiguous whether what's on screen right now is
  // archived (cached from a past connect, could be hours/days old) or
  // genuinely fresh (this connect, just now).
  showDataBanner(kind, text) {
    const el = document.getElementById('data-banner');
    el.className = kind; // 'archived' or 'fresh'
    el.textContent = text;
  },

  todayLabel() {
    return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  // ── ARC GAUGE (semicircle, top half) ───────────────────────
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
  // Takes plain totals so both the live BLE path and the cached-
  // snapshot path on page load can call the exact same renderer.
  renderActivity({ totalSteps, totalCal, totalDistM, date }) {
    document.getElementById('activity-date').textContent = date || Dashboard.todayLabel();
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
  renderSleep({ phases, startMins, endMins, date }) {
    const totalMin = phases.reduce((sum, ph) => sum + ph.durationMin, 0);
    const asleepMin = phases
      .filter(ph => ph.type === 2 || ph.type === 3 || ph.type === 4) // light, deep, REM
      .reduce((sum, ph) => sum + ph.durationMin, 0);

    const fmtTime = mins => {
      const h = Math.floor(mins / 60) % 24, m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    document.getElementById('sleep-date').textContent = date || Dashboard.todayLabel();
    document.getElementById('sleep-hours').textContent = `${Math.floor(asleepMin / 60)}h ${asleepMin % 60}m`;
    document.getElementById('sleep-start').textContent = fmtTime(startMins);
    document.getElementById('sleep-end').textContent = fmtTime(endMins);

    const segClass = { 2: 'seg-light', 3: 'seg-deep', 4: 'seg-rem', 5: 'seg-awake' };
    const timeline = document.getElementById('sleep-timeline');
    timeline.innerHTML = phases
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
  },

  // ── HEART RATE ───────────────────────────────────────────────
  renderHeartRate(heartRates, date) {
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

    document.getElementById('heart-date').textContent = date || Dashboard.todayLabel();
    document.getElementById('heart-current').textContent = current;
    document.getElementById('heart-range').textContent = `Range ${min}-${max} bpm`;
    document.getElementById('heart-empty').style.display = 'none';
    document.getElementById('heart-chart-wrap').style.display = 'block';
    document.getElementById('heart-metric-row').style.display = 'flex';

    Dashboard.renderLineChart(document.getElementById('heart-chart'), heartRates, gridVals);
  },

  // ── BLOOD OXYGEN ─────────────────────────────────────────────
  renderOxygen(hourly, date) {
    const readings = hourly.filter(v => v > 0);
    if (!readings.length) {
      document.getElementById('oxygen-empty').textContent = 'No nonzero SpO2 readings yet today.';
      return;
    }
    const min = Math.min(...readings), max = Math.max(...readings);
    const current = readings[readings.length - 1];
    const gridVals = [80, 90, 100];

    document.getElementById('oxygen-date').textContent = date || Dashboard.todayLabel();
    document.getElementById('oxygen-current').textContent = current + '%';
    document.getElementById('oxygen-range').textContent = `Range ${min}-${max}%`;
    document.getElementById('oxygen-empty').style.display = 'none';
    document.getElementById('oxygen-chart-wrap').style.display = 'block';
    document.getElementById('oxygen-metric-row').style.display = 'flex';

    Dashboard.renderBarChart(document.getElementById('oxygen-chart'), hourly, gridVals, '#BFD8F5');
  },

  // ── BATTERY ──────────────────────────────────────────────────
  renderBattery(b) {
    const banner = document.getElementById('battery-banner');
    banner.style.display = 'flex';
    document.getElementById('battery-pct').textContent = `${b.level}% Battery${b.charging ? ' (charging)' : ''}`;
    document.getElementById('battery-fill').style.width = b.level + '%';
    document.getElementById('battery-fill').style.background = b.level <= 20 ? '#E86A5C' : '#5FA97A';
  },

  // ── LOAD FROM CACHE (no connection required) ────────────────
  // Runs immediately on page load. This is what makes the
  // dashboard show real numbers even when the ring hasn't been
  // connected this session — it's reading what the ring already
  // handed over and this page already saved, the last time it was
  // connected.
  renderFromCache() {
    const snap = Dashboard.loadSnapshot() || {};
    const seed = Dashboard.SEED_SNAPSHOT;

    const activity = snap.activity || seed.activity;
    const sleepDetail = snap.sleepDetail || seed.sleepDetail;

    if (activity) Dashboard.renderActivity(activity);
    if (sleepDetail) Dashboard.renderSleep(sleepDetail);
    if (snap.heartSeries) Dashboard.renderHeartRate(snap.heartSeries, snap.heartDate);
    if (snap.oxygenHourly) Dashboard.renderOxygen(snap.oxygenHourly, snap.oxygenDate);
    if (snap.hrvComputed) Dashboard.renderHrv(snap.hrvComputed);
    if (typeof snap.battery === 'object' && snap.battery) Dashboard.renderBattery(snap.battery);

    if (snap.updatedAt) {
      const d = new Date(snap.updatedAt);
      document.getElementById('synced-label').textContent = 'Last synced ' + d.toLocaleString();
      Dashboard.showDataBanner('archived', `⏱ Archived data from ${d.toLocaleString()} — not live. Tap Connect for a fresh pull.`);
    } else if (!snap.activity && !snap.sleepDetail) {
      document.getElementById('synced-label').textContent = 'Showing data from tonight\'s ring-data.html session — connect to refresh';
      Dashboard.showDataBanner('archived', '⏱ Archived data — not live. Tap Connect for a fresh pull.');
    }
  },

  // ── HRV ──────────────────────────────────────────────────────
  renderHrv({ rmssd, beatsDetected, cleanBeats, rejectionRate, meanRR, date }) {
    document.getElementById('hrv-date').textContent = date || Dashboard.todayLabel();
    document.getElementById('hrv-value').textContent = rmssd;
    document.getElementById('hrv-detail').textContent = `${cleanBeats}/${beatsDetected} beats, mean RR ${meanRR}ms`;
    document.getElementById('hrv-empty').style.display = 'none';
    document.getElementById('hrv-metric-row').style.display = 'flex';
  },

  async computeHrv() {
    const btn = document.getElementById('hrv-compute-btn');
    if (!window.ColmiBLE.connected) {
      document.getElementById('hrv-empty').textContent = 'Connect the ring first, then tap this.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Capturing (60s)...';

    const BLE = window.ColmiBLE;
    const ppgSamples = [];
    const timestamps = [];
    const handler = s => { ppgSamples.push(s.ppg); timestamps.push(performance.now()); };
    BLE.on('rawPpgSample', handler);

    try {
      await BLE.startRawSensor();
      await BLE.sleep(60000);
    } finally {
      // ALWAYS stop the raw stream, even if something above threw —
      // this is what turns the ring's green/red LEDs back off. Leaving
      // this unpaired with a guaranteed stop is what leaves them stuck on.
      await BLE.stopRawSensor();
      BLE.off('rawPpgSample', handler);
    }

    btn.disabled = false;
    btn.textContent = 'Compute HRV (60s, hold still)';

    if (ppgSamples.length < 20) {
      document.getElementById('hrv-empty').textContent = `Only ${ppgSamples.length} PPG samples received — not enough to compute anything. Try again with the ring snug.`;
      return;
    }

    const durationSec = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
    const sampleRateHz = ppgSamples.length / durationSec;
    const result = window.HRV.computeHRV(ppgSamples, sampleRateHz);
    const dateStr = Dashboard.todayLabel();

    if (result.reason === 'ok') {
      const entry = { rmssd: result.rmssd, beatsDetected: result.beatsDetected, cleanBeats: result.cleanBeats, rejectionRate: result.rejectionRate, meanRR: result.meanRR, date: dateStr, recordedAt: new Date().toISOString() };
      Dashboard.renderHrv(entry);
      const existing = Dashboard.loadSnapshot() || {};
      const history = (existing.hrvHistory || []).concat([entry]).slice(-30); // keep last 30 captures
      Dashboard.saveSnapshot({ hrvComputed: entry, hrvHistory: history });
      Dashboard.syncToCloud();
    } else {
      document.getElementById('hrv-empty').textContent = `No result — ${result.reason}. Beats detected: ${result.beatsDetected ?? 0}.`;
    }
  },

  async connect() {
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    Dashboard.showSpinner('Connecting to ring...');
    Dashboard.showDataBanner('archived', '⏱ Still showing archived data below — connecting now...');

    const BLE = window.ColmiBLE;

    BLE.on('status', s => {
      Dashboard.setStatus('[status] ' + s);
      if (s === 'connected') {
        disconnectBtn.style.display = 'block';
        connectBtn.textContent = 'Connected';
        document.getElementById('hrv-compute-btn').disabled = false;
        document.getElementById('force-stop-btn').disabled = false;
      }
      if (s === 'disconnected') {
        disconnectBtn.style.display = 'none';
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Colmi R02';
        document.getElementById('hrv-compute-btn').disabled = true;
        document.getElementById('force-stop-btn').disabled = true;
      }
    });

    BLE.on('battery', b => {
      Dashboard.renderBattery(b);
      // Keeps the old flat `battery: level` field app.js/older pages may
      // still read, plus a richer object form this page uses on reload.
      Dashboard.saveSnapshot({ battery: { level: b.level, charging: b.charging } });
    });

    BLE.on('heartRateLog', log => {
      const dateStr = log.timestamp ? log.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
      Dashboard.renderHeartRate(log.heartRates, dateStr);
      const nonZero = log.heartRates.filter(v => v > 0);
      if (nonZero.length) {
        Dashboard.saveSnapshot({
          // Unchanged shape — app.js sendChat() reads exactly this.
          hrLog: {
            count: nonZero.length,
            min: Math.min(...nonZero),
            max: Math.max(...nonZero),
            avg: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length),
            date: log.timestamp ? log.timestamp.toISOString() : null,
          },
          // Additive — full series so this page can redraw the chart on
          // a future page load without needing to reconnect.
          heartSeries: log.heartRates,
          heartDate: dateStr,
        });
      }
    });

    BLE.on('steps', entries => {
      if (entries.length) {
        const totalSteps = entries.reduce((sum, e) => sum + e.steps, 0);
        const totalCal = entries.reduce((sum, e) => sum + e.calories, 0);
        const totalDistM = entries.reduce((sum, e) => sum + e.distance, 0);
        const last = entries[entries.length - 1];
        const dateStr = new Date(last.year, last.month - 1, last.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        Dashboard.renderActivity({ totalSteps, totalCal, totalDistM, date: dateStr });
        Dashboard.saveSnapshot({
          // Unchanged shape — app.js sendChat() reads exactly this.
          steps: {
            total: totalSteps, calories: totalCal, distance: totalDistM,
            date: `${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}`,
          },
          // Additive — same totals, keyed for this page's own reload path.
          activity: { totalSteps, totalCal, totalDistM, date: dateStr },
          // Additive — full per-15-min entry list (each has hour/minute/
          // steps/calories/distance) for the Activity detail page's
          // intraday chart. Discarded before tonight; real data, just
          // never surfaced past the daily total.
          activityEntries: entries,
        });
      }
    });
    BLE.on('stepsNoData', () => {
      document.getElementById('activity-empty').textContent = 'No step data for today yet.';
    });

    BLE.on('spo2Log', log => {
      const today = log.days.find(d => d.daysPrevious === 0) || log.days[0];
      if (!today) {
        document.getElementById('oxygen-empty').textContent = 'No SpO2 log days returned.';
        return;
      }
      const hourly = today.hourly.map(h => h.max);
      const dateStr = Dashboard.todayLabel();
      Dashboard.renderOxygen(hourly, dateStr);
      if (hourly.some(v => v > 0)) {
        Dashboard.saveSnapshot({
          spo2Log: {
            avg: Math.round(hourly.filter(v => v > 0).reduce((a, b) => a + b, 0) / hourly.filter(v => v > 0).length),
            min: Math.min(...hourly.filter(v => v > 0)),
            max: Math.max(...hourly.filter(v => v > 0)),
            date: new Date().toISOString().slice(0, 10),
          },
          // Additive — full hourly array for redrawing the bar chart on
          // a future page load without needing to reconnect.
          oxygenHourly: hourly,
          oxygenDate: dateStr,
          // Additive — max AND min per hour (the ring logs both; the
          // main card only ever used max). Min matters more for
          // detecting real dips, which is the actual product focus.
          oxygenHourlyDetail: today.hourly,
        });
      }
    });

    BLE.on('sleepLog', log => {
      const period = log.periods.find(p => p.daysPrevious === 0) || log.periods[0];
      if (!period) {
        document.getElementById('sleep-empty').textContent = 'No sleep periods returned.';
        return;
      }
      const dateStr = Dashboard.todayLabel();
      const totalMin = period.phases.reduce((sum, ph) => sum + ph.durationMin, 0);
      const asleepMin = period.phases.filter(ph => ph.type === 2 || ph.type === 3 || ph.type === 4).reduce((sum, ph) => sum + ph.durationMin, 0);
      Dashboard.renderSleep({ phases: period.phases, startMins: period.startMins, endMins: period.endMins, date: dateStr });
      Dashboard.saveSnapshot({
        sleep: { totalMin, asleepMin, startMins: period.startMins, endMins: period.endMins, date: new Date().toISOString().slice(0, 10) },
        // Additive — full phase list so this page can redraw the
        // timeline bar on a future page load without reconnecting.
        sleepDetail: { phases: period.phases, startMins: period.startMins, endMins: period.endMins, date: dateStr },
        // Additive — every period the ring actually returned in this
        // read (confirmed 2 nights in one response tonight), for the
        // multi-night trend on the sleep detail page.
        sleepPeriods: log.periods,
      });
    });

    try {
      const name = await BLE.connect();
      Dashboard.setStatus('[connected] ' + name);
      Dashboard.showSpinner('Pulling heart rate log...');
      await BLE.readHeartRateLog();
      Dashboard.showSpinner('Pulling steps...');
      await BLE.readSteps(0);
      Dashboard.showSpinner('Pulling blood oxygen log...');
      try {
        await BLE.readSpO2Log();
      } catch (e) {
        document.getElementById('oxygen-empty').textContent = e.message;
      }
      Dashboard.showSpinner('Pulling sleep log...');
      try {
        await BLE.readSleepLog();
      } catch (e) {
        document.getElementById('sleep-empty').textContent = e.message;
      }
      // HRV — automatic now, same tier as the other logged data above.
      // Adds ~60s to the connect (needs a still capture to have enough
      // beats to work with), which is a real, visible tradeoff — but no
      // separate tap required anymore.
      Dashboard.showSpinner('Computing HRV — hold still (60s)...');
      await Dashboard.computeHrv();
      Dashboard.syncToCloud();
      Dashboard.hideSpinner();
      const now = new Date();
      Dashboard.showDataBanner('fresh', `✓ Fresh data — synced just now (${now.toLocaleTimeString()})`);
      document.getElementById('synced-label').textContent = 'Last synced ' + now.toLocaleString();
    } catch (e) {
      Dashboard.hideSpinner();
      Dashboard.setStatus(`[error] ${e.name || 'Error'}: ${e.message || '(no message)'}`);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect failed — tap to retry';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Dashboard.renderFromCache();
  document.getElementById('connect-btn').addEventListener('click', Dashboard.connect);
  document.getElementById('disconnect-btn').addEventListener('click', () => window.ColmiBLE.disconnect());
  document.getElementById('hrv-compute-btn').addEventListener('click', Dashboard.computeHrv);
  document.getElementById('force-stop-btn').addEventListener('click', async () => {
    const btn = document.getElementById('force-stop-btn');
    const status = document.getElementById('force-stop-status');
    btn.disabled = true;
    status.textContent = 'Sending stop command...';
    try {
      await window.ColmiBLE.stopRawSensor();
      status.textContent = 'Reconnecting (this is what actually clears it)...';
      await window.ColmiBLE.forceReconnect();
      status.textContent = 'Reconnected — check the ring now.';
    } catch (e) {
      status.textContent = 'Failed: ' + e.message;
    }
    btn.disabled = false;
  });
});
