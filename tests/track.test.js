import { describe, it, expect } from 'vitest';
import { measureTrip, haversineKm, TRACK_DEFAULTS } from '../src/core/track.js';

// Точка на N километров восточнее базовой — так тесты читаются в километрах,
// а не в градусах. База — депо в Кременчуге.
const DEPOT = { lat: 49.07, lng: 33.42 };
const kmEast = (km) => km / (111.32 * Math.cos(DEPOT.lat * Math.PI / 180));
const at = (km, min) => ({
  lat: DEPOT.lat, lng: DEPOT.lng + kmEast(km),
  ts: new Date(Date.UTC(2026, 8, 2, 8, 0, Math.round((min || 0) * 60))).toISOString()
});
// Счётчик обращений к дорогам: ровно то, за что мы платим.
function roads(answer) {
  const calls = [];
  const fn = async (a, b, ms) => {
    calls.push({ km: haversineKm(a, b), ms });
    return typeof answer === 'function' ? answer(a, b, ms) : answer;
  };
  fn.calls = calls;
  return fn;
}
// Дороги длиннее прямой в 1.3 раза, скорость 80 км/ч — правдоподобный ответ.
const realRoads = roads((a, b) => {
  const km = haversineKm(a, b) * 1.3;
  return { ok: true, km, sec: km / 80 * 3600 };
});

describe('haversineKm', () => {
  it('меряет то, что мы задумали: 10 км на восток', () => {
    expect(haversineKm(at(0, 0), at(10, 0))).toBeCloseTo(10, 1);
  });
  it('нулевое расстояние — ноль, а не NaN', () => {
    expect(haversineKm(DEPOT, { lat: DEPOT.lat, lng: DEPOT.lng })).toBe(0);
  });
});

describe('спокойный выезд', () => {
  // Минутный такт, километр в минуту — 60 км/ч. Все пары ближе 5 км.
  const calm = []; for (let i = 0; i <= 120; i++) calm.push(at(i, i));

  it('не стоит ни одного запроса к дорогам', async () => {
    const r = roads({ ok: true, km: 1 });
    const m = await measureTrip(calm, null, {}, r);
    expect(r.calls.length).toBe(0);
    expect(m.checks).toBe(0);
  });
  it('все точки достоверны, вердикт «чисто»', async () => {
    const m = await measureTrip(calm, null, {}, realRoads);
    expect(m.points.length).toBe(calm.length);
    expect(m.dropped.length).toBe(0);
    expect(m.verdict).toBe('чисто');
    expect(m.km).toBeCloseTo(120, 0);
  });
  it('порядок и дубли по времени приводятся в порядок', async () => {
    const m = await measureTrip([at(0, 0), at(20, 20), at(10, 10), at(9, 10)], null, {}, realRoads);
    expect(m.points.map(p => p.ts)).toEqual([at(0, 0).ts, at(10, 10).ts, at(20, 20).ts]);
  });
  it('точки без координат расчёт не роняют', async () => {
    const m = await measureTrip([at(0, 0), { lat: null, lng: null, ts: at(1, 1).ts }, at(3, 3)], null, {}, realRoads);
    expect(m.points.length).toBe(2);
    expect(isFinite(m.km)).toBe(true);
  });
});

