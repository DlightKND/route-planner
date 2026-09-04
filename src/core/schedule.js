// Календарная раскладка работ по дням. Чистые функции: на входе блоки работ
// и настройки, на выходе — какой день чем занят. Ни DOM, ни базы, ни сети.
//
// ПРАВИЛА (согласованы с заказчиком):
//
//  1. Единица планирования — БЛОК. Блок это либо выезд (все его заявки едут
//     вместе), либо отдельная заявка без выезда. Заявки разных блоков по дням
//     не накладываются: у инженера один день — одна работа.
//
//  2. Даты выезда, поставленные диспетчером ВРУЧНУЮ, — закон. График их не
//     двигает, он только раскладывает часы внутри них. Если часы в эти даты
//     не помещаются — это не повод сдвинуть выезд, это повод сказать админу,
//     что отрезок перегружен (warnings, kind:'overflow').
//
//  3. Блок без своих дат получает их от срока: сколько дней занять, считается
//     как  часы работ / эффективная смена,  с округлением вверх; эффективная
//     смена — смена плюс допуск (те же shift_hours и deviation_pct, что и в
//     экономике). Работа не дробится: если она влезает в допуск, она делается
//     за один день, а не размазывается на два.
//
//  4. Дорога — отдельные дни по краям работы, а не «половина от общего».
//     Плечо ДО первой точки занимает дни перед работой, плечо ОБРАТНО —
//     после. Промежуточные плечи ложатся на рабочие дни.
//     8 ч работ + 4 ч туда + 4 ч обратно при сроке в четверг = половина среды
//     (дорога), четверг (работа), половина пятницы (дорога).
//
//  5. Работа заканчивается НЕ ПОЗЖЕ срока и не попадает на выходные. Если
//     из-за выходных или занятости блок не влезает — он сдвигается влево,
//     ближе к сегодня. Если и там места нет, блок ставится как есть, а админ
//     получает предупреждение ('late' — не успеваем к сроку).
//
//  6. Ничья очередь. Неназначенные заявки (без инженера) считаются в общей
//     загрузке команды, но ни с кем не сталкиваются: у них своя дорожка.

const DAY = 86400000;

export const SCHEDULE_DEFAULTS = { shiftH: 8, deviationPct: 0, weekend: [0, 6] };

