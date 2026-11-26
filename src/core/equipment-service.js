// Прогноз ТО техники по плану ТО модели (26.11.2026).
//
// План ТО — уровни по моточасам: ТО-1 каждые 250 мч, ТО-2 каждые 500, ТО-3
// каждые 1000. Отметки считаются от нуля счётчика; на отметке делается
// старший уровень, интервал которого её делит. У уровня может быть и
// календарный срок — что наступит раньше. Плана нет — один уровень «ТО» с
// базовым интервалом модели.
//
// Когда ТО сделано, отмечаются моточасы (замер kind = 'service'): от них
// считается следующая отметка. Темп наработки — из замеров техники, иначе
// средний по технике той же точки, иначе рабочая смена в будний день.
import { businessDays } from './format.js';
import { rateFrom } from './tariff.js';

const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const at = v => new Date(String(v).slice(0, 10) + 'T00:00:00Z');

export function addBusinessDays(from, n) {
  const d = at(from);
  let left = Math.max(0, Math.ceil(n));
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return iso(d);
}
export function addMonths(from, n) { const d = at(from); d.setUTCMonth(d.getUTCMonth() + Number(n)); return iso(d); }
export function calendarDays(from, to) { return Math.round((at(to) - at(from)) / DAY); }

export function serviceState(days, soonDays = 30) {
  if (days == null) return 'unknown';
  return days < 0 ? 'overdue' : days <= soonDays ? 'soon' : 'ok';
}

// Уровни плана по возрастанию интервала; без плана — базовый интервал модели.
export function planLevels(model, levels = []) {
  const own = (levels || []).filter(l => +l.interval_hours > 0).map(l => ({ ...l, interval_hours: +l.interval_hours })).sort((a, b) => a.interval_hours - b.interval_hours);
  if (own.length) return own;
  const base = +model?.service_interval_hours || 0;
  return base > 0 ? [{ id: null, name: 'ТО', interval_hours: base, interval_months: null, works: [], materials: [] }] : [];
}
// Уровень на отметке: старший, чей интервал делит отметку.
export function levelAt(levels, mark) {
  let best = levels[0] || null;
  for (const l of levels) { const k = mark / l.interval_hours; if (Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) > 0) best = l; }
  return best;
}
// Отметка, которую закрыло ТО при этих моточасах: ближайшая к ним отметка шага.
export function coveredMark(hours, step) { return Math.max(0, Math.round(hours / step) * step); }

// readings — замеры этой техники по возрастанию даты; peerReadings — замеры
// остальной техники точки (массив массивов).
export function serviceForecast(e, { model, levels = [], readings = [], peerReadings = [], shiftHours = 0, today, soonDays = 30 } = {}) {
  const plan = planLevels(model, levels);
  if (!e || !plan.length) return null;
  const now = today || iso(new Date()), step = plan[0].interval_hours, sh = +shiftHours || 0;
  let rate = rateFrom(readings), src = 'unit';
  if (!(rate > 0)) {
    const rates = peerReadings.map(rateFrom).filter(r => r > 0);
    rate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    src = rates.length ? 'client' : 'none';
  }
  const services = readings.filter(r => r.kind === 'service');
  const lastSvc = services.at(-1) || null;
  const last = readings.at(-1) || null;
  const monthsDue = (from, level) => { const m = level?.interval_months || Math.min(...plan.map(l => l.interval_months || Infinity)); return from && Number.isFinite(m) ? addMonths(from, m) : null; };
  const finish = (base) => {
    const byMonths = monthsDue(base.anchorDate, base.level);
    let dueDate = base.byHours, byCalendar = false;
    if (byMonths && (!dueDate || byMonths < dueDate)) { dueDate = byMonths; byCalendar = true; }
    const days = dueDate ? calendarDays(now, dueDate) : null;
    return { ...base, dueDate, byCalendar, days, daysLeft: base.rate > 0 ? days : null, state: serviceState(days, soonDays), interval: base.dueHours != null && base.baseHours != null ? base.dueHours - base.baseHours : step, plan };
  };
  if (!last) {
    // Замеров нет — оценка по сменам от последнего ТО (или установки).
    const anchor = e.last_service || e.installed_on || null;
    if (!anchor || sh <= 0) {
      const byMonths = anchor ? monthsDue(anchor, plan[0]) : null;
      if (!byMonths) return null;
      return finish({ src: 'calendar', rate: 0, since: null, nowMh: null, baseHours: null, dueHours: null, level: plan[0], anchorDate: anchor, byHours: null });
    }
    const since = businessDays(anchor, now) * sh;
    return finish({ src: 'estimate', rate: 0, since, nowMh: null, baseHours: 0, dueHours: step, level: plan[0], anchorDate: anchor, byHours: addBusinessDays(anchor, step / sh) });
  }
  if (!(rate > 0) && sh > 0) { rate = sh * 5 / 7; src = 'shift'; }
  const nowMh = (+last.moto_hours) + (rate > 0 ? rate * Math.max(0, calendarDays(last.taken_on, now)) : 0);
  // Отсчёт — последнее отмеченное ТО; его нет — план от текущего счётчика.
  const baseHours = lastSvc ? coveredMark(+lastSvc.moto_hours, step) : Math.floor((+last.moto_hours) / step) * step;
  const dueHours = baseHours + step, level = levelAt(plan, dueHours);
  const byHours = rate > 0 ? (() => { const d = at(now); d.setUTCDate(d.getUTCDate() + Math.round((dueHours - nowMh) / rate)); return iso(d); })() : null;
  return finish({ src, rate, since: Math.max(0, nowMh - baseHours), nowMh, baseHours, dueHours, level, anchorDate: lastSvc?.taken_on || e.last_service || null, byHours, lastService: lastSvc });
}
