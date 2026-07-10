/* ─────────────────────────────────────────────────────────
   myDrSage — Render Layer
   Pure DOM rendering driven by SageApp state. No business
   logic here — that all lives in app-state.js / calibration.js.
   ───────────────────────────────────────────────────────── */

const SageRender = {

  init() {
    window.SageApp.init();
    SageRender.renderAll();
    SageRender.wireStaticButtons();
  },

  renderAll() {
    SageRender.renderHeader();
    SageRender.renderPendingQuestion();
    SageRender.renderBreathingCard();
    SageRender.renderHeartCard();
    SageRender.renderHistory();
  },

  renderHeader() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('today-date').textContent = dateStr;
    const hour = now.getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    document.getElementById('greeting').textContent = `${timeGreeting}, Frank`;
  },

  // ── PENDING QUESTION ───────────────────────────────────────
  renderPendingQuestion() {
    const container = document.getElementById('question-container');
    const pending = window.SageApp.getPendingQuestions();

    if (pending.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Show one at a time — the most recent flagged night first
    const q = pending[pending.length - 1];

    const answerLabels = {
      alcohol: 'Alcohol', late_meal: 'Late meal', stressful_day: 'Stressful day', nothing_unusual: 'Nothing unusual',
      back: 'Back', side_or_stomach: 'Side or stomach', not_sure: 'Not sure',
      loose_or_removed: 'It was loose', ring_was_fine: 'Ring was fine',
      high_stress: 'Yes, high stress', normal: 'Pretty normal',
      feeling_sick: 'Feeling sick', just_tired: 'Just tired',
    };

    container.innerHTML = `
      <div class="question-banner">
        <div class="label">Dr. Sage is asking</div>
        <div class="prompt">${q.prompt}</div>
        <div class="answer-row">
          ${q.answers.map(a => `<button class="answer-btn" data-night="${q.nightDate}" data-flag="${q.flagId}" data-answer="${a}">${answerLabels[a] || a}</button>`).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { night, flag, answer } = btn.dataset;
        window.SageApp.answerQuestion(night, flag, answer);
        SageRender.renderAll();
      });
    });
  },

  // ── BREATHING CARD ────────────────────────────────────────
  renderBreathingCard() {
    const el = document.getElementById('breathing-card');
    const verdict = window.SageApp.getBreathingVerdict();
    if (!verdict) { el.innerHTML = ''; return; }

    const tone = verdict.tone; // 'normal' | 'watch'
    const toneClass = tone === 'watch' ? 'amber-tone' : 'green-tone';
    const dotClass = tone === 'watch' ? 'amber' : 'green';

    el.innerHTML = `
      <div class="card ${toneClass}">
        <div class="card-label">
          <div class="dot ${dotClass}"></div>
          <span>breathing overnight</span>
        </div>
        <div class="card-text voice">${verdict.text}</div>
        ${SageRender.sparklineSVG(dotClass)}
      </div>
    `;
  },

  // ── HEART CARD ─────────────────────────────────────────────
  renderHeartCard() {
    const el = document.getElementById('heart-card');
    const verdict = window.SageApp.getHeartVerdict();
    if (!verdict) { el.innerHTML = ''; return; }

    const tone = verdict.tone;
    const toneClass = tone === 'watch' ? 'amber-tone' : 'green-tone';
    const dotClass = tone === 'watch' ? 'amber' : 'green';

    el.innerHTML = `
      <div class="card ${toneClass}">
        <div class="card-label">
          <div class="dot ${dotClass}"></div>
          <span>heart, this week</span>
        </div>
        <div class="card-text voice">${verdict.text}</div>
        <div class="metric-row">
          <div>
            <div class="m-label">HRV</div>
            <div class="m-value">${verdict.hrv ?? '--'}<span class="m-unit"> ms</span></div>
          </div>
          <div>
            <div class="m-label">resting HR</div>
            <div class="m-value">${verdict.rhr ?? '--'}<span class="m-unit"> bpm</span></div>
          </div>
        </div>
        ${verdict.recommendCheckup ? '<div class="checkup-badge">Worth a real checkup</div>' : ''}
      </div>
    `;
  },

  sparklineSVG(colorClass) {
    const color = colorClass === 'amber' ? '#D99A4E' : '#5FA97A';
    // simple illustrative sparkline; not driven by real point data tonight
    const points = '0,20 20,18 40,19 60,17 80,22 100,18 120,17 140,18 160,16 180,17 200,20 220,18 240,16 260,17 280,15 300,16 320,17';
    return `
      <svg class="sparkline" viewBox="0 0 320 40">
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  },

  // ── HISTORY LIST ───────────────────────────────────────────
  renderHistory() {
    const el = document.getElementById('history-list');
    const history = [...window.SageApp.state.history].reverse().slice(0, 10);

    el.innerHTML = history.map(night => {
      const dateLabel = new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      let desc, tagClass, tagText;
      if (night.flags.length === 0) {
        desc = 'Normal night';
        tagClass = 'normal';
        tagText = '';
      } else if (!night.resolution) {
        desc = night.flags[0].description;
        tagClass = 'watch';
        tagText = 'unanswered';
      } else if (night.resolution.outcome === 'explained_suppress') {
        desc = night.flags[0].description;
        tagClass = 'explained';
        tagText = night.resolution.explanationTag || 'explained';
      } else if (night.resolution.outcome === 'sensor_flagged_unreliable') {
        desc = night.flags[0].description;
        tagClass = 'normal';
        tagText = 'signal noted';
      } else {
        desc = night.flags[0].description;
        tagClass = 'watch';
        tagText = 'noted';
      }

      return `
        <div class="history-row">
          <div class="h-date">${dateLabel}</div>
          <div class="h-desc">${desc}</div>
          ${tagText ? `<div class="h-tag ${tagClass}">${tagText}</div>` : ''}
        </div>
      `;
    }).join('');
  },

  // ── STATIC BUTTONS ────────────────────────────────────────
  wireStaticButtons() {
    document.getElementById('reset-demo-btn').addEventListener('click', () => {
      window.SageApp.resetToFreshDemo();
      SageRender.renderAll();
    });

    document.getElementById('ask-sage-btn').addEventListener('click', () => {
      alert('Voice consult with Dr. Sage — wiring to existing voice-consult.js is the next step once this screen is approved.');
    });

    document.getElementById('history-btn').addEventListener('click', () => {
      document.querySelector('.section-title').scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('connect-ring-btn').addEventListener('click', SageRender.connectRing);
    SageRender.setupCopyLogButton();
    SageRender.setupDisconnectButton();
  },

  // ── REAL RING CONNECTION ───────────────────────────────────
  debugBuffer: [],

  debugLog(msg, isLive = false) {
    const stamped = `[${new Date().toLocaleTimeString()}] ${msg}`;
    SageRender.debugBuffer.push(stamped);

    const panel = document.getElementById('ring-debug');
    panel.classList.add('visible');
    const line = document.createElement('div');
    if (isLive) line.className = 'live-value';
    line.textContent = msg;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
    // DOM stays capped for performance; debugBuffer (used by the copy
    // button below) keeps everything so a rare packet — like the one-off
    // 0x9e capture from the July 10 session — doesn't scroll out of
    // existence before it can be reviewed.
    while (panel.children.length > 60) panel.removeChild(panel.firstChild);

    const copyBtn = document.getElementById('copy-ring-log-btn');
    if (copyBtn) copyBtn.style.display = 'block';
  },

  setupCopyLogButton() {
    const copyBtn = document.getElementById('copy-ring-log-btn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      const text = SageRender.debugBuffer.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        const original = copyBtn.textContent;
        copyBtn.textContent = `Copied ${SageRender.debugBuffer.length} lines`;
        setTimeout(() => { copyBtn.textContent = original; }, 2000);
      } catch (e) {
        // Clipboard API can fail in some in-app browsers (e.g. Bluefy) —
        // fall back to a selectable text prompt so the log isn't lost.
        window.prompt('Copy the full debug log below:', text);
      }
    });
  },

  setupDisconnectButton() {
    const disconnectBtn = document.getElementById('disconnect-ring-btn');
    if (!disconnectBtn) return;
    disconnectBtn.addEventListener('click', async () => {
      disconnectBtn.disabled = true;
      disconnectBtn.textContent = 'Disconnecting...';
      try {
        // Release the GATT connection cleanly from our side first —
        // doing this before forgetting the device in iOS Bluetooth
        // settings tends to leave the ring in a cleaner state for the
        // next reconnect, rather than just walking away from an open
        // connection.
        await window.ColmiBLE.disconnect();
      } catch (e) {
        SageRender.debugLog(`[disconnect error] ${e.message || e}`);
      }
      disconnectBtn.disabled = false;
      disconnectBtn.textContent = 'Disconnect Ring';
    });
  },

  async connectRing() {
    const btn = document.getElementById('connect-ring-btn');
    const disconnectBtn = document.getElementById('disconnect-ring-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    const BLE = window.ColmiBLE;
    // Universal packet trace — shows cmd byte + full hex for every
    // notification, so a genuine 0x69 reading response can be told apart
    // from a stale/echoed 0x03 battery packet during real-time debugging.
    BLE.on('debugPacket', p => SageRender.debugLog(`[pkt ${p.cmdHex}] ${p.hex}`));
    BLE.on('status', s => {
      SageRender.debugLog('[status] ' + s);
      if (disconnectBtn) disconnectBtn.style.display = s === 'connected' ? 'block' : 'none';
      if (s === 'disconnected') {
        btn.disabled = false;
        btn.textContent = 'Connect Colmi R02';
      }
    });
    BLE.on('battery', b => SageRender.debugLog(`[battery] ${b.level}% ${b.charging ? '(charging)' : ''}`, true));
    BLE.on('reading', r => {
      const label = r.kind === BLE.READING_HEART_RATE ? 'HR' : r.kind === BLE.READING_SPO2 ? 'SpO2' : 'kind ' + r.kind;
      const rawNote = r.rawSample ? ` (raw@6-7: ${r.rawSampleHex})` : '';
      SageRender.debugLog(`[${label}] ${r.value}${rawNote}`, true);
    });
    BLE.on('readingError', e => SageRender.debugLog(`[reading error] kind=${e.kind} code=${e.code}`));
    BLE.on('raw', hex => SageRender.debugLog('[raw] ' + hex));

    try {
      const name = await BLE.connect();
      SageRender.debugLog('[connected] ' + name);
      btn.textContent = 'Connected — reading HR...';

      // Extended from 20s: bytes[6:8] of the raw HR packet were still
      // actively changing at the 20s cutoff during the July 10 session,
      // suggesting the ring hadn't finished its warm-up/settling window.
      await BLE.streamReading(BLE.READING_HEART_RATE, 60, () => {});
      btn.textContent = 'HR read done — reading SpO2...';

      await BLE.streamReading(BLE.READING_SPO2, 30, () => {});
      btn.textContent = 'Done — see readings above';
    } catch (e) {
      SageRender.debugLog(`[error] ${e.name || 'Error'}: ${e.message || '(no message)'}`);
      btn.textContent = 'Connect failed — tap to retry';
      btn.disabled = false;
    }
  },
};

document.addEventListener('DOMContentLoaded', SageRender.init);