describe('проход по треку — разобранный пример', () => {
  // Пятнадцать точек, аномалии на 5, 6 и 11, 12, 13. Алгоритм об этом не
  // знает: он просто идёт парами от последней достоверной точки.
  //
  //   1..4   обычная дорога
  //   5      800 км за 20 мин от точки 4  → 2400 км/ч
  //   6      300 км за 30 мин от точки 4  → 600 км/ч
  //   7      100 км за 55 мин от точки 4  → 109 км/ч, кандидат
  //   8..10  обычная дорога
  //   11..13 снова аномалия
  //   14,15  вернулись
  // Обычные шаги нарочно короче пяти километров: на них маршрут не
  // строится, и в счётчике запросов видно ровно то, что стоило денег.
  const p = [];
  p.push(at(0, 0), at(3, 3), at(6, 6), at(9, 9));          // 1..4, по 60 км/ч
  p.push(at(809, 29));                                      // 5: 800 км за 20 мин
  p.push(at(309, 39));                                      // 6: 300 км за 30 мин
  p.push(at(109, 64));                                      // 7: 100 км за 55 мин
  p.push(at(112, 67), at(115, 70), at(118, 73));            // 8..10
  p.push(at(918, 88), at(618, 103), at(418, 118));          // 11..13
  p.push(at(160, 148), at(163, 151));                       // 14, 15: вернулись дальше пяти км

  it('аномальные точки выброшены, остальные целы', async () => {
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.dropped.length).toBe(5);
    expect(m.dropped.map(x => x.ts)).toEqual([p[4].ts, p[5].ts, p[10].ts, p[11].ts, p[12].ts]);
    expect(m.points.length).toBe(10);
  });
  it('каждая отброшенная названа своей скоростью', async () => {
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.dropped[0].why).toMatch(/^скорость 2[34]\d\d км\/ч$/);   // ≈2400
    expect(m.dropped[1].why).toMatch(/^скорость 5\d\d|^скорость 6\d\d/);  // ≈600
    expect(m.reasons['скорость']).toBe(5);
  });
  it('опора не двигается, пока точка не прошла оба гейта', async () => {
    // Пары 4-5 и 4-6 отсекает скорость, и стоит это ноль запросов: платный
    // вопрос задаётся только тому, кто прошёл первый гейт.
    const r = roads({ ok: true, km: 130 });
    const m = await measureTrip(p, null, {}, r);
    expect(m.checks).toBe(2);                      // два возвращения в трек
    expect(r.calls.some(x => x.km > 250)).toBe(false);   // про 800 и 300 км не спрашивали
    const ask = r.calls[0];
    expect(Math.round(ask.km)).toBe(100);          // спросили ровно про пару 4-7
    expect(Math.round(ask.ms / 60000)).toBe(55);
  });
  it('возвращение в трек засчитано по дорогам, а не по хорде', async () => {
    const m = await measureTrip(p, null, {}, roads({ ok: true, km: 130 }));
    const bridges = m.segments.filter(s => s.kind === 'road');
    expect(bridges.length).toBe(2);
    expect(bridges[0].km).toBe(130);               // не 100 по прямой
    expect(bridges[0].fromTs).toBe(p[3].ts);       // от точки 4
    expect(bridges[0].toTs).toBe(p[6].ts);         // до точки 7
    expect(m.roadKm).toBe(260);
  });
  it('точка, прошедшая скорость, но не прошедшая дороги, отбрасывается', async () => {
    // ORS отвечает «ехать втрое дольше, чем было времени».
    const m = await measureTrip(p, null, {}, roads((a, b) => ({ ok: haversineKm(a, b) < 50, km: 130 })));
    expect(m.dropped.some(x => x.why === 'по дорогам не доехал бы')).toBe(true);
  });
});

describe('второй гейт: время по дорогам против фактического', () => {
  // От точки 4 до точки 7 сто километров и 55 фактических минут.
  const p = [at(0, 0), at(3, 3), at(6, 6), at(9, 9), at(809, 29), at(109, 64)];

  it('75 минут по ORS проходят: 75 / 1.5 = 50 ≤ 55', async () => {
    const m = await measureTrip(p, null, {}, roads((a, b, ms) => ({ ok: 75 * 60 <= (ms / 1000) * 1.5, km: 130 })));
    expect(m.dropped.length).toBe(1);              // только точка 5
    expect(m.points.length).toBe(5);
  });
  it('90 минут по ORS не проходят: 90 / 1.5 = 60 > 55', async () => {
    const m = await measureTrip(p, null, {}, roads((a, b, ms) => ({ ok: 90 * 60 <= (ms / 1000) * 1.5, km: 130 })));
    expect(m.dropped.length).toBe(2);
    expect(m.dropped[1].why).toBe('по дорогам не доехал бы');
  });
  it('запас вынесен наружу и работает в обе стороны', () => {
    expect(TRACK_DEFAULTS.slack).toBeGreaterThan(1);
    expect(TRACK_DEFAULTS.hardSpeedKmh).toBeGreaterThan(140);
  });
});

