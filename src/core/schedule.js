// Календарная раскладка работ. Чистые функции: на входе блоки работ и
// настройки, на выходе — когда и чем занят каждый час. Ни DOM, ни базы,
// ни сети.
//
// ПРАВИЛА (согласованы с заказчиком):
//
//  1. Единица планирования — БЛОК. Блок это либо выезд (все его заявки едут
//     вместе), либо отдельная заявка без выезда. Блоки одного инженера по
//     времени не накладываются.
//
//  2. Даты выезда, поставленные диспетчером ВРУЧНУЮ, — закон. График их не
//     двигает, он только раскладывает часы внутри них. Если часы в эти даты
//     не помещаются — это не повод сдвинуть выезд, это повод сказать админу,
//     что отрезок перегружен (warnings, kind:'overflow').
//
//  3. Блок без своих дат получает их от срока: сколько дней займёт работа,
//     считается как  часы работ / эффективная смена,  с округлением вверх;
//     эффективная смена — смена плюс допуск (те же shift_hours и
//     deviation_pct, что и в экономике). Работа начинается с начала смены:
//     влезает в допуск — делается за один день, а не размазывается на два.
//
//  4. Этап идёт СПЛОШНЫМ потоком: дорога туда → работа → дорога обратно.
//     Что не влезло в смену, переходит на следующий рабочий день с его
//     начала. Окон внутри этапа не бывает: доделал — поехал.
//     8 ч работ + 4 ч туда + 4 ч обратно при сроке в четверг = вторая
//     половина среды (дорога), четверг (работа), первая половина пятницы
//     (дорога).
//
//  5. Работа заканчивается НЕ ПОЗЖЕ срока и не попадает на выходные. Если
//     из-за выходных или занятости блок не влезает — он сдвигается влево,
//     ближе к сегодня. Если и там места нет, блок ставится как есть, а админ
//     получает предупреждение ('late' — не успеваем к сроку).
//
//  6. Ничья очередь. Неназначенные заявки (без инженера) считаются в общей
//     загрузке команды, но ни с кем не сталкиваются: у них своя дорожка.
//
//  7. РУЧНАЯ РАССТАНОВКА. Человек может подвинуть этап по часам. Тогда он
//     хранит только НАЧАЛО (день и час от начала смены), а раскладка по дням
//     считается из него тем же потоком. Начало вне дат выезда — не начало:
//     диспетчер подвинул даты, и старая расстановка отброшена с
//     предупреждением ('stale').
//
// ВРЕМЯ ЗДЕСЬ — РАБОЧИЕ ЧАСЫ, А НЕ СУТКИ. Позиция это {iso, h}: день и час
// от начала смены. Час 8 при восьмичасовой смене — это уже начало следующего
// рабочего дня, и выходные в этом счёте просто не существуют. Поэтому
// «подвинуть на два часа» — это +2 к h, и никакой особой обработки ночи,
// субботы и праздников в арифметике не требуется.

const DAY = 86400000;

export const SCHEDULE_DEFAULTS = { shiftH: 8, deviationPct: 0, weekend: [0, 6], dayStart: 8 };

// ---- Даты -------------------------------------------------------------
// Календарь считается в UTC-полуночах: без часовых поясов.
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
function effShift(s) { return (s.shiftH || 8) * (1 + ((s.deviationPct || 0) / 100)); }

