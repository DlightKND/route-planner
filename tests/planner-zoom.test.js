import {it,expect,afterEach} from 'vitest';
import {Window} from 'happy-dom';
import {normalizePlannerData,plannerAssignments} from '../src/core/planner-workspace.js';
import {plannerTimelineHTML,plannerHitClusters} from '../src/planner-view.js';
import {resizePlannerTimeline,invalidatePlannerZoom} from '../src/planner-zoom.js';
let win;
afterEach(async()=>win?.happyDOM.close());
const manager={id:'m',role:'logist'},engineer={id:'a',role:'engineer'};
const round=v=>Math.round(parseFloat(v)*1e3)/1e3;
function geometry(root){return [...root.querySelectorAll('.pw-day')].map(day=>({date:day.dataset.date,px:round(day.dataset.scale),height:round(day.querySelector('.pw-day-body').style.height),grid:round(day.querySelector('.pw-day-body').style.getPropertyValue('--pw-grid-offset')),items:[...day.querySelectorAll('.pw-plan,.pw-fact-mark,.pw-zone,.calendar-boundary,.pw-tick,.pw-plan-hit,.pw-fact-hit')].map(node=>({key:node.dataset.part||node.dataset.fact||node.dataset.boundary||node.dataset.hour||node.getAttribute('aria-label')||node.className,top:round(node.style.top),height:node.style.height?round(node.style.height):null,class:node.className,ids:node.dataset.facts||node.dataset.rows||null})).sort((a,b)=>String(a.key).localeCompare(String(b.key)))}));}
function fixture(){const date='2026-10-23',data=normalizePlannerData({trips:[{id:'t'}],profiles:[{id:'a'},{id:'b'}],groups:[{source_key:'road:t',kind:'road',trip_id:'t',people:['a','b'],parts:[{id:'r',date,start:7.5,end:7.75,offset:0},{id:'r2',date,start:7.75,end:9,offset:.25},{id:'weekend',date:'2026-10-25',start:11,end:12,offset:1.5}]}],settings:{dayStart:7.5,dayEnd:16,toleranceH:1,weekend:[0,6],staffDay:{'b|2026-10-25':{start_h:10,end_h:14,tol_h:.5}}}}),facts=Array.from({length:200},(_,i)=>({id:'gps'+i,source_id:'gps'+i,date,start:8+i/120,end:8+(i+1)/120,people:['a','b'],kind:'road',source:'gps'}));facts.push({id:'stop',stay_id:'stop',source_id:'stop',date,start:10,end:12,people:['a'],kind:'stop',source:'estimated'});return {data,facts};}
it.each([[manager,false],[manager,true],[engineer,true]])('matches a fresh render after repeated zooms for %j, touch %s',(actor,mobile)=>{
 win=new Window();const {data,facts}=fixture(),state={from:'2026-10-23',to:'2026-10-26',people:['a','b'],hideOffHours:true,showFact:true,mobile,viewDays:1,calendarHeight:600,zoom:18},rows=plannerAssignments(data),root=win.document.createElement('div'),expected=win.document.createElement('div');win.document.body.append(root,expected);root.innerHTML=plannerTimelineHTML(data,state,actor,rows,facts);const plan=root.querySelector('.pw-plan'),fact=root.querySelector('.pw-fact-mark'),crew=root.firstElementChild;
 for(const zoom of [0,60,22,37,18]){state.zoom=zoom;resizePlannerTimeline(root,state);expected.innerHTML=plannerTimelineHTML(data,state,actor,rows,facts);expect(geometry(root)).toEqual(geometry(expected));expect(root.querySelector('.pw-plan')).toBe(plan);expect(root.querySelector('.pw-fact-mark')).toBe(fact);expect(root.firstElementChild).toBe(crew);}
 // A cancelled working-hours preview replaces zone nodes without replacing the calendar.
 root.querySelector('.calendar-boundary')?.replaceWith(root.querySelector('.calendar-boundary').cloneNode(true));invalidatePlannerZoom(root);state.zoom=0;resizePlannerTimeline(root,state);expected.innerHTML=plannerTimelineHTML(data,state,actor,rows,facts);expect(geometry(root)).toEqual(geometry(expected));
 // Data/filter refresh creates a new tree and invalidates the geometry model automatically.
 state.showFact=false;root.innerHTML=plannerTimelineHTML(data,state,actor,rows,[]);state.zoom=40;resizePlannerTimeline(root,state);expected.innerHTML=plannerTimelineHTML(data,state,actor,rows,[]);expect(geometry(root)).toEqual(geometry(expected));
});
it('clusters expanded hit areas transitively and keeps separate clickable intervals',()=>{
 const rows=[{id:'late',start:3,end:3.01},{id:'wide',start:1,end:2},{id:'tiny',start:1.8,end:1.81},{id:'bridge',start:2.1,end:2.11}];
 const result=plannerHitClusters(rows,{start:0},100,44);expect(result.map(c=>c.rows.map(r=>r.id))).toEqual([['wide','tiny','bridge'],['late']]);expect(result[0].bottom).toBeCloseTo(232.5);
});
