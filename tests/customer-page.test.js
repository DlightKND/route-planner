import { describe, it, expect } from 'vitest';
import { serviceForecast, addBusinessDays, serviceState } from '../src/core/equipment-service.js';
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
  it('uses the reading rate and marks overdue', () => {
    const readings = [{ taken_on: '2026-08-01', moto_hours: 4300 }, { taken_on: '2026-09-20', moto_hours: 4700 }];
    const f = serviceForecast({ last_service: '2026-01-01' }, { model: { service_interval_hours: 500 }, readings, today: '2026-10-05' });
    expect(f.src).toBe('unit');
    expect(f.since).toBeGreaterThan(500);
    expect(f.state).toBe('overdue');
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
