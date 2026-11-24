// Service Worker — App CSKH (scope /cskh)
const CACHE = 'cskh-v1';
const SHELL = ['/cskh', '/manifest-cskh.json'];

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
  e.respondWith(
    fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put('/cskh', c)); return r; })
      .catch(() => caches.match('/cskh'))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.includes('/cskh'));
    return c ? c.focus() : self.clients.openWindow('/cskh');
  }));
});
