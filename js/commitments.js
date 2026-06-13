/* ═══════════════════════════════════════════════════
   SAGEHEALTH — COMMITMENT FOLLOW-UP ENGINE
   Checks weekly: did their metrics move?
   Opens a voice check-in. Closes the loop.
   ═══════════════════════════════════════════════════ */

/* ── RUN ON EVERY APP LOAD ──────────────────────────
   Call this after data and profile are ready.
   ─────────────────────────────────────────────────── */
function runCommitmentFollowUps(currentData, currentProfile) {
  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
  if (!commitments.length) return;

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  commitments.forEach(c => {
    if (c.status === 'completed' || c.status === 'abandoned') return;

    const age = now - c.dateMs;
    const weeksSince = Math.floor(age / weekMs);
    const lastCheckIn = c.checkIns.length > 0
      ? c.checkIns[c.checkIns.length - 1].dateMs
      : c.dateMs;
    const daysSinceCheckIn = (now - lastCheckIn) / (1000 * 60 * 60 * 24);

    // Check in after 7 days, then every 7 days after that
    if (daysSinceCheckIn >= 7 && weeksSince >= 1) {
      // Only show one follow-up at a time
      if (!localStorage.getItem('sh_followup_shown_' + c.id)) {
        localStorage.setItem('sh_followup_shown_' + c.id, '1');
        setTimeout(() => showFollowUpPrompt(c, currentData, currentProfile, weeksSince), 2000);
      }
    }
  });
}

