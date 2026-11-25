import { describe, it, expect } from 'vitest';
import { taskHours, activeTrip, mapTaskRows, requestsWithoutTask, groupUnplanned, plannedRows, clientWork, selectionSummary, assembleChoices, workDays, matchesTask } from '../src/core/map-work.js';

const now = new Date('2026-11-25T09:00:00');
const clientsById = {
  a: { id: 'a', name: 'ТОВ «Агро-Схід»', lat: 50.5, lng: 30.8 },
  b: { id: 'b', name: 'ФГ «Колос»', lat: 50.4, lng: 31.0 },
  d: { id: 'd', name: 'Депо', lat: 50.4, lng: 30.5, is_base: true },
};
const jobsById = {
  j1: { id: 'j1', number: 111, client_id: 'a', due_date: '2026-11-23', created_at: '2026-11-01', status: 'planned' },
  j2: { id: 'j2', number: 112, client_id: 'a', due_date: '2026-11-27', created_at: '2026-11-20', status: 'open' },
  j3: { id: 'j3', number: 113, client_id: 'b', due_date: null, created_at: '2026-11-20', status: 'open' },
};
const trip = (status, extra = {}) => ({ trips: { id: 't' + status, number: 17, date_from: '2026-11-26', status, ...extra } });
const order = (id, job, extra = {}) => ({ id, number: Number(id.slice(1)), title: 'Работа ' + id, status: 'assigned', work_mode: 'onsite', job_id: job, service_order_items: [{ kind: 'work', unit: 'ч', planned_qty: 2 }], trip_service_orders: [], ...extra });

describe('map work', () => {
  it('counts labor hours, not materials', () => {
    expect(taskHours([{ kind: 'work', planned_labor_hours: 3 }, { kind: 'work', unit: 'ч', planned_qty: 1.5 }, { kind: 'material', unit: 'ч', planned_qty: 9 }, { kind: 'work', unit: 'шт', planned_qty: 4 }])).toBe(4.5);
  });

  it('ignores finished, cancelled and deleted trips', () => {
    expect(activeTrip([trip('done'), trip('cancelled'), trip('planned', { deleted_at: 'x' })])).toBe(null);
    expect(activeTrip([trip('done'), trip('planned')]).status).toBe('planned');
  });

  it('builds open onsite task rows with urgency from the request', () => {
    const rows = mapTaskRows([
      order('o1', 'j1'),
      order('o2', 'j2', { trip_service_orders: [trip('planned')] }),
      order('o3', 'j3', { status: 'completed' }),
      order('o4', 'j3', { work_mode: 'depot' }),
      order('o5', 'missing'),
    ], jobsById, clientsById, now);
    expect(rows.map(r => r.id)).toEqual(['o1', 'o2']);
    expect(rows[0]).toMatchObject({ clientName: 'ТОВ «Агро-Схід»', hours: 2, jobNumber: 111, trip: null });
    expect(rows[0].urgency.level).toBe('overdue');
    expect(rows[1].trip).toMatchObject({ number: 17, dateFrom: '2026-11-26' });
  });

  it('finds requests that still need a task', () => {
    const orders = [order('o1', 'j1'), order('o9', 'j2', { status: 'cancelled' })];
    const jobs = Object.values(jobsById).concat({ id: 'j4', client_id: 'd', status: 'open' }, { id: 'j5', client_id: 'b', status: 'done' });
    expect(requestsWithoutTask(jobs, orders, clientsById).map(j => j.id)).toEqual(['j2', 'j3']);
  });

  it('groups unplanned work by urgency and lists planned work by trip date', () => {
    const rows = mapTaskRows([order('o1', 'j1'), order('o2', 'j2'), order('o3', 'j3'), order('o4', 'j2', { trip_service_orders: [trip('planned')] })], jobsById, clientsById, now);
    expect(groupUnplanned(rows).map(g => [g.level, g.rows.map(r => r.id)])).toEqual([['overdue', ['o1']], ['acute', ['o2']], ['cold', ['o3']]]);
    expect(plannedRows(rows).map(r => r.id)).toEqual(['o4']);
    expect(groupUnplanned(rows, 'колос').flatMap(g => g.rows.map(r => r.id))).toEqual(['o3']);
    expect(groupUnplanned(rows, '№111').flatMap(g => g.rows.map(r => r.id))).toEqual(['o1']);
  });

  it('searches by client, title, task and request number', () => {
    const row = { clientName: 'ФГ «Колос»', title: 'Замена', number: 63, jobNumber: 112 };
    expect(['колос', 'замен', '63', '№ 112', ''].map(q => matchesTask(row, q))).toEqual([true, true, true, true, true]);
    expect(matchesTask(row, '6')).toBe(false);
  });

  it('summarises a client marker by work waiting for a plan', () => {
    const rows = mapTaskRows([order('o1', 'j1'), order('o2', 'j2', { trip_service_orders: [trip('planned')] })], jobsById, clientsById, now);
    const work = clientWork(rows, [jobsById.j3], now);
    expect(work.a).toMatchObject({ toPlan: 1, planned: 1, level: 'overdue' });
    expect(work.b).toMatchObject({ toPlan: 1, planned: 0, level: 'cold' });
  });

  it('summarises a selection', () => {
    const rows = mapTaskRows([order('o1', 'j1'), order('o2', 'j2'), order('o3', 'j3')], jobsById, clientsById, now);
    expect(selectionSummary(rows, new Set(['o1', 'o3']))).toEqual({ count: 2, clients: 2, hours: 4 });
  });

  it('offers explicit composition: chosen tasks checked, the rest of these clients unchecked', () => {
    const rows = mapTaskRows([order('o1', 'j1'), order('o2', 'j2'), order('o3', 'j3'), order('o4', 'j2', { trip_service_orders: [trip('planned')] })], jobsById, clientsById, now);
    const fromSelection = assembleChoices(rows, [{ id: 'j6', client_id: 'a' }, { id: 'j7', client_id: 'b' }], { selected: new Set(['o1']) });
    expect(fromSelection.tasks.map(t => [t.row.id, t.checked, t.disabled])).toEqual([['o1', true, false], ['o2', false, false], ['o4', false, true]]);
    expect(fromSelection.requests.map(r => [r.job.id, r.checked])).toEqual([['j6', false]]);
    const fromRoute = assembleChoices(rows, [], { clientIds: ['b'] });
    expect(fromRoute.tasks.map(t => [t.row.id, t.checked])).toEqual([['o3', true]]);
  });

  it('estimates working days by shift length', () => {
    expect([workDays(0, 8), workDays(8, 8), workDays(12, 8), workDays(5, 0)]).toEqual([0, 1, 2, 1]);
  });
});

import { haversineKm, routeReachKm } from '../src/core/map-work.js';
describe('route reach', () => {
  it('measures straight distance and the farthest point from a route', () => {
    expect(Math.round(haversineKm({ lat: 50.45, lng: 30.52 }, { lat: 50.51, lng: 30.79 }))).toBe(20);
    const stops = [{ lat: 50.45, lng: 30.52 }, { lat: 50.51, lng: 30.79 }, { lat: null, lng: null }];
    expect(Math.round(routeReachKm(stops, [{ lat: 50.51, lng: 30.79 }, { lat: 50.45, lng: 30.52 }]))).toBe(0);
    expect(routeReachKm([], [{ lat: 1, lng: 1 }])).toBe(null);
  });
});
