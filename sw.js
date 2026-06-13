/* ═══════════════════════════════════════════════════
   SAGEHEALTH — SERVICE WORKER
   Handles push notifications + offline caching
   ═══════════════════════════════════════════════════ */

const CACHE_NAME = 'sagehealth-v1';
const CACHE_URLS = ['/', '/js/app.js', '/js/signals.js', '/js/voice-consult.js', '/js/commitments.js'];

/* ── INSTALL ─────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

/* ── ACTIVATE ────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── FETCH — network first, cache fallback ─────── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ── PUSH NOTIFICATIONS ──────────────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch(e) { data = { title: 'SageHealth', body: event.data.text() }; }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-96.png',
    tag: data.tag || 'sagehealth',          // replaces previous notification of same tag
    renotify: false,                         // don't buzz again if same tag exists
    silent: data.silent || false,
    requireInteraction: false,               // auto-dismiss — not pushy
    data: data.url ? { url: data.url } : {},
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/* ── NOTIFICATION CLICK ──────────────────────────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) {
          existing.focus();
          existing.postMessage({ type: 'NOTIFICATION_CLICK', url });
        } else {
          self.clients.openWindow(url);
        }
      })
  );
});
