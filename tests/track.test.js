import { describe, it, expect } from 'vitest';
import { cleanTrack, trackTotalKm, planGapFills, haversineKm, TRACK_DEFAULTS } from '../src/core/track.js';

// Точка на N километров восточнее базовой — так тесты читаются в километрах,
// а не в градусах.
const BASE = { lat: 49.07, lng: 33.42 };
const kmEast = (km) => km / (111.32 * Math.cos(BASE.lat * Math.PI / 180));
// Штатный такт трекера в тестах — минута. Секунды, а не минуты, потому что
// «раз в десять минут» само по себе выглядело бы как непрерывный разрыв.
const at = (km, min, extra) => Object.assign({
  lat: BASE.lat, lng: BASE.lng + kmEast(km),
  ts: new Date(Date.UTC(2026, 8, 2, 8, 0, Math.round((min || 0) * 60))).toISOString()
}, extra || {});

describe('haversineKm', () => {
  it('меряет то, что мы задумали: 10 км на восток', () => {
    expect(haversineKm(at(0, 0), at(10, 0))).toBeCloseTo(10, 1);
  });
  it('нулевое расстояние — ноль, а не NaN', () => {
    expect(haversineKm(BASE, { lat: BASE.lat, lng: BASE.lng })).toBe(0);
  });
});

describe('cleanTrack: порядок и дубли', () => {
  it('переставленные по времени точки сортируются', () => {
    const c = cleanTrack([at(0, 0), at(20, 20), at(10, 10)]);
    expect(c.points.map(p => p.ts)).toEqual([at(0, 0).ts, at(10, 10).ts, at(20, 20).ts]);
    expect(c.measuredKm).toBeCloseTo(20, 0);
  });
  it('точка с тем же временем отбрасывается', () => {
    const c = cleanTrack([at(0, 0), at(5, 5), at(9, 5)]);
    expect(c.rawCount).toBe(2);
  });
  it('точки без координат не роняют расчёт', () => {
    const c = cleanTrack([at(0, 0), { lat: null, lng: null, ts: at(1, 1).ts }, at(10, 10)]);
    expect(c.rawCount).toBe(2);
    expect(isFinite(c.measuredKm)).toBe(true);
  });
});

describe('cleanTrack: телепорт', () => {
  // Едем 0→10→20 км, но между 10 и 20 приёмник выбросил точку за 300 км
  // и вернулся. По сырым точкам это +600 км.
  const track = [at(0, 0), at(10, 10), at(300, 11), at(20, 20)];

  it('сырой пробег завышен выбросом', () => {
    const c = cleanTrack(track);
    expect(c.rawKm).toBeGreaterThan(500);
  });
  it('выброс вырезан, пробег стал настоящим', () => {
    const c = cleanTrack(track);
    expect(c.measuredKm).toBeCloseTo(20, 0);
    expect(c.dropped.length).toBe(1);
    expect(c.dropped[0].why).toMatch(/выброс|скорость|телепорт/);
  });
  it('два выброса подряд тоже ловятся', () => {
    const c = cleanTrack([at(0, 0), at(10, 10), at(300, 11), at(400, 12), at(20, 20)]);
    expect(c.measuredKm).toBeCloseTo(20, 0);
    expect(c.dropped.length).toBe(2);
  });
  it('настоящий поворот во дворе выбросом не считается', () => {
    // Крюк втрое длиннее прямой, но весь он 300 метров.
    const c = cleanTrack([at(0, 0), at(0.3, 1), at(0.1, 2)]);
    expect(c.dropped.length).toBe(0);
  });
});

