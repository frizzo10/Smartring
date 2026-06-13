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
    askSage: 'My HRV has been suppressed all week even though I am sleeping. What is happening?',
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
    watchingFor: 'Steps vs HRV recovery — are you working harder than you are recovering?',
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
    askSage: 'My HRV is dropping even though I am training hard. Am I overtraining?',
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
    askSage: 'I am getting enough sleep but my deep sleep is low. What can I do?',
    disclaimer: 'Sleep stage data from ring sensors is an estimate. Clinical sleep studies provide the most accurate staging.'
  },

  // ── VASOVAGAL SYNCOPE / ORTHOSTATIC HYPOTENSION ────────
  {
    id: 'vasovagal_syncope',
    level: 'watch',
    icon: '💫',
    title: 'Vasovagal syncope risk',
    category: 'Cardiovascular',
    detect(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      // Sudden BP dip + reflexive HR spike after inactivity
      const bpDrop = (prev.bpSys - t.bpSys) > 8;
      const hrSpike = (t.rhr - prev.rhr) > 6;
      const lowSteps = t.steps < 3000;
      return bpDrop && hrSpike && lowSteps;
    },
    watchingFor: 'Blood pressure drops paired with sudden HR spikes following periods of inactivity',
    narrative(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      const drop = prev.bpSys - t.bpSys;
      return `Your ring detected a <strong>sharp drop in blood pressure (${drop} mmHg) paired with a reflexive heart rate spike</strong> following a period of low activity. This pattern is associated with vasovagal syncope — the mechanism behind fainting when standing up too quickly or after prolonged sitting. Your nervous system is overcompensating. It's worth knowing about before it catches you off guard.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      return [
        { label: `BP drop ${prev.bpSys}→${t.bpSys} mmHg`, flagged: true },
        { label: `HR spike ${prev.rhr}→${t.rhr} BPM`, flagged: true },
        { label: `Steps ${t.steps.toLocaleString()} (low activity)`, flagged: t.steps < 3000 },
      ];
    },
    action: 'Stand up slowly. Stay hydrated. Test with a simple stand-up check.',
    actionHow: `<strong>Right now:</strong> When rising from sitting or lying, pause at the edge for 10 seconds before standing fully. Drink 16oz of water — dehydration makes this significantly worse. <strong>To test:</strong> Sit for 5 minutes, stand up, note if you feel dizzy or see spots. If yes, mention it to your doctor — they can do a simple tilt-table test. <strong>Longer term:</strong> Compression socks and increased salt + water intake reduce episodes in most people.`,
    askSage: 'My blood pressure dropped suddenly and my heart rate spiked — what does that mean?',
    disclaimer: 'This pattern is a risk indicator, not a diagnosis of vasovagal syncope. Only a physician can diagnose.'
  },

  // ── PAROXYSMAL AFIB DETECTION ──────────────────────────
  {
    id: 'afib_paroxysmal',
    level: 'urgent',
    icon: '⚡',
    title: 'Paroxysmal AFib detection',
    category: 'Cardiovascular',
    detect(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      // Sudden erratic HRV spike (high variability) + elevated HR at rest
      const erraticHRV = t.hrv > prev.hrv * 1.5 && t.hrv > 80;
      const elevatedHR = t.rhr > 72;
      const recentDrop = prev.hrv < 55;
      return erraticHRV && elevatedHR && recentDrop;
    },
    watchingFor: 'Irregular R-R intervals — sudden erratic HRV spikes with elevated resting HR at rest',
    narrative(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      return `Your ring detected an unusual pattern last night — <strong>a sudden spike in HRV variability (${prev.hrv}ms → ${t.hrv}ms) paired with an elevated resting heart rate of ${t.rhr} BPM while at rest</strong>. This pattern — erratic beat-to-beat variation at an elevated rate — is consistent with intermittent atrial fibrillation. Paroxysmal AFib comes and goes, which is why most people don't know they have it. It significantly increases stroke risk. This needs a proper ECG reading today.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      const prev = data[data.length-2] || t;
      return [
        { label: `HRV jumped ${prev.hrv}→${t.hrv}ms (erratic)`, flagged: true, urgent: true },
        { label: `RHR ${t.rhr} BPM at rest`, flagged: t.rhr > 72, urgent: true },
        { label: `Prior HRV ${prev.hrv}ms (baseline)`, flagged: false },
      ];
    },
    action: 'Get a clinical ECG today — do not wait',
    actionHow: `<strong>Today:</strong> A KardiaMobile (AliveCor) personal ECG device costs $89 and gives you a medical-grade single-lead ECG in 30 seconds. Available on Amazon with next-day delivery. Alternatively, walk into any urgent care — they can do a 12-lead ECG on the spot, usually $50-100 without insurance. <strong>Do not ignore this signal.</strong> Paroxysmal AFib is intermittent — it may not show on your next reading, but documenting it is important. Untreated AFib is one of the leading causes of stroke.`,
    askSage: 'My ring detected an unusual heart rhythm pattern last night — how worried should I be?',
    disclaimer: 'Ring PPG sensors cannot definitively diagnose AFib. This is a screening signal requiring clinical ECG confirmation. If you feel palpitations, chest pain, or shortness of breath, call 911.'
  },

  // ── CARDIOVASCULAR RECOVERY DECLINE ───────────────────
  {
    id: 'cv_recovery_decline',
    level: 'info',
    icon: '📉',
    title: 'Cardiovascular recovery declining',
    category: 'Fitness & Recovery',
    detect(data) {
      if (data.length < 5) return false;
      // HRR proxy: resting HR trending up while readiness trending down over 14 days
      const earlyRHR = avg(data.slice(0,3), 'rhr');
      const recentRHR = avg(data.slice(-3), 'rhr');
      const earlyReady = avg(data.slice(0,3), 'readiness');
      const recentReady = avg(data.slice(-3), 'readiness');
      return (recentRHR - earlyRHR) >= 3 && (earlyReady - recentReady) >= 8;
    },
    watchingFor: 'Heart rate recovery trend — RHR rising + readiness falling over the past week',
    narrative(data) {
      const earlyRHR = avg(data.slice(0,3), 'rhr');
      const recentRHR = avg(data.slice(-3), 'rhr');
      const earlyReady = avg(data.slice(0,3), 'readiness');
      const recentReady = avg(data.slice(-3), 'readiness');
      return `Over the past week your resting heart rate has <strong>climbed from ${earlyRHR} to ${recentRHR} BPM</strong> while your readiness score has <strong>dropped from ${earlyReady} to ${recentReady}</strong>. This trajectory — heart working harder, body recovering less — is the signature of declining cardiovascular fitness. It could be overtraining, cumulative fatigue, illness onset, or deconditioning. The direction matters more than any single number.`;
    },
    drivers(data) {
      return [
        { label: `RHR ${avg(data.slice(0,3),'rhr')}→${avg(data.slice(-3),'rhr')} BPM`, flagged: true },
        { label: `Readiness ${avg(data.slice(0,3),'readiness')}→${avg(data.slice(-3),'readiness')}`, flagged: true },
        { label: `HRV ${avg(data.slice(0,3),'hrv')}→${avg(data.slice(-3),'hrv')}ms`, flagged: avg(data.slice(-3),'hrv') < avg(data.slice(0,3),'hrv') },
      ];
    },
    action: 'Two recovery days, then reintroduce zone 2 cardio',
    actionHow: `<strong>Days 1-2:</strong> Complete rest — walk only, no structured exercise. Prioritize 8h sleep. <strong>Day 3 onwards:</strong> Reintroduce exercise at 60% of normal intensity. Zone 2 cardio (conversational pace) specifically improves heart rate recovery faster than high-intensity work. <strong>Track weekly:</strong> If RHR doesn't begin declining within 10 days of recovery, see your doctor — a thyroid panel and basic cardiac workup are appropriate.`,
    askSage: 'My heart rate has been rising and my recovery has been declining — what is happening?',
    disclaimer: 'Cardiovascular recovery metrics are estimates based on resting HR and readiness proxies, not clinical heart rate recovery testing.'
  },

  // ── HORMONAL / OVULATION SHIFT ─────────────────────────
  {
    id: 'hormonal_ovulation',
    level: 'info',
    icon: '🌸',
    title: 'Hormonal / ovulation shift',
    category: 'Metabolic Health',
    detect(data, profile) {
      if (profile.sex !== 'Female') return false;
      if (data.length < 5) return false;
      // Biphasic temperature shift: dip then sustained rise
      const temps = data.map(d => d.tempC);
      const mid = Math.floor(temps.length / 2);
      const firstHalf = temps.slice(0, mid);
      const secondHalf = temps.slice(mid);
      const avgFirst = firstHalf.reduce((s,t)=>s+t,0)/firstHalf.length;
      const avgSecond = secondHalf.reduce((s,t)=>s+t,0)/secondHalf.length;
      const shift = avgSecond - avgFirst;
      return shift >= 0.25; // ~0.5°F sustained rise
    },
    watchingFor: 'Biphasic overnight temperature pattern — dip then sustained rise indicating luteal phase',
    narrative(data, profile) {
      const temps = data.map(d => d.tempF);
      const avgTemp = avgF(data, 'tempF');
      return `Your overnight body temperature has shown a <strong>sustained upward shift this week</strong> — averaging ${avgTemp}°F — consistent with the luteal phase following ovulation. The TK30's overnight temperature sensor can detect the biphasic shift that indicates hormonal changes across your cycle. Irregularities in this pattern — especially an absent temperature rise — can indicate anovulatory cycles worth discussing with your OB/GYN.`;
    },
    drivers(data) {
      return [
        { label: `Avg temp ${avgF(data,'tempF')}°F (elevated)`, flagged: true },
        { label: `Temp trend rising`, flagged: true },
        { label: `Consistent overnight pattern`, flagged: false },
      ];
    },
    action: 'Log this pattern — bring it to your next OB/GYN visit',
    actionHow: `This temperature pattern is consistent with normal luteal phase. <strong>To track your cycle:</strong> The ring's temperature data is the same method used by fertility apps like Natural Cycles (FDA-cleared). Log this week's readings in a cycle tracking app to build your personal baseline. <strong>When to mention to your doctor:</strong> If the temperature rise is absent for 2+ consecutive cycles, or if the pattern is highly irregular, mention it — it can indicate hormonal imbalance or anovulation.`,
    askSage: 'My overnight temperature has been elevated this week in a pattern — what does that mean for my cycle?',
    disclaimer: 'Temperature-based cycle tracking is an informational tool, not a contraceptive method or diagnostic. Consult your physician for reproductive health concerns.'
  },

  // ── CIRCADIAN PHASE DELAY ──────────────────────────────
  {
    id: 'circadian_phase_delay',
    level: 'watch',
    icon: '🕐',
    title: 'Circadian phase delay',
    category: 'Sleep Health',
    detect(data) {
      // Proxy: high RHR that doesn't drop until late + poor deep sleep early night
      const t = data[data.length-1];
      const avgRHR = avg(data, 'rhr');
      const highNightHR = t.rhr > avgRHR + 4;
      const lowDeep = t.deep < 0.8;
      const lateSleep = avgF(data,'sleep') < 6.5;
      return highNightHR && lowDeep && lateSleep;
    },
    watchingFor: 'Sleep onset latency — elevated HR late into sleep cycle + poor early-night deep sleep',
    narrative(data) {
      const t = data[data.length-1];
      return `Your ring detected signs of <strong>delayed sleep phase</strong> — your resting heart rate stayed elevated at ${t.rhr} BPM late into the night instead of dropping early, and your deep sleep of ${t.deep}h was concentrated later than optimal. This is your internal clock running behind your actual bedtime. It is common in night owls, people with late screen exposure, or those whose schedule has recently shifted. Left uncorrected it compounds into chronic sleep debt.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      return [
        { label: `RHR ${t.rhr} BPM late in sleep`, flagged: true },
        { label: `Deep sleep ${t.deep}h (late-shifted)`, flagged: t.deep < 0.8 },
        { label: `Sleep avg ${avgF(data,'sleep')}h`, flagged: avgF(data,'sleep') < 6.5 },
      ];
    },
    action: 'Light exposure reset — 10 minutes of bright light within 30 minutes of waking',
    actionHow: `<strong>This morning:</strong> Go outside for 10 minutes within 30 minutes of waking. Morning bright light is the strongest signal your circadian clock responds to — it shifts your sleep phase earlier within 2-3 days. <strong>Tonight:</strong> No screens 60 minutes before bed, or use blue-light blocking glasses. Dim your lights after 9pm. <strong>Consistency:</strong> Same wake time every day — even weekends — is the most powerful circadian anchor. Your ring will show the shift in your HRV and deep sleep timing within a week.`,
    askSage: 'My sleep pattern seems to be shifted late — what can I do to reset my circadian rhythm?',
    disclaimer: 'Circadian phase assessment from ring data is an estimate. Formal diagnosis of circadian rhythm disorders requires clinical evaluation.'
  },

  // ── UPPER AIRWAY RESISTANCE ────────────────────────────
  {
    id: 'upper_airway_resistance',
    level: 'watch',
    icon: '🫁',
    title: 'Upper airway resistance',
    category: 'Sleep Health',
    detect(data) {
      const t = data[data.length-1];
      // SpO2 near-dips (not full apnea) + elevated apnea events + poor REM
      const spo2Watch = t.spo2 < 96 && t.spo2 >= 93;
      const apneaWatch = t.apnea >= 1 && t.apnea <= 3;
      const remLow = t.rem < 1.3;
      return spo2Watch && apneaWatch && remLow;
    },
    watchingFor: 'Minor SpO₂ dips + micro-arousals during REM — precursor pattern to full sleep apnea',
    narrative(data) {
      const t = data[data.length-1];
      return `Your ring picked up a subtle but significant pattern — <strong>SpO₂ dipping to ${t.spo2}% with ${t.apnea} airway events</strong> that don't quite reach full apnea threshold, paired with fragmented REM sleep of only ${t.rem}h. This is upper airway resistance syndrome — your airway is narrowing during sleep without fully collapsing. It's the precursor to obstructive sleep apnea, and the stage where intervention is most effective. Most people at this stage are dismissively told they don't have apnea — but their sleep quality and daytime energy tell a different story.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      return [
        { label: `SpO₂ ${t.spo2}% (near-dipping)`, flagged: t.spo2 < 96 },
        { label: `${t.apnea} airway events`, flagged: t.apnea >= 1 },
        { label: `REM ${t.rem}h (fragmented)`, flagged: t.rem < 1.3 },
      ];
    },
    action: 'Side sleeping + nasal strips tonight — home sleep study this week',
    actionHow: `<strong>Tonight:</strong> Sleep on your side — it reduces airway resistance by 30-40% in most people. Try a nasal dilator strip (Breathe Right, $10 at any pharmacy). <strong>This week:</strong> Order a home sleep study — WatchPAT ONE or Lofta mail you a device. Upper airway resistance syndrome is frequently missed by standard sleep studies. Request that the physician specifically evaluate for UARS, not just apnea-hypopnea index (AHI). <strong>Do not use alcohol or sedatives</strong> — they relax airway muscles significantly.`,
    askSage: 'My ring is showing minor breathing disruptions during sleep — what is upper airway resistance and should I be concerned?',
    disclaimer: 'Ring-based detection cannot diagnose UARS. A formal sleep study is required. This is a screening signal only.'
  },

  // ── AUTONOMIC BURNOUT PATTERN ──────────────────────────
  {
    id: 'autonomic_burnout',
    level: 'watch',
    icon: '🔋',
    title: 'Autonomic burnout pattern',
    category: 'Mental Health & Recovery',
    detect(data, profile) {
      if (data.length < 5) return false;
      const age = profile.age || 48;
      const hrvNorm = 65 - age * 0.5;
      // Progressive multi-day HRV decline + RHR creeping up + low activity
      const hrvTrend = data.map(d => d.hrv);
      const declining = hrvTrend.every((v,i) => i===0 || v <= hrvTrend[i-1] + 3);
      const avgRHR = avg(data,'rhr');
      const avgSteps = avg(data,'steps');
      const avgHRV = avg(data,'hrv');
      return declining && avgRHR > 70 && avgHRV < hrvNorm - 10 && avgSteps < 6000;
    },
    watchingFor: 'Progressive daily HRV decline + rising RHR + low activity — sympathetic overactivation pattern',
    narrative(data, profile) {
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      const avgHRV = avg(data, 'hrv');
      const avgRHR = avg(data, 'rhr');
      return `Your ring has tracked a <strong>progressive decline in HRV every day this week</strong> — now at ${avgHRV}ms against your age-expected norm of ~${hrvNorm}ms — while your resting heart rate has climbed to ${avgRHR} BPM. Even on low-activity days your nervous system is not recovering. This is autonomic burnout — your sympathetic nervous system (fight-or-flight) is chronically overactivated and your parasympathetic (rest-and-recover) is losing ground. The body keeps going but the tank is emptying.`;
    },
    drivers(data, profile) {
      const age = profile.age || 48;
      const hrvNorm = Math.round(65 - age * 0.5);
      return [
        { label: `HRV ${avg(data,'hrv')}ms declining daily`, flagged: true, urgent: false },
        { label: `RHR ${avg(data,'rhr')} BPM creeping up`, flagged: avg(data,'rhr') > 70 },
        { label: `Steps ${avg(data,'steps').toLocaleString()}/day (low)`, flagged: avg(data,'steps') < 6000 },
        { label: `Age norm HRV ~${hrvNorm}ms`, flagged: false },
      ];
    },
    action: 'Full rest protocol — 72 hours minimum before reassessing',
    actionHow: `<strong>The next 3 days:</strong> No structured exercise. No alcohol. 8+ hours sleep with consistent bedtime. Cold exposure (cold shower, cold water on face) activates the parasympathetic system — try 30 seconds of cold water on your face and neck morning and evening. <strong>Breathwork:</strong> 4-7-8 breathing (inhale 4, hold 7, exhale 8) for 5 minutes before bed directly activates the vagus nerve and raises HRV measurably within 20 minutes. <strong>If this persists beyond 2 weeks</strong> with no improvement, consider talking to your doctor about burnout evaluation — cortisol testing is a reasonable next step.`,
    askSage: 'My HRV has been declining every single day this week. What is happening to my nervous system?',
    disclaimer: 'Autonomic burnout is a clinical concept. This signal is observational. Diagnosis requires clinical evaluation.'
  },

  // ── SUBSTANCE CLEARANCE STRAIN ─────────────────────────
  {
    id: 'substance_clearance',
    level: 'info',
    icon: '🍷',
    title: 'Substance clearance strain',
    category: 'Mental Health & Recovery',
    detect(data) {
      const t = data[data.length-1];
      // Elevated temp + flat high HR all night + near-zero deep and REM
      const tempSpike = t.tempDev > 0.45;
      const flatHighHR = t.rhr > 72;
      const noDeep = t.deep < 0.6;
      const noREM = t.rem < 0.7;
      return tempSpike && flatHighHR && noDeep && noREM;
    },
    watchingFor: 'Temperature spike + flat elevated HR all night + near-total deep/REM suppression',
    narrative(data) {
      const t = data[data.length-1];
      const devF = ((t.tempDev||0) * 9/5).toFixed(1);
      return `Last night your ring recorded a pattern consistent with <strong>alcohol or substance metabolism strain</strong> — body temperature +${devF}°F above baseline, heart rate ${t.rhr} BPM staying flat all night instead of dropping, and deep sleep of only ${t.deep}h with REM of ${t.rem}h. Alcohol is the most common cause. Even moderate consumption (2-3 drinks) produces this signature. Your liver metabolizing alcohol raises core temperature, keeps your heart rate elevated, and almost completely eliminates deep and REM sleep — regardless of how fast you fell asleep.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      const devF = ((t.tempDev||0) * 9/5).toFixed(1);
      return [
        { label: `Temp +${devF}°F above baseline`, flagged: true },
        { label: `HR ${t.rhr} BPM flat all night`, flagged: t.rhr > 72 },
        { label: `Deep sleep ${t.deep}h`, flagged: t.deep < 0.6, urgent: true },
        { label: `REM ${t.rem}h`, flagged: t.rem < 0.7, urgent: true },
      ];
    },
    action: 'Hydrate aggressively today — give your body 48 hours',
    actionHow: `<strong>Today:</strong> 2-3 liters of water with electrolytes (Liquid IV, LMNT, or just water + a pinch of salt). Avoid caffeine for 6 hours — it compounds the cardiac strain. A light walk helps clear acetaldehyde (the toxic byproduct of alcohol metabolism). <strong>The data:</strong> Your ring just showed you exactly what one night of drinking costs you in sleep quality. That's information most people never get. Over time, this data tends to be more persuasive than any health advice.`,
    askSage: 'My ring showed a terrible sleep pattern last night with high temperature and no deep sleep — what happened?',
    disclaimer: 'This is an observational pattern, not a diagnosis. Many factors can cause this signature. This information is non-judgmental and educational only.'
  },

  // ── CIRCADIAN DISRUPTION ALERT ─────────────────────────
  {
    id: 'circadian_disruption',
    level: 'info',
    icon: '✈️',
    title: 'Circadian disruption alert',
    category: 'Sleep Health',
    detect(data) {
      if (data.length < 4) return false;
      // RHR nadir and temp nadir shifting — proxy for jet lag / shift work
      const earlyTemp = avgF(data.slice(0,3), 'tempC');
      const recentTemp = avgF(data.slice(-3), 'tempC');
      const earlyRHR = avg(data.slice(0,3), 'rhr');
      const recentRHR = avg(data.slice(-3), 'rhr');
      // Both shifting in the same direction significantly
      const tempShift = Math.abs(recentTemp - earlyTemp) > 0.25;
      const rhrShift = Math.abs(recentRHR - earlyRHR) > 4;
      return tempShift && rhrShift;
    },
    watchingFor: 'Body temperature nadir and resting HR baseline shifting — jet lag or shift work pattern',
    narrative(data) {
      const earlyTemp = avgF(data.slice(0,3), 'tempF');
      const recentTemp = avgF(data.slice(-3), 'tempF');
      const earlyRHR = avg(data.slice(0,3), 'rhr');
      const recentRHR = avg(data.slice(-3), 'rhr');
      return `Your overnight temperature baseline has shifted from ${earlyTemp}°F to ${recentTemp}°F, and your resting heart rate pattern has moved from ${earlyRHR} to ${recentRHR} BPM — both indicators that your <strong>internal circadian clock has been disrupted</strong>. This is the biometric signature of jet lag, shift work, or a major schedule change. Your body's temperature and heart rate rhythms are anchored to your internal clock — when they shift, metabolic function, sleep architecture, and immune response all take a measurable hit.`;
    },
    drivers(data) {
      return [
        { label: `Temp baseline shifted ${avgF(data.slice(0,3),'tempF')}→${avgF(data.slice(-3),'tempF')}°F`, flagged: true },
        { label: `RHR shifted ${avg(data.slice(0,3),'rhr')}→${avg(data.slice(-3),'rhr')} BPM`, flagged: true },
        { label: `Pattern duration: ${data.length} days`, flagged: false },
      ];
    },
    action: 'Morning light + consistent anchor times — 3-day reset protocol',
    actionHow: `<strong>Day 1:</strong> Set your wake time for the timezone you want to be in and stick to it regardless of how you feel. 10 minutes of outdoor light within 30 minutes of waking. <strong>Melatonin:</strong> 0.5mg (low dose) 90 minutes before your target sleep time — this is more effective than the 5-10mg doses commonly sold. <strong>Avoid:</strong> Napping longer than 20 minutes, alcohol, and bright screens after 9pm. <strong>Your ring will confirm recovery</strong> — watch for your temperature nadir to stabilize and your RHR to return to baseline over 3-5 days.`,
    askSage: 'My body temperature and heart rate patterns have shifted this week — could this be jet lag or something else?',
    disclaimer: 'Circadian rhythm assessment from consumer rings is approximate. Travel history and schedule changes provide important context.'
  },

  // ── THERMAL / DEHYDRATION STRAIN ───────────────────────
  {
    id: 'thermal_dehydration',
    level: 'watch',
    icon: '🌡️',
    title: 'Thermal / dehydration strain',
    category: 'Fitness & Recovery',
    detect(data) {
      const t = data[data.length-1];
      // Elevated temp + slightly low BP + elevated RHR — without immune activation markers
      const tempElevated = t.tempDev > 0.28;
      const bpLow = t.bpSys < 115;
      const hrElevated = t.rhr > 68;
      const noImmune = t.tempDev < 0.6; // not high enough for immune activation
      return tempElevated && (bpLow || hrElevated) && noImmune;
    },
    watchingFor: 'Overnight temperature elevated without immune markers + BP trending low + HR elevated — heat/dehydration pattern',
    narrative(data) {
      const t = data[data.length-1];
      const devF = ((t.tempDev||0) * 9/5).toFixed(1);
      return `Your overnight data shows a pattern distinct from illness — <strong>temperature +${devF}°F above baseline, blood pressure at ${t.bpSys}/${t.bpDia} mmHg (trending low), and resting HR of ${t.rhr} BPM</strong>. Unlike immune activation, this combination without respiratory changes suggests thermal strain or dehydration. Your body is working harder to maintain core temperature while blood volume is reduced. This is common after intense exercise in heat, hot environments, or simply not drinking enough water yesterday.`;
    },
    drivers(data) {
      const t = data[data.length-1];
      const devF = ((t.tempDev||0) * 9/5).toFixed(1);
      return [
        { label: `Temp +${devF}°F (non-immune)`, flagged: true },
        { label: `BP ${t.bpSys}/${t.bpDia} mmHg (low-normal)`, flagged: t.bpSys < 115 },
        { label: `RHR ${t.rhr} BPM (elevated)`, flagged: t.rhr > 68 },
      ];
    },
    action: 'Hydrate with electrolytes now — cool environment today',
    actionHow: `<strong>Right now:</strong> 500ml of water with electrolytes before anything else — sodium and potassium are both depleted with dehydration and heat. Plain water alone can dilute electrolytes further. <strong>Today:</strong> Target 3 liters total fluid intake. Avoid alcohol and excessive caffeine. If you exercised hard yesterday in heat, your fluid deficit may be 1-2 liters. <strong>Cool down:</strong> A cool (not cold) shower lowers core temperature faster than cold water. Avoid intense exercise until your overnight temp returns to baseline. <strong>Warning sign:</strong> If you feel dizzy, have a headache, or your urine is dark yellow — drink immediately and rest.`,
    askSage: 'My ring shows elevated temperature and heart rate but not the illness pattern — could this be dehydration?',
    disclaimer: 'Dehydration and heat strain assessment from ring data is approximate. Severe symptoms require immediate medical attention.'
  },


];