describe('опора берётся из выезда', () => {
  const START = { lat: DEPOT.lat, lng: DEPOT.lng, name: 'Депо' };

  it('первая точка в круге пяти километров — она и есть опора', async () => {
    const p = [at(2, 30), at(12, 40), at(22, 50)];
    const m = await measureTrip(p, null, { start: START }, realRoads);
    expect(m.points[0].ts).toBe(p[0].ts);
    expect(m.points[0].anchor).toBeUndefined();
    expect(m.dropped.length).toBe(0);
  });
  it('трек начался далеко — опорой становится сам старт с шести утра', async () => {
    // Первая точка в ста километрах: это не аномалия, это «трекер очнулся
    // в дороге». От депо с шести утра туда времени навалом.
    const p = [at(100, 180), at(115, 195), at(130, 210)];
    const m = await measureTrip(p, null, { start: START }, realRoads);
    expect(m.points[0].anchor).toBe('старт выезда');
    expect(new Date(m.points[0].ts).getHours()).toBe(TRACK_DEFAULTS.dayStartHour);
    expect(m.dropped.length).toBe(0);
    expect(m.points.length).toBe(4);               // опора плюс три точки
  });
  it('дорога от депо до первой точки посчитана по дорогам', async () => {
    const p = [at(100, 180), at(115, 195)];
    const m = await measureTrip(p, null, { start: START }, roads({ ok: true, km: 128 }));
    expect(m.segments[0].kind).toBe('road');
    expect(m.segments[0].km).toBe(128);
  });
  it('пачка мусора в начале трека больше не становится опорой', async () => {
    // Ровно тот выезд, что убил прошлую версию: приёмник включился за
    // 2800 км и просидел там десять отсчётов. Опора теперь из карточки
    // выезда, и пачка проверяется на общих основаниях.
    const p = [];
    for (let i = 0; i < 10; i++) p.push(at(2800 + i * 0.01, i));
    for (let i = 0; i < 235; i++) p.push(at(i * 1.1, 12 + i * 2));
    const m = await measureTrip(p, null, { start: START }, realRoads);
    expect(m.dropped.length).toBe(10);
    expect(m.verdict).not.toMatch(/недостовер/);
    expect(m.km).toBeCloseTo(257, 0);
  });
  it('без карточки выезда опорой служит первая точка', async () => {
    const p = [at(0, 0), at(10, 10)];
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.points[0].ts).toBe(p[0].ts);
  });
  it('трек, начавшийся до шести утра, опору не ломает', async () => {
    const early = (km, h, mi) => ({ lat: DEPOT.lat, lng: DEPOT.lng + kmEast(km),
      ts: new Date(2026, 8, 2, h, mi).toISOString() });
    const m = await measureTrip([early(100, 4, 30), early(115, 5, 0)], null, { start: START }, realRoads);
    expect(m.points[0].anchor).toBe('старт выезда');
    expect(new Date(m.points[0].ts).getHours()).toBe(0);   // полночь тех же суток
    expect(m.dropped.length).toBe(0);
  });
});

describe('финиш', () => {
  const START = { lat: DEPOT.lat, lng: DEPOT.lng };
  const FAR = { lat: DEPOT.lat, lng: DEPOT.lng + kmEast(200) };   // второе депо

  it('трек оборвался, не доехав до финиша — дорога домой посчитана', async () => {
    const p = [at(0, 0), at(30, 30), at(60, 60)];
    const m = await measureTrip(p, null, { start: START, finish: FAR }, roads({ ok: true, km: 182 }));
    const back = m.segments[m.segments.length - 1];
    expect(back.kind).toBe('road');
    expect(back.why).toMatch(/возвращени/);
    expect(back.km).toBe(182);
    expect(m.points[m.points.length - 1].anchor).toBe('финиш выезда');
  });
  it('финиш — своя точка, а не стартовая', async () => {
    // Трек закончился у второго депо: достраивать нечего.
    const p = [at(0, 0), at(100, 100), at(199, 200)];
    const m = await measureTrip(p, null, { start: START, finish: FAR }, realRoads);
    expect(m.segments.some(s => /возвращени/.test(s.why || ''))).toBe(false);
    // А если бы финишем считали старт, дорога «домой» появилась бы зря.
    const m2 = await measureTrip(p, null, { start: START, finish: START }, realRoads);
    expect(m2.segments.some(s => /возвращени/.test(s.why || ''))).toBe(true);
  });
  it('финиша в карточке нет — ничего не достраиваем', async () => {
    const p = [at(0, 0), at(60, 60)];
    const m = await measureTrip(p, null, { start: START }, realRoads);
    expect(m.segments.some(s => /возвращени/.test(s.why || ''))).toBe(false);
  });
});

