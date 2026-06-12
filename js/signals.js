/* ═══════════════════════════════════════════════════
   SAGEHEALTH — SIGNALS DETECTION ENGINE
   Watches biometric patterns. Notices things.
   Never diagnoses. Always tells them what to do next.
   ═══════════════════════════════════════════════════ */

/* ── PATTERN DEFINITIONS ──────────────────────────
   Each pattern has:
   - id: unique key (used for dismissal/acknowledgment)
   - level: 'urgent' | 'watch' | 'info'
   - icon, title
   - detect(data, profile, goals): returns true if pattern fires
   - watchingFor: what we've been tracking
   - narrative(data, profile): plain-English explanation
   - drivers(data): which specific metrics triggered it
   - action: the ONE specific thing to do
   - actionHow: exactly how to do it (no appointment needed etc.)
   - askSage: opening question for Dr. Sage chat
   ────────────────────────────────────────────────── */

const SIGNAL_PATTERNS = [

  // ── METABOLIC / PREDIABETES ──────────────────────
  {
    id: 'metabolic_pattern',
    level: 'watch',
    icon: '🩸',
    title: 'Metabolic stress pattern',
    category: 'Metabolic health',
    detect(data, profile) {
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const bpSys = avg(data, 'bpSys');
      const deep = avgF(data, 'deep');
      const steps = avg(data, 'steps');
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      let score = 0;
      if (rhr > 75) score++;
      if (hrv < hrvNorm - 10) score++;
      if (bpSys > 125) score++;
      if (deep < 1.0) score++;
      if (steps < 5000) score++;
      return score >= 3;
    },
    watchingFor: 'Resting HR, HRV, blood pressure, deep sleep, daily steps — all week',
    narrative(data, profile) {
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const bpSys = avg(data, 'bpSys');
      return `Over the past week, <strong>several of your metrics are moving in the same direction at the same time</strong> — elevated resting heart rate (${rhr} BPM), suppressed HRV (${hrv}ms), blood pressure trending at ${bpSys} mmHg, and reduced deep sleep. When these show up together, research associates this pattern with early metabolic stress — the kind of thing a fasting glucose test is specifically designed to catch. We're not saying anything is wrong. We're saying this combination is worth a single blood test to rule out.`;
    },
    drivers(data, profile) {
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      return [
        { label: `RHR ${avg(data,'rhr')} BPM`, flagged: avg(data,'rhr') > 75 },
        { label: `HRV ${avg(data,'hrv')}ms (norm ~${hrvNorm})`, flagged: avg(data,'hrv') < hrvNorm - 10 },
        { label: `BP ${avg(data,'bpSys')}/${avg(data,'bpDia')}`, flagged: avg(data,'bpSys') > 125 },
        { label: `Deep sleep ${avgF(data,'deep')}h`, flagged: avgF(data,'deep') < 1.0 },
        { label: `${avg(data,'steps').toLocaleString()} steps/day`, flagged: avg(data,'steps') < 5000 },
      ];
    },
    action: 'Get a fasting glucose + HbA1c blood test',
    actionHow: `You don't need a doctor's referral. Walk into any <strong>Quest Diagnostics or LabCorp</strong> location — no appointment needed. Ask for "fasting glucose and HbA1c." Fast for 8 hours beforehand (water is fine). Costs $35–50 without insurance. Results in 1–2 days. Normal fasting glucose is below 100 mg/dL. Prediabetes range is 100–125. This single test tells you exactly where you stand.`,
    askSage: 'Tell me more about what this metabolic pattern means for me.',
    disclaimer: 'This is a pattern observation, not a diagnosis. Only a licensed physician can diagnose prediabetes or any medical condition.'
  },

  // ── SLEEP APNEA ─────────────────────────────────
  {
    id: 'sleep_apnea_pattern',
    level: 'watch',
    icon: '😴',
    title: 'Sleep-disordered breathing pattern',
    category: 'Sleep health',
    detect(data, profile, goals) {
      const spo2 = avgF(data, 'spo2');
      const apnea = data.reduce((s, d) => s + d.apnea, 0) / data.length;
      const rem = avgF(data, 'rem');
      const hrv = avg(data, 'hrv');
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      let score = 0;
      if (spo2 < 95) score++;
      if (apnea > 2) score++;
      if (rem < 1.2) score++;
      if (hrv < hrvNorm - 15) score++;
      return score >= 2;
    },
    watchingFor: 'SpO₂ overnight, airway events, REM sleep, daytime HRV — all week',
    narrative(data, profile) {
      const spo2 = avgF(data, 'spo2');
      const apnea = (data.reduce((s, d) => s + d.apnea, 0) / data.length).toFixed(1);
      return `Your ring has been tracking your overnight breathing, and <strong>the pattern this week is worth paying attention to</strong>. Average SpO₂ of ${spo2}% with ${apnea} airway events per night suggests your breathing may be interrupted during sleep. Most people with sleep apnea have no idea — they just feel tired, have elevated blood pressure, and wonder why they never feel fully rested. Untreated sleep apnea is one of the leading causes of hypertension and cardiovascular disease. A home sleep study takes one night and tells you definitively.`;
    },
    drivers(data) {
      const apnea = (data.reduce((s, d) => s + d.apnea, 0) / data.length).toFixed(1);
      return [
        { label: `SpO₂ ${avgF(data,'spo2')}% avg`, flagged: avgF(data,'spo2') < 95 },
        { label: `${apnea} airway events/night`, flagged: parseFloat(apnea) > 2 },
        { label: `REM ${avgF(data,'rem')}h avg`, flagged: avgF(data,'rem') < 1.2 },
        { label: `HRV ${avg(data,'hrv')}ms`, flagged: true },
      ];
    },
    action: 'Order a home sleep study',
    actionHow: `You don't need to go anywhere. <strong>WatchPAT ONE</strong> and <strong>Lofta</strong> mail you a device, you wear it one night, mail it back, and get results reviewed by a sleep physician — all for around $150–200. No in-lab overnight stay. If you have insurance, your primary care doctor can order a home sleep study with a simple referral. Also worth trying: sleep on your side tonight — it reduces airway obstruction for most people immediately.`,
    askSage: 'What does my sleep breathing pattern tell you, and how worried should I be?',
    disclaimer: 'Ring-based detection is a screening signal, not a diagnostic. A formal sleep study is required for diagnosis.'
  },

  // ── HYPERTENSION ────────────────────────────────
  {
    id: 'bp_elevated',
    level: 'watch',
    icon: '🫀',
    title: 'Sustained blood pressure elevation',
    category: 'Cardiovascular',
    detect(data) {
      const bpSys = avg(data, 'bpSys');
      const highDays = data.filter(d => d.bpSys >= 130).length;
      return bpSys >= 130 || highDays >= 4;
    },
    watchingFor: 'Blood pressure systolic — daily readings this week',
    narrative(data) {
      const bpSys = avg(data, 'bpSys');
      const bpDia = avg(data, 'bpDia');
      const highDays = data.filter(d => d.bpSys >= 130).length;
      return `Your average blood pressure this week is <strong>${bpSys}/${bpDia} mmHg</strong>, with ${highDays} out of 7 days above 130 systolic. Blood pressure in this range is worth confirming because it damages artery walls silently — no symptoms, no warning, until something breaks. It's also highly treatable when caught early. The TK30's reading is a pulse-wave estimate — before doing anything else, confirm with a proper arm cuff. If an arm cuff agrees, bring it to your doctor.`;
    },
    drivers(data) {
      return [
        { label: `Avg systolic ${avg(data,'bpSys')} mmHg`, flagged: avg(data,'bpSys') >= 130 },
        { label: `Avg diastolic ${avg(data,'bpDia')} mmHg`, flagged: avg(data,'bpDia') >= 85 },
        { label: `${data.filter(d=>d.bpSys>=130).length}/7 days elevated`, flagged: true },
        { label: `HRV ${avg(data,'hrv')}ms`, flagged: avg(data,'hrv') < 45 },
      ];
    },
    action: 'Confirm with an arm cuff, then track for 7 days',
    actionHow: `Pick up an <strong>Omron blood pressure cuff</strong> at any pharmacy ($30–40). Take readings at the same time each morning — sit quietly for 5 minutes first. Record 7 days. If your average stays above 130 systolic, bring that log to your doctor. In the meantime: reduce sodium, drink more water, take a 20-minute walk daily. These three changes can drop systolic BP by 5–10 points within two weeks.`,
    askSage: 'My blood pressure has been elevated this week — what should I do about it?',
    disclaimer: 'TK30 blood pressure is a cuffless estimate for trend tracking. Confirm with an arm cuff before making any medical decisions.'
  },

  // ── CARDIOVASCULAR AGE DRIFT ─────────────────────
  {
    id: 'cv_age_drift',
    level: 'info',
    icon: '❤️',
    title: 'Cardiovascular fitness declining',
    category: 'Cardiovascular',
    detect(data, profile) {
      const age = profile.age || 48;
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const spo2 = avgF(data, 'spo2');
      const cvAge = Math.max(25, age + (rhr > 72 ? 3 : 0) + (hrv < 45 ? 2 : 0) + (spo2 < 95 ? 2 : 0));
      return cvAge > age + 4;
    },
    watchingFor: 'Cardiovascular age estimate based on RHR, HRV, and SpO₂ — this week',
    narrative(data, profile) {
      const age = profile.age || 48;
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const spo2 = avgF(data, 'spo2');
      const cvAge = Math.max(25, age + (rhr > 72 ? 3 : 0) + (hrv < 45 ? 2 : 0) + (spo2 < 95 ? 2 : 0));
      return `Based on your resting heart rate (${rhr} BPM), HRV (${hrv}ms), and SpO₂ (${spo2}%), your cardiovascular system is currently performing <strong>like someone ${cvAge} years old</strong> — ${cvAge - age} years older than your actual age of ${age}. This is fixable. Cardiovascular fitness responds faster to intervention than almost any other health metric. The changes that move this number are specific and well-established.`;
    },
    drivers(data, profile) {
      const age = profile.age || 48;
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const spo2 = avgF(data, 'spo2');
      const cvAge = Math.max(25, age + (rhr > 72 ? 3 : 0) + (hrv < 45 ? 2 : 0) + (spo2 < 95 ? 2 : 0));
      return [
        { label: `CV age ~${cvAge} (actual: ${age})`, flagged: true },
        { label: `RHR ${rhr} BPM`, flagged: rhr > 72 },
        { label: `HRV ${hrv}ms`, flagged: hrv < 45 },
        { label: `SpO₂ ${spo2}%`, flagged: spo2 < 95 },
      ];
    },
    action: 'Start zone 2 cardio — 3x per week, 30 minutes',
    actionHow: `Zone 2 cardio is the single most evidence-backed intervention for improving cardiovascular age. It means working at a pace where you can hold a conversation but not comfortably sing — a brisk walk, easy bike ride, or slow jog. <strong>30 minutes, 3 times per week</strong>. Studies show measurable HRV improvement within 4–6 weeks and resting HR reduction within 8 weeks. Track your progress in SageHealth — we'll show you when the numbers start moving.`,
    askSage: 'How do I improve my cardiovascular fitness based on what you see in my data?',
    disclaimer: 'Cardiovascular age is an estimate based on biometric proxies, not a clinical measurement.'
  },

  // ── INFECTION INCOMING ───────────────────────────
  {
    id: 'immune_activation',
    level: 'urgent',
    icon: '🌡️',
    title: 'Immune system activation detected',
    category: 'Early illness warning',
    detect(data) {
      const t = data[data.length - 1];
      const hrv = avg(data.slice(-3), 'hrv');
      const prevHrv = avg(data.slice(0, 4), 'hrv');
      return t.tempDev > 0.5 || (t.tempDev > 0.3 && hrv < prevHrv * 0.85);
    },
    watchingFor: 'Body temperature vs personal baseline + HRV trend — last 3 nights',
    narrative(data) {
      const t = data[data.length - 1];
      const hrv = avg(data.slice(-3), 'hrv');
      const prevHrv = avg(data.slice(0, 4), 'hrv');
      const devF = (t.tempDev * 9 / 5).toFixed(1);
      return `Last night your body temperature was <strong>${(t.tempDev >= 0 ? '+' : '')}${devF}°F above your personal baseline</strong>${hrv < prevHrv * 0.85 ? `, and your HRV dropped from ${prevHrv}ms to ${hrv}ms over 3 nights` : ''}. This is exactly the pattern your ring is designed to catch early — your immune system activated before you felt anything. Most people feel symptoms 12–48 hours after this signal appears. You have a window right now to rest, hydrate, and get ahead of it.`;
    },
    drivers(data) {
      const t = data[data.length - 1];
      const hrv3 = avg(data.slice(-3), 'hrv');
      const hrv4 = avg(data.slice(0, 4), 'hrv');
      const devF = (t.tempDev * 9 / 5).toFixed(1);
      return [
        { label: `Temp ${(t.tempDev >= 0 ? '+' : '')}${devF}°F from baseline`, flagged: t.tempDev > 0.3, urgent: t.tempDev > 0.5 },
        { label: `HRV ${hrv3}ms (was ${hrv4}ms)`, flagged: hrv3 < hrv4 * 0.85 },
        { label: `Tonight: ${t.tempF}°F`, flagged: true },
      ];
    },
    action: 'Rest today. Hydrate aggressively. Watch for symptoms.',
    actionHow: `<strong>Right now:</strong> Drink 16oz of water with electrolytes. Cancel anything strenuous today. Sleep an extra hour tonight if you can — sleep is your immune system's primary weapon. <strong>If symptoms develop:</strong> Test for COVID, flu, and strep — all available as rapid home tests. If temperature rises above 100.4°F or you feel worse after 48 hours, see a doctor. <strong>The goal:</strong> Many people who act on this signal recover faster than those who push through.`,
    askSage: 'My temperature spiked above baseline last night — what does that mean?',
    disclaimer: 'Temperature deviation is an early warning signal, not a diagnosis. Many causes are minor. Track and rest.'
  },

  // ── CHRONIC STRESS / BURNOUT ─────────────────────
  {
    id: 'chronic_stress',
    level: 'watch',
    icon: '🧠',
    title: 'Chronic stress pattern',
    category: 'Mental health & recovery',
    detect(data, profile) {
      const hrv = avg(data, 'hrv');
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      const sleep = avgF(data, 'sleep');
      const readiness = avg(data, 'readiness');
      const hrvDropping = data[data.length-1].hrv < data[0].hrv * 0.85;
      return hrv < hrvNorm - 12 && sleep >= 6.5 && readiness < 65 && hrvDropping;
    },
    watchingFor: 'HRV trend, sleep quality, readiness score — all week',
    narrative(data, profile) {
      const hrv = avg(data, 'hrv');
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      const readiness = avg(data, 'readiness');
      return `You're sleeping enough, but <strong>your nervous system isn't recovering</strong>. HRV has averaged ${hrv}ms this week — ${hrvNorm - hrv}ms below the expected range for your age — and your readiness score averaged ${readiness}/100. This is the pattern of chronic load: the body keeps going, but the reserve tank is quietly draining. The cause is usually sustained stress, overwork, or accumulated pressure that hasn't had a release valve. Your ring sees it before you consciously feel it.`;
    },
    drivers(data, profile) {
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      return [
        { label: `HRV ${avg(data,'hrv')}ms (norm ~${hrvNorm})`, flagged: true },
        { label: `Readiness ${avg(data,'readiness')}/100`, flagged: avg(data,'readiness') < 65 },
        { label: `Sleep ${avgF(data,'sleep')}h avg`, flagged: false },
        { label: `HRV trending down`, flagged: data[data.length-1].hrv < data[0].hrv * 0.85 },
      ];
    },
    action: 'Talk to someone — and take one full rest day this week',
    actionHow: `<strong>This week:</strong> Take one completely unscheduled day — no obligations, no performance. Your HRV will tell us within 48 hours if it helped. <strong>Longer term:</strong> Chronic HRV suppression with adequate sleep is often associated with anxiety or burnout. A few sessions with a therapist or counselor have stronger evidence for HRV recovery than almost any other intervention. If cost is a barrier, BetterHelp and similar services start at $65/week. Your ring will show us if things shift.`,
    askSage: 'My HRV has been suppressed all week even though I\'m sleeping. What\'s happening?',
    disclaimer: 'HRV suppression has many causes. This is an observation, not a mental health diagnosis.'
  },

  // ── OVERTRAINING ────────────────────────────────
  {
    id: 'overtraining',
    level: 'watch',
    icon: '🏃',
    title: 'Overtraining signal',
    category: 'Fitness & recovery',
    detect(data, profile) {
      const steps = avg(data, 'steps');
      const hrv = avg(data, 'hrv');
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      const rhr = avg(data, 'rhr');
      const readiness = avg(data, 'readiness');
      return steps > 10000 && hrv < hrvNorm - 10 && rhr > 68 && readiness < 65;
    },
    watchingFor: 'Steps vs HRV recovery — are you working harder than you\'re recovering?',
    narrative(data) {
      const steps = avg(data, 'steps').toLocaleString();
      const hrv = avg(data, 'hrv');
      const rhr = avg(data, 'rhr');
      return `You're moving a lot — averaging ${steps} steps/day — but your body isn't keeping up. <strong>HRV is ${hrv}ms and resting HR is ${rhr} BPM</strong>, which means your nervous system is under sustained load even at rest. This is the classic overtraining pattern: output exceeds recovery. The risk isn't just performance decline — it's immune suppression and injury. The counterintuitive answer is to do less this week.`;
    },
    drivers(data) {
      return [
        { label: `${avg(data,'steps').toLocaleString()} steps/day avg`, flagged: false },
        { label: `HRV ${avg(data,'hrv')}ms (suppressed)`, flagged: true },
        { label: `RHR ${avg(data,'rhr')} BPM (elevated)`, flagged: avg(data,'rhr') > 68 },
        { label: `Readiness ${avg(data,'readiness')}/100`, flagged: avg(data,'readiness') < 65 },
      ];
    },
    action: 'Take 2 rest days. Reduce intensity by 40% this week.',
    actionHow: `<strong>Today and tomorrow:</strong> Walk only — no runs, no hard workouts. Prioritize sleep over training. <strong>This week:</strong> Drop workout intensity by 40%. Elite athletes monitor HRV daily for exactly this reason — they know that training through suppressed HRV makes you slower and increases injury risk. Watch your HRV in SageHealth — if it's back above your baseline within 5 days, resume normal training. If not, extend the recovery window.`,
    askSage: 'My HRV is dropping even though I\'m training hard. Am I overtraining?',
    disclaimer: 'This is a recovery signal based on HRV and activity patterns. Individual training needs vary.'
  },

  // ── THYROID PATTERN ──────────────────────────────
  {
    id: 'thyroid_pattern',
    level: 'info',
    icon: '🦋',
    title: 'Possible thyroid pattern',
    category: 'Metabolic health',
    detect(data, profile) {
      const rhr = avg(data, 'rhr');
      const hrv = avg(data, 'hrv');
      const temp = avgF(data, 'tempC');
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      const tempLow = temp < 36.3;
      const tempHigh = temp > 37.1;
      const rhrElevated = rhr > 78;
      const hrvSuppressed = hrv < hrvNorm - 15;
      // Hypo pattern: low temp + elevated HR + suppressed HRV
      const hypo = tempLow && rhrElevated && hrvSuppressed;
      // Hyper pattern: high temp + very elevated HR + suppressed HRV
      const hyper = tempHigh && rhr > 85 && hrvSuppressed;
      return hypo || hyper;
    },
    watchingFor: 'Body temperature baseline, resting HR, HRV — looking for thyroid-associated patterns',
    narrative(data, profile) {
      const rhr = avg(data, 'rhr');
      const temp = avgF(data, 'tempC');
      const age = profile.age || 48;
      const isHypo = temp < 36.3;
      return `Your biometric pattern this week — <strong>resting HR ${rhr} BPM, body temperature averaging ${(temp * 9/5 + 32).toFixed(1)}°F, and suppressed HRV</strong> — is consistent with a pattern sometimes associated with ${isHypo ? 'hypothyroidism (underactive thyroid)' : 'hyperthyroidism (overactive thyroid)'}. Thyroid conditions affect 1 in 8 women and are significantly underdiagnosed. A single blood test (TSH panel) rules it in or out in 48 hours. This is not a diagnosis — it's a reason to check.`;
    },
    drivers(data, profile) {
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      const tempC = avgF(data, 'tempC');
      return [
        { label: `RHR ${avg(data,'rhr')} BPM`, flagged: avg(data,'rhr') > 78 },
        { label: `HRV ${avg(data,'hrv')}ms (norm ~${hrvNorm})`, flagged: true },
        { label: `Temp avg ${(tempC * 9/5 + 32).toFixed(1)}°F`, flagged: tempC < 36.3 || tempC > 37.1 },
      ];
    },
    action: 'Get a TSH thyroid panel',
    actionHow: `A <strong>TSH (thyroid-stimulating hormone) blood test</strong> is a routine lab that any primary care doctor can order. You can also order it yourself through <strong>Ulta Lab Tests or Walk-In Lab</strong> for $29–45 without insurance or a referral. Fast for 8 hours. Results in 1–2 days. Normal TSH is 0.4–4.0 mIU/L. If yours is outside that range, bring the result to your doctor — thyroid conditions are very treatable.`,
    askSage: 'What does the thyroid pattern in my data mean, and should I be concerned?',
    disclaimer: 'Biometric patterns are not diagnostic of thyroid conditions. Only a blood test and physician can diagnose thyroid disorders.'
  },

  // ── POOR SLEEP ARCHITECTURE ──────────────────────
  {
    id: 'sleep_architecture',
    level: 'info',
    icon: '🌙',
    title: 'Chronic sleep quality deficit',
    category: 'Sleep health',
    detect(data, profile, goals) {
      const deep = avgF(data, 'deep');
      const rem = avgF(data, 'rem');
      const sleep = avgF(data, 'sleep');
      const sleepGoal = goals.sleep || 7.5;
      return sleep >= sleepGoal * 0.9 && (deep < 1.0 || rem < 1.2);
    },
    watchingFor: 'Deep sleep and REM duration across all 7 nights',
    narrative(data) {
      const deep = avgF(data, 'deep');
      const rem = avgF(data, 'rem');
      const sleep = avgF(data, 'sleep');
      return `You're getting ${sleep} hours of sleep — the quantity looks okay. But the quality is the issue. <strong>Deep sleep averaged ${deep}h and REM averaged ${rem}h</strong> this week, both below the targets that allow full physical and cognitive recovery. Deep sleep is when your body repairs tissue and runs its maintenance cycle. REM is when your brain processes emotion and consolidates memory. Getting 8 hours of light sleep is not the same as 7 hours of properly structured sleep.`;
    },
    drivers(data) {
      return [
        { label: `Sleep ${avgF(data,'sleep')}h avg`, flagged: false },
        { label: `Deep ${avgF(data,'deep')}h (target 1.5h)`, flagged: avgF(data,'deep') < 1.0 },
        { label: `REM ${avgF(data,'rem')}h (target 1.5h)`, flagged: avgF(data,'rem') < 1.2 },
        { label: `Apnea events avg`, flagged: data.reduce((s,d)=>s+d.apnea,0)/data.length > 2 },
      ];
    },
    action: 'Three specific changes — pick one to start tonight',
    actionHow: `<strong>1. Temperature:</strong> Drop your bedroom to 65–68°F. Deep sleep requires core body cooling — this is the single highest-impact physical change. <strong>2. Timing:</strong> Move your bedtime 30 minutes earlier for one week. Deep sleep is concentrated in the first half of the night — going to bed later cuts into it disproportionately. <strong>3. Alcohol:</strong> If you drink, stop 3 hours before bed. Alcohol fragments sleep architecture and almost eliminates deep sleep even at low doses. Pick one. We'll check your numbers next week.`,
    askSage: 'I\'m getting enough sleep but my deep sleep is low — what can I do?',
    disclaimer: 'Sleep stage data from ring sensors is an estimate. Clinical sleep studies provide the most accurate staging.'
  },

];