/* ── HELPERS: avg and avgF defined in app.js ── */

/* ── MAIN RENDER FUNCTION ─────────────────────────── */
/* ── BUILD SIGNALS PANEL ─────────────────────────── */
function buildSignalsPanel(data, profile, goals) {
  const container = document.getElementById('signals-panel');
  if (!container) return;

  const testStates = JSON.parse(localStorage.getItem('sh_signal_toggles') || '{}');
  const acknowledged = JSON.parse(localStorage.getItem('sh_acknowledged_signals') || '{}');

  // Live detection — which signals actually fired
  const liveFired = new Set(SIGNAL_PATTERNS.filter(p => {
    try { return p.detect(data, profile, goals); } catch(e) { return false; }
  }).map(p => p.id));

  // What to render: live + any manually toggled on
  const toShow = SIGNAL_PATTERNS.filter(p => testStates[p.id] || liveFired.has(p.id));

  // Header badge
  const urgentCount = toShow.filter(s => s.level === 'urgent').length;
  const watchCount  = toShow.filter(s => s.level === 'watch').length;
  let badgeText = 'All clear', badgeClass = 'clear';
  if (urgentCount > 0) { badgeText = urgentCount + ' urgent'; badgeClass = ''; }
  else if (watchCount > 0) { badgeText = watchCount + ' to watch'; badgeClass = ''; }

  let html = `<div class="signals-header" style="margin-bottom:10px;">
    <div class="signals-title">
      <span>🔍</span> SageHealth signals
      <span class="signals-badge ${badgeClass}">${badgeText}</span>
    </div>
  </div>`;

  // Toggle rows — one per signal
  html += `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;margin-bottom:12px;overflow:hidden;box-shadow:var(--shadow);">`;
  SIGNAL_PATTERNS.forEach((sig, idx) => {
    const isLive = liveFired.has(sig.id);
    const isOn   = testStates[sig.id] || isLive;
    const levelCol = sig.level === 'urgent' ? 'var(--red)' : sig.level === 'watch' ? 'var(--amber)' : 'var(--cyan)';
    const border = idx > 0 ? 'border-top:1px solid var(--border);' : '';
    html += `<div style="${border}display:flex;align-items:center;gap:12px;padding:12px 16px;transition:background .1s;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
      <span style="font-size:16px;flex-shrink:0;">${sig.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);">${sig.title}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px;">${sig.category}
          ${isLive ? '<span style="margin-left:6px;font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:var(--green-bg);color:var(--green);border:1px solid rgba(14,159,110,.25);">LIVE</span>' : ''}
        </div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:7px;background:${sig.level==='urgent'?'var(--red-bg)':sig.level==='watch'?'var(--amber-bg)':'var(--cyan-bg)'};color:${levelCol};border:1px solid ${levelCol}22;">${sig.level}</span>
      <label style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;cursor:${isLive?'default':'pointer'};">
        <input type="checkbox" ${isOn?'checked':''} ${isLive?'disabled':''} onchange="toggleSignal('${sig.id}',this.checked)"
          style="opacity:0;width:0;height:0;position:absolute;">
        <span style="position:absolute;inset:0;border-radius:12px;background:${isOn?'#0e9f6e':'#94a3b8'};transition:background .25s;border:1px solid ${isOn?'#0d8a5f':'#7f8ea0'};"></span>
        <span style="position:absolute;top:3px;left:${isOn?'23px':'3px'};width:16px;height:16px;border-radius:50%;background:white;transition:left .25s;box-shadow:0 1px 4px rgba(0,0,0,.25);"></span>
      </label>
    </div>`;
  });
  html += `</div>`;

  // Show expanded cards for any that are ON
  if (toShow.length === 0) {
    html += `<div class="signals-all-clear"><span style="font-size:20px;">✅</span><div>No patterns flagged. Toggle a signal above to preview how it looks.</div></div>`;
  } else {
    const order = { urgent: 0, watch: 1, info: 2 };
    const sorted = [...toShow].sort((a,b) => order[a.level] - order[b.level]);
    sorted.forEach(sig => {
      const drivers  = sig.drivers(data, profile);
      const narrative = sig.narrative(data, profile);
      const isAck   = acknowledged[sig.id];
      html += `
      <div class="sig-card sig-${sig.level}" id="sigcard-${sig.id}">
        <div class="sig-head">
          <div>
            <div class="sig-title-row">
              <span class="sig-icon">${sig.icon}</span>
              <span class="sig-title">${sig.title}</span>
              <span class="sig-level ${sig.level}">${sig.level}</span>
            </div>
            <div class="sig-watching">👁 ${sig.watchingFor}</div>
          </div>
        </div>
        <div class="sig-body">${narrative}</div>
        <div class="sig-drivers">
          ${drivers.map(d=>`<span class="sig-driver ${d.urgent?'red':d.flagged?'flagged':''}">${d.label}</span>`).join('')}
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
          <button
            data-sig-id="${sig.id}"
            data-sig-title="${sig.title}"
            data-sig-question="${sig.askSage}"
            onclick="openVoiceConsultFromBtn(this)"
            style="display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:white;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(29,111,164,.25);">
            🎤 Talk to Dr. Sage
          </button>
          ${isAck ? '<span style="font-size:12px;color:var(--green);font-weight:600;display:flex;align-items:center;gap:4px;">✓ Commitment saved</span>' : ''}
        </div>
        <div class="sig-disclaimer">⚠ ${sig.disclaimer}</div>
      </div>`;
    });
  }

  container.innerHTML = html;

  // Update header badge
  const badge = document.getElementById('signal-status-badge');
  if (badge) {
    if (toShow.length > 0) {
      const u = toShow.filter(s => s.level === 'urgent').length;
      badge.textContent = u > 0 ? '🚨 ' + u + ' urgent — scroll down' : '⚠ ' + toShow.length + ' signals — scroll down';
      badge.style.display = 'inline-flex';
      badge.style.background = u > 0 ? 'var(--red-bg)' : 'var(--amber-bg)';
      badge.style.color = u > 0 ? 'var(--red)' : 'var(--amber)';
    } else {
      badge.style.display = 'none';
    }
  }

  // Save for encounter/report
  localStorage.setItem('sh_active_signals', JSON.stringify(toShow.map(s => ({
    id: s.id, level: s.level, title: s.title, category: s.category, action: s.action
  }))));
}

