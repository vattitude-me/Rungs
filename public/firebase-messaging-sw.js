/* Push receiver for the installed web app.
 *
 * This is a standalone service worker, separate from the Workbox one that
 * vite-plugin-pwa generates: Firebase Messaging looks for a worker at exactly
 * this filename by convention, and keeping it apart means the caching setup
 * (including the deliberate exclusion of the Firebase chunk from precache)
 * stays untouched.
 *
 * The compat builds are used because a service worker can't use ES module
 * imports in every browser that supports push - notably older Safari.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Injected at build time from the same env vars the app uses. These are public
// values - a web app ships them to every client by design.
firebase.initializeApp(self.__FIREBASE_CONFIG__);

const messaging = firebase.messaging();

/* Notifications arriving while the app is closed or backgrounded.
 *
 * The worker sends data-only messages rather than `notification` payloads, so
 * that this handler runs and decides how to display them - a `notification`
 * payload would be shown by the browser automatically and ignore the click
 * behaviour below. */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'Time for a set';
  self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'rungs-window',
    // Replace rather than stack: a second reminder for the same window should
    // update the first, not leave two sitting in the shade.
    renotify: Boolean(data.tag),
    data: { url: data.url || '/today' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/today';

  // Focus an already-open window rather than opening a second copy of the app.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
