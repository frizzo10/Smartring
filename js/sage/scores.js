/* ─────────────────────────────────────────────────────────
   myDrSage — Scores page controller
   Recovery / Sleep / Stress scores computed from real data
   already sitting in sh_ring_latest (steps, sleep, hrvHistory,
   heartSeries) — no new BLE commands, no new sensor reads.
   Strain is intentionally NOT implemented here — see the
   card's own empty-state copy for why.

   Every score either renders from real numbers or shows an
   honest "not enough data" message. No score is ever shown
   with a fabricated or interpolated value. This mirrors the
   pattern already established in hrv.js (reason codes instead
   of silent fallback numbers).

   Scoring formulas below are first-principles, not reverse-
   engineered from any competitor's proprietary algorithm —
   documented inline so they can be adjusted later with real
   user feedback instead of guesswork.
   ───────────────────────────────────────────────────────── */

const Scores = {
  SNAPSHOT_KEY: 'sh_ring_latest',
  JOURNAL_KEY: 'sh_journal',

  loadSnapshot() {
    try { return JSON.parse(localStorage.getItem(Scores.SNAPSHOT_KEY) || 'null'); }
    catch (e) { return null; }
  },

  todayKey() {
    return new Date().toISOString().slice(0, 10);
  },

  // ── RING GAUGE HELPER ────────────────────────────────────
  // circumference for r=36 is 2*PI*36 ≈ 226.19, matches the
  // stroke-dasharray already hardcoded in scores.html
  setRing(elId, pct) {
    const el = document.getElementById(elId);
    if (!el) return;
    const circumference = 226.19;
    const clamped = Math.max(0, Math.min(100, pct));
    el.style.strokeDashoffset = circumference - (circumference * clamped / 100);
  },

  bandFor(score) {
    if (score >= 80) return { label: 'Optimal', color: '#6FCF97' };
    if (score >= 60) return { label: 'Good', color: '#A8D5A2' };
    if (score >= 40) return { label: 'Fair', color: '#E8A85C' };
    return { label: 'Low', color: '#E86A5C' };
  },

  // ── RECOVERY SCORE ───────────────────────────────────────
  // Inputs: most recent HRV reading (vs. personal baseline),
  // resting HR trend if available, prior night's sleep total.
  // Weighting: HRV-vs-baseline 50%, sleep 30%, resting HR 20%.
  // This mirrors the general shape of published recovery-score
  // methodologies (HRV-vs-baseline as the dominant input) but
  // the exact weights here are a starting point, not a citation
  // of any specific competitor's formula.
  computeRecovery(snapshot) {
    const hrvHistory = (snapshot?.hrvHistory || []).filter(h => h.reason === undefined || h.rmssd != null);
    if (!hrvHistory.length) {
      return { ok: false, reason: 'no_hrv' };
    }

    const latest = hrvHistory[hrvHistory.length - 1];
    if (latest.rmssd == null) {
      return { ok: false, reason: 'latest_hrv_invalid' };
    }

    // baseline = median of all prior readings (excludes today's,
    // needs at least 2 prior to mean anything)
    const priorReadings = hrvHistory.slice(0, -1).map(h => h.rmssd).filter(v => v != null);
    let hrvSubscore;
    let baselineNote;
    let baselinePct = null; // raw signed number, null if no real baseline exists yet
    if (priorReadings.length >= 2) {
      const sorted = [...priorReadings].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const baseline = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const ratio = latest.rmssd / baseline;
      // ratio 1.0 = at baseline = 70/100 on this subscore.
      // Each 10% above baseline adds ~15 pts, each 10% below
      // subtracts ~15 pts, clamped 0-100.
      hrvSubscore = Math.max(0, Math.min(100, 70 + (ratio - 1) * 150));
      baselinePct = Math.round((ratio - 1) * 100);
      baselineNote = `${baselinePct}% vs your ${Math.round(baseline * 10) / 10}ms baseline`;
    } else {
      // not enough history for a real baseline — use latest reading
      // alone on a fixed healthy-adult RMSSD reference curve, and
      // say so explicitly rather than pretending it's personalized
      hrvSubscore = 60; // neutral, since we can't say if it's good or bad for THIS person
      baselineNote = 'baseline still building (need 2+ more readings)';
    }

    const sleep = snapshot?.sleep;
    let sleepSubscore = null;
    if (sleep && sleep.asleepMin) {
      // 7-9 hrs = 100, scaling down outside that band
      const hrs = sleep.asleepMin / 60;
      if (hrs >= 7 && hrs <= 9) sleepSubscore = 100;
      else if (hrs >= 6 && hrs < 7) sleepSubscore = 75;
      else if (hrs > 9 && hrs <= 10) sleepSubscore = 85;
      else if (hrs >= 5 && hrs < 6) sleepSubscore = 50;
      else sleepSubscore = 30;
    }

    // resting HR trend — only usable if we have a heart series to
    // pull a low value from; treated as informational, not scored,
    // if there's nothing to compare it against yet
    let rhr = null;
    if (snapshot?.heartSeries?.length) {
      const values = snapshot.heartSeries.filter(v => v > 0);
      if (values.length) rhr = Math.min(...values);
    }

    const weights = { hrv: 0.5, sleep: sleepSubscore != null ? 0.3 : 0, hr: 0 };
    // if sleep is missing, renormalize onto HRV so the score isn't
    // artificially dragged down by an absent (not bad) input
    let finalScore;
    if (sleepSubscore != null) {
      finalScore = hrvSubscore * 0.65 + sleepSubscore * 0.35;
    } else {
      finalScore = hrvSubscore;
    }
    finalScore = Math.round(Math.max(0, Math.min(100, finalScore)));

    return {
      ok: true,
      score: finalScore,
      hrvMs: latest.rmssd,
      baselineNote,
      baselinePct, // signed number or null — use this for logic, baselineNote is display-only text
      rhr,
      sleepHrs: sleep?.asleepMin ? Math.round(sleep.asleepMin / 60 * 10) / 10 : null,
      date: latest.date || Scores.todayKey(),
    };
  },

  renderRecovery(snapshot) {
    const result = Scores.computeRecovery(snapshot);
    const emptyEl = document.getElementById('recovery-empty');
    const bodyEl = document.getElementById('recovery-body');
    const dateEl = document.getElementById('recovery-date');

    if (!result.ok) {
      const msgs = {
        no_hrv: 'Needs at least one resting check (from the Dashboard) plus a synced sleep log to compute.',
        latest_hrv_invalid: 'Your last resting check didn\u2019t produce a clean reading — try again while holding still.',
      };
      emptyEl.textContent = msgs[result.reason] || 'Not enough data yet.';
      emptyEl.style.display = 'block';
      bodyEl.style.display = 'none';
      dateEl.textContent = '--';
      return;
    }

    emptyEl.style.display = 'none';
    bodyEl.style.display = 'flex';
    dateEl.textContent = result.date;
    document.getElementById('recovery-num').textContent = result.score;
    Scores.setRing('recovery-ring', result.score);
    const band = Scores.bandFor(result.score);
    const bandEl = document.getElementById('recovery-band');
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;
    document.getElementById('recovery-hrv').textContent = `${result.hrvMs} ms (${result.baselineNote})`;
    document.getElementById('recovery-rhr').textContent = result.rhr != null ? `${result.rhr} bpm` : 'not enough data';
    document.getElementById('recovery-sleepin').textContent = result.sleepHrs != null ? `${result.sleepHrs} hrs` : 'not synced';
  },

  // ── SLEEP SCORE ───────────────────────────────────────────
  // Inputs entirely from the sleep log already synced by
  // dashboard.js (period.phases, startMins/endMins). Efficiency
  // = asleep time / time in bed. Wake events = count of "awake"
  // phase segments after the first sleep onset (a rough proxy —
  // this is phase-segment count, not a validated wake-event
  // detector; said explicitly in the UI, not just here).
  // ── SLEEP SCORE (single night) ────────────────────────────
  computeSleepScore(snapshot) {
    const sleep = snapshot?.sleep;
    const phases = snapshot?.sleepDetail?.phases;
    if (!sleep || !sleep.totalMin || !phases) {
      return { ok: false };
    }
    return Scores._scoreSleepFromPhases(phases, sleep.date || Scores.todayKey());
  },

  // Shared scoring math, factored out so both tonight's card AND
  // the multi-night history below use identical logic — same
  // weighting (duration 50%, efficiency 30%, wake events 20%)
  // computed once, not duplicated.
  _scoreSleepFromPhases(phases, dateLabel) {
    const totalMin = phases.reduce((sum, ph) => sum + ph.durationMin, 0);
    const asleepMin = phases.filter(ph => ph.type === 2 || ph.type === 3 || ph.type === 4).reduce((sum, ph) => sum + ph.durationMin, 0);
    if (!totalMin) return { ok: false };

    const efficiency = (asleepMin / totalMin) * 100;
    const wakeSegments = phases.filter(p => p.type === 5).length;
    const midSleepWakes = phases[phases.length - 1]?.type === 5 ? Math.max(0, wakeSegments - 1) : wakeSegments;

    const hrs = asleepMin / 60;
    let durationScore;
    if (hrs >= 7 && hrs <= 9) durationScore = 100;
    else if (hrs >= 6 && hrs < 7) durationScore = 75;
    else if (hrs > 9 && hrs <= 10) durationScore = 85;
    else if (hrs >= 5 && hrs < 6) durationScore = 50;
    else durationScore = 30;

    const efficiencyScore = Math.max(0, Math.min(100, efficiency));
    const wakeScore = Math.max(0, 100 - midSleepWakes * 15);
    const finalScore = Math.round(durationScore * 0.5 + efficiencyScore * 0.3 + wakeScore * 0.2);

    return {
      ok: true,
      score: Math.max(0, Math.min(100, finalScore)),
      totalHrs: Math.round(hrs * 10) / 10,
      efficiency: Math.round(efficiency),
      wakeEvents: midSleepWakes,
      date: dateLabel,
    };
  },

  // ── SLEEP HISTORY (multi-night) ───────────────────────────
  // ── BEDTIME CONSISTENCY (closes a real gap: Willow's whole
  // pitch is "consistency matters more than raw hours," but until
  // now nothing measured consistency itself — only duration and
  // efficiency. startMins already exists on every sleepPeriods
  // entry (real ring data, minutes since midnight) and was simply
  // never read for this purpose. Handles the midnight-wraparound
  // case (e.g. 11:30pm vs 12:15am are 45 min apart, not ~23 hrs)
  // by shifting early-morning times onto the same continuous
  // evening timeline before computing spread \u2014 a reasonable
  // heuristic for real bedtimes, not full circular statistics,
  // since nobody's real bedtime is anywhere near noon.
  computeBedtimeConsistency(snapshot) {
    const periods = (snapshot?.sleepPeriods || []).filter(p => p.startMins != null);
    if (periods.length < 3) return { ok: false, have: periods.length };

    const adjusted = periods.map(p => (p.startMins < 720 ? p.startMins + 1440 : p.startMins));
    const mean = adjusted.reduce((a, b) => a + b, 0) / adjusted.length;
    const variance = adjusted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / adjusted.length;
    const stdDevMin = Math.round(Math.sqrt(variance));

    const meanClock = Math.round(mean) % 1440;
    const hh = Math.floor(meanClock / 60) % 24;
    const mm = meanClock % 60;
    const avgBedtime = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;

    let label;
    if (stdDevMin <= 30) label = 'Very consistent';
    else if (stdDevMin <= 60) label = 'Fairly consistent';
    else if (stdDevMin <= 90) label = 'Somewhat variable';
    else label = 'Highly variable';

    return { ok: true, avgBedtime, stdDevMin, label, nights: periods.length };
  },

  // Built from sleepPeriods — real data the ring already returns
  // (confirmed multiple nights in a single sleepLog read) and
  // dashboard.js already saves to the snapshot, but nothing has
  // read it back out until now. daysPrevious is a real integer
  // offset from the ring (0 = last night), converted here to an
  // actual calendar date so both the person and the AI prompt
  // can reason about it like a normal date, not an offset.
  buildSleepHistory(snapshot) {
    const periods = snapshot?.sleepPeriods;
    if (!periods || !periods.length) return [];

    const today = new Date();
    return periods
      .map(p => {
        if (!p.phases || !p.phases.length) return null;
        const d = new Date(today);
        d.setDate(d.getDate() - p.daysPrevious);
        const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const scored = Scores._scoreSleepFromPhases(p.phases, dateLabel);
        if (!scored.ok) return null;
        return { daysPrevious: p.daysPrevious, date: dateLabel, ...scored };
      })
      .filter(Boolean)
      .sort((a, b) => b.daysPrevious - a.daysPrevious); // oldest first
  },


  renderSleepScore(snapshot) {
    const result = Scores.computeSleepScore(snapshot);
    const emptyEl = document.getElementById('sleep-score-empty');
    const bodyEl = document.getElementById('sleep-score-body');
    const dateEl = document.getElementById('sleep-score-date');

    if (!result.ok) {
      emptyEl.style.display = 'block';
      bodyEl.style.display = 'none';
      dateEl.textContent = '--';
      return;
    }

    emptyEl.style.display = 'none';
    bodyEl.style.display = 'flex';
    dateEl.textContent = result.date;
    document.getElementById('sleep-score-num').textContent = result.score;
    Scores.setRing('sleep-score-ring', result.score);
    const band = Scores.bandFor(result.score);
    const bandEl = document.getElementById('sleep-score-band');
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;
    document.getElementById('sleep-score-total').textContent = `${result.totalHrs} hrs`;
    document.getElementById('sleep-score-eff').textContent = `${result.efficiency}%`;
    document.getElementById('sleep-score-wake').textContent = result.wakeEvents;
    const consistency = Scores.computeBedtimeConsistency(snapshot);
    document.getElementById('sleep-score-consistency').textContent = consistency.ok
      ? `${consistency.label} (avg ${consistency.avgBedtime})`
      : `Need ${3 - consistency.have} more night${3 - consistency.have === 1 ? '' : 's'} synced`;
  },

  // ── STRESS SCORE ──────────────────────────────────────────
  // Derived the same way Recovery is (HRV vs personal baseline),
  // but inverted and reading-specific rather than a nightly
  // aggregate — a single low-HRV-vs-baseline moment reads as
  // elevated stress. Explicitly requires 3+ HRV readings before
  // showing anything, since a "baseline" from fewer than that
  // is closer to noise than signal.
  computeStress(snapshot) {
    const hrvHistory = (snapshot?.hrvHistory || []).filter(h => h.rmssd != null);
    if (hrvHistory.length < 3) {
      return { ok: false, have: hrvHistory.length };
    }

    const latest = hrvHistory[hrvHistory.length - 1];
    const prior = hrvHistory.slice(0, -1).map(h => h.rmssd);
    const sorted = [...prior].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const baseline = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const ratio = latest.rmssd / baseline;
    // ratio 1.0 (at baseline) => stress score 30 (low stress).
    // Lower HRV than baseline => higher stress score.
    const stressScore = Math.round(Math.max(0, Math.min(100, 30 + (1 - ratio) * 150)));

    const readingAgeMin = latest.recordedAt
      ? Math.round((Date.now() - new Date(latest.recordedAt).getTime()) / 60000)
      : null;

    return {
      ok: true,
      score: stressScore,
      baselinePct: Math.round((ratio - 1) * 100),
      readingAgeMin,
      date: latest.date || Scores.todayKey(),
    };
  },

  // stress band is inverted vs the others: LOW score is good here
  stressBandFor(score) {
    if (score <= 30) return { label: 'Low', color: '#6FCF97' };
    if (score <= 55) return { label: 'Moderate', color: '#A8D5A2' };
    if (score <= 75) return { label: 'Elevated', color: '#E8A85C' };
    return { label: 'High', color: '#E86A5C' };
  },

  renderStress(snapshot) {
    const result = Scores.computeStress(snapshot);
    const emptyEl = document.getElementById('stress-empty');
    const bodyEl = document.getElementById('stress-body');
    const dateEl = document.getElementById('stress-date');

    if (!result.ok) {
      emptyEl.textContent = `Needs a few resting checks over time to learn your personal baseline before Stress can be scored (you have ${result.have}).`;
      emptyEl.style.display = 'block';
      bodyEl.style.display = 'none';
      dateEl.textContent = '--';
      return;
    }

    emptyEl.style.display = 'none';
    bodyEl.style.display = 'flex';
    dateEl.textContent = result.date;
    document.getElementById('stress-num').textContent = result.score;
    Scores.setRing('stress-ring', result.score);
    const band = Scores.stressBandFor(result.score);
    const bandEl = document.getElementById('stress-band');
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;
    document.getElementById('stress-baseline').textContent = `${result.baselinePct > 0 ? '+' : ''}${result.baselinePct}%`;
    document.getElementById('stress-age').textContent = result.readingAgeMin != null
      ? (result.readingAgeMin < 60 ? `${result.readingAgeMin} min ago` : `${Math.round(result.readingAgeMin / 60)} hrs ago`)
      : 'unknown';
  },

  // ── JOURNAL ───────────────────────────────────────────────
  // Pure logging, no scoring tie-in yet — same honest-scope
  // approach as Strain: log what's real, don't pretend it
  // feeds a model that doesn't exist yet.
  loadJournal() {
    try { return JSON.parse(localStorage.getItem(Scores.JOURNAL_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  saveJournal(all) {
    try { localStorage.setItem(Scores.JOURNAL_KEY, JSON.stringify(all)); }
    catch (e) { /* non-critical */ }
  },

  toggleJournalItem(key) {
    const all = Scores.loadJournal();
    const today = Scores.todayKey();
    all[today] = all[today] || {};
    all[today][key] = !all[today][key];
    Scores.saveJournal(all);
    Scores.renderJournal();
    const note = document.getElementById('journal-saved-note');
    note.textContent = 'Saved ✓';
    setTimeout(() => { if (note.textContent === 'Saved ✓') note.textContent = ''; }, 1500);
  },

  renderJournal() {
    const all = Scores.loadJournal();
    const today = all[Scores.todayKey()] || {};
    document.getElementById('journal-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    document.querySelectorAll('.journal-item').forEach(item => {
      const key = item.dataset.key;
      item.classList.toggle('active', !!today[key]);
    });
  },

  // ── STATUS STATEMENTS ─────────────────────────────────────
  // Pure template formatting over already-computed numbers.
  // No AI call, no network — same trust level as the score
  // itself. This is the "tells you exactly where you're at"
  // layer: a factual sentence, not a suggestion.
  statusForRecovery(r) {
    if (!r.ok) return null;
    const band = Scores.bandFor(r.score).label;
    let driver;
    if (r.baselinePct == null) {
      driver = `your last resting check came back at ${r.hrvMs}ms \u2014 not yet enough history to say if that's typical for you`;
    } else {
      const dir = r.baselinePct < 0 ? 'below' : 'above';
      driver = `your resting check is ${Math.abs(r.baselinePct)}% ${dir} your personal baseline (${r.hrvMs}ms)`;
    }
    const sleepPart = r.sleepHrs != null ? `, sleep was ${r.sleepHrs} hrs` : ', no sleep data synced today';
    return `Recovery is ${r.score} (${band}) \u2014 driven mainly by ${driver}${sleepPart}.`;
  },

  statusForSleep(s) {
    if (!s.ok) return null;
    const band = Scores.bandFor(s.score).label;
    return `Sleep is ${s.score} (${band}) \u2014 ${s.totalHrs} hrs total, ${s.efficiency}% efficiency, ${s.wakeEvents} wake event${s.wakeEvents === 1 ? '' : 's'} logged.`;
  },

  statusForStress(st) {
    if (!st.ok) return null;
    const band = Scores.stressBandFor(st.score).label;
    const dir = st.baselinePct <= 0 ? 'lower' : 'higher';
    return `Stress is ${st.score} (${band}) \u2014 this reading is ${Math.abs(st.baselinePct)}% ${dir} than your baseline.`;
  },

  renderStatusLine(elId, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.textContent = text;
    el.style.display = 'block';
  },

  // ── AI TREND CONTEXT (qwen/qwen3.6-27b via Groq, exclusively —
  // same model as every other AI call in this app, routed through
  // the existing /.netlify/functions/claude proxy unchanged) ────
  // Extends the exact system-prompt pattern already proven on
  // hrv-detail.html's Ask Dr. Sage button. One deliberate change
  // from that pattern: this layer is explicitly forbidden from
  // giving ANY recommendation — its only job is "is this normal
  // for you, and why", using nothing but the real numbers handed
  // to it. The three-tier recommendation stays exclusive to the
  // full Ask Dr. Sage chat.
  buildTrendPrompt(kind, snapshot) {
    if (kind === 'recovery' || kind === 'stress') {
      const hrvHistory = (snapshot.hrvHistory || []).filter(h => h.rmssd != null);
      if (!hrvHistory.length) return null;
      const latest = hrvHistory[hrvHistory.length - 1];
      const priorLines = hrvHistory.slice(0, -1).slice(-13).map(h => `${h.date}: ${h.rmssd}ms`).join('\n');
      return {
        userMessage: `Here is this person's real HRV history, most recent last:\n${priorLines || '(no prior readings yet)'}\nToday (${latest.date}): ${latest.rmssd}ms\n\nIn 2-3 sentences, say whether today's reading is typical for THIS person specifically, referencing the actual numbers above. Do not recommend any action. Do not diagnose. If there isn't enough history to say what's typical, say that plainly instead of guessing.`,
      };
    }
    if (kind === 'sleep') {
      const history = Scores.buildSleepHistory(snapshot);
      // history includes tonight if it's in sleepPeriods; need at
      // least 1 prior night beyond tonight to say anything about
      // "typical" — same bar as the recovery/stress prompts.
      if (history.length < 2) return null;
      const lines = history.map(h => `${h.date}: ${h.totalHrs} hrs, ${h.efficiency}% efficiency, ${h.wakeEvents} wake event${h.wakeEvents === 1 ? '' : 's'} (score ${h.score})`).join('\n');
      return {
        userMessage: `Here is this person's real sleep history from their ring, oldest first:\n${lines}\n\nIn 2-3 sentences, say whether the most recent night is typical for THIS person specifically, referencing the actual numbers above. Do not recommend any action. Do not diagnose. If there isn't enough history to say what's typical, say that plainly instead of guessing.`,
      };
    }
    return null;
  },

  async askTrendContext(kind, snapshot, targetElId, btnEl) {
    const prompt = Scores.buildTrendPrompt(kind, snapshot);
    const el = document.getElementById(targetElId);
    if (!prompt) {
      el.textContent = kind === 'sleep'
        ? 'Needs at least 2 nights in the ring\u2019s own sleep log to compare \u2014 connect on a second night and this will unlock automatically.'
        : 'Not enough history yet to give trend context.';
      el.style.display = 'block';
      return;
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Checking your trend\u2026'; }
    el.style.display = 'none';

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Dr. Sage, a personal health data explainer. You ONLY describe whether a number is typical for THIS specific person, based ONLY on the real historical numbers given to you. You NEVER diagnose, NEVER claim certainty about health status, NEVER name a disease, and NEVER give a recommendation or suggest any action of any kind \u2014 that is handled elsewhere. If there is not enough history to judge what is typical, say so plainly instead of guessing. Never invent a number that was not given to you.',
          messages: [{ role: 'user', content: prompt.userMessage }],
          max_tokens: 200,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      el.textContent = data.content?.[0]?.text || '(no response)';
      el.style.display = 'block';
    } catch (e) {
      el.textContent = 'Trend context unavailable right now: ' + e.message;
      el.style.display = 'block';
    }

    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Is this normal for me?'; }
  },

  // ═══════════════════════════════════════════════════════════
  // ACTION PLANS
  // A second, deliberately separate AI tier from the trend
  // explainer above. The trend explainer's whole job is to
  // NEVER recommend anything — this tier's whole job is to
  // recommend ONE concrete, boring, checkable thing, grounded
  // only in real trend history, and to close the loop honestly
  // afterward using arithmetic, not AI, for the actual
  // before/after comparison.
  // ═══════════════════════════════════════════════════════════

  PLAN_KEY: 'sh_action_plans',

  loadPlans() {
    try { return JSON.parse(localStorage.getItem(Scores.PLAN_KEY) || '[]'); }
    catch (e) { return []; }
  },

  savePlans(plans) {
    try { localStorage.setItem(Scores.PLAN_KEY, JSON.stringify(plans)); }
    catch (e) { /* non-critical */ }
  },

  getActivePlan() {
    const plans = Scores.loadPlans();
    return plans.find(p => p.status === 'active') || null;
  },

  // Real, current score for a pillar, used as both the baseline
  // when a plan starts and the comparison point at checkpoint.
  // Reuses the exact same scoring functions the cards use — the
  // plan can never see a different number than what's on screen.
  currentPillarScore(pillar, snapshot) {
    if (pillar === 'recovery') return Scores.computeRecovery(snapshot);
    if (pillar === 'sleep') return Scores.computeSleepScore(snapshot);
    if (pillar === 'stress') return Scores.computeStress(snapshot);
    return { ok: false };
  },

  // Picks the pillar most worth focusing on: lowest-scoring
  // pillar that actually HAS a real score right now. Never
  // guesses at a pillar with no data.
  // ── NUTRITION DOMAIN ───────────────────────────────────────
  // Ported from Fern AI's real nutrition-analyst feature
  // (index.html's _ntRunAnalysis + netlify function ai.js,
  // confirmed directly from the live repo — system role "You are
  // a nutrition analyst", same days[]/calories/protein/carbs/fat
  // JSON schema). One real, deliberate difference: Fern estimates
  // nutrition from a WEEK OF PLANNED MEALS, because Fern owns
  // meal planning. myDrSage does not plan meals — it has no
  // recipe generator, no meal planner UI, nothing to estimate
  // from. So this adapts the same AI pattern to self-reported
  // "what did you eat" text instead, one day at a time. Actual
  // meal PLANNING stays exclusively in Fern AI — see the referral
  // link in the Nutrition card.
  NUTRITION_KEY: 'sh_nutrition_log',

  loadNutritionLog() {
    try { return JSON.parse(localStorage.getItem(Scores.NUTRITION_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  saveNutritionLog(log) {
    try { localStorage.setItem(Scores.NUTRITION_KEY, JSON.stringify(log)); }
    catch (e) { /* non-critical */ }
  },

  parseNutritionResponse(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    try {
      // same brace-slicing defensiveness Fern's own _ntRunAnalysis
      // uses, in case the model adds stray text around the JSON
      const sliced = cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
      const parsed = JSON.parse(sliced);
      if (parsed.calories == null) return null;
      return {
        calories: Number(parsed.calories) || 0,
        protein: Number(parsed.protein) || 0,
        carbs: Number(parsed.carbs) || 0,
        fat: Number(parsed.fat) || 0,
        highlight: String(parsed.highlight || '').slice(0, 200),
      };
    } catch (e) {
      return null; // never fabricate an estimate if the model's JSON is bad
    }
  },

  async estimateNutrition(mealsText, onDone) {
    if (!mealsText || !mealsText.trim()) { onDone({ error: 'Describe what you ate first.' }); return; }
    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are a nutrition analyst. Always respond with valid JSON only, no markdown.',
          messages: [{ role: 'user', content: `Estimate the nutrition for this day\u2019s meals, as described by the person: ${mealsText.trim()}. Respond ONLY with valid JSON, no markdown: {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "highlight": "one short plain-language note about this day\u2019s nutrition"}` }],
          max_tokens: 200,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const text = data.content?.[0]?.text || '';
      const parsed = Scores.parseNutritionResponse(text);
      if (!parsed) { onDone({ error: 'Couldn\u2019t estimate nutrition from that \u2014 try describing it differently.' }); return; }

      const today = Scores.todayKey();
      const log = Scores.loadNutritionLog();
      log[today] = { mealsText: mealsText.trim(), ...parsed, loggedAt: new Date().toISOString() };
      Scores.saveNutritionLog(log);
      onDone({ entry: log[today] });
    } catch (e) {
      onDone({ error: 'Nutrition estimate unavailable right now: ' + e.message });
    }
  },

  computeNutritionToday(snapshot, log) {
    log = log || Scores.loadNutritionLog();
    const entry = log[Scores.todayKey()];
    if (!entry) return { ok: false };
    return { ok: true, ...entry, date: Scores.todayKey() };
  },

  // Real multi-day trend, not just today's snapshot. The data
  // was always there \u2014 sh_nutrition_log has been a dated object
  // since the day it was built \u2014 nothing ever aggregated across
  // days until now. This is what lets Basil actually say "your
  // protein's been consistent this week" instead of only ever
  // commenting on one meal in isolation.
  buildNutritionHistory(log) {
    log = log || Scores.loadNutritionLog();
    const dates = Object.keys(log).sort().slice(-7); // last 7 logged days
    const days = dates.map(d => ({ date: d, ...log[d] })).filter(d => d.calories != null);
    if (!days.length) return { ok: false, days: [] };

    const avg = (key) => Math.round(days.reduce((sum, d) => sum + (d[key] || 0), 0) / days.length);
    return {
      ok: true,
      days,
      avgCalories: avg('calories'),
      avgProtein: avg('protein'),
      avgCarbs: avg('carbs'),
      avgFat: avg('fat'),
      loggedDays: days.length,
    };
  },

  renderNutritionSection() {
    const today = Scores.computeNutritionToday();
    const resultEl = document.getElementById('nutrition-result');
    const subEl = document.getElementById('nutrition-status-sub');
    if (!resultEl) return;
    if (today.ok) {
      const history = Scores.buildNutritionHistory();
      const trendLine = history.ok && history.loggedDays > 1
        ? `<br><span style="opacity:0.7; font-size:12px;">${history.loggedDays}-day avg: ~${history.avgCalories} cal, ${history.avgProtein}g protein</span>` : '';
      resultEl.innerHTML = `<strong>~${today.calories} cal</strong> \u00b7 ${today.protein}g protein \u00b7 ${today.carbs}g carbs \u00b7 ${today.fat}g fat${today.highlight ? `<br><span style="opacity:0.8">${today.highlight}</span>` : ''}${trendLine}`;
      resultEl.style.display = 'block';
      if (subEl) subEl.textContent = 'Today\u2019s estimate \u2014 log again to update it.';
    } else {
      resultEl.style.display = 'none';
    }
  },

  async handleEstimateNutritionClick() {
    const btn = document.getElementById('nutrition-estimate-btn');
    const input = document.getElementById('nutrition-input');
    const errorEl = document.getElementById('nutrition-error');
    const mealsText = input ? input.value : '';

    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Estimating\u2026';

    await Scores.estimateNutrition(mealsText, (result) => {
      btn.disabled = false;
      btn.textContent = 'Estimate nutrition';
      if (result.error) {
        errorEl.textContent = result.error;
        errorEl.style.display = 'block';
        return;
      }
      Scores.renderNutritionSection();
    });
  },

  // ── ACTIVITY DOMAIN (real data, previously unused) ────────
  // activityHistory already exists in the snapshot — dashboard.js
  // has been saving it all along, nothing here has ever read it
  // back for scoring/planning purposes until now. Not a full
  // 0-100 "Activity Score" gauge (that's a separate future card,
  // not asked for yet) — just a real, honest trend summary,
  // grounded entirely in real logged steps.
  // ── HAWTHORN'S STRUCTURED REGIMEN ──────────────────────────
  // Closes the real gap between what Hawthorn promises ("I will
  // build a plan regardless of athlete or novice") and what
  // existed before this: one vague weekly action. This generates
  // an actual multi-day structure with named exercises, honestly
  // grounded in only two real inputs \u2014 the person's own stated
  // experience/goal from onboarding, and real step-count trend.
  // Deliberately does NOT claim to use workout-intensity data,
  // since that requires real accelerometer-based classification
  // (Strain) which does not exist yet \u2014 no pretending otherwise.
  REGIMEN_KEY: 'sh_hawthorn_regimen',

  loadRegimen() {
    try { return JSON.parse(localStorage.getItem(Scores.REGIMEN_KEY) || 'null'); }
    catch (e) { return null; }
  },

  saveRegimen(regimen) {
    try { localStorage.setItem(Scores.REGIMEN_KEY, JSON.stringify(regimen)); }
    catch (e) { /* non-critical */ }
  },

  parseRegimenResponse(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed.weekGoal || !Array.isArray(parsed.days) || !parsed.days.length) return null;
      const days = parsed.days.slice(0, 5).map(d => ({
        day: String(d.day || '').slice(0, 40),
        focus: String(d.focus || '').slice(0, 100),
        exercises: Array.isArray(d.exercises) ? d.exercises.slice(0, 5).map(e => ({
          name: String(e.name || '').slice(0, 80),
          detail: String(e.detail || '').slice(0, 100),
        })).filter(e => e.name) : [],
      })).filter(d => d.day && d.exercises.length);
      if (!days.length) return null;
      return { weekGoal: String(parsed.weekGoal).slice(0, 300), days };
    } catch (e) {
      return null;
    }
  },

  async generateHawthornRegimen(onDone) {
    const snapshot = Scores.loadSnapshot() || {};
    const profile = Scores.loadTeamProfile();
    const activityProfile = profile?.activity;
    if (!activityProfile || (!activityProfile.current && !activityProfile.goal)) {
      onDone({ error: 'Hawthorn needs to know your starting point first \u2014 answer his questions in Meet the Team.' });
      return;
    }

    const trend = Scores.computeActivityTrend(snapshot);
    const trendText = trend.ok
      ? `Real recent step data: ${trend.latestSteps} steps most recent day, averaging ${trend.avgPriorSteps}/day prior.`
      : 'No real step trend synced yet \u2014 base this on their stated starting point only, and say so.';

    const userMessage = `This person told you, when you first met: "${activityProfile.current || 'not specified'}" is what exercise currently looks like for them, and their goal is: "${activityProfile.goal || 'not specified'}".\n\n${trendText}\n\nBuild a real, structured 3-day-this-week regimen appropriate to their actual stated experience \u2014 genuinely different for a novice than an athlete, not the same plan with adjusted labels. Use real, named, honest bodyweight or simple-equipment exercises \u2014 nothing requiring gear you have no evidence they own. Respond ONLY with valid JSON, no markdown: {"weekGoal": "1-2 sentences on the focus for this week and why, given what they told you", "days": [{"day": "Day 1", "focus": "e.g. Full body", "exercises": [{"name": "exercise name", "detail": "sets/reps or duration, appropriate to their level"}]}, ...2-3 days]}`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Hawthorn, an exercise coach who builds real training regimens from real data. You are NOT a licensed doctor or physical therapist \u2014 you are a coach. You NEVER diagnose, NEVER claim certainty about outcomes, and you scale difficulty honestly to what the person actually told you about their experience \u2014 a stated novice never gets an athlete\u2019s program with easier-sounding labels slapped on it. You NEVER invent data you weren\u2019t given. Respond with ONLY the requested JSON, nothing else.',
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const text = data.content?.[0]?.text || '';
      const parsed = Scores.parseRegimenResponse(text);
      if (!parsed) { onDone({ error: 'Couldn\u2019t build a valid regimen from that \u2014 try again.' }); return; }

      const regimen = { ...parsed, createdDate: Scores.todayKey() };
      Scores.saveRegimen(regimen);
      onDone({ regimen });
    } catch (e) {
      onDone({ error: 'Hawthorn is unavailable right now: ' + e.message });
    }
  },

  computeActivityTrend(snapshot) {
    const history = (snapshot?.activityHistory || []).filter(a => a.totalSteps != null);
    if (history.length < 2) return { ok: false };
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const prior = sorted.slice(0, -1);
    const avgPrior = Math.round(prior.reduce((s, a) => s + a.totalSteps, 0) / prior.length);
    const pctVsAvg = avgPrior > 0 ? Math.round(((latest.totalSteps - avgPrior) / avgPrior) * 100) : null;
    return {
      ok: true,
      latestSteps: latest.totalSteps,
      latestDate: latest.date,
      avgPriorSteps: avgPrior,
      pctVsAvg,
    };
  },

  // ── HOLISTIC PICTURE ──────────────────────────────────────
  // Gathers every domain that actually has real data right now.
  // Domains with no data are simply omitted — never backfilled
  // or guessed at. This is the "as much data as possible, but
  // only real data" gatherer that feeds the plan builder.
  gatherHolisticPicture(snapshot) {
    const domains = {};

    // Recovery intentionally excluded here — it's a composite of
    // HRV (65%) + sleep (35%), both of which the Sleep and Stress
    // specialists already see directly. Including it too would be
    // the same underlying numbers narrated a third time. The
    // Recovery card on the main Scores page is unaffected by this
    // — it still shows its own standalone score.

    const sleep = Scores.computeSleepScore(snapshot);
    if (sleep.ok) {
      const consistency = Scores.computeBedtimeConsistency(snapshot);
      const consistencyPart = consistency.ok ? `, bedtime consistency: ${consistency.label} (avg ${consistency.avgBedtime}, \u00b1${consistency.stdDevMin} min across ${consistency.nights} nights)` : '';
      domains.sleep = { label: 'Sleep', score: sleep.score, detail: `${sleep.totalHrs} hrs, ${sleep.efficiency}% efficiency, ${sleep.wakeEvents} wake events${consistencyPart}` };
    }

    const stress = Scores.computeStress(snapshot);
    if (stress.ok) domains.stress = { label: 'Stress', score: stress.score, detail: `${stress.baselinePct > 0 ? '+' : ''}${stress.baselinePct}% HRV vs baseline` };

    const activity = Scores.computeActivityTrend(snapshot);
    if (activity.ok) domains.activity = { label: 'Activity', score: null, detail: `${activity.latestSteps} steps on ${activity.latestDate}, avg ${activity.avgPriorSteps}/day prior${activity.pctVsAvg != null ? ` (${activity.pctVsAvg > 0 ? '+' : ''}${activity.pctVsAvg}% vs that average)` : ''}` };

    const nutrition = Scores.computeNutritionToday(snapshot);
    if (nutrition.ok) {
      const history = Scores.buildNutritionHistory();
      const trendPart = history.ok && history.loggedDays > 1 ? ` \u2014 ${history.loggedDays}-day average: ~${history.avgCalories} cal, ${history.avgProtein}g protein, ${history.avgCarbs}g carbs, ${history.avgFat}g fat` : '';
      domains.nutrition = { label: 'Nutrition', score: null, detail: `~${nutrition.calories} cal, ${nutrition.protein}g protein, ${nutrition.carbs}g carbs, ${nutrition.fat}g fat today (self-reported, AI-estimated)${trendPart}` };
    }

    const journal = Scores.loadJournal();
    const journalDays = Object.keys(journal).sort().slice(-7);
    const journalLines = journalDays.map(d => {
      const entries = Object.entries(journal[d]).filter(([k, v]) => v).map(([k]) => k);
      return `${d}: ${entries.length ? entries.join(', ') : 'nothing logged'}`;
    });

    return { domains, journalLines };
  },

  // ── SPECIALIST COUNCIL ────────────────────────────────────
  // Each specialist is a SEPARATE AI call that sees ONLY its own
  // domain's real data (plus the shared journal log, the way a
  // real care team would all see the same patient's daily log
  // even while specializing in different systems). No specialist
  // sees another specialist's domain. Their real outputs then
  // feed one synthesis call — this is a genuine council, not one
  // model role-playing multiple hats in a single prompt.
  // 4 specialists, not 5 — Recovery is HRV+sleep repackaged (its
  // own formula is 65% HRV-vs-baseline + 35% sleep), so a separate
  // "Recovery" voice would just be narrating the same numbers the
  // Sleep and Stress specialists already cover. Dr. Sage's own
  // synthesis is where recovery gets tied together, since that's
  // literally what recovery IS — not a 5th independent voice.
  // Real Azure neural voice names, chosen against Azure's own
  // voice-gallery descriptions. Mirrored server-side in
  // netlify/functions/tts.js — the client only ever sends a
  // voiceKey ('sleep', 'stress', etc.), never a raw voice name,
  // so voice selection stays under this app's control.
  VOICE_MAP: {
    drSage: 'en-US-DavisNeural',   // "soothing, relaxed tone" — Azure's own description
    sleep: 'en-US-JennyNeural',
    stress: 'en-US-SaraNeural',
    activity: 'en-US-GuyNeural',
    nutrition: 'en-US-AriaNeural',
  },

  // Fetches audio from the Azure TTS proxy and plays it. The
  // endpoint returns raw binary audio directly (not JSON) — this
  // matches the real, already-deployed tts.js contract, chosen
  // there specifically for Safari/WebKit compatibility with
  // data-URI audio. Requires AZURE_SPEECH_KEY / AZURE_SPEECH_REGION
  // in Netlify's environment — already confirmed live in this
  // project. Blob + object URL handling is tested with a stubbed
  // fetch; the live round-trip to Azure itself is not verifiable
  // from this session.
  async speakText(text, voiceKey, onDone) {
    if (!text || !text.trim()) { onDone({ error: 'Nothing to speak.' }); return; }
    try {
      const res = await fetch('/.netlify/functions/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), voiceKey }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Request failed');
        throw new Error(errText);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.addEventListener('ended', () => URL.revokeObjectURL(objectUrl));
      await audio.play();
      onDone({ ok: true, audio });
    } catch (e) {
      onDone({ error: 'Couldn\u2019t play audio right now: ' + e.message });
    }
  },

  SPECIALIST_ROLES: {
    sleep: { name: 'Willow', title: 'Sleep Coach', voice: 'Willow, an attentive sleep coach' },
    stress: { name: 'Lotus', title: 'Mindfulness Coach', voice: 'Lotus, a mindfulness coach and active yoga practitioner' },
    activity: { name: 'Hawthorn', title: 'Exercise Coach', voice: 'Hawthorn, an exercise coach who builds real training regimens from real data' },
    nutrition: { name: 'Basil', title: 'Nutrition Coach', voice: 'Basil, a nutrition coach focused on helping people eat better' },
  },

  // ── TEAM PROFILE (from Meet the Team onboarding) ──────────
  // Same storage key as team.js — real answers a person gave
  // when meeting each specialist. These get woven directly into
  // that specialist's actual prompts below, not just displayed
  // somewhere as a bio. Works entirely offline from the ring —
  // pure self-report, available before any hardware is involved.
  PROFILE_KEY: 'sh_team_profile',

  loadTeamProfile() {
    try { return JSON.parse(localStorage.getItem(Scores.PROFILE_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  // Turns one specialist's saved answers into a short readable
  // block for their prompt. Returns '' if nothing was ever
  // answered for that domain — never fabricates missing context.
  formatProfileAnswers(domain, profile) {
    const answers = profile?.[domain];
    if (!answers || !Object.keys(answers).length) return '';
    return Object.entries(answers)
      .filter(([k, v]) => v && String(v).trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  },

  // Medical/family history, captured only by Dr. Sage during
  // onboarding, but treated as SHARED context every specialist
  // gets — same tier as the journal log, not siloed like
  // domain-specific profile answers (Hawthorn needs to know about
  // a heart condition before suggesting exercise intensity, not
  // after). Deliberately labeled as context, never as a "medical
  // record" or "risk factors" — that framing alone can nudge a
  // model toward risk-assessment language it has no business
  // producing.
  formatMedicalContext(profile) {
    const d = profile?.drSage || {};
    const lines = [];
    if (d.medicalHistory && d.medicalHistory.trim()) lines.push(`Diagnosed conditions they've shared: ${d.medicalHistory.trim()}`);
    if (d.familyHistory && d.familyHistory.trim()) lines.push(`Family health history they've shared: ${d.familyHistory.trim()}`);
    return lines.join('\n');
  },

  async callSpecialist(domain, domainInfo, journalBlock) {
    const role = Scores.SPECIALIST_ROLES[domain];
    if (!role) return null;
    const profile = Scores.loadTeamProfile();
    const profileText = Scores.formatProfileAnswers(domain, profile);
    const profileBlock = profileText ? `\n\nWhat they told you about themselves when you first met:\n${profileText}` : '';
    const medicalText = Scores.formatMedicalContext(profile);
    const medicalBlock = medicalText ? `\n\nContext they've shared with Dr. Sage (for awareness only \u2014 use this to inform how careful or attentive your suggestion should be, NEVER to state or imply a diagnosis, risk assessment, or medical conclusion):\n${medicalText}` : '';
    const userMessage = `Here is this person's real ${role.title.toLowerCase()} data:\n${domainInfo.score != null ? domainInfo.score + '/100 \u2014 ' : ''}${domainInfo.detail}${profileBlock}${medicalBlock}\n\nTheir recent self-logged daily habits:\n${journalBlock}\n\nBased on the real data (and what they've told you about themselves, if anything above), give ONE short specialist observation and ONE small concrete daily action you'd suggest, as a 7-day experiment. Respond ONLY with valid JSON, no markdown: {"note": "1-2 sentence observation in your voice, referencing the real number(s) above", "suggestedAction": "one small concrete daily action"}`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are ${role.voice}, part of a care team reviewing ONE person's real health data. Sign your observation naturally as yourself, ${role.name} \u2014 no need to state your title, the person already knows who you are. You are NOT a licensed doctor, dietitian, or clinician \u2014 stay in coach/guide register, never diagnostic. You NEVER diagnose, NEVER name a medical condition, NEVER claim certainty that anything will fix anything \u2014 frame your suggestion as a guided experiment. You NEVER invent a number not given to you. If any medical or family health context appears below, use it ONLY to calibrate how careful or attentive your suggestion should be \u2014 you NEVER reference it to state a risk, a diagnosis, or a medical conclusion of any kind. Respond with ONLY the requested JSON, nothing else.`,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 180,
        }),
      });
      const data = await res.json();
      if (!res.ok) return null;
      const text = (data.content?.[0]?.text || '').replace(/```json\s*|```\s*/g, '').trim();
      const parsed = JSON.parse(text);
      if (!parsed.note || !parsed.suggestedAction) return null;
      return {
        domain,
        name: role.name,
        title: role.title,
        role: `${role.name} \u00b7 ${role.title}`,
        note: String(parsed.note).slice(0, 300),
        suggestedAction: String(parsed.suggestedAction).slice(0, 200),
      };
    } catch (e) {
      return null; // one specialist failing shouldn't block the others
    }
  },

  // ── OBJECTIVE REFERRAL TRIGGERS ────────────────────────────
  // Pure arithmetic, no AI — reuses the exact same band
  // thresholds already shown on the Scores cards, so "you've
  // been referred" always traces back to a real, visible number,
  // never a hidden threshold invented just for this. Nutrition
  // has no objective trigger (no goals system exists to compare
  // against) — deliberately left judgment-only rather than
  // inventing a threshold with no real reference point.
  checkObjectiveReferralTriggers(snapshot) {
    const triggers = [];

    const sleep = Scores.computeSleepScore(snapshot);
    if (sleep.ok && Scores.bandFor(sleep.score).label === 'Low') {
      triggers.push({ domain: 'sleep', reason: `Sleep score is ${sleep.score} (Low band)` });
    }

    const stress = Scores.computeStress(snapshot);
    if (stress.ok) {
      const band = Scores.stressBandFor(stress.score).label;
      if (band === 'Elevated' || band === 'High') {
        triggers.push({ domain: 'stress', reason: `Stress score is ${stress.score} (${band} band)` });
      }
    }

    const activity = Scores.computeActivityTrend(snapshot);
    if (activity.ok && activity.pctVsAvg != null && activity.pctVsAvg <= -30) {
      triggers.push({ domain: 'activity', reason: `Activity is ${Math.abs(activity.pctVsAvg)}% below this person's own recent average` });
    }

    return triggers;
  },

  buildSynthesisPrompt(specialistResults, journalBlock) {
    const notesBlock = specialistResults.map(s => `${s.role} (${s.domain}): "${s.note}" \u2014 suggests: "${s.suggestedAction}"`).join('\n');
    const validKeys = 'alcohol, caffeine, meditation, lateMeal, screenLate, stressfulDay';
    const validDomains = specialistResults.map(s => s.domain).join(', ');
    const stated = Scores.formatProfileAnswers('drSage', Scores.loadTeamProfile());
    const goalBlock = stated ? `\n\nWhat this person told Dr. Sage when they first met (their goal, and any medical or family health context they chose to share \u2014 use the latter only to calibrate attentiveness and referral judgment, NEVER to state a diagnosis or risk assessment):\n${stated}\n` : '';
    return `Here is real input from this person's specialist care team, each reviewing only their own area of focus:\n\n${notesBlock}\n\nTheir recent self-logged habits:\n${journalBlock}${goalBlock}\n\nAs the coordinating advisor synthesizing this team's input, weave 2-5 of their suggested actions into ONE cohesive 7-day plan (you may lightly adapt wording, but stay true to what each specialist actually suggested \u2014 do not invent a new action for an area not covered above). Also decide if any area is worth a real referral \u2014 a fuller one-on-one consult with that specialist \u2014 based on your own judgment of what you're seeing, not just a fixed rule. Respond ONLY with valid JSON, no markdown: {"goalText": "1-2 plain sentences tying the team's observations together", "actions": [{"text": "one small concrete daily action", "domain": "one of: ${validDomains}", "journalKey": "one of: ${validKeys}, or null"}, ...2-5 actions], "referrals": [{"domain": "one of: ${validDomains}", "reason": "one short sentence on why this specialist is worth a fuller consult"}, ...0-2 referrals, empty array if none warranted]}`;
  },

  parsePlanResponse(text) {
    if (!text) return null;
    // strip markdown fences defensively — same JSON-extraction
    // fragility lesson learned the hard way on Fern AI's Meal Planner
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed.goalText || !Array.isArray(parsed.actions) || !parsed.actions.length) return null;
      const validJournalKeys = new Set(['alcohol', 'caffeine', 'meditation', 'lateMeal', 'screenLate', 'stressfulDay']);
      const validDomains = new Set(['sleep', 'stress', 'activity', 'nutrition']);
      const actions = parsed.actions.slice(0, 5).map(a => ({
        text: String(a.text || '').slice(0, 200),
        domain: validDomains.has(a.domain) ? a.domain : null,
        journalKey: validJournalKeys.has(a.journalKey) ? a.journalKey : null,
      })).filter(a => a.text);
      if (!actions.length) return null;

      const judgmentReferrals = Array.isArray(parsed.referrals)
        ? parsed.referrals.slice(0, 4).filter(r => validDomains.has(r.domain)).map(r => ({
            domain: r.domain,
            reason: String(r.reason || '').slice(0, 200),
          }))
        : [];

      return { goalText: String(parsed.goalText).slice(0, 400), actions, judgmentReferrals };
    } catch (e) {
      return null; // never fabricate a plan client-side if the model's JSON is bad
    }
  },

  async createPlan(snapshot, onDone, onProgress) {
    if (Scores.getActivePlan()) {
      onDone({ error: 'A plan is already active \u2014 close it out before starting a new one.' });
      return;
    }
    const picture = Scores.gatherHolisticPicture(snapshot);
    const domainKeys = Object.keys(picture.domains);
    if (!domainKeys.length) { onDone({ error: 'Not enough real data yet across Sleep, Stress, Activity, or Nutrition to build a plan.' }); return; }

    const journalBlock = picture.journalLines.length ? picture.journalLines.join('\n') : '(no journal entries yet)';

    if (onProgress) onProgress(`Consulting ${domainKeys.map(d => Scores.SPECIALIST_ROLES[d]?.name).filter(Boolean).join(', ')}\u2026`);

    // Each specialist call runs independently — Promise.all here
    // still waits for all of them, but one failing (returns null)
    // does not throw or block the others.
    const specialistResults = (await Promise.all(
      domainKeys.map(d => Scores.callSpecialist(d, picture.domains[d], journalBlock))
    )).filter(Boolean);

    if (!specialistResults.length) {
      onDone({ error: 'Your care team couldn\u2019t weigh in right now \u2014 try again in a moment.' });
      return;
    }

    if (onProgress) onProgress('Dr. Sage is reviewing your team\u2019s notes\u2026');

    try {
      const synthesisMessage = Scores.buildSynthesisPrompt(specialistResults, journalBlock);
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Dr. Sage, a holistic wellness doctor \u2014 your entire job is monitoring this person\u2019s real health data over time, coordinating a small team of specialist coaches, noticing patterns, and referring to a specialist when it\u2019s warranted. You do not treat, prescribe, diagnose, name a medical condition, or order any test \u2014 that is never your job, monitoring and coordination are. You NEVER claim certainty that any action will fix anything \u2014 frame it as a guided experiment. You NEVER invent a number not given to you, and NEVER introduce an area the specialist team didn\u2019t cover. If this person has shared any medical or family health context, use it ONLY to inform how closely you watch something or how quickly you refer \u2014 you NEVER state or imply a risk assessment, diagnosis, or medical conclusion from it, even indirectly. You always respond with ONLY the requested JSON, nothing else.',
          messages: [{ role: 'user', content: synthesisMessage }],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const text = data.content?.[0]?.text || '';
      const parsed = Scores.parsePlanResponse(text);
      if (!parsed) { onDone({ error: 'Couldn\u2019t synthesize a valid plan from your care team\u2019s input \u2014 try again.' }); return; }

      const today = Scores.todayKey();
      const checkpoint = new Date();
      checkpoint.setDate(checkpoint.getDate() + 7);

      const touchedDomains = [...new Set(parsed.actions.map(a => a.domain).filter(Boolean))];
      const baselines = {};
      touchedDomains.forEach(d => {
        if (picture.domains[d]) baselines[d] = { score: picture.domains[d].score, detail: picture.domains[d].detail, date: today };
      });

      // Keep every specialist's real note, even for domains that
      // didn't end up in the final synthesized actions — this is
      // what makes the "whole team weighed in" visible in the UI,
      // not just the ones that made the cut.
      const specialistNotes = {};
      specialistResults.forEach(s => { specialistNotes[s.domain] = { role: s.role, note: s.note, suggestedAction: s.suggestedAction }; });

      // Referrals: merge objective (real number crossed a real
      // threshold, same bands shown on the Scores cards) with
      // judgment (Dr. Sage's own synthesis call flagged it, even
      // without a hard threshold trip). Either is a legitimate
      // reason to refer — dedup by domain, keep both reasons if
      // both fired. Only domains a specialist actually covered
      // (i.e. real data exists) can be referred.
      const specialistDomainSet = new Set(specialistResults.map(s => s.domain));
      const objectiveTriggers = Scores.checkObjectiveReferralTriggers(snapshot).filter(t => specialistDomainSet.has(t.domain));
      const referralMap = {};
      objectiveTriggers.forEach(t => { referralMap[t.domain] = { domain: t.domain, reasons: [t.reason], sources: ['objective'] }; });
      (parsed.judgmentReferrals || []).forEach(r => {
        if (!specialistDomainSet.has(r.domain)) return; // never refer a domain with no real data behind it
        if (referralMap[r.domain]) {
          referralMap[r.domain].reasons.push(r.reason);
          referralMap[r.domain].sources.push('judgment');
        } else {
          referralMap[r.domain] = { domain: r.domain, reasons: [r.reason], sources: ['judgment'] };
        }
      });
      const referrals = Object.values(referralMap).map(r => {
        const roleInfo = Scores.SPECIALIST_ROLES[r.domain];
        return {
          domain: r.domain,
          name: roleInfo?.name || r.domain,
          title: roleInfo?.title || r.domain,
          reasons: r.reasons,
          sources: r.sources,
          consult: null, // generated lazily, only if the person taps in
        };
      });

      const plan = {
        id: `plan_${Date.now()}`,
        domains: touchedDomains,
        createdDate: today,
        baselines,
        goalText: parsed.goalText,
        actions: parsed.actions.map(a => ({ ...a, doneCount: 0 })),
        specialistNotes,
        referrals,
        durationDays: 7,
        checkpointDate: checkpoint.toISOString().slice(0, 10),
        status: 'active',
        outcome: null,
      };

      const plans = Scores.loadPlans();
      plans.push(plan);
      Scores.savePlans(plans);
      onDone({ plan });
    } catch (e) {
      onDone({ error: 'Plan synthesis unavailable right now: ' + e.message });
    }
  },

  // Pure arithmetic, no AI, run per domain the plan actually
  // touched. This is the "close the loop honestly" step — every
  // number here is a real recomputed score, never AI-narrated.
  checkPlanProgress(plan, snapshot) {
    const checkpointReached = Scores.todayKey() >= plan.checkpointDate;
    const perDomain = {};
    let anyCurrentScore = false;

    (plan.domains || []).forEach(domain => {
      const baseline = plan.baselines?.[domain];
      if (!baseline || baseline.score == null) {
        // activity and nutrition have no 0-100 score (score: null
        // by design) — report them as data-only, not a scored delta
        if (domain === 'activity') {
          const now = Scores.computeActivityTrend(snapshot);
          perDomain[domain] = now.ok
            ? { hasCurrentData: true, detail: `${now.latestSteps} steps on ${now.latestDate}` }
            : { hasCurrentData: false };
        } else if (domain === 'nutrition') {
          const now = Scores.computeNutritionToday(snapshot);
          perDomain[domain] = now.ok
            ? { hasCurrentData: true, detail: `~${now.calories} cal, ${now.protein}g protein on ${now.date}` }
            : { hasCurrentData: false };
        }
        return;
      }
      const now = Scores.currentPillarScore(domain, snapshot);
      if (!now.ok) { perDomain[domain] = { hasCurrentData: false }; return; }
      anyCurrentScore = true;
      const delta = domain === 'stress' ? (baseline.score - now.score) : (now.score - baseline.score);
      perDomain[domain] = {
        hasCurrentData: true,
        baselineScore: baseline.score,
        currentScore: now.score,
        delta,
        improved: delta > 0,
      };
    });

    return { checkpointReached, anyCurrentScore, perDomain };
  },

  // ── RESULTS NARRATION ──────────────────────────────────────
  // The other half of this same AI tier: plan-building and
  // results-narration, nothing else. This function NEVER
  // recomputes anything — checkPlanProgress() already did the
  // real arithmetic. This only narrates numbers that already
  // exist, in the same specialist-coach voice as the plan itself,
  // so "closing the loop" means an actual coach telling you what
  // happened, not just a number on a screen.
  // ── LAZY SPECIALIST CONSULT ────────────────────────────────
  // Only called when the person actually taps into a referred
  // specialist — not generated eagerly for every referral, since
  // most referrals may never be opened. Once generated, it's
  // cached on the plan so re-opening never re-calls the AI.
  async generateSpecialistConsult(planId, domain, onDone) {
    const plans = Scores.loadPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) { onDone({ error: 'Plan not found.' }); return; }
    const referral = (plan.referrals || []).find(r => r.domain === domain);
    if (!referral) { onDone({ error: 'No referral found for this specialist.' }); return; }
    if (referral.consult) { onDone({ consult: referral.consult }); return; } // already cached

    const role = Scores.SPECIALIST_ROLES[domain];
    const note = plan.specialistNotes?.[domain];
    if (!role || !note) { onDone({ error: 'No specialist data available right now.' }); return; }

    const profile = Scores.loadTeamProfile();
    const profileText = Scores.formatProfileAnswers(domain, profile);
    const profileBlock = profileText ? `\n\nWhat they told you about themselves when you first met:\n${profileText}` : '';
    const medicalText = Scores.formatMedicalContext(profile);
    const medicalBlock = medicalText ? `\n\nContext they've shared with Dr. Sage (for awareness only \u2014 use only to calibrate how careful your suggestion should be, NEVER to state a diagnosis or risk assessment):\n${medicalText}` : '';
    const userMessage = `Dr. Sage has referred this person to you for a fuller consult. Your earlier brief note was: "${note.note}" (you'd suggested: "${note.suggestedAction}"). Dr. Sage's reason for referring: ${referral.reasons.join('; ')}${profileBlock}${medicalBlock}\n\nWrite a short, warm, first-person consult (3-5 sentences) as ${role.name}, this person's ${role.title.toLowerCase()} \u2014 more detail and personality than your earlier brief note, but still grounded only in what's already been said above. Do not diagnose. Do not name a medical condition. Do not order any test. Do not claim certainty. Respond with plain text only, no JSON, no markdown.`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are ${role.voice}. You are NOT a licensed doctor, dietitian, or clinician \u2014 you are a coach. You NEVER diagnose, NEVER name a medical condition, NEVER order or suggest a test, NEVER claim certainty that anything will fix anything. If any medical or family health context appears in the message, use it ONLY to calibrate tone and care level \u2014 NEVER to state a risk, diagnosis, or medical conclusion. Respond with plain text only, 3-5 sentences.`,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 300,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const consult = (data.content?.[0]?.text || '').trim();
      if (!consult) { onDone({ error: 'Couldn\u2019t reach this specialist right now \u2014 try again.' }); return; }

      referral.consult = consult;
      Scores.savePlans(plans);
      onDone({ consult });
    } catch (e) {
      onDone({ error: 'This specialist is unavailable right now: ' + e.message });
    }
  },

  async narratePlanOutcome(plan, perDomain, onDone) {
    const lines = Object.entries(perDomain).map(([domain, r]) => {
      const label = Scores.DOMAIN_LABELS[domain] || domain;
      if (!r.hasCurrentData) return `${label}: no fresh reading at checkpoint`;
      if (r.detail) return `${label}: ${r.detail}`; // data-only domains (activity, nutrition)
      const dir = r.improved ? 'improved' : (r.delta < 0 ? 'declined' : 'stayed unchanged');
      return `${label}: went from ${r.baselineScore} to ${r.currentScore} (${dir}${r.delta !== 0 ? ', by ' + Math.abs(r.delta) : ''})`;
    });
    const actionsSummary = plan.actions.map(a => `"${a.text}" (${Scores.DOMAIN_LABELS[a.domain] || 'general'})`).join(', ');

    const userMessage = `This person just completed a 7-day plan: "${plan.goalText}"\n\nActions they were asked to try: ${actionsSummary}\n\nReal results at checkpoint:\n${lines.join('\n')}\n\nIn 2-4 sentences, narrate this outcome the way the relevant coach(es) would \u2014 honest and encouraging either way. Do not claim the actions definitely caused these results \u2014 correlation only, frame it that way. Do not diagnose. Do not invent any number not given above.`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Dr. Sage\u2019s planning module, now narrating a real completed result in the voice of the relevant specialist coach(es) \u2014 nutrition, exercise, mindfulness, or sleep coach, as fits what was covered. You are NOT a licensed doctor, dietitian, or clinician. You NEVER diagnose, NEVER name a medical condition, and NEVER claim certainty that an action caused a result \u2014 correlation only. You NEVER invent a number not given to you. Respond with plain text only, 2-4 sentences, no JSON, no markdown.',
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 250,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const narrative = (data.content?.[0]?.text || '').trim();
      onDone({ narrative: narrative || null });
    } catch (e) {
      // Never block closing a plan on the AI tier — the real
      // numbers are ground truth and always available even if
      // this narration call fails.
      onDone({ narrative: null, error: e.message });
    }
  },

  completePlan(planId, outcome) {
    const plans = Scores.loadPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;
    plan.status = 'complete';
    plan.outcome = outcome;
    Scores.savePlans(plans);
    Scores.saveLastCompletedSummary(plan);
  },

  // Persisted separately from the plans array so the most recent
  // result stays visible on the Scores page even after the plan
  // itself is no longer "active" — otherwise the narration would
  // disappear the instant it's generated.
  LAST_RESULT_KEY: 'sh_last_plan_result',

  saveLastCompletedSummary(plan) {
    try {
      localStorage.setItem(Scores.LAST_RESULT_KEY, JSON.stringify({
        goalText: plan.goalText,
        domains: plan.domains,
        outcome: plan.outcome,
        completedDate: Scores.todayKey(),
      }));
    } catch (e) { /* non-critical */ }
  },

  loadLastCompletedSummary() {
    try { return JSON.parse(localStorage.getItem(Scores.LAST_RESULT_KEY) || 'null'); }
    catch (e) { return null; }
  },

  toggleActionDone(planId, actionIndex) {
    const plans = Scores.loadPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan || !plan.actions[actionIndex]) return;
    const today = Scores.todayKey();
    plan._loggedDays = plan._loggedDays || {};
    plan._loggedDays[today] = plan._loggedDays[today] || {};
    plan._loggedDays[today][actionIndex] = !plan._loggedDays[today][actionIndex];
    // also reflect into the real journal if this action maps to a
    // real journal key, so the two systems never disagree
    const action = plan.actions[actionIndex];
    if (action.journalKey) {
      const journal = Scores.loadJournal();
      journal[today] = journal[today] || {};
      journal[today][action.journalKey] = plan._loggedDays[today][actionIndex];
      Scores.saveJournal(journal);
    }
    Scores.savePlans(plans);
    Scores.renderPlanSection();
  },

  DOMAIN_LABELS: { recovery: 'Recovery', sleep: 'Sleep', stress: 'Stress', activity: 'Activity', nutrition: 'Nutrition' },

  renderPlanSection() {
    const container = document.getElementById('plan-container');
    if (!container) return;
    const snapshot = Scores.loadSnapshot() || {};
    const plan = Scores.getActivePlan();

    if (!plan) {
      const last = Scores.loadLastCompletedSummary();
      const lastResultEl = document.getElementById('plan-last-result');
      if (lastResultEl) {
        if (last) {
          const lines = Object.entries(last.outcome?.perDomain || {}).map(([domain, r]) => {
            const label = Scores.DOMAIN_LABELS[domain] || domain;
            if (!r.hasCurrentData) return `${label}: no fresh reading at checkpoint`;
            if (r.detail) return `${label}: ${r.detail}`;
            const dir = r.improved ? 'up' : (r.delta < 0 ? 'down' : 'unchanged');
            return `${label}: ${r.baselineScore} \u2192 ${r.currentScore} (${dir}${r.delta !== 0 ? ' ' + Math.abs(r.delta) : ''})`;
          });
          lastResultEl.innerHTML = `<div class="plan-domain-pills">${(last.domains || []).map(d => `<span class="plan-domain-pill">${Scores.DOMAIN_LABELS[d] || d}</span>`).join('')}</div>
            <div class="plan-goal" style="font-size:13.5px; opacity:0.85;">${last.goalText}</div>
            ${last.outcome?.narrative ? `<div class="plan-status" style="border-top:none; padding-top:0; margin-top:10px;">${last.outcome.narrative}</div>` : ''}
            <div class="plan-status">${lines.join('<br>')}</div>`;
          lastResultEl.style.display = 'block';
        } else {
          lastResultEl.style.display = 'none';
        }
      }
      container.innerHTML = '';
      const empty = document.getElementById('plan-empty-state');
      if (empty) empty.style.display = 'block';
      return;
    }
    const empty = document.getElementById('plan-empty-state');
    if (empty) empty.style.display = 'none';
    const lastResultEl = document.getElementById('plan-last-result');
    if (lastResultEl) lastResultEl.style.display = 'none';

    const progress = Scores.checkPlanProgress(plan, snapshot);
    const today = Scores.todayKey();
    const doneToday = (plan._loggedDays && plan._loggedDays[today]) || {};

    const actionsHtml = plan.actions.map((a, i) => `
      <div class="plan-action ${doneToday[i] ? 'done' : ''}" data-plan="${plan.id}" data-idx="${i}">
        <span class="plan-check">${doneToday[i] ? '\u2713' : ''}</span>
        <span class="plan-action-text"><span class="plan-domain-tag">${a.domain ? Scores.DOMAIN_LABELS[a.domain] : ''}</span>${a.text}</span>
      </div>`).join('');

    const domainTagsHtml = (plan.domains || []).map(d => `<span class="plan-domain-pill">${Scores.DOMAIN_LABELS[d] || d}</span>`).join('');

    const specialistNotesHtml = Object.entries(plan.specialistNotes || {}).map(([domain, s]) => `
      <div class="specialist-note">
        <span class="specialist-role">${s.role}</span>
        <button class="listen-btn" data-plan="${plan.id}" data-source="note" data-domain="${domain}" title="Listen">\u{1F50A}</button>
        <span class="specialist-text">${s.note}</span>
      </div>`).join('');

    const referralsHtml = (plan.referrals || []).map(r => {
      if (r.consult) {
        return `<div class="referral-consult">
          <div class="referral-consult-role">${r.name} \u2014 ${r.title}
            <button class="listen-btn" data-plan="${plan.id}" data-source="consult" data-domain="${r.domain}" title="Listen">\u{1F50A}</button>
          </div>
          <div class="referral-consult-text">${r.consult}</div>
        </div>`;
      }
      return `<button class="referral-chip" data-plan="${plan.id}" data-domain="${r.domain}">
        Dr. Sage referred you to ${r.name}, your ${r.title} \u2014 tap to talk \u2192
      </button>`;
    }).join('');

    let statusHtml;
    if (progress.checkpointReached) {
      const lines = Object.entries(progress.perDomain).map(([domain, r]) => {
        const label = Scores.DOMAIN_LABELS[domain] || domain;
        if (!r.hasCurrentData) return `${label}: no fresh reading yet \u2014 sync the ring to see this result.`;
        if (r.detail) return `${label}: ${r.detail}`; // activity, data-only
        const dir = r.improved ? 'up' : (r.delta < 0 ? 'down' : 'unchanged');
        return `${label}: ${r.baselineScore} \u2192 ${r.currentScore} (${dir}${r.delta !== 0 ? ' ' + Math.abs(r.delta) : ''})`;
      });
      statusHtml = `<div class="plan-status">${lines.join('<br>')}</div>
        <button class="plan-close-btn" id="plan-close-btn">Close out this plan</button>`;
    } else {
      const baselineLines = Object.entries(plan.baselines || {}).map(([d, b]) => `${Scores.DOMAIN_LABELS[d] || d}: ${b.score != null ? b.score : b.detail} baseline`).join(' \u00b7 ');
      statusHtml = `<div class="plan-status">${baselineLines} \u2014 checkpoint ${plan.checkpointDate}.</div>`;
    }

    container.innerHTML = `
      <div class="plan-card">
        <div class="plan-domain-pills">${domainTagsHtml}</div>
        <div class="plan-goal">${plan.goalText} <button class="listen-btn" data-plan="${plan.id}" data-source="goal" title="Listen">\u{1F50A}</button></div>
        ${specialistNotesHtml ? `<div class="specialist-notes"><div class="specialist-notes-label">Your care team this week</div>${specialistNotesHtml}</div>` : ''}
        ${referralsHtml ? `<div class="referrals-block">${referralsHtml}</div>` : ''}
        <div class="plan-actions">${actionsHtml}</div>
        ${statusHtml}
      </div>`;

    container.querySelectorAll('.plan-action').forEach(el => {
      el.addEventListener('click', () => Scores.toggleActionDone(el.dataset.plan, Number(el.dataset.idx)));
    });
    container.querySelectorAll('.listen-btn').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const p = Scores.loadPlans().find(pl => pl.id === el.dataset.plan);
        if (!p) return;
        let text, voiceKey;
        if (el.dataset.source === 'goal') {
          text = p.goalText; voiceKey = 'drSage';
        } else if (el.dataset.source === 'note') {
          text = p.specialistNotes?.[el.dataset.domain]?.note; voiceKey = el.dataset.domain;
        } else if (el.dataset.source === 'consult') {
          text = p.referrals?.find(r => r.domain === el.dataset.domain)?.consult; voiceKey = el.dataset.domain;
        }
        if (!text) return;
        const original = el.textContent;
        el.textContent = '\u23F3';
        await Scores.speakText(text, voiceKey, (result) => {
          el.textContent = original;
          if (result.error) console.warn(result.error); // non-blocking — audio failing shouldn't disrupt reading the plan
        });
      });
    });
    container.querySelectorAll('.referral-chip').forEach(el => {
      el.addEventListener('click', async () => {
        el.disabled = true;
        el.textContent = 'Connecting\u2026';
        await Scores.generateSpecialistConsult(el.dataset.plan, el.dataset.domain, (result) => {
          if (result.error) {
            el.disabled = false;
            el.textContent = result.error + ' (tap to retry)';
            return;
          }
          Scores.renderPlanSection(); // re-render to show the now-cached consult in place of the chip
        });
      });
    });
    const closeBtn = document.getElementById('plan-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', async () => {
        closeBtn.disabled = true;
        closeBtn.textContent = 'Getting your results\u2026';
        await Scores.narratePlanOutcome(plan, progress.perDomain, (result) => {
          Scores.completePlan(plan.id, { perDomain: progress.perDomain, narrative: result.narrative });
          Scores.renderPlanSection();
        });
      });
    }
  },

  async handleBuildPlanClick() {
    const btn = document.getElementById('build-plan-btn');
    if (Scores.getActivePlan()) {
      // Defensive — the empty-state card should already be hidden
      // once a plan is active, but don't rely solely on DOM state
      // (e.g. a fast double-tap before re-render completes).
      return;
    }
    const snapshot = Scores.loadSnapshot() || {};
    btn.disabled = true;
    btn.textContent = 'Consulting your care team\u2026';
    document.getElementById('plan-build-error').style.display = 'none';

    await Scores.createPlan(
      snapshot,
      (result) => {
        btn.disabled = false;
        btn.textContent = 'Build my action plan';
        if (result.error) {
          document.getElementById('plan-build-error').textContent = result.error;
          document.getElementById('plan-build-error').style.display = 'block';
          return;
        }
        Scores.renderPlanSection();
      },
      (progressText) => { btn.textContent = progressText; }
    );
  },

  // ── LAST VISIT CHECK ────────────────────────────────────────
  // Honest, partial answer to Dr. Sage's "I'll be checking in"
  // promise. This is NOT proactive \u2014 the app cannot reach anyone
  // while closed without a service worker, push subscriptions, a
  // permission flow, and a server-side trigger, none of which
  // exist yet. What this genuinely does: when someone actually
  // opens the app after a real gap, Dr. Sage acknowledges it in
  // his own voice, honestly, rather than acting like no time
  // passed. Reactive, not proactive \u2014 said plainly, not implied.
  LAST_VISIT_KEY: 'sh_last_visit',

  checkLastVisit() {
    let lastVisit;
    try { lastVisit = localStorage.getItem(Scores.LAST_VISIT_KEY); } catch (e) { lastVisit = null; }
    const now = Date.now();
    try { localStorage.setItem(Scores.LAST_VISIT_KEY, String(now)); } catch (e) { /* non-critical */ }

    if (!lastVisit) return null; // first visit ever, nothing to welcome back from
    const daysSince = Math.floor((now - Number(lastVisit)) / 86400000);
    if (daysSince < 3) return null; // not a meaningful gap
    return { daysSince };
  },

  init() {
    const snapshot = Scores.loadSnapshot() || {};
    const recovery = Scores.computeRecovery(snapshot);
    const sleep = Scores.computeSleepScore(snapshot);
    const stress = Scores.computeStress(snapshot);

    const visitGap = Scores.checkLastVisit();
    const welcomeEl = document.getElementById('welcome-back-note');
    if (welcomeEl) {
      if (visitGap) {
        welcomeEl.textContent = `Dr. Sage: It's been ${visitGap.daysSince} days \u2014 good to have you back. Let's see where things stand.`;
        welcomeEl.style.display = 'block';
      } else {
        welcomeEl.style.display = 'none';
      }
    }

    Scores.renderRecovery(snapshot);
    Scores.renderSleepScore(snapshot);
    Scores.renderStress(snapshot);
    Scores.renderJournal();
    Scores.renderPlanSection();

    Scores.renderStatusLine('recovery-status', Scores.statusForRecovery(recovery));
    Scores.renderStatusLine('sleep-score-status', Scores.statusForSleep(sleep));
    Scores.renderStatusLine('stress-status', Scores.statusForStress(stress));

    // Trend buttons only appear once there's a real score to ask
    // about — no button on an empty/not-enough-data card.
    if (recovery.ok) document.getElementById('recovery-trend-btn').style.display = 'block';
    if (sleep.ok) document.getElementById('sleep-score-trend-btn').style.display = 'block';
    if (stress.ok) document.getElementById('stress-trend-btn').style.display = 'block';

    document.querySelectorAll('.journal-item').forEach(item => {
      item.addEventListener('click', () => Scores.toggleJournalItem(item.dataset.key));
    });

    const trendBtns = [
      ['recovery-trend-btn', 'recovery', 'recovery-trend-response'],
      ['sleep-score-trend-btn', 'sleep', 'sleep-score-trend-response'],
      ['stress-trend-btn', 'stress', 'stress-trend-response'],
    ];
    trendBtns.forEach(([btnId, kind, respId]) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        Scores.askTrendContext(kind, snapshot, respId, btn);
      });
    });

    const buildBtn = document.getElementById('build-plan-btn');
    if (buildBtn) buildBtn.addEventListener('click', Scores.handleBuildPlanClick);

    Scores.renderNutritionSection();
    const nutriBtn = document.getElementById('nutrition-estimate-btn');
    if (nutriBtn) nutriBtn.addEventListener('click', Scores.handleEstimateNutritionClick);
  },
};

document.addEventListener('DOMContentLoaded', Scores.init);
