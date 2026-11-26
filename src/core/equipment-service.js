// Прогноз ТО техники: сколько наработано с последнего ТО и когда следующее.
//
// Интервал ТО задан у модели в моточасах. Темп наработки берётся из замеров
// самой техники, иначе — средний по технике той же точки. Замеров нет —
// грубая оценка: рабочая смена в каждый будний день с последнего ТО (или с
// установки). Один расчёт для карты, справочника клиента и плана ТО.
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
export function calendarDays(from, to) { return Math.round((at(to) - at(from)) / DAY); }

export function serviceState(days, soonDays = 30) {
  if (days == null) return 'unknown';
  return days < 0 ? 'overdue' : days <= soonDays ? 'soon' : 'ok';
}

// readings — замеры этой техники по возрастанию даты; peerReadings — замеры
// остальной техники точки (массив массивов).
export function serviceForecast(e, { model, readings = [], peerReadings = [], shiftHours = 0, today, soonDays = 30 } = {}) {
  const interval = +model?.service_interval_hours || 0;
  if (!e || interval <= 0) return null;
  const now = today || iso(new Date());
  let rate = rateFrom(readings), src = 'unit';
  if (!(rate > 0)) {
    const rates = peerReadings.map(rateFrom).filter(r => r > 0);
    rate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    src = rates.length ? 'client' : 'none';
  }
  const last = readings.length ? readings[readings.length - 1] : null;
  if (!last || rate <= 0) {
    const sh = +shiftHours || 0, anchor = e.last_service || e.installed_on || null;
    if (!anchor || sh <= 0) return null;
    const since = businessDays(anchor, now) * sh;
    const dueDate = addBusinessDays(anchor, interval / sh), days = calendarDays(now, dueDate);
    return { since, interval, rate: 0, src: 'estimate', daysLeft: null, dueDate, days, state: serviceState(days, soonDays), anchor };
  }
  // Точка отсчёта — последнее ТО: замер с пометкой «ТО» или последний замер
  // не позже даты ТО, которую ставит закрытая заявка с работой «ТО».
  const lastSvc = [...readings].reverse().find(r => r.kind === 'service' || (e.last_service && r.taken_on <= e.last_service));
  const daysSince = Math.max(0, calendarDays(last.taken_on, now));
  const nowMh = (+last.moto_hours) + rate * daysSince;
  const baseMh = lastSvc ? (+lastSvc.moto_hours) : (+readings[0].moto_hours);
  const since = Math.max(0, nowMh - baseMh), daysLeft = Math.round((interval - since) / rate);
  const due = at(now); due.setUTCDate(due.getUTCDate() + daysLeft);
  return { since, interval, rate, src, daysLeft, nowMh, dueDate: iso(due), days: daysLeft, state: serviceState(daysLeft, soonDays), anchor: lastSvc?.taken_on || readings[0].taken_on };
}
