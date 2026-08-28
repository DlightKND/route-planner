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

describe('ноль и null означают «факта нет»', () => {
  // Приложение и trip_econ трактуют их одинаково: проверка везде > 0.
  // Иначе незаполненный факт обнулял бы себестоимость.
  it('factKm=0 — это план, а не бесплатная дорога', () => {
    expect(fact(0, null).cost).toBe(plan().cost);
  });
  it('factWorkH=0 — это план, а не бесплатный труд', () => {
    expect(fact(null, 0).cost).toBe(plan().cost);
  });
  it('оба null — cost совпадает с планом', () => {
    expect(fact(null, null).cost).toBe(plan().cost);
  });
});

describe('правила сборки снимка', () => {
  // Повторяют логику econSnapshot() из src/app.js.
  const build = (fk, fh) => {
    const p = plan();
    const hasFact = (fk != null && +fk > 0) || (fh != null && +fh > 0);
    const f = hasFact ? fact(fk, fh) : null;
    const best = f || p;
    return { revenue:p.rev, cost:best.cost, cost_basis: f ? 'fact' : 'plan',
             cost_plan:p.cost, cost_fact: f ? f.cost : null,
             profit_plan:p.profit, profit_fact: f ? f.profit : null };
  };

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
  it('одни только фактические часы, без километров, тоже включают факт', () => {
    expect(build(null, 3).cost_basis).toBe('fact');
  });
});
