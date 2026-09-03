// Очистка фактического трека машины. Чистый модуль: без DOM, без сети.
//
// Зачем. Трек приходит из Wialon точками и служит двум разным целям: он
// рисуется на карте и из него считается fact_km, а fact_km уходит в
// себестоимость выезда и в одометр машины. То есть ошибка приёмника —
// это не кривая линия на картинке, это неверная маржа и сдвинутый срок ТО.
//
// Три разные поломки, которые нельзя лечить одним правилом:
//
//   1. ПРОПАЛА СВЯЗЬ. Точек нет полчаса. Машина всё это время ехала.
//      Прямая между последней и первой новой ЗАНИЖАЕТ пробег: по дорогам
//      всегда длиннее, чем по прямой (на наших маршрутах — на 30–45%).
//      Лечится не выбрасыванием, а достройкой: маршрут по дорогам вместо
//      прямой. Но достроенный километр — НЕ измеренный, и складывать их
//      в одно число молча нельзя.
//
//   2. ТЕЛЕПОРТ. Приёмник выдал точку за сотни километров и вернулся.
//      Прямая туда-обратно ЗАВЫШАЕТ пробег на две длины выброса.
//      Лечится выбрасыванием — но выбрасывать надо не точку, а СЕРИЮ:
//      телепорт бывает продолжительным, и тогда середина блока согласована
//      сама с собой (машина «едет» по чужой стране размеренно), а невозможны
//      только вход в блок и выход из него. Правило «точка-выброс» такую
//      серию не видит вовсе.
//
//   3. ДРОЖАНИЕ НА СТОЯНКЕ. Машина стоит, точки прыгают в радиусе 20–50 м.
//      За ночь набегает «пробег», которого не было. В деньгах это часто
//      больше телепорта, потому что случается каждую смену, а не раз в год.
//
// Модуль отвечает на вопрос «сколько машина проехала на самом деле» и
// честно разделяет ответ на измеренное и на дыры, которые кто-то другой
// (ORS) может достроить.

