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
//  3. Блок без своих дат получает их от срока. Производственный календарь
//     задаётся окном dayStart–dayEnd и почасовым toleranceH. Тарифные
//     shift_hours/deviation_pct сюда намеренно не входят.
//
//  4. Автоматическая раскладка идёт СПЛОШНЫМ потоком: дорога туда → работа
//     → дорога обратно. Что не влезло в смену, переходит на следующий
//     рабочий день. Диспетчер может вручную раздвинуть отдельные участки.
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
//  7. РУЧНАЯ РАССТАНОВКА. Начало и разрезы хранят настоящие часы суток.
//     Разрез прибит к количеству уже пройденных часов блока, поэтому изменение
//     состава сегментов не ломает весь план. Устаревший разрез даёт warning.
//
// ВРЕМЯ ЗДЕСЬ — ЧАСЫ СУТОК. Позиция {iso,t}, где t=7 означает 07:00.
// Переход между днями всегда проходит через индивидуальное окно staffDay.

const DAY = 86400000;

export const SCHEDULE_DEFAULTS = { dayStart: 7, dayEnd: 16, toleranceH: 1, weekend: [0, 6], staffDay: {} };
export const SCHEDULE_TIME_ZONE = 'Europe/Kyiv';

// График относится к рабочему часовому поясу компании, а не к часовому
// поясу браузера. Это особенно важно для планшетов/терминалов, где системная
// зона нередко остаётся UTC или фиксированным GMT+2 и отстаёт летом на час.
export function scheduleNowAt(date, dayStart, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || SCHEDULE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date || new Date()).reduce((out, p) => {
    if (p.type !== 'literal') out[p.type] = p.value;
    return out;
  }, {});
  const hour = +parts.hour, minute = +parts.minute;
  return {
    iso: parts.year + '-' + parts.month + '-' + parts.day,
    t: hour + minute / 60,
    label: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
  };
}

// Закрытая заявка остаётся частью хронологии, пока жив её выезд: работа уже
// сделана, но дорога до следующей точки от этого не переносится назад.
export function scheduleJobIncluded(status, tripStatus) {
  if (status === 'cancelled') return false;
  if (status !== 'done') return true;
  return !!tripStatus && tripStatus !== 'done' && tripStatus !== 'cancelled';
}

// Строит хронологию старого маршрута, у которого сохранено только общее
// время дороги, но ещё нет econ_snapshot.legs. Дорога распределяется между
// фактическими соседними точками (включая промежуточные), а работы вставляются
// непосредственно после соответствующей клиентской точки.
export function tripRouteSegments(stops, jobs, legs, totalDriveH) {
  const points = stops || [], work = jobs || [], road = legs || [];
  const remaining = new Set(work.map(j => j.id));
  const at = points.map(p => work.filter(j => j.key && j.key === p.key));
  at.forEach(list => list.forEach(j => remaining.delete(j.id)));
  const found = [];
  let known = 0, missing = 0;
  for (let i = 1; i < points.length; i++) {
    const leg = road.find(x => x && x.a === points[i - 1].key && x.b === points[i].key) || road[i - 1];
    const h = +(leg && leg.h) || 0;
    found.push(h);
    if (h > 0) known += h; else missing++;
  }
  const fallback = missing ? Math.max(0, (+totalDriveH || 0) - known) / missing : 0;
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const h = found[i - 1] || fallback;
    if (h > 0) out.push({ k: 'd', h, jobId: null });
    at[i].forEach(j => {
      if (+j.h > 0) out.push({ k: 'w', h: +j.h, jobId: j.id || null });
    });
  }
  work.filter(j => remaining.has(j.id) && +j.h > 0)
    .forEach(j => out.push({ k: 'w', h: +j.h, jobId: j.id || null }));
  return out;
}

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
export const q4 = x => Math.round((+x || 0) * 4) / 4;

export function dayWindow(engineer, iso, settings) {
  const s=Object.assign({},SCHEDULE_DEFAULTS,settings||{});
  if(!isWorkday(dayMs(iso),s.weekend)) return null;
  const o=(s.staffDay||{})[(engineer||' free')+'|'+iso]||{};
  const start=o.start_h==null?+s.dayStart:+o.start_h;
  const end=o.end_h==null?+s.dayEnd:+o.end_h;
  const tol=o.tol_h==null?+s.toleranceH:+o.tol_h;
  if(!(end>start)) return null;
  return {start,end,tol,ceiling:Math.min(24,end+Math.max(0,tol)),proposedEnd:o.proposed_end_h==null?null:+o.proposed_end_h};
}
function windowHours(s){ return Math.max(.25,(+s.dayEnd||16)-(+s.dayStart||7)+Math.max(0,+s.toleranceH||0)); }

