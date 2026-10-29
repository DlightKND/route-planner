import {it,expect} from 'vitest';
import {movePlannerPart,splitPlannerPart,joinPlannerParts,groupHours,plannerChangeIssue} from '../src/core/planner-workspace.js';
const date='2026-10-26',next='2026-10-27',settings={dayStart:7,dayEnd:16,toleranceH:1,weekend:[0,6],staffDay:{}};
const group=(hours=5)=>({source_key:'work:o',kind:'work',order_id:'o',people:['a','b'],manual:false,parts:[{id:'p',date,start:12,end:12+hours,offset:0}]});
const positions=g=>g.parts.map(({date,start,end,offset})=>({date,start,end,offset}));
it('spills five hours from 13:00 into four hours today and one tomorrow without changing the source',()=>{
 const g=group(),original=structuredClone(g),s=structuredClone(settings),moved=movePlannerPart(g,'p',date,13,s);
 expect(positions(moved)).toEqual([{date,start:13,end:17,offset:0},{date:next,start:7,end:8,offset:4}]);
 expect(moved.manual).toBe(true);expect(groupHours(moved)).toBe(5);expect(g).toEqual(original);expect(s).toEqual(settings);
 expect(new Set(moved.parts.map(p=>p.id)).size).toBe(2);expect(new Set(moved.parts.map(p=>p.carry_root))).toEqual(new Set(['p']));
});
it('moves the same work repeatedly and pulls its remainder back when it fits again',()=>{
 let g=movePlannerPart(group(),'p',date,13,settings);g=movePlannerPart(g,'p',date,14,settings);
 expect(positions(g)).toEqual([{date,start:14,end:17,offset:0},{date:next,start:7,end:9,offset:3}]);
 g=movePlannerPart(g,'p',date,12,settings);expect(positions(g)).toEqual([{date,start:12,end:17,offset:0}]);expect(groupHours(g)).toBe(5);
});
it('keeps an existing automatic multi-day work together before its first manual move',()=>{
 const g={...group(),parts:[{id:'p',date,start:14,end:17,offset:0},{id:'auto-tail',date:next,start:7,end:9,offset:3}]};
 expect(positions(movePlannerPart(g,'p',date,13,settings))).toEqual([{date,start:13,end:17,offset:0},{date:next,start:7,end:8,offset:4}]);
 const cut=splitPlannerPart(g,'p',15,'cut');const moved=movePlannerPart(cut,'cut',date,16,settings);
 expect(moved.parts.find(p=>p.id==='p')).toMatchObject({start:14,end:15});expect(groupHours(moved)).toBe(5);expect(moved.parts.at(-1)).toMatchObject({date:next,start:7,end:10,offset:2});
});
it('anchors a drag on the carried piece to its logical position in the whole work',()=>{
 let g=movePlannerPart(group(),'p',date,13,settings),tail=g.parts[1];g=movePlannerPart(g,tail.id,next,8,settings);
 expect(positions(g)).toEqual([{date,start:14,end:17,offset:0},{date:next,start:7,end:9,offset:3}]);
});
it('skips empty weekends but uses an individually opened Saturday for the whole assigned crew',()=>{
 const friday='2026-10-30',g=movePlannerPart(group(),'p',friday,13,settings);
 expect(g.parts[1]).toMatchObject({date:'2026-11-02',start:7,end:8});
 const s={...settings,staffDay:Object.fromEntries(['a','b'].map(id=>[id+'|2026-10-31',{start_h:9,end_h:12,tol_h:0}]))};
 expect(movePlannerPart(group(),'p',friday,13,s).parts[1]).toMatchObject({date:'2026-10-31',start:9,end:10});
 delete s.staffDay['b|2026-10-31'];expect(movePlannerPart(group(),'p',friday,13,s).parts[1].date).toBe('2026-11-02');
});
it('uses the earliest crew ceiling and each next-day individual start without editing those windows',()=>{
 const s={...settings,staffDay:{['a|'+date]:{start_h:7,end_h:15,tol_h:1},['a|'+next]:{start_h:9,end_h:16,tol_h:0},['b|'+next]:{start_h:10,end_h:16,tol_h:0}}},before=structuredClone(s);
 expect(positions(movePlannerPart(group(),'p',date,13,s))).toEqual([{date,start:13,end:16,offset:0},{date:next,start:10,end:12,offset:3}]);expect(s).toEqual(before);
});
it('normalizes a drop at the ceiling and distributes long work over several working days',()=>{
 expect(positions(movePlannerPart(group(),'p',date,17,settings))).toEqual([{date:next,start:7,end:12,offset:0}]);
 expect(positions(movePlannerPart(group(12),'p',date,16,settings))).toEqual([{date,start:16,end:17,offset:0},{date:next,start:7,end:17,offset:1},{date:'2026-10-28',start:7,end:8,offset:11}]);
});
it('keeps fractional durations and respects the existing minimum size for newly created parts',()=>{
 const moved=movePlannerPart(group(4.1),'p',date,13,settings);expect(groupHours(moved)).toBeCloseTo(4.1);expect(moved.parts.every(p=>p.end-p.start>=.25-1e-8)).toBe(true);expect(moved.parts[0].end).toBeLessThanOrEqual(17);
 expect(movePlannerPart(group(.3),'p',date,16.75,settings).parts).toHaveLength(1);
 expect(movePlannerPart(group(.2),'p',date,17,settings).parts[0]).toMatchObject({id:'p',date:next,start:7,end:7.2});
});
it('retains explicit cuts as independent work chunks and joins them through the same calendar',()=>{
 const carried=movePlannerPart(group(),'p',date,13,settings),cut=splitPlannerPart(carried,'p',15,'manual-cut');
 const shifted=movePlannerPart(cut,'manual-cut',date,16,settings);expect(shifted.parts.find(p=>p.id==='p')).toMatchObject({start:13,end:15});expect(groupHours(shifted)).toBe(5);
 const joined=joinPlannerParts(cut,'manual-cut','p',settings);expect(positions(joined)).toEqual(positions(carried));expect(groupHours(joined)).toBe(5);
});
it('checks conflicts in the carried day even if that assignment is hidden from the current view',()=>{
 const original=group(),other={...group(1),source_key:'work:other',order_id:'other',parts:[{id:'other',date:next,start:7,end:8,offset:0}]},data={settings,groups:[original,other],orders:[{id:'o'},{id:'other'}],trips:[]};
 expect(plannerChangeIssue([movePlannerPart(original,'p',date,13,settings)],data,{id:'manager',role:'logist'})).toMatch(/уже есть/);
});
it('fails safely when there are no open days for the assigned crew',()=>{
 const g=group(),before=structuredClone(g);expect(()=>movePlannerPart(g,'p',date,13,{...settings,weekend:[0,1,2,3,4,5,6]})).toThrow(/рабочий день/);expect(g).toEqual(before);
});
