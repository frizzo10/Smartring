/* ─────────────────────────────────────────────────────────
   Dashboard controller — QRing-mirror layout

   Three cards only, matching what's actually confirmed available
   from the ring's protocol: Activity (steps/kcal/distance), Heart
   Rate (chart + range), Blood Oxygen (chart + range, second BLE
   service — untested against real hardware as of the last session,
   first thing to verify here).

   Not built: Body Temperature, Stress, Sport Record (no command
   found in any reference client) or HRV (ring itself reports
   "please wear device" in its own app — not surfaced here either).

   Reuses ColmiBLE as-is — no new protocol logic lives here, just
   wiring + display. Snapshot writes reuse the same sh_ring_latest
   key as render.js / ring-data.js; app.js sendChat() only reads
   ringSnap.hrLog and ringSnap.steps, so adding spo2Log here does not
   change what feeds the AI chat.
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

  nowLabel() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },

  // Builds a 24-bar SVG chart (viewBox 240x64) from an array of 24
  // hourly values. Bars scale to the max value in the set; zero/empty
  // values render as a 1px sliver so the hour slot is still visible.
  renderBarChart(svgEl, hourlyValues, color) {
    const w = 240, h = 64, barW = 8, gap = 2;
    const max = Math.max(1, ...hourlyValues);
    let bars = '';
    hourlyValues.forEach((v, i) => {
      const barH = v > 0 ? Math.max(2, (v / max) * h) : 1;
      const x = i * (barW + gap);
      const y = h - barH;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="1.5" fill="${color}" opacity="${v > 0 ? 1 : 0.25}"/>`;
    });
    svgEl.innerHTML = bars;
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  },

  renderActivity(entries) {
    const totalSteps = entries.reduce((sum, e) => sum + e.steps, 0);
    const totalCal = entries.reduce((sum, e) => sum + e.calories, 0);
    const totalDist = entries.reduce((sum, e) => sum + e.distance, 0);

    document.getElementById('activity-steps').textContent = totalSteps.toLocaleString();
    document.getElementById('activity-cal').textContent = totalCal.toLocaleString();
    document.getElementById('activity-dist').textContent = totalDist + ' m';
    document.getElementById('activity-updated').textContent = Dashboard.nowLabel();
    document.getElementById('activity-empty').style.display = 'none';
  },

  renderHeartRate(heartRates) {
    const nonZero = heartRates.filter(v => v > 0);
    if (!nonZero.length) {
      document.getElementById('heart-empty').textContent = 'No nonzero heart rate samples yet today.';
      return;
    }
    const avg = Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length);
    const min = Math.min(...nonZero), max = Math.max(...nonZero);

    // Bucket the 288 5-min samples into 24 hourly averages for the chart.
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const slice = heartRates.slice(h * 12, h * 12 + 12).filter(v => v > 0);
      hourly.push(slice.length ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) : 0);
    }

    document.getElementById('heart-avg').textContent = avg;
    document.getElementById('heart-range').textContent = `${min}–${max} bpm range today`;
    document.getElementById('heart-updated').textContent = Dashboard.nowLabel();
    document.getElementById('heart-empty').style.display = 'none';
    document.getElementById('heart-chart-wrap').style.display = 'block';
    Dashboard.renderBarChart(document.getElementById('heart-chart'), hourly, '#E86A5C');
  },

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
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const min = Math.min(...vals), max = Math.max(...vals);
    const hourly = today.hourly.map(h => h.max);

    document.getElementById('oxygen-avg').textContent = avg;
    document.getElementById('oxygen-range').textContent = `${min}–${max}% range today`;
    document.getElementById('oxygen-updated').textContent = Dashboard.nowLabel();
    document.getElementById('oxygen-empty').style.display = 'none';
    document.getElementById('oxygen-chart-wrap').style.display = 'block';
    Dashboard.renderBarChart(document.getElementById('oxygen-chart'), hourly, '#5FA9D9');

    Dashboard.saveSnapshot({
      spo2Log: { avg, min, max, date: new Date().toISOString().slice(0, 10) },
    });
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
