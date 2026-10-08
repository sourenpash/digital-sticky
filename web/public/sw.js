// Shows the board's reminders as notifications, and opens the board when one is tapped.
// That's all: nothing is cached, so the app always comes fresh from the wall computer.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(notice.title || 'Sticky Wall', {
      body: notice.body || '',
      tag: notice.tag || undefined,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: notice.url || './' },
    }),
  );
});

// A tap opens the sticky: in the app if it's open (it moves there itself), else in a new window.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const open = windows.find(client => client.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ type: 'open', url });
      return open.focus();
    }),
  );
});
