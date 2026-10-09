import {mountEntityActions} from './entity-actions.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CONFIG={job:{comments:'job_comments',owner:'job_id',history:'job_history'},order:{comments:'service_order_comments',owner:'order_id',history:'service_order_history'},trip:{comments:'trip_comments',owner:'trip_id',history:'trip_revision_history'}};
const time=v=>v?new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'—';
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.slice(8)+'.'+v.slice(5,7)+'.'+v.slice(0,4):'—';
const actor=(id,people)=>id?(people.find(p=>p.id===id)?.full_name||'Сотрудник'):'Система';
const drafts=new Map(),mounted=new WeakMap(),labels={comment:'Комментарий',result:'Результат',event:'История',decision:'Решение',photo:'Фото'};
const read=async q=>{const r=await q;if(r.error)throw r.error;return r.data||[];};
export async function loadEntityActivityRows(db,entity,id){
 const c=CONFIG[entity];if(!c)throw new Error('Неизвестный тип карточки');
 const query=()=>db.from(c.comments).select('id,author_id,created_at,body,pinned_at,pinned_by').eq(c.owner,id),pinned=query();
 const [comments,pins,history,legacy,transfers,interventions,results,photos,decisions]=await Promise.all([
  read(query().order('created_at',{ascending:false}).limit(100)),
  typeof pinned.not==='function'?read(pinned.not('pinned_at','is',null).order('pinned_at',{ascending:false}).limit(100)):[],
  read(db.from(c.history).select(entity==='job'?'id,actor_id,recorded_at,event,changed_fields':entity==='trip'?'id,actor_id,recorded_at,reason,revision,snapshot':'id,actor_id,recorded_at,reason').eq(c.owner,id).order('recorded_at',{ascending:false}).limit(100)),
  entity==='trip'?read(db.from('trip_legacy_task_events').select('source_history_id,actor_id,recorded_at,reason').eq('trip_id',id).order('recorded_at',{ascending:false}).limit(100)):[],
  read(db.from('entity_responsibility_events').select('id,actor_id,reason,owner_id,curator_id,previous_owner_id,previous_curator_id,created_at').eq('entity_kind',entity).eq('entity_id',id).order('created_at',{ascending:false}).limit(100)),
  entity==='order'?[]:read(db.from('entity_status_interventions').select('id,actor_id,reason,previous_status,next_status,created_at').eq('entity_kind',entity).eq('entity_id',id).order('created_at',{ascending:false}).limit(100)),
  typeof db.rpc==='function'?read(db.rpc('entity_activity_results',{p_kind:entity,p_id:id})):[],
  entity==='job'?read(db.from('job_photos').select('id,kind,created_by,created_at').eq('job_id',id).order('created_at',{ascending:false}).limit(100)):[],
  entity==='job'?read(db.from('job_change_requests').select('id,created_by,created_at,what,status').eq('job_id',id).order('created_at',{ascending:false}).limit(100)):[]
 ]);
 const map=new Map(),add=(r,type,source)=>map.set(source+':'+(r.id??r.source_history_id),{...r,type,source,key:source+':'+(r.id??r.source_history_id),actor_id:r.actor_id||r.author_id||r.created_by,at:r.created_at||r.recorded_at});
 [...comments,...pins].forEach(r=>add(r,'comment',c.comments));history.forEach(r=>add(r,'event',c.history));legacy.forEach(r=>add({...r,label:'Архив задания по выезду · '+r.reason},'event','trip_legacy_task_events'));
 transfers.forEach(r=>add({...r,label:'Передача ответственности · '+r.reason},'event','entity_responsibility_events'));
 interventions.forEach(r=>add({...r,label:`Стадия: ${r.previous_status} → ${r.next_status} · ${r.reason}`},'event','entity_status_interventions'));
 (Array.isArray(results)?results:[]).forEach(r=>add(r,'result','service_order_result_events'));
 decisions.forEach(r=>add({...r,label:({open:'Ожидает согласования',accepted:'Принято',rejected:'Отклонено'}[r.status]||r.status)+' · '+r.what},'decision','job_change_requests'));
 photos.forEach(r=>add({...r,label:'Фото · '+({before:'До работ',after:'После работ',defect:'Дефект',signature:'Подпись заказчика'}[r.kind]||r.kind)},'photo','job_photos'));
 return [...map.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.key.localeCompare(a.key));
}
function renderEntry(row,people,{canPin=false}={}){
 const type=row.type||'event',pin=type==='comment'&&canPin?`<button type="button" class="activity-pin btn ghost" data-pin="${esc(row.id)}" aria-pressed="${!!row.pinned_at}" aria-label="Действия с комментарием" title="${row.pinned_at?'Комментарий закреплён':'Действия с комментарием'}">⋯</button>`:'';
 let body='';
 if(type==='comment')body=`<p class="activity-body">${esc(row.body).replaceAll('\n','<br>')}</p>`;
 else if(type==='result'){
  const s=row.snapshot||{},items=s.items||[];
  body=`<h4>${esc(s.title||'Выполнение задания')}</h4><p class="hint">Выполнено ${esc(date(row.actual_date))}${s.number?' · задание №'+esc(s.number):''}</p><div class="activity-result-lines">${items.map(i=>`<div><span>${esc(i.title)}</span><b>${esc(i.done_qty??0)} / ${esc(i.planned_qty??0)} ${esc(i.unit)}</b>${i.result_note?'<p>'+esc(i.result_note)+'</p>':''}</div>`).join('')}</div>${s.note?'<p class="activity-body">'+esc(s.note).replaceAll('\n','<br>')+'</p>':''}${s.basis?'<details><summary>Основание исторического факта</summary><p>'+esc(s.basis)+'</p></details>':''}`;
 }else{
  body=`<p class="activity-body">${esc(row.label||row.event||row.reason||`Изменение плана · версия ${row.revision??'—'}`)}</p>`;
  if(type==='photo')body+=`<button class="btn ghost" type="button" data-photo="${esc(row.id)}">Открыть фото</button>`;
  if(row.snapshot&&type==='event'){const s=row.snapshot;body+=`<details><summary>Данные до изменения</summary><p>Период: ${esc(date(s.date_from))}${s.date_to?' — '+esc(date(s.date_to)):''}</p><p>Объектов: ${esc(s.job_ids?.length??0)} · точек маршрута: ${esc(s.route_stops?.length??0)}</p></details>`;}
 }
 return `<article class="activity-entry is-${type}" data-activity-key="${esc(row.key)}"><header><div class="activity-meta"><span class="activity-type">${labels[type]||'История'}</span><span>${esc(actor(row.actor_id,people))}</span><time datetime="${esc(row.at)}">${esc(time(row.at))}</time></div>${pin}</header>${body}</article>`;
}
export async function loadEntityActivity(db,entity,id,people=[]){const rows=await loadEntityActivityRows(db,entity,id);return rows.map(r=>renderEntry(r,people)).join('')||'<p class="activity-empty">Пока нет записей.</p>';}
export function mountEntityActivity({root,db,entity,id,userId,people=()=>[],canPin=()=>false,onRecordResult,onOpenPhoto,onError=()=>{}}){
 if(!root||!id)return;mounted.get(root)?.destroy();const loadedUser=userId(),key='activity-draft:'+loadedUser+':'+entity+':'+id;let alive=true,filter='all',rows=[];root.dataset.entityId=id;
 root.innerHTML=`<div class="activity-controls"><div class="activity-filters" aria-label="Фильтр ленты">${[['all','Все'],['comment','Комментарии'],['result','Результаты'],['event','История'],['decision','Согласования'],...(entity==='job'?[['photo','Фото']]:[])].map(([k,label])=>`<button type="button" class="btn ghost" data-activity-filter="${k}" aria-pressed="${k==='all'}">${label}</button>`).join('')}</div>${onRecordResult?'<button type="button" class="btn" data-activity-result>Зафиксировать результат</button>':''}</div><details class="activity-pins" hidden><summary></summary><div></div></details><form class="entity-activity-form activity-composer"><label>Комментарий<textarea name="body" maxlength="4000" rows="2" required placeholder="Добавить комментарий"></textarea></label><div class="activity-composer-actions"><button class="btn" type="submit">Отправить</button><span class="hint" role="status"></span></div></form><div class="entity-activity-feed" aria-live="polite"><p class="hint">Загружаю ленту…</p></div>`;
 const form=root.querySelector('form'),input=form.elements.body,status=form.querySelector('[role=status]'),feed=root.querySelector('.entity-activity-feed'),pins=root.querySelector('.activity-pins');
 try{input.value=drafts.get(key)||window.sessionStorage.getItem(key)||'';}catch{input.value=drafts.get(key)||'';}
 const remember=()=>{drafts.set(key,input.value);try{if(input.value)window.sessionStorage.setItem(key,input.value);else window.sessionStorage.removeItem(key);}catch{/* memory draft still survives remount */}};input.addEventListener('input',remember);
 const paint=()=>{
  if(!alive)return;const pinned=rows.filter(r=>r.type==='comment'&&r.pinned_at);pins.hidden=!pinned.length;pins.querySelector('summary').textContent='Закреплено · '+pinned.length;pins.querySelector('div').innerHTML=pinned.map(r=>renderEntry(r,people(),{canPin:canPin()})).join('');
  const visible=rows.filter(r=>(filter==='all'||r.type===filter)&&(!r.pinned_at||!pins.open));feed.innerHTML=visible.map(r=>renderEntry(r,people(),{canPin:canPin()})).join('')||'<p class="activity-empty">В этом разделе пока нет записей.</p>';
 };
 const refresh=async()=>{try{const loaded=await loadEntityActivityRows(db,entity,id);if(alive){rows=loaded;paint();}}catch(e){if(alive){feed.innerHTML=`<p class="err">Лента недоступна: ${esc(e.message)}</p><button type="button" class="btn" data-activity-retry>Повторить</button>`;onError(e);}}};pins.addEventListener('toggle',paint);
 root.addEventListener('click',e=>{
  if(!alive)return;const target=e.target.closest('button');if(!target)return;
  if(target.dataset.activityFilter){filter=target.dataset.activityFilter;root.querySelectorAll('[data-activity-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===target)));paint();}
  if(target.hasAttribute('data-activity-result'))onRecordResult?.();if(target.hasAttribute('data-activity-retry'))refresh();if(target.dataset.photo)onOpenPhoto?.(target.dataset.photo);
  if(target.dataset.pin){if(target.dataset.pinMenuMounted)return;target.dataset.pinMenuMounted='true';const row=rows.find(r=>r.id===target.dataset.pin&&r.type==='comment');mountEntityActions({trigger:target,items:[{label:row.pinned_at?'Открепить комментарий':'Закрепить комментарий',onSelect:async()=>{target.disabled=true;try{if(userId()!==loadedUser)throw new Error('Аккаунт изменился. Открой страницу заново.');const {error}=await db.rpc('entity_activity_pin',{p_kind:entity,p_id:id,p_comment:row.id,p_pinned:!row.pinned_at});if(error)throw error;await refresh();}catch(err){status.textContent=err.message;onError(err);}finally{if(target.isConnected)target.disabled=false;}}}]});target.onclick();}
 });
 form.onsubmit=async e=>{e.preventDefault();const body=input.value.trim();if(!body)return;if(userId()!==loadedUser){status.textContent='Аккаунт изменился. Открой страницу заново.';return;}const button=form.querySelector('button');button.disabled=true;status.textContent='Отправляю…';try{const c=CONFIG[entity],{error}=await db.from(c.comments).insert({[c.owner]:id,body,author_id:userId()});if(error)throw error;if(!alive)return;input.value='';remember();status.textContent='Комментарий добавлен.';await refresh();}catch(err){if(alive){status.textContent=err.message||'Не удалось отправить';onError(err);}}finally{if(alive)button.disabled=false;}};
 const controller={refresh,destroy:()=>{remember();alive=false;}};mounted.set(root,controller);refresh();return controller;
}
