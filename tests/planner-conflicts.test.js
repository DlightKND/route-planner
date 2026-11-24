import {it,expect} from 'vitest';
import {plannerConflicts,plannerGroupConflicts,plannerOvertimeChanges} from '../src/core/planner-conflicts.js';
import {dayWindow} from '../src/core/schedule.js';
import {plannerEditIssue,resetPlannerTrip,shiftPlannerTrip} from '../src/core/planner-workspace.js';

const settings={dayStart:7,dayEnd:15,toleranceH:0,weekend:[0,6],staffDay:{}};
const data=(order,parts,extra={})=>({settings,requests:[{id:'r',due_date:'2026-11-27'}],
  orders:[{id:'o',job_id:'r',status:'assigned',date_from:'2026-11-24',date_to:'2026-11-24',...order}],
  groups:[{source_key:'work:o:t',kind:'work',order_id:'o',trip_id:'t',people:['a','b'],parts,...extra}]});

it('reports overflow past the task end date with the hours that do not fit',()=>{
  // Road 7–12, work 12–15 on 24.11 and the remaining 2 h on 25.11 (shift 7–15, no overtime).
  const d=data({},[{date:'2026-11-24',start:12,end:15},{date:'2026-11-25',start:7,end:9}]);
  const [conflict]=plannerGroupConflicts(d.groups[0],d);
  expect(conflict).toMatchObject({type:'overflow',date:'2026-11-24',until:'2026-11-25',hours:2,label:'Не помещается в срок · +2 ч'});
  expect(plannerOvertimeChanges(d.groups[0],conflict,d,dayWindow)).toEqual([
    {person:'a',date:'2026-11-24',start:7,end:15,tolerance:2},{person:'b',date:'2026-11-24',start:7,end:15,tolerance:2}]);
});

it('adds approved overtime to what the day already has and refuses closed or impossible days',()=>{
  const d=data({},[{date:'2026-11-25',start:7,end:8.1}]);
  d.settings={...settings,staffDay:{'a|2026-11-24':{tol_h:1},'b|2026-11-24':{start_h:7,end_h:22}}};
  const [conflict]=plannerGroupConflicts(d.groups[0],d);
  expect(conflict.hours).toBe(1.25);
  const [a,b]=plannerOvertimeChanges(d.groups[0],conflict,d,dayWindow);
  expect(a.tolerance).toBe(2.25);
  expect(b).toEqual({person:'b',date:'2026-11-24',start:7,end:22,tolerance:1.25});
  const closed=data({date_from:'2026-11-28',date_to:'2026-11-28'},[{date:'2026-11-30',start:7,end:8}]);
  expect(plannerOvertimeChanges(closed.groups[0],plannerGroupConflicts(closed.groups[0],closed)[0],closed,dayWindow)[0].issue).toContain('нерабочий день');
});

it('marks a booking as a route-order conflict only and skips closed tasks and roads',()=>{
  const booking=data({},[{date:'2026-11-24',start:7,end:10}],{booking:true,conflict:'order'});
  expect(plannerGroupConflicts(booking.groups[0],booking).map(c=>c.type)).toEqual(['order']);
  const done=data({status:'completed'},[{date:'2026-11-30',start:7,end:8}]);
  expect(plannerConflicts(done).size).toBe(0);
  const road=data({},[{date:'2026-11-30',start:7,end:8}],{kind:'road'});
  expect(plannerConflicts(road).size).toBe(0);
});

it('reports work before the task start date and after the request SLA',()=>{
  const d=data({date_from:'2026-11-25',date_to:'2026-11-30'},[{date:'2026-11-24',start:7,end:9},{date:'2026-11-28',start:7,end:9}]);
  expect(plannerGroupConflicts(d.groups[0],d).map(c=>c.type)).toEqual(['early','sla']);
});

