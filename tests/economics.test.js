import { describe, it, expect } from 'vitest';
import { econCompute, jobPoint, roadByPayer, partsMoney } from '../src/core/economics.js';

const turf = { distance([lng1,lat1],[lng2,lat2]){ const R=6371,r=Math.PI/180,
  dLat=(lat2-lat1)*r,dLng=(lng2-lng1)*r,
  h=Math.sin(dLat/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h)); } };

// Тарифы как в проде: выручка км=20, себестоимость км=12.5, час costs=750
const T = {
  tariffs: { km: 20, day: 500, night: 1500, hour: 1500 },
  costs:   { km: 12.5, day: 500, night: 1500, hour: 750 },
  shift_hours: 8, deviation_pct: 0, currency: '₴'
};

const jobPaid = { clients:{name:'Клиент',lat:49.5,lng:33.5},
  job_works:[{hours:6,billable:true,revenue:9000}] };

describe('jobPoint', () => {
  it('берёт координаты техники, если есть', () => {
    expect(jobPoint({ equipment:{lat:1,lng:2}, clients:{lat:9,lng:9} })).toEqual({lat:1,lng:2});
  });
  it('падает на координаты клиента', () => {
    expect(jobPoint({ clients:{lat:5,lng:6} })).toEqual({lat:5,lng:6});
  });
  it('нет координат → null', () => {
    expect(jobPoint({ clients:{} })).toBe(null);
  });
});

describe('econCompute — плоская ветка (без профилей)', () => {
  const e = econCompute([jobPaid], 1000, 10, T, {}, {}, [], turf);
  it('выручка работ из job_works', () => expect(e.rWork).toBe(9000));
  it('выручка дороги = план × ставка (1000×20)', () => expect(e.rTravel).toBe(20000));
  it('себестоимость км по плану, если факта нет (1000×12.5)', () => expect(e.cKm).toBe(12500));
  it('прибыль = выручка − себестоимость', () => {
    expect(e.profit).toBeCloseTo(e.rev - e.cost, 6);
  });
});

describe('econCompute — план vs факт', () => {
  it('fact_km влияет ТОЛЬКО на себестоимость, не на выручку', () => {
    const plan = econCompute([jobPaid], 1000, 10, T, {}, {}, [], turf);
    const fact = econCompute([jobPaid], 1000, 10, T, {}, { factKm: 690 }, [], turf);
    expect(fact.rTravel).toBe(plan.rTravel);          // выручка дороги не изменилась
    expect(fact.cKm).toBeCloseTo(690 * 12.5, 6);      // себестоимость по факту
    expect(fact.cKm).toBeLessThan(plan.cKm);          // и она меньше
  });
  it('факт часов меняет себестоимость труда, не выручку работ', () => {
    const plan = econCompute([jobPaid], 1000, 10, T, {}, {}, [], turf);
    const fact = econCompute([jobPaid], 1000, 10, T, {}, { factWorkH: 8 }, [], turf);
    expect(fact.rWork).toBe(plan.rWork);              // выручка работ та же
    expect(fact.cLabor).toBeCloseTo(8 * 750, 6);      // труд по факту 8ч
  });
});

describe('econCompute — переопределения', () => {
  it('ov.revenue подменяет выручку', () => {
    const e = econCompute([jobPaid], 1000, 10, T, { revenue: 50000 }, {}, [], turf);
    expect(e.rev).toBe(50000); expect(e.revOv).toBe(true);
  });
  it('ov.cost подменяет себестоимость', () => {
    const e = econCompute([jobPaid], 1000, 10, T, { cost: 1234 }, {}, [], turf);
    expect(e.cost).toBe(1234); expect(e.costOv).toBe(true);
  });
});

describe('econCompute — дни и командировочные', () => {
  it('дни по календарю, если заданы даты', () => {
    const e = econCompute([jobPaid], 100, 2, T, {}, { dateFrom:'2026-07-17', dateTo:'2026-07-18' }, [], turf);
    expect(e.days).toBe(2); expect(e.nights).toBe(1); expect(e.daysByCal).toBe(true);
  });
  it('без дат — оценка по нагрузке', () => {
    const e = econCompute([jobPaid], 100, 2, T, {}, {}, [], turf);
    expect(e.daysByCal).toBe(false); expect(e.days).toBeGreaterThan(0);
  });
});

