import { describe, it, expect } from 'vitest';
import { planSchedule, driveOfLegs, dayIso, dayMs, isWorkday } from '../src/core/schedule.js';

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
    expect(b.from).toBe('2026-09-10');
    expect(b.to).toBe('2026-09-10');
    expect(b.ok).toBe(false);
    expect(b.why).toBe('overflow');
    expect(r.warnings[0].kind).toBe('overflow');
    expect(r.warnings[0].blockId).toBe('t');
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
