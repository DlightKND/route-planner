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
 const sb={rpc:vi.fn(async(name)=>name==='trip_workbench_read'?{data}:{error:saveError})};
 const ctx={document:win.document,canWrite:()=>true,tripPlanDirty:false,tripPresenceDirty:false,ensureRefs:async()=>{},loadTripJobs:async()=>{},sb,presenceHTML,readPresenceForm,validatePresence,profilesList:[{id:'e1',role:'engineer',full_name:'Анна'}],tripJobsAll:[{id:'j1',clients:{name:'Объект'}}],loadFactHours:async()=>{},stayBindMap:null,tripEditId:null,showToast:vi.fn(),notify:vi.fn()};
 const open=new Function(...Object.keys(ctx),'return ('+body+');')(...Object.values(ctx));
 return {win,open,sb,ctx};
}
it('saves attachment, crew and approval in one revision-checked RPC',async()=>{
 const {win,open,sb}=setup();await open('t1','s1','j1');const save=win.document.querySelector('[data-presence-submit]');expect(save.textContent).toBe('Привязать и подтвердить');await save.onclick();
 expect(sb.rpc).toHaveBeenCalledWith('trip_presence_save',{p_trip:'t1',p_expected:7,p_stays:[{id:'s1',job_id:'j1',crew_ids:['e1'],minutes_mgr:60,status:'approved'}],p_reason:'Проверено по треку и составу команды'});
 expect(sb.rpc.mock.calls.map(x=>x[0])).toEqual(['trip_workbench_read','trip_presence_save']);
});
it('does not guess historical crew or save a partial attachment',async()=>{
 const {win,open,sb}=setup({crew_ids:[],crew_source:'legacy_unverified'});await open('t1','s1','j1');await win.document.querySelector('[data-presence-submit]').onclick();expect(sb.rpc).toHaveBeenCalledTimes(1);expect(win.document.querySelector('.presence-error').textContent).toContain('состав');
});
it('keeps the editor and edits available when a stale revision is rejected',async()=>{
 const {win,open}=setup({},new Error('Выезд изменён. Обнови карточку.'));await open('t1','s1','j1');const save=win.document.querySelector('[data-presence-submit]');await save.onclick();expect(save.disabled).toBe(false);expect(win.document.querySelector('dialog').open).toBe(true);expect(win.document.querySelector('.presence-error').textContent).toContain('Выезд изменён');
});