/* ── TOGGLE A SIGNAL ON/OFF ───────────────────────── */
function toggleSignal(id, on) {
  const states = JSON.parse(localStorage.getItem('sh_signal_toggles') || '{}');
  states[id] = on;
  localStorage.setItem('sh_signal_toggles', JSON.stringify(states));
  if (typeof data !== 'undefined') buildSignalsPanel(data, profile, goals);
}

/* ── SIGNAL ACTIONS ───────────────────────────────── */
function acknowledgeSignal(id) {
  if (typeof showToast === 'undefined') return setTimeout(() => acknowledgeSignal(id), 200);
  const ack = JSON.parse(localStorage.getItem('sh_acknowledged_signals') || '{}');
  ack[id] = new Date().toISOString();
  localStorage.setItem('sh_acknowledged_signals', JSON.stringify(ack));
  const btn = document.querySelector('#sigcard-' + id + ' .sig-btn-did');
  if (btn) { btn.textContent = '✓ On it'; btn.style.opacity = '.6'; }
  showToast('✓ Noted', 'We will track whether this changes your numbers.');
}

function openSignalChat(sigId, question) {
  openWeekly();
  setTimeout(() => {
    encTab('chat');
    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) { input.value = question; input.focus(); }
    }, 400);
  }, 200);
}

function expireOldDismissals() {
  // No-op — kept for compatibility
}