describe('cleanTrack: невозможная скорость', () => {
  it('700 км/ч между соседними точками — ошибка приёмника', () => {
    const c = cleanTrack([at(0, 0), at(10, 10), at(70, 15), at(75, 20)]);
    expect(c.dropped.length).toBeGreaterThan(0);
  });
  it('после долгой тишины скорость не считается: это разрыв, а не выброс', () => {
    // 120 км за 40 минут дали бы 180 км/ч, но точек между ними просто нет.
    const c = cleanTrack([at(0, 0), at(120, 40)]);
    expect(c.dropped.length).toBe(0);
    expect(c.gaps.length).toBe(1);
    expect(c.measuredKm).toBe(0);
  });
});

describe('cleanTrack: дрожание на стоянке', () => {
  it('шевеление в двадцати метрах в пробег не идёт', () => {
    const pts = [at(0, 0)];
    for (let i = 1; i <= 60; i++) pts.push(at(i % 2 ? 0.02 : 0, i));   // 20 м туда-сюда
    const c = cleanTrack(pts);
    expect(c.measuredKm).toBe(0);
    expect(c.jitterKm).toBeGreaterThan(1);       // по сырым это больше километра
  });
  it('а настоящее движение в пробег идёт', () => {
    const c = cleanTrack([at(0, 0), at(0.5, 1), at(1, 2)]);
    expect(c.measuredKm).toBeCloseTo(1, 1);
    expect(c.jitterKm).toBe(0);
  });
});

describe('cleanTrack: разрывы', () => {
  const track = [at(0, 0), at(10, 10), at(60, 45), at(65, 50)];

  it('разрыв найден и описан', () => {
    const c = cleanTrack(track);
    expect(c.gaps.length).toBe(1);
    expect(c.gaps[0].minutes).toBe(35);
    expect(c.gaps[0].straightKm).toBeCloseTo(50, 0);
  });
  it('прямая через разрыв в измеренное НЕ попадает', () => {
    const c = cleanTrack(track);
    expect(c.measuredKm).toBeCloseTo(15, 0);      // 10 + 5, без пятидесяти
    expect(c.straightGapKm).toBeCloseTo(50, 0);
  });
  it('стоянка с выключенным зажиганием разрывом не считается', () => {
    // Час тишины, но машина осталась на месте — достраивать нечего.
    const c = cleanTrack([at(0, 0), at(0.05, 60), at(1, 65)]);
    expect(c.gaps.length).toBe(0);
  });
});

describe('длинный телепорт', () => {
  // Двадцать минут приёмник «везёт» машину по чужой стране размеренно,
  // потом возвращается. Середина блока согласована сама с собой — правило
  // одиночного выброса её не видит.
  const track = [];
  for (let i = 0; i <= 10; i++) track.push(at(i, i));            // 10 км нормально
  for (let i = 0; i < 20; i++) track.push(at(400 + i, 11 + i));  // блок за 400 км
  for (let i = 0; i <= 10; i++) track.push(at(11 + i, 31 + i));  // вернулись

  it('серия вырезана целиком, а не по краям', () => {
    const c = cleanTrack(track);
    expect(c.dropped.length).toBe(20);
    expect(c.dropped[0].why).toMatch(/телепорт/);
  });
  it('пробег стал настоящим', () => {
    const c = cleanTrack(track);
    expect(c.measuredKm).toBeCloseTo(20, 0);      // 10 до и 10 после, без восьмисот
    expect(c.rawKm).toBeGreaterThan(700);
  });
  it('дыра от вырезанного телепорта короткая — достраивается прямой, без запроса', () => {
    const c = cleanTrack(track);
    expect(c.gaps.length).toBe(1);
    expect(c.gaps[0].straightKm).toBeLessThan(5);
    const plan = planGapFills(c);
    expect(plan[0].fill).toBe('straight');
    // Итог: измеренные 20 плюс километр дыры = настоящие 21.
    expect(trackTotalKm(c, null).km).toBeCloseTo(21, 0);
    expect(trackTotalKm(c, null).pendingRoutes).toBe(0);
  });
  it('половину трека телепортом не объявляем', () => {
    // Тот же блок, но нормальных точек вокруг мало: кто тут ошибка —
    // уже не очевидно, и молча выбрасывать большинство нельзя.
    const few = [at(0, 0), at(1, 1)];
    for (let i = 0; i < 20; i++) few.push(at(400 + i, 2 + i));
    few.push(at(2, 30), at(3, 31));
    const c = cleanTrack(few);
    expect(c.dropped.length).toBeLessThan(20);
  });
});

