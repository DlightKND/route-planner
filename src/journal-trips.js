import {mountEntityActivity} from './entity-activity.js';
import {tripLabel} from './workflow-meta.js';
import {frameGpsRecordHead} from './gps-record-head.js';
import {journalIcon as icon} from './journal-icons.js';
import {intervalText} from './core/journal-display.js';
import {calendarPeriodBounds} from './core/calendar-period.js';
import {presenceHTML,readPresenceForm,wirePresenceRecovery,historyHTML} from './trip-workbench.js';
import {mountPresenceReview} from './presence-review-workspace.js';
import {validatePresence} from './core/trip-review.js';
import {presenceRoadConflicts,reviewedStop,routeAmounts,kmText} from './core/gps-journal.js';
import {mountJournalRoute,timelineHTML,wireJournalTimeline,floatJournalTimeline} from './journal-route.js';
import {mountRoadSections} from './journal-road.js';
import {mountLinkedStopDrafts} from './journal-source-stops.js';
import {manualDraftFields,manualVisitPartyFields,renderManualVisitDrafts} from './journal-manual-drafts.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Продолжается';
const result=({data,error})=>{if(error)throw error;return data;};
const reviewFor=(stays,track,{gaps=null,missingTrack=!track||routeAmounts(track).gps==null}={})=>({total:stays.length,confirmed:stays.filter(s=>s.status==='approved').length,done:stays.filter(reviewedStop).length,recovery:stays.some(s=>s.presence_evidence?.recovery_parts?.length),gaps:gaps??routeAmounts(track).unknown.length,missingTrack,conflicts:stays.filter(s=>presenceRoadConflicts(s,track).length).length});
export function createJournalTrips(ctx){
 let view=null,token=0;
 async function list(offset=0,vehicleId=''){
  if(!['admin','logist'].includes(ctx.role()))return [];
  const bounds=calendarPeriodBounds(ctx.period());let query=ctx.db().from('trips').select('id,vehicle_id,started_at,finished_at,status,owner_id,curator_id,fact_km').is('deleted_at',null).not('started_at','is',null).lt('started_at',bounds.until).or('finished_at.is.null,finished_at.gte.'+bounds.from).order('started_at',{ascending:false});if(vehicleId)query=query.eq('vehicle_id',vehicleId);
  const trips=(result(await query.range(offset,offset+499))||[]).filter(t=>t.started_at<bounds.until&&(!t.finished_at||t.finished_at>=bounds.from));
  if(!trips.length)return [];
  const batches=[];for(let i=0;i<trips.length;i+=100)batches.push(trips.slice(i,i+100).map(t=>t.id));
  const summaries=await Promise.all(batches.map(async ids=>Promise.all([ctx.db().from('trip_stays').select('trip_id,status,presence_evidence,stay_from,stay_to,recovery_acceptance').in('trip_id',ids).then(result),ctx.db().from('trip_tracks').select('trip_id,gps:data->trackKm,road:data->roadKm,line:data->lineKm,weak:data->weakChecks,motion:data->presence->motion_intervals').in('trip_id',ids).then(result)])));
  const stops=summaries.flatMap(s=>s[0]||[]),tracks=summaries.flatMap(s=>s[1]||[]);
  return trips.map(t=>{const stays=(stops||[]).filter(s=>s.trip_id===t.id),saved=(tracks||[]).find(s=>s.trip_id===t.id),track=saved?.data?saved:{trackKm:saved?.gps,roadKm:saved?.road,presence:{motion_intervals:saved?.motion||[]}};return {...t,amounts:routeAmounts(track),review:reviewFor(stays,track,{gaps:Number(saved?.weak??saved?.data?.weakChecks??0)||routeAmounts(track).unknown.length||Number(saved?.line??saved?.data?.lineKm??0)>0,missingTrack:!saved||routeAmounts(track).gps==null})};});
 }
 function destroy(){token++;view?.destroy();view=null;}
 async function read(id){
  let response=await ctx.db().rpc('trip_journal_read',{p_trip:id});
  if(['PGRST202','42883'].includes(response.error?.code))response=await ctx.db().rpc('trip_workbench_read',{p_trip:id});
  if(!response.error)return response.data;
  // The reader path uses existing table RLS; no service role or client-side grant.
  const [trip,stays,links]=await Promise.all([ctx.db().from('trips').select('*').eq('id',id).is('deleted_at',null).maybeSingle().then(result),ctx.db().from('trip_stays').select('*').eq('trip_id',id).order('stay_from').then(result),ctx.db().from('trip_jobs').select('job_id').eq('trip_id',id).then(result)]);
  if(!trip)throw response.error;return {trip,stays,job_ids:(links||[]).map(l=>l.job_id),removed:[],history:[],reader:true};
 }
 async function mount(root,entry,{back,changed,stopId=null,jobId=null,roadId=null,pane:initialPane='stops'}={}){
  destroy();const version=token,uid=ctx.userId(),id=entry.id;
  let routeMap,roadView,overviewMap,overviewObserver,review,timelineView,pane=initialPane,selected=stopId;
  root.dataset.journalTrip=id;root.classList.add('journal-trip-detail');root.innerHTML='<p role="status">Загружаем поездку и остановки…</p>';
  const current=()=>uid===ctx.userId()&&version===token&&root.isConnected;
  const [workbench,trackResponse,linksResponse]=await Promise.all([read(id),ctx.db().from('trip_tracks').select('data,km,updated_at').eq('trip_id',id).maybeSingle(),ctx.db().from('trip_service_orders').select('order_id,service_orders(id,number,title,job_id,status)').eq('trip_id',id)]);if(!current())return;
  if(workbench.trip.id!==id)throw Error('Ответ относится к другому выезду. Обновите журнал.');
  const track=trackResponse.error?null:ctx.readTrack?await ctx.readTrack(workbench.trip,trackResponse.data):trackResponse.data,ids=(workbench.stays||[]).map(s=>s.id);if(!current())return;
  const [allocations,jobs]=await Promise.all([(async()=>{const batches=[];for(let i=0;i<ids.length;i+=100)batches.push(ids.slice(i,i+100));return (await Promise.all(batches.map(async batch=>{const response=await ctx.db().from('trip_stay_task_allocations').select('stay_id,service_order_id,share').in('stay_id',batch);if(response.error&&!workbench.reader)throw response.error;return response.data||[];}))).flat();})(),ctx.jobs([...new Set([...(workbench.job_ids||[]),...(workbench.stays||[]).map(s=>s.job_id),...(workbench.removed||[]).map(r=>r.job_id)].filter(Boolean))])]);if(!current())return;
  const byStay=new Map();for(const allocation of allocations){if(!byStay.has(allocation.stay_id))byStay.set(allocation.stay_id,[]);byStay.get(allocation.stay_id).push({order_id:allocation.service_order_id,share:Number(allocation.share)});}
  const orders=(linksResponse.data||[]).map(l=>l.service_orders).filter(Boolean),data={...workbench,jobIds:workbench.job_ids||[],removed:workbench.removed||[],history:workbench.history||[],stays:(workbench.stays||[]).map(s=>({...s,task_allocations:byStay.get(s.id)||[]}))};
  const editable=!workbench.reader&&ctx.canEdit(data.trip),amounts=routeAmounts(track),vehicle=ctx.vehicles().find(v=>v.id===data.trip.vehicle_id),name=vehicle?.plate||vehicle?.name||vehicle?.model||'Поездка';
  root.innerHTML='<header class="journal-trip-head"><button type="button" class="btn ghost gps-back" data-ut-back>← К журналу</button><div><h2>GPS-запись №'+esc(workbench.trip?.number!=null?String(workbench.trip.number):String(entry.recordNumber||id).slice(0,8))+'</h2><p>'+esc(name)+' · '+intervalText(data.trip.started_at,data.trip.finished_at)+'</p></div><div class="journal-trip-tabs seg" role="group" aria-label="Разделы GPS-записи"><button type="button" data-journal-pane="stops">Обзор</button><button type="button" data-journal-pane="documents">Данные</button></div></header><div class="journal-timeline-host">'+timelineHTML(data.trip,track,data.stays)+'</div><section class="journal-trip-overview"><div class="journal-overview-map"></div><div class="journal-mileage"><span>GPS <b>'+kmText(amounts.gps)+'</b></span><span>Восстановлено <b>'+kmText(amounts.restored)+'</b></span><span>Всего <b>'+kmText(amounts.total)+'</b></span></div><button type="button" class="btn ghost" data-overview-documents>Оформление · связано с выездом →</button></section><section class="journal-trip-stops"></section><section class="journal-trip-route" hidden></section><section class="entity-activity journal-gps-activity"></section><section class="journal-trip-documents" hidden><h2>Данные GPS-записи</h2><p>Связана с выездом. Привязка не подтверждает посещения и выполнение заданий.</p><button class="btn" data-journal-open-trip>Открыть карточку выезда</button><div class="journal-history">'+(data.history_deferred?'':historyHTML(data,ctx.people()))+'</div></section><p class="journal-trip-message" role="status"></p>';
  const tripHead=root.querySelector('.journal-trip-head');
  frameGpsRecordHead(tripHead,{back,linkLabel:tripLabel(data.trip,id),linkHref:'#/trip/'+encodeURIComponent(id),openLink:()=>ctx.openTrip(id),source:vehicle?.wialon_id?'Wialon · '+vehicle.wialon_id:'GPS приложения',status:'Связана с выездом'});
  const overviewBox=root.querySelector('.journal-overview-map');
  const display=root.ownerDocument.createElement('div');display.className='seg journal-overview-modes';display.setAttribute('role','group');display.setAttribute('aria-label','Вид обзора');
  display.innerHTML='<button type="button" data-journal-overview-mode="list">Список</button><button type="button" data-journal-overview-mode="map">Карта</button>';
  tripHead.after(display);
  const win=root.ownerDocument.defaultView;
  const preference='dlight-journal-overview-mode';
  let mode='list';
  try{if(win.sessionStorage.getItem(preference)==='map')mode='map';}catch{/* The current screen remains usable when storage is unavailable. */}
  function selectOverviewMode(value){
   mode=value;root.dataset.journalMapMode=mode;
   display.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.journalOverviewMode===mode)));
   try{win.sessionStorage.setItem(preference,mode);}catch{/* Preserve the current selection in memory. */}
  }
  display.querySelectorAll('button').forEach(button=>button.onclick=()=>selectOverviewMode(button.dataset.journalOverviewMode));
  selectOverviewMode(mode);
  const documentsButton=root.querySelector('[data-overview-documents]');documentsButton.innerHTML=icon('file')+'<span>Данные GPS-записи</span>'+icon('chevron');
  const host=root.querySelector('.journal-trip-stops');host.innerHTML=presenceHTML(data,jobs,ctx.people(),{readonly:!editable,orders,workspace:true});wirePresenceRecovery(host);
  const message=root.querySelector('.journal-trip-message');
  const actions=root.ownerDocument.createElement('section');actions.className='journal-gps-actions';
  root.querySelector('.journal-gps-activity').before(actions);
  const noWorkDone=['finished','done'].includes(data.trip.status);
  if(noWorkDone&&ctx.prompt){
   const noWork=root.ownerDocument.createElement('section');noWork.className='journal-no-work';
   actions.append(noWork);
   void (async()=>{
    try{
     const response=await ctx.db().from('trip_gps_no_work').select('reason,trip_revision')
      .eq('trip_id',id).eq('trip_revision',data.trip.workbench_revision).maybeSingle();
     if(!current())return;
     if(response.error)throw response.error;
     const recorded=response.data;
     if(recorded)noWork.innerHTML='<p><strong>Работы не выполнялись</strong> · 0 чел·ч</p><p>'+esc(recorded.reason)+'</p>';
     if(!editable||(!recorded&&data.stays.some(stay=>stay.status==='approved')))return;
     const button=root.ownerDocument.createElement('button');button.type='button';button.className='btn ghost';
     button.textContent=recorded?'Отменить отметку':'Подтвердить, что работы не выполнялись';
     noWork.append(button);
     button.onclick=async()=>{
      if(saving||pendingSave||review?.isDirty()){
       message.textContent='Сначала сохраните или снимите выбранные решения по посещениям.';return;
      }
      button.disabled=true;
      try{
       const answer=await ctx.prompt(button.textContent,
        [{key:'reason',label:'Основание',type:'textarea',required:true}],{okText:'Подтвердить'});
       if(!answer||!current())return;
       const result=await ctx.db().rpc('trip_gps_no_work_save',{
        p_trip:id,p_expected:data.trip.workbench_revision,p_reason:answer.reason,p_confirmed:!recorded
       });
       if(result.error)throw result.error;
       if(current())await remount(recorded?'Отметка снята.':'Отсутствие работ подтверждено.');
      }catch(error){if(current())message.textContent=error.message;}
      finally{if(button.isConnected)button.disabled=false;}
     };
    }catch(error){if(current())noWork.textContent='Отметка о работах недоступна: '+error.message;}
   })();
  }
  const candidateJobs=jobs.filter(job=>data.jobIds.includes(job.id));
  const canConfirmManual=editable&&ctx.prompt&&candidateJobs.length&&['in_progress','finished','done'].includes(data.trip.status);
  const manualDrafts=root.ownerDocument.createElement('section');actions.prepend(manualDrafts);
  if(editable||['admin','logist'].includes(ctx.role())){
   void (async()=>{
    try{
     const drafts=result(await ctx.db().from('gps_manual_visit_drafts').select(manualDraftFields)
      .eq('trip_id',id).is('confirmed_at',null).order('stay_from'))||[];
     if(!current())return;
     renderManualVisitDrafts(manualDrafts,drafts,{
      onConfirm:canConfirmManual?(draft,button)=>confirmManual(button,draft):null
     });
     if(editable&&drafts.length&&!candidateJobs.length){
      const hint=root.ownerDocument.createElement('p');hint.className='hint';
      hint.textContent='Для подтверждения в выезде нужна связанная заявка.';manualDrafts.append(hint);
     }
    }catch(error){if(current())manualDrafts.textContent='Не удалось загрузить ручные посещения: '+error.message;}
   })();
  }
  let manualInput={},manualOperation=null,manualBusy=false;
  async function confirmManual(button,prepared){
   if(manualBusy)return;
   if(saving||pendingSave||review?.isDirty()){
    message.textContent='Сначала сохраните выбранные решения по остановкам.';return;
   }
   manualBusy=true;button.disabled=true;
   try{
    let fields=manualVisitPartyFields(candidateJobs,ctx.people(),prepared?{
     job:prepared.job_id,crew:prepared.crew_ids
    }:{job:manualInput.job,crew:manualInput.crew||data.trip.engineer_ids||[]});
    if(!prepared)fields=[
     fields[0],
     {key:'from',label:'Начало',type:'datetime-local',required:true,value:manualInput.from},
     {key:'to',label:'Окончание',type:'datetime-local',required:true,value:manualInput.to},
     fields[1],
     {key:'reason',label:'Основание ручного учёта',type:'textarea',required:true,value:manualInput.reason}
    ];
    const title=prepared?'Проверить посещение · '+intervalText(prepared.stay_from,prepared.stay_to):'Посещение без GPS · время по Киеву';
    const values=await ctx.prompt(title,fields,{okText:'Подтвердить посещение'});
    if(!values||!current())return;
    const args={p_trip:id,p_expected:data.trip.workbench_revision,p_job:values.job,p_crew:values.crew};
    if(!prepared&&JSON.stringify(values)!==JSON.stringify(manualInput)){
     manualInput=values;manualOperation=crypto.randomUUID();
    }
    const answer=prepared?await ctx.db().rpc('gps_manual_visit_draft_confirm',{
     ...args,p_draft:prepared.id,p_draft_revision:prepared.revision
    }):await ctx.db().rpc('gps_record_manual_visit',{
     ...args,p_operation:manualOperation,p_from:values.from,p_to:values.to,p_reason:values.reason
    });
    if(answer.error)throw answer.error;
    await ctx.afterManualVisit?.(data.trip,answer.data);
    if(current())await remount('Ручное посещение подтверждено.');
   }catch(error){if(current())message.textContent=error.message;}
   finally{manualBusy=false;if(button.isConnected)button.disabled=false;}
  }
  if(canConfirmManual){
   const button=root.ownerDocument.createElement('button');button.type='button';button.className='btn ghost';
   button.textContent='Добавить посещение без GPS';button.onclick=()=>confirmManual(button);
   actions.append(button);
  }
  const notify=()=>ctx.onNavigate?.({tripId:id,pane,stopId:pane==='stops'?selected:null,...(pane==='route'&&selected?{returnStopId:selected}:{}),...(pane==='route'&&roadId?{roadId}:{})});
  review=mountPresenceReview(host,data,{jobs,profiles:ctx.people(),readonly:!editable,leaflet:ctx.leaflet,makeBase:ctx.makeTrackBase,owner:uid,initialMode:'all',onJobChange:(row,job)=>ctx.renderAllocations(row,job,orders),track,onRoute:()=>switchPane('route'),onSelect:stayId=>{selected=stayId;updateSelection();notify();},onBack:()=>{selected=null;updateSelection();notify();},onConfirmVisits:editable?confirmVisits:null,onPin:stay=>readerAction('pin',stay),onReaderAction:ctx.role()==='engineer'?readerAction:null});
  if(['admin','logist'].includes(ctx.role())){
   const prelinked=root.ownerDocument.createElement('section');actions.prepend(prelinked);
   void (async()=>{
    try{
     const drafts=result(await ctx.db().from('gps_record_stop_drafts').select('stops,source_current').eq('trip_id',id))||[];
     if(current())mountLinkedStopDrafts(prelinked,drafts,data.stays,(stayId,decision)=>review?.openSourceDecision(stayId,decision));
    }catch(error){if(current())prelinked.textContent='Выбор до привязки недоступен: '+error.message;}
   })();
  }
  async function confirmVisits(stays){
   if(!current()||saving||pendingSave||!stays.length)return;
   saving=true;host.inert=true;
   try{
    const revision=await ctx.save(data.trip,stays,'Посещение подтверждено · Пакетная сверка GPS');
    if(!current())return;
    review.clearSaved(stays.map(stay=>stay.id));
    const savedIds=new Set(stays.map(stay=>stay.id));
    const nextStays=data.stays.map(stay=>savedIds.has(stay.id)?{...stay,status:'approved'}:stay);
    changed?.(id,{__review:reviewFor(nextStays,track,{gaps:entry.review?.gaps,missingTrack:entry.review?.missingTrack})});
    data.trip.workbench_revision=revision;
    await remount('Подтверждено посещений: '+stays.length+'.');
   }finally{saving=false;host.inert=false;}
  }
  function updateSelection(){const stopOpen=pane==='stops'&&!!selected&&typeof root.ownerDocument.defaultView.matchMedia!=='function';const modes=root.querySelector('.journal-list-modes');if(modes){modes.hidden=pane==='documents'||stopOpen;modes.querySelectorAll('button').forEach(b=>{const on=b.dataset.journalListMode===pane;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});}actions.hidden=pane!=='stops'||stopOpen;discussion.hidden=actions.hidden;root.classList.toggle('journal-stop-open',stopOpen);display.hidden=pane!=='stops'||stopOpen;root.querySelector('.journal-trip-overview').hidden=pane!=='stops'||stopOpen;documentsButton.hidden=pane!=='stops'||stopOpen;(root.closest('.unified-gps-journal')||root).querySelectorAll('[data-journal-stop]').forEach(b=>b.classList.toggle('is-selected',b.dataset.journalStop===selected));const timeline=root.querySelector('.journal-timeline-host'),routeBox=pane==='route'&&root.ownerDocument.defaultView.matchMedia('(min-width:1101px)').matches&&root.querySelector('.journal-trip-route>.journal-route-map'),floating=pane==='stops'&&!stopOpen||!!routeBox;if(routeBox)routeBox.after(timeline);else if(floating)root.querySelector('.journal-overview-map').after(timeline);else root.querySelector('.journal-trip-head').after(timeline);floatJournalTimeline(timeline,floating);routeMap?.select(selected);overviewMap?.select(selected);if(floating)(routeBox?routeMap:overviewMap)?.fitRoute?.();}
  if(['admin','logist'].includes(ctx.role())){
   const extra=root.ownerDocument.createElement('section');
   extra.className='journal-source-choices';
   root.querySelector('.journal-trip-documents').prepend(extra);
   void (async()=>{
    try{
     const linked=result(await ctx.db().from('unassigned_tracks')
      .select('id,started_at,ended_at,resolution').eq('trip_id',id).eq('state','linked').order('started_at'))||[];
     const records=linked.filter(record=>record.resolution?.link_mode==='supplement');
     if(!current()||!records.length)return;
     extra.innerHTML='<h3>Дополнительные GPS-записи</h3><ul class="gps-source-stops">'+records.map(record=>
      '<li class="gps-source-stop"><div><strong>'+esc(intervalText(record.started_at,record.ended_at))+
      '</strong></div><a class="btn ghost" href="#/journal/record/'+encodeURIComponent(record.id)+'">'+esc('Запись №'+record.id.slice(0,8))+'</a></li>').join('')+'</ul>';
    }catch(error){if(current())extra.textContent='Не удалось загрузить дополнительные GPS-записи: '+error.message;}
   })();
  }
  if(['admin','logist'].includes(ctx.role())){
   const roadDrafts=root.ownerDocument.createElement('section');
   root.querySelector('.journal-trip-documents').prepend(roadDrafts);
   void (async()=>{
    try{
     const drafts=result(await ctx.db().from('gps_road_cut_drafts').select('cuts,source_current,supplemental')
      .eq('trip_id',id))||[];
     if(!current()||!drafts.some(draft=>draft.cuts?.length))return;
     roadDrafts.innerHTML='<h3>Разделения дороги из GPS-записей</h3><ul class="gps-source-stops"></ul><p class="hint" role="status"></p>';
     const list=roadDrafts.querySelector('ul'),feedback=roadDrafts.querySelector('[role=status]');
     const format=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',dateStyle:'medium',timeStyle:'short'});
     for(const draft of drafts)for(const cut of draft.cuts){
      const row=root.ownerDocument.createElement('li');row.className='gps-source-stop';
      const label=root.ownerDocument.createElement('strong');label.textContent=format.format(Number(cut)*1000);row.append(label);
      if(editable&&draft.source_current&&!draft.supplemental){
       const button=root.ownerDocument.createElement('button');button.type='button';button.className='btn ghost';
       button.textContent='Проверить разделение';button.onclick=async()=>{
        if(!trackResponse.data?.data?.segments?.length){
         feedback.textContent='Сначала откройте карту и проверьте основной трек выезда.';return;
        }
        button.disabled=true;feedback.textContent='';switchPane('route');
        try{await roadView.prepareCut(Number(cut));}
        catch(error){if(current()&&pane==='route'){switchPane('documents');feedback.textContent=error.message;button.focus();}}
        finally{if(button.isConnected)button.disabled=false;}
       };row.append(button);
      }else{
       const hint=root.ownerDocument.createElement('span');hint.className='hint';
       hint.textContent=draft.supplemental?'Дополнительная GPS-запись':!draft.source_current?'GPS изменился · нужна повторная сверка':'Подготовлено до привязки';row.append(hint);
      }
      list.append(row);
     }
    }catch(error){if(current())roadDrafts.textContent='Не удалось загрузить разделения дороги: '+error.message;}
   })();
  }
  const discussion=root.querySelector('.journal-gps-activity');
  const activity=mountEntityActivity({root:discussion,db:ctx.db(),entity:'gpsTrip',id,userId:ctx.userId,people:ctx.people});
  let historyLoaded=!data.history_deferred,historyLoading=false;
  async function loadHistory(){if(historyLoaded||historyLoading)return;historyLoading=true;const box=root.querySelector('.journal-history');box.innerHTML='<p role="status">Загружаем историю изменений…</p>';try{const response=await ctx.db().rpc('trip_workbench_read',{p_trip:id});if(response.error)throw response.error;if(!current())return;box.innerHTML=historyHTML({...data,history:response.data.history||[]},ctx.people());historyLoaded=true;}catch(error){if(current()){box.innerHTML='<p class="err" role="alert">Не удалось загрузить историю: '+esc(error.message)+'</p><button class="btn ghost" data-history-retry>Повторить</button>';box.querySelector('button').onclick=loadHistory;}}finally{historyLoading=false;}}
  function mountRoute(){
   const section=root.querySelector('.journal-trip-route'),floatingTimeline=section.querySelector(':scope>.journal-timeline-host');
   if(floatingTimeline)root.querySelector('.journal-trip-head').after(floatingTimeline);
   routeMap=mountJournalRoute(section,{trip:data.trip,track,stays:data.stays,jobs,leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,canEdit:editable,onRebuild:rebuild,selectedStopId:selected,onStop:stayId=>{selected=stayId;switchPane('stops',false);review?.select(stayId);}});
   if(!trackResponse.data?.data?.segments?.length&&!roadId)return;
   const roads=root.ownerDocument.createElement('section');roads.className='journal-road-sections';
   section.querySelector('.journal-route-metrics').before(roads);
   roadView=mountRoadSections(roads,{db:ctx.db,tripId:id,current,focus:routeMap.focusRoad,onSplitPoint:routeMap.markRoadCut,
    splitHost:section.querySelector('.journal-route-map')});
   if(roadId)roadView.open(roadId);
   void roadView.load();
  }
  function switchPane(next,updateUrl=true){if(!current())return;pane=next;root.dataset.journalSection=next;if(next==='documents')void loadHistory();root.classList.toggle('journal-route-open',next==='route');root.closest('.unified-gps-journal')?.classList.toggle('journal-map-expanded',next==='route');for(const key of ['stops','route','documents'])root.querySelector('.journal-trip-'+key).hidden=key!==next;root.querySelector('.journal-trip-overview').hidden=next!=='stops'||!!selected;root.querySelectorAll('[data-journal-pane]').forEach(b=>{b.classList.toggle('on',b.dataset.journalPane===(next==='route'?'stops':next));b.setAttribute('aria-pressed',String(b.dataset.journalPane===(next==='route'?'stops':next)));});root.querySelector('[data-ut-back]').setAttribute('aria-label',next==='route'?(selected?'К остановке':'К поездке'):'К журналу');if(next==='route'&&!routeMap)mountRoute();updateSelection();if(updateUrl)notify();}
  const listModes=root.ownerDocument.createElement('div');listModes.className='journal-list-modes seg';listModes.setAttribute('role','group');listModes.setAttribute('aria-label','Состав GPS-записи');
  listModes.innerHTML='<button type="button" data-journal-list-mode="stops">Стоянки</button><button type="button" data-journal-list-mode="route">Дорога</button>';
  root.querySelector('.journal-trip-stops').before(listModes);
  listModes.querySelectorAll('button').forEach(b=>b.onclick=()=>switchPane(b.dataset.journalListMode));
  root.querySelectorAll('[data-journal-pane]').forEach(b=>b.onclick=()=>switchPane(b.dataset.journalPane));root.querySelector('[data-overview-documents]').onclick=()=>switchPane('documents');root.querySelector('[data-ut-back]').onclick=()=>pane==='route'?switchPane('stops'):back?.();root.querySelector('[data-journal-open-trip]').onclick=()=>ctx.openTrip(id);
  root.querySelectorAll('[data-journal-stop]').forEach(b=>b.onclick=()=>{switchPane('stops',false);review?.select(b.dataset.journalStop);});
  root.querySelector('.journal-trip-overview').append(documentsButton);
  const mountOverview=()=>{if(!current()||overviewMap)return;overviewMap=mountJournalRoute(overviewBox,{trip:data.trip,track,stays:data.stays,jobs,leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,mini:true,selectedStopId:selected,onExpand:()=>ctx.showTripMap?ctx.showTripMap(data.trip.id):switchPane('route'),onStop:stayId=>review?.select(stayId)});};
  const Observer=root.ownerDocument.defaultView.IntersectionObserver;
  if(Observer){overviewObserver=new Observer(entries=>{if(entries.some(e=>e.isIntersecting)){mountOverview();overviewObserver.disconnect();}});overviewObserver.observe(overviewBox);}else mountOverview();
  async function readerAction(action,stay,jobId){try{if(!current()||(!editable&&ctx.role()!=='engineer')||(!editable&&stay.status==='approved'))return;if(action==='pin'&&!await ctx.confirm('Записать координату остановки в карточку объекта? Точка сместится на '+stay.dist_m+' м.',{okText:'Записать'}))return;const answer=await ctx.db().rpc(action==='pin'?'stay_pin_point':'stay_attach',action==='pin'?{p_stay:stay.id}:{p_stay:stay.id,p_job:jobId||null});if(answer.error)throw answer.error;if(['too_far','no_job','foreign_job','already_approved'].includes(answer.data))throw Error({too_far:'Точка слишком далеко: доступен сдвиг не больше 1 км.',no_job:'Сначала выберите заявку.',foreign_job:'Эта заявка не входит в выезд.',already_approved:'Остановка уже утверждена. Обновите поездку.'}[answer.data]);if(current())await remount('Изменение сохранено. Посещение остаётся на проверке.');}catch(e){if(current()){message.classList.add('is-error');message.textContent=e.message;}}}
  async function remount(text){try{await mount(root,entry,{back,changed,stopId:selected,pane});if(uid===ctx.userId()&&root.dataset.journalTrip===id)root.querySelector('.journal-trip-message').textContent=text;}catch(error){if(uid!==ctx.userId()||!root.isConnected||root.dataset.journalTrip!==id)return;root.innerHTML='<p role="status">'+esc(text)+'</p><p class="err" role="alert">Не удалось обновить данные: '+esc(error.message)+'</p><button class="btn" data-journal-retry>Повторить загрузку</button><button class="btn ghost gps-back" data-ut-back>← К журналу</button>';root.querySelector('[data-journal-retry]').onclick=()=>remount(text);root.querySelector('[data-ut-back]').onclick=()=>back?.();}}

  async function rebuild(){if(!current()||!ctx.canEdit(data.trip))return;if(review?.isDirty()){message.textContent='Сохраните решение или черновик перед повторной проверкой трека.';return;}message.textContent='Проверяем GPS и восстанавливаем участки дороги…';message.classList.remove('is-error');try{await ctx.rebuild(id);if(current())await remount('Трек проверен. Сверьте обновлённые предложения остановок.');}catch(e){if(current()){message.classList.add('is-error');message.textContent='Не удалось проверить трек: '+e.message;}}}
  let saving=false,pendingSave=null;
  function paintConflicts(){const timeline=root.querySelector('.journal-timeline-host');timeline.querySelector('[data-presence-conflict]')?.remove();const conflicts=data.stays.filter(s=>presenceRoadConflicts(s,track).length);if(conflicts.length){const warning=root.ownerDocument.createElement('button');warning.dataset.presenceConflict='';warning.className='journal-conflict';warning.textContent='Конфликт времени: дорога пересекается с принятым присутствием · '+conflicts.length+'. Проверить →';warning.onclick=()=>{selected=conflicts[0].id;switchPane('route');};timeline.append(warning);}}
  function refreshTimeline(){const left=timeline.scrollLeft,open=timeline.querySelector('.journal-timeline-stops')?.open;timelineView?.destroy();timeline.innerHTML=timelineHTML(data.trip,track,data.stays);const choices=timeline.querySelector('.journal-timeline-stops');if(choices)choices.open=!!open;timeline.querySelectorAll('[data-journal-stop]').forEach(b=>b.onclick=()=>{switchPane('stops',false);review?.select(b.dataset.journalStop);});timelineView=wireJournalTimeline(timeline);floatJournalTimeline(timeline,timeline.classList.contains('journal-timeline-floating'));timeline.scrollLeft=left;paintConflicts();}
  async function refreshSaved(){
   const pending=pendingSave;if(!pending||!current())return;
   const [saved,allocations]=await Promise.all([ctx.db().from('trip_stays').select('*').eq('trip_id',id).eq('id',pending.stay.id).maybeSingle().then(result),ctx.db().from('trip_stay_task_allocations').select('stay_id,service_order_id,share').in('stay_id',[pending.stay.id]).then(result)]);
   if(!current())return;if(!saved||saved.id!==pending.stay.id||saved.trip_id!==id)throw Error('Не удалось прочитать сохранённую остановку.');
   const canonical={...saved,task_allocations:(allocations||[]).map(a=>({order_id:a.service_order_id,share:Number(a.share)}))};
   // Advance only to the revision returned by our write, never a later revision
   // read in the background. Concurrent changes will still reject the next save.
   data.trip.workbench_revision=pending.revision;review?.markSaved(canonical);pendingSave=null;
   historyLoaded=false;data.history_deferred=true;routeMap?.refreshPresence();overviewMap?.refreshPresence();void roadView?.load();refreshTimeline();updateSelection();
   changed?.(id,{...canonical,__previousStatus:pending.previous,__review:reviewFor(data.stays,track)});
   root.querySelector('[data-journal-save-refresh]')?.remove();root.querySelector('[data-journal-save-error]')?.remove();message.classList.remove('is-error');message.textContent='Решение сохранено.';if(pane==='documents')void loadHistory();
  }
  function refreshFailure(error){message.classList.remove('is-error');message.textContent='Решение сохранено.';let alert=root.querySelector('[data-journal-save-error]');if(!alert){alert=root.ownerDocument.createElement('p');alert.dataset.journalSaveError='';alert.className='err';alert.setAttribute('role','alert');message.after(alert);}alert.textContent='Не удалось обновить решение: '+error.message;let retry=root.querySelector('[data-journal-save-refresh]');if(!retry){retry=root.ownerDocument.createElement('button');retry.type='button';retry.className='btn ghost';retry.dataset.journalSaveRefresh='';retry.textContent='Обновить решение';alert.after(retry);retry.onclick=async()=>{retry.disabled=true;try{await refreshSaved();}catch(e){if(current()){refreshFailure(e);retry.disabled=false;}}};}}
  const save=host.querySelector('[data-presence-save]');if(save)save.onclick=async()=>{
   if(!current()||saving||!ctx.canEdit(data.trip))return;if(pendingSave){message.textContent='Решение уже сохранено. Нажмите «Обновить решение» перед следующей записью.';return;}
   const stay=readPresenceForm(host,data.stays,host.dataset.reviewActive)[0];let written=false;
   try{if(!stay||!['approved','rejected'].includes(stay.status))throw Error('Для учёта времени выберите подтверждение присутствия.');if(review&&!review.allowsSave(stay))throw Error('Подтвердите сохранение посещения без учёта времени.');if(stay.status==='rejected')stay.task_allocations=[];validatePresence([stay]);if(presenceRoadConflicts(stay,track).length)throw Error('Присутствие пересекается с движением. Проверьте интервалы на маршруте.');if(stay.status==='approved'&&(stay.task_allocations||[]).reduce((n,a)=>n+a.share,0)>1.000001)throw Error('Сумма долей превышает 100%.');saving=true;host.inert=true;save.disabled=true;message.classList.remove('is-error');message.textContent='Сохраняем решение…';const previous=data.stays.find(s=>s.id===stay.id)?.status,revision=await ctx.save(data.trip,stay,host.querySelector('.journal-review-note')?.value);written=true;
    if(current()){if(!Number.isInteger(revision)||revision<=data.trip.workbench_revision)throw Error('Сервер не вернул версию сохранённого решения. Обновите поездку.');pendingSave={stay,previous,revision};await refreshSaved();}
   }catch(e){if(current()){if(written){if(pendingSave)refreshFailure(e);else{message.classList.add('is-error');message.textContent='Решение сохранено. '+e.message;}}else{message.classList.add('is-error');message.textContent=e.message;save.disabled=false;}}}finally{saving=false;host.inert=false;}
  };
  if(trackResponse.error)message.textContent='Трек недоступен для этой роли. Доступные остановки можно просматривать.';
  paintConflicts();
  view={navigate(state){if(state.jobId&&editable&&data.jobIds.includes(state.jobId)){const field=host.querySelector('[data-presence-id="'+state.stopId+'"] [data-presence=job_id]');if(field){field.value=state.jobId;field.dispatchEvent(new root.ownerDocument.defaultView.Event('change',{bubbles:true}));}}if(state.stopId){selected=state.stopId;review?.select(selected,true,false);}else{selected=null;review?.back(false);}const previousRoad=roadView;switchPane(state.pane||'stops',false);if(state.roadId){roadView?.open(state.roadId);if(previousRoad)void previousRoad.load();}updateSelection();},discard:()=>review?.discard(),isDirty:()=>review?.isDirty(),destroy(){activity?.destroy();delete root.dataset.journalSection;delete root.dataset.journalMapMode;overviewObserver?.disconnect();timelineView?.destroy();routeMap?.destroy();overviewMap?.destroy();review?.destroy();root.closest('.unified-gps-journal')?.querySelector('[data-journal-shared-timeline]')?.replaceChildren();root.closest('.unified-gps-journal')?.classList.remove('journal-map-expanded');root.classList.remove('journal-trip-detail','journal-stop-open','journal-route-open');}};
  const timeline=root.querySelector('.journal-timeline-host');timelineView=wireJournalTimeline(timeline);
  if(selected)review?.select(selected,true,false);if(editable&&jobId&&data.jobIds.includes(jobId)){const row=host.querySelector('[data-presence-id="'+selected+'"]'),field=row?.querySelector('[data-presence=job_id]');if(field){field.value=jobId;field.dispatchEvent(new root.ownerDocument.defaultView.Event('change',{bubbles:true}));host.querySelector('[data-presence-kind=visit]')?.click();}}switchPane(pane,false);updateSelection();
 }
 return {list,mount,destroy,navigate:state=>view?.navigate(state),discard(){view?.discard();destroy();},isDirty:()=>view?.isDirty()};
}

