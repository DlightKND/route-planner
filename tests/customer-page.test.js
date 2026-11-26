import { describe, it, expect } from 'vitest';
import { serviceForecast, addBusinessDays, serviceState, planLevels, levelAt } from '../src/core/equipment-service.js';
import { customerSummary, serviceLabel } from '../src/customer-page.js';

describe('serviceForecast', () => {
  const model = { service_interval_hours: 1500 };
  it('estimates by shifts when there are no readings', () => {
    const f = serviceForecast({ last_service: '2026-03-02' }, { model, shiftHours: 9, today: '2026-10-05' });
    expect(f.src).toBe('estimate');
    expect(f.dueDate).toBe(addBusinessDays('2026-03-02', 1500 / 9));
    expect(f.state).toBe('soon');
    expect(f.days).toBe(16);
  });
  const levels = [{ id: 'to3', name: 'ТО-3', interval_hours: 1000, interval_months: 24 }, { id: 'to1', name: 'ТО-1', interval_hours: 250 }, { id: 'to2', name: 'ТО-2', interval_hours: 500, interval_months: 12 }];
  it('counts the next mark from the recorded service and picks the level that divides it', () => {
    const readings = [{ taken_on: '2026-08-01', moto_hours: 980, kind: 'service' }, { taken_on: '2026-09-20', moto_hours: 1200, kind: 'reading' }];
    const f = serviceForecast({ last_service: '2026-08-01' }, { model: {}, levels, readings, today: '2026-10-05' });
    expect(f.baseHours).toBe(1000); expect(f.dueHours).toBe(1250); expect(f.level.name).toBe('ТО-1');
    expect(f.src).toBe('unit'); expect(Math.round(f.nowMh)).toBe(1266); expect(f.state).toBe('overdue');
    const next = serviceForecast({}, { model: {}, levels, readings: [{ taken_on: '2026-09-01', moto_hours: 1255, kind: 'service' }, { taken_on: '2026-10-01', moto_hours: 1300 }], today: '2026-10-05' });
    expect(next.dueHours).toBe(1500); expect(next.level.name).toBe('ТО-2');
    expect(levelAt(planLevels({}, levels), 2000).name).toBe('ТО-3');
  });
  it('takes the calendar term when it comes first', () => {
    const readings = [{ taken_on: '2025-09-01', moto_hours: 1000, kind: 'service' }, { taken_on: '2025-09-02', moto_hours: 1000.5 }, { taken_on: '2025-09-03', moto_hours: 1001 }];
    const f = serviceForecast({}, { model: {}, levels, readings, today: '2026-10-05' });
    expect(f.byCalendar).toBe(true); expect(f.dueDate).toBe('2026-09-01'); expect(f.state).toBe('overdue');
  });
  it('returns null without an interval and labels states', () => {
    expect(serviceForecast({}, { model: {} })).toBeNull();
    expect(serviceState(-1)).toBe('overdue'); expect(serviceState(30)).toBe('soon'); expect(serviceState(31)).toBe('ok');
    expect(serviceLabel({ days: -42, state: 'overdue' }).text).toBe('просрочено 42 дн');
    expect(serviceLabel(null).state).toBe('unknown');
  });
});

describe('customerSummary', () => {
  const jobs = [
    { id: 'j1', status: 'open', created_at: '2026-09-10T10:00:00Z', equipment_id: 'e1', due_date: '2026-10-10' },
    { id: 'j2', status: 'done', created_at: '2026-07-01T10:00:00Z', equipment_id: 'e1' },
    { id: 'j3', status: 'done', created_at: '2024-01-01T10:00:00Z', equipment_id: 'e2' }
  ];
  const orders = [{ job_id: 'j2', service_order_items: [
    { kind: 'work', unit: 'ч', done_qty: 3 }, { kind: 'material', title: 'Масло', unit: 'л', done_qty: 4 },
    { kind: 'work', unit: 'ч', done_qty: 5, request_finance_void_event_id: 'x' }] }];
  const visits = [{ job_id: 'j2', started_at: '2026-07-02T08:00:00Z' }];
  const equipment = [{ id: 'e1', model: 'Grundfos CR 32', serial: '4471' }, { id: 'e2', model: 'ШУ-2' }];
  it('counts the period, hours without voided items and ranks breakdowns and parts', () => {
    const s = customerSummary({ jobs, orders, visits, equipment, period: 'year', today: '2026-10-05', forecast: e => e.id === 'e1' ? { state: 'overdue' } : { state: 'soon' } });
    expect(s.jobs).toBe(2); expect(s.open).toBe(1); expect(s.visits).toBe(1); expect(s.hours).toBe(3);
    expect(s.overdue).toBe(1); expect(s.soon).toBe(1);
    expect(s.breakdowns[0]).toMatchObject({ label: 'Grundfos CR 32 № 4471', n: 2 });
    expect(s.parts[0]).toMatchObject({ label: 'Масло', n: 4, unit: 'л' });
    expect(s.months).toHaveLength(12); expect(s.months.at(-1).key).toBe('2026-10');
    expect(s.openJobs.map(j => j.id)).toEqual(['j1']);
    expect(customerSummary({ jobs, period: 'all', today: '2026-10-05' }).jobs).toBe(3);
  });
});
