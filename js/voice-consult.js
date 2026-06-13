/* ═══════════════════════════════════════════════════
   SAGEHEALTH — VOICE CONSULTATION ENGINE
   Patient speaks → Dr. Sage listens → plan is made
   ═══════════════════════════════════════════════════ */

let vcState = {
  signal: null,
  messages: [],
  recognition: null,
  isListening: false,
  isSpeaking: false,
  commitment: null,
  voice: null
};

/* ── OPEN VOICE CONSULTATION ─────────────────────── */
function openVoiceConsult(sigId, sigTitle, askQuestion, isIntro = false) {
  const modal = document.getElementById('voiceModal');
  if (!modal) return;

  // Reset state
  vcState.signal = { id: sigId, title: sigTitle };
  vcState.messages = [];
  vcState.commitment = null;
  vcState.currentAudio = null;
  vcState.isListening = false;
  vcState.isSpeaking = false;

  // Reset UI
  document.getElementById('vc-conversation').innerHTML = '';
  document.getElementById('vc-status').textContent = 'Connecting to Dr. Sage...';
  document.getElementById('vc-status').className = 'vc-status';
  document.getElementById('vc-transcript').textContent = '';
  document.getElementById('vc-commitment-box').style.display = 'none';
  document.getElementById('vc-btn-commit').style.display = 'none';
  document.getElementById('vc-signal-label').textContent = sigTitle;
  document.getElementById('vc-mic').className = 'vc-mic';
  document.getElementById('vc-mic').textContent = '🎤';

  modal.style.display = 'flex';

  // Load best voice
  pickVoice();

  // Start with Dr. Sage opening the conversation
  if (isIntro || sigId === '__intro__') {
    openingIntroMessage();
  } else {
    openingMessage(sigId, sigTitle, askQuestion);
  }
}

/* ── PICK BEST VOICE ─────────────────────────────── */
function pickVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  vcState.voice = voices.find(v => /samantha|karen|daniel|alex/i.test(v.name))
    || voices.find(v => v.lang === 'en-US' && v.localService)
    || voices.find(v => v.lang === 'en-US')
    || voices[0];

  // Retry if voices not loaded yet
  if (!vcState.voice && voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => pickVoice();
  }
}


/* ── FIRST-TIME INTRO CONVERSATION ─────────────────── */
async function openingIntroMessage() {
  const name = (typeof profile !== 'undefined' && profile.name) ? `, ${profile.name}` : '';

  setVcStatus('Dr. Sage is connecting...', '');
  setMicState('thinking');

  try {
    const res = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 100,
        system: `You are Dr. Sage, meeting a new SageHealth user for the first time. This is a voice conversation.
Be warm, human, and curious. Introduce yourself in ONE sentence. Then ask ONE open question about what brought them here.
No medical data yet — just a human introduction. Max 2 sentences total. Voice — keep it short and warm.`,
        messages: [{ role: 'user', content: 'Start the first conversation.' }]
      })
    });
    const d = await res.json();
    const opening = d.content?.[0]?.text?.trim() ||
      `Hi${name} — I am Dr. Sage, your health advisor. Before I start looking at your numbers, I want to know: what brought you to SageHealth?`;

    // Update modal signal label for intro
    const label = document.getElementById('vc-signal-label');
    if (label) label.textContent = 'Getting to know you';

    addVcMessage('sage', opening);
    vcState.messages.push({ role: 'assistant', content: opening });

    // Override system for intro mode
    vcState._introMode = true;

    await sageSpeak(opening);
  } catch(e) {
    const fallback = `Hi${name}. I am Dr. Sage. Before I dive into your health data, I want to understand what matters to you. What brought you to SageHealth?`;
    addVcMessage('sage', fallback);
    vcState.messages.push({ role: 'assistant', content: fallback });
    await sageSpeak(fallback);
  }
}