describe('связь и молчание не особый случай', () => {
  it('два часа тишины — просто большое Δt, правило то же', async () => {
    // 150 км за два часа это 75 км/ч. Условие выполняется само, никаких
    // «разрывов» алгоритму знать не нужно.
    const p = [at(0, 0), at(3, 3), at(153, 123), at(156, 126)];
    const m = await measureTrip(p, null, {}, roads({ ok: true, km: 195 }));
    expect(m.dropped.length).toBe(0);
    expect(m.segments.filter(s => s.kind === 'road').length).toBe(1);
    expect(m.roadKm).toBe(195);
  });
  it('а вот Лима после того же молчания не проходит', async () => {
    // Живой случай: приёмник отдал связный кусок трека в Перу. Особое
    // правило для него не нужно — 12 тысяч километров за два часа это
    // шесть тысяч километров в час, и первый гейт закрывается сам.
    const lima = (i) => ({ lat: -12.05, lng: -77.04 + i * 0.002,
      ts: new Date(Date.UTC(2026, 8, 2, 10, 10 + i)).toISOString() });
    const p = [at(0, 0), at(3, 3), at(6, 6)];
    for (let i = 0; i < 12; i++) p.push(lima(i));
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.dropped.length).toBe(12);
    expect(m.km).toBeCloseTo(6, 0);
    expect(m.segments.every(s => s.km < 100)).toBe(true);
  });
  it('никакая прямая через полмира в пробег не попадает', async () => {
    const lima = (i) => ({ lat: -12.05, lng: -77.04 + i * 0.002,
      ts: new Date(Date.UTC(2026, 8, 2, 10, 10 + i)).toISOString() });
    const p = [at(0, 0), at(10, 10)];
    for (let i = 0; i < 12; i++) p.push(lima(i));
    const m = await measureTrip(p, null, {}, null);
    expect(m.km).toBeLessThan(50);
  });
});

describe('дрожание на стоянке', () => {
  it('шевеление в двадцати метрах в пробег не идёт', async () => {
    const p = [at(0, 0)];
    for (let i = 1; i <= 60; i++) p.push(at(i % 2 ? 0.02 : 0, i));
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.km).toBe(0);
    expect(m.jitterKm).toBeGreaterThan(1);
    expect(m.dropped.length).toBe(0);              // точки достоверны, просто стоят
  });
  it('а настоящее движение идёт', async () => {
    const m = await measureTrip([at(0, 0), at(0.5, 1), at(1, 2)], null, {}, realRoads);
    expect(m.km).toBeCloseTo(1, 1);
    expect(m.jitterKm).toBe(0);
  });
});

describe('когда спросить дороги нечем', () => {
  const p = [at(0, 0), at(10, 10), at(60, 60), at(70, 70)];

  it('без маршрутизатора выезд всё равно считается — по прямым', async () => {
    const m = await measureTrip(p, null, {}, null);
    expect(m.dropped.length).toBe(0);
    expect(m.weakChecks).toBe(3);                  // три пары дальше пяти километров
    expect(m.lineKm).toBeCloseTo(70, 0);
    expect(m.verdict).toMatch(/не построена по дорогам/);
  });
  it('незастроенный отрезок помечен, а не выдан за измеренный', async () => {
    const m = await measureTrip(p, null, {}, null);
    const line = m.segments.find(s => s.kind === 'line');
    expect(line.why).toBe('маршрут не строился');
  });
  it('потолок запросов не даёт разориться на плохом треке', async () => {
    const bad = []; for (let i = 0; i < 60; i++) bad.push(at(i * 20, i * 20));
    const r = roads({ ok: true, km: 26 });
    const m = await measureTrip(bad, { maxOrsCalls: 3 }, {}, r);
    expect(r.calls.length).toBe(3);
    expect(m.checks).toBe(3);
    expect(m.weakChecks).toBeGreaterThan(0);       // остальные — прямыми
  });
});