// Реалистичный трек: минутный такт, а в заданных местах — молчание.
// На трёх точках медиана интервала бессмысленна, и «разрыв» не находится
// вовсе — не потому, что правило плохое, а потому, что такта ещё нет.
function trackWithGaps(gapsKm, silenceMin) {
  const pts = []; let km = 0, min = 0;
  for (let g = 0; g <= gapsKm.length; g++) {
    for (let i = 0; i < 6; i++) { pts.push(at(km, min)); km += 0.8; min += 1; }
    if (g < gapsKm.length) { km += gapsKm[g]; min += silenceMin; }
  }
  return pts;
}

describe('чем достраивать разрыв', () => {
  const short = cleanTrack(trackWithGaps([2], 20));
  const long = cleanTrack(trackWithGaps([50], 40));

  it('короткую дыру достраиваем прямой — запрос не окупается', () => {
    const plan = planGapFills(short);
    expect(plan.length).toBe(1);
    expect(plan[0].fill).toBe('straight');
    expect(plan[0].why).toBe('короткий');
  });
  it('длинную — маршрутом по дорогам', () => {
    const plan = planGapFills(long);
    expect(plan[0].fill).toBe('ors');
  });
  it('порог вынесен наружу', () => {
    expect(planGapFills(long, { orsMinKm: 100 })[0].fill).toBe('straight');
    expect(planGapFills(long, { orsMinKm: 100 })[0].why).toBe('короткий');
  });
  it('потолок запросов тратится на самые длинные', () => {
    const plan = planGapFills(cleanTrack(trackWithGaps([30, 30, 30, 30, 30], 40)), { maxOrsCalls: 2 });
    expect(plan.filter(g => g.fill === 'ors').length).toBe(2);
    expect(plan.filter(g => g.why === 'сверх лимита запросов').length).toBe(3);
  });
});

describe('trackTotalKm', () => {
  const c = cleanTrack([at(0, 0), at(10, 10), at(60, 45), at(65, 50)]);

  it('без маршрутов берёт прямую и говорит, что чего-то ждёт', () => {
    const t = trackTotalKm(c, null);
    expect(t.km).toBeCloseTo(65, 0);
    expect(t.pendingRoutes).toBe(1);
  });
  it('с маршрутом берёт его и больше ничего не ждёт', () => {
    const t = trackTotalKm(c, { [c.gaps[0].from]: 71 });   // ORS: 71 км вместо 50
    expect(t.km).toBeCloseTo(15 + 71, 0);
    expect(t.routeKm).toBe(71);
    expect(t.pendingRoutes).toBe(0);
  });
  it('короткая дыра ничего не ждёт: прямая тут и есть ответ', () => {
    const s2 = cleanTrack(trackWithGaps([2], 20));
    const t = trackTotalKm(s2, null);
    expect(t.pendingRoutes).toBe(0);
    expect(t.straightKm).toBeGreaterThan(0);
  });
  it('трек без разрывов ничего не достраивает', () => {
    const whole = cleanTrack([at(0, 0), at(5, 5), at(10, 10)]);
    const t = trackTotalKm(whole, null);
    expect(t.gaps).toBe(0);
    expect(t.km).toBeCloseTo(whole.measuredKm, 6);
  });
});