// Расстояние берём своей гаверсинусной формулой, а не turf. Две причины:
// её считают тысячи раз на выезд, и её однажды придётся повторить на
// сервере слово в слово — гаверсинус повторяется, реализация чужой
// библиотеки нет.
export function haversineKm(a, b) {
  const R = 6371.0088, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const TRACK_DEFAULTS = {
  // Выше этого — не грузовик с краном, а ошибка приёмника. Порог намеренно
  // щедрый: лучше пропустить один выброс, чем вырезать реальный обгон.
  maxSpeedKmh: 140,
  // Крюк через точку длиннее прямой во столько раз — и при этом не короче
  // spikeMinKm. Без второго условия под правило попадал бы каждый поворот
  // во дворе, где «крюк» втрое длиннее прямой, но весь он — сто метров.
  spikeRatio: 3,
  spikeMinKm: 2,
  // Потолок для серии-острова: больше половины трека телепортом не
  // объявляем ни при каких признаках. Если «ошибка» — это большинство,
  // то ошибаемся, скорее всего, мы.
  maxIslandShare: 0.5,
  // Смещение меньше — стояние, а не движение.
  jitterM: 30,
  // Достройка разрыва. Короткую дыру достраиваем прямой: на пяти километрах
  // прямая отличается от дороги на сотни метров, и запрос к ORS за такой
  // точностью не окупается. Длинную — маршрутом по дорогам: там прямая
  // занижает уже на километры.
  orsMinKm: 5,
  // Потолок запросов на выезд. Сломанный трекер с полусотней разрывов
  // иначе выест квоту за один выезд. Берём самые длинные — в них и сидит
  // почти вся ошибка.
  maxOrsCalls: 20,
  // Разрыв — это тишина, НЕОБЫЧНАЯ ДЛЯ ЭТОГО ТРЕКА. Абсолютный порог тут
  // не работает: один трекер шлёт раз в минуту, другой раз в десять, и
  // пять минут для первого — пропажа связи, а для второго — норма.
  // Поэтому берём медианный интервал самого трека и умножаем: три
  // пропущенных такта подряд уже не объяснить редкой телеметрией.
  // gapMinutes остаётся нижней границей — чтобы на секундном трекере
  // разрывом не считалась каждая заминка.
  //
  // Одного расстояния тут мало: на трассе точки и так в двух километрах
  // друг от друга, но за минуту машина никуда свернуть не успела, и
  // прямая между ними — почти дорога. Ошибку даёт не расстояние само по
  // себе, а ВРЕМЯ, за которое путь мог оказаться каким угодно.
  gapFactor: 3,
  gapMinutes: 5,
  // ...и точки разъехались дальше этого. Иначе машина просто стояла
  // с выключенным зажиганием, и достраивать там нечего.
  gapMinKm: 0.3
};

function ts(p) { const t = +new Date(p.ts); return isFinite(t) ? t : NaN; }

// Медиана интервалов между точками — «штатный такт» этого трекера.
function medianStepMs(pts) {
  if (pts.length < 3) return 0;
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(pts[i].t - pts[i - 1].t);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

// Порядок и дубли. Приёмник иногда досылает пакеты задним числом, и
// неупорядоченный трек ломает всё остальное: скорость между «соседями»
// получается отрицательной по времени.
function sane(points) {
  return (points || [])
    .filter(p => p && p.lat != null && p.lng != null && isFinite(ts(p)))
    .map(p => ({ lat: +p.lat, lng: +p.lng, ts: p.ts, t: ts(p), status: p.status || null }))
    .sort((a, b) => a.t - b.t)
    .filter((p, i, arr) => i === 0 || p.t > arr[i - 1].t);
}

// Длинный телепорт. Режем трек на серии по невозможным переходам и
// смотрим на серии как на точки: серия-«остров», в которую нельзя было
// въехать и из которой нельзя было выехать, а путь через неё резко длиннее
// пути мимо неё, — это блок ошибочных координат целиком.
//
// Разница с правилом для одиночной точки принципиальная: там мы смотрим на
// соседей точки, здесь — на соседей ЦЕЛОЙ серии, и её внутренняя
// согласованность (а телепорт согласован: координаты плывут ровно) нам
// больше не мешает.
function runsByImpossible(pts, o, gapMs) {
  const runs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dt = b.t - a.t;
    const impossible = dt > 0 && dt < gapMs &&
      (haversineKm(a, b) / (dt / 3600000)) > o.maxSpeedKmh;
    if (impossible) runs.push([b]); else runs[runs.length - 1].push(b);
  }
  return runs;
}
function runLenKm(run) {
  let s = 0; for (let i = 1; i < run.length; i++) s += haversineKm(run[i - 1], run[i]);
  return s;
}
function dropIslands(pts, o, gapMs) {
  if (pts.length < 3) return { pts, dropped: [] };
  const runs = runsByImpossible(pts, o, gapMs);
  if (runs.length < 3) return { pts, dropped: [] };   // нужен сосед с обеих сторон
  const keep = [runs[0]], dropped = [];
  for (let i = 1; i < runs.length - 1; i++) {
    const run = runs[i];
    const prev = keep[keep.length - 1], next = runs[i + 1];
    const a = prev[prev.length - 1], c = next[0];
    const detour = haversineKm(a, run[0]) + runLenKm(run) + haversineKm(run[run.length - 1], c);
    const direct = haversineKm(a, c);
    // Остров должен быть меньше того, что его окружает: свидетельств
    // «машина была здесь» с двух сторон больше, чем свидетельств «машина
    // была там». Доля от всего трека — только верхняя граница.
    const smaller = run.length < prev.length + next.length;
    const share = run.length / pts.length;
    if (smaller && share <= o.maxIslandShare && detour > o.spikeRatio * direct + o.spikeMinKm) {
      run.forEach(p => dropped.push(Object.assign({ why: 'телепорт, ' + run.length + ' точ.' }, p)));
    } else keep.push(run);
  }
  keep.push(runs[runs.length - 1]);
  return { pts: [].concat.apply([], keep), dropped };
}

// Выбросы. Точка считается выбросом, когда путь через неё резко длиннее
// пути мимо неё. Проход повторяется, пока что-то выбрасывается: два
// выброса подряд прикрывают друг друга и с одного прохода не ловятся.
function dropSpikes(pts, o) {
  let cur = pts, dropped = [];
  for (let pass = 0; pass < 3; pass++) {
    if (cur.length < 3) break;
    const keep = [cur[0]];
    const out = [];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = keep[keep.length - 1], b = cur[i], c = cur[i + 1];
      const detour = haversineKm(a, b) + haversineKm(b, c);
      const direct = haversineKm(a, c);
      if (detour > o.spikeRatio * direct + o.spikeMinKm) out.push(Object.assign({ why: 'выброс' }, b));
      else keep.push(b);
    }
    keep.push(cur[cur.length - 1]);
    dropped = dropped.concat(out);
    if (!out.length) { cur = keep; break; }
    cur = keep;
  }
  return { pts: cur, dropped };
}