/* ── DR. SAGE OPENING MESSAGE ────────────────────── */
async function openingMessage(sigId, sigTitle, askQuestion) {
  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : '';
  const age  = (typeof profile !== 'undefined' && profile.age)  ? profile.age  : '';
  const t    = (typeof data    !== 'undefined') ? data[data.length - 1] : {};

  setVcStatus('Dr. Sage is thinking...', '');
  setMicState('thinking');

  // Build signal-specific context for the opening
  // Pull the actual signal object to get its narrative and drivers
  const sig = (typeof SIGNAL_PATTERNS !== 'undefined')
    ? SIGNAL_PATTERNS.find(s => s.id === sigId) : null;

  const sigNarrative = sig && typeof sig.narrative === 'function'
    ? sig.narrative(data || [], profile || {}).replace(/<[^>]*>/g, '').slice(0, 200)
    : '';

  const sigAction = sig ? sig.action : '';

  // Build metric context specific to this signal type
  const metricCtx = {
    metabolic_pattern:    `RHR ${t.rhr||'--'} BPM, HRV ${t.hrv||'--'}ms, BP ${t.bpSys||'--'}/${t.bpDia||'--'}, deep sleep ${t.deep||'--'}h, steps ${(t.steps||0).toLocaleString()}`,
    sleep_apnea_pattern:  `SpO2 ${t.spo2||'--'}%, REM ${t.rem||'--'}h, sleep ${t.sleep||'--'}h, apnea events ${t.apnea||0}`,
    bp_elevated:          `BP ${t.bpSys||'--'}/${t.bpDia||'--'} mmHg, trend over 7 days`,
    immune_activation:    `Temp +${((t.tempDev||0)*9/5).toFixed(1)}°F above baseline, HRV ${t.hrv||'--'}ms`,
    chronic_stress:       `HRV ${t.hrv||'--'}ms (7-day avg), RHR ${t.rhr||'--'} BPM, readiness ${t.readiness||'--'}`,
    cv_age_drift:         `RHR ${t.rhr||'--'} BPM, HRV ${t.hrv||'--'}ms, SpO2 ${t.spo2||'--'}%`,
    sleep_architecture:   `Deep sleep ${t.deep||'--'}h, REM ${t.rem||'--'}h, total ${t.sleep||'--'}h`,
    thyroid_pattern:      `Temp avg ${t.tempF||'--'}°F, RHR ${t.rhr||'--'} BPM, HRV ${t.hrv||'--'}ms`,
    vasovagal_syncope:    `BP ${t.bpSys||'--'}/${t.bpDia||'--'} mmHg, RHR ${t.rhr||'--'} BPM, steps ${(t.steps||0).toLocaleString()}`,
    afib_paroxysmal:      `HRV ${t.hrv||'--'}ms (erratic spike), RHR ${t.rhr||'--'} BPM at rest`,
    cv_recovery_decline:  `RHR trending up, readiness ${t.readiness||'--'}, HRV ${t.hrv||'--'}ms`,
    hormonal_ovulation:   `Overnight temp ${t.tempF||'--'}°F, trend pattern this week`,
    circadian_phase_delay:`RHR late in sleep cycle ${t.rhr||'--'} BPM, deep sleep ${t.deep||'--'}h`,
    upper_airway_resistance: `SpO2 ${t.spo2||'--'}%, apnea events ${t.apnea||0}, REM ${t.rem||'--'}h`,
    autonomic_burnout:    `HRV declining daily — now ${t.hrv||'--'}ms, RHR ${t.rhr||'--'} BPM`,
    substance_clearance:  `Temp +${((t.tempDev||0)*9/5).toFixed(1)}°F, RHR flat at ${t.rhr||'--'} BPM, deep ${t.deep||'--'}h, REM ${t.rem||'--'}h`,
    circadian_disruption: `Temp baseline shifted, RHR pattern shifted, sleep timing unstable`,
    thermal_dehydration:  `Temp +${((t.tempDev||0)*9/5).toFixed(1)}°F, BP ${t.bpSys||'--'}/${t.bpDia||'--'} mmHg, RHR ${t.rhr||'--'} BPM`,
  }[sigId] || `HRV ${t.hrv||'--'}ms, RHR ${t.rhr||'--'} BPM, sleep ${t.sleep||'--'}h`;

  // Generate a fresh, varied opening via Groq — never the same twice
  const systemPrompt = buildSystemPrompt(sigId, sigTitle);
  const userMsg = `[OPENING] Generate a SHORT opening for a voice health consultation about: "${sigTitle}".

Signal context: ${sigNarrative}
Relevant metrics: ${metricCtx}
What to do: ${sigAction}

Rules:
- MAX 2 sentences. Voice conversation — be brief and direct.
- NEVER mention heart rate or HRV unless this signal is specifically about those.
- Use the SPECIFIC metrics relevant to THIS signal (listed above).
- Vary the structure each time — sometimes lead with the finding, sometimes a question, sometimes context.
- End with ONE question about their life or how they've been feeling — not about the data.
- Sound like a physician who noticed something, not an AI reading a report.`;

  try {
    const res = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 80,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    const d = await res.json();
    const opening = d.content?.[0]?.text?.trim() || `Your ${sigTitle.toLowerCase()} data caught my attention. How have you been feeling lately?`;

    addVcMessage('sage', opening);
    vcState.messages.push({ role: 'assistant', content: opening });
    await sageSpeak(opening);

  } catch(e) {
    // Fallback if Groq fails
    const fallbacks = [
      `Your ${sigTitle.toLowerCase()} pattern this week is worth talking about. What's been going on in your life?`,
      `I noticed something in your data around ${sigTitle.toLowerCase()}. How have you been feeling?`,
      `One of your signals — ${sigTitle.toLowerCase()} — has my attention. Tell me what's been happening.`,
    ];
    const opening = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    addVcMessage('sage', opening);
    vcState.messages.push({ role: 'assistant', content: opening });
    await sageSpeak(opening);
  }
}