describe('пороги вынесены наружу', () => {
  it('щедрый порог скорости пропускает то, что строгий режет', () => {
    const track = [at(0, 0), at(10, 10), at(70, 15), at(75, 20)];
    const strict = cleanTrack(track, { maxSpeedKmh: 90 });
    const loose = cleanTrack(track, { maxSpeedKmh: 1000, spikeRatio: 1000, spikeMinKm: 1000 });
    expect(strict.dropped.length).toBeGreaterThan(loose.dropped.length);
  });
  it('значения по умолчанию заданы явно, а не спрятаны в коде', () => {
    expect(TRACK_DEFAULTS.maxSpeedKmh).toBeGreaterThan(0);
    expect(TRACK_DEFAULTS.jitterM).toBeGreaterThan(0);
  });
});

// ── resolveAnomalies ────────────────────────────────────────────────────────
// Проверка достоверности трека при закрытии выезда. Круг (300 км/ч по прямой)
// — грубая форма правила, дороги — точная. Вопрос к дорогам стоит внешнего
// запроса, поэтому его задают только там, где круг уже бесполезен.
import { resolveAnomalies, RESOLVE_DEFAULTS } from '../src/core/track.js';

// Счётчик обращений к изохроне: ровно то, за что мы платим.
function spy(answer) {
  const calls = [];
  const fn = async (a, b, dt) => { calls.push({ a, b, dt }); return typeof answer === 'function' ? answer(a, b, dt) : answer; };
  fn.calls = calls;
  return fn;
}

describe('resolveAnomalies: спокойный выезд', () => {
  // Минутный такт, километр в минуту — 60 км/ч.
  const calm = []; for (let i = 0; i <= 120; i++) calm.push(at(i, i));

  it('не стоит ни одного запроса', async () => {
    const reach = spy(true);
    const r = await resolveAnomalies(calm, null, reach);
    expect(reach.calls.length).toBe(0);
    expect(r.checks).toBe(0);
  });
  it('все точки подтверждены, вердикт «чисто»', async () => {
    const r = await resolveAnomalies(calm, null, spy(true));
    expect(r.points.length).toBe(calm.length);
    expect(r.dropped.length).toBe(0);
    expect(r.verdict).toBe('чисто');
    expect(r.unknownShare).toBe(0);
  });
  it('без изохроны вообще работает так же', async () => {
    const r = await resolveAnomalies(calm, null, null);
    expect(r.dropped.length).toBe(0);
    expect(r.weakChecks).toBe(0);
  });
});

describe('resolveAnomalies: одиночный телепорт', () => {
  // Десять минут едем, одну минуту приёмник показывает соседнюю страну,
  // потом возвращается. Это и есть картина реального выезда 1-го числа.
  const track = []; for (let i = 0; i <= 10; i++) track.push(at(i, i));
  track.push(at(400, 11));
  for (let i = 11; i <= 30; i++) track.push(at(i, i + 1));

  it('точка вне круга выброшена даром', async () => {
    const reach = spy(true);
    const r = await resolveAnomalies(track, null, reach);
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0].why).toMatch(/вне круга/);
  });
  it('возвращение в трек подтверждено одной изохроной', async () => {
    const reach = spy(true);
    const r = await resolveAnomalies(track, null, reach);
    expect(reach.calls.length).toBe(1);
    expect(r.points.length).toBe(track.length - 1);
  });
  it('вырезанный мусор — сотни километров, потерянное время — минуты', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.droppedKm).toBeGreaterThan(700);
    expect(r.keptKm).toBeCloseTo(30, 0);
    expect(r.unknownMs).toBe(60000);            // одна минута из тридцати одной
    expect(r.verdict).toBe('аномалии вырезаны');
  });
  it('километры выброшенного мусора выезд НЕ порочат', async () => {
    // Главная ловушка: по километрам доля выброшенного тут 96%, и правило
    // «выбросили больше половины» осудило бы починенный выезд.
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.droppedKm / (r.droppedKm + r.keptKm)).toBeGreaterThan(0.9);
    expect(r.verdict).not.toMatch(/недостовер/);
  });
});

