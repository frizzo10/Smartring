/* ─────────────────────────────────────────────────────────
   myDrSage — App State & Logic Layer

   Ties together: SimRing (data source, swappable for real R02
   later) -> Calibration (question/resolution logic) -> local
   persistence -> whatever the UI renders.

   Storage: localStorage for tonight (single-device, no auth
   wired up yet). Swap-out plan: replace loadState/saveState
   with Supabase calls (js/supabase.js already exists in this
   repo) once auth is wired to the new focused app.
   ───────────────────────────────────────────────────────── */

const SageApp = {
  STORAGE_KEY: 'mydrsage_state_v1',

  state: {
    history: [],              // array of NightRecords, oldest -> newest
    calibrationProfile: null, // CalibrationProfileSchema instance
    pendingQuestions: [],     // questions generated but not yet answered
  },

  // ── INIT ───────────────────────────────────────────────────
  init() {
    const saved = SageApp.loadState();
    if (saved) {
      SageApp.state = saved;
    } else {
      SageApp.seedFreshState();
    }
    SageApp.generatePendingQuestions();
  },

  seedFreshState() {
    const history = window.SimRing.generateHistory();
    const calibrationProfile = {
      signalReliability: {
        hrv_rmssd: {
          intrinsicNoiseRate: 0,
          personalRejectionThreshold: 0.30,
          confirmedGoodNights: 0,
          confirmedBadFitNights: 0,
        },
      },
      explanationFrequency: { alcohol: 0, poor_sleep_position: 0, illness: 0, stress: 0, ring_fit: 0, travel: 0, other: 0 },
      baselines: {
        restingHR: { median: window.SimRing.baseline.restingHR, stddev: 4, sampleNights: history.length },
        hrv_rmssd: { median: window.SimRing.baseline.hrv_rmssd, stddev: 6, sampleNights: history.length },
      },
    };
    SageApp.state = { history, calibrationProfile, pendingQuestions: [] };
    SageApp.saveState();
  },

  loadState() {
    try {
      const raw = localStorage.getItem(SageApp.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  saveState() {
    try {
      localStorage.setItem(SageApp.STORAGE_KEY, JSON.stringify(SageApp.state));
    } catch (e) { console.log('SageApp: save failed', e.message); }
  },

  resetToFreshDemo() {
    localStorage.removeItem(SageApp.STORAGE_KEY);
    SageApp.seedFreshState();
    SageApp.generatePendingQuestions();
  },

  // ── QUESTIONS ──────────────────────────────────────────────
  // Scan unresolved flags across recent history and generate
  // any questions that haven't been asked yet. Never re-ask a
  // resolved night.
  generatePendingQuestions() {
    const templates = window.SageCalibration.QuestionTemplates;
    const pending = [];

    for (const night of SageApp.state.history) {
      if (night.resolution) continue; // already resolved (or no flag)
      for (const flag of night.flags) {
        const alreadyAsked = night.questionsAsked.some(q => q.flagId === flag.id);
        if (alreadyAsked) continue;

        const template = templates.find(t => t.triggersOn.includes(flag.id));
        if (!template) continue;

        pending.push({
          nightDate: night.date,
          flagId: flag.id,
          questionId: template.id,
          prompt: template.prompt,
          answers: Object.keys(template.answers),
        });
      }
    }
    SageApp.state.pendingQuestions = pending;
    SageApp.saveState();
    return pending;
  },

  // Called when the user answers a pending question from the UI.
  answerQuestion(nightDate, flagId, answerKey) {
    const night = SageApp.state.history.find(n => n.date === nightDate);
    if (!night) return null;

    const templates = window.SageCalibration.QuestionTemplates;
    const flag = night.flags.find(f => f.id === flagId);
    const template = templates.find(t => t.triggersOn.includes(flagId));
    if (!flag || !template) return null;

    night.questionsAsked.push({
      flagId,
      questionId: template.id,
      askedAt: new Date().toISOString(),
      answer: answerKey,
      answeredAt: new Date().toISOString(),
    });

    window.SageCalibration.resolveNightFromAnswer(night, template, answerKey, SageApp.state.calibrationProfile);

    SageApp.generatePendingQuestions();
    SageApp.saveState();
    return night.resolution;
  },

  // ── DERIVED VIEWS FOR UI ───────────────────────────────────

  getLatestNight() {
    return SageApp.state.history[SageApp.state.history.length - 1] || null;
  },

  // "Breathing overnight" card content — SpO2-focused verdict
  getBreathingVerdict() {
    const night = SageApp.getLatestNight();
    if (!night) return null;
    const s = night.sensors.spo2;

    if (s.dipsBelow92 >= 3) {
      return {
        tone: 'watch',
        text: `Your breathing showed ${s.dipsBelow92} dips below 92% overnight. Worth watching — if this keeps happening, it's worth a real sleep test.`,
      };
    }
    if (s.dipCount >= 1) {
      return {
        tone: 'normal',
        text: `Your breathing was steady last night. ${s.dipCount} brief dip${s.dipCount > 1 ? 's' : ''}, nothing sustained.`,
      };
    }
    return {
      tone: 'normal',
      text: `Your breathing was steady and uninterrupted last night.`,
    };
  },

  // "Heart, this week" card content — RHR/HRV trend verdict
  getHeartVerdict() {
    const recent = SageApp.state.history.slice(-7);
    if (recent.length === 0) return null;

    const latest = recent[recent.length - 1];
    const trendNight = recent.find(n => n.flags.some(f => f.type === 'multi_night_trend'));
    const trendFlag = trendNight?.flags.find(f => f.type === 'multi_night_trend');

    if (trendFlag && trendNight.resolution?.outcome === 'corroborated_escalate') {
      return {
        tone: 'watch',
        text: `Your HRV has trended down while resting heart rate crept up, and nothing obvious explains it. This is worth a real check — I'd get your blood pressure looked at.`,
        hrv: latest.sensors.hrv_rmssd.value,
        rhr: latest.sensors.restingHR.value,
        recommendCheckup: true,
      };
    }

    if (trendFlag && trendNight.resolution?.outcome === 'explained_suppress') {
      return {
        tone: 'normal',
        text: `Your HRV dipped this week, but that lines up with the stress you mentioned. Nothing concerning — worth revisiting once things calm down.`,
        hrv: latest.sensors.hrv_rmssd.value,
        rhr: latest.sensors.restingHR.value,
      };
    }

    if (trendFlag) {
      return {
        tone: 'watch',
        text: `Your HRV has trended down over the past several nights while resting heart rate crept up. ${trendFlag.description}. Worth watching.`,
        hrv: latest.sensors.hrv_rmssd.value,
        rhr: latest.sensors.restingHR.value,
      };
    }

    return {
      tone: 'normal',
      text: `Your heart metrics have been steady this week — no meaningful drift from your baseline.`,
      hrv: latest.sensors.hrv_rmssd.value,
      rhr: latest.sensors.restingHR.value,
    };
  },

  getPendingQuestions() {
    return SageApp.state.pendingQuestions;
  },
};

if (typeof window !== 'undefined') window.SageApp = SageApp;
