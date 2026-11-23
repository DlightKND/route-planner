import {setButtonBusy} from './ui/button-state.js';
import {mountEntityActions} from './entity-actions.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CONFIG={gpsTrip:{comments:'gps_record_comments',owner:'trip_id'},gpsTrack:{comments:'gps_record_comments',owner:'track_id'},job:{comments:'job_comments',owner:'job_id',history:'job_history'},order:{comments:'service_order_comments',owner:'order_id',history:'service_order_history'},trip:{comments:'trip_comments',owner:'trip_id',history:'trip_revision_history'}};
const time=v=>v?new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'—';
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.slice(8)+'.'+v.slice(5,7)+'.'+v.slice(0,4):'—';
const actor=(id,people)=>id?(people.find(p=>p.id===id)?.full_name||'Сотрудник'):'Система';
const drafts=new Map(),fileDrafts=new Map(),mounted=new WeakMap(),labels={comment:'Комментарий',result:'Результат',event:'Событие',decision:'Решение',photo:'Фото'};
const read=async q=>{const r=await q;if(r.error)throw r.error;return r.data||[];};
// Comment attachments (migration 20261123184724): one bucket, path <kind>/<comment id>/<file id>-<name>.
const FILE_KIND={job:'job',order:'order',trip:'trip',gpsTrip:'gps',gpsTrack:'gps'},FILE_BUCKET='comment-files',FILE_LIMIT=20*1024*1024,FILE_COUNT=10;
const fileSize=n=>n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ';
// Storage keys stay ASCII; the original name is kept in comment_attachments.
const fileExtension=name=>(String(name||'').match(/\.[A-Za-z0-9]{1,10}$/)||[''])[0].toLowerCase();
async function attachFiles(db,entity,rows){
 const kind=FILE_KIND[entity],ids=rows.filter(r=>r.type==='comment').map(r=>r.id);if(!kind||!ids.length)return rows;
 try{const {data,error}=await db.from('comment_attachments').select('id,comment_id,path,name,size').eq('comment_kind',kind).in('comment_id',ids);if(error)return rows;
  const byComment=new Map();for(const file of data||[]){if(!byComment.has(file.comment_id))byComment.set(file.comment_id,[]);byComment.get(file.comment_id).push(file);}
  return rows.map(r=>r.type==='comment'&&byComment.has(r.id)?{...r,files:byComment.get(r.id)}:r);
 }catch{return rows;}
}
export async function loadEntityActivityRows(db,entity,id){
 const c=CONFIG[entity];if(!c)throw new Error('Неизвестный тип карточки');
 if(entity==='gpsTrip'||entity==='gpsTrack'){
  const comments=await read(db.from(c.comments).select('id,author_id,created_at,body').eq(c.owner,id).order('created_at',{ascending:false}).limit(100));
  return attachFiles(db,entity,comments.map(row=>({...row,type:'comment',key:'gps:'+row.id,actor_id:row.author_id,at:row.created_at})));
 }
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
 return attachFiles(db,entity,[...map.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.key.localeCompare(a.key)));
}
const ICONS={comment:'<path d="M4 4h16v12H9l-5 4V4Z"/>',event:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',result:'<path d="m5 12 4 4L19 6"/>',photo:'<path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/>',decision:'<path d="m5 12 4 4L19 6"/>'};
const activityIcon=type=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type]||ICONS.event}</svg>`;
export const activityCountLabel=n=>n?n+' '+(n%10===1&&n%100!==11?'запись':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'записи':'записей'):'';
function renderEntry(row,people,{canPin=false,onOpenResult}={}){
 const type=row.type||'event',pin=type==='comment'&&canPin?`<button type="button" class="activity-pin btn ghost" data-pin="${esc(row.id)}" aria-pressed="${!!row.pinned_at}" aria-label="Действия с комментарием" title="${row.pinned_at?'Комментарий закреплён':'Действия с комментарием'}">⋯</button>`:'';
 let body='';
 if(type==='comment')body=`<p class="activity-body">${esc(row.body).replaceAll('\n','<br>')}</p>${row.files?.length?`<ul class="activity-files">${row.files.map(f=>`<li><a href="#" data-attachment-path="${esc(f.path)}">${esc(f.name)}</a> <span class="hint">${esc(fileSize(Number(f.size)||0))}</span></li>`).join('')}</ul>`:''}`;
 else if(type==='result'){
  const s=row.snapshot||{},items=s.items||[];
  body=`<p class="activity-body activity-result-subject">Результат сохранён · ${esc(s.title||'Выполнение задания')}</p><p class="hint">Выполнено ${esc(date(row.actual_date))}${s.number?' · задание №'+esc(s.number):''}${s.trip_id?' · '+esc(s.trip_label||'По выезду'):''}</p>${items.length?`<div class="activity-result-lines">${items.map(i=>`<div><span>${esc(i.title)}</span><b>${esc(i.done_qty??0)} / ${esc(i.planned_qty??0)} ${esc(i.unit)}</b>${i.result_note?'<p>'+esc(i.result_note)+'</p>':''}</div>`).join('')}</div>`:''}${s.note?'<p class="activity-body">'+esc(s.note).replaceAll('\n','<br>')+'</p>':''}${s.basis?'<details><summary>Основание исторического факта</summary><p>'+esc(s.basis)+'</p></details>':''}`;
 }else{
  body=`<p class="activity-body">${esc(row.label||row.event||row.reason||`Изменение плана · версия ${row.revision??'—'}`)}</p>`;
  if(type==='photo')body+=`<button class="btn ghost sm" type="button" data-photo="${esc(row.id)}">Открыть фото</button>`;
  if(row.snapshot&&type==='event'){const s=row.snapshot;body+=`<details><summary>Данные до изменения</summary><p>Период: ${esc(date(s.date_from))}${s.date_to?' — '+esc(date(s.date_to)):''}</p><p>Объектов: ${esc(s.job_ids?.length??0)} · точек маршрута: ${esc(s.route_stops?.length??0)}</p></details>`;}
 }
 const kind=type==='comment'?'':`<span class="hint activity-type">${labels[type]||'Событие'}</span>`;
 return `<article class="activity-entry activity-item is-${type}" data-activity-key="${esc(row.key)}"><span class="activity-icon">${activityIcon(type)}</span><div class="activity-entry-body"><div class="activity-meta"><strong class="activity-author">${esc(actor(row.actor_id,people))}</strong><time datetime="${esc(row.at)}">${esc(time(row.at))}</time>${kind}${pin}</div>${body}${type==='result'&&onOpenResult?'<button type="button" class="btn ghost sm" data-activity-open-result>Открыть результат →</button>':''}</div></article>`;
}
function renderTimeline(rows,people,options){return rows.map(row=>renderEntry(row,people,options)).join('');}
export async function loadEntityActivity(db,entity,id,people=[]){const rows=await loadEntityActivityRows(db,entity,id);return rows.map(r=>renderEntry(r,people)).join('')||'<p class="activity-empty">Пока нет записей.</p>';}
export function mountEntityActivity({root,db,entity,id,userId,people=()=>[],canPin=()=>false,onRecordResult,onOpenResult,onOpenPhoto,onError=()=>{}}){
 if(!root||!id)return;mounted.get(root)?.destroy();const loadedUser=userId(),key='activity-draft:'+loadedUser+':'+entity+':'+id;let alive=true,rows=[];root.dataset.entityId=id;root.dataset.entityKind=entity;
 root.innerHTML=`<div class="section-top activity-section-top"><h2>Комментарии и события</h2><span class="hint" data-activity-total></span></div><form class="entity-activity-form activity-composer comment-form"><div class="comment-input"><textarea name="body" maxlength="4000" rows="2" placeholder="Написать комментарий" aria-label="Написать комментарий"></textarea></div><div class="comment-actions activity-composer-actions">${FILE_KIND[entity]&&db.storage?'<span class="btn comment-attach" title="Прикрепить файлы"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/></svg><span class="sr-only">Прикрепить файлы</span><input type="file" multiple data-comment-files aria-label="Прикрепить файлы"></span>':''}<button class="btn" type="submit" disabled>Отправить</button></div><ul class="comment-file-names" data-comment-file-names></ul><p class="hint comment-status" role="status"></p></form><details class="activity-pins" hidden><summary></summary><div></div></details><div class="entity-activity-feed" aria-live="polite"><p class="hint">Загружаю ленту…</p></div><button type="button" class="btn ghost activity-more" data-activity-more hidden></button>`;
 const form=root.querySelector('form'),input=form.elements.body,status=form.querySelector('[role=status]'),feed=root.querySelector('.entity-activity-feed'),pins=root.querySelector('.activity-pins');
 try{input.value=drafts.get(key)||window.sessionStorage.getItem(key)||'';}catch{input.value=drafts.get(key)||'';}
 const submit=form.querySelector('[type=submit]'),more=root.querySelector('[data-activity-more]'),total=root.querySelector('[data-activity-total]');let limit=5;const picker=form.querySelector('[data-comment-files]'),names=form.querySelector('[data-comment-file-names]');let files=fileDrafts.get(key)||[];
 const syncSubmit=()=>{submit.disabled=!input.value.trim()&&!files.length;};
 const paintFiles=()=>{fileDrafts.set(key,files);names.innerHTML=files.map((f,i)=>`<li><span>${esc(f.name)}</span> <span class="hint">${esc(fileSize(f.size))}</span><button type="button" class="btn ghost sm" data-comment-file-remove="${i}" aria-label="Убрать файл ${esc(f.name)}">×</button></li>`).join('');syncSubmit();};
 if(picker)picker.onchange=()=>{const chosen=[...picker.files||[]],tooBig=chosen.filter(f=>f.size>FILE_LIMIT);files=[...files,...chosen.filter(f=>f.size<=FILE_LIMIT)].slice(0,FILE_COUNT);picker.value='';const overflow=files.length>=FILE_COUNT&&chosen.length>0;status.textContent=tooBig.length?'Файл больше 20 МБ не прикреплён: '+tooBig.map(f=>f.name).join(', '):overflow?'К комментарию можно прикрепить до '+FILE_COUNT+' файлов.':'';paintFiles();};
 names.addEventListener('click',e=>{const b=e.target.closest('[data-comment-file-remove]');if(!b)return;files=files.filter((_,i)=>i!==Number(b.dataset.commentFileRemove));paintFiles();});
 paintFiles();
 const remember=()=>{drafts.set(key,input.value);try{if(input.value)window.sessionStorage.setItem(key,input.value);else window.sessionStorage.removeItem(key);}catch{/* memory draft still survives remount */}};input.addEventListener('input',()=>{remember();syncSubmit();});syncSubmit();input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();form.requestSubmit?.();}});
 const paint=()=>{
  if(!alive)return;const pinned=rows.filter(r=>r.type==='comment'&&r.pinned_at);pins.hidden=!pinned.length;pins.querySelector('summary').textContent='Закреплено · '+pinned.length;pins.querySelector('div').innerHTML=pinned.map(r=>renderEntry(r,people(),{canPin:canPin()})).join('');
  total.textContent=activityCountLabel(rows.length);
  const visible=rows.filter(r=>!r.pinned_at||!pins.open);feed.innerHTML=renderTimeline(visible.slice(0,limit),people(),{canPin:canPin(),onOpenResult})||'<p class="activity-empty">Пока нет комментариев и событий.</p>';
  more.hidden=visible.length<=limit;more.textContent='Показать ещё · '+Math.max(0,visible.length-limit);
 };
 const refresh=async()=>{try{const loaded=await loadEntityActivityRows(db,entity,id);if(alive){rows=loaded;paint();}}catch(e){if(alive){feed.innerHTML=`<p class="err">Лента недоступна: ${esc(e.message)}</p><button type="button" class="btn" data-activity-retry>Повторить</button>`;onError(e);}}};pins.addEventListener('toggle',paint);
 root.addEventListener('click',async e=>{
  const fileLink=e.target.closest('[data-attachment-path]');
  if(fileLink){e.preventDefault();try{const {data,error}=await db.storage.from(FILE_BUCKET).createSignedUrl(fileLink.dataset.attachmentPath,300);if(error)throw error;root.ownerDocument.defaultView.open(data.signedUrl,'_blank','noopener');}catch(err){status.textContent='Файл недоступен: '+(err.message||err);onError(err);}return;}
 });
 root.addEventListener('click',e=>{
  if(!alive)return;const target=e.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-activity-more')){limit+=20;paint();return;}
  if(target.hasAttribute('data-activity-result'))onRecordResult?.();if(target.hasAttribute('data-activity-retry'))refresh();if(target.dataset.photo)onOpenPhoto?.(target.dataset.photo);
  if(target.hasAttribute('data-activity-open-result'))onOpenResult?.(rows.find(row=>row.key===target.closest('[data-activity-key]')?.dataset.activityKey));
  if(target.dataset.pin){if(target.dataset.pinMenuMounted)return;target.dataset.pinMenuMounted='true';const row=rows.find(r=>r.id===target.dataset.pin&&r.type==='comment');mountEntityActions({trigger:target,items:[{label:row.pinned_at?'Открепить комментарий':'Закрепить комментарий',onSelect:async()=>{target.disabled=true;try{if(userId()!==loadedUser)throw new Error('Аккаунт изменился. Открой страницу заново.');const {error}=await db.rpc('entity_activity_pin',{p_kind:entity,p_id:id,p_comment:row.id,p_pinned:!row.pinned_at});if(error)throw error;await refresh();}catch(err){status.textContent=err.message;onError(err);}finally{if(target.isConnected)target.disabled=false;}}}]});target.onclick();}
 });
 form.onsubmit=async e=>{e.preventDefault();const text=input.value.trim();if(!text&&!files.length)return;if(userId()!==loadedUser){status.textContent='Аккаунт изменился. Открой страницу заново.';return;}
  const body=text||('Вложения: '+files.map(f=>f.name).join(', ')).slice(0,4000),sending=[...files];
  submit.disabled=true;input.disabled=true;setButtonBusy(submit,true);status.textContent='Отправляю…';
  try{
   const c=CONFIG[entity],insert=db.from(c.comments).insert({[c.owner]:id,body,author_id:userId()}),response=sending.length&&typeof insert.select==='function'?await insert.select('id').single():await insert;
   if(response.error)throw response.error;if(!alive)return;
   input.value='';remember();files=[];paintFiles();
   const commentId=response.data?.id,failed=[];
   if(sending.length&&commentId&&db.storage){
    for(const file of sending){
     try{
      const path=`${FILE_KIND[entity]}/${commentId}/${crypto.randomUUID()}${fileExtension(file.name)}`;
      const up=await db.storage.from(FILE_BUCKET).upload(path,file,{contentType:file.type||undefined,upsert:false});if(up.error)throw up.error;
      const row=await db.from('comment_attachments').insert({comment_kind:FILE_KIND[entity],comment_id:commentId,path,name:file.name.slice(0,255),size:file.size,mime:file.type||null});if(row.error)throw row.error;
     }catch(err){failed.push(file.name);onError(err);}
    }
   }
   status.textContent=failed.length?'Комментарий добавлен, но не загружены файлы: '+failed.join(', ')+'.':'Комментарий добавлен.';
   await refresh();
  }catch(err){if(alive){status.textContent=err.message||'Не удалось отправить';onError(err);}}
  finally{setButtonBusy(submit,false);if(alive){input.disabled=false;syncSubmit();}}
 };
 const controller={refresh,destroy:()=>{remember();alive=false;}};mounted.set(root,controller);refresh();return controller;
}