// ---- Даты -------------------------------------------------------------
// Внутри всё считается в UTC-полуночах: календарь без часовых поясов.
export function dayMs(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
export function dayIso(ms) {
  const d = new Date(ms);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}
export function isWorkday(ms, weekend) {
  const w = weekend || SCHEDULE_DEFAULTS.weekend;
  return w.indexOf(new Date(ms).getUTCDay()) < 0;
}
function stepWork(ms, dir, weekend) {
  let x = ms + dir * DAY;
  for (let i = 0; i < 14 && !isWorkday(x, weekend); i++) x += dir * DAY;
  return x;
}
// Ближайший рабочий день не позже (dir=-1) / не раньше (dir=+1) данного.
function snapWork(ms, dir, weekend) {
  let x = ms;
  for (let i = 0; i < 14 && !isWorkday(x, weekend); i++) x += dir * DAY;
  return x;
}
// n рабочих дней подряд, заканчивающихся днём end.
function workRun(end, n, weekend) {
  const out = [];
  let x = snapWork(end, -1, weekend);
  for (let i = 0; i < n; i++) { out.unshift(x); if (i < n - 1) x = stepWork(x, -1, weekend); }
  return out;
}

// ---- Раскладка одного блока -------------------------------------------
// Блок на входе:
//   { id, kind:'trip'|'job', engineer, sla, workH, driveToH, driveBackH,
//     driveMidH, from, to, jobIds }
// from/to заполнены только у выезда с ручными датами.
function effShift(s) { return (s.shiftH || 8) * (1 + ((s.deviationPct || 0) / 100)); }

function daysNeeded(workH, s) {
  const eff = effShift(s);
  if (!(workH > 0) || !(eff > 0)) return 1;
  return Math.max(1, Math.ceil(+(workH / eff).toFixed(6)));
}

// Раскладка часов блока по дням: [{iso, ms, workH, driveH}].
// Дни работы идут подряд, дорога — по дням до и после.
function layout(block, workDays, s) {
  const eff = effShift(s);
  const cells = new Map();
  const add = (ms, kind, h) => {
    const iso = dayIso(ms);
    const c = cells.get(iso) || { iso: iso, ms: ms, workH: 0, driveH: 0 };
    c[kind] += h; cells.set(iso, c);
  };
  const per = workDays.length ? (block.workH || 0) / workDays.length : 0;
  const mid = workDays.length ? (block.driveMidH || 0) / workDays.length : 0;
  workDays.forEach(ms => { add(ms, 'workH', per); if (mid) add(ms, 'driveH', mid); });

  // Дорога занимает дни целыми сменами, остаток — часть дня.
  const spill = (startFrom, dir, hours) => {
    let left = hours, ms = startFrom, guard = 0;
    while (left > 0.01 && guard++ < 30) {
      add(ms, 'driveH', Math.min(left, eff));
      left -= eff;
      if (left > 0.01) ms = stepWork(ms, dir, s.weekend);
    }
  };
  if (block.driveToH > 0 && workDays.length) spill(stepWork(workDays[0], -1, s.weekend), -1, block.driveToH);
  if (block.driveBackH > 0 && workDays.length) spill(stepWork(workDays[workDays.length - 1], 1, s.weekend), 1, block.driveBackH);

  return Array.from(cells.values()).sort((a, b) => a.ms - b.ms);
}

// Разорван ли блок выходными: работа и дорога должны идти подряд.
// У блока длиннее рабочей недели выходные внутри неизбежны — там не проверяем.
function contiguous(cells) {
  if (cells.length > 5) return true;
  const a = cells[0].ms, z = cells[cells.length - 1].ms;
  for (let x = a; x <= z; x += DAY) if (!isWorkday(x)) return false;
  return true;
}

// Влезает ли раскладка в свободную ёмкость дня.
function fits(cells, busy, key, s) {
  const eff = effShift(s);
  return cells.every(c => {
    const used = busy.get(key + '|' + c.iso) || 0;
    return used + c.workH + c.driveH <= eff + 1e-6;
  });
}
function occupy(cells, busy, key) {
  cells.forEach(c => {
    const k = key + '|' + c.iso;
    busy.set(k, (busy.get(k) || 0) + c.workH + c.driveH);
  });
}

// ---- Главная функция --------------------------------------------------
//   planSchedule(blocks, settings, { today })
//     -> { blocks: [{...block, days, from, to, workFrom, workTo, fixed, ok, why}],
//          load:  { 'инженер|дата': {engineer, date, workH, driveH, cap} },
//          warnings: [{kind, blockId, engineer, date, text}] }
export function planSchedule(blocks, settings, opts) {
  const s = Object.assign({}, SCHEDULE_DEFAULTS, settings || {});
  const o = opts || {};
  const eff = effShift(s);
  const today = dayMs(o.today) != null ? dayMs(o.today) : dayMs(dayIso(Date.now()));
  const busy = new Map();          // 'инженер|дата' -> занятые часы
  const load = {};                 // то же наружу, с разбивкой
  const warnings = [];
  const out = [];

  const put = (key, cells) => {
    cells.forEach(c => {
      const k = key + '|' + c.iso;
      const l = load[k] || (load[k] = { engineer: key, date: c.iso, workH: 0, driveH: 0, cap: eff });
      l.workH += c.workH; l.driveH += c.driveH;
    });
  };
  // Неназначенные не сталкиваются ни с кем: своя дорожка, общий счёт.
  const laneOf = b => (b.engineer || ' free');

  const norm = (blocks || []).map(b => Object.assign({
    kind: 'job', workH: 0, driveToH: 0, driveBackH: 0, driveMidH: 0, jobIds: []
  }, b));

  // Сначала — блоки с ручными датами: они закон и занимают дни первыми.
  const fixed = norm.filter(b => b.from);
  const free = norm.filter(b => !b.from);
  // Дальше — выезды, потом одиночные заявки, внутри — по сроку.
  // Выезд старше заявки не по сроку, а по природе: он уже спланирован как
  // поездка, и подвинуть проще одиночную работу, чем разобрать выезд.
  free.sort((a, b) => {
    const ka = a.kind === 'trip' ? 0 : 1, kb = b.kind === 'trip' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    const x = dayMs(a.sla), y = dayMs(b.sla);
    return (x == null ? 8.64e15 : x) - (y == null ? 8.64e15 : y);
  });

  fixed.forEach(b => {
    const a = dayMs(b.from), z = dayMs(b.to || b.from);
    const list = [];
    for (let x = a; x <= z; x += DAY) list.push(x);
    const wd = list.filter(x => isWorkday(x, s.weekend));
    const days = wd.length ? wd : list;             // выезд на выходные — воля диспетчера
    const total = (b.workH || 0) + (b.driveToH || 0) + (b.driveBackH || 0) + (b.driveMidH || 0);
    const per = total / days.length;
    const wPer = (b.workH || 0) / days.length;
    const cells = days.map(ms => ({ iso: dayIso(ms), ms: ms, workH: wPer, driveH: per - wPer }));
    const key = laneOf(b);
    const over = cells.filter(c => (busy.get(key + '|' + c.iso) || 0) + per > eff + 1e-6);
    occupy(cells, busy, key); put(key, cells);
    const rec = Object.assign({}, b, {
      days: cells, fixed: true, ok: !over.length, why: over.length ? 'overflow' : '',
      from: dayIso(days[0]), to: dayIso(days[days.length - 1]),
      workFrom: dayIso(days[0]), workTo: dayIso(days[days.length - 1])
    });
    out.push(rec);
    if (over.length) warnings.push({
      kind: 'overflow', blockId: b.id, engineer: b.engineer || null, date: over[0].iso,
      fixed: true, days: over.length, sla: b.sla || null,
      text: 'Даты выставлены вручную, но работа в них не помещается: перегружено '
        + over.length + ' дн. (с ' + over[0].iso + ').'
    });
    if (dayMs(b.sla) != null && dayMs(rec.workTo) > dayMs(b.sla)) {
      rec.ok = false; rec.why = rec.why || 'late';
      warnings.push({
        kind: 'late', blockId: b.id, engineer: b.engineer || null, date: rec.workTo,
        fixed: true, sla: b.sla,
        text: 'Выезд заканчивается ' + rec.workTo + ', позже срока ' + b.sla + '.'
      });
    }
  });

  free.forEach(b => {
    const key = laneOf(b);
    const n = daysNeeded(b.workH, s);
    const sla = dayMs(b.sla);
    const floor = snapWork(today, 1, s.weekend);
    const tryAt = end => {
      const days = workRun(end, n, s.weekend);
      const cells = layout(b, days, s);
      return { days: days, cells: cells, fit: fits(cells, busy, key, s), cont: contiguous(cells) };
    };
    // Якорь: последний рабочий день не позже срока. Срока нет — от сегодня.
    let anchor = sla != null ? snapWork(sla, -1, s.weekend) : floor;
    if (workRun(anchor, n, s.weekend)[0] < floor) {   // в прошлое не планируем
      let x = floor;
      for (let i = 1; i < n; i++) x = stepWork(x, 1, s.weekend);
      anchor = x;
    }
    // Сначала — влево от срока: ищем место, где блок и свободен, и не разорван
    // выходными. Если такого нет, годится просто свободное; если и его нет,
    // идём вправо за срок — опоздать честнее, чем встать поверх занятого дня.
    let best = null, loose = null, e = anchor;
    for (let i = 0; i < 90; i++) {
      const t = tryAt(e);
      if (t.fit && t.cont) { best = t; break; }
      if (t.fit && !loose) loose = t;
      if (t.days[0] <= floor) break;
      e = stepWork(e, -1, s.weekend);
    }
    if (!best && loose) best = loose;
    if (!best) {
      e = stepWork(anchor, 1, s.weekend);
      for (let i = 0; i < 90; i++) {
        const t = tryAt(e);
        if (t.fit && (t.cont || i > 30)) { best = t; break; }
        e = stepWork(e, 1, s.weekend);
      }
    }
    let why = '';
    if (!best) { best = tryAt(anchor); why = 'overflow'; }   // места нет вовсе
    const days = best.days, cells = best.cells;
    let ok = why !== 'overflow';
    if (sla != null && days[days.length - 1] > sla) { ok = false; why = why || 'late'; }
    occupy(cells, busy, key); put(key, cells);
    const rec = Object.assign({}, b, {
      days: cells, fixed: false, ok: ok, why: why,
      from: cells[0].iso, to: cells[cells.length - 1].iso,
      workFrom: dayIso(days[0]), workTo: dayIso(days[days.length - 1])
    });
    out.push(rec);
    if (why === 'overflow') warnings.push({
      kind: 'overflow', blockId: b.id, engineer: b.engineer || null, date: rec.workFrom,
      fixed: false, days: days.length, sla: b.sla || null,
      text: 'Свободных дней нет — работа поставлена поверх занятых.'
    });
    else if (why === 'late') warnings.push({
      kind: 'late', blockId: b.id, engineer: b.engineer || null, date: rec.workTo,
      fixed: false, sla: b.sla,
      text: 'К сроку ' + b.sla + ' не успеваем: работа заканчивается ' + rec.workTo + '.'
    });
  });

  out.sort((a, b) => dayMs(a.from) - dayMs(b.from));
  return { blocks: out, load: load, warnings: warnings };
}

// Плечи маршрута (econ_snapshot.legs) -> дорога блока.
// Плечо привязано к точкам ключами a/b (координаты с 5 знаками), поэтому
// порядок остановок можно менять — дорога находится по точке, а не по номеру.
// Первое плечо — «туда», последнее — «обратно», остальные — между работами.
export function driveOfLegs(legs) {
  const l = (legs || []).filter(x => x && ((+x.h > 0) || (+x.km > 0)));
  if (!l.length) return { toH: 0, backH: 0, midH: 0, km: 0 };
  const km = l.reduce((a, x) => a + (+x.km || 0), 0);
  if (l.length === 1) return { toH: (+l[0].h || 0) / 2, backH: (+l[0].h || 0) / 2, midH: 0, km: km };
  const toH = +l[0].h || 0, backH = +l[l.length - 1].h || 0;
  const midH = l.slice(1, -1).reduce((a, x) => a + (+x.h || 0), 0);
  return { toH: toH, backH: backH, midH: midH, km: km };
}