/* ── HELPERS (mirror from app.js) ─────────────────── */
function avg(arr, k) { return Math.round(arr.reduce((s, d) => s + d[k], 0) / arr.length); }
function avgF(arr, k) { return +(arr.reduce((s, d) => s + d[k], 0) / arr.length).toFixed(1); }

/* ── MAIN RENDER FUNCTION ─────────────────────────── */
function buildSignalsPanel(data, profile, goals) {
  const container = document.getElementById('signals-panel');
  if (!container) return;

  // Load dismissed signals
  const dismissed = JSON.parse(localStorage.getItem('sh_dismissed_signals') || '[]');
  const acknowledged = JSON.parse(localStorage.getItem('sh_acknowledged_signals') || '{}');

  // Run all detectors
  const fired = SIGNAL_PATTERNS.filter(p => {
    if (dismissed.includes(p.id)) return false;
    try { return p.detect(data, profile, goals); }
    catch(e) { return false; }
  });

  // Sort: urgent first, then watch, then info
  const order = { urgent: 0, watch: 1, info: 2 };
  fired.sort((a, b) => order[a.level] - order[b.level]);

  // Build header
  const urgentCount = fired.filter(s => s.level === 'urgent').length;
  const watchCount = fired.filter(s => s.level === 'watch').length;

  let badgeText = 'All clear';
  let badgeClass = 'clear';
  if (urgentCount > 0) { badgeText = `${urgentCount} urgent`; badgeClass = ''; }
  else if (watchCount > 0) { badgeText = `${watchCount} to watch`; badgeClass = ''; }

  let html = `
    <div class="signals-header">
      <div class="signals-title">
        <span>🔍</span> SageHealth signals
        <span class="signals-badge ${badgeClass}">${badgeText}</span>
      </div>
    </div>`;

  if (fired.length === 0) {
    html += `<div class="signals-all-clear">
      <span style="font-size:20px;">✅</span>
      <div>No patterns flagged this week. Your metrics look stable — keep it up. SageHealth is watching.</div>
    </div>`;
  } else {
    fired.forEach(sig => {
      const drivers = sig.drivers(data, profile);
      const narrative = sig.narrative(data, profile);
      const isAck = acknowledged[sig.id];

      html += `
        <div class="sig-card sig-${sig.level}" id="sigcard-${sig.id}">
          <div class="sig-head">
            <div>
              <div class="sig-title-row">
                <span class="sig-icon">${sig.icon}</span>
                <span class="sig-title">${sig.title}</span>
                <span class="sig-level ${sig.level}">${sig.level}</span>
              </div>
              <div class="sig-watching">👁 Watching: ${sig.watchingFor}</div>
            </div>
          </div>

          <div class="sig-body">${narrative}</div>

          <div class="sig-drivers">
            ${drivers.map(d => `<span class="sig-driver ${d.urgent ? 'red' : d.flagged ? 'flagged' : ''}">${d.label}</span>`).join('')}
          </div>

          <div class="sig-action">
            <div class="sig-action-label">What to do</div>
            <div class="sig-action-text"><strong>${sig.action}</strong></div>
          </div>

          <div class="sig-action" style="margin-top:8px;">
            <div class="sig-action-label">Exactly how</div>
            <div class="sig-action-text">${sig.actionHow}</div>
          </div>

          <div class="sig-btns">
            <button class="sig-btn-did" onclick="acknowledgeSignal('${sig.id}')">
              ${isAck ? '✓ Acknowledged' : 'I\'m on it'}
            </button>
            <button class="sig-btn-sage" onclick="openSignalChat('${sig.id}', \`${sig.askSage.replace(/`/g,"'")}\`)">
              🧠 Ask Dr. Sage
            </button>
            <button class="sig-btn-dismiss" onclick="dismissSignal('${sig.id}')">
              Dismiss this week
            </button>
          </div>

          <div class="sig-disclaimer">⚠ ${sig.disclaimer}</div>
        </div>`;
    });
  }

  container.innerHTML = html;

  // Save fired signals to localStorage for use in encounters + doctor reports
  localStorage.setItem('sh_active_signals', JSON.stringify(fired.map(s => ({
    id: s.id,
    level: s.level,
    title: s.title,
    category: s.category,
    action: s.action
  }))));
}

