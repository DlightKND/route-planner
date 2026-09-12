import { describe, it, expect } from 'vitest';
import { planSchedule, driveOfLegs, dayIso, dayMs, isWorkday,
  normPos, addHours, piecesOf, compactRoadSegments, dayScaleBounds, clockOf, scheduleJobIncluded, tripRouteSegments, dayWindow, weekRowSpan, q4 } from '../src/core/schedule.js';

// Календарь для тестов: 2026-09-07 понедельник, 09-08 вт, 09-09 ср,
// 09-10 чт, 09-11 пт, 09-12 сб, 09-13 вс.
const S = { dayStart: 7, dayEnd: 15, toleranceH: 0, weekend: [0,6], staffDay: {} };
const TODAY = { today: '2026-09-01' };

const cell = (r, iso) => r.days.find(d => d.iso === iso);

describe('состав рабочего графика', () => {
  it('закрытая заявка остаётся в идущем выезде, но не после закрытия выезда', () => {
    expect(scheduleJobIncluded('done','in_progress')).toBe(true);
    expect(scheduleJobIncluded('done','finished')).toBe(true);
    expect(scheduleJobIncluded('done','done')).toBe(false);
    expect(scheduleJobIncluded('done',null)).toBe(false);
    expect(scheduleJobIncluded('cancelled','in_progress')).toBe(false);
  });

  it('раскладывает legacy-выезд с промежуточными точками и без legs', () => {
    const stops=['depot','wp1','job-a','job-b','wp2','depot'].map(key=>({key}));
    const segs=tripRouteSegments(stops,[
      {id:'a',key:'job-a',h:5}, {id:'b',key:'job-b',h:16}
    ],[],27.643194444444443);
    expect(segs.map(x=>x.k)).toEqual(['d','d','w','d','w','d','d']);
    expect(segs.filter(x=>x.k==='d').reduce((n,x)=>n+x.h,0)).toBeCloseTo(27.643194444444443);
    expect(segs.filter(x=>x.k==='w').map(x=>[x.jobId,x.h])).toEqual([['a',5],['b',16]]);
  });
});

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
  it('сохраняет чередование плеч и работ по точкам маршрута', () => {
    // Пн — до первой точки, вт — работа, ср — переезд ко второй,
    // чт — работа, пт — возвращение. Промежуточная дорога не должна
    // сливаться с работами в один островок.
    const r = planSchedule([{
      id: 't', kind: 'trip', engineer: 'ivan', from: '2026-09-07', to: '2026-09-11',
      workH: 16, driveToH: 8, driveMidH: 8, driveBackH: 8,
      routeSegs: [{ k: 'd', h: 8 }, { k: 'w', h: 8, jobId: 'a' }, { k: 'd', h: 8 }, { k: 'w', h: 8, jobId: 'b' }, { k: 'd', h: 8 }],
      jobs: [{ id: 'a', workH: 8, sla: '2026-09-30' }, { id: 'b', workH: 8, sla: '2026-09-30' }], jobIds: ['a', 'b']
    }], S, TODAY);
    const b = r.blocks[0];
    expect(b.pieces.map(p => [p.iso, p.k, p.h])).toEqual([
      ['2026-09-07', 'd', 8], ['2026-09-08', 'w', 8], ['2026-09-09', 'd', 8],
      ['2026-09-10', 'w', 8], ['2026-09-11', 'd', 8]
    ]);
    expect(b.pieces.filter(p => p.k === 'w').map(p => p.jobId)).toEqual(['a', 'b']);
    expect(b.jobDays).toEqual({ a: '2026-09-08', b: '2026-09-10' });
  });
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

