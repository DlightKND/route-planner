import {it,expect} from 'vitest';
import {dayKey,intervalText,timelineDays,durationText,distanceText,decisionLabel,zeroPresenceSignature,clusterScreenPoints,personHours} from '../src/core/journal-display.js';
it('keeps unknown values separate from a known zero and rounds only display values',()=>{
 expect(durationText(null)).toBe('Нет данных');expect(durationText('')).toBe('Нет данных');expect(durationText(0)).toBe('0 мин');expect(durationText(107.65)).toBe('1 ч 48 мин');expect(distanceText(861.38)).toBe('861,4 км');expect(distanceText(null)).toBe('Нет данных');expect(personHours(null,['e'])).toBeNull();expect(personHours(0,['e'])).toBe(0);expect(personHours(210,['e','e','f'])).toBe(7);expect(personHours(210,['e'],false)).toBeNull();
});
it('uses Kyiv calendar days across midnight and both DST transitions',()=>{
 expect(dayKey('2026-10-24T21:00Z')).toBe('2026-10-25');expect(intervalText('2026-10-20T04:24Z','2026-10-20T07:08Z')).toBe('20 окт., 07:24–10:08');expect(intervalText('2026-10-20T20:49Z','2026-10-21T07:25Z')).toContain('21 окт.');
 for(const [a,b,hours] of [['2026-10-24T21:00Z','2026-10-25T22:00Z',25],['2026-03-28T22:00Z','2026-03-29T21:00Z',23]]){const rows=timelineDays(a,b);expect(rows).toHaveLength(1);expect((rows[0].to-rows[0].from)/3600000).toBe(hours);}
 const days=timelineDays('2026-10-20T03:40Z','2026-10-23T07:46Z');expect(days).toHaveLength(4);expect(days.reduce((sum,d)=>sum+d.width,0)).toBeCloseTo(100,10);expect(timelineDays('bad','2026-10-23')).toEqual([]);
});
it('separates draft intent, saved zero and missing accepted time',()=>{
 expect(decisionLabel({status:'detected'},{stop_kind:'visit'},true)).toBe('Решение не сохранено');expect(decisionLabel({status:'approved',minutes_mgr:0},{},false)).toContain('время не принято');expect(decisionLabel({status:'approved',minutes_mgr:null},{},false)).toContain('время не определено');expect(zeroPresenceSignature({status:'approved',minutes_mgr:null})).toBeNull();expect(zeroPresenceSignature({status:'approved',minutes_mgr:''})).toBeNull();
 const stay={id:'s',status:'approved',minutes_mgr:0,crew_ids:['a'],job_id:'j'};expect(zeroPresenceSignature(stay)).not.toBeNull();expect(zeroPresenceSignature(stay)).not.toBe(zeroPresenceSignature({...stay,crew_ids:['b']}));
});
it('clusters nearby unequal coordinates in screen space, retaining every member',()=>{
 const points=[{id:'a',x:0,y:0},{id:'b',x:30,y:0},{id:'c',x:100,y:0}];const groups=clusterScreenPoints(points);expect(groups.map(g=>g.map(p=>p.id))).toEqual([['a','b'],['c']]);expect(clusterScreenPoints(points.map(p=>({...p,x:p.x*3})))).toHaveLength(3);expect(clusterScreenPoints([])).toEqual([]);
});