// ---- Позиция во времени -----------------------------------------------
// {iso, t} — рабочий день и настоящий час суток.
export function normPos(p, s) {
  s=Object.assign({},SCHEDULE_DEFAULTS,s||{});
  const w=s.weekend; let ms=snapWork(dayMs(p.iso),1,w), iso=dayIso(ms), t=Number.isFinite(+p.t)?+p.t:+s.dayStart;
  let win=dayWindow(p.engineer,iso,s),guard=0;
  while((!win||t>=win.ceiling-1e-9)&&guard++<400){ ms=stepWork(ms,1,w); iso=dayIso(ms); win=dayWindow(p.engineer,iso,s); t=win?win.start:+s.dayStart; }
  if(win&&t<win.start) t=win.start;
  return {iso,t:+t.toFixed(6)};
}
export function addHours(p, dh, s, engineer) {
  s=Object.assign({},SCHEDULE_DEFAULTS,s||{});
  const owner=engineer||p.engineer;let cur=normPos({...p,engineer:owner},s),left=+dh||0,guard=0;
  if(left<0){
    while(left<-.000001&&guard++<400){ const w=dayWindow(owner,cur.iso,s),room=cur.t-(w?w.start:+s.dayStart);
      if(-left<=room) return {iso:cur.iso,t:+(cur.t+left).toFixed(6)};
      left+=room; const ms=stepWork(dayMs(cur.iso),-1,s.weekend); cur={iso:dayIso(ms),t:dayWindow(owner,dayIso(ms),s).ceiling}; }
    return cur;
  }
  while(left>.000001&&guard++<400){ const w=dayWindow(owner,cur.iso,s),room=w.ceiling-cur.t,take=Math.min(left,room); cur.t+=take;left-=take;
    if(left>.000001){ const ms=stepWork(dayMs(cur.iso),1,s.weekend),iso=dayIso(ms);cur={iso,t:dayWindow(owner,iso,s).start}; } }
  return {iso:cur.iso,t:+cur.t.toFixed(6)};
}
// Сколько рабочих часов от a до b (b − a). Нужна и для сравнения позиций.
export function diffHours(a, b, s) {
  s=Object.assign({},SCHEDULE_DEFAULTS,s||{});
  if(dayMs(a.iso)===dayMs(b.iso)) return (+b.t||0)-(+a.t||0);
  const dir=dayMs(a.iso)<dayMs(b.iso)?1:-1;
  if(dir<0) return -diffHours(b,a,s);
  let n=0,ms=dayMs(a.iso),guard=0;
  const aw=dayWindow(a.engineer,a.iso,s); n+=(aw?aw.ceiling-(+a.t||aw.start):0);
  ms+=DAY;
  while(ms<dayMs(b.iso)&&guard++<4000){const iso=dayIso(ms),w=dayWindow(a.engineer,iso,s);if(w)n+=w.ceiling-w.start;ms+=DAY;}
  const bw=dayWindow(b.engineer,b.iso,s); return n+(bw?(+b.t||bw.start)-bw.start:0);
}
function posLE(a, b, s) { return diffHours(a, b, s) >= -1e-6; }

