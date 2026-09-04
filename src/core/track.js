// ============================================================================
// ФАКТИЧЕСКИЙ ТРЕК ВЫЕЗДА
// ============================================================================
// Один проход, одно правило, никаких особых случаев.
//
// Задача: из сырых точек трекера получить пробег, которому можно верить, и
// показать на карте ровно то, из чего он сложен.
//
// ПОЧЕМУ ЗДЕСЬ НЕТ ПОНЯТИЯ «ПРОПАЛА СВЯЗЬ». Прошлая версия его имела и от
// этого разваливалась. Она считала медианный такт трекера, объявляла
// молчание длиннее трёх тактов разрывом, разрывы достраивала отдельным
// механизмом со своим лимитом запросов, а внутри разрывов не проверяла
// скорость — «там разрыв, а не выброс». В итоге приёмник, отдавший связный
// кусок трека в Лиме после долгого молчания, проходил все проверки: для них
// это был обычный разрыв, и он честно достраивался прямой через Атлантику.
//
// Молчание не нуждается в особом обращении. Оно и так учтено: разница во
// времени между точками растёт, а вместе с ней растёт то, что машина успела
// бы проехать. Правило одно и то же для соседних точек и для точек через
// два часа тишины — меняются только числа, которые в него подставляются.
//
// ДВА ГЕЙТА.
//   1. Скорость по прямой между последней достоверной точкой и кандидатом.
//      Бесплатно, отсекает почти всё. Выше hardSpeedKmh — дорожная техника
//      так не ездит, точка чужая.
//   2. Дорога. Спрашиваем у маршрутизатора, сколько ехать от последней
//      достоверной до кандидата, и сравниваем с тем временем, которое
//      реально было: время_маршрута / slack ≤ фактическое. Второй гейт
//      строже первого — прямую по дорогам не обогнать, — и он же приносит
//      настоящее расстояние по дорогам вместо хорды.
//
// ОПОРА БЕРЁТСЯ ИЗ ВЫЕЗДА, А НЕ ИЗ ТРЕКА. Это главное. Трижды подряд
// ошибка была в одном: первая точка трека принималась за достоверную без
// всяких оснований. Но выезд знает, откуда он начался и где закончился —
// это стартовая и финишная остановки маршрута. Если трек начинается не у
// старта, первой достоверной становится сам старт, а первая точка трека
// идёт на общих основаниях в кандидаты.
// ============================================================================

export const TRACK_DEFAULTS = {
  // Первый гейт: физически невозможная скорость по прямой.
  hardSpeedKmh: 300,
  // Второй гейт: запас времени. Маршрутизатор считает по разрешённым
  // скоростям и без пробок, техника с краном едет медленнее, а не быстрее.
  // Значит запас нужен в сторону «не удалять».
  slack: 1.5,
  // Ближе этого прямая от дороги почти не отличается — запрос не окупается.
  // Дальше — считаем по дорогам, независимо от того, была связь или нет.
  orsMinKm: 5,
  // Потолок запросов на один выезд.
  maxOrsCalls: 40,
  // Дрожание стоящей машины. Шевеление в двадцати метрах не пробег.
  jitterM: 30,
  // Круг вокруг стартовой и финишной точки выезда.
  anchorRadiusKm: 5,
  // Во сколько машина вышла из депо, если трек начался не там.
  dayStartHour: 6,
  // Сколько времени выезда можно потерять молча.
  maxDropShare: 0.5
  // Ещё в opts можно передать onStep({i, total, checks}) — его зовут на
  // каждой точке. Проход ходит в сеть и занимает секунды; без обратной
  // связи человек видит замершую кнопку и решает, что сломалось. Модуль
  // при этом ничего не знает про интерфейс: он просто сообщает, где идёт.
};

