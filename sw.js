// Service worker — no caching, but real push notification support
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});

// Real push handling — displays whatever send-meal-reminders.js
// (or any future sender using the same subscription) actually
// sent, never a hardcoded/fake notification body.
self.addEventListener('push', event => {
  let data = { title: 'myDrSage', body: 'You have a new update.', url: '/scores.html' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* fall back to default text above */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="%230D130F"/><circle cx="96" cy="84" r="40" fill="%238FB596"/></svg>',
      data: { url: data.url || '/scores.html' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/scores.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