describe('часы суток и окна дня', () => {
  it('переносит поток через потолок рабочего окна и выходные', () => {
    expect(normPos({iso:'2026-09-11',t:15},S)).toEqual({iso:'2026-09-14',t:7});
    expect(addHours({iso:'2026-09-11',t:13},4,S)).toEqual({iso:'2026-09-14',t:9});
    expect(addHours({iso:'2026-09-14',t:8},-3,S)).toEqual({iso:'2026-09-11',t:13});
  });
  it('режет поток по потолку и хранит настоящие часы суток', () => {
    const p=piecesOf({iso:'2026-09-09',t:13},[{k:'d',h:4},{k:'w',h:8}],S,'ivan',[]);
    expect(p.map(x=>[x.iso,x.from,x.to,x.k])).toEqual([
      ['2026-09-09',13,15,'d'],['2026-09-10',7,9,'d'],['2026-09-10',9,15,'w'],['2026-09-11',7,9,'w']]);
  });
  it('учитывает индивидуальное окно',()=>{
    const X={...S,staffDay:{'ivan|2026-09-09':{start_h:8,end_h:16,tol_h:2}}};
    expect(dayWindow('ivan','2026-09-09',X)).toMatchObject({start:8,end:16,tol:2,ceiling:18});
  });
  it('открывает конкретный выходной только явным индивидуальным окном',()=>{
    const X={...S,staffDay:{'ivan|2026-09-13':{start_h:7,end_h:16,tol_h:1}}};
    expect(dayWindow('ivan','2026-09-12',X)).toBeNull();
    expect(dayWindow('ivan','2026-09-13',X)).toMatchObject({start:7,end:16,ceiling:17});
    expect(piecesOf({iso:'2026-09-13',t:7},[{k:'d',h:4}],X,'ivan',[]))
      .toMatchObject([{iso:'2026-09-13',from:7,to:11,h:4}]);
  });
  it('округляет общий шаг до четверти часа',()=>expect(q4(8.13)).toBe(8.25));
});

describe('ручная расстановка разрезами',()=>{
  const TRIP={id:'t',kind:'trip',engineer:'ivan',from:'2026-09-09',to:'2026-09-11',workH:6,driveToH:2,driveBackH:2,jobs:[{id:'a',workH:6,sla:'2026-09-30'}],jobIds:['a']};
  it('хранит начало как час суток',()=>{
    const b=planSchedule([{...TRIP,plan:{start:{d:'2026-09-09',t:11}}}],S,TODAY).blocks[0];
    expect(b.manual).toBe(true);expect(b.start).toEqual({iso:'2026-09-09',t:11});
    expect(b.pieces.reduce((n,p)=>n+p.h,0)).toBe(10);
  });
  it('прибивает продолжение блока разрезом по пройденным часам',()=>{
    const b=planSchedule([{...TRIP,plan:{start:{d:'2026-09-09',t:7},cuts:[{after:5,at:{d:'2026-09-10',t:9}}]}}],S,TODAY).blocks[0];
    const pinned=b.pieces.find(p=>p.pinned);expect(pinned).toMatchObject({iso:'2026-09-10',from:9,at:5});
  });
  it('отбрасывает разрез вне дат с предупреждением stale',()=>{
    const r=planSchedule([{...TRIP,plan:{start:{d:'2026-09-09',t:7},cuts:[{after:5,at:{d:'2026-09-20',t:9}}]}}],S,TODAY);
    expect(r.warnings.some(w=>w.kind==='stale')).toBe(true);
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

describe('геометрия недели',()=>{
  it('даёт пустому рабочему дню 40 px при восьмичасовом тестовом окне',()=>{
    expect(weekRowSpan('2026-09-08',['ivan'],[],S,5).px).toBe(40);
  });
  it('даёт выходному 30 px',()=>expect(weekRowSpan('2026-09-12',['ivan'],[],S,5)).toMatchObject({weekend:true,px:30}));
  it('растёт до работы, но не выше индивидуального допуска',()=>{
    const W={dayStart:7,dayEnd:16,toleranceH:2,weekend:[0,6],staffDay:{}};
    expect(weekRowSpan('2026-09-08',['ivan'],[{engineer:'ivan',iso:'2026-09-08',to:13}],W,5).px).toBe(45);
    expect(weekRowSpan('2026-09-08',['ivan'],[{engineer:'ivan',iso:'2026-09-08',to:17.5}],W,5).px).toBe(53);
    expect(weekRowSpan('2026-09-08',['ivan'],[{engineer:'ivan',iso:'2026-09-08',to:20}],W,5).px).toBe(55);
  });
  it('13 часов вытекают после потолка в следующий день',()=>{
    const W={dayStart:7,dayEnd:16,toleranceH:2,weekend:[0,6],staffDay:{}};
    const p=piecesOf({iso:'2026-09-07',t:7},[{k:'d',h:13}],W,'ivan',[]);
    expect(p.map(x=>[x.iso,x.h])).toEqual([['2026-09-07',11],['2026-09-08',2]]);
  });
});