/* ── SHOW FOLLOW-UP PROMPT ──────────────────────────── */
function showFollowUpPrompt(commitment, currentData, currentProfile, weeksSince) {
  // Calculate metric changes since commitment
  const changes = calculateMetricChanges(commitment, currentData);
  const improving = changes.filter(m => m.direction === 'better').length;
  const worsening = changes.filter(m => m.direction === 'worse').length;

  // Build the prompt card
  const card = document.createElement('div');
  card.id = 'followup-prompt-' + commitment.id;
  card.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:white;border:1px solid rgba(29,111,164,.25);
    border-left:4px solid var(--blue);
    border-radius:14px;padding:18px 20px;
    max-width:340px;z-index:800;
    box-shadow:0 8px 32px rgba(29,111,164,.15);
    animation:slideInRight .4s cubic-bezier(.34,1.56,.64,1);
  `;

  const metricSummary = changes.length > 0
    ? changes.slice(0, 3).map(m =>
        `<span style="font-size:11px;padding:2px 8px;border-radius:7px;background:${m.direction==='better'?'var(--green-bg)':m.direction==='worse'?'var(--red-bg)':'var(--bg)'};color:${m.direction==='better'?'var(--green)':m.direction==='worse'?'var(--red)':'var(--muted)'};border:1px solid ${m.direction==='better'?'rgba(14,159,110,.2)':m.direction==='worse'?'rgba(192,57,43,.2)':'var(--border)'};">${m.label} ${m.direction==='better'?'↑':'↓'}</span>`
      ).join('')
    : '';

  card.innerHTML = `
    <style>@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}</style>
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:11px;">
      <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">🧠</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;">Dr. Sage is checking in</div>
        <div style="font-size:11px;color:var(--muted);">${weeksSince} week${weeksSince>1?'s':''} ago you committed to:</div>
      </div>
      <button onclick="dismissFollowUp('${commitment.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;margin-left:auto;flex-shrink:0;">✕</button>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:13px;line-height:1.5;color:var(--text);margin-bottom:11px;">
      "${commitment.commitment}"
    </div>
    ${metricSummary ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:11px;">${metricSummary}</div>` : ''}
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
      ${improving > 0
        ? `${improving} metric${improving>1?'s are':' is'} moving in the right direction. Let's talk about it.`
        : worsening > 0
        ? `Your metrics haven't shifted yet. That's okay — let's talk about what's happening.`
        : `Time to check in on how things are going.`
      }
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="openFollowUpVoice('${commitment.id}')"
        style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:white;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(29,111,164,.25);">
        🎤 Talk to Dr. Sage
      </button>
      <button onclick="dismissFollowUp('${commitment.id}')"
        style="background:var(--bg);border:1px solid var(--border2);color:var(--muted);border-radius:10px;padding:10px 14px;font-size:12px;cursor:pointer;">
        Later
      </button>
    </div>
  `;

  document.body.appendChild(card);
}

/* ── OPEN FOLLOW-UP VOICE CONSULTATION ─────────────── */
function openFollowUpVoice(commitmentId) {
  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
  const commitment = commitments.find(c => String(c.id) === String(commitmentId));
  if (!commitment) return;

  dismissFollowUp(commitmentId);

  const changes = calculateMetricChanges(commitment, data);
  const improving = changes.filter(m => m.direction === 'better');
  const worsening = changes.filter(m => m.direction === 'worse');

  // Build context for Dr. Sage
  const changeContext = changes.length > 0
    ? `Metric changes since commitment: ${changes.map(m => `${m.label} ${m.direction==='better'?'improved':'declined'} (was ${m.was}, now ${m.now})`).join(', ')}.`
    : 'No metric data change detected yet.';

  const openingQuestion = improving.length > 0
    ? `I can see some of your numbers are moving in the right direction. Tell me — have you been doing the ${commitment.commitment.toLowerCase()}?`
    : `It has been a week since you committed to something. I wanted to check in — how has it been going with ${commitment.commitment.toLowerCase()}?`;

  // Inject commitment context into voice consult
  if (typeof openVoiceConsult === 'function') {
    openVoiceConsult(commitment.sigId, commitment.sigTitle, openingQuestion);
    // Override the system prompt to include commitment context
    setTimeout(() => {
      vcState._commitmentContext = {
        commitment: commitment.commitment,
        date: commitment.date,
        weeksSince: Math.floor((Date.now() - commitment.dateMs) / (7*24*60*60*1000)),
        changes,
        changeContext
      };
    }, 100);
  }
}

/* ── CALCULATE METRIC CHANGES ───────────────────────── */
function calculateMetricChanges(commitment, currentData) {
  if (!currentData || !commitment.baselineMetrics) return [];

  const b = commitment.baselineMetrics;
  const now = {
    hrv: avg(currentData, 'hrv'),
    rhr: avg(currentData, 'rhr'),
    bpSys: avg(currentData, 'bpSys'),
    sleep: avgF(currentData, 'sleep'),
    steps: avg(currentData, 'steps')
  };

  const changes = [];

  if (b.hrv && Math.abs(now.hrv - b.hrv) >= 3) {
    changes.push({
      label: 'HRV',
      was: b.hrv + 'ms',
      now: now.hrv + 'ms',
      direction: now.hrv > b.hrv ? 'better' : 'worse',
      delta: now.hrv - b.hrv
    });
  }
  if (b.rhr && Math.abs(now.rhr - b.rhr) >= 2) {
    changes.push({
      label: 'Resting HR',
      was: b.rhr + ' BPM',
      now: now.rhr + ' BPM',
      direction: now.rhr < b.rhr ? 'better' : 'worse', // lower is better
      delta: b.rhr - now.rhr
    });
  }
  if (b.bpSys && Math.abs(now.bpSys - b.bpSys) >= 3) {
    changes.push({
      label: 'Blood pressure',
      was: b.bpSys + ' mmHg',
      now: now.bpSys + ' mmHg',
      direction: now.bpSys < b.bpSys ? 'better' : 'worse',
      delta: b.bpSys - now.bpSys
    });
  }
  if (b.sleep && Math.abs(now.sleep - b.sleep) >= 0.3) {
    changes.push({
      label: 'Sleep',
      was: b.sleep + 'h',
      now: now.sleep + 'h',
      direction: now.sleep > b.sleep ? 'better' : 'worse',
      delta: now.sleep - b.sleep
    });
  }
  if (b.steps && Math.abs(now.steps - b.steps) >= 500) {
    changes.push({
      label: 'Steps',
      was: b.steps.toLocaleString(),
      now: now.steps.toLocaleString(),
      direction: now.steps > b.steps ? 'better' : 'worse',
      delta: now.steps - b.steps
    });
  }

  return changes;
}

/* ── DISMISS FOLLOW-UP ──────────────────────────────── */
function dismissFollowUp(id) {
  const card = document.getElementById('followup-prompt-' + id);
  if (card) {
    card.style.animation = 'none';
    card.style.transform = 'translateX(120%)';
    card.style.transition = 'transform .3s ease';
    setTimeout(() => card.remove(), 300);
  }
  // Mark as checked in so it doesn't show again until next week
  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
  const idx = commitments.findIndex(c => String(c.id) === String(id));
  if (idx >= 0) {
    commitments[idx].checkIns.push({ dateMs: Date.now(), type: 'dismissed' });
    localStorage.setItem('sh_commitments', JSON.stringify(commitments));
  }
  localStorage.removeItem('sh_followup_shown_' + id);
}

/* ── COMMITMENTS TAB IN RECORDS ─────────────────────── */
function renderCommitmentsTab() {
  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
  const container = document.getElementById('commitments-list');
  const empty = document.getElementById('commitments-empty');
  if (!container) return;

  if (!commitments.length) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  container.innerHTML = commitments.map(c => {
    const weeksSince = Math.floor((Date.now() - c.dateMs) / (7*24*60*60*1000));
    const changes = typeof data !== 'undefined' ? calculateMetricChanges(c, data) : [];
    const improving = changes.filter(m => m.direction === 'better').length;

    return `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:16px 18px;margin-bottom:10px;box-shadow:var(--shadow);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px;">${c.date} · ${c.sigTitle}</div>
          <div style="font-size:14px;font-weight:700;color:var(--text);">"${c.commitment}"</div>
        </div>
        <span style="flex-shrink:0;font-size:10px;font-weight:700;padding:3px 10px;border-radius:8px;background:${c.status==='active'?'var(--green-bg)':'var(--bg)'};color:${c.status==='active'?'var(--green)':'var(--muted)'};border:1px solid ${c.status==='active'?'rgba(14,159,110,.2)':'var(--border)'};">${c.status}</span>
      </div>
      ${changes.length > 0 ? `
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 13px;margin-bottom:10px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;margin-bottom:7px;">Metric changes since commitment</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            ${changes.map(m => `
              <div style="text-align:center;background:${m.direction==='better'?'var(--green-bg)':'var(--red-bg)'};border:1px solid ${m.direction==='better'?'rgba(14,159,110,.2)':'rgba(192,57,43,.2)'};border-radius:9px;padding:6px 12px;">
                <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">${m.label}</div>
                <div style="font-size:13px;font-weight:700;color:${m.direction==='better'?'var(--green)':'var(--red)'};">${m.now}</div>
                <div style="font-size:10px;color:${m.direction==='better'?'var(--green)':'var(--red)'};">${m.direction==='better'?'↑':'↓'} was ${m.was}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Week ${weeksSince} — tracking metrics vs your baseline at commitment date.</div>`}
      <div style="display:flex;gap:8px;">
        <button onclick="openFollowUpVoice('${c.id}')"
          style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:white;border:none;border-radius:9px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;">
          🎤 Check in with Dr. Sage
        </button>
        ${c.checkIns.length > 0 ? `<span style="font-size:11px;color:var(--muted);display:flex;align-items:center;">${c.checkIns.length} check-in${c.checkIns.length>1?'s':''}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}
