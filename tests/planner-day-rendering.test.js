import {it,expect,afterEach} from 'vitest';
import {Window} from 'happy-dom';
import {normalizePlannerData,plannerAssignments} from '../src/core/planner-workspace.js';
import {plannerTimelineHTML} from '../src/planner-view.js';

let win;
afterEach(async()=>{await win?.happyDOM.close();});
const manager={id:'manager',role:'logist'};
function calendar({actor=manager,zoom=18,scale=45,from='2026-10-23',to='2026-10-26',showFact=true,groups=[],facts=[],staffDay={}}={}){
 const data=normalizePlannerData({trips:[{id:'t'}],profiles:[{id:'a'},{id:'b'}],groups,settings:{dayStart:7,dayEnd:16,toleranceH:1,weekend:[0,6],staffDay}});
 win=new Window();win.document.body.innerHTML=plannerTimelineHTML(data,{from,to,people:['a','b'],hideOffHours:true,showFact,viewDays:1,calendarHeight:600,zoom,scale},actor,plannerAssignments(data),facts);
 return win.document;
}
function boundedZones(doc){
 for(const day of doc.querySelectorAll('.pw-day')){
  const height=parseFloat(day.querySelector('.pw-day-body').style.height);
  for(const zone of day.querySelectorAll('.pw-zone')){
   expect(parseFloat(zone.style.top),day.dataset.date).toBeGreaterThanOrEqual(0);
   expect(parseFloat(zone.style.top)+parseFloat(zone.style.height),day.dataset.date).toBeLessThanOrEqual(height+.001);
  }
 }
}
it.each([0,18,60,null])('keeps empty weekend shading inside its compressed day at zoom %s',zoom=>{
 const doc=calendar({zoom});boundedZones(doc);
 for(const date of ['2026-10-24','2026-10-25']){
  const day=doc.querySelector(`[data-date="${date}"]`);
  expect(parseFloat(day.querySelector('.pw-day-body').style.height)).toBe(72);
  expect(day.dataset.closed).toBe('true');
  expect(day.querySelector('.pw-closed-day').textContent).toBe('Выходной');
 }
 for(const date of ['2026-10-23','2026-10-26'])expect(doc.querySelector(`[data-date="${date}"]`).dataset).toMatchObject({start:'7',end:'17',closed:'false'});
});
it('uses individual Sunday hours without expanding empty Saturday or the following Monday',()=>{
 const doc=calendar({staffDay:{'b|2026-10-25':{start_h:10,end_h:14,tol_h:.5}}});boundedZones(doc);
 expect(doc.querySelector('[data-date="2026-10-25"]').dataset).toMatchObject({start:'10',end:'14.5',closed:'false'});
 expect(doc.querySelector('[data-date="2026-10-24"]').dataset.closed).toBe('true');
 expect(doc.querySelector('[data-date="2026-10-26"]').dataset).toMatchObject({start:'7',end:'17'});
});
it('keeps booked weekend work and visible GPS, and removes hidden GPS from the frame',async()=>{
 const options={from:'2026-10-24',to:'2026-10-24',groups:[{source_key:'road:t',kind:'road',trip_id:'t',people:['a'],parts:[{id:'r',date:'2026-10-24',start:19,end:20,offset:0}]}],facts:[{id:'gps',source_id:'gps',date:'2026-10-24',start:22,end:23,people:['a'],kind:'road',source:'gps'}]};
 const doc=calendar(options);boundedZones(doc);
 expect(doc.querySelector('.pw-day').dataset).toMatchObject({start:'19',end:'23',closed:'false'});
 expect(doc.querySelectorAll('.pw-plan,.pw-fact-mark')).toHaveLength(2);
 await win.happyDOM.close();
 const hidden=calendar({...options,showFact:false});boundedZones(hidden);
 expect(hidden.querySelector('.pw-day').dataset).toMatchObject({start:'19',end:'20',closed:'false'});
 expect(hidden.querySelector('.pw-fact-mark')).toBeNull();
});
it('keeps an engineer weekend compact between personal working days',()=>{
 const doc=calendar({actor:{id:'a',role:'engineer'}});boundedZones(doc);
 expect(doc.querySelector('[data-date="2026-10-24"]').dataset.closed).toBe('true');
 expect(doc.querySelector('[data-date="2026-10-26"]').dataset).toMatchObject({start:'7',end:'17'});
});
