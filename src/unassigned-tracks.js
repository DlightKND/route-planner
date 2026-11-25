import {mountEntityActivity} from './entity-activity.js';
import {frameGpsRecordHead} from './gps-record-head.js';
import {tripLabel} from './workflow-meta.js';
import {journalIcon as icon} from './journal-icons.js';
import {intervalText} from './core/journal-display.js';
import {journalEntries,tripAttention,tripReviewIssues,kmText} from './core/gps-journal.js';
import {calendarPeriodBounds} from './core/calendar-period.js';
import {gpsSegments,mountGpsTrackMap} from './gps-track-map.js';
import {TRACK_STYLE} from './core/track-style.js';
import {timelineHTML,mountJournalRoute,wireJournalTimeline} from './journal-route.js';
import {wireDetailsPopover} from './details-popover.js';
import {infoHint} from './info-hints.js';
import {mountSourceStops,observedSourceStops} from './journal-source-stops.js';
import {mountRoadSections} from './journal-road.js';
import {createSourceRoadAdapter} from './journal-source-road.js';
import {manualDraftFields,manualVisitPartyFields,manualVisitTimeFields,renderManualVisitDrafts} from './journal-manual-drafts.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value||0).toLocaleString('ru',{maximumFractionDigits:2});
const date=value=>!value||!Number.isFinite(Date.parse(value))?'Нет даты':new Date(value).toLocaleString('ru',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const status={recording:'Запись продолжается',review:'На разборе',linked:'Привязана',charged:'Списание инженеру',merged:'В объединённом треке'};
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
 let sourceView=null,pendingTrip=null;let listScroll=0;let activeId=null,choosing=false,search='',vehicleFilter='',gapsOnly=false;const previews=new Map();
 let rows=[],tripRows=[],mode='all',offset=0,more=false,owner=null,version=0,selected=[],mergePreview=null;
 const maps=new Set(),resolutionDrafts=new Map(),peekPoints=new Map();let peekId=null,peekToken=0;let sourceActivity;let headerMenus=[];
 function clearHeaderMenus(){headerMenus.forEach(menu=>menu.destroy());headerMenus=[];}
 function clearMaps(scope){for(const entry of maps)if(!scope||scope.contains(entry.container)){entry.destroy();maps.delete(entry);}}
 function drawMap(box,points,mini=false){const entry=mountGpsTrackMap(box.querySelector('svg.unassigned-preview'),points,{leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,mini,color:getComputedStyle(box).getPropertyValue('--accent').trim()||'#25845a'});if(entry)maps.add(entry);}
 const manager=()=>['admin','logist'].includes(ctx.role());
 const host=()=>document.getElementById('unassignedHost');
 const mergeEligible=r=>r&&!r._trip&&(r.state==='review'||r.state==='recording'&&new Date(r.last_ts)<=Date.now()-300000);
 function reset(){sourceView=null;peekId=null;sourceActivity?.destroy();sourceActivity=null;clearHeaderMenus();pendingTrip=null;ctx.tripReviews?.destroy();previews.clear();peekPoints.clear();activeId=null;choosing=false;clearMaps();resolutionDrafts.clear();rows=[];tripRows=[];selected=[];mergePreview=null;owner=null;version++;if(host()){const period=document.getElementById('tripJournalPeriod');if(period&&host().contains(period))document.getElementById('plUnassigned').before(period);host().replaceChildren();}}
 const vehicle=id=>ctx.vehicles().find(v=>v.id===id);
 const vehicleName=id=>{const v=vehicle(id);return [v?.name||v?.model||'Машина',v?.plate].filter(Boolean).join(' · ');};
 const person=id=>{const p=ctx.people().find(v=>v.id===id);return p?.full_name||p?.name||p?.email||'Инженер';};
 function scaffold(){clearHeaderMenus();clearMaps();const box=host();if(!box)return;const periodNode=document.getElementById('tripJournalPeriod');if(periodNode&&box.contains(periodNode))document.getElementById('plUnassigned').before(periodNode);
  box.classList.add('gps-journal-workspace','unified-gps-journal');
  box.innerHTML='<header class="journal-page-head"><button type="button" class="btn ghost" data-journal-exit>← Выезды</button><h1>GPS-журнал</h1><div data-journal-period></div><button type="button" class="btn ghost" data-journal-refresh aria-label="Обновить"><span class="journal-refresh-label">Обновить</span><span class="journal-refresh-icon" aria-hidden="true">↻</span></button></header><div data-journal-shared-timeline></div><aside class="gps-journal-sidebar"><div class="seg unassigned-filter" aria-label="Фильтр поездок">'+(manager()?'<button data-ut-mode="all">Все</button><button data-ut-mode="linked">Связанные</button><button data-ut-mode="unlinked">Без выезда</button><button data-ut-mode="pending">Внимание</button><button data-ut-mode="archive">Без проблем маршрута</button>':'<button data-ut-mode="charged">Списания</button>')+'</div><div class="journal-list-tools"><label class="journal-search"><span class="sr-only">Поиск поездок</span><input type="search" data-ut-search placeholder="Поиск поездки" aria-label="Поиск GPS-записей"></label><details class="journal-filters"><summary>Фильтры</summary><div class="gps-journal-search"><label>Автомобиль<select data-ut-vehicle aria-label="Автомобиль GPS-записи"><option value="">Все автомобили</option>'+ctx.vehicles().map(v=>'<option value="'+escape(v.id)+'">'+escape(vehicleName(v.id))+'</option>').join('')+'</select></label><label class="gps-check"><input type="checkbox" data-ut-gaps> Есть разрывы GPS</label></div></details><details class="journal-actions"><summary aria-label="Действия журнала">⋯</summary><div class="gps-journal-selection">'+(manager()?'<button type="button" class="btn sm ghost" data-ut-choose>Выбрать записи</button>':'')+infoHint('Поездки выездов и GPS-записи без выезда. Проверка маршрута и подтверждение присутствия независимы. Время указано по Киеву.','О GPS-журнале')+'</div></details></div><p class="unassigned-status" role="status"></p><div data-ut-selection></div><div class="unassigned-list card"><table aria-label="GPS-записи" class="journal-register"><thead><tr><th scope="col">Запись</th><th scope="col">Период</th><th scope="col">Техника / источник</th><th scope="col">Связь</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead><tbody></tbody></table></div><button class="btn ghost" data-ut-more hidden>Загрузить ещё</button></aside><section class="gps-journal-detail" aria-label="Выбранная GPS-запись"><p class="hint">Выберите запись для просмотра маршрута.</p></section>';
  const head=box.querySelector('.journal-page-head'),tools=box.querySelector('.journal-list-tools'),filters=tools.querySelector('.journal-filters'),actions=tools.querySelector('.journal-actions'),searchLabel=tools.querySelector('.journal-search');
  filters.querySelector('summary').innerHTML=icon('filters');filters.querySelector('summary').setAttribute('aria-label','Фильтры журнала');
  head.append(filters,actions);box.querySelector('.gps-journal-sidebar').prepend(searchLabel);tools.remove();
  const archive=box.querySelector('[data-ut-mode=archive]');if(archive)filters.querySelector('.gps-journal-search').prepend(archive);
  actions.querySelector('.gps-journal-selection').append(box.querySelector('[data-journal-refresh]'));
  const help=actions.querySelector('.qm');if(help){help.textContent=help.getAttribute('aria-label');help.classList.add('ghost');}
  headerMenus=[wireDetailsPopover(filters),wireDetailsPopover(actions)];
  // Phone: the header folds into one row once the register scrolls and unfolds back at the top.
  const sidebar=box.querySelector('.gps-journal-sidebar');sidebar.addEventListener('scroll',()=>{const top=sidebar.scrollTop,folded=box.dataset.collapsed==='true';if(!folded&&top>48)box.dataset.collapsed='true';else if(folded&&top<=0)box.dataset.collapsed='false';},{passive:true});box.dataset.collapsed='false';
  const period=document.getElementById('tripJournalPeriod');if(period){box.querySelector('[data-journal-period]').append(period);period.style.display='';}box.querySelector('[data-journal-exit]').onclick=()=>{box.querySelector('.journal-actions').open=false;ctx.onExit?.();};box.querySelector('[data-journal-refresh]').onclick=async()=>{if(!await leave())return;previews.clear();peekPoints.clear();load();};
  box.querySelector('[data-ut-search]').value=search;box.querySelector('[data-ut-vehicle]').value=vehicleFilter;box.querySelector('[data-ut-gaps]').checked=gapsOnly;box.querySelector('[data-ut-gaps]').closest('label').hidden=!manager();
  box.querySelector('[data-ut-search]').oninput=e=>{search=e.target.value;paintList();};
  box.querySelector('[data-ut-vehicle]').onchange=async e=>{if(!await leave()){e.target.value=vehicleFilter;return;}vehicleFilter=e.target.value;load();};
  box.querySelector('[data-ut-gaps]').onchange=e=>{gapsOnly=e.target.checked;if(gapsOnly){Promise.allSettled(rows.filter(r=>!r._trip).map(r=>previewFor(r.id))).then(()=>{if(box.isConnected)paintList();});}paintList();};
  box.querySelector('[data-ut-choose]')?.addEventListener('click',()=>{choosing=!choosing;selected=[];mergePreview=null;box.querySelector('.journal-actions').open=false;paintList();});
  const refresh=document.getElementById('tripJournalRefresh');if(refresh)refresh.onclick=async()=>{if(!await leave())return;previews.clear();peekPoints.clear();load();};box.querySelector('[data-ut-more]').onclick=()=>{offset=(offset||50)+50;paintList();};
  box.querySelectorAll('[data-ut-mode]').forEach(b=>{b.classList.toggle('on',b.dataset.utMode===mode);b.setAttribute('aria-pressed',String(b.dataset.utMode===mode));b.onclick=async()=>{if(mode===b.dataset.utMode)return;if(!await leave())return;mode=b.dataset.utMode;selected=[];mergePreview=null;scaffold();load();};});
 }
 function inMode(r,key){if(key==='all')return true;if(r._supplement)return key==='linked';if(r._trip)return key==='linked'?true:key==='pending'?tripAttention(r._trip):key==='archive'?r._trip.review?.total>0&&!tripAttention(r._trip):false;return key==='pending'||key==='unlinked'?['recording','review'].includes(r.state):key==='charged'?r.state==='charged':['charged','merged'].includes(r.state);}
 const recordNumber=r=>String(r._supplement?r.id:r._sources?.[0]?.id||r.trip_id||r.id).replace(/^trip:/,'').slice(0,8);
 function visibleRows(){const term=search.trim().toLocaleLowerCase();return rows.filter(r=>(!vehicleFilter||r.vehicle_id===vehicleFilter)&&inMode(r,mode)&&(!term||[recordNumber(r),vehicleName(r.vehicle_id),r.trip_id,r.review_note].join(' ').toLocaleLowerCase().includes(term))&&(!gapsOnly||(r._trip?(r._trip.review?.recovery||r._trip.review?.gaps):Number(previews.get(r.id)?.quote?.gaps)>0)));}

 // Быстрый взгляд на трек прямо в списке: карта под строкой, точки грузятся один раз.
 function peekLoad(r){const key=r._trip?'trip:'+r._trip.id:r.id;if(!peekPoints.has(key)){const loading=(r._trip?Promise.resolve(ctx.tripPoints?.(r._trip.id)||[]):readPoints(r.id)).catch(e=>{peekPoints.delete(key);throw e;});peekPoints.set(key,loading);}return peekPoints.get(key);}
 async function mountPeek(list,id){const r=rows.find(x=>x.id===id),row=list.querySelector('[data-ut-peek-row="'+CSS.escape(id)+'"]');if(!r||!row)return;const token=++peekToken,status=row.querySelector('[role=status]');
  try{const points=(await peekLoad(r)).filter(p=>p.lat!=null&&p.lng!=null);if(token!==peekToken||!row.isConnected)return;
   if(!points.length){status.textContent='В записи нет GPS-точек.';return;}
   const entry=mountGpsTrackMap(row.querySelector('svg.unassigned-preview'),points,{leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,mini:true,label:'Трек записи №'+recordNumber(r),color:TRACK_STYLE.measured});
   if(entry){maps.add(entry);status.remove();}else status.textContent='Карта недоступна.';
  }catch(e){if(token===peekToken&&row.isConnected)status.textContent='Трек не загрузился: '+(e.message||'нет связи');}}
 function openPeekMap(id){const r=rows.find(x=>x.id===id);if(!r)return;if(r._trip){ctx.showTripMap?.(r._trip.id);return;}ctx.showRecordMap?.(r.id,{title:'GPS-запись №'+recordNumber(r),sub:vehicleName(r.vehicle_id)+' · '+intervalText(r.started_at,r.ended_at||r.last_ts)});}

 function paintList(){
  const box=host();if(!box)return;
  const list=box.querySelector('.journal-register tbody'),visible=visibleRows(),displayed=visible.slice(0,offset||50);clearMaps(list);if(peekId&&!displayed.some(r=>r.id===peekId))peekId=null;
  more=visible.length>displayed.length;
  list.innerHTML=displayed.map(r=>{
   const id=escape(r.id),reference='№'+escape(recordNumber(r)),link=r._trip?'Выезд №'+escape(String(r.trip_id||r._trip.id).slice(0,8)):r._supplement?(r.resolution?.accounting?'В учёте':'Дополнительная')+' · выезд №'+escape(r.trip_id.slice(0,8)):escape(status[r.state]||r.state);
   const issues=r._trip?tripReviewIssues(r._trip).map(issue=>issue.label).join(' · '):'';
   const charge=r.state==='charged'?'<small>'+number(r.resolution?.cost)+' '+escape(r.resolution?.currency||ctx.currency())+' · '+escape(person(r.engineer_id))+'</small>':'';
   const peekOpen=peekId===r.id,peek=manager()?'<button type="button" class="btn ut-peek-toggle" data-ut-peek="'+id+'" aria-expanded="'+peekOpen+'" aria-label="'+(peekOpen?'Скрыть трек ':'Показать трек ')+reference+'">'+(peekOpen?'Скрыть трек':'Трек')+'</button>':'';
   const action=manager()?'<button type="button" class="btn" data-ut-details="'+id+'" aria-label="Открыть запись '+reference+'">Открыть запись</button>':'';
   const merge=choosing&&manager()&&mergeEligible(r)?'<label class="journal-merge-choice"><input type="checkbox" data-ut-select="'+id+'" '+(selected.includes(r.id)?'checked':'')+'>Выбрать для объединения</label>':'';
   return '<tr data-ut-card="'+id+'"><th scope="row">'+reference+'</th><td data-label="Период">'+escape(intervalText(r.started_at,r.ended_at||r.last_ts))+'</td><td data-label="Техника / источник">'+escape(vehicleName(r.vehicle_id))+'<small>GPS</small></td><td data-label="Связь">'+link+charge+(issues?'<small>'+escape(issues)+'</small>':'')+'</td><td><span class="ut-row-actions">'+peek+action+'</span>'+merge+'</td></tr>'
    +(peekOpen?'<tr class="ut-peek-row" data-ut-peek-row="'+id+'"><td colspan="5"><div class="ut-peek"><div class="ut-peek-map"><svg class="unassigned-preview" aria-hidden="true"></svg><p class="hint" role="status">Загружаем трек…</p></div><button type="button" class="btn ut-peek-open" data-ut-peek-map="'+id+'">Просмотреть на карте</button></div></td></tr>':'');
  }).join('');
  box.querySelectorAll('[data-ut-mode]').forEach(button=>{
   const labels={pending:'Внимание',linked:'Связанные',unlinked:'Без выезда',archive:'Без проблем маршрута',all:'Все',charged:'Списания'};
   button.innerHTML='<span>'+labels[button.dataset.utMode]+'</span> <b>'+rows.filter(r=>inMode(r,button.dataset.utMode)).length+'</b>';
  });
  box.querySelector('.unassigned-status').textContent=visible.length?'Показано '+displayed.length+' из '+visible.length:'Записи не найдены. Измените период или фильтры.';
  box.querySelector('[data-ut-more]').hidden=!more;
  box.querySelector('[data-ut-choose]')?.setAttribute('aria-pressed',String(choosing));
  list.querySelectorAll('[data-ut-details]').forEach(button=>button.onclick=()=>perform(button,()=>details(button.dataset.utDetails)));
  list.querySelectorAll('[data-ut-peek]').forEach(button=>button.onclick=()=>{const id=button.dataset.utPeek;peekId=peekId===id?null:id;paintList();list.querySelector('[data-ut-peek="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});});
  list.querySelectorAll('[data-ut-peek-map]').forEach(button=>button.onclick=()=>openPeekMap(button.dataset.utPeekMap));
  if(peekId)mountPeek(list,peekId);
  list.querySelectorAll('[data-ut-select]').forEach(input=>input.onchange=()=>{
   selected=input.checked?[...selected,input.dataset.utSelect]:selected.filter(id=>id!==input.dataset.utSelect);
   selected.sort((a,b)=>Date.parse(rows.find(r=>r.id===a).started_at)-Date.parse(rows.find(r=>r.id===b).started_at));
   mergePreview=null;paintSelection();
  });
  paintSelection();
 }
 async function previewFor(id){if(previews.has(id))return previews.get(id);const uid=ctx.userId(),[quote,points]=await Promise.all([rpc('unassigned_track_quote',{p_track:id}),readPoints(id)]);const preview={quote,points};if(uid===ctx.userId())previews.set(id,preview);return preview;}
 function paint(){
  paintList();
  if(!host().classList.contains('gps-show-detail'))return;
  if(activeId&&rows.some(r=>r.id===activeId))return details(activeId,true,{},true);
  activeId=null;host().classList.remove('gps-show-detail','journal-map-expanded');ctx.onList?.();
 }
 async function perform(button,action){button.disabled=true;try{await action();}catch(e){ctx.notify(e.message||'Не удалось выполнить действие','err');}finally{if(button.isConnected){button.disabled=false;button.focus({preventScroll:true});}}}
 async function load(append=false){const uid=ctx.userId(),token=++version;if(!uid)return;
  const box=host();if(!box)return;box.querySelector('.unassigned-status').textContent='Загружаем поездки…';box.querySelector('[data-ut-more]').disabled=true;
  try{let query=ctx.db().from('unassigned_tracks').select('*').order('started_at',{ascending:false});
   if(ctx.period){const bounds=calendarPeriodBounds(ctx.period());query=query.gte('last_ts',bounds.from).lt('started_at',bounds.until);}
   if(!manager())query=query.eq('state','charged');if(vehicleFilter)query=query.eq('vehicle_id',vehicleFilter);
   const allSources=[],allTrips=[];for(let start=0;;start+=500){const [response,page]=await Promise.all([query.range(start,start+499),ctx.tripReviews?.list(start,vehicleFilter)||Promise.resolve([])]);if(response.error)throw response.error;if(token!==version||uid!==ctx.userId())return;allSources.push(...response.data||[]);allTrips.push(...page);if((response.data||[]).length<500&&page.length<500)break;}
   if(!append){selected=[];mergePreview=null;}tripRows=allTrips;rows=journalEntries(allSources,tripRows);offset=50;await paint();
  }catch(e){if(token===version&&uid===ctx.userId()){if(!append){rows=[];box.querySelector('.journal-register tbody').replaceChildren();}box.querySelector('.unassigned-status').textContent='Не удалось загрузить поездки. Нажмите «Обновить»: '+(e.message||'нет связи');}}
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
 function detailFailure(box,id,error,state){box.innerHTML='<p class="err" role="alert">'+escape(error.message||'Не удалось загрузить запись')+'</p><button class="btn" data-ut-retry>Повторить загрузку</button><button class="btn ghost gps-back" data-ut-back>← К журналу</button>';box.querySelector('[data-ut-retry]').onclick=()=>details(id,true,state);box.querySelector('[data-ut-back]').onclick=()=>{host().classList.remove('gps-show-detail','journal-map-expanded');ctx.onList?.();host().querySelector('.gps-journal-sidebar').scrollTop=listScroll;};}
 function mountManualDraftEditor(panel,source){
  let working=false;
  const retry=new Map();
  const uid=ctx.userId(),current=()=>uid===ctx.userId()&&activeId===source.id&&panel.isConnected;
  async function load(){
   const {data,error}=await ctx.db().from('gps_manual_visit_drafts').select(manualDraftFields)
    .eq('track_id',source.id).order('stay_from');
   if(!current())return;
   if(error){
    panel.textContent='Не удалось загрузить ручные посещения: '+error.message+' ';
    const button=panel.ownerDocument.createElement('button');
    button.type='button';button.className='btn ghost';button.textContent='Повторить';
    button.onclick=()=>perform(button,load);panel.append(button);return;
   }
   renderManualVisitDrafts(panel,data||[],{
    onCreate:button=>perform(button,()=>edit()),
    onEdit:(draft,button)=>perform(button,()=>edit(draft)),
    onRemove:(draft,button)=>perform(button,()=>remove(draft))
   });
  }
  async function edit(draft){
   if(working)return;
   working=true;
   try{
    const {data:jobs,error}=await ctx.db().from('jobs').select('id,clients(name)').is('deleted_at',null).order('created_at',{ascending:false});
    if(error)throw error;
    if(!current())return;
    const pending=retry.get(draft?.id||'new');
    const fields=[
     ...manualVisitTimeFields(draft,source),
     ...manualVisitPartyFields(jobs||[],ctx.people(),{job:draft?.job_id,crew:draft?.crew_ids})
    ];
    for(const field of fields)if(pending?.values[field.key]!=null)field.value=pending.values[field.key];
    const values=await ctx.prompt('Черновик посещения без GPS · время по Киеву',fields,{okText:'Сохранить черновик'});
    if(!values||!current())return;
    const id=draft?.id||pending?.id||crypto.randomUUID();
    retry.set(draft?.id||'new',{id,values});
    await rpc('gps_manual_visit_draft_save',{p_track:source.id,p_id:id,p_expected:draft?.revision??0,
     p_from:values.from,p_to:values.to,p_job:values.job,p_crew:values.crew,p_reason:values.reason,p_remove:false});
    retry.delete(draft?.id||'new');
    if(current()){await load();ctx.notify('Черновик посещения сохранён.','ok');}
   }finally{working=false;}
  }
  async function remove(draft){
   if(working)return;
   working=true;
   try{
    if(!await ctx.confirm('Удалить черновик ручного посещения?',{okText:'Удалить',danger:true})||!current())return;
    await rpc('gps_manual_visit_draft_save',{p_track:source.id,p_id:draft.id,p_expected:draft.revision,
     p_from:null,p_to:null,p_job:null,p_crew:null,p_reason:null,p_remove:true});
    retry.delete(draft.id);
    if(current())await load();
   }finally{working=false;}
  }
  void load();
  return ()=>working;
 }
 async function details(id,open=true,state={},reload=false){if(!manager()&&!rows.find(r=>r.id===id)?._direct)return;if((id!==activeId||reload)&&!await leave())return;const mobile=window.innerWidth<=1100,pane=host()?.closest('.pane');if(open&&!host()?.classList.contains('gps-show-detail'))listScroll=host().querySelector('.gps-journal-sidebar')?.scrollTop||0;const uid=ctx.userId(),r=rows.find(x=>x.id===id),box=host()?.querySelector('.gps-journal-detail');if(!r||!box)return;if(!reload&&id===activeId&&r._trip&&pendingTrip?.id===id){host().classList.toggle('gps-show-detail',open);await pendingTrip.promise.catch(()=>{});if(uid===ctx.userId()&&activeId===id&&box.querySelector('.journal-trip-head'))return details(id,open,state);return;}if(!reload&&id===activeId&&r._trip&&box.querySelector('.journal-trip-head')){host().classList.toggle('gps-show-detail',open);ctx.tripReviews.navigate(state);paintList();return;}sourceView=null;sourceActivity?.destroy();sourceActivity=null;activeId=id;host().classList.toggle('gps-show-detail',open);paintList();clearMaps(box);clearMaps(host().querySelector('[data-journal-shared-timeline]'));box.innerHTML='<p role="status">Загружаем трек…</p>';
  if(r._trip){sourceView=null;let mounting;try{mounting=ctx.tripReviews.mount(box,{...r._trip,recordNumber:recordNumber(r)},{...state,back:async()=>{if(!await leave())return;host().classList.remove('gps-show-detail');ctx.onList?.();host().querySelector('.gps-journal-sidebar').scrollTop=listScroll;host().querySelector('[data-ut-details="'+id+'"]')?.focus({preventScroll:true});},changed:(tripId,stay)=>{const t=tripRows.find(t=>t.id===tripId);if(t?.review){if(stay.__review)t.review=stay.__review;else if(!['approved','rejected'].includes(stay.__previousStatus))t.review.done=Math.min(t.review.total,t.review.done+1);}paintList();}});pendingTrip={id,promise:mounting};await mounting;if(uid!==ctx.userId()||activeId!==id||!box.isConnected)return;if(open)ctx.onRecord?.(r._trip.id,state);if(mobile&&open&&box.isConnected){if(pane)pane.scrollTop=0;box.querySelector('[data-ut-back]')?.focus({preventScroll:true});}}catch(e){if(uid===ctx.userId()&&activeId===id&&box.isConnected)detailFailure(box,id,e,state);}finally{if(pendingTrip?.promise===mounting)pendingTrip=null;}return;}ctx.tripReviews?.destroy();
  try{const {quote,points}=await previewFor(id);if(uid!==ctx.userId()||activeId!==id||!box.isConnected)return;
  const {data:events,error}=await ctx.db().from('unassigned_track_events').select('action,reason,created_at').eq('track_id',id).order('id',{ascending:false});if(error)throw error;if(uid!==ctx.userId()||activeId!==id||!box.isConnected)return;
  const canResolve=manager()&&['recording','review'].includes(r.state)&&!(r.state==='recording'&&new Date(r.last_ts)>Date.now()-300000);
  box.innerHTML='<button type="button" class="btn ghost gps-back" data-ut-back>← К списку</button><header class="gps-detail-head"><p class="design-eyebrow">Выбранная GPS-запись</p><h2>GPS-запись №'+escape(recordNumber(r))+'</h2><p>'+escape(vehicleName(r.vehicle_id))+'</p><span class="tag">'+escape(status[r.state])+'</span><p class="unassigned-period">'+date(r.started_at)+' — '+(r.state==='recording'?'последняя точка '+date(r.last_ts):date(r.ended_at||r.last_ts))+'</p></header>'+trackPreview(points)+'<div class="gps-detail-metrics"><div><span>По GPS</span><b>'+number(quote.km)+' км</b></div><div><span>Точки телеметрии</span><b>'+number(quote.points)+'</b></div><div><span>Разрывы / выбросы</span><b>'+quote.gaps+' / '+quote.rejected+'</b></div><div><span>Себестоимость</span><b>'+(quote.rate==null?'Не настроена':number(quote.cost)+' '+escape(ctx.currency()))+'</b></div></div><p class="hint">Разрывы линии — участки без GPS. Пробег по ним не измерен.</p>'
   +(r.state==='charged'?'<section class="card"><h3>Списание записано</h3><p>'+escape(person(r.engineer_id))+' · '+number(r.resolution?.km)+' км × '+number(r.resolution?.rate)+' = '+number(r.resolution?.cost)+' '+escape(r.resolution?.currency||ctx.currency())+'</p><p>'+escape(r.resolution?.reason)+'</p></section>':'')
   +(canResolve?'<section class="gps-resolution-entry"><h3>Оформить поездку</h3><p class="hint">Привязка GPS-записи не подтверждает посещения объектов и выполнение работ.</p><div class="gps-resolution-choices"><button type="button" class="btn" data-ut-action="link">Связать с выездом</button><button type="button" class="btn" data-ut-action="create">Создать выезд</button><button type="button" class="btn ghost" data-ut-action="charge">Записать списание инженеру</button></div></section>':r.state==='recording'?'<p class="hint">Запись продолжается. Оформление доступно после завершения.</p>':'')
   +(r._supplement?'<p class="gps-supplement-note">'+(r.resolution?.accounting
     ?'Запись учтена в основном треке · добавлено GPS-точек: '+number(r.resolution.accounting.points_added)
     :'Дополнительная запись. Пробег и часы учитываются по основному треку выезда.')+'</p>':'')
   +(r.state==='linked'?'<button type="button" class="btn" data-ut-trip>Открыть выезд</button>':'')+(manager()&&r.state==='charged'?'<button type="button" class="btn ghost" data-ut-cancel>Отменить списание</button>':'')
   +'<details class="gps-event-history"><summary>История решения · '+(events||[]).length+'</summary>'+(events||[]).map(e=>'<p class="unassigned-event">'+date(e.created_at)+' · '+escape(e.reason)+'</p>').join('')+'</details>';
  const documents=document.createElement('section');documents.className='journal-trip-documents';documents.hidden=true;for(const node of [...box.querySelectorAll('.gps-resolution-entry,.gps-event-history,.card,[data-ut-trip],[data-ut-cancel]')])documents.append(node);
  const discussion=document.createElement('section');discussion.className='entity-activity journal-gps-activity';
  const trip={id:r.id,started_at:r.started_at,finished_at:r.ended_at||r.last_ts},parts=gpsSegments(points),track={trackKm:Number(quote.km),roadKm:0,segments:parts.flatMap((p,i)=>[{kind:'track',line:p.map(x=>[+x.lng,+x.lat]),fromTs:p[0].ts,toTs:p.at(-1).ts},...(i<parts.length-1?[{kind:'line',fromTs:p.at(-1).ts,toTs:parts[i+1][0].ts,fromPt:p.at(-1),toPt:parts[i+1][0],why:'Нет последовательных GPS-точек. Расстояние не измерено.'}]:[])])};
  const sourceHead=box.querySelector('.gps-detail-head'),sourceTitle=document.createElement('div'),sourceTabs=document.createElement('div');
  sourceTitle.append(...sourceHead.childNodes);sourceHead.classList.add('journal-trip-head');
  sourceHead.append(box.querySelector('[data-ut-back]'),sourceTitle);
  sourceTabs.className='journal-trip-tabs seg';sourceTabs.setAttribute('role','group');sourceTabs.setAttribute('aria-label','Разделы GPS-записи');
  sourceTabs.innerHTML='<button type="button" data-orphan-pane="stops">Обзор</button><button type="button" data-orphan-pane="documents">Данные</button>';
  sourceHead.append(sourceTabs);
  frameGpsRecordHead(sourceHead,{back:()=>sourceHead.querySelector('[data-ut-back]')?.click(),linkLabel:r.trip_id?tripLabel(null,r.trip_id):'Без выезда',linkHref:r.trip_id?'#/trip/'+encodeURIComponent(r.trip_id):'',openLink:r.trip_id&&ctx.openTrip?()=>ctx.openTrip(r.trip_id):null,source:'GPS · '+vehicleName(r.vehicle_id),status:r.state==='linked'||r.trip_id?'Связана с выездом':r.state==='charged'?'Списание инженеру':r.state==='recording'?'Идёт запись':'Без выезда'});
  const stays=observedSourceStops(parts);
  const overview=document.createElement('section');overview.className='journal-orphan-overview';
  for(const node of [...box.children])if(!node.matches('.gps-back,.gps-detail-head'))overview.append(node);
  const stopsPanel=document.createElement('section');stopsPanel.className='journal-link-required';
  overview.append(stopsPanel);
  const resolution=documents.querySelector('.gps-resolution-entry');if(resolution)overview.prepend(resolution);
  let merging=false;
  if(r._supplement){
   overview.prepend(overview.querySelector('.gps-supplement-note'));
   if(!r.resolution?.accounting&&ctx.applySupplement){
    const apply=document.createElement('button');apply.type='button';apply.className='btn';
    apply.textContent='Проверить и учесть GPS';
    apply.onclick=()=>perform(apply,async()=>{
     merging=true;
     try{
      const receipt=await ctx.applySupplement(id,r.trip_id);
      if(!receipt||uid!==ctx.userId())return;
      previews.delete(id);merging=false;
      await load();
      ctx.notify('Дополнительный GPS учтён в выезде.','ok');await openRecord(r.trip_id,{pane:'route'});
     }finally{merging=false;}
    });
    overview.prepend(apply);
   }
   const parent=document.createElement('button');parent.type='button';parent.className='btn';
   parent.textContent='К GPS-журналу выезда';parent.onclick=()=>openRecord(r.trip_id);overview.prepend(parent);
  }
  overview.append(discussion);
  // Mockup v65: one pinned action opens the single linking dialog (existing trip, new trip or charge).
  const pinned=overview.querySelector('.gps-resolution-entry');
  if(pinned){pinned.classList.add('workflow-gps-pinned');pinned.querySelector('h3')?.remove();pinned.querySelectorAll('[data-ut-action=create],[data-ut-action=charge]').forEach(b=>{b.hidden=true;});const link=pinned.querySelector('[data-ut-action=link]');if(link){link.textContent='Привязать к выезду';link.classList.add('amber');}overview.append(pinned);}
  box.append(overview,documents);
  sourceActivity=mountEntityActivity({root:discussion,db:ctx.db(),entity:'gpsTrack',id,userId:ctx.userId,people:ctx.people});
  const route=document.createElement('section');route.className='journal-trip-route';route.hidden=true;box.append(route);
  const routeView=mountJournalRoute(route,{trip,track,stays,leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,canEdit:false});
  maps.add({container:route,destroy:()=>routeView.destroy()});
  const roads=document.createElement('section');roads.className='journal-road-sections';
  route.querySelector('.journal-route-metrics').before(roads);
  const adapter=createSourceRoadAdapter({db:ctx.db,trip,parts,stays,quote,maxSpeed:ctx.trackMaxSpeed?.(),editable:canResolve});
  const roadView=mountRoadSections(roads,{db:ctx.db,tripId:id,adapter,
   current:()=>uid===ctx.userId()&&activeId===id&&route.isConnected,
   focus:routeView.focusRoad,onSplitPoint:routeView.markRoadCut,splitHost:route.querySelector('.journal-route-map')});
  let roadLoaded=false;
  const timeline=document.createElement('div');timeline.className='journal-timeline-host';timeline.innerHTML=timelineHTML(trip,track,stays);
  overview.append(timeline);const timelineView=wireJournalTimeline(timeline);maps.add({container:timeline,destroy:()=>timelineView.destroy()});
  timeline.querySelectorAll('[data-journal-stop]').forEach(button=>button.onclick=()=>{switchOrphanPane('route');routeView.select(button.dataset.journalStop);});
  // Тот же вид, что у записи выезда: слева стоянки (и «Дорога»), справа
  // мини-карта с лентой времени и пробегом; «Просмотреть на карте» открывает
  // общий просмотр трека на большой карте.
  overview.classList.add('journal-orphan-split');
  overview.querySelector('svg.unassigned-preview')?.remove();
  const listCol=document.createElement('div');listCol.className='orphan-col orphan-list';
  const mapCol=document.createElement('section');mapCol.className='orphan-col orphan-map';mapCol.setAttribute('aria-label','Карта GPS-записи');
  const listModes=document.createElement('div');listModes.className='seg journal-list-modes orphan-list-modes';listModes.setAttribute('role','group');listModes.setAttribute('aria-label','Состав GPS-записи');
  listModes.innerHTML='<button type="button" data-orphan-pane="stops" aria-pressed="true" class="on">Стоянки</button><button type="button" data-orphan-pane="route" aria-pressed="false">Дорога</button>';
  listCol.append(listModes,stopsPanel);
  const routeModes=listModes.cloneNode(true);routeModes.classList.replace('orphan-list-modes','orphan-route-modes');route.prepend(routeModes);
  const miniBox=document.createElement('div');miniBox.className='journal-overview-map';
  const metrics=overview.querySelector('.gps-detail-metrics'),metricsHint=metrics?.nextElementSibling?.matches('p.hint')?metrics.nextElementSibling:null;
  const dataLink=document.createElement('button');dataLink.type='button';dataLink.className='btn ghost orphan-data-link';dataLink.dataset.orphanPane='documents';dataLink.textContent='Данные GPS-записи →';
  mapCol.append(miniBox,timeline);if(metrics)mapCol.append(metrics);if(metricsHint)mapCol.append(metricsHint);mapCol.append(dataLink);
  const pinnedBar=overview.querySelector('.gps-resolution-entry');
  overview.prepend(listCol,mapCol);listCol.append(discussion);if(pinnedBar)overview.append(pinnedBar);
  const recordTitle=sourceHead.querySelector('h2')?.textContent||'GPS-запись';
  const miniView=mountJournalRoute(miniBox,{trip,track,stays,leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,mini:true,canEdit:false,
   onStop:stayId=>{switchOrphanPane('route');routeView.select(stayId);},
   onExpand:()=>ctx.showRecordMap?ctx.showRecordMap(id,{title:recordTitle,sub:vehicleName(r.vehicle_id)+' · '+intervalText(r.started_at,r.ended_at||r.last_ts)}):switchOrphanPane('route')});
  maps.add({container:miniBox,destroy:()=>miniView.destroy()});
  let sourcePane='stops';function switchOrphanPane(pane,notify=true){sourcePane=pane;if(pane==='route'&&!roadLoaded){roadLoaded=true;void roadView.load();}box.querySelector('[data-ut-back]').setAttribute('aria-label',pane==='stops'?'К журналу':'К поездке');overview.hidden=pane!=='stops';route.hidden=pane!=='route';documents.hidden=pane!=='documents';host().classList.toggle('journal-map-expanded',pane==='route');box.querySelectorAll('[data-orphan-pane]').forEach(b=>{b.classList.toggle('on',b.dataset.orphanPane===pane);b.setAttribute('aria-pressed',String(b.dataset.orphanPane===pane));});if(notify)ctx.onSource?.(id,pane);}
  const draftResponse=canResolve?await ctx.db().from('gps_record_stop_drafts').select('revision,source_revision,source_points,stops').eq('track_id',id).maybeSingle():null;
  if(uid!==ctx.userId()||activeId!==id||!stopsPanel.isConnected)return;
  const draftUI=mountSourceStops(stopsPanel,{stays,source:r,quote,draft:draftResponse?.data,writable:canResolve&&!draftResponse?.error,
   save:payload=>rpc('gps_record_stop_draft_save',payload),
   openMap:stayId=>{switchOrphanPane('route');if(stayId)routeView.select(stayId);}
  });
  if(draftResponse?.error)stopsPanel.querySelector('[data-source-status]').textContent='Не удалось прочитать выбор стоянок: '+draftResponse.error.message;
  box.querySelectorAll('[data-orphan-pane]').forEach(b=>b.onclick=()=>switchOrphanPane(b.dataset.orphanPane));
  let manualWorking=()=>false;
  if(canResolve){
   const manualPanel=document.createElement('section');
   stopsPanel.after(manualPanel);manualWorking=mountManualDraftEditor(manualPanel,r);
  }
  sourceView={id,...draftUI,isSaving:()=>draftUI.isSaving()||manualWorking()||roadView.isSaving()||merging,navigate:pane=>switchOrphanPane(pane,false)};switchOrphanPane(state.pane||'stops',open);box.querySelector('[data-ut-back]').onclick=async()=>{if(sourcePane!=='stops'){switchOrphanPane('stops');return;}if(!await leave())return;host().classList.remove('gps-show-detail','journal-map-expanded');ctx.onList?.();window.requestAnimationFrame(()=>{host().querySelector('.gps-journal-sidebar').scrollTop=listScroll;host().querySelector('[data-ut-details="'+id+'"]')?.focus({preventScroll:true});});};box.querySelectorAll('[data-ut-action]').forEach(b=>b.onclick=()=>perform(b,()=>resolve(id,b.dataset.utAction)));box.querySelector('[data-ut-trip]')?.addEventListener('click',()=>ctx.openTrip(r.trip_id));box.querySelector('[data-ut-cancel]')?.addEventListener('click',e=>perform(e.currentTarget,()=>cancel(id)));paintList();if(open&&mobile)window.requestAnimationFrame(()=>{if(pane)pane.scrollTop=0;box.querySelector('[data-ut-back]')?.focus({preventScroll:true});});
  }catch(e){if(activeId===id&&box.isConnected)detailFailure(box,id,e,state);}
 }
 async function resolve(id,action){const uid=ctx.userId(),row=rows.find(x=>x.id===id);if(!row)return;
  if(sourceView?.isDirty()||sourceView?.isSaving())throw Error('Сохраните выбор стоянок перед оформлением записи.');const quote=await rpc('unassigned_track_quote',{p_track:id});if(uid!==ctx.userId())return;
  if(row.state==='recording'&&new Date(row.last_ts)>Date.now()-300000)throw Error('Поездка ещё записывается. Разобрать её можно после завершения.');
  const engineers=ctx.people().filter(x=>x.role==='engineer'&&x.active!==false).map(p=>({value:p.id,label:p.full_name||p.name||p.email||'Инженер'}));
  const fields=[];let linkOptions=[];
  if(action==='link'){
   linkOptions=await rpc('gps_existing_trip_options',{p_track:id})||[];
   const stages={planned:'план',assigned:'назначен',in_progress:'в работе',finished:'на проверке',done:'завершён'};
   fields.push({key:'trip',type:'select',label:'Выезд той же машины',required:true,options:[
    {value:'',label:linkOptions.length?'Выберите выезд':'Нет выездов на эти даты'},
    ...linkOptions.map(t=>({value:t.id,label:`${t.date_from} — ${t.date_to} · №${t.number??t.id.slice(0,8)} · ${stages[t.status]||t.status}${t.link_mode==='supplement'?' · дополнительная запись':''}`}))
   ]});
  }
  if(action==='charge')fields.push({key:'engineer',type:'select',label:'Инженер',required:true,options:[{value:'',label:'Выберите инженера'},...engineers]});
  if(action==='charge')fields.push({key:'km',type:'number',min:0,step:.01,label:'Подтверждённый пробег, км',value:quote.km,required:true});fields.push({key:'reason',type:'textarea',label:'Основание решения',required:true});
  if(action==='charge'&&!(quote.rate>0))throw Error('Сначала настройте себестоимость километра машины или отдела.');
  const draftKey=uid+':'+id+':'+action,draft=resolutionDrafts.get(draftKey);if(draft)fields.forEach(field=>{if(Object.hasOwn(draft,field.key))field.value=draft[field.key];});
  const values=await ctx.prompt(action==='create'?'Создать выезд из GPS-записи':action==='charge'?'Списание инженеру · '+number(quote.rate)+' '+ctx.currency()+'/км':'Привязать поездку к выезду',fields,{okText:action==='charge'?'Проверить сумму':action==='create'?'Заполнить выезд':'Подтвердить связь',gpsResolution:{action,vehicle:vehicleName(row.vehicle_id),period:date(row.started_at)+' — '+date(row.ended_at||row.last_ts),km:number(quote.km),points:quote.points,gaps:quote.gaps,rate:number(quote.rate)+' '+ctx.currency()+'/км',linkOptions,canCharge:quote.rate>0,cost:km=>number(distanceCost(km,quote.rate))+' '+ctx.currency()}});if(!values||uid!==ctx.userId())return;
  if(values.__nextAction){resolutionDrafts.set(draftKey,values.__draft||{});return resolve(id,values.__nextAction);}
  resolutionDrafts.set(draftKey,values);
  if(action==='create'){
   await ctx.openTrip(null,{gpsSource:{id,vehicleId:row.vehicle_id,from:row.started_at,to:row.ended_at||row.last_ts,
    revision:quote.revision,points:quote.points,reason:values.reason,operation:crypto.randomUUID()}});
   return;
  }
  const cost=action==='charge'?distanceCost(values.km,quote.rate):null;
  if(action==='charge'&&!await ctx.confirm('Списать '+number(cost)+' '+ctx.currency()+' инженеру?\n'+number(values.km)+' км × '+number(quote.rate)+' '+ctx.currency()+'/км.\nОснование: '+values.reason,{title:'Подтверждение списания',danger:true,okText:'Списать по себестоимости'}))return;
  if(uid!==ctx.userId())return;
  const result=action==='link'?await rpc('gps_existing_trip_link',{
   p_track:id,p_expected:quote.revision,p_points:quote.points,p_trip:values.trip,
   p_mode:linkOptions.find(trip=>trip.id===values.trip)?.link_mode,p_reason:values.reason
  }):await rpc('unassigned_track_resolve',{p_track:id,p_expected:quote.revision,p_action:action,p_data:{...values,km:values.km??quote.km,points:quote.points,cost}});
  if(uid!==ctx.userId())return;resolutionDrafts.delete(draftKey);await load();ctx.notify(action==='charge'?'Списание сохранено в журнале':'Трек привязан к выезду','ok');if(result.trip_id){await ctx.reload();if(result.link_mode==='supplement')await openSource(id);else await openRecord(result.trip_id);}
 }
 async function cancel(id){const uid=ctx.userId(),r=rows.find(x=>x.id===id);if(!r)return;const v=await ctx.prompt('Отменить списание',[{key:'reason',label:'Причина отмены',type:'textarea',required:true}],{okText:'Отменить списание'});if(!v||uid!==ctx.userId())return;await rpc('unassigned_track_charge_cancel',{p_track:id,p_expected:r.revision,p_reason:v.reason});if(uid===ctx.userId())await load();}
 async function open(){const uid=ctx.userId();if(owner===uid&&host()?.querySelector('.journal-page-head'))return;if(owner!==uid){reset();owner=uid;mode=manager()?'all':'charged';}scaffold();try{await ctx.ensureRefs();if(uid===ctx.userId())return load();}catch(e){if(uid===ctx.userId()&&host())host().querySelector('.unassigned-status').textContent='Не удалось загрузить справочники: '+(e.message||'нет связи');}}
 async function leave(){
  if(sourceView?.isSaving())return false;
  if(sourceView?.isDirty()){
   if(!await ctx.confirm('Выйти без сохранения выбора стоянок?',{title:'Несохранённые изменения',okText:'Выйти без сохранения',cancelText:'Продолжить работу',danger:true}))return false;
   sourceView.discard();
  }
  if(!ctx.tripReviews?.isDirty())return true;const ok=!!await ctx.confirm('Выйти без сохранения решения по остановке?',{title:'Несохранённые изменения',okText:'Выйти без сохранения',cancelText:'Продолжить работу',danger:true});if(ok)ctx.tripReviews.discard();return ok;}
 async function openRecord(tripId,state={}){const id='trip:'+tripId;if(activeId===id&&host()?.querySelector('[data-journal-trip]')){if(!host().classList.contains('gps-show-detail'))listScroll=host().querySelector('.gps-journal-sidebar').scrollTop;host().classList.add('gps-show-detail');ctx.tripReviews.navigate(state);if(state.roadId)ctx.onRecord?.(tripId,state);return;}if(!rows.some(r=>r.id===id))rows.push({id,_trip:{id:tripId},_direct:true});else rows.find(r=>r.id===id)._direct=true;await details(id,true,state);}
 async function openSource(id,state={}){if(!manager())return;if(activeId===id&&sourceView?.id===id){if(!host().classList.contains('gps-show-detail'))listScroll=host().querySelector('.gps-journal-sidebar').scrollTop;host().classList.add('gps-show-detail');sourceView.navigate(state.pane||'stops');return;}if(!rows.some(r=>r.id===id)){const {data,error}=await ctx.db().from('unassigned_tracks').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!data)throw Error('GPS-запись недоступна');if(data.state==='linked'&&data.trip_id&&data.resolution?.link_mode!=='supplement')return openRecord(data.trip_id,state);
   rows.push({...data,_supplement:data.resolution?.link_mode==='supplement'});}return details(id,true,state);}
 return {open,openRecord,openSource,isDirty:()=>!!(sourceView?.isDirty()||sourceView?.isSaving()),showList:async()=>{if(!await leave())return;ctx.tripReviews?.navigate({pane:'stops'});host()?.classList.remove('gps-show-detail','journal-map-expanded');if(host())host().querySelector('.gps-journal-sidebar').scrollTop=listScroll;},reset,leave,refresh:async()=>{if(!await leave())return;previews.clear();peekPoints.clear();selected=[];mergePreview=null;paintSelection();host()?.querySelectorAll('[data-ut-select]').forEach(c=>c.checked=false);return load();}};
}