it('keeps a booking out of edits, whole-trip resets and whole-trip moves',()=>{
  const booking={source_key:'work:o:t:b',kind:'work',order_id:'o',trip_id:'t',people:['a'],booking:true,parts:[{id:'b',date:'2026-11-24',start:7,end:9}],auto_parts:[],auto_people:['a']};
  const road={source_key:'road:t:0',kind:'road',trip_id:'t',people:['a'],parts:[{id:'r',date:'2026-11-24',start:9,end:10}],auto_parts:[{id:'r',date:'2026-11-24',start:9,end:10}],auto_people:['a']};
  const d={orders:[{id:'o'}],trips:[{id:'t'}],groups:[booking,road]};
  expect(plannerEditIssue(booking,d,{id:'m',role:'admin'})).toContain('Бронирование не переносится');
  expect(resetPlannerTrip(d.groups,'t').map(g=>g.source_key)).toEqual(['road:t:0']);
  expect(shiftPlannerTrip(d.groups,'t',1).map(g=>g.source_key)).toEqual(['road:t:0']);
});

const resources=()=>({settings,requests:[],profiles:[{id:'a',full_name:'Анна'},{id:'b',full_name:'Иван'},{id:'c',full_name:'Олег'}],
  orders:[{id:'o1',number:1,status:'assigned',lead_engineer:'a',engineer_ids:['a']},{id:'o2',number:2,status:'assigned',lead_engineer:'a',engineer_ids:['a','c']}],
  trips:[{id:'t1',number:11,status:'planned',vehicle_id:'v',vehicle_label:'Sprinter',lead_engineer:'a',engineer_ids:['a']},{id:'t2',number:12,status:'planned',vehicle_id:'v',vehicle_label:'Sprinter',lead_engineer:'b',engineer_ids:['b']}],
  groups:[
    {source_key:'road:t1:0',kind:'road',trip_id:'t1',people:['a'],parts:[{date:'2026-11-24',start:7,end:9}]},
    {source_key:'work:o1:t1',kind:'work',order_id:'o1',trip_id:'t1',people:['a'],parts:[{date:'2026-11-24',start:9,end:12}]},
    {source_key:'work:o2:base',kind:'work',order_id:'o2',trip_id:null,people:['a'],parts:[{date:'2026-11-24',start:11,end:13}]},
    {source_key:'road:t2:0',kind:'road',trip_id:'t2',people:['b'],parts:[{date:'2026-11-24',start:11.5,end:14}]}]});

it('finds one engineer in two blocks at once and points to the other block',()=>{
  const d=resources(),conflicts=plannerConflicts(d);
  const busy=conflicts.get('work:o1:t1').find(c=>c.type==='busy');
  expect(busy).toMatchObject({person:'a',label:'Двойная занятость · Анна',entity:{kind:'order',id:'o2'}});
  expect(busy.detail).toBe('24.11 11:00–12:00 у Анна уже стоит задание №2.');
  expect(conflicts.get('work:o2:base').find(c=>c.type==='busy').key).toBe(busy.key);
  expect(conflicts.get('road:t1:0')?.some(c=>c.type==='busy')).toBeFalsy();
});

it('finds one vehicle in two overlapping trips on their road blocks',()=>{
  const conflicts=plannerConflicts(resources());
  expect(conflicts.get('road:t1:0').find(c=>c.type==='vehicle')).toMatchObject({entity:{kind:'trip',id:'t2'},detail:'Sprinter в это время в выезде №12 (24.11–24.11).'});
  expect(conflicts.get('road:t2:0').find(c=>c.type==='vehicle').entity.id).toBe('t1');
  expect(conflicts.get('work:o1:t1').some(c=>c.type==='vehicle')).toBe(false);
});

it('reports a task engineer outside the trip crew and task dates without a working day',()=>{
  const d=resources();d.groups[1].order_id='o2';d.orders[1].date_from='2026-11-28';d.orders[1].date_to='2026-11-29';
  const types=plannerGroupConflicts(d.groups[1],d);
  expect(types.find(c=>c.type==='crew').detail).toBe('Олег назначен(а) на задание, но не входит в экипаж выезда №11.');
  expect(types.find(c=>c.type==='closed')).toMatchObject({person:'a',date:'2026-11-28'});
  d.settings={...settings,staffDay:{'a|2026-11-29':{start_h:8,end_h:12}}};d.groups=[...d.groups];
  expect(plannerGroupConflicts(d.groups[1],d).some(c=>c.type==='closed')).toBe(false);
});
