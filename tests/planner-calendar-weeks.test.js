import {it,expect,afterEach} from 'vitest';
import {Window} from 'happy-dom';
import {normalizePlannerData,plannerAssignments} from '../src/core/planner-workspace.js';
import {plannerWeeks,plannerTimelineHTML} from '../src/planner-view.js';

let win;
afterEach(async()=>{await win?.happyDOM.close();});
it('anchors calendar weeks on Monday and clips only their visible contents',()=>{
 expect(plannerWeeks('2026-10-29','2026-11-02')).toEqual([
  {from:'2026-10-26',to:'2026-11-01',visibleFrom:'2026-10-29',visibleTo:'2026-11-01'},
  {from:'2026-11-02',to:'2026-11-08',visibleFrom:'2026-11-02',visibleTo:'2026-11-02'}
 ]);
 expect(plannerWeeks('2026-12-31','2027-01-04').map(w=>[w.from,w.to])).toEqual([['2026-12-28','2027-01-03'],['2027-01-04','2027-01-10']]);
 expect(plannerWeeks('2026-10-26','2026-11-01')).toHaveLength(1);
});
it('labels partial weeks and bar dates without including out-of-period work or day actions',()=>{
 const dates=['2026-10-28','2026-10-29','2026-11-02','2026-11-03'];
 const data=normalizePlannerData({trips:[{id:'t'}],profiles:[{id:'a',full_name:'Анна'}],settings:{dayStart:7,dayEnd:16,toleranceH:1,weekend:[0,6]},groups:dates.map((date,i)=>({source_key:'road:'+i,trip_id:'t',kind:'road',people:['a'],parts:[{id:'p'+i,date,start:9,end:10,offset:0}]}))});
 win=new Window();win.document.body.innerHTML=plannerTimelineHTML(data,{from:dates[1],to:dates[2],people:['a'],viewDays:7}, {id:'m',role:'logist'},plannerAssignments(data),[]);
 const sections=[...win.document.querySelectorAll('.week-block')];
 expect(sections.map(s=>s.querySelector('.day-heading').textContent)).toEqual(['Неделя · 26.10–01.11Показано 29.10–01.11','Неделя · 02.11–08.11Показано 02.11–02.11']);
 expect([...win.document.querySelectorAll('.pw-plan')].map(b=>b.dataset.part)).toEqual(['p1','p2']);
 expect(sections[0].querySelector('.pw-plan').textContent).toContain('чт, 29.10 · 09:00–10:00');
 expect(sections[1].querySelector('.pw-plan').textContent).toContain('пн, 02.11 · 09:00–10:00');
 expect([...win.document.querySelectorAll('[data-pw=workday-edit]')].map(b=>b.dataset.date)).toEqual(['2026-10-31','2026-11-01']);
});