/* ── TOGGLE MIC ──────────────────────────────────── */
function toggleMic() {
  if (vcState.isSpeaking) {
    // Stop Dr. Sage speaking so user can respond
    if (vcState.currentAudio) {
      vcState.currentAudio.pause();
      vcState.currentAudio = null;
    }
    if (vcState.currentAudio) { vcState.currentAudio.pause(); vcState.currentAudio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
    vcState.isSpeaking = false;
    setMicState('idle');
    setVcStatus('Tap the mic to speak', '');
  }

  if (vcState.isListening) {
    stopListening();
  } else {
    startListening();
  }
}

/* ── UNLOCK AUDIO ON FIRST GESTURE (Safari iOS) ─── */
function unlockAudio() {
  // Play a silent buffer to unlock Safari's audio context
  // Must be called from a user gesture (tap)
  if (window._audioUnlocked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().then(() => { window._audioUnlocked = true; });
  } catch(e) {}
}

/* ── START LISTENING ─────────────────────────────── */
function startListening() {
  unlockAudio(); // Unlock audio context on first mic tap
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setVcStatus('Voice input not supported in this browser. Try Chrome or Safari.', '');
    return;
  }

  if (vcState.recognition) {
    try { vcState.recognition.abort(); } catch(e) {}
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';
  vcState.recognition = rec;

  rec.onstart = () => {
    vcState.isListening = true;
    setVcStatus('Listening... speak now', 'listening');
    setMicState('listening');
  };

  rec.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    document.getElementById('vc-transcript').textContent = final || interim;
    if (final) {
      vcState.recognition.stop();
      handleUserSpeech(final.trim());
    }
  };

  rec.onerror = (e) => {
    vcState.isListening = false;
    setMicState('idle');
    if (e.error === 'no-speech') {
      setVcStatus('No speech detected — tap mic to try again', '');
    } else if (e.error === 'not-allowed') {
      setVcStatus('Microphone access denied — check browser permissions', '');
    } else {
      setVcStatus('Tap mic to speak', '');
    }
  };

  rec.onend = () => {
    vcState.isListening = false;
    if (!vcState.isSpeaking) setMicState('idle');
  };

  rec.start();
}

/* ── STOP LISTENING ──────────────────────────────── */
function stopListening() {
  if (vcState.recognition) {
    try { vcState.recognition.stop(); } catch(e) {}
  }
  vcState.isListening = false;
  setMicState('idle');
  setVcStatus('Tap the mic to speak', '');
}

/* ── HANDLE USER SPEECH ──────────────────────────── */
async function handleUserSpeech(text) {
  if (!text) return;
  document.getElementById('vc-transcript').textContent = '';
  addVcMessage('user', text);
  vcState.messages.push({ role: 'user', content: text });

  setVcStatus('Dr. Sage is thinking...', '');
  setMicState('thinking');

  try {
    const systemPrompt = buildSystemPrompt(vcState.signal.id, vcState.signal.title);
    const res = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 350,
        system: systemPrompt,
        messages: vcState.messages
      })
    });

    const d = await res.json();
    const reply = d.content?.[0]?.text || 'I had trouble connecting. Tap the mic and try again.';

    addVcMessage('sage', reply);
    vcState.messages.push({ role: 'assistant', content: reply });

    // Check if this message contains a plan/commitment
    const hasCommitment = detectCommitment(reply);
    if (hasCommitment) {
      vcState.commitment = hasCommitment;
      showCommitmentBox(hasCommitment);
    }

    await sageSpeak(reply);

  } catch(e) {
    const err = 'I had trouble connecting just now. Tap the mic and try again.';
    addVcMessage('sage', err);
    await sageSpeak(err);
  }
}


