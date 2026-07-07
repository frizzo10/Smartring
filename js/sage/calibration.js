/* ─────────────────────────────────────────────────────────
   myDrSage — Nightly Calibration Loop
   Schema + logic for: raw data flags a pattern -> Dr. Sage asks
   a data-generated question -> answer tweaks confidence and
   future thresholds, per person.

   This is the mechanism that makes an imprecise raw sensor
   (see hrv.js validation notes — RMSSD has a real precision
   ceiling at 50Hz) trustworthy over time: instead of needing
   every single night's number to be individually accurate, the
   system needs the PERSON's own corroboration on the nights that
   matter, building a per-person reliability profile.
   ───────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════
   1. PER-NIGHT RECORD
   One of these is created every night, whether or not anything
   was flagged. This is the raw material everything else builds on.
   ═══════════════════════════════════════════════════════════ */

const NightRecordSchema = {
  date: 'YYYY-MM-DD',
  userId: 'string',

  // Raw sensor outputs for the night, WITH their own confidence
  // flags — never a bare number. Mirrors hrv.js's computeHRV()
  // reason field: 'ok' | 'signal_too_noisy' | 'insufficient_data' etc.
  sensors: {
    restingHR: { value: 'number|null', confidence: 'ok|low|null', segmentsUsed: 'number' },
    hrv_rmssd: { value: 'number|null', confidence: 'ok|low|null', segmentsUsed: 'number', rejectionRate: 'number' },
    spo2: { value: 'number|null', dipCount: 'number', dipsBelow92: 'number', confidence: 'ok|low|null' },
    sleepDurationMin: 'number|null',
    sleepEfficiencyPct: 'number|null',
    ringWornMinutes: 'number', // vs. expected sleep window — low value is itself a QC signal
  },

  // Comparison against the person's OWN rolling baseline (never
  // population norms) — see aggregateNightly() pattern from hrv.js
  deviations: {
    restingHR_vs_baseline: 'number', // e.g. +7 (bpm above their 30-day median)
    hrv_vs_baseline_pct: 'number',   // e.g. -18 (% below their 30-day median)
    spo2_dips_vs_baseline: 'number',
  },

  // What got flagged tonight, if anything. Multiple flags can
  // coexist. Each flag is what actually triggers a question.
  flags: [
    {
      id: 'string',              // e.g. 'rhr_hrv_single_night'
      type: 'single_night | multi_night_trend | signal_quality',
      metric: 'restingHR | hrv_rmssd | spo2 | sleep',
      severity: 'watch | notable', // never 'alarm' from data alone — severity only escalates via corroboration
      description: 'string',      // internal, human-readable summary for debugging/support
    },
  ],

  // Filled in AFTER Dr. Sage asks a question and the person answers.
  // Null until that happens; a night can have zero, one, or several.
  questionsAsked: [
    {
      flagId: 'string',           // links back to the flags[] entry that generated this
      questionId: 'string',       // references a question template, see section 3
      askedAt: 'ISO timestamp',
      answer: 'string|enum|null', // structured where possible (enum), free text as fallback
      answeredAt: 'ISO timestamp|null',
    },
  ],

  // The OUTCOME of processing this night's questions — this is
  // the actual "tweak" applied. Computed once questionsAsked is
  // resolved; drives what the trend/dashboard logic sees.
  resolution: {
    outcome: 'explained_suppress | corroborated_escalate | sensor_flagged_unreliable | unresolved',
    explanationTag: 'alcohol | poor_sleep_position | illness | stress | ring_fit | travel | other | null',
    countsTowardTrend: 'boolean', // explained nights get excluded from trend math
  },
};

/* ═══════════════════════════════════════════════════════════
   2. PER-PERSON CALIBRATION PROFILE
   Built up over time from resolved nights. This is what makes
   the system get smarter about THIS person specifically — the
   direct answer to the precision-ceiling problem: we don't need
   a universal noise threshold, we need to learn each person's.
   ═══════════════════════════════════════════════════════════ */