describe('resolveAnomalies: дороги против круга', () => {
  // Круг за полчаса разрастается до полутора сотен километров и пропустит
  // почти всё, что рядом. Дороги — нет: «не доехал бы».
  const track = []; for (let i = 0; i <= 60; i++) track.push(at(i, i));
  track.push(at(400, 61));                                        // срыв
  track.push(at(120, 90));                                        // в круге, но не по дорогам
  track.push(at(121, 91));                                        // сосед аномалии — под откат
  for (let i = 0; i <= 60; i++) track.push(at(61 + i, 125 + i));  // вернулись к своим
  const roads = () => spy((a, b) => haversineKm(a, b) < 50);

  it('точка внутри круга, но недостижимая по дорогам, выброшена', async () => {
    const r = await resolveAnomalies(track, null, roads());
    expect(r.dropped.some(d => d.why === 'по дорогам не доехал бы')).toBe(true);
  });
  it('после отказа следующий кандидат берётся вдвое дальше по времени', async () => {
    const reach = roads();
    const r = await resolveAnomalies(track, null, reach);
    expect(r.dropped.some(d => d.why === 'пропущен по откату')).toBe(true);
    expect(reach.calls.length).toBeLessThan(4);      // откат экономит запросы
  });
  it('сосед отвергнутой аномалии обратно НЕ возвращается', async () => {
    // Ловушка: по кругу он проходит с обеих сторон — за час круг вырастает
    // до трёхсот километров. Вернуть его значило бы тихо отменить решение,
    // принятое по дорогам, и приписать выезду две сотни лишних километров.
    const r = await resolveAnomalies(track, null, roads());
    expect(r.points.some(p => p.ts === at(121, 91).ts)).toBe(false);
    expect(r.keptKm).toBeCloseTo(121, 0);            // 60 до срыва, 60 после и метр стыка
  });
  it('трек восстановлен на настоящих точках', async () => {
    const r = await resolveAnomalies(track, null, roads());
    const tail = r.points.filter(p => p.ts >= at(61, 125).ts);
    expect(tail.length).toBe(61);
    expect(r.verdict).toBe('аномалии вырезаны');
  });
});

describe('resolveAnomalies: откат перескочил через хорошие точки', () => {
  // Трек восстановился раньше, чем истёк удвоенный интервал. Пропущенные
  // точки лежат ровно по пути между двумя достоверными — их возвращаем даром.
  const track = []; for (let i = 0; i <= 30; i++) track.push(at(i, i));
  track.push(at(400, 31));                                       // срыв
  track.push(at(100, 60));                                       // в круге, не по дорогам
  for (let i = 0; i <= 30; i++) track.push(at(31 + i, 65 + i));  // трек уже в порядке
  const roads = () => spy((a, b) => haversineKm(a, b) < 50);

  it('пропущенные откатом точки возвращены', async () => {
    const r = await resolveAnomalies(track, null, roads());
    expect(r.restored).toBeGreaterThan(10);
    expect(r.dropped.every(d => d.why !== 'пропущен по откату')).toBe(true);
  });
  it('возвращённые стоят на своих местах по времени', async () => {
    const r = await resolveAnomalies(track, null, roads());
    for (let k = 1; k < r.points.length; k++) {
      expect(r.points[k].t).toBeGreaterThan(r.points[k - 1].t);
    }
  });
  it('и пробег от этого не потерян', async () => {
    const r = await resolveAnomalies(track, null, roads());
    expect(r.keptKm).toBeCloseTo(61, 0);
    expect(r.verdict).toBe('аномалии вырезаны');
  });
});

