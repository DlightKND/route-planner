// Инвариант «план против факта» в econ_snapshot.
//
// Зачем этот файл. Поле econ_snapshot.cost долгое время значило РАЗНОЕ
// в зависимости от того, каким экраном сохранили выезд: карточка выезда
// передавала в econCompute фактические километры и часы, планировщик — нет.
// Дашборд складывал econ_snapshot.cost по всем выездам, то есть суммировал
// плановую себестоимость одних выездов с фактической себестоимостью других,
// и общая цифра компании менялась от того, кто на каком экране нажал
// «Сохранить», а не от того, что изменилось в реальности.
//
// Теперь оба пути зовут econSnapshot() (src/app.js) и хранят обе величины:
// cost_plan, cost_fact и метку cost_basis. Тесты ниже закрепляют правила,
// на которых этот сборщик держится. Сам econSnapshot живёт в app.js и
// прямо не тестируется — но вся его арифметика идёт из econCompute,
// и проверяется здесь.

import { describe, it, expect } from 'vitest';
import { econCompute } from '../src/core/economics.js';
import { economicSnapshot } from '../src/core/economic-snapshot.js';

const T = {
  tariffs: { km: 20, day: 500, night: 1500, hour: 1500 },
  costs:   { km: 12.5, day: 500, night: 1500, hour: 750 },
  shift_hours: 8, deviation_pct: 0, currency: '₴'
};

const jobs = [{ id:'j1', clients:{name:'Клиент',lat:49.5,lng:33.5},
  job_works:[{hours:6,billable:true,revenue:9000}] }];

const ctx = { dateFrom:'2026-08-14', dateTo:'2026-08-15' };
const plan = () => econCompute(jobs, 400, 5, T, {}, { ...ctx, factKm:null, factWorkH:null }, [], null);
const fact = (km, h) => econCompute(jobs, 400, 5, T, {}, { ...ctx, factKm:km, factWorkH:h }, [], null);

describe('выручка не зависит от факта', () => {
  // Выручка согласована с плательщиком заранее: от того, что водитель
  // заплутал или провозился дольше, счёт клиенту расти не должен.
  // Обоснование — в комментариях src/core/economics.js.
  it('одинакова с фактом и без', () => {
    expect(fact(347, 4.5).rev).toBe(plan().rev);
  });
  it('одинакова даже при факте вдвое больше плана', () => {
    expect(fact(800, 12).rev).toBe(plan().rev);
  });
});

describe('себестоимость считается по факту, когда он есть', () => {
  it('меньший фактический пробег удешевляет выезд', () => {
    expect(fact(347, null).cost).toBeLessThan(plan().cost);
  });
  it('больший фактический пробег удорожает выезд', () => {
    expect(fact(800, null).cost).toBeGreaterThan(plan().cost);
  });
  it('фактические часы влияют на труд', () => {
    const p = plan(), f = fact(null, 3);
    expect(f.cLabor).toBeLessThan(p.cLabor);
    expect(f.cKm).toBe(p.cKm);              // километры не трогали
  });
  it('километры и часы применяются независимо', () => {
    const both = fact(347, 3);
    expect(both.costKm).toBe(347);
    expect(both.costWorkH).toBe(3);
  });
});

describe('подтверждённый ноль отличается от отсутствия данных', () => {
  it('factKm=0 обнуляет только километровую составляющую', () => {
    expect(fact(0, null).cKm).toBe(0);
    expect(fact(0, null).cLabor).toBe(plan().cLabor);
  });
  it('factWorkH=0 обнуляет только присутствие, сохраняя остальные затраты', () => {
    expect(fact(null, 0).cLabor).toBe(0);
    expect(fact(null, 0).cKm).toBe(plan().cKm);
  });
  it('оба null — cost совпадает с планом', () => {
    expect(fact(null, null).cost).toBe(plan().cost);
  });
});

describe('правила сборки снимка', () => {
  const build = (fk, fh) => economicSnapshot(jobs,400,5,T,{}, {...ctx,factKm:fk,factWorkH:fh});

  it('без факта: basis=plan, cost=cost_plan, cost_fact пуст', () => {
    const s = build(null, null);
    expect(s.cost_basis).toBe('plan');
    expect(s.cost).toBe(s.cost_plan);
    expect(s.cost_fact).toBeNull();
  });
  it('с фактом: basis=fact, cost=cost_fact', () => {
    const s = build(347, 4.5);
    expect(s.cost_basis).toBe('fact');
    expect(s.cost).toBe(s.cost_fact);
    expect(s.cost_fact).not.toBe(s.cost_plan);
  });
  it('cost_plan сохраняется даже когда факт есть', () => {
    const s = build(347, 4.5);
    expect(s.cost_plan).toBe(plan().cost);
  });
  it('прибыль сходится с выручкой минус себестоимость в обеих версиях', () => {
    const s = build(347, 4.5);
    expect(s.profit_plan).toBeCloseTo(s.revenue - s.cost_plan, 6);
    expect(s.profit_fact).toBeCloseTo(s.revenue - s.cost_fact, 6);
  });
  it('частичное покрытие не выдаётся за окончательную себестоимость', () => {
    expect(build(null, 3).cost_basis).toBe('partial');
    expect(build(null, 3).cost_fact).toBeNull();
    expect(build(0, 0).cost_basis).toBe('fact');
  });
});