const CalibrationProfileSchema = {
  userId: 'string',
  createdAt: 'ISO timestamp',
  lastUpdated: 'ISO timestamp',

  // Rolling baselines — the person's OWN normal, never population
  // norms. Recomputed continuously, weighted toward recent data
  // but with enough history to be stable (30-60 day window).
  baselines: {
    restingHR: { median: 'number', stddev: 'number', sampleNights: 'number' },
    hrv_rmssd: { median: 'number', stddev: 'number', sampleNights: 'number' },
    spo2_typical_dips: { median: 'number', stddev: 'number', sampleNights: 'number' },
    sleepDurationMin: { median: 'number', stddev: 'number', sampleNights: 'number' },
  },

  // Signal-quality reliability, learned from confirmed-good vs
  // confirmed-bad nights (via the 'ring was loose' type answers).
  // This directly addresses tonight's precision-ceiling finding:
  // some people's raw PPG is inherently noisier (skin tone,
  // circulation, finger size/fit), so their threshold for
  // "trust this number" should differ from someone with a
  // consistently clean signal.
  signalReliability: {
    hrv_rmssd: {
      // How often this person's readings get flagged noisy AND
      // they confirm the ring was actually fine (i.e. the noise
      // is intrinsic to their signal, not a fit problem)
      intrinsicNoiseRate: 'number',       // 0-1
      // Learned rejection-rate threshold for THIS person, adjusted
      // from the global default (30%, see hrv.js) based on history
      personalRejectionThreshold: 'number',
      confirmedGoodNights: 'number',
      confirmedBadFitNights: 'number',
    },
  },

  // Explanation history — what tends to actually explain this
  // person's flagged nights. Lets Dr. Sage get smarter about
  // which question to lead with (e.g. if alcohol has explained
  // 6 of their last 8 flags, ask that first).
  explanationFrequency: {
    alcohol: 'number',
    poor_sleep_position: 'number',
    illness: 'number',
    stress: 'number',
    ring_fit: 'number',
    travel: 'number',
    other: 'number',
  },

  // Trend-worthiness: only nights NOT explained away count toward
  // multi-night trend detection (the sleep apnea / cardiovascular
  // strain patterns described in the claim-triage/product-focus doc).
  trendEligibleNights: 'array of dates',
};

/* ═══════════════════════════════════════════════════════════
   3. QUESTION TEMPLATES
   Every question is generated FROM a specific flag — never
   asked speculatively. Each template declares which flag
   type(s) trigger it and how each possible answer resolves.
   ═══════════════════════════════════════════════════════════ */

const QuestionTemplates = [
  {
    id: 'single_night_rhr_hrv',
    triggersOn: ['rhr_up_hrv_down_single_night'],
    prompt: "Anything different last night — alcohol, a late meal, or a stressful day?",
    answers: {
      alcohol:            { outcome: 'explained_suppress', explanationTag: 'alcohol' },
      late_meal:           { outcome: 'explained_suppress', explanationTag: 'other' },
      stressful_day:        { outcome: 'explained_suppress', explanationTag: 'stress' },
      nothing_unusual:       { outcome: 'corroborated_escalate', explanationTag: null },
    },
  },

  {
    id: 'spo2_dips_position',
    triggersOn: ['spo2_dips_clustered'],
    prompt: "Did you sleep on your back last night?",
    answers: {
      back:    { outcome: 'explained_suppress', explanationTag: 'poor_sleep_position',
                 followUp: 'suggest_side_sleeping_trial' },
      side_or_stomach: { outcome: 'corroborated_escalate', explanationTag: null },
      not_sure:  { outcome: 'unresolved', explanationTag: null },
    },
  },

  {
    id: 'signal_quality_check',
    triggersOn: ['signal_too_noisy_repeated'],
    prompt: "Was the ring loose, or did you take it off during the night?",
    answers: {
      loose_or_removed: { outcome: 'sensor_flagged_unreliable', explanationTag: 'ring_fit',
                           calibrationEffect: 'confirmedBadFitNights += 1' },
      ring_was_fine:    { outcome: 'sensor_flagged_unreliable', explanationTag: null,
                           calibrationEffect: 'confirmedGoodNights += 1; intrinsicNoiseRate recalculated' },
    },
  },

  {
    id: 'multi_night_trend_stress',
    triggersOn: ['hrv_declining_multi_night', 'rhr_climbing_multi_night'],
    prompt: "How has your stress been the past couple weeks?",
    answers: {
      high_stress:   { outcome: 'explained_suppress', explanationTag: 'stress',
                        followUp: 'offer_stress_coaching' },
      normal:        { outcome: 'corroborated_escalate', explanationTag: null,
                        followUp: 'flag_for_real_checkup' },
    },
  },

  {
    id: 'multi_night_trend_illness',
    triggersOn: ['temp_rhr_hrv_illness_pattern'],
    prompt: "Feeling sick, or just tired?",
    answers: {
      feeling_sick:  { outcome: 'explained_suppress', explanationTag: 'illness',
                        followUp: 'suggest_rest_day' },
      just_tired:    { outcome: 'corroborated_escalate', explanationTag: null },
    },
  },
];