describe('resolveAnomalies: приёмник врал полвыезда', () => {
  // Полчаса нормально, полтора часа бреда, полчаса нормально. Тут не
  // «вырезать аномалию», тут нечего считать: большей части выезда нет.
  const track = []; for (let i = 0; i <= 30; i++) track.push(at(i, i));
  for (let i = 0; i < 90; i++) track.push(at(500 + (i % 7) * 40, 31 + i));
  for (let i = 0; i <= 30; i++) track.push(at(31 + i, 121 + i));

  it('вердикт — снимать пробег с одометра', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.verdict).toMatch(/^трек недостоверен: снять пробег с одометра машины/);
  });
  it('в приговоре стоят цифры, а не одно слово', async () => {
    // «Недостоверен» без чисел нельзя ни оспорить, ни проверить, а человека
    // он отправляет лезть под капот за одометром.
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.verdict).toMatch(/врал \d+% времени/);
    expect(r.verdict).toMatch(/выброшено \d+ точек из \d+/);
  });
  it('это решение по ВРЕМЕНИ без трека, а не по числу точек', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.unknownShare).toBeGreaterThan(0.5);
  });
  it('порог вынесен наружу', async () => {
    const r = await resolveAnomalies(track, { maxDropShare: 0.95 }, spy(true));
    expect(r.verdict).not.toMatch(/недостовер/);
  });
});

describe('resolveAnomalies: когда проверить нечем', () => {
  const track = []; for (let i = 0; i <= 10; i++) track.push(at(i, i));
  track.push(at(400, 11));
  for (let i = 11; i <= 20; i++) track.push(at(i, i + 1));

  it('дороги не ответили — верим кругу, но говорим об этом', async () => {
    const r = await resolveAnomalies(track, null, spy(null));
    expect(r.weakChecks).toBe(1);
    expect(r.verdict).toMatch(/судили по кругу/);
    expect(r.points.length).toBe(track.length - 1);
  });
  it('проверять нечем совсем — выезд всё равно считается', async () => {
    const r = await resolveAnomalies(track, null, null);
    expect(r.dropped.length).toBe(1);
    expect(r.weakChecks).toBe(1);
  });
  it('потолок запросов не даёт разориться на плохом треке', async () => {
    const bad = [];
    for (let i = 0; i < 40; i++) { bad.push(at(i, i * 2)); bad.push(at(300 + i, i * 2 + 1)); }
    const reach = spy(false);
    const r = await resolveAnomalies(bad, { maxChecks: 3 }, reach);
    expect(reach.calls.length).toBeLessThanOrEqual(3);
    expect(r.checks).toBeLessThanOrEqual(3);
  });
});

describe('resolveAnomalies: мелочи', () => {
  it('пустой трек не роняет расчёт', async () => {
    const r = await resolveAnomalies([], null, spy(true));
    expect(r.verdict).toBe('мало точек');
  });
  it('пороги заданы явно', () => {
    expect(RESOLVE_DEFAULTS.hardSpeedKmh).toBeGreaterThan(TRACK_DEFAULTS.maxSpeedKmh);
    expect(RESOLVE_DEFAULTS.maxDropShare).toBeLessThanOrEqual(1);
  });
});

describe('сведение выезда целиком', () => {
  // Так, как это делает приложение при подтверждении: вырезать аномалии,
  // потом почистить дрожание и разрывы, потом получить одно число.
  async function settle(pts, reach) {
    const r = await resolveAnomalies(pts, null, reach);
    if (r.verdict.startsWith('трек недостоверен')) return { verdict: r.verdict };
    const c = cleanTrack(r.points);
    return { verdict: r.verdict, checks: r.checks, km: trackTotalKm(c, null).km };
  }
  // Выезд 1-го числа в цифрах: сумма прямых по сырым точкам — тысячи
  // километров, настоящий пробег — три сотни.
  const real = []; for (let i = 0; i <= 150; i++) real.push(at(i * 2, i));
  const broken = real.slice(); broken.splice(60, 0, at(6000, 59.5));

  it('одна улетевшая точка не портит выезд', async () => {
    const r = await settle(broken, spy(true));
    expect(cleanTrack(broken).rawKm).toBeGreaterThan(10000);
    expect(r.km).toBeCloseTo(300, 0);
    expect(r.checks).toBe(1);
  });
  it('спокойный выезд считается тем же числом и даром', async () => {
    const reach = spy(true);
    const r = await settle(real, reach);
    expect(r.km).toBeCloseTo(300, 0);
    expect(r.verdict).toBe('чисто');
    expect(reach.calls.length).toBe(0);
  });
});

