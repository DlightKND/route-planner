import {protectNativeForm} from '../src/modal-shell.js';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {presenceHTML,readPresenceForm} from '../src/trip-workbench.js';
import {validatePresence} from '../src/core/trip-review.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const body=app.slice(app.indexOf('async function openPresenceEditor('),app.indexOf('function renderTripReviewSummary('));
const windows=[];afterEach(async()=>{await Promise.all(windows.splice(0).map(w=>w.happyDOM.close()));});
function setup(patch={},saveError=null,authority={manager:true,curator:'e1'}){
 const win=new Window();windows.push(win);
 const stay={id:'s1',job_id:null,crew_ids:['e1'],crew_source:'snapshot',stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',minutes_raw:60,status:'detected',...patch};
 const data={trip:{id:'t1',workbench_revision:7,owner_id:'owner',curator_id:authority.curator,status:authority.status},stays:[stay],job_ids:['j1'],removed:[]};
 const sb={rpc:vi.fn(async(name)=>name==='trip_workbench_read'?{data}:{error:saveError}),from:table=>{const q={select:()=>q,eq:()=>Promise.resolve({data:table==='trip_service_orders'?[{order_id:'o1'}]:[],error:null})};return q;}};
 const tripOrdersAll=[{id:'o1',number:1,title:'Ремонт',job_id:'j1'}];
 const ctx={protectNativeForm,confirmDialog:async()=>false,document:win.document,canWrite:()=>authority.manager,session:{user:{id:'e1'}},getTrip:id=>id===data.trip.id?data.trip:null,tripCache:{},tripPlanDirty:false,tripPresenceDirty:false,ensureRefs:async()=>{},loadTripJobs:async()=>{},loadTripOrders:async()=>{},sb,presenceHTML,readPresenceForm,validatePresence,taskAllocationPayload:s=>({id:s.id,job_id:s.job_id,crew_ids:s.crew_ids,minutes_mgr:s.minutes_mgr,status:s.status,task_allocations:s.status==='approved'?s.task_allocations:[]}),validateTaskAllocationShares:rows=>{if(rows.some(s=>(s.task_allocations||[]).reduce((n,x)=>n+x.share,0)>1.000001))throw new Error('Доля превышает 100%');},profilesList:[{id:'e1',role:'engineer',full_name:'Анна'}],tripJobsAll:[{id:'j1',clients:{name:'Объект'}}],tripOrdersAll,curTripOrders:new Set(['o1']),loadFactHours:vi.fn(async()=>{}),refreshTripEcon:vi.fn(async()=>true),stayBindMap:null,tripEditId:null,showToast:vi.fn(),notify:vi.fn()};
 const open=new Function(...Object.keys(ctx),app.slice(app.indexOf('function canWriteTrip('),app.indexOf('\n',app.indexOf('function canWriteTrip(')))+';return ('+body+');')(...Object.values(ctx));
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

it('opens presence for a scoped curator and rejects another trip without global manager rights',async()=>{
 const curator=setup({},null,{manager:false,curator:'e1'});await curator.open('t1','s1','j1');
 expect(curator.win.document.querySelector('dialog').open).toBe(true);
 const stranger=setup({},null,{manager:false,curator:'other'});await stranger.open('t1','s1','j1');
 expect(stranger.sb.rpc).not.toHaveBeenCalled();expect(stranger.win.document.querySelector('dialog')).toBeNull();
});

it('refreshes confirmed trip economics after the presence RPC and fresh fact hours',async()=>{
 const {win,open,sb,ctx}=setup({},null,{manager:false,curator:'e1',status:'done'});
 await open('t1','s1','j1');await win.document.querySelector('[data-presence-submit]').onclick();
 expect(ctx.refreshTripEcon).toHaveBeenCalledWith('t1');
 expect(sb.rpc.mock.invocationCallOrder[1]).toBeLessThan(ctx.loadFactHours.mock.invocationCallOrder[0]);
 expect(ctx.loadFactHours.mock.invocationCallOrder[0]).toBeLessThan(ctx.refreshTripEcon.mock.invocationCallOrder[0]);
 expect(ctx.notify).not.toHaveBeenCalled();
});


it('renders readonly presence as recorded values and statuses without suggesting approval or editing',()=>{
 const win=new Window();windows.push(win);
 const base={job_id:'j1',crew_ids:['e1','e2'],crew_source:'manager',stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',minutes_raw:60};
 const stays=[{...base,id:'approved',status:'approved',minutes_mgr:30,task_allocations:[{order_id:'o1',share:1}]},{...base,id:'pending',status:'detected',crew_source:'snapshot',minutes_raw:20},{...base,id:'rejected',status:'rejected',minutes_mgr:0}];
 win.document.body.innerHTML=presenceHTML({trip:{id:'t1',fact_km:0},stays,jobIds:['j1'],removed:[]},[{id:'j1',clients:{name:'<Объект>'}}],[{id:'e1',role:'engineer',full_name:'Анна'},{id:'e2',role:'engineer',full_name:'Иван'}],{readonly:true,orders:[{id:'o1',number:7,title:'Работа <насос>',job_id:'j1'}]});
 expect(win.document.querySelectorAll('input,select,textarea,button:not(.qm)')).toHaveLength(0);
 const rows=win.document.querySelectorAll('tbody tr');
 expect(rows[0].querySelector('[data-label="Команда"]').textContent).toBe('Анна, Иван');
 expect(rows[0].querySelector('[data-label="Минуты на человека"]').textContent).toContain('30');
 expect(rows[0].querySelector('[data-label="Минуты на человека"]').textContent).toContain('1 чел.-ч');
 expect(rows[0].querySelector('[data-label="Проверка"]').textContent).toBe('Проверено · присутствие');
 expect(rows[1].querySelector('[data-label="Проверка"]').textContent).toBe('Ожидает проверки');
 expect(rows[1].querySelector('[data-label="Минуты на человека"]').textContent).toContain('20');
 expect(rows[2].querySelector('[data-label="Проверка"]').textContent).toBe('Не учитывается');
 expect(rows[2].querySelector('[data-label="Минуты на человека"]').textContent).toContain('0');
 expect(rows[0].querySelector('.wb-task-share').textContent).toContain('Работа <насос>');
 expect(rows[0].querySelector('.wb-task-share b').textContent).toBe('100%');
 expect(win.document.querySelector('насос')).toBeNull();
 expect(win.document.querySelector('#wbDetect')).toBeNull();expect(win.document.querySelector('#wbPresenceSave')).toBeNull();
});
it('preserves unknown confirmed minutes and crew instead of turning raw GPS data into accepted hours',()=>{
 const win=new Window();windows.push(win);
 const stays=[{id:'unknown',job_id:null,status:'approved',crew_ids:[],crew_source:'legacy_unverified',minutes_mgr:null,minutes_raw:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z'}];
 win.document.body.innerHTML=presenceHTML({trip:{id:'t1'},stays,jobIds:[],removed:[]},[],[],{readonly:true,editor:true});
 expect(win.document.querySelectorAll('input,select,button')).toHaveLength(0);
 const row=win.document.querySelector('tr[data-presence-id="unknown"]');
 expect(row.querySelector('[data-label="Объект / заявка"]').textContent).toBe('Не привязана');
 expect(row.querySelector('[data-label="Команда"]').textContent).toContain('Состав не подтверждён');
 const minutes=row.querySelector('[data-label="Минуты на человека"]');expect(minutes.firstChild.textContent.trim()).toBe('—');expect(minutes.querySelector('.hint').textContent).toContain('— чел.-ч');expect(minutes.textContent).not.toContain('60');
 expect(row.querySelector('[data-label="Интервал"]').textContent).toContain('GPS: 60 мин');
});
it('keeps the default manager editor and proposed approval available',()=>{
 const win=new Window();windows.push(win);
 const stay={id:'s1',job_id:'j1',status:'detected',crew_ids:['e1'],crew_source:'snapshot',minutes_raw:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z'};
 const data={trip:{id:'t1'},stays:[stay],jobIds:['j1'],removed:[]};
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}],{editor:true});
 expect(win.document.querySelector('[data-presence="status"]').value).toBe('approved');
 expect(win.document.querySelector('[data-presence="minutes_mgr"]').value).toBe('60');
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}]);
 expect(win.document.querySelector('[data-presence-edit]')).not.toBeNull();expect(win.document.querySelector('#wbDetect')).not.toBeNull();expect(win.document.querySelector('#wbPresenceSave')).not.toBeNull();
});

it('keeps an unsaved presence edit when closing is declined and returns focus after discard',async()=>{
 const {win,open,sb,ctx}=setup();const trigger=win.document.createElement('button');win.document.body.append(trigger);trigger.focus();
 const answer=vi.fn(async()=>false);ctx.confirmDialog=answer;
 // Recreate the actual editor entry point with the asynchronous close dependency.
 const run=new Function(...Object.keys(ctx),app.slice(app.indexOf('function canWriteTrip('),app.indexOf('\n',app.indexOf('function canWriteTrip(')))+';return ('+body+');')(...Object.values(ctx));
 await run('t1','s1','j1');const dialog=win.document.querySelector('dialog'),reason=dialog.querySelector('.presence-reason');reason.value='Черновик проверки';
 dialog.dispatchEvent(new win.Event('cancel',{cancelable:true}));await Promise.resolve();await Promise.resolve();
 expect(dialog.open).toBe(true);expect(reason.value).toBe('Черновик проверки');expect(sb.rpc).toHaveBeenCalledTimes(1);
 answer.mockResolvedValue(true);dialog.dispatchEvent(new win.Event('cancel',{cancelable:true}));await Promise.resolve();await Promise.resolve();
 expect(dialog.open).toBe(false);expect(win.document.activeElement).toBe(trigger);expect(sb.rpc).toHaveBeenCalledTimes(1);
});
