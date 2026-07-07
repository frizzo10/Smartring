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
  },
};

document.addEventListener('DOMContentLoaded', SageRender.init);
