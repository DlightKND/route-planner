// Работа на карте: задания, которые нужно запланировать, и выбор для выезда.
// Чистый модуль: без DOM и сети. На входе — строки заданий из базы, заявки
// и клиенты, на выходе — то, что рисуют лента, маркеры и окно «Собрать выезд».
//
// Карта раньше считала срочность по ЗАЯВКАМ, а график и конфликты — по
// ЗАДАНИЯМ. Заявка, задание которой уже стоит в выезде на завтра, на карте
// продолжала «гореть». Здесь единица работы — задание; заявка без задания
// показывается отдельно, как то, что ещё нужно превратить в задание.

import { jobUrgency, urgencyRank } from './sla.js';

const CLOSED_TASK = new Set(['review', 'completed', 'cancelled']);
const CLOSED_TRIP = new Set(['done', 'cancelled']);
const HOUR_UNIT = /^(?:ч|н-ч|час(?:а|ов)?|год(?:ина|ини|ин)?)$/i;

// Плановые часы задания: труд по строкам работ. Материалы не считаются.
export function taskHours(items) {
  return (items || []).reduce((sum, item) => {
    if (!item || item.kind === 'material') return sum;
    if (item.planned_labor_hours != null) return sum + (Number(item.planned_labor_hours) || 0);
    return sum + (HOUR_UNIT.test(item.unit || '') ? (Number(item.planned_qty) || 0) : 0);
  }, 0);
}

// Действующий выезд задания: не удалённый, не завершённый и не отменённый.
// Задание из закрытого выезда, которое само не закрыто, снова ждёт плана.
export function activeTrip(links) {
  const trips = (links || []).map(link => link && link.trips).filter(t => t && !t.deleted_at && !CLOSED_TRIP.has(t.status));
  trips.sort((a, b) => String(a.date_from || '9999').localeCompare(String(b.date_from || '9999')));
  return trips[0] || null;
}

// Строки заданий для карты.
//   orders   — service_orders с service_order_items и trip_service_orders(trips)
//   jobsById — заявки по id: client_id, due_date, created_at, status
//   clientsById — клиенты по id: name, lat, lng
// Возвращает только открытые выездные задания с известным клиентом.
export function mapTaskRows(orders, jobsById, clientsById, now = new Date()) {
  const rows = [];
  (orders || []).forEach(order => {
    if (!order || order.work_mode !== 'onsite' || CLOSED_TASK.has(order.status) || order.deleted_at) return;
    const job = jobsById[order.job_id];
    if (!job || !job.client_id) return;
    const client = clientsById[job.client_id];
    if (!client || client.is_base) return;
    const trip = activeTrip(order.trip_service_orders);
    rows.push({
      id: order.id,
      number: order.number,
      title: order.title || '',
      status: order.status,
      jobId: order.job_id,
      jobNumber: job.number ?? null,
      clientId: client.id,
      clientName: client.name || '',
      lat: client.lat,
      lng: client.lng,
      hours: taskHours(order.service_order_items),
      lead: order.lead_engineer || null,
      dateFrom: order.date_from || null,
      dueDate: job.due_date || null,
      urgency: jobUrgency({ due_date: job.due_date, created_at: job.created_at }, now),
      trip: trip ? { id: trip.id, number: trip.number ?? null, dateFrom: trip.date_from || null, dateTo: trip.date_to || null, status: trip.status } : null,
    });
  });
  return rows;
}

// Заявки, по которым ещё нет ни одного открытого задания: их сначала нужно
// превратить в задание, и только потом планировать.
export function requestsWithoutTask(jobs, orders, clientsById) {
  const covered = new Set((orders || []).filter(o => o && !['cancelled'].includes(o.status) && !o.deleted_at).map(o => o.job_id));
  return (jobs || []).filter(job => job && !['done', 'cancelled'].includes(job.status) && !job.at_depot
    && job.client_id && clientsById[job.client_id] && !clientsById[job.client_id].is_base && !covered.has(job.id));
}

const LEVELS = ['overdue', 'acute', 'calm', 'cold'];
export const LEVEL_LABEL = { overdue: 'Просрочено', acute: 'Горит', calm: 'Спокойно', cold: 'Без срока' };

const byUrgency = (a, b) => {
  const r = urgencyRank(a.urgency.level) - urgencyRank(b.urgency.level);
  if (r) return r;
  const l = (a.urgency.left ?? 1e9) - (b.urgency.left ?? 1e9);
  if (l) return l;
  return (a.number ?? 0) - (b.number ?? 0);
};