/* ── INTRO MODE SYSTEM PROMPT ───────────────────────── */
function buildIntroSystemPrompt() {
  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : '';
  return `You are Dr. Sage meeting ${name || 'a new user'} for the first time. Voice conversation.

YOUR GOAL: Learn 3-5 things about this person that will shape every future conversation.
Ask about:
- What brought them here (specific health concern? general wellness? curiosity?)
- Their lifestyle (work situation, stress, sleep habits, exercise)
- What they've already tried
- What matters most to them health-wise
- Any concerns they haven't mentioned to their doctor

RULES:
- ONE question at a time. Never multiple.
- Short responses — 1-2 sentences. This is voice.
- Warm and genuinely curious — not clinical.
- After 4-5 exchanges, summarize what you've learned and tell them what you'll be watching for.
- End with: "I'll be here every morning with what I've noticed. Let's get started."
- NEVER discuss specific biometric values yet — this is about them as a person first.`;
}

/* ── BUILD SYSTEM PROMPT — uses state map ─────────── */
function buildSystemPrompt(sigId, sigTitle) {
  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : 'Frank';

  // Use clean state map instead of raw data
  const stateMap = (typeof loadStateMap === 'function') ? loadStateMap() : null;
  const stateContext = (stateMap && typeof formatStateMapForPrompt === 'function')
    ? formatStateMapForPrompt(stateMap, sigId)
    : `Signal: ${sigTitle} | Limited data available`;

  // Inject persistent memory
  const memoryContext = (typeof SageMemory !== 'undefined') ? SageMemory.buildContext() : '';

  return `You are Dr. Sage, an AI health coach for SageHealth. VOICE conversation with ${name}.

${memoryContext}

STRUCTURED HEALTH STATE (TK30 ring, 7-day analysis):
${stateContext}

YOUR ROLE:
- Health COACH not physician. Never diagnose or prescribe.
- SHORT responses — 2-3 sentences MAX. Voice, not text.
- ONE question at a time. Never multiple.
- Warm, direct, non-judgmental.

CONTEXT FIRST — ALWAYS:
- Before interpreting any finding, ask what the person thinks caused it.
- A temperature spike could be illness, a hot flash, a warm room, alcohol, or stress.
- A BP elevation could be coffee, a tough morning, or a real trend.
- NEVER assume the clinical explanation. Ask first. Then interpret based on what they say.
- Example: "Your temperature was elevated last night. Do you have a sense of what might have caused it?"
- Then when they say "hot flash" — pivot: "That makes sense. How long have you been experiencing them? Are they disrupting your sleep?"

INTERPRET IN REAL TIME:
- Update your interpretation as the conversation unfolds.
- If they give a benign explanation, acknowledge it and pivot to what IS worth watching.
- If the explanation doesn't fully account for the pattern, gently note the discrepancy.
- The data is context. What they tell you is clinical information.

DRIVE TO COMMITMENT (after 3-5 exchanges):
- Move toward a specific realistic plan based on what they told you — not the raw data.
- State clearly: "So here is what we are committing to: [specific plan]."
- Include: what, how often, when, what metric we watch.
- End: "Does that feel like something you can actually do this week?"

VOICE RULES:
- No markdown or bullet points — pure spoken sentences.
- Never say "As an AI" mid-conversation.
- If multiple signals active, acknowledge the pattern not just one number.`;
}


