import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {presenceHTML,readPresenceForm} from '../src/trip-workbench.js';
import {validatePresence} from '../src/core/trip-review.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const body=app.slice(app.indexOf('async function openPresenceEditor('),app.indexOf('async function loadWorkbench('));
const windows=[];afterEach(async()=>{await Promise.all(windows.splice(0).map(w=>w.happyDOM.close()));});
function setup(patch={},saveError=null){
 const win=new Window();windows.push(win);
 const stay={id:'s1',job_id:null,crew_ids:['e1'],crew_source:'snapshot',stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',minutes_raw:60,status:'detected',...patch};
 const data={trip:{id:'t1',workbench_revision:7},stays:[stay],job_ids:['j1'],removed:[]};
 const sb={rpc:vi.fn(async(name)=>name==='trip_workbench_read'?{data}:{error:saveError}),from:table=>{const q={select:()=>q,eq:()=>Promise.resolve({data:table==='trip_service_orders'?[{order_id:'o1'}]:[],error:null})};return q;}};
 const tripOrdersAll=[{id:'o1',number:1,title:'Ремонт',job_id:'j1'}];
 const ctx={document:win.document,canWrite:()=>true,tripPlanDirty:false,tripPresenceDirty:false,ensureRefs:async()=>{},loadTripJobs:async()=>{},loadTripOrders:async()=>{},sb,presenceHTML,readPresenceForm,validatePresence,taskAllocationPayload:s=>({id:s.id,job_id:s.job_id,crew_ids:s.crew_ids,minutes_mgr:s.minutes_mgr,status:s.status,task_allocations:s.status==='approved'?s.task_allocations:[]}),validateTaskAllocationShares:rows=>{if(rows.some(s=>(s.task_allocations||[]).reduce((n,x)=>n+x.share,0)>1.000001))throw new Error('Доля превышает 100%');},profilesList:[{id:'e1',role:'engineer',full_name:'Анна'}],tripJobsAll:[{id:'j1',clients:{name:'Объект'}}],tripOrdersAll,curTripOrders:new Set(['o1']),loadFactHours:async()=>{},stayBindMap:null,tripEditId:null,showToast:vi.fn(),notify:vi.fn()};
 const open=new Function(...Object.keys(ctx),'return ('+body+');')(...Object.values(ctx));
 return {win,open,sb,ctx};
}
it('saves attachment, crew and approval in one revision-checked RPC',async()=>{
 const {win,open,sb}=setup();await open('t1','s1','j1');const save=win.document.querySelector('[data-presence-submit]');expect(save.textContent).toBe('Привязать и подтвердить');const checkbox=win.document.querySelector('[data-task-allocation-order]');checkbox.checked=true;win.document.querySelector('[data-task-allocation-share]').value='60';await save.onclick();
 expect(sb.rpc).toHaveBeenCalledWith('trip_presence_save_tasks',{p_trip:'t1',p_expected:7,p_stays:[{id:'s1',job_id:'j1',crew_ids:['e1'],minutes_mgr:60,status:'approved',task_allocations:[{order_id:'o1',share:.6}]}],p_reason:'Проверено по треку и составу команды'});
 expect(sb.rpc.mock.calls.map(x=>x[0])).toEqual(['trip_workbench_read','trip_presence_save_tasks']);
});
it('does not guess historical crew or save a partial attachment',async()=>{
 const {win,open,sb}=setup({crew_ids:[],crew_source:'legacy_unverified'});await open('t1','s1','j1');await win.document.querySelector('[data-presence-submit]').onclick();expect(sb.rpc).toHaveBeenCalledTimes(1);expect(win.document.querySelector('.presence-error').textContent).toContain('состав');
});
it('keeps the editor and edits available when a stale revision is rejected',async()=>{
 const {win,open}=setup({},new Error('Выезд изменён. Обнови карточку.'));await open('t1','s1','j1');const save=win.document.querySelector('[data-presence-submit]');await save.onclick();expect(save.disabled).toBe(false);expect(win.document.querySelector('dialog').open).toBe(true);expect(win.document.querySelector('.presence-error').textContent).toContain('Выезд изменён');
});
it('edits explicit task-hour shares only among tasks for the selected request',async()=>{
 const win=new Window();windows.push(win);const stay={id:'s1',job_id:'j1',status:'approved',crew_source:'manager',crew_ids:['e1'],minutes_mgr:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',task_allocations:[{order_id:'o1',share:.65},{order_id:'o2',share:.35}]};
 const data={trip:{id:'t1'},stays:[stay],jobIds:['j1'],removed:[]};const orders=[{id:'o1',number:1,title:'Ремонт',job_id:'j1'},{id:'o2',number:2,title:'Пуск',job_id:'j1'},{id:'o3',number:3,title:'Чужое задание',job_id:'j2'}];
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}],{editor:true,orders});
 const parsed=readPresenceForm(win.document,[stay]);expect(parsed[0].task_allocations).toEqual([{order_id:'o1',share:.65},{order_id:'o2',share:.35}]);expect(win.document.body.textContent).not.toContain('Чужое задание');
});
