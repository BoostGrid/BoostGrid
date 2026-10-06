// BoostGrid service worker: exists only so phones can show notifications (Android Chrome needs
// registration.showNotification) and tapping one opens the app; no caching
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('earner-dashboard.html');
  }));
});