// ---- Позиция во времени -----------------------------------------------
// {iso, h} — рабочий день и час от начала смены. Нормализация переносит
// переполнение на соседний рабочий день; выходных в этой шкале нет.
export function normPos(p, s) {
  const eff = effShift(s), w = s.weekend;
  let iso = p.iso, h = +p.h || 0;
  let ms = snapWork(dayMs(iso), 1, w);
  iso = dayIso(ms);
  let guard = 0;
  while (h >= eff - 1e-9 && guard++ < 400) { h -= eff; ms = stepWork(ms, 1, w); iso = dayIso(ms); }
  guard = 0;
  while (h < -1e-9 && guard++ < 400) { ms = stepWork(ms, -1, w); iso = dayIso(ms); h += eff; }
  return { iso: iso, h: +h.toFixed(6) };
}
export function addHours(p, dh, s) { return normPos({ iso: p.iso, h: (+p.h || 0) + dh }, s); }
// Сколько рабочих часов от a до b (b − a). Нужна и для сравнения позиций.
export function diffHours(a, b, s) {
  const eff = effShift(s), w = s.weekend;
  let ms = snapWork(dayMs(a.iso), 1, w), to = snapWork(dayMs(b.iso), 1, w);
  let n = 0, guard = 0;
  const dir = ms <= to ? 1 : -1;
  while (ms !== to && guard++ < 4000) { ms = stepWork(ms, dir, w); n += dir * eff; }
  return n + ((+b.h || 0) - (+a.h || 0));
}
function posLE(a, b, s) { return diffHours(a, b, s) >= -1e-6; }

// ---- Куски этапа по дням ----------------------------------------------
// segs — отрезки по порядку поездки: [{k:'d'|'w', h}]. Возвращает куски,
// разрезанные по границам смены: [{iso, from, to, h, k}].
export function piecesOf(start, segs, s) {
  const eff = effShift(s);
  const out = [];
  let p = normPos(start, s), guard = 0;
  (segs || []).forEach(seg => {
    let left = +seg.h || 0;
    while (left > 1e-9 && guard++ < 2000) {
      const take = Math.min(left, eff - p.h);
      if (take > 1e-9) {
        out.push({ iso: p.iso, from: +p.h.toFixed(6), to: +(p.h + take).toFixed(6), h: +take.toFixed(6), k: seg.k });
        left -= take;
      }
      p = addHours(p, Math.max(take, 1e-9), s);
    }
  });
  return out;
}
// Куски → дни: [{iso, ms, workH, driveH}] в порядке календаря.
function cellsOf(pieces) {
  const m = new Map();
  pieces.forEach(p => {
    const c = m.get(p.iso) || { iso: p.iso, ms: dayMs(p.iso), workH: 0, driveH: 0 };
    if (p.k === 'w') c.workH += p.h; else c.driveH += p.h;
    m.set(p.iso, c);
  });
  return Array.from(m.values()).sort((a, b) => a.ms - b.ms);
}

// ---- Отрезки блока ----------------------------------------------------
// Порядок поездки: дорога туда, работа (с промежуточной дорогой внутри),
// дорога обратно. Промежуточные плечи считаются работой по времени: они
// стоят между заявками и занимают тот же день.
function segsOf(b) {
  const out = [];
  if (b.driveToH > 0) out.push({ k: 'd', h: b.driveToH });
  const work = (+b.workH || 0) + (+b.driveMidH || 0);
  if (work > 0) out.push({ k: 'w', h: work });
  if (b.driveBackH > 0) out.push({ k: 'd', h: b.driveBackH });
  return out.length ? out : [{ k: 'w', h: 0 }];
}
function daysNeeded(workH, s) {
  const eff = effShift(s);
  if (!(workH > 0) || !(eff > 0)) return 1;
  return Math.max(1, Math.ceil(+(workH / eff).toFixed(6)));
}

// ---- Занятость дорожки ------------------------------------------------
// Часы занимаются интервалами внутри дня: два этапа могут стоять в одном
// дне встык, и это правильнее прежнего «один день — одна работа».
function busyAdd(busy, key, pieces) {
  pieces.forEach(p => {
    const k = key + '|' + p.iso;
    (busy[k] || (busy[k] = [])).push([p.from, p.to]);
  });
}
function busyFree(busy, key, pieces) {
  return pieces.every(p => {
    const list = busy[key + '|' + p.iso]; if (!list) return true;
    return list.every(iv => p.to <= iv[0] + 1e-6 || p.from >= iv[1] - 1e-6);
  });
}

// Разорван ли этап выходными: от первого дня до последнего не должно быть
// нерабочего дня. Иначе выезд «поработали в пятницу, вернулись в понедельник»
// выглядит нормальным планом, хотя машина простоит два дня в поле.
// Этап длиннее рабочей недели проверять бессмысленно — там выходные
// неизбежны.
function unbroken(pieces, s) {
  if (!pieces.length) return true;
  const days = {}; pieces.forEach(p => { days[p.iso] = 1; });
  if (Object.keys(days).length > 5) return true;
  const a = dayMs(pieces[0].iso), z = dayMs(pieces[pieces.length - 1].iso);
  for (let x = a; x <= z; x += DAY) if (!isWorkday(x, s.weekend)) return false;
  return true;
}

