/* ═══════════════════════════════════════════════════
   SAGEHEALTH — STATE MAP ENGINE
   Runs locally after signal detection.
   Produces clean structured context for Groq —
   no raw data dumps, only meaningful state changes.
   ═══════════════════════════════════════════════════ */

/* ── BUILD FULL STATE MAP ────────────────────────────
   Called once after signals fire.
   Returns a structured object Groq can reason about
   cleanly without hallucinating from raw noise.
   ─────────────────────────────────────────────────── */
function buildStateMap(data, profile, goals, firedSignals) {
  if (!data || data.length === 0) return null;

  const today    = data[data.length - 1];
  const week     = data;
  const first3   = data.slice(0, 3);
  const last3    = data.slice(-3);
  const age      = profile.age  || 48;
  const sex      = profile.sex  || 'Male';
  const hrvNorm  = Math.round(65 - age * 0.5);

  // ── TREND HELPER ─────────────────────────────────
  function trend(key, lowerIsBetter = false) {
    const early  = avgArr(first3, key);
    const recent = avgArr(last3,  key);
    const delta  = recent - early;
    const pct    = early > 0 ? Math.round(Math.abs(delta) / early * 100) : 0;
    if (Math.abs(delta) < 1) return { direction: 'stable', delta: 0, pct: 0, label: 'stable' };
    const improving = lowerIsBetter ? delta < 0 : delta > 0;
    return {
      direction: improving ? 'improving' : 'worsening',
      delta: +delta.toFixed(1),
      pct,
      label: `${improving ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} over 7 days`
    };
  }

  function avgArr(arr, key) {
    const vals = arr.map(d => d[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : 0;
  }

  function deviation(val, norm, label) {
    const diff = val - norm;
    if (Math.abs(diff) < 2) return `${val} ${label} (normal)`;
    return `${val} ${label} (${diff > 0 ? '+' : ''}${diff.toFixed(1)} vs norm of ${norm})`;
  }

  // ── CARDIOVASCULAR STATE ──────────────────────────
  const cardio = {
    rhr: {
      current: today.rhr,
      avg7d: avgArr(week, 'rhr'),
      trend: trend('rhr', true),
      status: today.rhr < 60 ? 'athletic' : today.rhr < 70 ? 'healthy' : today.rhr < 80 ? 'elevated' : 'high',
      vs_norm: deviation(today.rhr, 65, 'BPM')
    },
    hrv: {
      current: today.hrv,
      avg7d: avgArr(week, 'hrv'),
      age_norm: hrvNorm,
      trend: trend('hrv'),
      gap_from_norm: today.hrv - hrvNorm,
      status: today.hrv >= hrvNorm + 5 ? 'excellent' : today.hrv >= hrvNorm ? 'normal' : today.hrv >= hrvNorm - 10 ? 'below_norm' : 'suppressed'
    },
    bp: {
      systolic: today.bpSys,
      diastolic: today.bpDia,
      avg7d_sys: avgArr(week, 'bpSys'),
      trend: trend('bpSys', true),
      days_elevated: week.filter(d => d.bpSys >= 130).length,
      status: today.bpSys < 120 ? 'optimal' : today.bpSys < 130 ? 'normal' : today.bpSys < 140 ? 'elevated' : 'high'
    },
    spo2: {
      current: today.spo2,
      avg7d: avgArr(week, 'spo2'),
      trend: trend('spo2'),
      status: today.spo2 >= 97 ? 'excellent' : today.spo2 >= 95 ? 'normal' : today.spo2 >= 92 ? 'watch' : 'low'
    }
  };

  // ── SLEEP STATE ───────────────────────────────────
  const sleep = {
    total: {
      last_night: today.sleep,
      avg7d: avgArr(week, 'sleep'),
      goal: goals.sleepHours || 7.5,
      deficit: +((goals.sleepHours || 7.5) - avgArr(week, 'sleep')).toFixed(1),
      trend: trend('sleep')
    },
    deep: {
      last_night: today.deep,
      avg7d: avgArr(week, 'deep'),
      target: 1.5,
      deficit: +(1.5 - avgArr(week, 'deep')).toFixed(1),
      trend: trend('deep')
    },
    rem: {
      last_night: today.rem,
      avg7d: avgArr(week, 'rem'),
      target: 1.5,
      deficit: +(1.5 - avgArr(week, 'rem')).toFixed(1),
      trend: trend('rem')
    },
    apnea_events: today.apnea || 0,
    quality_score: today.sleepScore || Math.round(
      (Math.min(today.sleep / 7.5, 1) * 40) +
      (Math.min((today.deep || 0) / 1.5, 1) * 35) +
      (Math.min((today.rem  || 0) / 1.5, 1) * 25)
    )
  };

  // ── TEMPERATURE STATE ─────────────────────────────
  const temperature = {
    last_night_f: today.tempF,
    deviation_f: +((today.tempDev || 0) * 9 / 5).toFixed(1),
    avg7d_f: +avgArr(week.map(d => ({v: d.tempF})), 'v'),
    trend: trend('tempF'),
    status: Math.abs(today.tempDev || 0) <= 0.2 ? 'baseline' :
            (today.tempDev || 0) > 0.5 ? 'elevated_significant' :
            (today.tempDev || 0) > 0.2 ? 'elevated_mild' : 'below_baseline',
    days_elevated: week.filter(d => (d.tempDev || 0) > 0.3).length
  };

  // ── ACTIVITY STATE ────────────────────────────────
  const activity = {
    steps_today: today.steps,
    steps_avg7d: avgArr(week, 'steps'),
    steps_goal: goals.steps || 8000,
    goal_pct: Math.round((today.steps / (goals.steps || 8000)) * 100),
    trend: trend('steps'),
    calories: today.calories,
    status: today.steps >= (goals.steps || 8000) ? 'goal_met' :
            today.steps >= (goals.steps || 8000) * 0.75 ? 'close' : 'below_goal'
  };

  // ── RECOVERY STATE ────────────────────────────────
  const recovery = {
    readiness: today.readiness,
    trend: trend('readiness'),
    status: today.readiness >= 85 ? 'peak' : today.readiness >= 70 ? 'good' :
            today.readiness >= 55 ? 'moderate' : 'low',
    consecutive_low_days: (() => {
      let count = 0;
      for (let i = week.length - 1; i >= 0; i--) {
        if ((week[i].readiness || 0) < 65) count++;
        else break;
      }
      return count;
    })()
  };

  // ── SIGNAL CONTEXT ────────────────────────────────
  // Which signals fired, how severe, how long
  const signalContext = (firedSignals || []).map(sig => ({
    id: sig.id,
    title: sig.title,
    level: sig.level,
    category: sig.category,
    correlated_with: (firedSignals || [])
      .filter(s => s.id !== sig.id && s.category === sig.category)
      .map(s => s.title)
  }));

  // ── PATIENT CONTEXT ───────────────────────────────
  const patient = {
    name: profile.name || '',
    age,
    sex,
    conditions: profile.conditions || 'None reported',
    medications: profile.medications || 'None reported',
    goals: {
      steps: goals.steps || 8000,
      sleep: goals.sleepHours || 7.5
    }
  };

  // ── COMPOSITE HEALTH GRADE ────────────────────────
  const grade = (() => {
    let pts = 0, max = 0;
    if (today.hrv)    { pts += today.hrv >= hrvNorm+5?4:today.hrv>=hrvNorm?3:today.hrv>=hrvNorm-10?2:1; max+=4; }
    if (today.rhr)    { pts += today.rhr<60?4:today.rhr<70?3:today.rhr<80?2:1; max+=4; }
    if (today.bpSys)  { pts += today.bpSys<120?4:today.bpSys<130?3:today.bpSys<140?2:1; max+=4; }
    if (today.spo2)   { pts += today.spo2>=97?4:today.spo2>=95?3:today.spo2>=92?2:1; max+=4; }
    if (today.sleep)  { pts += today.sleep>=7.5?4:today.sleep>=6.5?3:today.sleep>=5.5?2:1; max+=4; }
    if (today.deep)   { pts += today.deep>=1.5?4:today.deep>=1?3:today.deep>=0.7?2:1; max+=4; }
    if (today.steps)  { pts += today.steps>=8000?4:today.steps>=6000?3:today.steps>=4000?2:1; max+=4; }
    const pct = max > 0 ? pts/max : 0.75;
    return pct>=0.875?'A':pct>=0.75?'B':pct>=0.55?'C':'D';
  })();

  return {
    generated_at: new Date().toISOString(),
    health_grade: grade,
    patient,
    cardio,
    sleep,
    temperature,
    activity,
    recovery,
    active_signals: signalContext,
    signal_count: (firedSignals || []).length,
    urgent_count: (firedSignals || []).filter(s => s.level === 'urgent').length
  };
}

/* ── FORMAT STATE MAP FOR GROQ PROMPT ───────────────
   Converts the state map to a compact, readable string
   that gives Groq exactly what it needs — no raw arrays,
   no noise, just structured clinical context.
   ─────────────────────────────────────────────────── */
function formatStateMapForPrompt(stateMap, focusSignalId) {
  if (!stateMap) return 'No health data available.';

  const m = stateMap;
  const sig = m.active_signals.find(s => s.id === focusSignalId) || m.active_signals[0];
  const correlated = sig?.correlated_with?.length > 0
    ? `\nCorrelated signals: ${sig.correlated_with.join(', ')}` : '';

  return `PATIENT: ${m.patient.age}yo ${m.patient.sex} | Conditions: ${m.patient.conditions} | Health grade: ${m.health_grade}

FOCUS SIGNAL: ${sig?.title || 'General health review'} (${sig?.level || 'info'})${correlated}

CARDIOVASCULAR:
- HRV: ${m.cardio.hrv.current}ms (age norm ${m.cardio.hrv.age_norm}ms, gap: ${m.cardio.hrv.gap_from_norm > 0 ? '+' : ''}${m.cardio.hrv.gap_from_norm}ms) | Status: ${m.cardio.hrv.status} | Trend: ${m.cardio.hrv.trend.label}
- RHR: ${m.cardio.rhr.current} BPM | Status: ${m.cardio.rhr.status} | Trend: ${m.cardio.rhr.trend.label}
- BP: ${m.cardio.bp.systolic}/${m.cardio.bp.diastolic} mmHg | Status: ${m.cardio.bp.status} | ${m.cardio.bp.days_elevated}/7 days elevated | Trend: ${m.cardio.bp.trend.label}
- SpO2: ${m.cardio.spo2.current}% | Status: ${m.cardio.spo2.status}

SLEEP (last night / 7-day avg):
- Total: ${m.sleep.total.last_night}h / ${m.sleep.total.avg7d}h (goal ${m.sleep.total.goal}h, deficit ${m.sleep.total.deficit}h)
- Deep: ${m.sleep.deep.last_night}h / ${m.sleep.deep.avg7d}h (target 1.5h, deficit ${m.sleep.deep.deficit}h) | Trend: ${m.sleep.deep.trend.label}
- REM: ${m.sleep.rem.last_night}h / ${m.sleep.rem.avg7d}h (target 1.5h) | Trend: ${m.sleep.rem.trend.label}
- Apnea events: ${m.sleep.apnea_events} | Quality score: ${m.sleep.quality_score}/100

TEMPERATURE:
- Last night: ${m.temperature.last_night_f}°F | Deviation: ${m.temperature.deviation_f > 0 ? '+' : ''}${m.temperature.deviation_f}°F from baseline
- Status: ${m.temperature.status} | Days elevated this week: ${m.temperature.days_elevated}

ACTIVITY:
- Steps: ${(m.activity.steps_today || 0).toLocaleString()} today (${m.activity.goal_pct}% of goal) | 7-day avg: ${(m.activity.steps_avg7d || 0).toLocaleString()} | Status: ${m.activity.status}

RECOVERY:
- Readiness: ${m.recovery.readiness}/100 | Status: ${m.recovery.status} | Trend: ${m.recovery.trend.label}
- Consecutive low-readiness days: ${m.recovery.consecutive_low_days}

ALL ACTIVE SIGNALS (${m.signal_count} total, ${m.urgent_count} urgent):
${m.active_signals.map(s => `- ${s.title} [${s.level}]`).join('\n') || '- None'}`;
}

/* ── STORE STATE MAP ─────────────────────────────────
   Saves to localStorage after each signal run.
   voice-consult.js and app.js read from here.
   ─────────────────────────────────────────────────── */
function saveStateMap(stateMap) {
  if (!stateMap) return;
  localStorage.setItem('sh_state_map', JSON.stringify(stateMap));
}

function loadStateMap() {
  try {
    const raw = localStorage.getItem('sh_state_map');
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
