import { describe, it, expect } from 'vitest';
import { planSchedule, driveOfLegs, dayIso, dayMs, isWorkday,
  normPos, addHours, piecesOf, clockOf } from '../src/core/schedule.js';

// Календарь для тестов: 2026-09-07 понедельник, 09-08 вт, 09-09 ср,
// 09-10 чт, 09-11 пт, 09-12 сб, 09-13 вс.
const S = { shiftH: 8, deviationPct: 0 };
const TODAY = { today: '2026-09-01' };

const cell = (r, iso) => r.days.find(d => d.iso === iso);

describe('дни недели', () => {
  it('суббота и воскресенье — не рабочие', () => {
    expect(isWorkday(dayMs('2026-09-11'))).toBe(true);
    expect(isWorkday(dayMs('2026-09-12'))).toBe(false);
    expect(isWorkday(dayMs('2026-09-13'))).toBe(false);
  });
  it('dayIso обратен dayMs', () => {
    expect(dayIso(dayMs('2026-09-10'))).toBe('2026-09-10');
  });
});

describe('пример заказчика: 8 ч работ, 4 ч туда, 4 ч обратно', () => {
  it('срок четверг → среда (дорога) / четверг (работа) / пятница (дорога)', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-10', workH: 8, driveToH: 4, driveBackH: 4 }], S, TODAY);
    const b = r.blocks[0];
    expect(b.workFrom).toBe('2026-09-10');
    expect(b.workTo).toBe('2026-09-10');
    expect(b.from).toBe('2026-09-09');
    expect(b.to).toBe('2026-09-11');
    expect(cell(b, '2026-09-09').driveH).toBe(4);
    expect(cell(b, '2026-09-10').workH).toBe(8);
    expect(cell(b, '2026-09-11').driveH).toBe(4);
    expect(b.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('срок пятница → тот же среда-четверг-пятница: дорога обратно не лезет на субботу', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-11', workH: 8, driveToH: 4, driveBackH: 4 }], S, TODAY);
    const b = r.blocks[0];
    expect(b.workFrom).toBe('2026-09-10');
    expect(b.from).toBe('2026-09-09');
    expect(b.to).toBe('2026-09-11');
  });
});

describe('дни считаются от часов и допуска', () => {
  it('20 ч при смене 8 — три дня', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-11', workH: 20 }], S, TODAY);
    const b = r.blocks[0];
    expect(b.days.length).toBe(3);
    expect(b.workFrom).toBe('2026-09-09');
    expect(b.workTo).toBe('2026-09-11');
  });
  it('9 ч при смене 8 и допуске 20% — один день, работа не дробится', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-10', workH: 9 }], { shiftH: 8, deviationPct: 20 }, TODAY);
    expect(r.blocks[0].days.length).toBe(1);
    expect(r.blocks[0].workFrom).toBe('2026-09-10');
  });
  it('9 ч без допуска — два дня', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-10', workH: 9 }], S, TODAY);
    expect(r.blocks[0].days.length).toBe(2);
  });
  it('работа не ставится на выходные', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-09-12', workH: 8 }], S, TODAY);
    expect(r.blocks[0].workTo).toBe('2026-09-11');
  });
});

