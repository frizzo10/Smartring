/* ─────────────────────────────────────────────────────────
   myDrSage — Simulated Ring Data Source

   Stands in for the Colmi R02 while hardware is in transit.
   Generates a run of nights with realistic values AND
   occasional genuine flags (elevated RHR + HRV dip, SpO2
   clustering, multi-night trends) so the full calibration loop
   is exercisable end-to-end before real hardware arrives.

   Swap-out plan: once the R02 arrives, this module gets
   replaced by real BLE reads (steps/HR/SpO2/sleep from the
   ring) + hrv.js's real RMSSD extraction from raw PPG. Nothing
   else in the app needs to change — everything downstream
   consumes the same NightRecord shape either way.
   ───────────────────────────────────────────────────────── */

const SimRing = {

  // Person's "true" baseline — the generator's ground truth,
  // used to produce realistic variation around a stable normal.
  baseline: {
    restingHR: 62,
    hrv_rmssd: 42,
    spo2_typical_dips: 1,
    sleepDurationMin: 435,
  },

  // ── GENERATE ONE NIGHT ────────────────────────────────────
  // scenario: 'normal' | 'single_flag' | 'trend_start' | 'trend_continue' | 'noisy_signal'
  generateNight(dateStr, scenario = 'normal', trendDay = 0) {
    const b = SimRing.baseline;
    const jitter = (spread) => (Math.random() - 0.5) * 2 * spread;

    let restingHR = b.restingHR + jitter(4);
    let hrv = b.hrv_rmssd + jitter(6);
    let spo2Dips = b.spo2_typical_dips + (Math.random() < 0.15 ? 1 : 0);
    let spo2DipsBelow92 = 0;
    let sleepMin = b.sleepDurationMin + jitter(30);
    let hrvConfidence = 'ok';
    let hrvRejectionRate = 0.05 + Math.random() * 0.1;

    const flags = [];

    if (scenario === 'single_flag') {
      restingHR = b.restingHR + 8 + jitter(2);
      hrv = b.hrv_rmssd * 0.7 + jitter(3);
      flags.push({
        id: 'rhr_hrv_single_night',
        type: 'single_night',
        metric: 'restingHR',
        severity: 'watch',
        description: `RHR +${(restingHR - b.restingHR).toFixed(0)} vs baseline, HRV -${(100 - (hrv/b.hrv_rmssd*100)).toFixed(0)}%`,
      });
    }

    if (scenario === 'spo2_flag') {
      spo2Dips = 4 + Math.floor(Math.random() * 3);
      spo2DipsBelow92 = 3 + Math.floor(Math.random() * 3);
      flags.push({
        id: 'spo2_dips_clustered',
        type: 'single_night',
        metric: 'spo2',
        severity: 'watch',
        description: `${spo2DipsBelow92} desaturation events below 92% overnight`,
      });
    }

    if (scenario === 'trend_start' || scenario === 'trend_continue') {
      // Gradual decline over several nights — trendDay increases the effect
      const decline = Math.min(trendDay * 5, 20); // caps at 20% decline
      hrv = b.hrv_rmssd * (1 - decline / 100) + jitter(3);
      restingHR = b.restingHR + Math.min(trendDay * 1.5, 8) + jitter(2);
      if (trendDay >= 2) {
        flags.push({
          id: 'hrv_declining_multi_night',
          type: 'multi_night_trend',
          metric: 'hrv_rmssd',
          severity: 'notable',
          description: `HRV trending down ${decline.toFixed(0)}% over ${trendDay + 1} nights`,
        });
      }
    }

    if (scenario === 'noisy_signal') {
      hrvConfidence = 'low';
      hrvRejectionRate = 0.35 + Math.random() * 0.15;
      hrv = null; // per hrv.js discipline: don't report a number we can't stand behind
      flags.push({
        id: 'signal_too_noisy_repeated',
        type: 'signal_quality',
        metric: 'hrv_rmssd',
        severity: 'watch',
        description: `Rejection rate ${(hrvRejectionRate*100).toFixed(0)}% — signal quality too low to report`,
      });
    }

    return {
      date: dateStr,
      sensors: {
        restingHR: { value: Math.round(restingHR), confidence: 'ok', segmentsUsed: 6 },
        hrv_rmssd: { value: hrv != null ? Math.round(hrv * 10) / 10 : null, confidence: hrvConfidence, segmentsUsed: hrvConfidence === 'ok' ? 6 : 2, rejectionRate: Math.round(hrvRejectionRate * 100) / 100 },
        spo2: { value: 96 - spo2Dips * 0.3, dipCount: spo2Dips, dipsBelow92: spo2DipsBelow92, confidence: 'ok' },
        sleepDurationMin: Math.round(sleepMin),
        sleepEfficiencyPct: Math.round(82 + jitter(8)),
        ringWornMinutes: Math.round(sleepMin * (0.9 + Math.random() * 0.1)),
      },
      deviations: {
        restingHR_vs_baseline: Math.round((restingHR - b.restingHR) * 10) / 10,
        hrv_vs_baseline_pct: hrv != null ? Math.round((hrv / b.hrv_rmssd - 1) * 1000) / 10 : null,
        spo2_dips_vs_baseline: spo2Dips - b.spo2_typical_dips,
      },
      flags,
      questionsAsked: [],
      resolution: flags.length === 0 ? { outcome: 'no_flag', explanationTag: null, countsTowardTrend: true } : null,
    };
  },

  // ── GENERATE A RUN OF NIGHTS ──────────────────────────────
  // Produces a realistic 10-night history: mostly normal, one
  // single-night flag, one noisy-signal night, and a developing
  // multi-night trend at the end — enough variety to exercise
  // every branch of the calibration loop.
  generateHistory(startDate = new Date()) {
    const nights = [];
    const scenarios = [
      'normal', 'normal', 'single_flag', 'normal', 'noisy_signal',
      'normal', 'spo2_flag', 'trend_start', 'trend_continue', 'trend_continue',
    ];

    let trendDay = 0;
    for (let i = 0; i < scenarios.length; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() - (scenarios.length - 1 - i));
      const dateStr = d.toISOString().split('T')[0];

      const scenario = scenarios[i];
      if (scenario === 'trend_start') trendDay = 0;
      if (scenario === 'trend_continue') trendDay++;

      nights.push(SimRing.generateNight(dateStr, scenario, trendDay));
    }
    return nights;
  },

  // ── TONIGHT'S BRIEFING (what the home screen shows) ───────
  // Convenience accessor: the most recent night in a generated
  // history, formatted for the home screen verdict cards.
  getLatestNight(history) {
    return history[history.length - 1];
  },
};

if (typeof module !== 'undefined') module.exports = SimRing;
if (typeof window !== 'undefined') window.SimRing = SimRing;