/* ── DETECT COMMITMENT IN REPLY ──────────────────── */
function detectCommitment(text) {
  const commitPatterns = [
    /here(?:'s| is) what we(?:'re| are) committing to[:\s]+(.+?)(?:\.|$)/i,
    /so(?:,)? here(?:'s| is) (?:the |your )?plan[:\s]+(.+?)(?:\.|$)/i,
    /let(?:'s| us) commit to[:\s]+(.+?)(?:\.|$)/i,
    /your commitment[:\s]+(.+?)(?:\.|$)/i,
  ];

  for (const pattern of commitPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }

  // Fallback: if response contains "committing" or "commit" extract surrounding sentence
  if (/commit/i.test(text)) {
    const sentences = text.split(/[.!?]/);
    const commitSentence = sentences.find(s => /commit/i.test(s));
    if (commitSentence) return commitSentence.trim();
  }

  return null;
}

/* ── SHOW COMMITMENT BOX ─────────────────────────── */
function showCommitmentBox(commitmentText) {
  const box = document.getElementById('vc-commitment-box');
  const textEl = document.getElementById('vc-commitment-text');
  const btn = document.getElementById('vc-btn-commit');
  if (box && textEl) {
    textEl.textContent = commitmentText;
    box.style.display = 'block';
    btn.style.display = 'block';
  }
}

/* ── DR. SAGE SPEAKS — ElevenLabs with Web Speech fallback ── */
function sageSpeak(text) {
  return new Promise((resolve) => {
    vcState.isSpeaking = true;
    setMicState('speaking');
    setVcStatus('Dr. Sage is speaking — tap mic to interrupt', 'speaking');

    // Clean text for speech
    const clean = text
      .replace(/[*_`#]/g, '')
      .replace(/Note:.+$/i, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    // Try ElevenLabs first
    elevenLabsSpeak(clean)
      .then(resolve)
      .catch(() => {
        // Fallback to Web Speech API
        webSpeechSpeak(clean).then(resolve);
      });
  });
}

/* ── AZURE TTS ──────────────────────────────────── */
async function elevenLabsSpeak(text) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch('/.netlify/functions/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!res.ok) { reject(new Error('TTS ' + res.status)); return; }

      // Response is now audio/mpeg directly — get as blob
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      vcState.currentAudio = audio;

      setVcStatus('Dr. Sage is speaking — Jenny Neural · Azure · tap to interrupt', 'speaking');

      audio.onended = () => {
        URL.revokeObjectURL(url);
        vcState.currentAudio = null;
        vcState.isSpeaking = false;
        setMicState('idle');
        setVcStatus('Tap the mic to respond', '');
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        vcState.currentAudio = null;
        reject(new Error('Audio error'));
      };
      audio.src = url;
      const p = audio.play();
      if (p) p.catch(reject);

    } catch(e) {
      reject(e);
    }
  });
}

/* ── WEB SPEECH FALLBACK ─────────────────────────── */
function webSpeechSpeak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      vcState.isSpeaking = false;
      setMicState('idle');
      setVcStatus('Tap the mic to respond', '');
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.88; u.pitch = 1;
    if (vcState.voice) u.voice = vcState.voice;
    u.onend = u.onerror = () => {
      vcState.isSpeaking = false;
      setMicState('idle');
      setVcStatus('Tap the mic to respond', '');
      resolve();
    };
    window.speechSynthesis.speak(u);
  });
}

/* ── SAVE COMMITMENT ─────────────────────────────── */
function saveCommitment() {
  if (!vcState.commitment) return;

  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : 'Frank';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Build commitment record
  const record = {
    id: Date.now(),
    sigId: vcState.signal.id,
    sigTitle: vcState.signal.title,
    commitment: vcState.commitment,
    date: dateStr,
    dateMs: now.getTime(),
    baselineMetrics: {
      hrv: (typeof data !== 'undefined') ? avg(data, 'hrv') : null,
      rhr: (typeof data !== 'undefined') ? avg(data, 'rhr') : null,
      bpSys: (typeof data !== 'undefined') ? avg(data, 'bpSys') : null,
      sleep: (typeof data !== 'undefined') ? avgF(data, 'sleep') : null,
      steps: (typeof data !== 'undefined') ? avg(data, 'steps') : null,
    },
    transcript: vcState.messages,
    status: 'active',
    checkIns: []
  };

  // Save via SageSync (handles both localStorage and Supabase)
  if (typeof SageSync !== 'undefined') {
    SageSync.saveCommitment(record, null);
  } else {
    const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
    commitments.unshift(record);
    localStorage.setItem('sh_commitments', JSON.stringify(commitments));
  }

  // Store baseline for later retrieval
  vcState._baselineMetrics = record.baselineMetrics;

  // Also save as action item
  const actions = JSON.parse(localStorage.getItem('sh_actions') || '[]');
  actions.unshift({
    id: Date.now() + 1,
    title: vcState.commitment,
    desc: `Committed during voice consultation with Dr. Sage on ${dateStr}. Signal: ${vcState.signal.title}.`,
    tag: getTagForSignal(vcState.signal.id),
    done: false,
    autoCheck: false,
    evidence: null,
    dateAssigned: dateStr,
    commitmentId: record.id
  });
  localStorage.setItem('sh_actions', JSON.stringify(actions));

  // Update UI
  document.getElementById('vc-btn-commit').textContent = '✓ Commitment saved';
  document.getElementById('vc-btn-commit').style.background = 'var(--blue)';
  document.getElementById('vc-btn-commit').disabled = true;

  if (typeof showToast !== 'undefined') {
    showToast('✓ Commitment saved', 'Dr. Sage will check in on your progress next week.');
  }

  if (typeof populateHistory !== 'undefined') {
    populateHistory();
  }

  setTimeout(() => closeVoiceConsult(), 2000);
}

/* ── HELPERS ─────────────────────────────────────── */
function getTagForSignal(sigId) {
  const tags = {
    metabolic_pattern: 'bp',
    sleep_apnea_pattern: 'airway',
    bp_elevated: 'bp',
    immune_activation: 'temp',
    chronic_stress: 'heart',
    overtraining: 'activity',
    thyroid_pattern: 'heart',
    sleep_architecture: 'sleep',
    cv_age_drift: 'heart'
  };
  return tags[sigId] || 'general';
}

function addVcMessage(who, text) {
  const area = document.getElementById('vc-conversation');
  if (!area) return;

  // Remove typing indicator if present
  const typing = document.getElementById('vc-typing');
  if (typing) typing.remove();

  const d = document.createElement('div');
  d.className = 'vc-msg' + (who === 'user' ? ' user' : '');

  const initials = (typeof profile !== 'undefined' && profile.name) ? profile.name[0].toUpperCase() : 'F';
  d.innerHTML = `
    <div class="vc-av ${who === 'sage' ? 'sage' : ''}">${who === 'sage' ? '🧠' : initials}</div>
    <div class="vc-bubble">${text}</div>`;

  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

function showTypingIndicator() {
  const area = document.getElementById('vc-conversation');
  if (!area) return;
  const d = document.createElement('div');
  d.className = 'vc-msg';
  d.id = 'vc-typing';
  d.innerHTML = `<div class="vc-av sage">🧠</div><div class="vc-bubble"><div class="vc-typing"><div class="vc-td"></div><div class="vc-td"></div><div class="vc-td"></div></div></div>`;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

function setVcStatus(text, cls) {
  const el = document.getElementById('vc-status');
  if (el) { el.textContent = text; el.className = 'vc-status' + (cls ? ' ' + cls : ''); }
}

function setMicState(state) {
  const mic = document.getElementById('vc-mic');
  if (!mic) return;
  const states = {
    idle:      { cls: 'vc-mic',           icon: '🎤' },
    listening: { cls: 'vc-mic listening', icon: '🔴' },
    speaking:  { cls: 'vc-mic speaking',  icon: '🔊' },
    thinking:  { cls: 'vc-mic thinking',  icon: '⏳' }
  };
  const s = states[state] || states.idle;
  mic.className = s.cls;
  mic.textContent = s.icon;
}

/* ── CLOSE ───────────────────────────────────────── */
function closeVoiceConsult() {
  // Save conversation and extract memories if meaningful
  if (vcState.messages && vcState.messages.length >= 3) {
    const sig = vcState.signal || {};

    // Extract memories from this conversation in background
    if (typeof SageMemory !== 'undefined') {
      SageMemory.extractFromConversation(vcState.messages);
    }

    // Save full conversation to Supabase
    if (typeof SageSync !== 'undefined') {
      SageSync.saveConversation(
        sig.id, sig.title,
        vcState.messages,
        vcState.commitment,
        vcState._baselineMetrics || null
      );
    }
  }

  // Stop everything
  if (vcState.recognition) {
    try { vcState.recognition.abort(); } catch(e) {}
  }
  if (vcState.currentAudio) { vcState.currentAudio.pause(); vcState.currentAudio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  vcState.isListening = false;
  vcState.isSpeaking = false;

  document.getElementById('voiceModal').style.display = 'none';
}

/* ── BUTTON HELPER — reads data attributes safely ── */
function openVoiceConsultFromBtn(btn) {
  const id    = btn.getAttribute('data-sig-id');
  const title = btn.getAttribute('data-sig-title');
  const q     = btn.getAttribute('data-sig-question');
  openVoiceConsult(id, title, q);
}
