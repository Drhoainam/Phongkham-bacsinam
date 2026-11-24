// Service Worker — App CSKH (scope /cskh, dùng chung cho /cskh và /cskh-admin)
const CACHE = 'cskh-v2';
const SHELL = ['/cskh', '/manifest-cskh.json', '/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('cskh-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Trang chính: ưu tiên mạng, mất mạng thì dùng bản đã lưu
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.pathname !== '/cskh' && url.pathname !== '/cskh.html') return;
  e.respondWith(
    fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put('/cskh', c)); return r; })
      .catch(() => caches.match('/cskh'))
  );
});

// ---- Thông báo đẩy (FCM, tin dạng data) ----
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { data: { body: e.data && e.data.text() } }; }
  const d = p.data || p, n = p.notification || {};
  const title = d.title || n.title || 'Phòng khám BS. Hoài Nam';
  const opts = {
    body: d.body || n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'cskh',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: d.url || '/cskh' }
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(c => c.postMessage({ type: 'cskh-refresh' }));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/cskh';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => new URL(x.url).pathname.startsWith(target));
    if (c) { c.postMessage({ type: 'cskh-refresh' }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
