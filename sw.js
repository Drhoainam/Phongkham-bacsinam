// Service Worker — PhòngKhám Pro
// Xử lý Push Notification nhắc uống thuốc

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Nhận push từ server (Firebase/Zalo)
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const options = {
    body: data.body || 'Đến giờ uống thuốc rồi!',
    icon: data.icon || '/icon-192.png',
    badge: '/badge.png',
    tag: data.tag || 'med-reminder',
    requireInteraction: true,
    actions: [
      { action: 'done', title: '✓ Đã uống' },
      { action: 'snooze', title: '⏰ Nhắc lại 15 phút' }
    ],
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(data.title || '💊 Nhắc uống thuốc', options));
});

// Xử lý click notification
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'snooze') {
    // Nhắc lại sau 15 phút
    e.waitUntil(new Promise(resolve => {
      setTimeout(() => {
        self.registration.showNotification('💊 Nhắc lại: Uống thuốc!', {
          body: e.notification.body,
          tag: 'med-snooze'
        });
        resolve();
      }, 15 * 60 * 1000);
    }));
  } else {
    // Mở trang đơn thuốc
    e.waitUntil(clients.openWindow(e.notification.data.url || '/'));
  }
});

// Schedule local notifications (alarm-based)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_REMINDERS') {
    scheduleReminders(e.data.reminders);
  }
});

const scheduledAlarms = [];

function scheduleReminders(reminders) {
  // Clear old alarms
  scheduledAlarms.forEach(t => clearTimeout(t));
  scheduledAlarms.length = 0;

  const now = new Date();
  reminders.forEach(r => {
    const [h, m] = r.time.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1); // ngày mai
    const delay = target - now;

    const t = setTimeout(() => {
      self.registration.showNotification('💊 Đến giờ uống thuốc!', {
        body: r.meds,
        tag: 'scheduled-' + r.time,
        requireInteraction: true,
        actions: [
          { action: 'done', title: '✓ Đã uống' },
          { action: 'snooze', title: '⏰ 15 phút nữa' }
        ]
      });
    }, delay);
    scheduledAlarms.push(t);
  });
}