export function haversineKm(a, b) {
  const R = 6371.0088, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function ts(p) { const t = +new Date(p.ts); return isFinite(t) ? t : NaN; }

// Точки без координат и без времени выбрасываем молча — это не аномалии,
// это мусор в выгрузке. Сортируем по времени и снимаем дубли: две точки
// с одним временем не образуют ни расстояния, ни скорости.
function sane(points) {
  return (points || [])
    .filter(p => p && p.lat != null && p.lng != null && isFinite(ts(p)))
    .map(p => ({ lat: +p.lat, lng: +p.lng, ts: p.ts, t: ts(p), status: p.status || null }))
    .sort((a, b) => a.t - b.t)
    .filter((p, i, arr) => i === 0 || p.t > arr[i - 1].t);
}

function medianStepMs(pts) {
  if (pts.length < 3) return 0;
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(pts[i].t - pts[i - 1].t);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

// Опора у старта: точка выезда со временем «утро того дня». Час местный,
// потому что человек говорит «выехал в шесть», а не «в три по Гринвичу».
//
// Если трек начался ЕЩЁ РАНЬШЕ шести, отодвигаем опору на начало суток.
// Соблазн был поставить её за минуту до первой точки — и это тихо убивало
// бы ранние выезды: круг за минуту равен пяти километрам, первая точка в
// ста километрах его не проходит, вылетает, следующая проверяется с той же
// опоры и вылетает тоже. Полночь того же дня — честнее: мы не знаем, когда
// машина вышла, но знаем, что не раньше начала этих суток.
function morningAnchor(stop, firstT, hour) {
  const d = new Date(firstT);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime();
  const six = day + hour * 3600000;
  const t = six < firstT ? six : day;
  return { lat: +stop.lat, lng: +stop.lng, ts: new Date(t).toISOString(), t, anchor: 'старт выезда' };
}

// points — сырые точки трекера;
// ctx    — { start, finish } — остановки выезда с lat/lng (любая может
//          отсутствовать: тогда опорой служит сам трек);
// reach(a, b, ms) — «сколько ехать по дорогам»: { ok, km, line } или null,
//          если спросить не удалось. null НЕ равно «нет»: неизвестность не
//          повод удалять точку, тогда судим по одной скорости.
export async function measureTrip(points, opts, ctx, reach) {
  const o = Object.assign({}, TRACK_DEFAULTS, opts || {});
  const c = ctx || {};
  const pts = sane(points);
  const empty = {
    points: [], dropped: [], segments: [], km: 0, trackKm: 0, roadKm: 0, lineKm: 0,
    jitterKm: 0, checks: 0, weakChecks: 0, unknownMs: 0, unknownShare: 0,
    dropShare: 0, reasons: {}, verdict: 'трека нет'
  };
  if (!pts.length) return empty;

  const dropped = [], segments = [], keep = [];
  let checks = 0, weak = 0;
  let trackKm = 0, roadKm = 0, lineKm = 0, jitterKm = 0;
  // Подозрение начинается с первой отброшенной точки и снимается, как
  // только очередная снова оказалась достоверной, — ровно как в разборе:
  // «со всех точек после точки 7 алгоритм снимает метку suspect». Ещё оно
  // включается на старте, если опорой служит не сам трек (см. ниже).
  let suspect = false;

  // ── Опора ─────────────────────────────────────────────────────────────
  //
  // Когда опорой становится сам старт выезда, первая точка трека попадает
  // под подозрение СРАЗУ, ещё до всякой аномалии. Причина в том, что время
  // отправления мы не знаем — шесть утра это допущение, а не факт. И чем
  // позже очнулся трекер, тем шире окно: у точки в девять вечера от шести
  // утра пятнадцать часов, а круг за пятнадцать часов — четыре с половиной
  // тысячи километров, то есть никакой не круг. Проверять такую точку одной
  // скоростью бессмысленно; решить может только дорога — она отвечает не
  // «сколько бы успел», а «сколько на самом деле ехать».
  let i = 0, trusted;
  if (c.start && c.start.lat != null && haversineKm(c.start, pts[0]) > o.anchorRadiusKm) {
    trusted = morningAnchor(c.start, pts[0].t, o.dayStartHour);
    suspect = true;
  } else {
    trusted = pts[0];
    i = 1;
  }
  keep.push(trusted);

  // ── Проход ────────────────────────────────────────────────────────────
  // Кандидат проверяется ВСЕГДА относительно последней достоверной точки.
  // Отброшенная точка опору не двигает — поэтому после аномалии следующие
  // кандидаты сравниваются с той же точкой, пока один не пройдёт оба гейта.
  while (i < pts.length) {
    const p = pts[i];
    const dt = p.t - trusted.t;
    const d = haversineKm(trusted, p);
    i++;
    if (o.onStep) o.onStep({ i, total: pts.length, checks });

    if (dt <= 0) { dropped.push(Object.assign({ why: 'время не идёт вперёд' }, p)); suspect = true; continue; }

    const kmh = d / (dt / 3600000);
    if (kmh > o.hardSpeedKmh) {
      dropped.push(Object.assign({ why: 'скорость ' + Math.round(kmh) + ' км/ч' }, p));
      suspect = true;
      continue;
    }

    // Дрожание стоящей машины: точку принимаем, километры — нет.
    if (d * 1000 < o.jitterM) {
      jitterKm += d;
      keep.push(p); trusted = p; suspect = false;
      continue;
    }

    // Близко — прямая и есть дорога с точностью до сотен метров.
    if (d < o.orsMinKm) {
      trackKm += d;
      segments.push({ kind: 'track', km: d, fromTs: trusted.ts, toTs: p.ts,
        fromPt: { lat: trusted.lat, lng: trusted.lng }, toPt: { lat: p.lat, lng: p.lng },
        minutes: Math.round(dt / 60000) });
      keep.push(p); trusted = p; suspect = false;
      continue;
    }

    // Далеко — спрашиваем дороги. Вопрос один, а ответов из него два:
    // сколько это на самом деле по дороге и мог ли кандидат тут оказаться.
    //
    // ВТОРЫМ ОТВЕТОМ ПОЛЬЗУЕМСЯ НЕ ВСЕГДА. Гейт по дорогам судит только
    // подозреваемого — точку, которая идёт следом за отброшенной. Точка,
    // пришедшая после достоверной и прошедшая по скорости, ни в чём не
    // подозревается, и отбрасывать её за то, что маршрутизатор насчитал
    // на пару минут больше, нельзя: обычная шестикилометровая пара за
    // четыре минуты — это девяносто километров в час, а ORS на том же
    // куске легко скажет семь минут. Строгое сравнение выбросило бы
    // нормальную дорогу. Для неё маршрут — линейка, а не судья.
    let r = null;
    if (reach && checks < o.maxOrsCalls) { checks++; r = await reach(trusted, p, dt); }
    if (suspect && r && r.ok === false) {
      dropped.push(Object.assign({ why: 'по дорогам не доехал бы' }, p));
      continue;                                    // подозрение остаётся
    }
    if (r && isFinite(r.km)) {
      roadKm += r.km;
      segments.push({ kind: 'road', km: r.km, line: r.line || null, fromTs: trusted.ts, toTs: p.ts,
        fromPt: { lat: trusted.lat, lng: trusted.lng }, toPt: { lat: p.lat, lng: p.lng },
        minutes: Math.round(dt / 60000) });
    } else {
      // Спросить не удалось: сети нет, квота кончилась, или это бесплатный
      // показ на карте. Точку принимаем по первому гейту, но расстояние
      // берём по прямой и честно помечаем — оно занижено.
      weak++;
      lineKm += d;
      segments.push({ kind: 'line', km: d, fromTs: trusted.ts, toTs: p.ts,
        fromPt: { lat: trusted.lat, lng: trusted.lng }, toPt: { lat: p.lat, lng: p.lng },
        minutes: Math.round(dt / 60000), why: 'маршрут не строился' });
    }
    keep.push(p); trusted = p; suspect = false;
  }

  // ── Финиш ─────────────────────────────────────────────────────────────
  // Трек часто обрывается, не доехав до депо. Дорога домой была, и её надо
  // посчитать. Проверять тут нечего — выезд закончился там, где закончился,
  // это не гипотеза, а факт из карточки выезда.
  if (c.finish && c.finish.lat != null && keep.length) {
    const last = keep[keep.length - 1];
    const d = haversineKm(last, c.finish);
    if (d > o.anchorRadiusKm) {
      let r = null;
      if (reach && checks < o.maxOrsCalls) { checks++; r = await reach(last, c.finish, null); }
      const fin = { lat: +c.finish.lat, lng: +c.finish.lng, ts: last.ts, t: last.t, anchor: 'финиш выезда' };
      if (r && isFinite(r.km)) {
        roadKm += r.km;
        segments.push({ kind: 'road', km: r.km, line: r.line || null, fromTs: last.ts, toTs: fin.ts,
          fromPt: { lat: last.lat, lng: last.lng }, toPt: { lat: fin.lat, lng: fin.lng },
          minutes: null, why: 'возвращение на финиш' });
      } else {
        weak++;
        lineKm += d;
        segments.push({ kind: 'line', km: d, fromTs: last.ts, toTs: fin.ts,
          fromPt: { lat: last.lat, lng: last.lng }, toPt: { lat: fin.lat, lng: fin.lng },
          minutes: null, why: 'возвращение на финиш, маршрут не строился' });
      }
      keep.push(fin);
    }
  }

  // ── Итог ──────────────────────────────────────────────────────────────
  // Долю потерянного считаем по ВРЕМЕНИ, которое накрывают выброшенные
  // точки, а не по их числу и не по километрам. Километры лгут: телепорт
  // даёт девяносто девять процентов «пробега» и осудил бы ровно тот выезд,
  // который мы только что починили. Точки лгут иначе: одна дурная среди
  // шестисот — это две минуты из восьми часов.
  const step = medianStepMs(pts) || 60000;
  const totalMs = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
  const keptT = new Set(keep.map(p => p.t));
  let unknownMs = 0, from = null, to = null;
  for (const p of pts) {
    if (keptT.has(p.t)) { if (from != null) { unknownMs += (to - from) + step; from = null; } }
    else { if (from == null) from = p.t; to = p.t; }
  }
  if (from != null) unknownMs += (to - from) + step;

  const unknownShare = totalMs > 0 ? unknownMs / totalMs : 0;
  const dropShare = pts.length ? dropped.length / pts.length : 0;
  const km = trackKm + roadKm + lineKm;

  const reasons = {};
  dropped.forEach(x => {
    const key = String(x.why || '').replace(/\s+[\d.]+.*$/, '');
    reasons[key] = (reasons[key] || 0) + 1;
  });

  let verdict = dropped.length ? 'аномалии вырезаны' : 'чисто';
  if (unknownShare > o.maxDropShare || dropShare > o.maxDropShare) {
    // Приговор всегда с цифрами: без них его нельзя ни оспорить, ни
    // проверить, а человека он отправляет лезть под капот за одометром.
    verdict = 'трек недостоверен: снять пробег с одометра машины'
      + ' (приёмник врал ' + Math.round(unknownShare * 100) + '% времени выезда,'
      + ' выброшено ' + dropped.length + ' точек из ' + pts.length + ')';
  } else if (weak) {
    verdict = 'аномалии вырезаны, часть отрезков не построена по дорогам';
  }

  return {
    points: keep, dropped, segments,
    km, trackKm, roadKm, lineKm, jitterKm,
    checks, weakChecks: weak,
    unknownMs, unknownShare, dropShare, reasons, verdict
  };
}
