import {calendarPeriodBounds} from './core/calendar-period.js';
import {gpsSegments,mountGpsTrackMap} from './gps-track-map.js';
import {infoHint} from './info-hints.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value||0).toLocaleString('ru',{maximumFractionDigits:2});
const date=value=>new Date(value).toLocaleString('ru',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const status={recording:'Записывается',review:'На разборе',linked:'Привязана',charged:'Списание инженеру',merged:'В объединённом треке'};
// Decimal arithmetic matches PostgreSQL numeric rounding for the reviewed amount.
export function distanceCost(km,rate){
 const decimal=value=>{const text=String(value),match=text.match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if(!match||!Number.isFinite(Number(value)))throw Error('Некорректный расчёт себестоимости');
  const scale=(match[2]?.length||0)-Number(match[3]||0),digits=BigInt(match[1]+(match[2]||''));
  return scale<0?[digits*10n**BigInt(-scale),0]:[digits,scale];};
 const [a,as]=decimal(km),[b,bs]=decimal(rate),denominator=10n**BigInt(as+bs);
 return Number((a*b*100n+denominator/2n)/denominator)/100;
}
export function trackPreview(points){
 if(!points.length)return '<p class="hint">GPS-точек нет.</p>';
 const valid=points.filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lng));if(!valid.length)return '';
 const {minX,maxX,minY,maxY}=valid.reduce((b,p)=>({minX:Math.min(b.minX,+p.lng),maxX:Math.max(b.maxX,+p.lng),minY:Math.min(b.minY,+p.lat),maxY:Math.max(b.maxY,+p.lat)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
 const cos=Math.max(.01,Math.cos((minY+maxY)/2*Math.PI/180)),span=Math.max((maxX-minX)*cos,(maxY-minY)*320/140,.0001);
 const paths=gpsSegments(points).map(segment=>segment.map(p=>(20+(+p.lng-minX)*cos/span*320).toFixed(2)+','+(160-(+p.lat-minY)/span*320).toFixed(2)));
 return '<svg class="unassigned-preview" viewBox="0 0 360 180" role="img" aria-label="GPS-линия поездки; разрывы связи показаны разрывами линии">'+paths.map(p=>'<polyline points="'+p.join(' ')+'"/>').join('')+'</svg>';
}
export function createUnassignedTracks(ctx){
 let rows=[],mode='pending',offset=0,more=false,owner=null,version=0,selected=[],mergePreview=null;
 const maps=new Set();
 function clearMaps(scope){for(const entry of maps)if(!scope||scope.contains(entry.container)){entry.destroy();maps.delete(entry);}}
 function drawMap(box,points){const entry=mountGpsTrackMap(box.querySelector('svg.unassigned-preview'),points,{leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,color:getComputedStyle(box).getPropertyValue('--accent').trim()||'#25845a'});if(entry)maps.add(entry);}
 const manager=()=>['admin','logist'].includes(ctx.role());
 const host=()=>document.getElementById('unassignedHost');
 const mergeEligible=r=>r&&(r.state==='review'||r.state==='recording'&&new Date(r.last_ts)<=Date.now()-300000);
 function reset(){clearMaps();rows=[];selected=[];mergePreview=null;owner=null;version++;if(host())host().replaceChildren();}
 const vehicle=id=>ctx.vehicles().find(v=>v.id===id);
 const vehicleName=id=>{const v=vehicle(id);return [v?.name||v?.model||'Машина',v?.plate].filter(Boolean).join(' · ');};
 const person=id=>{const p=ctx.people().find(v=>v.id===id);return p?.full_name||p?.name||p?.email||'Инженер';};
 function scaffold(){clearMaps();const box=host();if(!box)return;
  box.innerHTML='<div class="unassigned-toolbar"><h2>Непривязанные поездки '+infoHint('GPS без активного выезда сохраняется на сервере. Привязка и списание выполняются после проверки. Списание: подтверждённый пробег × себестоимость километра машины или отдела. Это запись в журнале; выплатами приложение не управляет.','О непривязанных поездках')+'</h2><button class="btn sm ghost" data-ut-refresh>Обновить</button></div>'
   +(manager()?'<div class="seg unassigned-filter" aria-label="Фильтр поездок"><button data-ut-mode="pending" class="on">На разборе</button><button data-ut-mode="archive">Архив</button><button data-ut-mode="charged">Списания</button></div>':'')
   +'<p class="unassigned-status" role="status"></p><div data-ut-selection></div><div class="unassigned-list"></div><button class="btn ghost" data-ut-more hidden>Загрузить ещё</button>';
  box.querySelectorAll('[data-ut-mode]').forEach(b=>{b.classList.toggle('on',b.dataset.utMode===mode);b.setAttribute('aria-pressed',String(b.dataset.utMode===mode));});
  box.querySelector('[data-ut-refresh]').onclick=()=>load();box.querySelector('[data-ut-more]').onclick=()=>load(true);
  box.querySelectorAll('[data-ut-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.utMode;selected=[];mergePreview=null;box.querySelectorAll('[data-ut-mode]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});load();});
 }
 function paint(){const box=host();if(!box)return;clearMaps(box.querySelector('.unassigned-list'));box.querySelector('.unassigned-list').innerHTML=rows.map(r=>'<article class="card unassigned-card" data-ut-card="'+r.id+'"><div class="unassigned-cardhead"><h3>'+escape(vehicleName(r.vehicle_id))+'</h3><span class="tag">'+escape(status[r.state])+'</span>'+(manager()&&mode==='pending'&&mergeEligible(r)?'<label class="unassigned-select"><input type="checkbox" data-ut-select="'+r.id+'" '+(selected.includes(r.id)?'checked':'')+'> Объединить</label>':'')+'</div><div class="unassigned-period">'+date(r.started_at)+' → '+date(r.ended_at||r.last_ts)+'</div>'
  +(r.review_note?'<div class="unassigned-review">'+escape(r.review_note)+'</div>':'')
  +(r.state==='charged'?'<div class="unassigned-charge"><strong>'+number(r.resolution?.cost)+' '+escape(r.resolution?.currency||'грн')+'</strong><span>'+escape(person(r.engineer_id))+' · '+number(r.resolution?.km)+' км × '+number(r.resolution?.rate)+'</span></div><p>'+escape(r.resolution?.reason)+'</p>':'')
  +'<div class="unassigned-actions">'+(manager()?'<button class="btn sm ghost" data-ut-details="'+r.id+'">Посмотреть трек</button>':'')
  +(r.state==='linked'?'<button class="btn sm" data-ut-trip="'+r.trip_id+'">Открыть выезд</button>':'')
  +(manager()&&['recording','review'].includes(r.state)?(r.state==='recording'&&new Date(r.last_ts)>Date.now()-300000?'<span class="hint">Решение доступно после завершения записи.</span>':'<button class="btn sm amber" data-ut-action="chain" data-ut-id="'+r.id+'">Создать цепочку</button><details><summary>Другие действия</summary><div class="unassigned-secondary"><button class="btn sm ghost" data-ut-action="link" data-ut-id="'+r.id+'">Привязать к выезду</button><button class="btn sm danger" data-ut-action="charge" data-ut-id="'+r.id+'">Списать инженеру</button></div></details>'):'')
  +(manager()&&r.state==='charged'?'<button class="btn sm ghost" data-ut-cancel="'+r.id+'">Отменить списание</button>':'')+'</div><div class="unassigned-detail" hidden></div></article>').join('');
  paintSelection();box.querySelectorAll('[data-ut-select]').forEach(c=>c.onchange=()=>{selected=c.checked?[...selected,c.dataset.utSelect]:selected.filter(id=>id!==c.dataset.utSelect);mergePreview=null;paintSelection();});
  box.querySelector('.unassigned-status').textContent=rows.length?'':manager()?'Поездок в этом разделе пока нет.':'Списаний нет.';
  box.querySelector('[data-ut-more]').hidden=!more;
  box.querySelectorAll('[data-ut-details]').forEach(b=>b.onclick=()=>perform(b,()=>details(b.dataset.utDetails)));
  box.querySelectorAll('[data-ut-trip]').forEach(b=>b.onclick=()=>ctx.openTrip(b.dataset.utTrip));
  box.querySelectorAll('[data-ut-action]').forEach(b=>b.onclick=()=>perform(b,()=>resolve(b.dataset.utId,b.dataset.utAction)));
  box.querySelectorAll('[data-ut-cancel]').forEach(b=>b.onclick=()=>perform(b,()=>cancel(b.dataset.utCancel)));
 }
 async function perform(button,action){button.disabled=true;try{await action();}catch(e){ctx.notify(e.message||'Не удалось выполнить действие','err');}finally{if(button.isConnected){button.disabled=false;button.focus({preventScroll:true});}}}
 async function load(append=false){const uid=ctx.userId(),token=++version;if(!uid)return;
  const box=host();if(!box)return;box.querySelector('.unassigned-status').textContent='Загружаем поездки…';box.querySelector('[data-ut-more]').disabled=true;
  try{let query=ctx.db().from('unassigned_tracks').select('*').order('started_at',{ascending:false});
   if(ctx.period){const bounds=calendarPeriodBounds(ctx.period());query=query.gte('last_ts',bounds.from).lt('started_at',bounds.until);}
   if(!manager()||mode==='charged')query=query.eq('state','charged');else query=query.in('state',mode==='pending'?['recording','review']:['linked','charged','merged']);
   const start=append?offset:0,{data,error}=await query.range(start,start+49);if(error)throw error;if(token!==version||uid!==ctx.userId())return;
   if(!append){selected=[];mergePreview=null;}rows=append?[...rows,...(data||[]).filter(r=>!rows.some(x=>x.id===r.id))]:data||[];offset=start+(data||[]).length;more=(data||[]).length===50;paint();
  }catch(e){if(token===version&&uid===ctx.userId()){if(!append){rows=[];box.querySelector('.unassigned-list').replaceChildren();}box.querySelector('.unassigned-status').textContent='Не удалось загрузить поездки. Нажмите «Обновить»: '+(e.message||'нет связи');}}
  finally{if(token===version&&uid===ctx.userId())box.querySelector('[data-ut-more]').disabled=false;}
 }
 async function rpc(name,args){const {data,error}=await ctx.db().rpc(name,args);if(error)throw error;return data;}
 async function readPoints(id){const points=[];for(let offset=0;;offset+=1000){const chunk=await rpc('unassigned_track_points',{p_track:id,p_offset:offset,p_limit:1000});points.push(...chunk);if(chunk.length<1000)return points;}}
 function selectionError(){const chosen=selected.map(id=>rows.find(r=>r.id===id));if(chosen.length<2)return 'Выберите минимум два завершённых трека.';if(chosen.length>20)return 'За один раз можно объединить до 20 треков.';if(chosen.some(r=>!mergeEligible(r)))return 'Обновите выбор завершённых треков.';if(chosen.some(r=>r.vehicle_id!==chosen[0].vehicle_id))return 'Выберите треки одной машины.';if(chosen.some((r,i)=>i&&new Date(r.started_at)<=new Date(chosen[i-1].ended_at||chosen[i-1].last_ts)))return 'Расположите треки по времени без пересечений.';return '';}
 function paintSelection(){const panel=host()?.querySelector('[data-ut-selection]');if(!panel)return;clearMaps(panel);if(!selected.length){panel.replaceChildren();return;}
  const error=selectionError();panel.innerHTML='<section class="card unassigned-merge"><h3>Объединение треков · '+selected.length+'</h3><p class="hint">Исходные треки сохранятся в архиве. Участки между ними не достраиваются.</p><ol class="unassigned-merge-order">'+selected.map((id,i)=>{const r=rows.find(r=>r.id===id);return '<li><span>'+escape(vehicleName(r?.vehicle_id))+'<small>'+date(r?.started_at)+' → '+date(r?.ended_at||r?.last_ts)+'</small></span><div><button type="button" class="btn sm ghost" data-ut-move="'+i+'" data-step="-1" aria-label="Трек '+(i+1)+': выше" '+(!i?'disabled':'')+'>↑</button><button type="button" class="btn sm ghost" data-ut-move="'+i+'" data-step="1" aria-label="Трек '+(i+1)+': ниже" '+(i===selected.length-1?'disabled':'')+'>↓</button></div></li>';}).join('')+'</ol>'
   +(error?'<p class="hint" role="status">'+escape(error)+'</p>':'')+'<div class="row"><button type="button" class="btn ghost" data-ut-clear>Снять выбор</button><button type="button" class="btn ghost" data-ut-sort>По времени</button><button type="button" class="btn" data-ut-preview '+(error?'disabled':'')+'>Посмотреть результат</button></div>'
   +(mergePreview?'<div class="unassigned-merge-preview">'+trackPreview(mergePreview.points)+'<p>'+number(mergePreview.km)+' км (сумма участков) · '+mergePreview.points.length+' точек · '+selected.length+' участков</p><button type="button" class="btn amber" data-ut-merge>Объединить треки</button></div>':'')+'</section>';
  panel.querySelector('[data-ut-sort]').onclick=()=>{selected.sort((a,b)=>new Date(rows.find(r=>r.id===a).started_at)-new Date(rows.find(r=>r.id===b).started_at));mergePreview=null;paintSelection();};
  panel.querySelector('[data-ut-clear]').onclick=()=>{selected=[];mergePreview=null;paint();};
  panel.querySelectorAll('[data-ut-move]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.utMove),next=i+Number(b.dataset.step);[selected[i],selected[next]]=[selected[next],selected[i]];mergePreview=null;paintSelection();host().querySelector('[data-ut-move="'+next+'"][data-step="'+b.dataset.step+'"]')?.focus();});
  panel.querySelector('[data-ut-preview]').onclick=e=>perform(e.currentTarget,prepareMerge);
  if(mergePreview)drawMap(panel,mergePreview.points);
  const merge=panel.querySelector('[data-ut-merge]');if(merge)merge.onclick=()=>perform(merge,commitMerge);
 }
 async function prepareMerge(){const error=selectionError();if(error)throw Error(error);const keys=[...selected],signature=keys.join(),uid=ctx.userId(),preview={points:[],km:0,expected:{}};
  for(const [i,id] of keys.entries()){const quote=await rpc('unassigned_track_quote',{p_track:id}),points=await readPoints(id);if(points.length!==quote.points)throw Error('GPS изменился. Повторите просмотр.');preview.km+=Number(quote.km);preview.expected[id]={revision:quote.revision,points:quote.points};preview.points.push(...points.map(p=>({...p,part:i+'-'+(p.part??0)})));}
  if(uid!==ctx.userId()||signature!==selected.join())return;mergePreview=preview;paintSelection();host().querySelector('[data-ut-merge]')?.focus();
 }
 async function commitMerge(){if(!mergePreview||selectionError())return;const uid=ctx.userId(),keys=[...selected],signature=keys.join(),preview=mergePreview;
  const values=await ctx.prompt('Объединить '+keys.length+' трека',[{key:'reason',label:'Основание объединения',type:'textarea',required:true}],{okText:'Сохранить общий трек'});if(!values||uid!==ctx.userId()||signature!==selected.join()||mergePreview!==preview)return;
  const result=await rpc('unassigned_track_merge',{p_tracks:keys,p_expected:preview.expected,p_reason:values.reason});if(uid!==ctx.userId())return;await load();ctx.notify('Треки объединены. Проверьте результат перед привязкой.','ok');
  const card=host().querySelector('[data-ut-card="'+result.track_id+'"]');card?.scrollIntoView({block:'nearest'});
 }
 async function details(id){const uid=ctx.userId(),r=rows.find(x=>x.id===id),box=host()?.querySelector('[data-ut-card="'+id+'"] .unassigned-detail');if(!r||!box)return;if(!box.hidden){box.hidden=true;return;}
  const quote=await rpc('unassigned_track_quote',{p_track:id});const points=await readPoints(id);
  if(uid!==ctx.userId()||!box.isConnected)return;
  const {data:events,error}=await ctx.db().from('unassigned_track_events').select('action,reason,created_at').eq('track_id',id).order('id',{ascending:false});if(error)throw error;
  if(uid!==ctx.userId()||!box.isConnected)return;
  clearMaps(box);box.innerHTML=trackPreview(points)+'<div class="unassigned-metrics"><span><b>'+number(quote.km)+'</b> км GPS</span><span><b>'+quote.points+'</b> точек</span><span>Разрывы: '+quote.gaps+' · выбросы: '+quote.rejected+'</span></div><div class="hint">Себестоимость пробега: '+(quote.rate==null?'не настроена':number(quote.km)+' × '+number(quote.rate)+' = '+number(quote.cost)+' '+escape(ctx.currency()))+'</div>'
   +(events||[]).map(e=>'<div class="unassigned-event">'+date(e.created_at)+' · '+escape(e.reason)+'</div>').join('');box.hidden=false;drawMap(box,points);
 }
 async function resolve(id,action){const uid=ctx.userId(),row=rows.find(x=>x.id===id);if(!row)return;const quote=await rpc('unassigned_track_quote',{p_track:id});if(uid!==ctx.userId())return;
  if(row.state==='recording'&&new Date(row.last_ts)>Date.now()-300000)throw Error('Поездка ещё записывается. Разобрать её можно после завершения.');
  const engineers=ctx.people().filter(x=>x.role==='engineer'&&x.active!==false).map(p=>({value:p.id,label:p.full_name||p.name||p.email||'Инженер'}));
  const fields=[];if(action==='chain')fields.push({key:'client',type:'select',label:'Клиент заявки',required:true,options:[{value:'',label:'Выберите клиента'},...ctx.clients().filter(c=>!c.deleted_at).map(c=>({value:c.id,label:c.name}))]},{key:'title',label:'Название задания',required:true});
  if(action==='link'){const {data,error}=await ctx.db().from('trips').select('id,date_from,status,vehicle_id').eq('vehicle_id',row.vehicle_id).is('deleted_at',null).in('status',['planned','assigned']).is('started_at',null).is('finished_at',null).is('fact_km',null);if(error)throw error;fields.push({key:'trip',type:'select',label:'Выезд той же машины',required:true,options:[{value:'',label:'Выберите выезд'},...(data||[]).map(t=>({value:t.id,label:t.date_from+' · '+t.status}))]});}
  else fields.push({key:'engineer',type:'select',label:'Инженер',required:true,options:[{value:'',label:'Выберите инженера'},...engineers]});
  if(action==='charge')fields.push({key:'km',type:'number',min:0,step:.01,label:'Подтверждённый пробег, км',value:quote.km,required:true});fields.push({key:'reason',type:'textarea',label:'Основание решения',required:true});
  if(action==='charge'&&!(quote.rate>0))throw Error('Сначала настройте себестоимость километра машины или отдела.');
  const values=await ctx.prompt(action==='chain'?'Создать заявку, черновик задания и выезд':action==='charge'?'Списание инженеру · '+number(quote.rate)+' '+ctx.currency()+'/км':'Привязать поездку к выезду',fields,{okText:action==='charge'?'Проверить сумму':'Создать привязку'});if(!values||uid!==ctx.userId())return;
  const cost=action==='charge'?distanceCost(values.km,quote.rate):null;
  if(action==='charge'&&!await ctx.confirm('Списать '+number(cost)+' '+ctx.currency()+' инженеру?\n'+number(values.km)+' км × '+number(quote.rate)+' '+ctx.currency()+'/км.\nОснование: '+values.reason,{title:'Подтверждение списания',danger:true,okText:'Списать по себестоимости'}))return;
  if(uid!==ctx.userId())return;
  const result=await rpc('unassigned_track_resolve',{p_track:id,p_expected:quote.revision,p_action:action,p_data:{...values,km:values.km??quote.km,points:quote.points,cost}});
  if(uid!==ctx.userId())return;await load();ctx.notify(action==='charge'?'Списание сохранено в журнале':'Трек привязан к выезду','ok');if(result.trip_id){await ctx.reload();ctx.openTrip(result.trip_id);}
 }
 async function cancel(id){const uid=ctx.userId(),r=rows.find(x=>x.id===id);if(!r)return;const v=await ctx.prompt('Отменить списание',[{key:'reason',label:'Причина отмены',type:'textarea',required:true}],{okText:'Отменить списание'});if(!v||uid!==ctx.userId())return;await rpc('unassigned_track_charge_cancel',{p_track:id,p_expected:r.revision,p_reason:v.reason});if(uid===ctx.userId())await load();}
 async function open(){const uid=ctx.userId();if(owner!==uid){reset();owner=uid;mode=manager()?'pending':'charged';}scaffold();try{await ctx.ensureRefs();if(uid===ctx.userId())return load();}catch(e){if(uid===ctx.userId()&&host())host().querySelector('.unassigned-status').textContent='Не удалось загрузить справочники: '+(e.message||'нет связи');}}
 return {open,reset,refresh:()=>{selected=[];mergePreview=null;paintSelection();host()?.querySelectorAll('[data-ut-select]').forEach(c=>c.checked=false);return load();}};
}
