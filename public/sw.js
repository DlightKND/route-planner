// DLIGHT service worker: кэш оболочки + push-уведомления.
//
// Раньше здесь стояло «кэширование намеренно не делаем: приложение
// обновляется через сборку, а лишний кэш только мешал бы выкату новой
// версии». Проблема была настоящая, а лекарство — не то. Итог: приложение
// стоит у инженеров как нативное, а без связи открывается белым экраном.
// Не «медленно» и не «старые данные» — ничего. В поле (карьеры,
// лесничества, воинские части) отсутствие связи не крайний случай,
// а рабочая среда.
//
// Выкат лечится не отказом от кэша, а двумя вещами:
//   1. Имя кэша с версией: новая сборка кладёт файлы в новый кэш, старый
//      удаляется в activate.
//   2. HTML берётся СЕТЬЮ-ПЕРВОЙ. Пока связь есть, человек всегда получает
//      свежий index.html, а с ним и ссылку на свежий бандл. Кэш HTML —
//      только запасной выход.
// Статика (бандл с хэшем в имени, шрифты, иконки) отдаётся из кэша сразу
// и обновляется в фоне: при том же имени её содержимое не меняется.

const CACHE = 'dlight-v1';

// Домены, без которых приложение не загрузится: оттуда приезжают leaflet,
// supabase-js и шрифты. Их ответы кэшируем так же, как свою статику.
const ASSET_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Что не кэшируем никогда:
//   — обращения к Supabase (данные, авторизация, файлы): у них свои правила
//     свежести, и отдать вчерашний ответ на запрос заявок опаснее, чем
//     честно сказать «нет связи»;
//   — тайлы карты: их бесконечно много, кэш распух бы незаметно.
function skip(url) {
  return url.pathname.startsWith('/rest/v1/')
      || url.pathname.startsWith('/auth/v1/')
      || url.pathname.startsWith('/storage/v1/')
      || url.pathname.startsWith('/functions/v1/')
      || url.hostname.endsWith('.supabase.co')
      || url.hostname.endsWith('tile.openstreetmap.org')
      || url.hostname === 'api.maptiler.com';
}

self.addEventListener('install', (event) => {
  // Список файлов заранее неизвестен (имена с хэшем), поэтому ничего не
  // предзагружаем: кэш наполняется по ходу первой онлайн-сессии.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (skip(url)) return;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !ASSET_HOSTS.includes(url.hostname)) return;

  // Навигация (сам index.html) — сеть первой: новая сборка приезжает сразу,
  // как только есть связь.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Клон снимаем СРАЗУ, синхронно. Если отложить его до открытия
        // кэша, тело ответа успевает начать читаться, и clone() падает
        // с «body is already used» — молча, внутри висячего промиса.
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Запрошенного адреса нет — отдаём корень приложения: у PWA это
        // единственная страница, всё остальное рисует бандл.
        const root = (await caches.match('./index.html')) || (await caches.match('./'));
        if (root) return root;
        throw new Error('offline');
      }
    })());
    return;
  }

  // Всё остальное — из кэша сразу, обновление в фоне.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      // Прозрачные (opaque) ответы не кэшируем: их статус не прочитать,
      // и в кэш легко попадёт чужая ошибка под видом файла.
      if (res && res.ok && res.type !== 'opaque') {
        const copy = res.clone();   // синхронно, до любого чтения тела
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});

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
