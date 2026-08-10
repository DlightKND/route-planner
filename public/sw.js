// DLIGHT service worker — только push-уведомления.
// Кэширование намеренно не делаем: приложение обновляется через сборку,
// а лишний кэш только мешал бы выкату новой версии.

// Сервер (push-send) шлёт JSON вида {title, body, tag}.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: 'DLIGHT', body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'DLIGHT';
  const options = {
    body: payload.body || '',
    tag: payload.tag || undefined,   // один tag на выезд — без дублей на экране
    icon: './favicon.png',
    badge: './favicon.png',
    data: { url: './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Клик по уведомлению — на передний план уже открытую вкладку или новую.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