// ---- Заявки внутри блока ----------------------------------------------
// Внутри выезда заявки делаются ПО ПОРЯДКУ маршрута. День сдачи — тот, в
// котором кончились её часы. Без этого заявка со сроком в середине выезда
// считалась просроченной по дате возвращения.
function assignJobs(block, pieces) {
  const out = {};
  const list = (block.jobs || []).filter(j => j && j.id);
  if (!list.length) return out;
  const work = pieces.filter(p => p.k === 'w');
  if (!work.length) {
    const last = pieces.length ? pieces[pieces.length - 1].iso : null;
    list.forEach(j => { out[j.id] = last; });
    return out;
  }
  let i = 0, left = work[0].h;
  list.forEach(j => {
    let need = +j.workH || 0, guard = 0;
    while (need > 1e-6 && guard++ < 400) {
      const take = Math.min(need, left);
      need -= take; left -= take;
      if (need > 1e-6) {
        if (i < work.length - 1) { i++; left = work[i].h; }
        else { left = Infinity; }
      }
    }
    out[j.id] = work[Math.min(i, work.length - 1)].iso;
    if (left <= 1e-6 && i < work.length - 1) { i++; left = work[i].h; }
  });
  return out;
}
function lateJobs(block, jobDays, workTo) {
  const list = (block.jobs || []).filter(j => j && j.sla);
  const out = [];
  if (list.length) {
    list.forEach(j => {
      const day = (jobDays && jobDays[j.id]) || workTo;
      if (day && dayMs(day) > dayMs(j.sla)) out.push({ id: j.id, sla: j.sla, day: day });
    });
    return out;
  }
  if (block.sla && workTo && dayMs(workTo) > dayMs(block.sla))
    out.push({ id: block.id, sla: block.sla, day: workTo });
  return out;
}

// ---- Ручная расстановка -----------------------------------------------
// Хранится одно: начало этапа. Всё остальное — те же отрезки, тот же поток.
// Поэтому изменение часов работ ручную расстановку НЕ ломает: этап просто
// станет длиннее или короче от той же точки.
function manualStart(b, s) {
  const p = b.plan && b.plan.start;
  if (!p || !p.d || dayMs(p.d) == null) return null;
  const pos = normPos({ iso: p.d, h: +p.h || 0 }, s);
  // У выезда с ручными датами начало обязано лежать внутри них: диспетчер
  // подвинул даты — старая расстановка больше не про этот выезд.
  if (b.from) {
    const a = dayMs(b.from), z = dayMs(b.to || b.from);
    const x = dayMs(pos.iso);
    if (x < a || x > z) return { pos: pos, stale: true };
  }
  return { pos: pos, stale: false };
}