/* ═══════════════════════════════════════════════════════════
   4. RESOLUTION LOGIC
   What actually happens to the night's data once an answer
   comes in. This is the literal "tweak" mechanism.
   ═══════════════════════════════════════════════════════════ */

function resolveNightFromAnswer(nightRecord, question, answerKey, calibrationProfile) {
  const resolution = question.answers[answerKey];
  if (!resolution) return nightRecord; // unrecognized answer, leave unresolved

  nightRecord.resolution = {
    outcome: resolution.outcome,
    explanationTag: resolution.explanationTag,
    countsTowardTrend: resolution.outcome !== 'explained_suppress'
                        && resolution.outcome !== 'sensor_flagged_unreliable',
  };

  // Update the person's calibration profile based on this resolution
  if (resolution.explanationTag) {
    calibrationProfile.explanationFrequency[resolution.explanationTag]++;
  }

  if (resolution.outcome === 'sensor_flagged_unreliable') {
    if (resolution.calibrationEffect?.includes('confirmedBadFitNights')) {
      calibrationProfile.signalReliability.hrv_rmssd.confirmedBadFitNights++;
    }
    if (resolution.calibrationEffect?.includes('confirmedGoodNights')) {
      calibrationProfile.signalReliability.hrv_rmssd.confirmedGoodNights++;
      // Recompute this person's intrinsic noise rate and adjust
      // their personal rejection threshold — this is the direct
      // per-person fix for the global-threshold precision problem
      const rel = calibrationProfile.signalReliability.hrv_rmssd;
      const totalConfirmed = rel.confirmedGoodNights + rel.confirmedBadFitNights;
      rel.intrinsicNoiseRate = totalConfirmed > 0
        ? rel.confirmedGoodNights / totalConfirmed
        : rel.intrinsicNoiseRate;
      // If this person consistently confirms "ring was fine" on
      // nights that get flagged noisy, raise their personal
      // tolerance rather than keep discarding real (if imprecise)
      // data — but only after enough confirmed history to trust it
      if (totalConfirmed >= 5) {
        rel.personalRejectionThreshold = Math.min(0.45, 0.30 + rel.intrinsicNoiseRate * 0.15);
      }
    }
  }

  // Multi-night trend flags only ever escalate confidence, never
  // manufacture urgency from a single corroborated night — the
  // "flag_for_real_checkup" followUp only fires from a
  // multi_night_trend flag type, per QuestionTemplates above
  if (resolution.followUp === 'flag_for_real_checkup') {
    nightRecord.resolution.recommendCheckup = true;
  }

  return nightRecord;
}

/* ═══════════════════════════════════════════════════════════
   5. WHAT THIS BUYS US — direct callback to the hrv.js finding
   ═══════════════════════════════════════════════════════════

   The validation session found a real, unresolved precision
   ceiling: ~20ms of residual per-peak timing jitter at 50Hz,
   which corrupts RMSSD especially for people with naturally low
   true HRV. Rather than needing a DSP fix to close that gap
   tonight, this loop makes the ceiling tolerable:

   - A single noisy night never reaches the person as a claim —
     it becomes a QUESTION first ("was the ring loose?")
   - Confirmed-good nights vs confirmed-bad-fit nights build a
     PERSONAL rejection threshold, replacing one global guess
   - Multi-night TRENDS (which average out single-night jitter)
     are what actually drive any escalation toward "talk to a
     doctor" — never a single night's number, however it reads
   - The person's own corroboration is the second signal that
     turns a maybe into a real flag — exactly how a good
     physician works, asking before concluding
*/

if (typeof module !== 'undefined') {
  module.exports = { NightRecordSchema, CalibrationProfileSchema, QuestionTemplates, resolveNightFromAnswer };
}
if (typeof window !== 'undefined') {
  window.SageCalibration = { NightRecordSchema, CalibrationProfileSchema, QuestionTemplates, resolveNightFromAnswer };
}