describe('resolveAnomalies: мост по дорогам', () => {
  // Отвечающий маршрутом уже знает длину отрезка по дорогам. Она нужна
  // ровно там же — закрыть дыру, которую оставила вырезанная аномалия.
  const track = []; for (let i = 0; i <= 30; i++) track.push(at(i, i));
  track.push(at(400, 31));                                        // срыв
  for (let i = 0; i <= 30; i++) track.push(at(60 + i, 60 + i));   // вернулись за 30 км

  it('длина по дорогам возвращена вместе с ответом', async () => {
    const r = await resolveAnomalies(track, null, async () => ({ ok: true, km: 41 }));
    expect(r.bridges.length).toBe(1);
    expect(r.bridges[0].km).toBe(41);
    expect(r.bridges[0].from).toBe(at(30, 30).ts);   // от последней достоверной
  });
  it('отклонённый кандидат моста не оставляет', async () => {
    const r = await resolveAnomalies(track, null, async () => ({ ok: false, km: 900 }));
    expect(r.bridges.length).toBe(0);
  });
  it('короткий ответ true/false тоже принимается', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.bridges.length).toBe(0);
    expect(r.dropped.length).toBe(1);
    expect(r.points.length).toBe(track.length - 1);
  });
});

describe('resolveAnomalies: отказ маршрутизатора', () => {
  // Точку бросило в поле — маршрут до неё не строится. Ответ «нет» и ответ
  // «не знаю» приходят по одному и тому же каналу, и разница между ними
  // решает судьбу трека: первое режет, второе оставляет решение кругу.
  const track = []; for (let i = 0; i <= 40; i++) track.push(at(i, i));
  track.push(at(400, 41));                                        // срыв
  track.push(at(150, 80));                                        // в круге, но в поле
  for (let i = 0; i <= 40; i++) track.push(at(41 + i, 130 + i));

  it('«маршрута нет» вырезает точку', async () => {
    // Так отвечает makeReach на код ORS 2010: не {ok:true}, а именно {ok:false}.
    const r = await resolveAnomalies(track, null,
      async (a, b) => haversineKm(a, b) > 50 ? { ok: false } : { ok: true, km: 1 });
    expect(r.points.some(p => p.ts === at(150, 80).ts)).toBe(false);
    expect(r.dropped.some(d => d.why === 'по дорогам не доехал бы')).toBe(true);
  });
  it('«не знаю» точку НЕ трогает: решает круг', async () => {
    // Так отвечает makeReach на 429 и 5xx. Если бы неизвестность резала,
    // на исчерпанной квоте мы вырезали бы весь трек целиком.
    const r = await resolveAnomalies(track, null, async () => null);
    expect(r.points.some(p => p.ts === at(150, 80).ts)).toBe(true);
    expect(r.weakChecks).toBeGreaterThan(0);
    expect(r.verdict).toMatch(/судили по кругу/);
  });
  it('разница видна в итоговом километраже', async () => {
    const cut = await resolveAnomalies(track, null,
      async (a, b) => haversineKm(a, b) > 50 ? { ok: false } : { ok: true, km: 1 });
    const kept = await resolveAnomalies(track, null, async () => null);
    expect(kept.keptKm).toBeGreaterThan(cut.keptKm + 100);
  });
});