// Незапланированные задания по группам срочности, в каждой — от острого.
// query ищет по клиенту, номеру задания и номеру заявки.
export function matchesTask(row, query) {
  const q = String(query || '').trim().toLowerCase().replace(/^№\s*/, '');
  if (!q) return true;
  return row.clientName.toLowerCase().includes(q) || row.title.toLowerCase().includes(q)
    || String(row.number ?? '') === q || String(row.jobNumber ?? '') === q;
}

export function groupUnplanned(rows, query = '') {
  const found = (rows || []).filter(row => !row.trip && matchesTask(row, query)).sort(byUrgency);
  return LEVELS.map(level => ({ level, label: LEVEL_LABEL[level], rows: found.filter(row => row.urgency.level === level) }))
    .filter(group => group.rows.length);
}

// Запланированные — по дате выезда, затем по номеру выезда.
export function plannedRows(rows, query = '') {
  return (rows || []).filter(row => row.trip && matchesTask(row, query)).sort((a, b) =>
    String(a.trip.dateFrom || '9999').localeCompare(String(b.trip.dateFrom || '9999'))
    || (a.trip.number ?? 0) - (b.trip.number ?? 0) || byUrgency(a, b));
}

// Что показать маркером клиента: сколько работы ждёт плана и насколько она горит.
//   toPlan  — незапланированные задания + заявки без задания
//   planned — задания, уже стоящие в выездах
//   level   — худшая срочность среди того, что ждёт плана (иначе null)
export function clientWork(rows, requests, now = new Date()) {
  const out = {};
  const slot = id => out[id] || (out[id] = { toPlan: 0, planned: 0, level: null, tasks: [], requests: [] });
  const worse = (s, level) => { if (s.level == null || urgencyRank(level) < urgencyRank(s.level)) s.level = level; };
  (rows || []).forEach(row => {
    const s = slot(row.clientId); s.tasks.push(row);
    if (row.trip) { s.planned++; return; }
    s.toPlan++; worse(s, row.urgency.level);
  });
  (requests || []).forEach(job => {
    const s = slot(job.client_id); s.requests.push(job); s.toPlan++;
    worse(s, jobUrgency(job, now).level);
  });
  return out;
}

// Сводка выбора для нижней панели.
export function selectionSummary(rows, selected) {
  const chosen = (rows || []).filter(row => selected.has(row.id));
  const hours = chosen.reduce((sum, row) => sum + row.hours, 0);
  return { count: chosen.length, clients: new Set(chosen.map(row => row.clientId)).size, hours: Math.round(hours * 10) / 10 };
}

// Варианты для окна «Собрать выезд».
//   selected — id отмеченных заданий; clientIds — клиенты маршрута, если
//   окно открыто из маршрута. Состав всегда виден и выбирается явно:
//   отмечено то, что выбрал человек (или незапланированное у клиентов
//   маршрута), остальная работа этих клиентов показана неотмеченной.
//   Задание из другого выезда не выбирается — его сначала убирают оттуда.
export function assembleChoices(rows, requests, { selected = new Set(), clientIds = null } = {}) {
  const clients = new Set(clientIds || []);
  (rows || []).forEach(row => { if (selected.has(row.id)) clients.add(row.clientId); });
  const tasks = (rows || []).filter(row => clients.has(row.clientId)).sort(byUrgency).map(row => ({
    row,
    checked: !row.trip && (selected.size ? selected.has(row.id) : true),
    disabled: !!row.trip,
  }));
  const reqs = (requests || []).filter(job => clients.has(job.client_id)).map(job => ({ job, checked: false }));
  return { tasks, requests: reqs, clients: [...clients] };
}

// Сколько дней займёт работа при заданной длине смены: подсказка, а не план.
export function workDays(hours, shiftHours) {
  const shift = Number(shiftHours) || 0;
  if (!(hours > 0) || !(shift > 0)) return hours > 0 ? 1 : 0;
  return Math.max(1, Math.ceil(hours / shift - 1e-9));
}

// Расстояние по прямой между точками {lat,lng}, км (гаверсинус): для подсказки
// «ближе всего к маршруту», где дорожная точность не нужна.
export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Насколько точки близки к маршруту выезда: наибольшее из расстояний от
// каждой точки до ближайшей остановки. null, если у выезда нет остановок.
export function routeReachKm(stops, points) {
  const valid = (stops || []).filter(s => s && s.lat != null && s.lng != null);
  if (!valid.length || !(points || []).length) return null;
  return Math.max(...points.map(p => Math.min(...valid.map(s => haversineKm(p, s)))));
}
