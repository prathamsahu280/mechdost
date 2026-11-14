/*
 * MechDost web push worker (spec 10, design 2026-11-15). Served as-is from the site root so its scope is the whole site.
 *
 * It has no Firebase code and no keys: the page registers it and asks Firebase for a token (lazy-loaded after the
 * person taps "Turn on"); the server sends through Firebase Cloud Messaging, and the browser wakes this worker with
 * the message. It shows the notification (title and short body only: no addresses, phones or amounts), tells open
 * tabs to refresh their bell, and on a tap opens the page the message links to. It never fetches anything.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/** Only a path on this site: the server sends `/orders/...`; anything else opens the home page. */
function safePath(value) {
  return typeof value === 'string' &&
    value.charAt(0) === '/' &&
    value.charAt(1) !== '/' &&
    value.charAt(1) !== '\\'
    ? value
    : '/';
}

self.addEventListener('push', function (event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }
  var note = payload.notification || {};
  var data = payload.data || {};
  var title = String(note.title || data.title || 'MechDost').slice(0, 80);
  var body = String(note.body || data.body || '').slice(0, 240);
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: body,
        // One notification per kind: a newer order replaces an older unread one instead of stacking forever.
        tag: typeof data.kind === 'string' ? data.kind : undefined,
        data: { link: safePath(data.link) },
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        windows.forEach(function (w) {
          w.postMessage({ type: 'mechdost-notice' });
        });
      }),
    ]),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = new URL(safePath(event.notification.data && event.notification.data.link), self.location.origin)
    .href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i += 1) {
        var w = windows[i];
        if ('focus' in w) {
          return w.focus().then(function (focused) {
            return focused && 'navigate' in focused ? focused.navigate(url) : self.clients.openWindow(url);
          });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