describe('приговор', () => {
  it('приёмник врал большую часть выезда — считать нечего', async () => {
    const p = []; for (let i = 0; i <= 30; i++) p.push(at(i, i));
    for (let i = 0; i < 90; i++) p.push(at(900 + (i % 5) * 40, 31 + i));
    for (let i = 0; i <= 30; i++) p.push(at(31 + i, 121 + i));
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.verdict).toMatch(/^трек недостоверен/);
    expect(m.verdict).toMatch(/врал \d+% времени/);
    expect(m.verdict).toMatch(/выброшено \d+ точек из \d+/);
  });
  it('одна дурная точка среди сотни выезд не порочит', async () => {
    const p = []; for (let i = 0; i <= 100; i++) p.push(at(i, i));
    p.splice(50, 0, at(900, 49.5));
    const m = await measureTrip(p, null, {}, realRoads);
    expect(m.dropped.length).toBe(1);
    expect(m.unknownShare).toBeLessThan(0.05);
    expect(m.verdict).toBe('аномалии вырезаны');
  });
  it('порог вынесен наружу', async () => {
    const p = []; for (let i = 0; i <= 30; i++) p.push(at(i, i));
    for (let i = 0; i < 90; i++) p.push(at(900 + (i % 5) * 40, 31 + i));
    for (let i = 0; i <= 30; i++) p.push(at(31 + i, 121 + i));
    const m = await measureTrip(p, { maxDropShare: 0.95 }, {}, realRoads);
    expect(m.verdict).not.toMatch(/недостовер/);
  });
  it('пустой трек не роняет расчёт', async () => {
    const m = await measureTrip([], null, {}, realRoads);
    expect(m.verdict).toBe('трека нет');
    expect(m.km).toBe(0);
  });
});

describe('отрезки складываются в пробег', () => {
  it('итог равен сумме отрезков, и каждый назван своим видом', async () => {
    const p = [at(0, 0), at(3, 3), at(60, 60), at(63, 63)];
    const m = await measureTrip(p, null, {}, roads({ ok: true, km: 74 }));
    const sum = m.segments.reduce((s, x) => s + x.km, 0);
    expect(m.km).toBeCloseTo(sum, 6);
    expect(m.trackKm + m.roadKm + m.lineKm).toBeCloseTo(m.km, 6);
    expect(m.segments.map(s => s.kind)).toEqual(['track', 'road', 'track']);
  });
});

describe('маршрут: где линейка, а где судья', () => {
  it('обычную дорогу маршрут не бракует, а только меряет', async () => {
    // Шесть километров за четыре минуты — девяносто км/ч, нормальная трасса.
    // ORS на том же куске насчитает семь минут: 7 / 1.5 = 4.7 больше
    // четырёх. Строгое сравнение выбросило бы настоящую точку.
    const p = [at(0, 0), at(6, 4), at(12, 8)];
    const m = await measureTrip(p, null, {}, roads({ ok: false, km: 8 }));
    expect(m.dropped.length).toBe(0);
    expect(m.roadKm).toBe(16);                     // расстояние взяли, приговор — нет
  });
  it('а подозреваемого — судит', async () => {
    // Та же пара, но перед ней аномалия: точка под подозрением, и «не
    // доехал бы» теперь означает именно это.
    const p = [at(0, 0), at(3, 3), at(803, 23), at(9, 60), at(15, 64)];
    const m = await measureTrip(p, null, {}, roads((a, b) => ({ ok: haversineKm(a, b) < 5, km: 8 })));
    expect(m.dropped[0].why).toMatch(/^скорость/);
    expect(m.dropped[1].why).toBe('по дорогам не доехал бы');
    // Подозрение не снимается, пока хоть одна точка не прошла оба гейта:
    // маршрутизатор здесь бракует всё подряд, значит трека дальше нет.
    expect(m.dropped.length).toBe(3);
  });
  it('подозрение снимается с первой же достоверной точки', async () => {
    const p = [at(0, 0), at(3, 3), at(803, 23), at(6, 60), at(12, 64), at(18, 68)];
    const m = await measureTrip(p, null, {}, roads({ ok: false, km: 8 }));
    // Точка 4 близко (3 км от опоры) — проходит без маршрута и снимает
    // подозрение. Дальше «ok:false» уже никого не бракует.
    expect(m.dropped.length).toBe(1);
    expect(m.dropped[0].why).toMatch(/^скорость/);
  });
});