// Скорость. Считается только на коротких промежутках: после получаса
// тишины расстояние ни о какой скорости не говорит — это разрыв, и его
// разбирает другое правило.
function dropFast(pts, o, gapMs) {
  if (pts.length < 2) return { pts, dropped: [] };
  const keep = [pts[0]], dropped = [];
  for (let i = 1; i < pts.length; i++) {
    const a = keep[keep.length - 1], b = pts[i];
    const dt = b.t - a.t;
    if (dt > 0 && dt < gapMs) {
      const v = haversineKm(a, b) / (dt / 3600000);
      if (v > o.maxSpeedKmh) { dropped.push(Object.assign({ why: 'скорость ' + Math.round(v) + ' км/ч' }, b)); continue; }
    }
    keep.push(b);
  }
  return { pts: keep, dropped };
}

// Главная функция. Возвращает очищенный трек, выброшенные точки, список
// разрывов и два РАЗНЫХ километража.
export function cleanTrack(points, opts) {
  const o = Object.assign({}, TRACK_DEFAULTS, opts || {});
  const raw = sane(points);
  const rawKm = (() => { let s = 0; for (let i = 1; i < raw.length; i++) s += haversineKm(raw[i - 1], raw[i]); return s; })();

  // Порог разрыва считаем ОДИН раз по сырому треку и дальше пользуемся им
  // везде: правило скорости и правило разрыва должны проводить границу
  // «долгое молчание» в одном и том же месте, иначе одна и та же пара
  // точек окажется и выбросом, и разрывом.
  const stepMs = medianStepMs(raw);
  const gapMs = Math.max(o.gapMinutes * 60000, o.gapFactor * stepMs);

  // Порядок важен: сначала серии (длинный телепорт), потом одиночные
  // выбросы, потом невозможная скорость. Наоборот — правило скорости
  // срезало бы только вход в телепорт, а сам блок оставило.
  const isl = dropIslands(raw, o, gapMs);
  const a = dropSpikes(isl.pts, o);
  const b = dropFast(a.pts, o, gapMs);
  const pts = b.pts;
  const dropped = isl.dropped.concat(a.dropped, b.dropped);

  // Дрожание и разрывы — одним проходом: и то и другое про пару соседей.
  let measuredKm = 0, jitterKm = 0;
  const gaps = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const d = haversineKm(p, q), dt = q.t - p.t;
    if (dt >= gapMs && d >= o.gapMinKm) {
      // Разрыв: прямую между краями в пробег НЕ кладём. Она занижена,
      // и подменять ею факт — то же самое, что придумать цифру.
      gaps.push({ from: p.ts, to: q.ts, minutes: Math.round(dt / 60000), straightKm: d, fromPt: { lat: p.lat, lng: p.lng }, toPt: { lat: q.lat, lng: q.lng } });
      continue;
    }
    if (d * 1000 < o.jitterM) { jitterKm += d; continue; }
    measuredKm += d;
  }

  return {
    points: pts,          // для рисования
    dropped,              // что и почему выброшено
    gaps,                 // дыры, которые может достроить ORS
    measuredKm,           // проехано по точкам, которым мы верим
    jitterKm,             // «пробег» стоящей машины — не считается
    straightGapKm: gaps.reduce((s, g) => s + g.straightKm, 0),
    stepMinutes: stepMs / 60000,        // штатный такт трекера, для подписи
    gapAfterMinutes: gapMs / 60000,     // с какого молчания считали разрывом
    rawKm,                // как считалось раньше: всё подряд по прямым
    rawCount: raw.length,
    keptCount: pts.length
  };
}