/* ── SIGNAL ACTIONS ───────────────────────────────── */
function acknowledgeSignal(id) {
  const ack = JSON.parse(localStorage.getItem('sh_acknowledged_signals') || '{}');
  ack[id] = new Date().toISOString();
  localStorage.setItem('sh_acknowledged_signals', JSON.stringify(ack));
  const btn = document.querySelector(`#sigcard-${id} .sig-btn-did`);
  if (btn) { btn.textContent = '✓ On it'; btn.style.opacity = '.6'; }
  showToast('✓ Noted', 'We\'ll track whether this changes your numbers.');
}

function dismissSignal(id) {
  const dismissed = JSON.parse(localStorage.getItem('sh_dismissed_signals') || '[]');
  if (!dismissed.includes(id)) dismissed.push(id);
  // Auto-expire dismissals after 7 days
  localStorage.setItem('sh_dismissed_signals', JSON.stringify(dismissed));
  localStorage.setItem('sh_dismissed_ts_' + id, Date.now().toString());
  const card = document.getElementById('sigcard-' + id);
  if (card) { card.style.opacity = '0'; card.style.transition = 'opacity .3s'; setTimeout(() => card.remove(), 300); }
}

function openSignalChat(sigId, question) {
  // Open weekly modal on chat tab with pre-filled question
  openWeekly();
  setTimeout(() => {
    encTab('chat');
    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) { input.value = question; input.focus(); }
    }, 400);
  }, 200);
}

/* ── EXPIRE OLD DISMISSALS ────────────────────────── */
function expireOldDismissals() {
  const dismissed = JSON.parse(localStorage.getItem('sh_dismissed_signals') || '[]');
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const stillDismissed = dismissed.filter(id => {
    const ts = parseInt(localStorage.getItem('sh_dismissed_ts_' + id) || '0');
    return Date.now() - ts < weekMs;
  });
  localStorage.setItem('sh_dismissed_signals', JSON.stringify(stillDismissed));
}