describe('блоки не накладываются друг на друга', () => {
  it('заявка со сроком среда уступает выезду и уезжает на вторник', () => {
    const r = planSchedule([
      { id: 'trip', kind: 'trip', engineer: 'ivan', sla: '2026-09-10', workH: 8, driveToH: 4, driveBackH: 4 },
      { id: 'job', kind: 'job', engineer: 'ivan', sla: '2026-09-09', workH: 8 }
    ], S, TODAY);
    const trip = r.blocks.find(b => b.id === 'trip');
    const job = r.blocks.find(b => b.id === 'job');
    expect(trip.workFrom).toBe('2026-09-10');
    expect(cell(trip, '2026-09-09').driveH).toBe(4);
    expect(job.workFrom).toBe('2026-09-08');       // среда занята дорогой -> вторник
    expect(job.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('разные инженеры друг другу не мешают', () => {
    const r = planSchedule([
      { id: 'a', engineer: 'ivan', sla: '2026-09-10', workH: 8 },
      { id: 'b', engineer: 'petro', sla: '2026-09-10', workH: 8 }
    ], S, TODAY);
    expect(r.blocks.every(b => b.workFrom === '2026-09-10')).toBe(true);
  });

  it('неназначенная заявка не сталкивается ни с кем, но попадает в загрузку', () => {
    const r = planSchedule([
      { id: 'a', engineer: 'ivan', sla: '2026-09-10', workH: 8 },
      { id: 'free', engineer: null, sla: '2026-09-10', workH: 8 }
    ], S, TODAY);
    expect(r.blocks.find(b => b.id === 'free').workFrom).toBe('2026-09-10');
    expect(r.load['ivan|2026-09-10'].workH).toBe(8);
    expect(r.load[' free|2026-09-10'].workH).toBe(8);
  });
});

describe('ручные даты выезда — закон', () => {
  it('часы раскладываются внутри поставленных дат', () => {
    const r = planSchedule([
      { id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-09', to: '2026-09-11', workH: 16, driveToH: 4, driveBackH: 4 }
    ], S, TODAY);
    const b = r.blocks[0];
    expect(b.fixed).toBe(true);
    expect(b.days.map(d => d.iso)).toEqual(['2026-09-09', '2026-09-10', '2026-09-11']);
    expect(b.ok).toBe(true);
  });

  it('перегруз ручных дат — предупреждение админу, даты не двигаются', () => {
    const r = planSchedule([
      { id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-10', to: '2026-09-10', workH: 16, driveToH: 4, driveBackH: 4 }
    ], S, TODAY);
    const b = r.blocks[0];
    // Даты — закон: выезд начинается в свой день. Но 24 часа в одни сутки не
    // влезают, и график не делает вид, что влезли: работа честно уходит
    // дальше, а админ получает предупреждение.
    expect(b.from).toBe('2026-09-10');
    expect(b.ok).toBe(false);
    expect(b.why).toBe('overflow');
    expect(r.warnings.some(w => w.kind === 'overflow' && w.blockId === 't')).toBe(true);
    expect(r.warnings.some(w => /не помещается в даты выезда/i.test(w.text))).toBe(true);
  });

  it('ручной выезд позже срока — предупреждение о сроке', () => {
    const r = planSchedule([
      { id: 't', kind: 'trip', engineer: 'ivan', sla: '2026-09-08', from: '2026-09-10', to: '2026-09-10', workH: 8 }
    ], S, TODAY);
    expect(r.warnings.some(w => w.kind === 'late' && w.blockId === 't')).toBe(true);
  });

  it('ручные даты занимают день первыми — свободная заявка уступает', () => {
    const r = planSchedule([
      { id: 'free', engineer: 'ivan', sla: '2026-09-10', workH: 8 },
      { id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-10', to: '2026-09-10', workH: 8 }
    ], S, TODAY);
    expect(r.blocks.find(b => b.id === 't').workFrom).toBe('2026-09-10');
    expect(r.blocks.find(b => b.id === 'free').workFrom).toBe('2026-09-09');
  });

  it('выходные внутри ручных дат работой не заняты', () => {
    const r = planSchedule([
      { id: 't', kind: 'trip', from: '2026-09-11', to: '2026-09-14', workH: 16 }
    ], S, TODAY);
    expect(r.blocks[0].days.map(d => d.iso)).toEqual(['2026-09-11', '2026-09-14']);
  });
});

describe('не успеваем', () => {
  it('срок в прошлом — работа встаёт с сегодня и помечается late', () => {
    const r = planSchedule([{ id: 'a', sla: '2026-08-20', workH: 8 }], S, { today: '2026-09-07' });
    const b = r.blocks[0];
    expect(b.ok).toBe(false);
    expect(b.why).toBe('late');
    expect(r.warnings[0].kind).toBe('late');
  });
});

describe('driveOfLegs', () => {
  it('одно плечо делится пополам', () => {
    expect(driveOfLegs([{ km: 100, h: 2 }])).toEqual({ toH: 1, backH: 1, midH: 0, km: 100 });
  });
  it('депо -> А -> Б -> депо: туда, между, обратно', () => {
    const d = driveOfLegs([{ km: 100, h: 2 }, { km: 30, h: 0.5 }, { km: 120, h: 2.5 }]);
    expect(d.toH).toBe(2);
    expect(d.midH).toBe(0.5);
    expect(d.backH).toBe(2.5);
    expect(d.km).toBe(250);
  });
  it('пустые плечи — нули', () => {
    expect(driveOfLegs(null)).toEqual({ toH: 0, backH: 0, midH: 0, km: 0 });
  });
});

describe('заявки внутри выезда', () => {
  it('дорога занимает первый день, работа идёт со второго', () => {
    // Выезд пн 07 — пт 11, 8 ч дороги туда, 8 ч обратно, 16 ч работ.
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-07', to: '2026-09-11',
      workH: 16, driveToH: 8, driveBackH: 8,
      jobs: [{ id: 'a', workH: 8, sla: '2026-09-08' }, { id: 'b', workH: 8, sla: '2026-09-11' }],
      jobIds: ['a', 'b']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(cell(b, '2026-09-07').driveH).toBe(8);
    expect(cell(b, '2026-09-07').workH).toBe(0);
    expect(b.workFrom).toBe('2026-09-08');
    expect(b.workTo).toBe('2026-09-09');
    // Дорога обратно идёт сразу за работой, а не в последний день выезда:
    // доделали в среду — в четверг едем. Пятница остаётся свободной.
    expect(cell(b, '2026-09-10').driveH).toBe(8);
    expect(cell(b, '2026-09-11')).toBe(undefined);   // пустых дней в раскладке нет
  });

  it('дорога занимает остаток дня, в котором кончилась работа', () => {
    // 11 ч работ и 8 ч дороги обратно. Раньше выходило окно: чт — 3 ч работы
    // и пять часов простоя, пт — целая смена дороги.
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-09', to: '2026-09-14',
      workH: 11, driveBackH: 8, jobs: [{ id: 'a', workH: 11, sla: '2026-09-30' }], jobIds: ['a']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(cell(b, '2026-09-09').workH).toBe(8);
    expect(cell(b, '2026-09-10').workH).toBe(3);
    expect(cell(b, '2026-09-10').driveH).toBe(5);   // остаток дня — дорога
    expect(cell(b, '2026-09-11').driveH).toBe(3);
  });

  it('срок в середине выезда не считается просроченным', () => {
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-07', to: '2026-09-11',
      workH: 16, driveToH: 8, driveBackH: 8, sla: '2026-09-08',
      jobs: [{ id: 'a', workH: 8, sla: '2026-09-08' }, { id: 'b', workH: 8, sla: '2026-09-11' }],
      jobIds: ['a', 'b']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(b.jobDays.a).toBe('2026-09-08');   // первая заявка — вторым днём
    expect(b.jobDays.b).toBe('2026-09-09');
    expect(b.ok).toBe(true);
    expect(r.warnings.filter(w => w.kind === 'late')).toEqual([]);
  });

  it('опоздавшей считается та заявка, которая правда опоздала', () => {
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-07', to: '2026-09-11',
      workH: 24, driveToH: 8, driveBackH: 8,
      jobs: [{ id: 'a', workH: 8, sla: '2026-09-09' }, { id: 'b', workH: 16, sla: '2026-09-08' }],
      jobIds: ['a', 'b']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(b.jobDays.a).toBe('2026-09-08');
    expect(b.ok).toBe(false);
    const late = r.warnings.filter(w => w.kind === 'late');
    expect(late.length).toBe(1);
    expect(late[0].jobId).toBe('b');
  });

  it('порядок заявок — порядок маршрута, а не сроков', () => {
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-07', to: '2026-09-09',
      workH: 16,
      jobs: [{ id: 'дальняя', workH: 8, sla: '2026-09-30' }, { id: 'срочная', workH: 8, sla: '2026-09-07' }],
      jobIds: ['дальняя', 'срочная']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(b.jobDays['дальняя']).toBe('2026-09-07');
    expect(b.jobDays['срочная']).toBe('2026-09-08');
    expect(r.warnings.some(w => w.kind === 'late' && w.jobId === 'срочная')).toBe(true);
  });
});

describe('часовая шкала', () => {
  it('час 8 при смене 8 — это утро следующего рабочего дня', () => {
    expect(normPos({ iso: '2026-09-11', h: 8 }, S)).toEqual({ iso: '2026-09-14', h: 0 });
    expect(addHours({ iso: '2026-09-11', h: 6 }, 4, S)).toEqual({ iso: '2026-09-14', h: 2 });
    expect(addHours({ iso: '2026-09-14', h: 1 }, -3, S)).toEqual({ iso: '2026-09-11', h: 6 });
  });
  it('этап режется по границам смены', () => {
    const p = piecesOf({ iso: '2026-09-09', h: 6 }, [{ k: 'd', h: 4 }, { k: 'w', h: 8 }], S);
    expect(p.map(x => [x.iso, x.from, x.to, x.k])).toEqual([
      ['2026-09-09', 6, 8, 'd'],
      ['2026-09-10', 0, 2, 'd'],
      ['2026-09-10', 2, 8, 'w'],
      ['2026-09-11', 0, 2, 'w']
    ]);
  });
  it('часы показываются от начала смены', () => {
    expect(clockOf(0, { dayStart: 8 })).toBe('08:00');
    expect(clockOf(2.5, { dayStart: 8 })).toBe('10:30');
  });
});

describe('ручная расстановка', () => {
  const TRIP = {
    id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-09', to: '2026-09-11',
    workH: 6, driveToH: 2, driveBackH: 2,
    jobs: [{ id: 'a', workH: 6, sla: '2026-09-30' }], jobIds: ['a']
  };
  it('начало сдвигает этап по часам, сумма не меняется', () => {
    const auto = planSchedule([TRIP], S, TODAY).blocks[0];
    expect(auto.start).toEqual({ iso: '2026-09-09', h: 0 });
    expect(auto.manual).toBe(false);

    const man = planSchedule([Object.assign({}, TRIP, { plan: { start: { d: '2026-09-09', h: 4 } } })], S, TODAY).blocks[0];
    expect(man.manual).toBe(true);
    expect(man.start).toEqual({ iso: '2026-09-09', h: 4 });
    // 2 ч дороги + 6 ч работ + 2 ч дороги = те же 10 ч, просто с 12:00
    const sum = a => a.pieces.reduce((x, p) => x + p.h, 0);
    expect(sum(man)).toBeCloseTo(sum(auto), 6);
    expect(cell(man, '2026-09-09').driveH).toBe(2);
    expect(cell(man, '2026-09-09').workH).toBe(2);
    expect(cell(man, '2026-09-10').workH).toBe(4);
    expect(cell(man, '2026-09-10').driveH).toBe(2);
  });

  it('изменение часов работ ручную расстановку не ломает', () => {
    const more = planSchedule([Object.assign({}, TRIP, {
      workH: 10, jobs: [{ id: 'a', workH: 10, sla: '2026-09-30' }],
      plan: { start: { d: '2026-09-09', h: 4 } }
    })], S, TODAY).blocks[0];
    expect(more.manual).toBe(true);
    expect(more.start).toEqual({ iso: '2026-09-09', h: 4 });
  });

  it('начало вне дат выезда отбрасывается с предупреждением', () => {
    const r = planSchedule([Object.assign({}, TRIP, { plan: { start: { d: '2026-09-21', h: 0 } } })], S, TODAY);
    const b = r.blocks[0];
    expect(b.manual).toBe(false);
    expect(b.start).toEqual({ iso: '2026-09-09', h: 0 });
    expect(r.warnings.some(w => w.kind === 'stale' && w.blockId === 't')).toBe(true);
  });
});

describe('два этапа в одном дне', () => {
  it('стоят встык и не считаются столкновением', () => {
    const r = planSchedule([
      { id: 'a', engineer: 'ivan', sla: '2026-09-10', workH: 4, jobs: [{ id: 'a', workH: 4, sla: '2026-09-10' }] },
      { id: 'b', engineer: 'ivan', sla: '2026-09-10', workH: 4, jobs: [{ id: 'b', workH: 4, sla: '2026-09-10' }] }
    ], S, TODAY);
    const A = r.blocks.find(x => x.id === 'a'), B = r.blocks.find(x => x.id === 'b');
    expect(A.workFrom).toBe('2026-09-10');
    expect(B.workFrom).toBe('2026-09-10');          // тот же день — это нормально
    expect(r.load['ivan|2026-09-10'].workH).toBe(8);
    expect(r.warnings).toEqual([]);
  });
});