describe('roadByPayer — разбивка по плательщикам', () => {
  const start = { lat:49.0, lng:33.0 };
  const profs = [{ id:'clientA', name:'Клиент А', road:{ km_rate: 25 } }];
  const jobs = [
    { clients:{name:'A',lat:49.5,lng:33.5}, job_works:[{billable:true,tariff_profile:'clientA'}] }
  ];
  it('считает по профилю плательщика, а не плоской ставке', () => {
    const rb = roadByPayer(start, jobs, profs, 20, turf);
    expect(rb).not.toBe(null);
    expect(rb.groups[0].rate).toBe(25);       // ставка профиля, не 20
    expect(rb.groups[0].km).toBeGreaterThan(0);
  });
  it('нет старта или turf → null', () => {
    expect(roadByPayer(null, jobs, profs, 20, turf)).toBe(null);
    expect(roadByPayer(start, jobs, profs, 20, null)).toBe(null);
  });
});

describe('econCompute — гарантийная работа даёт выручку (управленческий учёт)', () => {
  // Схема: сервис — отдельная бизнес-единица, выставляет счёт всегда.
  // Гарантийная работа оплачивается внутренним плательщиком по своему тарифу,
  // её revenue уже посчитан (workRevenue по work_warr) и лежит в w.revenue.
  const warrJob = { clients:{name:'Клиент'},
    job_works:[{ hours:8, billable:false, revenue:6000 }] };  // 750×8 гарантийный тариф

  it('гарантийная работа попадает в выручку, а не в ноль', () => {
    const e = econCompute([warrJob], 100, 2, T, {}, {}, [], turf);
    expect(e.rWork).toBe(6000);   // раньше было бы 0
  });
  it('часы гарантийной всё равно считаются гарантийными (для доли)', () => {
    const e = econCompute([warrJob], 100, 2, T, {}, {}, [], turf);
    expect(e.wh).toBe(8);         // гарантийные часы
    expect(e.share).toBe(100);   // доля гарантии 100% по этой заявке
  });
  it('смешанная заявка: платная + гарантийная — обе в выручке', () => {
    const mix = { clients:{name:'Микс'}, job_works:[
      { hours:6, billable:true,  revenue:9000 },   // платная
      { hours:8, billable:false, revenue:6000 },   // гарантийная
    ]};
    const e = econCompute([mix], 100, 2, T, {}, {}, [], turf);
    expect(e.rWork).toBe(15000);  // 9000 + 6000
    expect(e.wh).toBe(8);         // гарантийные только 8 ч из 14
    expect(e.share).toBe(Math.round(8/14*100));
  });
});

describe('perJob — разложение по заявке: только работы, план и факт', () => {
  const jobs=[
    { id:'j1', clients:{name:'Клиент А'}, job_works:[{hours:4,billable:true, revenue:3000}] },
    { id:'j2', clients:{name:'Клиент Б'}, job_works:[{hours:8,billable:false,revenue:6000}] },
  ];
  it('без факта — себестоимость по плану, factHours null', () => {
    const e=econCompute(jobs,382,6,T,{},{},[],turf);
    const a=e.perJob.find(p=>p.id==='j1');
    expect(a.factHours).toBe(null);
    expect(a.costPlan).toBe(4*750);       // 4 ч × 750
    expect(a.cost).toBe(a.costPlan);
    expect(a.profit).toBe(3000-3000);
  });
  it('с фактом — себестоимость по фактическим часам', () => {
    const e=econCompute(jobs,382,6,T,{},{factHoursByJob:{j1:3.6}},[],turf);
    const a=e.perJob.find(p=>p.id==='j1');
    expect(a.factHours).toBe(3.6);
    expect(a.costFact).toBeCloseTo(3.6*750,6);
    expect(a.cost).toBeCloseTo(3.6*750,6);
    expect(a.profit).toBeCloseTo(3000-3.6*750,6);
  });
  it('гарантийные часы видны по заявке', () => {
    const e=econCompute(jobs,382,6,T,{},{},[],turf);
    const b=e.perJob.find(p=>p.id==='j2');
    expect(b.warrantyHours).toBe(8);
    expect(b.revenue).toBe(6000);          // гарантия тоже выручка
  });
  it('транспорт в разложение по заявке НЕ попадает', () => {
    const e=econCompute(jobs,382,6,T,{},{},[],turf);
    e.perJob.forEach(p=>{
      // себестоимость заявки — только труд, дорога/сутки сюда не входят
      expect(p.cost).toBeLessThanOrEqual(p.hours*750 + 0.001);
    });
  });
});