describe('resolveAnomalies: плохая связь — это НЕ аномалия', () => {
  // Живой случай, на котором правило сорвалось. Связь пропадала надолго, и
  // внутри тишины приёмник успевал выдать одну дурную точку. Промежуток
  // между достоверными соседями — часы; наша потеря — одна точка.
  //
  // Эти часы мы не наблюдали НИКАК: ни правильно, ни неправильно. Они не
  // испорчены аномалией, а просто разрыв — его достраивает маршрут по
  // дорогам. Записывать их в ущерб значит объявлять недостоверным любой
  // выезд с плохой связью, то есть ровно тот случай, ради которого всё
  // и затевалось.
  //
  // Трек: три часа езды, из них два больших молчания, и в каждом по одной
  // выброшенной точке.
  const track = [];
  for (let i = 0; i <= 30; i++) track.push(at(i, i));         // 30 мин езды
  track.push(at(900, 45));                                   // дурная точка в тишине
  for (let i = 0; i <= 30; i++) track.push(at(60 + i, 75 + i));
  track.push(at(1200, 130));                                 // ещё одна
  for (let i = 0; i <= 30; i++) track.push(at(140 + i, 160 + i));

  it('выезд НЕ объявлен недостоверным', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.verdict).not.toMatch(/недостовер/);
    expect(r.dropped.length).toBe(2);
  });
  it('в потерю записаны минуты, а не часы молчания', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    expect(r.unknownMs).toBe(2 * 60000);         // две выброшенные точки
    expect(r.unknownShare).toBeLessThan(0.05);
  });
  it('молчание осталось разрывом — его достраивают, а не хоронят', async () => {
    const r = await resolveAnomalies(track, null, spy(true));
    const c = cleanTrack(r.points);
    expect(c.gaps.length).toBe(2);
    expect(planGapFills(c).every(g => g.fill === 'ors')).toBe(true);
  });
});

describe('resolveAnomalies: первая точка тоже проверяется', () => {
  // Холодный старт приёмника: первый отсчёт улетел за триста километров.
  // Раньше он становился якорем, круг строился вокруг чужого места, и
  // начало выезда вырезалось целиком, пока Δt не разрастётся.
  const bad = [at(300, 0)];
  for (let i = 0; i <= 60; i++) bad.push(at(i, i + 1));

  it('дурной старт выброшен, а не принят за якорь', async () => {
    const r = await resolveAnomalies(bad, null, spy(true));
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0].why).toBe('старт не подтверждён');
    expect(r.points.length).toBe(61);
    expect(r.keptKm).toBeCloseTo(60, 0);
  });
  it('и выезд от этого не становится недостоверным', async () => {
    const r = await resolveAnomalies(bad, null, spy(true));
    expect(r.verdict).toBe('аномалии вырезаны');
  });
  it('но хорошую первую точку из-за плохой второй не выбрасываем', async () => {
    // Свидетелей двое: если и вторая пара не сходится, лишняя — вторая
    // точка, а не первая. Её выбросит обычный ход.
    const good = [at(0, 0), at(300, 1)];
    for (let i = 0; i <= 60; i++) good.push(at(1 + i, 2 + i));
    const r = await resolveAnomalies(good, null, spy(true));
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0].why).toMatch(/вне круга/);
    expect(r.points[0].ts).toBe(at(0, 0).ts);
  });
});

describe('resolveAnomalies: разбор по причинам', () => {
  it('приговор сопровождается разбором, а не одним словом', async () => {
    const t = [at(900, 0)];
    for (let i = 0; i <= 20; i++) t.push(at(i, i + 1));
    t.push(at(700, 22));
    for (let i = 0; i <= 20; i++) t.push(at(21 + i, 23 + i));
    const r = await resolveAnomalies(t, null, spy(true));
    expect(r.reasons['старт не подтверждён']).toBe(1);
    expect(r.reasons['вне круга']).toBeGreaterThan(0);
  });
  it('счётчик причин сходится с числом выброшенных', async () => {
    const t = [at(900, 0)];
    for (let i = 0; i <= 20; i++) t.push(at(i, i + 1));
    const r = await resolveAnomalies(t, null, spy(true));
    const sum = Object.values(r.reasons).reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.dropped.length);
  });
});
