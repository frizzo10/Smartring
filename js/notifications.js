/* ═══════════════════════════════════════════════════
   SAGEHEALTH — PUSH NOTIFICATION ENGINE

   PHILOSOPHY:
   Only push when SageHealth noticed something the
   person would genuinely want to know about.

   NEVER:
   - Re-engagement ("You haven't opened the app")
   - Streaks ("Don't break your streak!")
   - Promotional anything
   - More than 1 notification per day

   ONLY:
   - Temperature spike (illness incoming)
   - Urgent signal detected
   - Weekly report ready (Monday only)
   - Commitment check-in (7 days after commitment)
   - Dr. Sage found something meaningful
   ═══════════════════════════════════════════════════ */

/* ── REGISTER SERVICE WORKER ─────────────────────── */
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push not supported in this browser');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('Service worker registered');

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        handleNotificationTap(event.data.url);
      }
    });

    return reg;
  } catch(e) {
    console.log('SW registration failed:', e);
    return false;
  }
}

/* ── REQUEST PERMISSION ──────────────────────────── */
async function requestPushPermission() {
  if (!('Notification' in window)) return 'unsupported';

  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';

  // Don't ask immediately — ask after user has seen value
  const permission = await Notification.requestPermission();
  localStorage.setItem('sh_push_permission', permission);
  return permission;
}

/* ── PERMISSION PROMPT — shown after first signal fires ── */
function showPushPermissionPrompt() {
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('sh_push_declined')) return;

  const banner = document.createElement('div');
  banner.id = 'push-permission-banner';
  banner.style.cssText = `
    position:fixed;bottom:calc(70px + env(safe-area-inset-bottom));
    left:12px;right:12px;
    background:var(--panel);
    border:1px solid rgba(29,111,164,.25);
    border-left:4px solid var(--blue);
    border-radius:14px;padding:14px 16px;
    z-index:800;box-shadow:var(--shadow-md);
    animation:slideUp .4s cubic-bezier(.34,1.56,.64,1);
  `;
  banner.innerHTML = `
    <style>@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>
    <div style="display:flex;gap:10px;align-items:flex-start;">
      <span style="font-size:20px;flex-shrink:0;">🔔</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px;">Get notified when it matters</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.5;">SageHealth will only notify you when your ring detects something worth knowing — like a temperature spike or a signal that needs attention. Never promotional.</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button onclick="enablePushNotifications()" style="flex:1;background:var(--blue);color:white;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;">Enable notifications</button>
      <button onclick="declinePush()" style="background:var(--bg);border:1px solid var(--border2);color:var(--muted);border-radius:9px;padding:9px 14px;font-size:12px;cursor:pointer;">Not now</button>
    </div>
  `;
  document.body.appendChild(banner);
}

async function enablePushNotifications() {
  document.getElementById('push-permission-banner')?.remove();
  const perm = await requestPushPermission();
  if (perm === 'granted') {
    showToast('🔔 Notifications on', 'SageHealth will notify you only when it matters.');
    localStorage.setItem('sh_push_permission', 'granted');
  }
}

function declinePush() {
  document.getElementById('push-permission-banner')?.remove();
  localStorage.setItem('sh_push_declined', '1');
}

