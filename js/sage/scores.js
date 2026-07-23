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
  // ── CALIBRATION FRESHNESS GATE ─────────────────────────────
  // General, reusable protocol: some metrics need a genuinely
  // CURRENT reading, not just a reading that existed at some
  // point. This is Dr. Sage's protocol, enforced directly \u2014 a
  // stale estimate presented as current isn't a soft imperfection,
  // it's actively misleading, so it doesn't get shown at all.
  // Built generally so any future metric requiring periodic
  // recalibration (not just Stress) can use the same gate.
  // ── STRIKES & THE AFFIRMATION GATE ─────────────────────────
  // Three real misses is a genuine signal the current rhythm
  // isn't working \u2014 that deserves something different from the
  // same nudge repeated a fourth time. Deliberately NOT a verdict
  // on the person ("you're not serious") \u2014 shame-based
  // accountability measurably reduces follow-through in real
  // behavior-change research, which matters directly for a
  // product whose users have often already been burned by exactly
  // that kind of framing elsewhere. Instead: Dr. Sage reflects
  // their own original stated goal back and asks them to affirm
  // it again \u2014 a real recommitment, not a punitive hurdle.
  STRIKES_KEY: 'sh_calibration_strikes',

  loadStrikes() {
    try { return JSON.parse(localStorage.getItem(Scores.STRIKES_KEY) || '[]'); }
    catch (e) { return []; }
  },

  saveStrikes(strikes) {
    try { localStorage.setItem(Scores.STRIKES_KEY, JSON.stringify(strikes)); }
    catch (e) { /* non-critical */ }
  },

  // Deduped per calendar day \u2014 viewing a stale card five times
  // in one day is one strike, not five. Returns the updated count.
  recordCalibrationStrike() {
    const strikes = Scores.loadStrikes();
    const today = Scores.todayKey();
    if (!strikes.includes(today)) {
      strikes.push(today);
      Scores.saveStrikes(strikes);
    }
    return strikes.length;
  },

  isLocked() {
    return Scores.loadStrikes().length >= 3;
  },

  // The real reset \u2014 clears strikes and updates their stored
  // goal with whatever they just affirmed (their own words, not
  // Dr. Sage's), so the affirmation is genuinely fresh, not
  // decorative.
  completeAffirmation(newGoalText) {
    const profile = Scores.loadTeamProfile();
    profile.drSage = profile.drSage || {};
    profile.drSage.goal = newGoalText;
    Scores.saveTeamProfile(profile);
    Scores.saveStrikes([]);
  },

  // Builds and wires the actual affirmation UI. Reflects the
  // person's own original words back \u2014 not a fresh question,
  // not Dr. Sage's words \u2014 theirs. Voice-first with a typed
  // fallback, matching the same pattern established in Meet the
  // Team, since this is meant to feel like a real moment, not a
  // form field.
  renderAffirmationGate() {
    const container = document.getElementById('stress-locked-block');
    if (!container) return;
    const profile = Scores.loadTeamProfile();
    const originalGoal = profile?.drSage?.goal;

    const reflection = originalGoal
      ? `When we first met, you told me: "${originalGoal}"`
      : `You never told me what you were here for when we first met \u2014 let's fix that now.`;

    container.innerHTML = `
      <div style="font-size:13.5px; line-height:1.5; margin-bottom:14px;"><strong>Dr. Sage:</strong> ${Scores.getPreferredName() ? Scores.getPreferredName() + ', three' : 'Three'} times now, the resting checks haven't kept up. That's a real pattern, not bad luck. Before this comes back, I want to hear it from you again.</div>
      <div style="font-size:14px; font-style:italic; color:#D0AAEE; margin-bottom:16px; padding:12px; background:rgba(255,255,255,0.05); border-radius:10px;">${reflection}</div>
      <div style="font-size:13px; font-weight:600; margin-bottom:10px;">Is this still true? Say it again, in your own words.</div>
      <button id="affirm-mic-btn" style="width:64px; height:64px; border-radius:50%; border:none; background:#7FC4C9; font-size:22px; margin-bottom:10px; cursor:pointer;">\u{1F3A4}</button>
      <div id="affirm-status" style="font-size:12px; color:#6B7280; margin-bottom:10px;">Tap to speak, or type below</div>
      <textarea id="affirm-text" placeholder="Type your answer\u2026" style="width:100%; min-height:60px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; color:#fff; font-family:inherit; font-size:13px; margin-bottom:12px;"></textarea>
      <button id="affirm-submit-btn" class="trend-btn" disabled>Affirm and continue</button>
    `;

    const textArea = document.getElementById('affirm-text');
    const submitBtn = document.getElementById('affirm-submit-btn');
    textArea.addEventListener('input', () => { submitBtn.disabled = !textArea.value.trim(); });

    const micBtn = document.getElementById('affirm-mic-btn');
    const statusEl = document.getElementById('affirm-status');
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      micBtn.addEventListener('click', () => {
        statusEl.textContent = 'Listening\u2026';
        const rec = new SpeechRec();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = (e) => {
          const transcript = e.results[0][0].transcript;
          textArea.value = transcript;
          submitBtn.disabled = false;
          statusEl.textContent = 'Got it';
        };
        rec.onerror = () => { statusEl.textContent = 'Didn\u2019t catch that \u2014 try typing instead'; };
        rec.start();
      });
    } else {
      micBtn.disabled = true;
      statusEl.textContent = 'Voice not available \u2014 type below';
    }

    submitBtn.addEventListener('click', () => {
      const value = textArea.value.trim();
      if (!value) return;
      Scores.completeAffirmation(value);
      const snapshot = Scores.loadSnapshot() || {};
      Scores.renderStress(snapshot);
    });
  },

  checkCalibrationFreshness(recordedAt, maxAgeHours = 48) {
    if (!recordedAt) return { fresh: false, hoursOld: null };
    const hoursOld = (Date.now() - new Date(recordedAt).getTime()) / 3600000;
    return { fresh: hoursOld <= maxAgeHours, hoursOld: Math.round(hoursOld) };
  },

  computeStress(snapshot) {
    const hrvHistory = (snapshot?.hrvHistory || []).filter(h => h.rmssd != null);
    if (hrvHistory.length < 3) {
      return { ok: false, have: hrvHistory.length };
    }

    const latest = hrvHistory[hrvHistory.length - 1];

    const freshness = Scores.checkCalibrationFreshness(latest.recordedAt, 48);
    if (!freshness.fresh) {
      const strikeCount = Scores.recordCalibrationStrike();
      if (strikeCount >= 3) {
        return { ok: false, stale: true, locked: true, hoursOld: freshness.hoursOld, strikeCount };
      }
      return { ok: false, stale: true, hoursOld: freshness.hoursOld, strikeCount };
    }

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
      const lockedEl = document.getElementById('stress-locked-block');
      if (result.locked) {
        emptyEl.style.display = 'none';
        bodyEl.style.display = 'none';
        dateEl.textContent = '--';
        if (lockedEl) { lockedEl.style.display = 'block'; Scores.renderAffirmationGate(); }
        return;
      }
      if (lockedEl) lockedEl.style.display = 'none';
      if (result.stale) {
        // Dr. Sage's protocol, in his voice \u2014 firm, direct, and
        // clear about WHY, not just that access is paused. Not
        // punitive, not a generic error \u2014 he's the one drawing
        // this line, and he says so.
        emptyEl.innerHTML = `<strong>Dr. Sage:</strong> ${Scores.getPreferredName() ? Scores.getPreferredName() + ', your' : 'Your'} last resting check was ${result.hoursOld} hours ago \u2014 that's too stale to trust. I don't show you a number I can't stand behind. Take a fresh resting check and this comes right back.`;
      } else {
        emptyEl.textContent = `Needs a few resting checks over time to learn your personal baseline before Stress can be scored (you have ${result.have}).`;
      }
      emptyEl.style.display = 'block';
      bodyEl.style.display = 'none';
      dateEl.textContent = '--';
      return;
    }
    const lockedElOk = document.getElementById('stress-locked-block');
    if (lockedElOk) lockedElOk.style.display = 'none';

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

  // ── WATER & CAFFEINE ──────────────────────────────────────
  // Real quantity tracking, not the old yes/no journal toggle
  // (kept as-is elsewhere for backward compatibility with the
  // weekly report). Caffeine specifically tracks a last-intake
  // TIME too, since that's what actually matters for Willow's
  // sleep coaching \u2014 amount alone doesn't tell her anything
  // about whether it's too close to bed.
  WATER_CAFFEINE_KEY: 'sh_water_caffeine',

  loadWaterCaffeine() {
    try { return JSON.parse(localStorage.getItem(Scores.WATER_CAFFEINE_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  saveWaterCaffeine(log) {
    try { localStorage.setItem(Scores.WATER_CAFFEINE_KEY, JSON.stringify(log)); }
    catch (e) { /* non-critical */ }
  },

  addWater(cups) {
    const log = Scores.loadWaterCaffeine();
    const today = Scores.todayKey();
    log[today] = log[today] || { waterCups: 0, caffeineMg: 0, caffeineLog: [] };
    log[today].waterCups += cups;
    Scores.saveWaterCaffeine(log);
    Scores.renderWaterCaffeine();
  },

  resetWater() {
    const log = Scores.loadWaterCaffeine();
    const today = Scores.todayKey();
    if (log[today]) log[today].waterCups = 0;
    Scores.saveWaterCaffeine(log);
    Scores.renderWaterCaffeine();
  },

  addCaffeine(mg, label) {
    const log = Scores.loadWaterCaffeine();
    const today = Scores.todayKey();
    log[today] = log[today] || { waterCups: 0, caffeineMg: 0, caffeineLog: [] };
    log[today].caffeineMg += mg;
    log[today].caffeineLog.push({ label, mg, time: new Date().toISOString() });
    Scores.saveWaterCaffeine(log);
    Scores.renderWaterCaffeine();
  },

  resetCaffeine() {
    const log = Scores.loadWaterCaffeine();
    const today = Scores.todayKey();
    if (log[today]) { log[today].caffeineMg = 0; log[today].caffeineLog = []; }
    Scores.saveWaterCaffeine(log);
    Scores.renderWaterCaffeine();
  },

  renderWaterCaffeine() {
    const log = Scores.loadWaterCaffeine();
    const today = log[Scores.todayKey()] || { waterCups: 0, caffeineMg: 0, caffeineLog: [] };
    document.getElementById('water-count').textContent = today.waterCups + (today.waterCups === 1 ? ' cup today' : ' cups today');
    document.getElementById('caffeine-count').textContent = today.caffeineMg + 'mg today';

    const timingNote = document.getElementById('caffeine-timing-note');
    if (today.caffeineLog.length) {
      const last = today.caffeineLog[today.caffeineLog.length - 1];
      const lastTime = new Date(last.time);
      const hoursAgo = Math.round((Date.now() - lastTime.getTime()) / 3600000 * 10) / 10;
      timingNote.textContent = `Last: ${last.label} \u2014 ${hoursAgo < 1 ? 'just now' : hoursAgo + 'h ago'}. Willow sees this real timing, not just the total.`;
    } else {
      timingNote.textContent = '';
    }
  },

  // ── ACTIVITY STATUS ────────────────────────────────────────
  // Manual override, not inferred \u2014 the person tells the team
  // directly rather than the data trying to guess. Feeds the
  // weekly report so a sick or traveling week gets real context
  // instead of being judged against a normal one.
  ACTIVITY_STATUS_KEY: 'sh_activity_status',

  loadActivityStatus() {
    try { return JSON.parse(localStorage.getItem(Scores.ACTIVITY_STATUS_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  saveActivityStatus(status) {
    const log = Scores.loadActivityStatus();
    log[Scores.todayKey()] = status;
    try { localStorage.setItem(Scores.ACTIVITY_STATUS_KEY, JSON.stringify(log)); }
    catch (e) { /* non-critical */ }
    Scores.renderActivityStatus();
  },

  renderActivityStatus() {
    const log = Scores.loadActivityStatus();
    const today = log[Scores.todayKey()] || 'normal';
    document.querySelectorAll('#activity-status-btns .wc-btn').forEach(btn => {
      const active = btn.dataset.status === today;
      btn.style.background = active ? 'rgba(143,181,150,0.16)' : 'rgba(243,239,230,0.04)';
      btn.style.borderColor = active ? '#8FB596' : 'rgba(243,239,230,0.15)';
      btn.style.color = active ? '#8FB596' : '#F3EFE6';
    });
  },

  // ── NOTES ──────────────────────────────────────────────────
  // A real free-text reflection, separate from the existing
  // habit-chip journal above (which stays as-is \u2014 different
  // thing, boolean toggles vs. someone's own words). One note per
  // day, overwritable if edited later the same day. Real tie-in:
  // referenced by count in the weekly report, not just displayed
  // and forgotten.
  NOTES_KEY: 'sh_daily_notes',

  loadNotes() {
    try { return JSON.parse(localStorage.getItem(Scores.NOTES_KEY) || '{}'); }
    catch (e) { return {}; }
  },

  saveNote(text) {
    const notes = Scores.loadNotes();
    const today = Scores.todayKey();
    if (text.trim()) notes[today] = { text: text.trim(), savedAt: new Date().toISOString() };
    else delete notes[today]; // saving empty clears today's note, doesn't leave a blank entry
    try { localStorage.setItem(Scores.NOTES_KEY, JSON.stringify(notes)); }
    catch (e) { /* non-critical */ }
    Scores.renderNotes();
  },

  renderNotes() {
    const notes = Scores.loadNotes();
    const today = Scores.todayKey();
    const input = document.getElementById('notes-input');
    if (input && document.activeElement !== input) input.value = (notes[today] && notes[today].text) || '';

    const dates = Object.keys(notes).sort().reverse().filter(d => d !== today).slice(0, 5);
    const history = document.getElementById('notes-history');
    if (!history) return;
    history.innerHTML = dates.map(d => {
      const label = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `<div class="note-row"><div class="note-date">${label}</div><div class="note-text">${notes[d].text}</div></div>`;
    }).join('');
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

  // The log used to store ONE entry per day, which silently
  // overwrote itself on a second meal \u2014 the exact thing that
  // made "log every time you eat" impossible. Now stores an array
  // per day. This normalizer is what keeps existing people's
  // already-saved single-entry days working: wraps the old shape
  // in an array instead of discarding real historical data.
  normalizeDayEntries(rawValue) {
    if (!rawValue) return [];
    return Array.isArray(rawValue) ? rawValue : [rawValue];
  },

  // Sums real logged entries for a day into one set of totals \u2014
  // used everywhere a day's total matters (today's card, weekly
  // trend, meal-plan coordination), while the entries themselves
  // stay individually visible in the running list.
  getDailyTotals(entries) {
    if (!entries.length) return null;
    const sum = (key) => entries.reduce((s, e) => s + (e[key] || 0), 0);
    return {
      calories: sum('calories'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'),
      fiber: sum('fiber'), sodium: sum('sodium'),
      count: entries.length,
      highlight: entries[entries.length - 1].highlight || '', // most recent real note, not a blended fabrication
    };
  },

  // Real, computed streak \u2014 consecutive calendar days with at
  // least one real logged entry, counting backward from today.
  // If nothing's logged yet today, still counts a live streak
  // through yesterday (common, honest streak UX \u2014 the streak
  // isn't broken until a full day passes with nothing logged).
  computeNutritionStreak(log) {
    log = log || Scores.loadNutritionLog();
    let streak = 0;
    let cursor = new Date();
    const hasEntry = (d) => {
      const key = d.toISOString().slice(0, 10);
      return Scores.normalizeDayEntries(log[key]).length > 0;
    };
    if (!hasEntry(cursor)) cursor.setDate(cursor.getDate() - 1); // today empty yet \u2014 check from yesterday instead
    while (hasEntry(cursor)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
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
        fiber: Number(parsed.fiber) || 0,
        sodium: Number(parsed.sodium) || 0,
        highlight: String(parsed.highlight || '').slice(0, 200),
      };
    } catch (e) {
      return null; // never fabricate an estimate if the model's JSON is bad
    }
  },

  // ── BASIL'S MEAL IDEAS (mini-Fern) ─────────────────────────
  // Real meal suggestions, not just macro estimation of what
  // was already eaten. Deliberately lighter than Fern AI's full
  // meal planner \u2014 no shopping lists, no multi-step cook mode,
  // no weekly grid. Just real, named meals matching what's
  // actually true about this person: their stated preferences,
  // their real logged nutrition trend, and \u2014 the genuine team
  // moment \u2014 what Hawthorn's regimen is asking of them this
  // week, if one exists. Full meal planning still belongs to
  // Fern; the referral link out stays for that.
  MEALS_KEY: 'sh_meal_ideas',

  loadMealIdeas() {
    try { return JSON.parse(localStorage.getItem(Scores.MEALS_KEY) || 'null'); }
    catch (e) { return null; }
  },

  saveMealIdeas(ideas) {
    try { localStorage.setItem(Scores.MEALS_KEY, JSON.stringify(ideas)); }
    catch (e) { /* non-critical */ }
  },

  parseMealIdeasResponse(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed.meals) || !parsed.meals.length) return null;
      const meals = parsed.meals.slice(0, 4).map(m => ({
        name: String(m.name || '').slice(0, 80),
        ingredients: Array.isArray(m.ingredients) ? m.ingredients.slice(0, 8).map(i => String(i).slice(0, 60)) : [],
        note: String(m.note || '').slice(0, 150),
      })).filter(m => m.name && m.ingredients.length);
      if (!meals.length) return null;
      return { intro: String(parsed.intro || '').slice(0, 200), meals };
    } catch (e) {
      return null;
    }
  },

  async generateMealIdeas(onDone) {
    const profile = Scores.loadTeamProfile();
    const nutritionProfile = profile?.nutrition;
    const restrictions = nutritionProfile?.restrictions || 'none specified';

    const history = Scores.buildNutritionHistory();
    const trendText = history.ok && history.loggedDays > 1
      ? `Their real logged average: ~${history.avgCalories} cal, ${history.avgProtein}g protein, ${history.avgCarbs}g carbs, ${history.avgFat}g fat per day.`
      : 'No real nutrition trend logged yet \u2014 base this on their stated preferences only.';

    // The real team-coordination moment: if Hawthorn has a
    // current regimen, Basil's suggestions genuinely reference
    // what it's actually asking of them this week.
    let regimenText = 'No current exercise regimen from Hawthorn to coordinate with.';
    try {
      const regimens = JSON.parse(localStorage.getItem('sh_hawthorn_regimens') || '[]');
      if (regimens.length) regimenText = `Hawthorn's regimen this week: "${regimens[regimens.length - 1].weekGoal}"`;
    } catch (e) { /* non-critical */ }

    const userMessage = `This person's stated dietary preferences/restrictions: ${restrictions}.${Scores.getPreferredName(profile) ? `\n\nCall them ${Scores.getPreferredName(profile)} \u2014 that's what they asked to be called.` : ''}\n\n${trendText}\n\n${regimenText}\n\nSuggest 3 real, specific meals that genuinely support what they're working on \u2014 not generic "eat healthy" ideas. Respect their stated restrictions exactly. If Hawthorn's regimen is real, let it inform your choices (e.g. more protein around a strength-focused week). Respond ONLY with valid JSON, no markdown: {"intro": "1 sentence tying these choices to what's actually going on for them", "meals": [{"name": "specific dish name", "ingredients": ["real ingredient", "..."], "note": "one short line \u2014 why this one, or a quick prep note"}, ...3 meals]}`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Basil, a nutrition coach focused on helping people eat better. Be direct and specific \u2014 real dish names and real ingredients, not vague categories. You are NOT a licensed dietitian \u2014 you are a coach. You NEVER diagnose, NEVER claim a meal will produce a specific health outcome, and you ALWAYS respect stated dietary restrictions exactly, never suggesting something that conflicts with them. You NEVER invent data you weren\u2019t given. Respond with ONLY the requested JSON, nothing else.',
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const text = data.content?.[0]?.text || '';
      const parsed = Scores.parseMealIdeasResponse(text);
      if (!parsed) { onDone({ error: 'Couldn\u2019t come up with meal ideas from that \u2014 try again.' }); return; }

      const result = { ...parsed, createdDate: Scores.todayKey() };
      Scores.saveMealIdeas(result);
      onDone({ ideas: result });
    } catch (e) {
      onDone({ error: 'Basil is unavailable right now: ' + e.message });
    }
  },

  // ── PHOTO-BASED NUTRITION LOGGING ──────────────────────────
  // Same model already used everywhere (qwen/qwen3.6-27b) natively
  // handles image input on Groq \u2014 no new model, no new provider,
  // no backend changes (the proxy already forwards whatever
  // message content it's given).
  //
  // Deliberately honest about what this is and isn't: real
  // research on AI food-photo estimation (even from apps built
  // specifically for this, not a general vision model like this
  // one) shows roughly 13-25% mean error on portion/calorie
  // estimates from an ordinary 2D photo, and real-world photos
  // perform WORSE than curated test images. This is a genuine
  // speed improvement over typing a description \u2014 not a claim
  // of precision. That's why this returns a DRAFT for the person
  // to confirm or adjust, never auto-saves \u2014 the actual research
  // finding is that AI plus a quick human correction beats either
  // alone.
  async estimateNutritionFromPhoto(base64Image, mimeType, onDone) {
    if (!base64Image) { onDone({ error: 'No photo to analyze.' }); return; }
    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Basil, a nutrition coach. Look at this real photo of a meal, identify what\u2019s actually in it as specifically as you can, and give your real best-estimate of its nutrition. Be direct and confident in your estimate \u2014 don\u2019t hedge with vague language \u2014 but the numbers themselves should be your genuine best read, not artificially precise. You are NOT a licensed dietitian. You NEVER invent an ingredient you can\u2019t actually see. Respond ONLY with valid JSON, no markdown.',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'What is this meal, and what\u2019s your real nutrition estimate for it? Respond ONLY with valid JSON, no markdown: {"description": "what you actually see in the photo, specific dish/ingredients", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "sodium": 0, "highlight": "one short plain-language note about this meal"}' },
              { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` } },
            ],
          }],
          max_tokens: 250,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const text = data.content?.[0]?.text || '';
      const parsed = Scores.parseNutritionPhotoResponse(text);
      if (!parsed) { onDone({ error: 'Couldn\u2019t read that photo clearly \u2014 try a clearer shot or type it instead.' }); return; }
      onDone({ draft: parsed }); // never saved yet \u2014 caller shows this for confirmation/editing first
    } catch (e) {
      onDone({ error: 'Photo analysis unavailable right now: ' + e.message });
    }
  },

  parseNutritionPhotoResponse(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.calories !== 'number') return null;
      return {
        description: String(parsed.description || '').slice(0, 300),
        calories: Math.round(parsed.calories) || 0,
        protein: Math.round(parsed.protein) || 0,
        carbs: Math.round(parsed.carbs) || 0,
        fat: Math.round(parsed.fat) || 0,
        fiber: Math.round(parsed.fiber) || 0,
        sodium: Math.round(parsed.sodium) || 0,
        highlight: String(parsed.highlight || '').slice(0, 200),
      };
    } catch (e) {
      return null;
    }
  },

  // Called only after the person has confirmed (and possibly
  // edited) the draft \u2014 saves using the exact same format and
  // key as the existing typed-description flow, so photo-logged
  // meals feed the same real history/trend system, not a
  // separate parallel one.
  saveConfirmedNutrition(entry) {
    const today = Scores.todayKey();
    const log = Scores.loadNutritionLog();
    const entries = Scores.normalizeDayEntries(log[today]);
    const saved = { mealsText: entry.description, calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat, fiber: entry.fiber || 0, sodium: entry.sodium || 0, highlight: entry.highlight, loggedAt: new Date().toISOString(), source: 'photo' };
    entries.push(saved);
    log[today] = entries;
    Scores.saveNutritionLog(log);
    return saved;
  },

  // Resizes/compresses a photo client-side before sending \u2014 phone
  // camera photos are often several MB; a food photo doesn't need
  // more than ~800px on the long edge for a vision model to read
  // it, and this keeps the request fast and the token cost sane.
  resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 800;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl.split(',')[1]); // strip the data: prefix, keep raw base64
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async handleNutritionPhotoSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('nutrition-photo-status');
    const errorEl = document.getElementById('nutrition-error');
    errorEl.style.display = 'none';
    statusEl.textContent = 'Basil is looking at your photo\u2026';
    statusEl.style.display = 'block';

    try {
      const base64 = await Scores.resizeImageFile(file);
      await Scores.estimateNutritionFromPhoto(base64, 'image/jpeg', (result) => {
        statusEl.style.display = 'none';
        if (result.error) {
          errorEl.textContent = result.error;
          errorEl.style.display = 'block';
          return;
        }
        document.getElementById('draft-description').value = result.draft.description;
        document.getElementById('draft-calories').value = result.draft.calories;
        document.getElementById('draft-protein').value = result.draft.protein;
        document.getElementById('draft-carbs').value = result.draft.carbs;
        document.getElementById('draft-fat').value = result.draft.fat;
        document.getElementById('draft-fiber').value = result.draft.fiber;
        document.getElementById('draft-sodium').value = result.draft.sodium;
        document.getElementById('nutrition-photo-draft').dataset.highlight = result.draft.highlight;
        document.getElementById('nutrition-photo-draft').style.display = 'block';
      });
    } catch (e) {
      statusEl.style.display = 'none';
      errorEl.textContent = 'Couldn\u2019t read that photo \u2014 try again.';
      errorEl.style.display = 'block';
    }
    event.target.value = ''; // allow re-selecting the same file next time
  },

  handleDraftSave() {
    const entry = {
      description: document.getElementById('draft-description').value.trim(),
      calories: Number(document.getElementById('draft-calories').value) || 0,
      protein: Number(document.getElementById('draft-protein').value) || 0,
      carbs: Number(document.getElementById('draft-carbs').value) || 0,
      fat: Number(document.getElementById('draft-fat').value) || 0,
      fiber: Number(document.getElementById('draft-fiber').value) || 0,
      sodium: Number(document.getElementById('draft-sodium').value) || 0,
      highlight: document.getElementById('nutrition-photo-draft').dataset.highlight || '',
    };
    Scores.saveConfirmedNutrition(entry);
    document.getElementById('nutrition-photo-draft').style.display = 'none';
    Scores.renderNutritionSection();
  },

  handleDraftCancel() {
    document.getElementById('nutrition-photo-draft').style.display = 'none';
  },

  async estimateNutrition(mealsText, onDone) {
    if (!mealsText || !mealsText.trim()) { onDone({ error: 'Describe what you ate first.' }); return; }
    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are a nutrition analyst. Always respond with valid JSON only, no markdown.',
          messages: [{ role: 'user', content: `Estimate the nutrition for this day\u2019s meals, as described by the person: ${mealsText.trim()}. Respond ONLY with valid JSON, no markdown: {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "sodium": 0, "highlight": "one short plain-language note about this day\u2019s nutrition"}` }],
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
      const entries = Scores.normalizeDayEntries(log[today]);
      const saved = { mealsText: mealsText.trim(), ...parsed, loggedAt: new Date().toISOString(), source: 'typed' };
      entries.push(saved);
      log[today] = entries;
      Scores.saveNutritionLog(log);
      onDone({ entry: saved });
    } catch (e) {
      onDone({ error: 'Nutrition estimate unavailable right now: ' + e.message });
    }
  },

  computeNutritionToday(snapshot, log) {
    log = log || Scores.loadNutritionLog();
    const entries = Scores.normalizeDayEntries(log[Scores.todayKey()]);
    if (!entries.length) return { ok: false, entries: [] };
    const totals = Scores.getDailyTotals(entries);
    return { ok: true, ...totals, entries, date: Scores.todayKey() };
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
    const days = dates
      .map(d => ({ date: d, ...Scores.getDailyTotals(Scores.normalizeDayEntries(log[d])) }))
      .filter(d => d.calories != null);
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
    const streakEl = document.getElementById('nutrition-streak');
    if (!resultEl) return;

    const streak = Scores.computeNutritionStreak();
    if (streakEl) {
      streakEl.textContent = streak > 0 ? `${streak}-day logging streak` : '';
      streakEl.style.display = streak > 0 ? 'block' : 'none';
    }

    if (today.ok) {
      const history = Scores.buildNutritionHistory();
      const trendLine = history.ok && history.loggedDays > 1
        ? `<br><span style="opacity:0.7; font-size:12px;">${history.loggedDays}-day avg: ~${history.avgCalories} cal, ${history.avgProtein}g protein</span>` : '';
      const entriesHtml = today.entries.map(e => `
        <div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-top:1px solid rgba(243,239,230,0.08); font-size:12.5px;">
          <span style="opacity:0.85;">${(e.mealsText || '').slice(0, 40)}${(e.mealsText || '').length > 40 ? '\u2026' : ''}</span>
          <span style="opacity:0.6; flex-shrink:0;">${e.calories} cal</span>
        </div>`).join('');
      resultEl.innerHTML = `<strong>~${today.calories} cal today</strong> \u00b7 ${today.protein}g protein \u00b7 ${today.carbs}g carbs \u00b7 ${today.fat}g fat \u00b7 ${today.fiber}g fiber \u00b7 ${today.sodium}mg sodium${today.highlight ? `<br><span style="opacity:0.8">${today.highlight}</span>` : ''}${trendLine}${entriesHtml}`;
      resultEl.style.display = 'block';
      if (subEl) subEl.textContent = `${today.entries.length} logged today \u2014 snap another anytime you eat.`;
    } else {
      resultEl.style.display = 'none';
      if (subEl) subEl.textContent = '';
    }
  },

  // ── MEAL REMINDER NOTIFICATIONS ─────────────────────────────
  // Actively solicited, not just available \u2014 shown once, real
  // permission request, real PushManager subscription, real
  // storage server-side (save-push-subscription.js). Every state
  // reflects what actually happened: denied stays denied, no
  // silent re-prompting, no fake "enabled" state if the VAPID
  // keys aren't configured yet.
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  },

  initMealReminderBanner() {
    const banner = document.getElementById('meal-reminder-banner');
    if (!banner) return;
    const dismissed = localStorage.getItem('sh_meal_reminder_dismissed') === 'true';
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const alreadyDecided = supported && Notification.permission !== 'default';
    banner.style.display = (!dismissed && supported && !alreadyDecided) ? 'block' : 'none';

    if (supported && Notification.permission === 'granted' && localStorage.getItem('sh_meal_reminder_subscribed') === 'true') {
      const status = document.getElementById('meal-reminder-status');
      if (status) { status.textContent = 'Meal reminders are on.'; status.style.display = 'block'; }
    }
  },

  dismissMealReminderBanner() {
    localStorage.setItem('sh_meal_reminder_dismissed', 'true');
    document.getElementById('meal-reminder-banner').style.display = 'none';
  },

  async enableMealReminders() {
    const banner = document.getElementById('meal-reminder-banner');
    const status = document.getElementById('meal-reminder-status');
    const btn = document.getElementById('meal-reminder-enable-btn');
    btn.disabled = true;
    btn.textContent = 'Turning on\u2026';

    const showStatus = (text) => { status.textContent = text; status.style.display = 'block'; };

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      showStatus('Push notifications aren\u2019t supported in this browser.');
      banner.style.display = 'none';
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showStatus(permission === 'denied' ? 'Notifications are blocked \u2014 you can change this in your browser settings anytime.' : 'No problem \u2014 you can turn this on later.');
        banner.style.display = 'none';
        return;
      }

      const keyRes = await fetch('/.netlify/functions/get-vapid-public-key');
      if (!keyRes.ok) {
        showStatus('Meal reminders aren\u2019t fully set up on the server yet \u2014 try again later.');
        banner.style.display = 'none';
        return;
      }
      const { publicKey } = await keyRes.json();

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Scores.urlBase64ToUint8Array(publicKey),
      });

      const saveRes = await fetch('/.netlify/functions/save-push-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), reminderType: 'meal_reminder' }),
      });
      if (!saveRes.ok) throw new Error('Could not save subscription');

      localStorage.setItem('sh_meal_reminder_subscribed', 'true');
      showStatus('Meal reminders are on \u2014 around typical mealtimes.');
      banner.style.display = 'none';
    } catch (e) {
      showStatus('Couldn\u2019t turn on reminders right now: ' + e.message);
      btn.disabled = false;
      btn.textContent = 'Turn on meal reminders';
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
          system: 'You are Hawthorn, an exercise coach who builds real training regimens from real data. Be direct and confident \u2014 tell them what to do, don\u2019t hedge on the plan itself. You are NOT a licensed doctor or physical therapist \u2014 you are a coach. You NEVER diagnose, NEVER claim certainty about outcomes, and you scale difficulty honestly to what the person actually told you about their experience \u2014 a stated novice never gets an athlete\u2019s program with easier-sounding labels slapped on it. You NEVER invent data you weren\u2019t given. Respond with ONLY the requested JSON, nothing else.',
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

  // Real regimen adherence, matching the same fix already applied
  // to Basil's nutrition history \u2014 uses the same sh_hawthorn_regimens
  // array regimen.html now maintains, so his background notes can
  // reference actual follow-through, not just step trend.
  summarizeRegimenAdherence() {
    let history;
    try { history = JSON.parse(localStorage.getItem('sh_hawthorn_regimens') || '[]'); }
    catch (e) { return null; }
    if (!history.length) return null;
    const current = history[history.length - 1];
    let total = 0, done = 0;
    current.days.forEach(d => d.exercises.forEach(e => { total++; if (e.done) done++; }));
    if (!total) return null;
    return { weekGoal: current.weekGoal, done, total, pct: Math.round((done / total) * 100) };
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
    if (activity.ok) {
      const adherence = Scores.summarizeRegimenAdherence();
      const adherencePart = adherence ? `, current regimen: ${adherence.done}/${adherence.total} exercises done (${adherence.pct}%)` : '';
      domains.activity = { label: 'Activity', score: null, detail: `${activity.latestSteps} steps on ${activity.latestDate}, avg ${activity.avgPriorSteps}/day prior${activity.pctVsAvg != null ? ` (${activity.pctVsAvg > 0 ? '+' : ''}${activity.pctVsAvg}% vs that average)` : ''}${adherencePart}` };
    }

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
  currentAudio: null,

  stopSpeaking() {
    if (Scores.currentAudio) {
      try { Scores.currentAudio.pause(); } catch (e) { /* already stopped */ }
      Scores.currentAudio = null;
    }
  },

  async speakText(text, voiceKey, onDone) {
    if (!text || !text.trim()) { onDone({ error: 'Nothing to speak.' }); return; }
    Scores.stopSpeaking(); // real fix for overlapping/double-speak audio \u2014 a new speak always cuts off whatever was still playing
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
      Scores.currentAudio = audio;
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(objectUrl);
        if (Scores.currentAudio === audio) Scores.currentAudio = null;
      });
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

  // Shared across every specialist \u2014 collected once, by Dr. Sage,
  // during his first onboarding question. Returns null (never a
  // fabricated default) if it was never answered.
  getPreferredName(profile) {
    profile = profile || Scores.loadTeamProfile();
    const name = profile?.drSage?.preferredName;
    return (name && name.trim()) ? name.trim() : null;
  },

  // scores.js has only ever READ the team profile until now \u2014
  // completeAffirmation() is the first place it needs to write
  // back, since re-affirming a goal genuinely updates it. Uses
  // the exact same storage key team.html itself writes to.
  saveTeamProfile(profile) {
    try { localStorage.setItem(Scores.PROFILE_KEY, JSON.stringify(profile)); }
    catch (e) { /* non-critical */ }
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
    const s = profile?.stress || {};
    const lines = [];
    if (d.medicalHistory && d.medicalHistory.trim()) lines.push(`Diagnosed conditions they've shared: ${d.medicalHistory.trim()}`);
    if (d.familyHistory && d.familyHistory.trim()) lines.push(`Family health history they've shared: ${d.familyHistory.trim()}`);
    if (s.sleepAids && s.sleepAids.trim()) lines.push(`Over-the-counter sleep aids they've mentioned using: ${s.sleepAids.trim()}`);
    return lines.join('\n');
  },

  async callSpecialist(domain, domainInfo, journalBlock) {
    const role = Scores.SPECIALIST_ROLES[domain];
    if (!role) return null;
    const profile = Scores.loadTeamProfile();
    const preferredName = Scores.getPreferredName(profile);
    const nameBlock = preferredName ? `\n\nCall them ${preferredName} \u2014 that's what they asked to be called.` : '';
    const profileText = Scores.formatProfileAnswers(domain, profile);
    const profileBlock = profileText ? `\n\nWhat they told you about themselves when you first met:\n${profileText}` : '';
    const medicalText = Scores.formatMedicalContext(profile);
    const medicalBlock = medicalText ? `\n\nContext they've shared with Dr. Sage (for awareness only \u2014 use this to inform how careful or attentive your suggestion should be, NEVER to state or imply a diagnosis, risk assessment, or medical conclusion, and NEVER to suggest starting, stopping, or changing any medication or supplement):\n${medicalText}` : '';
    const userMessage = `Here is this person's real ${role.title.toLowerCase()} data:\n${domainInfo.score != null ? domainInfo.score + '/100 \u2014 ' : ''}${domainInfo.detail}${nameBlock}${profileBlock}${medicalBlock}\n\nTheir recent self-logged daily habits:\n${journalBlock}\n\nBased on the real data (and what they've told you about themselves, if anything above), give ONE short specialist observation and ONE small, concrete action for them to do this week. Say it directly \u2014 "do X" or "try X this week," not "you might want to consider." Respond ONLY with valid JSON, no markdown: {"note": "1-2 sentence observation in your voice, referencing the real number(s) above", "suggestedAction": "one small concrete daily action, stated directly"}`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are ${role.voice}, part of a care team reviewing ONE person's real health data. Sign your observation naturally as yourself, ${role.name} \u2014 no need to state your title, the person already knows who you are. Be direct and confident in what you tell them to do \u2014 say "do X this week," never "you might want to consider trying X." The honesty is in never promising an outcome, not in sounding unsure about the recommendation itself. You are NOT a licensed doctor, dietitian, or clinician \u2014 stay in coach/guide register, never diagnostic. You NEVER diagnose, NEVER name a medical condition, NEVER claim certainty that anything will fix anything \u2014 frame it as a guided experiment you're confidently recommending, not a maybe. You NEVER invent a number not given to you. If any medical or family health context appears below, use it ONLY to calibrate how careful or attentive your suggestion should be \u2014 you NEVER reference it to state a risk, a diagnosis, or a medical conclusion of any kind. Respond with ONLY the requested JSON, nothing else.`,
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
    const profile = Scores.loadTeamProfile();
    const preferredName = Scores.getPreferredName(profile);
    const nameBlock = preferredName ? `\n\nCall them ${preferredName} \u2014 that's what they asked to be called.` : '';
    const stated = Scores.formatProfileAnswers('drSage', profile);
    const goalBlock = stated ? `\n\nWhat this person told Dr. Sage when they first met (their goal):\n${stated}\n` : '';
    const medicalText = Scores.formatMedicalContext(profile);
    const medicalBlock = medicalText ? `\n\nContext they've shared (for awareness only \u2014 use only to calibrate attentiveness and referral judgment, NEVER to state a diagnosis or risk assessment, and NEVER to suggest starting, stopping, or changing any medication or supplement):\n${medicalText}\n` : '';
    return `Here is real input from this person's specialist care team, each reviewing only their own area of focus:\n\n${notesBlock}\n\nTheir recent self-logged habits:\n${journalBlock}${nameBlock}${goalBlock}${medicalBlock}\n\nAs the coordinating advisor synthesizing this team's input, weave 2-5 of their suggested actions into ONE cohesive 7-day plan (you may lightly adapt wording, but stay true to what each specialist actually suggested \u2014 do not invent a new action for an area not covered above). State each action directly and confidently \u2014 "do X," not "you might try X." Also decide if any area is worth a real referral \u2014 a fuller one-on-one consult with that specialist \u2014 based on your own judgment of what you're seeing, not just a fixed rule. Respond ONLY with valid JSON, no markdown: {"goalText": "1-2 plain sentences tying the team's observations together, stated directly and confidently", "actions": [{"text": "one small concrete daily action, stated directly", "domain": "one of: ${validDomains}", "journalKey": "one of: ${validKeys}, or null"}, ...2-5 actions], "referrals": [{"domain": "one of: ${validDomains}", "reason": "one short sentence on why this specialist is worth a fuller consult"}, ...0-2 referrals, empty array if none warranted]}`;
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
          system: 'You are Dr. Sage, a holistic wellness doctor \u2014 your entire job is monitoring this person\u2019s real health data over time, coordinating a small team of specialist coaches, noticing patterns, and referring to a specialist when it\u2019s warranted. Be direct and confident in what you tell them \u2014 say "do X this week," never "you might want to consider." The honesty is in never promising an outcome, not in sounding unsure about the recommendation itself. You do not treat, prescribe, diagnose, name a medical condition, or order any test \u2014 that is never your job, monitoring and coordination are. You NEVER claim certainty that any action will fix anything \u2014 frame it as a guided experiment you\u2019re confidently recommending, not a maybe. You NEVER invent a number not given to you, and NEVER introduce an area the specialist team didn\u2019t cover. If this person has shared any medical or family health context, use it ONLY to inform how closely you watch something or how quickly you refer \u2014 you NEVER state or imply a risk assessment, diagnosis, or medical conclusion from it, even indirectly. You always respond with ONLY the requested JSON, nothing else.',
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
    const medicalBlock = medicalText ? `\n\nContext they've shared with Dr. Sage (for awareness only \u2014 use only to calibrate how careful your suggestion should be, NEVER to state a diagnosis or risk assessment, and NEVER to suggest starting, stopping, or changing any medication or supplement):\n${medicalText}` : '';
    const preferredName = Scores.getPreferredName(profile);
    const nameBlock = preferredName ? `\n\nCall them ${preferredName} \u2014 that's what they asked to be called.` : '';
    const userMessage = `Dr. Sage has referred this person to you for a fuller consult. Your earlier brief note was: "${note.note}" (you'd suggested: "${note.suggestedAction}"). Dr. Sage's reason for referring: ${referral.reasons.join('; ')}${nameBlock}${profileBlock}${medicalBlock}\n\nWrite a short, warm, first-person consult (3-5 sentences) as ${role.name}, this person's ${role.title.toLowerCase()} \u2014 more detail and personality than your earlier brief note, but still grounded only in what's already been said above. Be direct about what you want them to do \u2014 say it plainly, don't hedge on the recommendation itself. Do not diagnose. Do not name a medical condition. Do not order any test. Do not claim certainty about the outcome. Respond with plain text only, no JSON, no markdown.`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are ${role.voice}. You are NOT a licensed doctor, dietitian, or clinician \u2014 you are a coach. Be warm, but direct \u2014 say "do X," not "you could maybe try X." The honesty is in never promising an outcome, not in sounding unsure about what you're recommending. You NEVER diagnose, NEVER name a medical condition, NEVER order or suggest a test, NEVER claim certainty that anything will fix anything. If any medical or family health context appears in the message, use it ONLY to calibrate tone and care level \u2014 NEVER to state a risk, diagnosis, or medical conclusion. Respond with plain text only, 3-5 sentences.`,
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

  // ── WEEKLY REPORT ────────────────────────────────────────────
  // Real report, combining both real inputs the user gave (goal,
  // journal, regimen adherence, meal plan engagement, calibration
  // follow-through) and real ring data (Recovery/Sleep/Stress/
  // Activity trends over the week). Explicit deficiency callouts
  // use real counted numbers, never vague language \u2014 "you logged
  // 2 of 7 days," not "you could be more consistent." Delivered
  // in Dr. Sage's voice, read aloud via the same real TTS
  // pipeline used everywhere else.
  //
  // Cadence is REACTIVE, not proactive, same honest distinction
  // already established for the welcome-back note: this fires the
  // next time someone actually opens the app after 7+ days since
  // their last report, not on a schedule while the app is closed.
  // A genuine push notification \u2014 reaching someone while the app
  // isn't open \u2014 needs real infrastructure that doesn't exist yet:
  // a service worker, a permission flow, push subscriptions stored
  // server-side (localStorage can't be pushed to from outside the
  // browser), and a scheduled server-side trigger. That's a real
  // backend project, not something to fake here.
  LAST_REPORT_KEY: 'sh_last_weekly_report',

  checkWeeklyReportDue() {
    let lastReport;
    try { lastReport = localStorage.getItem(Scores.LAST_REPORT_KEY); } catch (e) { lastReport = null; }
    if (!lastReport) return true; // never had one — due immediately once there's real data
    const daysSince = (Date.now() - Number(lastReport)) / 86400000;
    return daysSince >= 7;
  },

  markWeeklyReportShown() {
    try { localStorage.setItem(Scores.LAST_REPORT_KEY, String(Date.now())); } catch (e) { /* non-critical */ }
  },

  // Gathers everything real, with explicit real numbers for every
  // deficiency \u2014 never a vague "could be better."
  gatherWeeklyReportData(snapshot) {
    const profile = Scores.loadTeamProfile();
    const goal = profile?.drSage?.goal || null;

    const recovery = Scores.computeRecovery(snapshot);
    const sleep = Scores.computeSleepScore(snapshot);
    const stress = Scores.computeStress(snapshot);
    const activity = Scores.computeActivityTrend(snapshot);
    const nutritionHistory = Scores.buildNutritionHistory();

    // Journal: real count of the last 7 calendar days that have
    // ANY entry logged, out of 7.
    const journal = Scores.loadJournal();
    const today = new Date();
    let journalDaysLogged = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entries = journal[key];
      if (entries && Object.values(entries).some(function(v) { return v; })) journalDaysLogged++;
    }

    // Calibration: real strikes within the last 7 days specifically
    // (STRIKES_KEY holds all-time dates, filter to the real window).
    const allStrikes = Scores.loadStrikes();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const strikesThisWeek = allStrikes.filter(function(d) { return new Date(d) >= sevenDaysAgo; }).length;

    const regimenAdherence = Scores.summarizeRegimenAdherence();

    let mealPlanStatus = 'never built one';
    const mealIdeas = Scores.loadMealIdeas();
    if (mealIdeas && mealIdeas.createdDate) {
      const daysOld = Math.floor((Date.now() - new Date(mealIdeas.createdDate).getTime()) / 86400000);
      mealPlanStatus = daysOld === 0 ? 'built today' : `last built ${daysOld} day${daysOld === 1 ? '' : 's'} ago`;
    }

    // Real days this week the person marked themselves sick or
    // traveling \u2014 manual, not inferred, so the report can give
    // honest context instead of judging a disrupted week against
    // a normal one.
    const statusLog = Scores.loadActivityStatus();
    let sickDays = 0, travelDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (statusLog[key] === 'sick') sickDays++;
      if (statusLog[key] === 'traveling') travelDays++;
    }
    const activityStatusNote = (sickDays || travelDays)
      ? `Real self-reported: ${sickDays ? sickDays + ' sick day(s)' : ''}${sickDays && travelDays ? ', ' : ''}${travelDays ? travelDays + ' traveling day(s)' : ''} this week \u2014 weigh the rest of the data with that in mind, don't judge a disrupted week like a normal one.`
      : null;

    // Real notes, in their own words \u2014 the most recent one gets
    // quoted directly (never summarized/paraphrased into something
    // they didn't say), not just counted.
    const allNotes = Scores.loadNotes();
    const noteDatesThisWeek = Object.keys(allNotes).filter(function(d) { return new Date(d) >= sevenDaysAgo; }).sort();
    const latestNoteText = noteDatesThisWeek.length ? allNotes[noteDatesThisWeek[noteDatesThisWeek.length - 1]].text : null;

    return {
      goal,
      recovery: recovery.ok ? recovery.score : null,
      sleep: sleep.ok ? sleep.score : null,
      stress: stress.ok ? stress.score : null,
      activityTrend: activity.ok ? `${activity.latestSteps} steps most recent day, avg ${activity.avgPriorSteps}/day prior` : null,
      nutritionAvg: nutritionHistory.ok && nutritionHistory.loggedDays > 1 ? `~${nutritionHistory.avgCalories} cal/day avg, ${nutritionHistory.avgProtein}g protein` : null,
      journalDaysLogged,
      strikesThisWeek,
      regimenAdherence: regimenAdherence ? `${regimenAdherence.done}/${regimenAdherence.total} exercises done (${regimenAdherence.pct}%)` : 'no active regimen',
      mealPlanStatus,
      activityStatusNote,
      noteDaysThisWeek: noteDatesThisWeek.length,
      latestNoteText,
    };
  },

  // Separate, focused call from the main report generation \u2014
  // deliberately not mixed into that prose-only call\u2019s output
  // shape. Evaluates whether the STATED GOAL ITSELF (not any one
  // specialist\u2019s weekly plan, which already adapts on its own
  // page) still fits how the week actually went. Never
  // auto-applies \u2014 same principle as completeAffirmation(): a
  // goal change is the person\u2019s own words, confirmed by them, not
  // something Dr. Sage unilaterally rewrites.
  async evaluateGoalRevision(data, currentGoal) {
    if (!currentGoal) return { shouldRevise: false };

    const lines = [
      `Recovery: ${data.recovery != null ? data.recovery + '/100' : 'not enough real data yet'}`,
      `Sleep: ${data.sleep != null ? data.sleep + '/100' : 'not enough real data yet'}`,
      `Stress: ${data.stress != null ? data.stress + '/100' : 'not enough real data yet'}`,
      `Activity: ${data.activityTrend || 'no real step trend yet'}`,
      `Nutrition: ${data.nutritionAvg || 'no real logging trend yet'}`,
      `Journal logged ${data.journalDaysLogged} of the last 7 days`,
      `Exercise regimen: ${data.regimenAdherence}`,
    ];

    const userMessage = `Their stated goal: "${currentGoal}".\n\nHere's their real week across every domain:\n${lines.join('\n')}\n\nDecide honestly: is this goal still the right level of ambition given how the week actually went? If they're consistently struggling across multiple real areas (not just one off day), the goal may genuinely need to be eased into something more achievable right now \u2014 that's not failure, that's calibration. If they're consistently exceeding it across multiple areas, consider raising the ambition. If it's mixed, or there genuinely isn't enough real data yet, don't revise \u2014 one so-so week is not a pattern. Respond ONLY with valid JSON, no markdown: {"shouldRevise": true or false, "proposedGoal": "the revised goal, phrased as something THEY would say, first person, only if shouldRevise is true", "reasonForPerson": "1 direct sentence explaining why, spoken to them, only if shouldRevise is true"}`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are Dr. Sage, deciding whether someone\u2019s own stated goal needs to be recalibrated based on a real week of data across every specialist. You are conservative about this \u2014 real, consistent, multi-domain evidence only, never a single bad or great day. Never invent data you weren\u2019t given. Respond with ONLY the requested JSON.',
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 200,
        }),
      });
      if (!res.ok) return { shouldRevise: false };
      const resData = await res.json();
      const text = (resData.content?.[0]?.text || '').replace(/```json\s*|```\s*/g, '').trim();
      const parsed = JSON.parse(text);
      if (!parsed.shouldRevise || !parsed.proposedGoal || !String(parsed.proposedGoal).trim()) return { shouldRevise: false };
      return {
        shouldRevise: true,
        proposedGoal: String(parsed.proposedGoal).trim(),
        reasonForPerson: parsed.reasonForPerson ? String(parsed.reasonForPerson).trim() : '',
      };
    } catch (e) {
      return { shouldRevise: false }; // never blocks the report if this fails
    }
  },

  async generateWeeklyReport(snapshot, onDone) {
    const data = Scores.gatherWeeklyReportData(snapshot);
    const preferredName = Scores.getPreferredName();

    const lines = [];
    lines.push(`Stated goal: ${data.goal || 'not specified during onboarding'}`);
    lines.push(`Recovery: ${data.recovery != null ? data.recovery + '/100' : 'not enough real data yet'}`);
    lines.push(`Sleep: ${data.sleep != null ? data.sleep + '/100' : 'not enough real data yet'}`);
    lines.push(`Stress: ${data.stress != null ? data.stress + '/100' : 'not enough real data yet'}`);
    lines.push(`Activity: ${data.activityTrend || 'no real step trend yet'}`);
    lines.push(`Nutrition: ${data.nutritionAvg || 'no real logging trend yet'}`);
    lines.push(`Journal logged ${data.journalDaysLogged} of the last 7 days`);
    lines.push(`Calibration misses this week: ${data.strikesThisWeek}`);
    lines.push(`Exercise regimen: ${data.regimenAdherence}`);
    lines.push(`Meal plan: ${data.mealPlanStatus}`);
    if (data.activityStatusNote) lines.push(data.activityStatusNote);
    if (data.latestNoteText) lines.push(`Their most recent real note, in their own words: "${data.latestNoteText}" (${data.noteDaysThisWeek} note(s) this week). If it's genuinely relevant to the report, you can reference it directly \u2014 never paraphrase it into something they didn't say.`);

    const userMessage = `Here is this person's real week \u2014 both what they logged themselves and what the ring recorded:\n\n${lines.join('\n')}\n\nWrite their weekly report. Cover three things directly: (1) real progress toward their stated goal, or honestly say there isn't enough data to judge yet if that's true \u2014 never invent progress that isn't supported by the numbers above; (2) name any real deficiencies plainly, using the actual numbers given (e.g. "you logged 2 of 7 days"), stated as fact, never as a judgment of their character or effort; (3) one clear, direct focus for the coming week. Keep it to 5-6 sentences, spoken naturally \u2014 this will be read aloud. Respond with plain text only, no JSON, no markdown.`;

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are Dr. Sage, delivering this person's weekly report${preferredName ? ` (call them ${preferredName})` : ''}. Be direct and honest about both real progress and real gaps \u2014 state facts plainly, never shame or judge character ("you're not serious," "you failed") even when the numbers are genuinely poor. The honesty is in the real numbers themselves, not in a harsh tone. You are NOT a medical doctor \u2014 you monitor and coordinate, you don't diagnose or treat. You NEVER invent a number not given to you, and NEVER claim certainty about outcomes. Respond with plain text only, 5-6 sentences.`,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 350,
        }),
      });
      const res2 = await res.json();
      if (!res.ok) throw new Error(res2.error || 'Request failed');
      const reportText = (res2.content?.[0]?.text || '').trim();
      if (!reportText) { onDone({ error: 'Couldn\u2019t generate your report right now.' }); return; }
      Scores.markWeeklyReportShown();
      const goalRevision = await Scores.evaluateGoalRevision(data, data.goal);
      onDone({ report: reportText, data, goalRevision });
    } catch (e) {
      onDone({ error: 'Weekly report unavailable right now: ' + e.message });
    }
  },

  async handleWeeklyReportClick(snapshot) {
    const btn = document.getElementById('weekly-report-btn');
    const resultEl = document.getElementById('weekly-report-result');
    btn.disabled = true;
    btn.textContent = 'Dr. Sage is putting it together\u2026';

    await Scores.generateWeeklyReport(snapshot, async (result) => {
      if (result.error) {
        resultEl.textContent = result.error;
        resultEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Hear it now';
        return;
      }
      document.getElementById('weekly-report-banner').style.display = 'none';
      resultEl.innerHTML = `<strong>Dr. Sage:</strong> ${result.report}`;
      resultEl.style.display = 'block';

      // Goal revision, if evaluateGoalRevision() found real
      // multi-domain evidence for it, is proposed \u2014 not applied.
      // Same principle as the affirmation gate: the goal is the
      // person's own words, they confirm the change, Dr. Sage
      // doesn't unilaterally rewrite it.
      if (result.goalRevision && result.goalRevision.shouldRevise) {
        const gr = result.goalRevision;
        const proposalEl = document.createElement('div');
        proposalEl.style.cssText = 'margin-top:12px; background:rgba(143,181,150,0.1); border:1px solid rgba(143,181,150,0.3); border-radius:12px; padding:14px;';
        proposalEl.innerHTML = `
          <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8FB596; margin-bottom:8px;">Dr. Sage suggests recalibrating your goal</div>
          <div style="font-size:13px; line-height:1.5; margin-bottom:10px;">${gr.reasonForPerson || ''}</div>
          <div style="font-size:13.5px; font-style:italic; padding:10px; background:rgba(0,0,0,0.18); border-radius:8px; margin-bottom:12px;">"${gr.proposedGoal}"</div>
          <button id="goal-revision-accept-btn" class="trend-btn" style="background:#8FB596; color:#0D130F; border:none; margin-bottom:8px;">Yes, update it</button>
          <button id="goal-revision-keep-btn" class="trend-btn" style="background:transparent; border:1px solid rgba(243,239,230,0.2);">Keep my original goal</button>
        `;
        resultEl.appendChild(proposalEl);
        document.getElementById('goal-revision-accept-btn').addEventListener('click', () => {
          Scores.completeAffirmation(gr.proposedGoal);
          proposalEl.innerHTML = '<div style="font-size:13px; color:#8FB596;">Goal updated \u2014 the team will build toward this from here.</div>';
        });
        document.getElementById('goal-revision-keep-btn').addEventListener('click', () => {
          proposalEl.innerHTML = '<div style="font-size:13px; color:#8C9689;">Kept as-is.</div>';
        });
      }

      await Scores.speakText(result.report, 'drSage', () => {});
    });
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
        const name = Scores.getPreferredName();
        welcomeEl.textContent = `Dr. Sage: It's been ${visitGap.daysSince} days${name ? ', ' + name : ''} \u2014 good to have you back. Let's see where things stand.`;
        welcomeEl.style.display = 'block';
      } else {
        welcomeEl.style.display = 'none';
      }
    }

    // Weekly report: only worth offering once onboarding is
    // actually done (a real goal exists) \u2014 otherwise there's
    // nothing real yet to report on. Generation itself is lazy,
    // same pattern as referral consults \u2014 a banner offers it,
    // tapping it is what actually spends an AI call.
    const reportProfile = Scores.loadTeamProfile();
    const reportBanner = document.getElementById('weekly-report-banner');
    if (reportBanner) {
      if (reportProfile?.drSage?.goal && Scores.checkWeeklyReportDue()) {
        reportBanner.style.display = 'block';
      } else {
        reportBanner.style.display = 'none';
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

    document.querySelectorAll('.wc-btn[data-cups]').forEach(btn => {
      btn.addEventListener('click', () => Scores.addWater(Number(btn.dataset.cups)));
    });
    document.querySelectorAll('.wc-btn[data-mg]').forEach(btn => {
      btn.addEventListener('click', () => Scores.addCaffeine(Number(btn.dataset.mg), btn.dataset.label));
    });
    const waterResetBtn = document.getElementById('water-reset-btn');
    if (waterResetBtn) waterResetBtn.addEventListener('click', Scores.resetWater);
    const caffeineResetBtn = document.getElementById('caffeine-reset-btn');
    if (caffeineResetBtn) caffeineResetBtn.addEventListener('click', Scores.resetCaffeine);
    Scores.renderWaterCaffeine();

    document.querySelectorAll('#activity-status-btns .wc-btn').forEach(btn => {
      btn.addEventListener('click', () => Scores.saveActivityStatus(btn.dataset.status));
    });
    Scores.renderActivityStatus();

    const notesSaveBtn = document.getElementById('notes-save-btn');
    if (notesSaveBtn) notesSaveBtn.addEventListener('click', () => Scores.saveNote(document.getElementById('notes-input').value));
    Scores.renderNotes();

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
    Scores.initMealReminderBanner();
    const nutriBtn = document.getElementById('nutrition-estimate-btn');
    if (nutriBtn) nutriBtn.addEventListener('click', Scores.handleEstimateNutritionClick);

    const reminderEnableBtn = document.getElementById('meal-reminder-enable-btn');
    if (reminderEnableBtn) reminderEnableBtn.addEventListener('click', Scores.enableMealReminders);
    const reminderDismissBtn = document.getElementById('meal-reminder-dismiss-btn');
    if (reminderDismissBtn) reminderDismissBtn.addEventListener('click', Scores.dismissMealReminderBanner);

    const photoBtn = document.getElementById('nutrition-photo-btn');
    const photoInput = document.getElementById('nutrition-photo-input');
    if (photoBtn && photoInput) {
      photoBtn.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', Scores.handleNutritionPhotoSelected);
    }
    const draftSaveBtn = document.getElementById('draft-save-btn');
    if (draftSaveBtn) draftSaveBtn.addEventListener('click', Scores.handleDraftSave);
    const draftCancelBtn = document.getElementById('draft-cancel-btn');
    if (draftCancelBtn) draftCancelBtn.addEventListener('click', Scores.handleDraftCancel);

    const typeToggleBtn = document.getElementById('nutrition-type-toggle-btn');
    const typeFallback = document.getElementById('nutrition-type-fallback');
    if (typeToggleBtn && typeFallback) {
      typeToggleBtn.addEventListener('click', () => {
        const showing = typeFallback.style.display === 'block';
        typeFallback.style.display = showing ? 'none' : 'block';
        typeToggleBtn.textContent = showing ? 'No camera handy? Type it instead' : '\u2039 Hide';
      });
    }

    const reportBtn = document.getElementById('weekly-report-btn');
    if (reportBtn) reportBtn.addEventListener('click', () => Scores.handleWeeklyReportClick(snapshot));
  },
};

document.addEventListener('DOMContentLoaded', Scores.init);
