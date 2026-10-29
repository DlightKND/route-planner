import {it,expect} from 'vitest';
import {plannerFactDays,summarizePlannerFactDay} from '../src/core/planner-week.js';
const date='2026-10-26';
const road=(id,start,end,extra={})=>({id,source_id:id,trip_id:'t',date,people:['a'],kind:'road',source:'gps',start,end,minutes:(end-start)*60,...extra});
it('turns 200 adjoining GPS pieces into one trip/day summary and one readable road episode without editing the facts',()=>{
 const facts=Array.from({length:200},(_,i)=>road('r'+i,8+i/60,8+(i+1)/60)),before=structuredClone(facts),summaries=plannerFactDays(facts);
 expect(summaries).toHaveLength(1);expect(summaries[0].roadMinutes).toBeCloseTo(200);expect(summaries[0].episodes).toHaveLength(1);expect(summaries[0].episodes[0].ids).toHaveLength(200);expect(facts).toEqual(before);
});
it('separates engineers, trips and calendar days while honoring the visible engineer set',()=>{
 const facts=[road('shared',8,9,{people:['a','b']}),road('second',10,11,{trip_id:'t2'}),road('tomorrow',8,9,{date:'2026-10-27'})];
 expect(plannerFactDays(facts).map(s=>[s.person,s.trip_id,s.date])).toHaveLength(4);
 expect(plannerFactDays(facts,['b'])).toHaveLength(1);expect(plannerFactDays(facts,['b'])[0].roadMinutes).toBe(60);
 expect(()=>summarizePlannerFactDay(facts,'a')).toThrow(/одному выезду/);
});
it('counts overlapping evidence once, preserves actual gaps and distinguishes reconstruction from unknown movement',()=>{
 const facts=[road('gps',8,9),road('duplicate',8.5,9),road('estimate',8.5,9.5,{source:'estimated',track_kind:'road'}),road('unknown',10,11,{source:'estimated',track_kind:'line'}),road('stay',11,12,{kind:'stop',stay_id:'s',confirmed:true})];
 const s=plannerFactDays(facts)[0];expect(s.roadMinutes).toBe(90);expect(s.stopMinutes).toBe(60);expect(s.tones).toEqual({gps:60,estimated:30,stop:60,unknown:90});expect(s.minutes).toBe(240);
 expect(s.episodes.filter(p=>p.inferred)).toMatchObject([{start:9.5,end:10,minutes:30}]);
});
it('keeps stops from different records and review states separate',()=>{
 const s=plannerFactDays([road('a',8,9,{kind:'stop',stay_id:'s1',confirmed:true}),road('b',9,10,{kind:'stop',stay_id:'s2',confirmed:false}),road('c',10,11)])[0];
 expect(s.episodes.map(e=>[e.kind,e.stay_id,e.confirmed])).toEqual([['stop','s1',true],['stop','s2',false],['road',null,false]]);expect(s.stopMinutes).toBe(120);
});
it('uses elapsed UTC minutes across the DST change while preserving displayed local endpoints',()=>{
 const f=road('fold',3.5,4.5,{date:'2026-10-25',from:'2026-10-25T00:30:00Z',to:'2026-10-25T02:30:00Z',minutes:120}),s=plannerFactDays([f])[0];
 expect(s.roadMinutes).toBe(120);expect(s.minutes).toBe(120);expect(s).toMatchObject({start:3.5,end:4.5});
});
it('does not invent evidence for an empty or invalid day',()=>{expect(summarizePlannerFactDay([],'a')).toBeNull();expect(plannerFactDays([road('invalid',10,9)])).toEqual([]);});