describe('запчасти', () => {
  const T2 = { tariffs:{km:0,day:0,night:0,hour:0}, costs:{km:0,day:0,night:0,hour:750},
               shift_hours:8, deviation_pct:0, currency:'₴' };

  it('partsMoney: продажа только с платных, закупка со всех', () => {
    const m = partsMoney({ job_parts:[
      { qty:2, price:1500, cost:900, billable:true },
      { qty:1, price:4000, cost:2600, billable:false },   // гарантийная
    ]});
    expect(m.rev).toBe(3000);            // 2×1500; гарантийная не продаётся
    expect(m.cost).toBe(900*2 + 2600);   // а стоила она нам всё равно
  });
  it('partsMoney: нет запчастей — нули, а не NaN', () => {
    expect(partsMoney({})).toEqual({rev:0,cost:0});
    expect(partsMoney({job_parts:[]})).toEqual({rev:0,cost:0});
  });
  it('partsMoney: количество умножает обе цены', () => {
    const m = partsMoney({ job_parts:[{ qty:2.5, price:200, cost:100, billable:true }]});
    expect(m.rev).toBe(500); expect(m.cost).toBe(250);
  });

  const jobP = { id:'jp', clients:{name:'К',lat:49.5,lng:33.5},
    job_works:[{hours:4,billable:true,revenue:3000}],
    job_parts:[{qty:2,price:1500,cost:900,billable:true},
               {qty:1,price:4000,cost:2600,billable:false}] };

  it('выручка заявки = работы + продажа запчастей', () => {
    const e = econCompute([jobP],0,0,T2,{},{},[],turf);
    const a = e.perJob[0];
    expect(a.workRevenue).toBe(3000);
    expect(a.partsRevenue).toBe(3000);
    expect(a.revenue).toBe(6000);
  });
  it('себестоимость труда остаётся чистым трудом, закупка идёт отдельно', () => {
    const e = econCompute([jobP],0,0,T2,{},{},[],turf);
    const a = e.perJob[0];
    expect(a.costPlan).toBe(4*750);                 // подпись «труд» не врёт
    expect(a.partsCost).toBe(900*2 + 2600);
    expect(a.cost).toBe(4*750 + 900*2 + 2600);      // а в итог входит всё
    expect(a.profit).toBe(6000 - (4*750 + 4400));
  });
  it('итоги выезда: rParts в выручке, cParts в затратах', () => {
    const e = econCompute([jobP],0,0,T2,{},{},[],turf);
    expect(e.rParts).toBe(3000);
    expect(e.cParts).toBe(4400);
    expect(e.revComputed).toBe(e.rWork + e.rParts + e.rTravel + e.rPerDiem);
    expect(e.costComputed).toBe(e.cLabor + e.cParts + e.cKm + e.cDay + e.cNight);
  });
  it('заявка без запчастей считается ровно как раньше', () => {
    const bare = { id:'b', clients:{name:'К',lat:49.5,lng:33.5},
      job_works:[{hours:4,billable:true,revenue:3000}] };
    const e = econCompute([bare],0,0,T2,{},{},[],turf);
    const a = e.perJob[0];
    expect(a.revenue).toBe(3000);
    expect(a.partsRevenue).toBe(0);
    expect(a.cost).toBe(4*750);
    expect(e.rParts).toBe(0); expect(e.cParts).toBe(0);
  });
});
