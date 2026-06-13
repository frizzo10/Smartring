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
function openVoiceConsult(sigId, sigTitle, askQuestion) {
  const modal = document.getElementById('voiceModal');
  if (!modal) return;

  // Reset state
  vcState.signal = { id: sigId, title: sigTitle };
  vcState.messages = [];
  vcState.commitment = null;
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
  setTimeout(() => openingMessage(sigId, sigTitle, askQuestion), 400);
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

/* ── DR. SAGE OPENING MESSAGE ────────────────────── */
async function openingMessage(sigId, sigTitle, askQuestion) {
  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : 'Frank';
  const t = (typeof data !== 'undefined') ? data[data.length - 1] : {};

  const systemPrompt = buildSystemPrompt(sigId, sigTitle);
  const opening = `Hi ${name}. I've been watching your health data and wanted to talk with you about something I noticed — ${sigTitle.toLowerCase()}. ${askQuestion} I want to understand what's actually going on in your life before we talk about any kind of plan. Can you tell me a bit about how you've been feeling lately?`;

  addVcMessage('sage', opening);
  vcState.messages.push({ role: 'assistant', content: opening });
  await sageSpeak(opening);
}

/* ── TOGGLE MIC ──────────────────────────────────── */
function toggleMic() {
  if (vcState.isSpeaking) {
    // Stop Dr. Sage speaking so user can respond
    window.speechSynthesis.cancel();
    vcState.isSpeaking = false;
  }

  if (vcState.isListening) {
    stopListening();
  } else {
    startListening();
  }
}

/* ── START LISTENING ─────────────────────────────── */
function startListening() {
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
        model: 'claude-sonnet-4-6',
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

/* ── BUILD SYSTEM PROMPT ─────────────────────────── */
function buildSystemPrompt(sigId, sigTitle) {
  const name = (typeof profile !== 'undefined' && profile.name) ? profile.name : 'Frank';
  const age = (typeof profile !== 'undefined' && profile.age) ? profile.age : 48;
  const conditions = (typeof profile !== 'undefined' && profile.conditions) ? profile.conditions : 'None';
  const t = (typeof data !== 'undefined') ? data[data.length - 1] : {};
  const avgHrv = (typeof data !== 'undefined') ? avg(data, 'hrv') : '--';
  const avgRhr = (typeof data !== 'undefined') ? avg(data, 'rhr') : '--';
  const avgBp = (typeof data !== 'undefined') ? `${avg(data,'bpSys')}/${avg(data,'bpDia')}` : '--';
  const avgSleep = (typeof data !== 'undefined') ? avgF(data, 'sleep') : '--';
  const avgSteps = (typeof data !== 'undefined') ? avg(data, 'steps').toLocaleString() : '--';

  return `You are Dr. Sage, an AI health coach for SageHealth. You are having a VOICE conversation with ${name}, age ${age}. Known conditions: ${conditions}.

This conversation is about a health signal SageHealth detected: "${sigTitle}".

Current biometrics (Wosheng TK30 ring, 7-day averages):
HRV: ${avgHrv}ms | RHR: ${avgRhr} BPM | BP: ${avgBp} mmHg | Sleep: ${avgSleep}h | Steps: ${avgSteps}/day

YOUR ROLE:
- You are a health COACH, not a physician. You never diagnose or prescribe.
- You help ${name} understand what their data means and make a realistic plan they will actually follow.
- You speak in SHORT sentences — this is voice, not text. Max 3-4 sentences per response.
- You ask ONE question at a time. Never multiple questions.
- You are warm, direct, and non-judgmental. You meet people where they are.
- You ask about REAL LIFE — schedule, barriers, what has and hasn't worked before.
- You do NOT give generic advice. Everything is tailored to what ${name} tells you.

BUILDING A COMMITMENT:
- After 3-5 exchanges, move toward a specific, realistic plan.
- The plan must be something ${name} says they can actually do — not what's theoretically optimal.
- When you have a plan, state it clearly: "So here is what we are committing to: [specific plan]."
- Include: what, how often, when, and what metric we will watch.
- End with: "Does that feel like something you can actually do this week?"

IMPORTANT:
- Never say "As an AI" or "I cannot provide medical advice" mid-conversation — it kills trust.
- At the end add: "Note: I am an AI health coach, not a licensed physician."
- Keep responses SHORT — 2-4 sentences max. This is a voice call.`;
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

/* ── DR. SAGE SPEAKS ─────────────────────────────── */
function sageSpeak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }

    window.speechSynthesis.cancel();
    vcState.isSpeaking = true;
    setMicState('speaking');
    setVcStatus('Dr. Sage is speaking — tap mic to interrupt', 'speaking');

    // Clean text for speech (remove markdown)
    const clean = text.replace(/[*_`#]/g, '').replace(/Note:.+$/i, '').trim();

    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 0.9;
    u.pitch = 1;
    if (vcState.voice) u.voice = vcState.voice;

    u.onend = () => {
      vcState.isSpeaking = false;
      setMicState('idle');
      setVcStatus('Tap the mic to respond', '');
      resolve();
    };

    u.onerror = () => {
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

  // Save to localStorage
  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
  commitments.unshift(record);
  localStorage.setItem('sh_commitments', JSON.stringify(commitments));

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
  // Stop everything
  if (vcState.recognition) {
    try { vcState.recognition.abort(); } catch(e) {}
  }
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
