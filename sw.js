// ============================================================================
// DLIGHT · service worker
// ============================================================================
// Отдельный файл по необходимости, а не по желанию: браузер не регистрирует
// service worker из инлайна или blob: — только настоящий файл с того же
// домена. Лежит рядом с dlight-app.html.
//
// Кэшированием НЕ занимаемся сознательно. Приложение работает по живым
// данным из Supabase, и офлайн-кэш здесь только создал бы возможность
// показать вчерашний выезд как сегодняшний.
// ============================================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }

  const title = d.title || 'DLIGHT';
  const opts = {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'dlight',      // одинаковый tag схлопывает повторы
    renotify: true,
    requireInteraction: true,    // выезд — не новость дня, пусть висит
    data: { url: d.url || './dlight-app.html' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './dlight-app.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Уже открыто — фокусируем, а не плодим вкладки.
    for (const c of all) {
      if (c.url.includes('dlight-app') && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