// Чем достраивать каждый разрыв.
//
// Короткая дыра — прямой: на пяти километрах прямая отличается от дороги
// на сотни метров, и внешний запрос за такой точностью не окупается.
// Длинная — маршрутом по дорогам: там прямая занижает уже на километры,
// а это прямо себестоимость выезда.
//
// Дыры, оставшиеся после вырезанного телепорта, почти всегда попадают
// в первую группу: машина-то никуда не улетала, её края рядом.
//
// Потолок запросов расходуем на самые длинные разрывы: в них сидит почти
// вся ошибка, а остальные честно помечаем прямой.
export function planGapFills(clean, opts) {
  const o = Object.assign({}, TRACK_DEFAULTS, opts || {});
  const order = clean.gaps.map((g, i) => ({ g, i }))
    .sort((x, y) => y.g.straightKm - x.g.straightKm);
  const byRoute = new Set();
  order.forEach(({ g, i }) => {
    if (g.straightKm >= o.orsMinKm && byRoute.size < o.maxOrsCalls) byRoute.add(i);
  });
  return clean.gaps.map((g, i) => Object.assign({}, g, {
    fill: byRoute.has(i) ? 'ors' : 'straight',
    // Почему прямой: она короткая или запросы кончились. Разница важна —
    // в первом случае цифра точна, во втором занижена.
    why: byRoute.has(i) ? null
       : (g.straightKm < o.orsMinKm ? 'короткий' : 'сверх лимита запросов')
  }));
}

// Итоговый пробег. routeKm — километры, посчитанные ORS, по ключу разрыва
// (g.from). Чего нет — берётся прямой.
export function trackTotalKm(clean, routeKm, opts) {
  const plan = planGapFills(clean, opts);
  const got = routeKm || {};
  let byRoute = 0, byStraight = 0, waiting = 0;
  plan.forEach(g => {
    const km = got[g.from];
    if (km != null) { byRoute += +km; return; }
    byStraight += g.straightKm;
    if (g.fill === 'ors') waiting++;      // маршрут ещё не посчитан
  });
  return {
    km: clean.measuredKm + byRoute + byStraight,
    measuredKm: clean.measuredKm,
    routeKm: byRoute,           // достроено по дорогам
    straightKm: byStraight,     // достроено прямой
    gaps: plan.length,
    // Сколько разрывов заслуживали маршрута, но остались прямой. Пока это
    // число не ноль, итог ЗАНИЖЕН, и говорить «факт» про него нельзя.
    pendingRoutes: waiting
  };
}

// ============================================================================
// ПРОВЕРЕННЫЙ ПРОХОД: круг бесплатно, дороги по требованию
// ============================================================================
//
// cleanTrack выше — бесплатный разбор: он работает без единого внешнего
// вызова и потому годится для мгновенной отрисовки. Этот проход — уточнение
// для момента, когда выезд подтверждают: тогда доступен ORS, и можно
// спросить не «мог ли доехать по прямой на предельной скорости», а «мог ли
// доехать по дорогам».
//
// Почему проверяем ВСЕ выезды, а не только подозрительные. Когда аномалий
// нет, проход стоит один обход массива и ни одного запроса: каждая точка
// подтверждается кругом от предыдущей, круг считается на месте. Ворота перед
// таким расчётом экономили бы ноль.
//
// Круг и дороги — не два разных правила, а грубый и точный вариант одного.
// По дорогам нельзя обогнать прямую на предельной скорости, поэтому всё,
// что отверг круг, отвергли бы и дороги, и спрашивать про такие точки
// незачем. Наоборот — нужно: круг растёт вместе с Δt и через час перестаёт
// что-либо значить.
//
// Сам вопрос «доехал бы?» модуль не решает: он вызывает reach() и не знает,
// чем тот отвечает — маршрутом, изохроной или таблицей. Здесь только
// правило, когда спрашивать и что делать с ответом.