// ---- Куски этапа по дням ----------------------------------------------
// segs — отрезки по порядку поездки: [{k:'d'|'w', h}]. Возвращает куски,
// разрезанные по границам смены: [{iso, from, to, h, k}].
export function piecesOf(start, segs, s, engineer, cuts) {
  s=Object.assign({},SCHEDULE_DEFAULTS,s||{});
  const out=[], total=(segs||[]).reduce((n,x)=>n+(+x.h||0),0);
  const valid=(cuts||[]).filter(c=>c&&+c.after>0&&+c.after<total&&c.at&&c.at.d&&Number.isFinite(+c.at.t))
    .sort((a,b)=>a.after-b.after);
  let p=normPos({iso:start.iso,t:start.t,engineer},s),placed=0,ci=0,guard=0;
  (segs||[]).forEach((seg,segIndex)=>{
    let left=+seg.h||0,used=0;
    while(left>1e-9&&guard++<2000){
      let pinned=false;
      if(ci<valid.length&&placed>=valid[ci].after-1e-9){const c=valid[ci++];p=normPos({iso:c.at.d,t:+c.at.t,engineer},s);pinned=true;}
      const w=dayWindow(engineer,p.iso,s);
      const toCut=ci<valid.length?valid[ci].after-placed:Infinity;
      const take=Math.min(left,w.ceiling-p.t,toCut);
      if(take>1e-9){out.push({iso:p.iso,from:+p.t.toFixed(6),to:+(p.t+take).toFixed(6),h:+take.toFixed(6),k:seg.k,
        jobId:seg.jobId||null,segIndex:seg.segIndex==null?segIndex:seg.segIndex,segOffset:+used.toFixed(6),at:+placed.toFixed(6),pinned});
        p.t+=take;left-=take;used+=take;placed+=take;}
      if(p.t>=w.ceiling-1e-9)p=normPos({iso:dayIso(dayMs(p.iso)+DAY),t:s.dayStart,engineer},s);
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
// Порядок поездки: дорога туда, работа у точки, дорога к следующей точке,
// работа у неё и так до возвращения. Старые снимки знают только три суммы,
// поэтому для них остаётся прежний запасной порядок.
export function compactRoadSegments(segs) {
  const out=[];
  (segs||[]).filter(x=>x&&(+x.h||0)>0).forEach(x=>{
    const seg={k:x.k==='d'?'d':'w',h:+x.h||0,jobId:x.jobId||null};
    const prev=out[out.length-1];
    // Несколько технических плеч между депо, waypoint и клиентом — одна
    // непрерывная дорога. Работы не объединяем: их jobId нужен срокам.
    if(seg.k==='d'&&prev&&prev.k==='d') prev.h+=seg.h;
    else out.push(seg);
  });
  return out;
}

// Видимая шкала увеличенного дня. В автоматическом режиме всегда показывает
// 07:00–16:00 и расширяется наружу, если график начинается раньше или
// заканчивается позже. Ручная шкала намеренно не расширяется.
export function dayScaleBounds(pieces, dayStart=7, manual=null) {
  if(manual&&Number.isFinite(+manual.from)&&Number.isFinite(+manual.to)&&+manual.to>+manual.from)
    return {from:+manual.from,to:+manual.to,manual:true};
  let from=7,to=16;
  (pieces||[]).forEach(p=>{
    const start=+p.from||0, end=+p.to||start+(+p.h||0);
    from=Math.min(from,Math.floor(start*2)/2);
    to=Math.max(to,Math.ceil(end*2)/2);
  });
  return {from,to:Math.max(from+.5,to),manual:false};
}

export function weekRowSpan(iso,engineers,pieces,settings,pxPerHour=5){
  const wins=(engineers||[]).map(e=>dayWindow(e,iso,settings));
  if(wins.every(w=>!w)) return {weekend:true,top:0,bot:24,px:30};
  const active=wins.filter(Boolean),top=Math.min(...active.map(w=>w.start));
  let bot=Math.max(...active.map(w=>w.end));
  (engineers||[]).forEach((e,i)=>{const w=wins[i];if(!w)return;
    const last=(pieces||[]).filter(p=>p.engineer===e&&p.iso===iso).reduce((m,p)=>Math.max(m,+p.to||0),0);
    bot=Math.max(bot,Math.min(w.ceiling,last||w.end));});
  return {weekend:false,top,bot,px:Math.max(30,Math.round((bot-top)*pxPerHour))};
}
function segsOf(b) {
  if (Array.isArray(b.routeSegs) && b.routeSegs.length) {
    const raw=b.routeSegs.filter(x => x && (+x.h || 0) > 0)
      .map(x => ({ k: x.k === 'd' ? 'd' : 'w', h: +x.h || 0, jobId: x.jobId || null }));
    // Уже сохранённую раскладку старого формата не ломаем. После сброса к
    // авто или нового сохранения она перейдёт на объединённые дороги.
    if(b.plan&&Array.isArray(b.plan.parts)&&b.plan.parts.length===raw.length) return raw;
    return compactRoadSegments(raw);
  }
  const out = [];
  if (b.driveToH > 0) out.push({ k: 'd', h: b.driveToH });
  const work = (+b.workH || 0) + (+b.driveMidH || 0);
  if (work > 0) out.push({ k: 'w', h: work });
  if (b.driveBackH > 0) out.push({ k: 'd', h: b.driveBackH });
  return out.length ? out : [{ k: 'w', h: 0 }];
}
function daysNeeded(workH, s) {
  const eff = windowHours(s);
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
  // Новые снимки несут id заявки прямо в отрезке маршрута. Тогда закрытие
  // или изменение часов соседней заявки не может перепривязать день сдачи.
  work.forEach(p => { if (p.jobId) out[p.jobId] = p.iso; });
  if (list.every(j => out[j.id])) return out;
  let i = 0, left = work[0].h;
  list.forEach(j => {
    if (out[j.id]) return;
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
  const legacy=Number.isFinite(+p.h)?(+s.dayStart||7)+(+p.h):null;
  const pos = normPos({ iso: p.d, t: Number.isFinite(+p.t)?+p.t:legacy, engineer:b.engineer }, s);
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
  const today = dayMs(o.today) != null ? dayMs(o.today) : dayMs(dayIso(Date.now()));
  const busy = {};
  const load = {};
  const warnings = [];
  const out = [];

  const put = (key, pieces) => {
    pieces.forEach(p => {
      const k = key + '|' + p.iso;
      const w=dayWindow(key,p.iso,s), cap=w?w.end-w.start:0;
      const l = load[k] || (load[k] = { engineer: key, date: p.iso, workH: 0, driveH: 0, cap, ceiling:w?w.ceiling-w.start:0,window:w });
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
    const baseSegs = segsOf(b);
    const cuts=(b.plan&&b.plan.cuts)||[];
    const staleCuts=cuts.filter(c=>!c||!(+c.after>0)||+c.after>=baseSegs.reduce((n,x)=>n+(+x.h||0),0)||!c.at||!dayWindow(b.engineer,c.at.d,s)||(b.from&&(dayMs(c.at.d)<dayMs(b.from)||dayMs(c.at.d)>dayMs(b.to||b.from))));
    const validCuts=cuts.filter(c=>!staleCuts.includes(c));
    const pieces = piecesOf(start,baseSegs,s,b.engineer,validCuts);
    const days = cellsOf(pieces);
    const wp = pieces.filter(p => p.k === 'w');
    const jobDays = assignJobs(b, pieces);
    const rec = Object.assign({}, b, {
      start: pieces.length ? {iso:pieces[0].iso,t:pieces[0].from} : start,
      segs: baseSegs, pieces: pieces, days: days, jobDays: jobDays,
      from: days.length ? days[0].iso : start.iso,
      to: days.length ? days[days.length - 1].iso : start.iso,
      workFrom: wp.length ? wp[0].iso : (days.length ? days[0].iso : start.iso),
      workTo: wp.length ? wp[wp.length - 1].iso : (days.length ? days[days.length - 1].iso : start.iso),
      workH:pieces.filter(p=>p.k==='w').reduce((n,p)=>n+p.h,0),
      ok: true, why: '', manualParts: validCuts.length>0, cuts:validCuts
    }, extra || {});
    const key = laneOf(b);
    busyAdd(busy, key, pieces); put(key, pieces);
    // Перегруз: день, в котором сумма всех дорожек этого инженера вышла за
    // смену. Считается по итогу дня, а не по одному блоку.
    const over = days.filter(d => {
      const l = load[key + '|' + d.iso];
      return l && (l.workH + l.driveH) > l.ceiling + 1e-6;
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
    staleCuts.forEach(()=>warnings.push({kind:'stale',blockId:b.id,engineer:b.engineer||null,date:rec.from,fixed:!!b.from,sla:b.sla||null,text:'Ручной разрез устарел и не применён.'}));
    out.push(rec);
    return rec;
  };

  // ── Выезды с ручными датами ──────────────────────────────────────────
  fixed.forEach(b => {
    const man = manualStart(b, s);
    const auto = normPos({ iso: dayIso(snapWork(dayMs(b.from), 1, s.weekend)), t:s.dayStart,engineer:b.engineer }, s);
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
      const wStart = normPos({ iso: dayIso(d), t:s.dayStart,engineer:b.engineer }, s);
      return addHours(wStart, -(+b.driveToH || 0), s,b.engineer);
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
    const slots = Math.round(windowHours(s) * 4);
    const candidates = endDayMs => {
      const base = startFor(endDayMs), list = [base];
      for (let k = 1; k <= slots; k++) list.push(addHours(base,k*.25,s,b.engineer));
      return list;
    };
    let start = startFor(endDay), best = null, loose = null, anyFree = null;
    for (let i = 0; i < 90; i++) {
      const cands = candidates(endDay);
      for (let c = 0; c < cands.length; c++) {
        const st = cands[c], pcs = piecesOf(st,segs,s,b.engineer,[]);
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
        const ok = cands.find(st => busyFree(busy,key,piecesOf(st,segs,s,b.engineer,[])));
        if (ok) { start = ok; break; }
        e = stepWork(e, 1, s.weekend);
      }
    }
    finish(b, start, { fixed: false, manual: false, stalePlan: false });
  });

  out.sort((a, b) => (dayMs(a.from) - dayMs(b.from)) || (a.start.t - b.start.t));
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