// ---- Главная функция --------------------------------------------------
//   planSchedule(blocks, settings, { today })
//     -> { blocks: [{...block, start, pieces, days, from, to, workFrom, workTo,
//                    jobDays, manual, ok, why}],
//          load:  { 'инженер|дата': {engineer, date, workH, driveH, cap} },
//          warnings: [{kind, blockId, engineer, date, text}] }
export function planSchedule(blocks, settings, opts) {
  const s = Object.assign({}, SCHEDULE_DEFAULTS, settings || {});
  const o = opts || {};
  const eff = effShift(s);
  const today = dayMs(o.today) != null ? dayMs(o.today) : dayMs(dayIso(Date.now()));
  const busy = {};
  const load = {};
  const warnings = [];
  const out = [];

  const put = (key, pieces) => {
    pieces.forEach(p => {
      const k = key + '|' + p.iso;
      const l = load[k] || (load[k] = { engineer: key, date: p.iso, workH: 0, driveH: 0, cap: eff });
      if (p.k === 'w') l.workH += p.h; else l.driveH += p.h;
    });
  };
  const laneOf = b => (b.engineer || ' free');

  const norm = (blocks || []).map(b => Object.assign({
    kind: 'job', workH: 0, driveToH: 0, driveBackH: 0, driveMidH: 0, jobIds: []
  }, b));

  const fixed = norm.filter(b => b.from);
  const free = norm.filter(b => !b.from);
  // Выезды раньше одиночных заявок: выезд уже спланирован как поездка, и
  // подвинуть проще одиночную работу, чем разобрать выезд.
  free.sort((a, b) => {
    const ka = a.kind === 'trip' ? 0 : 1, kb = b.kind === 'trip' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    const x = dayMs(a.sla), y = dayMs(b.sla);
    return (x == null ? 8.64e15 : x) - (y == null ? 8.64e15 : y);
  });

  const finish = (b, start, extra) => {
    const segs = segsOf(b);
    const pieces = piecesOf(start, segs, s);
    const days = cellsOf(pieces);
    const wp = pieces.filter(p => p.k === 'w');
    const jobDays = assignJobs(b, pieces);
    const rec = Object.assign({}, b, {
      start: start, segs: segs, pieces: pieces, days: days, jobDays: jobDays,
      from: days.length ? days[0].iso : start.iso,
      to: days.length ? days[days.length - 1].iso : start.iso,
      workFrom: wp.length ? wp[0].iso : (days.length ? days[0].iso : start.iso),
      workTo: wp.length ? wp[wp.length - 1].iso : (days.length ? days[days.length - 1].iso : start.iso),
      ok: true, why: ''
    }, extra || {});
    const key = laneOf(b);
    busyAdd(busy, key, pieces); put(key, pieces);
    // Перегруз: день, в котором сумма всех дорожек этого инженера вышла за
    // смену. Считается по итогу дня, а не по одному блоку.
    const over = days.filter(d => {
      const l = load[key + '|' + d.iso];
      return l && (l.workH + l.driveH) > eff + 1e-6;
    });
    if (over.length) {
      rec.ok = false; rec.why = 'overflow';
      warnings.push({
        kind: 'overflow', blockId: b.id, engineer: b.engineer || null, date: over[0].iso,
        fixed: !!b.from, days: over.length, sla: b.sla || null,
        text: 'В дне больше часов, чем в смене (с ' + over[0].iso + ').'
      });
    }
    const lateJ = lateJobs(b, jobDays, rec.workTo);
    if (lateJ.length) {
      rec.ok = false; rec.why = rec.why || 'late'; rec.lateJobs = lateJ;
      warnings.push({
        kind: 'late', blockId: b.id, engineer: b.engineer || null, date: lateJ[0].day,
        fixed: !!b.from, sla: lateJ[0].sla, jobId: lateJ[0].id, jobs: lateJ.length,
        text: 'Срок ' + lateJ[0].sla + ', а работа по ней заканчивается ' + lateJ[0].day + '.'
      });
    }
    // Часы не влезли в даты выезда. Даты — закон, двигать их график не
    // вправе, но и молчать нельзя: работа физически заканчивается позже.
    if (b.from && b.to && dayMs(rec.to) > dayMs(b.to)) {
      rec.ok = false; rec.why = rec.why || 'overflow';
      warnings.push({
        kind: 'overflow', blockId: b.id, engineer: b.engineer || null, date: rec.to,
        fixed: true, days: 0, sla: b.sla || null,
        text: 'Не помещается в даты выезда: работа заканчивается ' + rec.to + ', а выезд стоит по ' + b.to + '.'
      });
    }
    if (rec.stalePlan) warnings.push({
      kind: 'stale', blockId: b.id, engineer: b.engineer || null, date: rec.from,
      fixed: !!b.from, sla: b.sla || null,
      text: 'Ручная расстановка не попадает в даты выезда — этап расставлен заново.'
    });
    out.push(rec);
    return rec;
  };

  // ── Выезды с ручными датами ──────────────────────────────────────────
  fixed.forEach(b => {
    const man = manualStart(b, s);
    const auto = normPos({ iso: dayIso(snapWork(dayMs(b.from), 1, s.weekend)), h: 0 }, s);
    const start = (man && !man.stale) ? man.pos : auto;
    finish(b, start, { fixed: true, manual: !!(man && !man.stale), stalePlan: !!(man && man.stale) });
  });

  // ── Всё остальное ────────────────────────────────────────────────────
  free.forEach(b => {
    const man = manualStart(b, s);
    if (man && !man.stale) {
      finish(b, man.pos, { fixed: false, manual: true, stalePlan: false });
      return;
    }
    const key = laneOf(b);
    const segs = segsOf(b);
    const n = daysNeeded((+b.workH || 0) + (+b.driveMidH || 0), s);
    const sla = dayMs(b.sla);
    const floor = snapWork(today, 1, s.weekend);
    // Работа занимает n рабочих дней, последний из которых — день срока, и
    // начинается с начала смены. Дорога туда встаёт ПЕРЕД работой, дорога
    // обратно — сразу за ней.
    const startFor = wEndDayMs => {
      let d = snapWork(wEndDayMs, -1, s.weekend);
      for (let i = 1; i < n; i++) d = stepWork(d, -1, s.weekend);
      const wStart = normPos({ iso: dayIso(d), h: 0 }, s);
      return addHours(wStart, -(+b.driveToH || 0), s);
    };
    const workEnd = pcs => { const w = pcs.filter(p => p.k === 'w'); return w.length ? w[w.length - 1].iso : (pcs.length ? pcs[pcs.length - 1].iso : null); };
    let endDay = sla != null ? snapWork(sla, -1, s.weekend) : floor;
    if (dayMs(startFor(endDay).iso) < floor) {           // в прошлое не планируем
      endDay = floor;
      for (let i = 1; i < n; i++) endDay = stepWork(endDay, 1, s.weekend);
    }
    // Кандидаты одного дня: выровненный по началу смены и сдвинутые на
    // полчаса вперёд. Второй этап в тот же день должен вставать ЗА первым,
    // а не уезжать на сутки назад — день делится, если в нём есть место.
    const slots = Math.round(effShift(s) * 2);
    const candidates = endDayMs => {
      const base = startFor(endDayMs), list = [base];
      for (let k = 1; k <= slots; k++) list.push(addHours(base, k * 0.5, s));
      return list;
    };
    let start = startFor(endDay), best = null, loose = null, anyFree = null;
    for (let i = 0; i < 90; i++) {
      const cands = candidates(endDay);
      for (let c = 0; c < cands.length; c++) {
        const st = cands[c], pcs = piecesOf(st, segs, s);
        if (!busyFree(busy, key, pcs)) continue;
        if (!anyFree) anyFree = st;
        const inTime = sla == null || dayMs(workEnd(pcs)) <= sla;
        if (!inTime) continue;
        if (!loose) loose = st;
        if (unbroken(pcs, s)) { best = st; break; }
      }
      if (best) break;
      const prev = stepWork(endDay, -1, s.weekend);
      if (dayMs(startFor(prev).iso) < floor) break;      // левее сегодня некуда
      endDay = prev;
    }
    start = best || loose || anyFree || start;
    if (!best && !loose && !anyFree) {
      // Свободного часа нет вовсе — ищем вправо: опоздать честнее, чем
      // встать поверх занятого.
      let e = stepWork(sla != null ? snapWork(sla, -1, s.weekend) : floor, 1, s.weekend);
      for (let i = 0; i < 90; i++) {
        const cands = candidates(e);
        const ok = cands.find(st => busyFree(busy, key, piecesOf(st, segs, s)));
        if (ok) { start = ok; break; }
        e = stepWork(e, 1, s.weekend);
      }
    }
    finish(b, start, { fixed: false, manual: false, stalePlan: false });
  });

  out.sort((a, b) => (dayMs(a.from) - dayMs(b.from)) || (a.start.h - b.start.h));
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

// Часы в текст: 08:00 при dayStart 8. Нужен ганту и подсказкам.
export function clockOf(h, s) {
  const st = (s && s.dayStart != null) ? +s.dayStart : SCHEDULE_DEFAULTS.dayStart;
  const t = st + (+h || 0);
  const hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
