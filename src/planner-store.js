import {normalizePlannerData,plannerChangeIssue,plannerEditIssue,plannerDate,plannerLocalTime,uniquePeople} from './core/planner-workspace.js';
import {flushQueueItems} from './core/offline-queue.js';

const clone=v=>JSON.parse(JSON.stringify(v));
export const plannerNetworkError=error=>error?.name==='TypeError'||/failed to fetch|network|offline|load failed|связи/i.test(error?.message||'');
export async function readPlannerRows(db,table,columns,{tripIds=null,order='id'}={}){
 if(tripIds?.length===0)return [];
 const batches=tripIds?Array.from({length:Math.ceil(tripIds.length/100)},(_,i)=>tripIds.slice(i*100,i*100+100)):[null],rows=[];
 for(const batch of batches)for(let start=0;;start+=1000){let query=db.from(table).select(columns).order(order);if(batch)query=query.in('trip_id',batch);const {data,error}=await query.range(start,start+999);if(error)throw error;rows.push(...data||[]);if(!data||data.length<1000)break;}
 return rows;
}
function settingsForPlanner(settings,days,trips,groups){
 const staffDay=Object.fromEntries(days.map(d=>[d.engineer+'|'+d.date,d])),output={dayStart:Number(settings.day_start??7),dayEnd:Number(settings.day_end??16),toleranceH:Number(settings.tolerance_h??1),weekend:[0,6],staffDay};
 const open=(people,date)=>{if(![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))return;for(const id of people)if(!staffDay[id+'|'+date])staffDay[id+'|'+date]={start_h:output.dayStart,end_h:output.dayEnd,tol_h:output.toleranceH,synthetic:true};};
 for(const trip of trips.filter(t=>t.status!=='cancelled'&&t.date_from)){let guard=0;for(let date=trip.date_from;date<=(trip.date_to||trip.date_from)&&guard++<400;date=plannerDate(date,1))open(uniquePeople(trip),date);}
 for(const group of groups)if(group.manual)for(const p of group.parts||[])open(group.people,p.date);
 return output;
}
export function createPlannerStore(ctx){
 let data=null,identity=null,pending=[],undo=[],busy=false,version=0,state={status:'idle',offline:false,error:'',savedAt:null};
 const actor=()=>ctx.actor(),db=()=>ctx.db(),storage=()=>ctx.storage?ctx.storage():window.localStorage;
 const key=()=>`dlight:planner:${ctx.project?.()||db().supabaseUrl||'project'}:${actor().id}:${actor().role}`;
 const emit=()=>ctx.onChange?.({...state,pending:clone(pending),busy,canUndo:undo.length>0});
 const persistPending=()=>storage().setItem(key()+':queue',JSON.stringify(pending));
 const cache=()=>storage().setItem(key()+':snapshot',JSON.stringify({data,at:Date.now()}));
 function bindIdentity(){const next=key();if(next===identity)return;identity=next;version++;data=null;undo=[];busy=false;state={status:'idle',offline:false,error:'',savedAt:null};try{pending=JSON.parse(storage().getItem(next+':queue')||'[]');if(!Array.isArray(pending))pending=[];}catch{pending=[];}}
 const assertIdentity=expected=>{if(expected!==identity||expected!==key())throw Error('Учётная запись изменилась. Откройте график заново.');};
 async function rpc(name,args){const {data:result,error}=await db().rpc(name,args);if(error)throw error;return result;}
 function overlayPending(source){const next=clone(source);for(const operation of pending)for(const change of operation.changes){const group=next.groups.find(g=>g.source_key===change.source_key);if(group)Object.assign(group,{parts:clone(change.parts),manual:change.manual,people:clone(change.people),pending:true,pending_error:operation.blocked_error||null});}return next;}
 async function load(period,{silent=false}={}){
  bindIdentity();const ticket=++version,person=actor(),manager=['admin','logist'].includes(person.role);
  if(!silent){state.status='loading';state.error='';emit();}
  try{
   await ctx.ensureRefs?.();
   const itemColumns='id,kind,title,unit,planned_qty,done_qty,transferred_qty,billable,request_finance_void_event_id,finance_voided_at:legacy_snapshot->>request_finance_voided_at'+(manager?',financial_revenue_snapshot,financial_cost_snapshot,unit_price_snapshot,unit_cost_snapshot':'');
   const [orders,requests,trips,days,plan]=await Promise.all([
    readPlannerRows(db(),'service_orders','id,number,title,status,work_mode,date_from,date_to,lead_engineer,engineer_ids,owner_id,curator_id,revision,job_id,seed_request_id,created_by,created_at,result_note,instructions,service_order_items('+itemColumns+')'),
    readPlannerRows(db(),'jobs','id,status,due_date,owner_id,curator_id,clients(name),equipment(model)'),
    readPlannerRows(db(),'trips','id,date_from,date_to,lead_engineer,engineer_ids,owner_id,curator_id,status,vehicle_id,vehicle_label,vehicles(name,plate),started_at,finished_at,fact_km,workbench_revision,day_plan,deleted_at'+(manager?',econ_snapshot,plan_econ_snapshot,tariffs_snapshot':'')),
    readPlannerRows(db(),'staff_day','engineer,date,start_h,end_h,tol_h,proposed_end_h,proposed_by,proposed_at',{order:'date'}),
    rpc('planner_snapshot',{p_from:period.from,p_to:period.to})
   ]);
   const live=trips.filter(t=>!t.deleted_at),tripIds=live.filter(t=>t.date_from<=period.to&&(t.date_to||t.date_from)>=period.from||t.started_at&&plannerLocalTime(t.started_at).date<=period.to&&(!t.finished_at||plannerLocalTime(t.finished_at).date>=period.from)).map(t=>t.id);
   const reads=await Promise.allSettled([
    readPlannerRows(db(),'trip_service_orders','trip_id,order_id,ordinal',{order:'trip_id'}),
    readPlannerRows(db(),'trip_stays','id,trip_id,job_id,service_order_id,stay_from,stay_to,status,minutes_raw,minutes_mgr,crew_ids,crew_source,presence_evidence,recovery_acceptance,accepted_intervals',{tripIds}),
    readPlannerRows(db(),'trip_tracks','trip_id,presence:data->presence,segments:data->segments',{tripIds,order:'trip_id'})
   ]);
   if(reads[0].status==='rejected')throw reads[0].reason;
   const notices=[];if(reads[1].status==='rejected')notices.push('Не удалось загрузить стоянки. Факт присутствия временно недоступен.');if(reads[2].status==='rejected')notices.push('Не удалось загрузить GPS. Измеренная дорога временно недоступна.');
   for(const order of orders)for(const item of order.service_order_items||[])if(item.finance_voided_at)item.legacy_snapshot={request_finance_voided_at:item.finance_voided_at};
   const groups=plan?.groups||[],profiles=clone(ctx.profiles?.()||[]),source=normalizePlannerData({orders,requests,trips:live,groups,orderPlanHours:plan?.order_plan_hours||{},links:reads[0].value,stays:reads[1].status==='fulfilled'?reads[1].value:[],tracks:reads[2].status==='fulfilled'?reads[2].value:[],profiles,settings:settingsForPlanner(ctx.settings?.()||{},days,live,groups),notices,period:{...period}});
   if(ticket!==version||identity!==key())return data;
   data=overlayPending(source);state={status:'ready',offline:false,error:'',savedAt:Date.now()};try{cache();}catch{state.error='Данные загружены. Сохранить копию для работы без связи не удалось.';}emit();return data;
  }catch(error){if(ticket!==version||identity!==key())return data;
   if(plannerNetworkError(error))try{const cached=JSON.parse(storage().getItem(key()+':snapshot')||'null');if(cached?.data?.period?.from===period.from&&cached.data.period.to===period.to){data=overlayPending(normalizePlannerData(cached.data));state={status:'ready',offline:true,error:'',savedAt:cached.at};emit();return data;}}catch{ /* A broken cache never becomes empty successful data. */ }
   state.status='error';state.error=/planner_snapshot|PGRST202/.test(error.message||error.code||'')?'Для нового графика требуется обновление серверной схемы. Данные не изменялись.':error.message||'Не удалось загрузить график';emit();throw error;
  }
 }
 function validate(changes){
  if(!data)throw Error('График ещё не загружен.');
  if(changes.some(g=>data.groups.find(x=>x.source_key===g.source_key)?.source_refresh_required))throw Error('Изменение сохранено. Обновите график перед следующим переносом.');
  if(changes.some(g=>pending.some(op=>op.changes.some(c=>c.source_key===g.source_key))))throw Error('Дождитесь отправки предыдущего изменения этого бруска.');
  const source={...data,groups:data.groups.map(g=>{const change=changes.find(c=>c.source_key===g.source_key);return change?.manual===false?{...g,parts:change.parts,stale:false}:g;})};
  const issue=plannerChangeIssue(changes.map(g=>({...g,stale:g.manual===false?false:g.stale})),source,actor());if(issue)throw Error(issue);
 }
 function command(changes,reason,windows){return {id:crypto.randomUUID(),reason,windows:windows||[],changes:changes.map(g=>{const before=data.groups.find(x=>x.source_key===g.source_key);return {source_key:g.source_key,expected_revision:before.revision,order_revision:before.order_revision,trip_revision:before.trip_revision,people:g.people,parts:g.parts,manual:g.manual!==false};}),before:clone(changes.map(g=>data.groups.find(x=>x.source_key===g.source_key)))};}
 const send=operation=>rpc('planner_apply',{p_operation:operation.id,p_changes:operation.changes,p_reason:operation.reason,p_windows:operation.windows||[]});
 function applyReceipt(operation,receipt){
  for(const row of receipt.layouts||[]){const group=data.groups.find(g=>g.source_key===row.source_key);if(group)Object.assign(group,row,{pending:false,pending_error:null,stale:false,source_refresh_required:true});}
  undo.push({operationId:operation.id,before:operation.before,after:clone(receipt.layouts||[]),windows:receipt.restore_windows||[]});if(undo.length>12)undo.shift();
 }
 async function save(changes,reason,{windows=[]}={}){
  bindIdentity();if(busy)throw Error('Предыдущее изменение ещё сохраняется.');validate(changes);const operation=command(changes,reason,windows),identityAtStart=identity;busy=true;state.status='saving';state.error='';emit();
  try{
   let receipt;try{receipt=await send(operation);}catch(error){assertIdentity(identityAtStart);if(!plannerNetworkError(error))throw error;pending.push(operation);try{persistPending();}catch(storageError){pending.pop();throw Error('Не удалось сохранить изменение на устройстве. Оставьте форму открытой: '+storageError.message);}data=overlayPending(data);state.offline=true;state.status='ready';try{cache();}catch{state.error='Изменение сохранено для отправки. Обновить копию графика на устройстве не удалось.';}return {queued:true};}
   assertIdentity(identityAtStart);
   applyReceipt(operation,receipt);state.status='ready';state.savedAt=Date.now();try{cache();}catch{state.error='Изменение принято сервером. Копия на устройстве не обновилась.';}
   await load(data.period,{silent:true}).catch(()=>{});return {saved:true,receipt};
  }catch(error){if(identityAtStart===identity&&identityAtStart===key()){state.status='ready';state.error=error.message||'Не удалось сохранить изменение';}throw error;}finally{if(identityAtStart===identity&&identityAtStart===key()){busy=false;emit();}}
 }
 async function flush(){
  bindIdentity();if(busy||!pending.length)return;const identityAtStart=identity;busy=true;state.status='saving';emit();
  try{await flushQueueItems([...pending],{send:async operation=>{assertIdentity(identityAtStart);const receipt=await send(operation);assertIdentity(identityAtStart);applyReceipt(operation,receipt);},drop:id=>{assertIdentity(identityAtStart);const before=pending;pending=pending.filter(op=>op.id!==id);try{persistPending();}catch(error){pending=before;throw error;}},block:(operation,error)=>{assertIdentity(identityAtStart);operation.blocked_error=error.message;persistPending();},isNetworkError:plannerNetworkError});assertIdentity(identityAtStart);await load(data?.period||ctx.period(),{silent:true});}
  catch(error){if(identityAtStart===identity&&identityAtStart===key())state.error=error.message||'Не удалось отправить изменения';}finally{if(identityAtStart===identity&&identityAtStart===key()){busy=false;state.status=data?'ready':'error';emit();}}
 }
 async function retry(){if(busy)return;for(const operation of pending)delete operation.blocked_error;persistPending();return flush();}
 async function discardPending(id){if(busy)throw Error('Дождитесь окончания отправки.');const original=pending;pending=pending.filter(op=>op.id!==id);try{persistPending();}catch(error){pending=original;throw error;}await load(data?.period||ctx.period());}
 async function undoLast(reason='Отмена изменения графика'){
  if(!undo.length)throw Error('Нет изменения для отмены.');const last=undo.at(-1),changes=last.before.map(before=>{const current=data.groups.find(g=>g.source_key===before.source_key),after=last.after.find(g=>g.source_key===before.source_key);if(!current||current.revision!==after?.revision)throw Error('После этого изменения график уже обновился. Отмена недоступна.');return {...before,revision:current.revision,order_revision:current.order_revision,trip_revision:current.trip_revision,stale:false};});
  const result=await save(changes,reason,{windows:last.windows});if(result.queued)return result;undo.splice(Math.max(0,undo.length-2),2);emit();return result;
 }
 return {load,save,flush,retry,discardPending,undoLast,get undoGroups(){return clone(undo.at(-1)?.before||[]);},get data(){return data;},get state(){return {...state,busy,pending:clone(pending),canUndo:undo.length>0};},editIssue:group=>group.pending?'Изменение ожидает отправки.':plannerEditIssue(group,data,actor())};
}