export const RESOLVE_DEFAULTS = {
  // Физически невозможная скорость. Выше — не «необычно для грузовика»,
  // а «дорожная техника так не ездит». Порог отбраковки должен быть
  // именно таким: ошибиться здесь дороже, чем пропустить.
  hardSpeedKmh: 300,
  // После отказа кандидата следующего берём не подряд, а вдвое дальше по
  // времени. Фиксированный шаг плох с обоих концов: на коротком сбое он
  // выбрасывает непроверенные хорошие точки, на длинном всё равно стоит
  // десяток запросов. Удвоение дёшево там и там.
  backoff: 2,
  // Потолок проверок на выезд.
  maxChecks: 12,
  // Сколько выезда мы готовы потерять молча — по ВРЕМЕНИ без достоверного
  // положения и по доле выброшенных точек. Больше половины — считать нечего,
  // и честнее попросить две цифры с одометра, чем выдать придуманное число.
  maxDropShare: 0.5
};

// points  — сырые точки; opts — пороги;
// reach(a, b, ms) — «мог ли доехать из a в b за ms по дорогам»:
//   true  — да, false — нет, null — проверить не удалось (нет сети, точка
//   вне дорожной сети, кончилась квота). null не равно false: неизвестность
//   не повод удалять точку.
//   Вместо true/false можно вернуть {ok, km, line}: km — расстояние ПО
//   ДОРОГАМ от a до b, line — сам маршрут. Тот, кто отвечает на вопрос
//   маршрутом, уже знает и то и другое, и выбрасывать это глупо: ровно им
//   потом достраивается разрыв, который аномалия оставила в треке, и ровно
//   он рисуется на карте. Второй раз про тот же отрезок не спрашиваем.
//   Такие ответы копятся в bridges.
export async function resolveAnomalies(points, opts, reach) {
  const o = Object.assign({}, TRACK_DEFAULTS, RESOLVE_DEFAULTS, opts || {});
  const pts = sane(points);
  if (pts.length < 2) return { points: pts, dropped: [], checks: 0, verdict: 'мало точек' };

  const keep = [pts[0]];
  const dropped = [];
  const bridges = [];
  let checks = 0, weak = 0;
  let i = 1;
  let minDt = 0;          // порог отката: кандидатов ближе по времени пропускаем
  // Пока трек не рвался, круга достаточно: соседние точки подтверждают друг
  // друга даром, и спокойный выезд не стоит НИ ОДНОГО внешнего запроса —
  // проход по нему линейный и заканчивается словом «чисто». Изохрону зовём
  // только на выходе из сбоя: там круг успел разрастись до сотен километров
  // и перестал что-либо значить, а вернуть в трек можно только точку,
  // до которой машина реально могла доехать по дорогам.
  let broken = false;

  while (i < pts.length) {
    const a = keep[keep.length - 1], p = pts[i];
    const dt = p.t - a.t;
    const d = haversineKm(a, p);

    // 1. Круг. Бесплатно и решает почти всё.
    if (dt <= 0 || d > (o.hardSpeedKmh * dt) / 3600000) {
      dropped.push(Object.assign({ why: 'вне круга ' + Math.round(d) + ' км за ' + Math.round(dt / 60000) + ' мин' }, p));
      broken = true;
      i++; continue;
    }
    // 2. Сбоя не было — точка подтверждена соседством, и на этом всё.
    if (!broken) { keep.push(p); i++; continue; }
    // 3. Откат: этот кандидат слишком близко по времени к отвергнутому.
    if (dt < minDt) {
      dropped.push(Object.assign({ why: 'пропущен по откату' }, p));
      i++; continue;
    }
    // 4. Дороги — только для кандидата на возвращение в трек.
    let ok = true, roadKm = null, roadLine = null;
    if (reach && checks < o.maxChecks) {
      checks++;
      const r = await reach(a, p, dt);
      const v = (r && typeof r === 'object') ? r.ok : r;
      if (r && typeof r === 'object' && isFinite(r.km)) { roadKm = +r.km; roadLine = r.line || null; }
      if (v === false) ok = false;
      else if (v == null) weak++;          // не проверили — верим кругу, но помечаем
    } else {
      weak++;                              // проверять нечем: судим по кругу
    }
    if (ok) {
      keep.push(p);
      // Мост через вырезанное: от последней достоверной точки до этой машина
      // ехала, а трека нет. Если проверявший назвал длину по дорогам —
      // запоминаем, второй раз спрашивать то же самое незачем.
      if (roadKm != null) bridges.push({ from: a.ts, to: p.ts, km: roadKm, line: roadLine });
      broken = false;
      minDt = 0;
      i++;
    } else {
      dropped.push(Object.assign({ why: 'по дорогам не доехал бы' }, p));
      minDt = dt * o.backoff;              // следующего кандидата ищем вдвое дальше
      i++;
    }
  }

  // Отложенные: точки, пропущенные откатом. Откат — экономия запросов, а не
  // приговор, и он умеет перескакивать через хорошие точки: трек мог
  // восстановиться раньше, чем истёк удвоенный интервал. Вернуть такую точку
  // можно даром, но НЕ кругом: круг за час разрастается до трёхсот километров
  // и вернул бы вместе с ней соседей отвергнутой аномалии — то есть тихо
  // отменил бы решение, принятое по дорогам. Правильный вопрос к отложенной точке другой:
  // лежит ли она ПО ПУТИ между двумя достоверными. Если крюк через неё почти
  // равен прямой между соседями — лежит; если втрое длиннее — это чужая
  // точка, и её место в мусоре.
  const back = [];
  for (let k = dropped.length - 1; k >= 0; k--) {
    const p = dropped[k];
    if (p.why !== 'пропущен по откату') continue;
    const before = lastBefore(keep, p.t), after = firstAfter(keep, p.t);
    if (!before || !after) continue;
    const direct = haversineKm(before, after);
    const detour = haversineKm(before, p) + haversineKm(p, after);
    if (detour <= o.spikeRatio * direct + o.spikeMinKm) {
      back.push(Object.assign({}, p, { why: 'восстановлена: лежит по пути' }));
      dropped.splice(k, 1);
    }
  }
  if (back.length) {
    keep.push(...back);
    keep.sort((x, y) => x.t - y.t);
  }

  // Итог и защита.
  //
  // Мерить долю выброшенного В КИЛОМЕТРАХ нельзя, хотя соблазн есть: телепорт
  // даёт девяносто девять процентов «пробега», и правило по километрам
  // осудило бы ровно тот выезд, который мы только что починили. Считать
  // в точках (как договаривались) уже честно, но точка — не единица ущерба:
  // ущерб в том, СКОЛЬКО ВРЕМЕНИ выезда осталось без достоверного положения.
  // Одна дурная точка среди шестисот — это две минуты из восьми часов, и
  // километраж от этого не портится. Приёмник, врущий полдня, — это полдня
  // без трека, и тут считать нечего.
  const totalMs = pts[pts.length - 1].t - pts[0].t;
  let unknownMs = 0;
  for (let k = 1; k < keep.length; k++) {
    const gapHasDrop = dropped.some(x => x.t > keep[k - 1].t && x.t < keep[k].t);
    if (gapHasDrop) unknownMs += keep[k].t - keep[k - 1].t;
  }
  const unknownShare = totalMs > 0 ? unknownMs / totalMs : 0;
  const droppedKm = Math.max(0, pathKm(pts) - pathKm(keep));   // сколько мусора вырезано
  const keptKm = pathKm(keep);

  let verdict = 'чисто';
  if (dropped.length) verdict = 'аномалии вырезаны';
  if (unknownShare > o.maxDropShare || dropped.length > pts.length * o.maxDropShare) {
    verdict = 'трек недостоверен: снять пробег с одометра машины';
  } else if (weak) verdict = 'аномалии вырезаны, часть проверок не прошла (судили по кругу)';

  return {
    points: keep, dropped, bridges, checks, weakChecks: weak,
    droppedKm, keptKm, unknownMs, unknownShare, verdict,
    restored: back.length
  };
}

function pathKm(arr) {
  let s = 0; for (let i = 1; i < arr.length; i++) s += haversineKm(arr[i - 1], arr[i]);
  return s;
}
function lastBefore(arr, t) { let r = null; for (const p of arr) { if (p.t < t) r = p; else break; } return r; }
function firstAfter(arr, t) { for (const p of arr) if (p.t > t) return p; return null; }