/* ── NOTIFICATION DEFINITIONS ────────────────────── */
const NOTIFICATIONS = {

  // Temperature spike — earliest illness warning
  temp_spike: (data) => {
    const t = data[data.length - 1];
    if (t.tempDev <= 0.5) return null;
    const devF = (t.tempDev * 9 / 5).toFixed(1);
    return {
      title: '🌡️ Temperature above baseline',
      body: `Your overnight temp was +${devF}°F above normal. Your immune system may be activating. Rest today.`,
      tag: 'temp-spike',
      silent: false,
      url: '/?signal=immune_activation'
    };
  },

  // Urgent signal detected
  urgent_signal: (firedSignals) => {
    const urgent = firedSignals.filter(s => s.level === 'urgent');
    if (!urgent.length) return null;
    return {
      title: `⚠️ SageHealth detected something`,
      body: urgent.length === 1
        ? `${urgent[0].title} — open SageHealth to review.`
        : `${urgent.length} health signals need your attention.`,
      tag: 'urgent-signal',
      silent: false,
      url: '/'
    };
  },

  // Weekly report ready — Monday morning only
  weekly_ready: () => {
    const now = new Date();
    if (now.getDay() !== 1) return null; // Monday only
    if (now.getHours() < 7 || now.getHours() > 10) return null; // 7-10am only
    return {
      title: '📋 Your weekly health report is ready',
      body: 'Dr. Sage has reviewed your week. Tap to see your summary and clinical findings.',
      tag: 'weekly-report',
      silent: true,  // silent — no sound, just banner
      url: '/?open=weekly'
    };
  },

  // Commitment check-in due
  commitment_due: (commitments) => {
    if (!commitments.length) return null;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const due = commitments.find(c => {
      if (c.status !== 'active') return false;
      const age = Date.now() - c.dateMs;
      const lastCheckIn = c.checkIns.length > 0
        ? c.checkIns[c.checkIns.length - 1].dateMs : c.dateMs;
      return age >= weekMs && (Date.now() - lastCheckIn) >= weekMs;
    });
    if (!due) return null;
    return {
      title: '🧠 Dr. Sage is checking in',
      body: `One week ago you committed to: "${due.commitment.slice(0, 60)}..." — how did it go?`,
      tag: 'commitment-checkin',
      silent: true,
      url: '/?open=commitment&id=' + due.id
    };
  },

  // BP trending up — 3+ days above 130
  bp_trending: (data) => {
    const highDays = data.filter(d => d.bpSys >= 135).length;
    if (highDays < 4) return null;
    const avgBp = Math.round(data.reduce((s,d) => s + d.bpSys, 0) / data.length);
    return {
      title: '🫀 Blood pressure trending elevated',
      body: `Your average BP this week is ${avgBp} mmHg. Worth monitoring — open SageHealth for what to do.`,
      tag: 'bp-trending',
      silent: true,
      url: '/?signal=bp_elevated'
    };
  }
};

/* ── DAILY NOTIFICATION CHECK ────────────────────── */
async function runNotificationCheck(currentData, currentProfile, firedSignals) {
  if (Notification.permission !== 'granted') return;

  // Max 1 notification per day
  const today = new Date().toISOString().slice(0, 10);
  const lastNotif = localStorage.getItem('sh_last_notif');
  if (lastNotif === today) return;

  const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');

  // Check in priority order — only send the most important one
  const checks = [
    NOTIFICATIONS.temp_spike(currentData),
    NOTIFICATIONS.urgent_signal(firedSignals),
    NOTIFICATIONS.commitment_due(commitments),
    NOTIFICATIONS.weekly_ready(),
    NOTIFICATIONS.bp_trending(currentData),
  ];

  const toSend = checks.find(n => n !== null);
  if (!toSend) return;

  // Send via service worker
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(toSend.title, {
      body: toSend.body,
      tag: toSend.tag,
      silent: toSend.silent,
      requireInteraction: false,
      data: { url: toSend.url },
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="%231D6FA4"/><text x="96" y="130" font-size="100" text-anchor="middle" fill="white">⚕</text></svg>'
    });
    localStorage.setItem('sh_last_notif', today);
  } catch(e) {
    console.log('Notification failed:', e);
  }
}

/* ── HANDLE NOTIFICATION TAP ─────────────────────── */
function handleNotificationTap(url) {
  if (!url) return;
  const params = new URLSearchParams(url.split('?')[1] || '');

  if (params.get('open') === 'weekly') {
    setTimeout(() => openWeekly(), 500);
  } else if (params.get('signal')) {
    // Scroll to signals panel and toggle that signal
    const panel = document.getElementById('signals-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth' });
  } else if (params.get('open') === 'commitment') {
    const id = params.get('id');
    if (id) setTimeout(() => openFollowUpVoice(id), 500);
  }
}

/* ── BOOT ────────────────────────────────────────── */
window.addEventListener('load', () => {
  initPushNotifications();
});
