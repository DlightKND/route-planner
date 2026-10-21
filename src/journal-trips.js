import {calendarPeriodBounds} from './core/calendar-period.js';
import {presenceHTML,readPresenceForm,wirePresenceRecovery} from './trip-workbench.js';
import {mountPresenceReview} from './presence-review-workspace.js';
import {validatePresence} from './core/trip-review.js';
import {presenceRoadConflicts,reviewedStop,routeAmounts} from './core/gps-journal.js';
import {mountJournalRoute,timelineHTML} from './journal-route.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Запись продолжается';
const result=({data,error})=>{if(error)throw error;return data;};
export function createJournalTrips(ctx){
 let view=null,token=0;
 async function list(offset=0){
  // Journal management retains its existing admin/logist scope. Table reads
  // and every decision RPC still run with the signed-in user's RLS policies.
  if(!['admin','logist'].includes(ctx.role()))return [];
  const bounds=calendarPeriodBounds(ctx.period());
  const page=result(await ctx.db().from('trips').select('id,vehicle_id,started_at,finished_at,status,owner_id,curator_id,fact_km').is('deleted_at',null).not('started_at','is',null).lt('started_at',bounds.until).or('finished_at.is.null,finished_at.gte.'+bounds.from).order('started_at',{ascending:false}).range(offset,offset+49))||[];
  const trips=page.filter(t=>t.started_at<bounds.until&&(!t.finished_at||t.finished_at>=bounds.from));
  const summaries=trips.length?result(await ctx.db().from('trip_stays').select('trip_id,status,presence_evidence').in('trip_id',trips.map(t=>t.id))):[];
  return trips.map(t=>{const stops=(summaries||[]).filter(s=>s.trip_id===t.id);return {...t,review:{total:stops.length,done:stops.filter(reviewedStop).length,recovery:stops.some(s=>s.presence_evidence?.recovery_parts?.length)}};});
 }
 function destroy(){token++;view?.destroy();view=null;}
 async function mount(root,entry,{back,changed}){
  destroy();const version=token,uid=ctx.userId();
  const id=entry.id;root.dataset.journalTrip=id;let routeMap,review;root.classList.add('journal-trip-detail');
  root.innerHTML='<p role="status">Загружаем поездку и остановки…</p>';
  const current=()=>uid===ctx.userId()&&version===token&&root.isConnected;
  const [workbench,track,links]=await Promise.all([
   ctx.db().rpc('trip_workbench_read',{p_trip:id}).then(result),
   ctx.db().from('trip_tracks').select('data,km,updated_at').eq('trip_id',id).maybeSingle().then(result),
   ctx.db().from('trip_service_orders').select('order_id,service_orders(id,number,title,job_id,status)').eq('trip_id',id).then(result)
  ]);if(!current())return;
  if(workbench.trip.id!==id)throw Error('Ответ относится к другому выезду. Обновите журнал.');
  const ids=(workbench.stays||[]).map(s=>s.id),allocations=ids.length?result(await ctx.db().from('trip_stay_task_allocations').select('stay_id,service_order_id,share').in('stay_id',ids)):[];
  const jobs=await ctx.jobs();if(!current())return;
  const orders=(links||[]).map(l=>l.service_orders).filter(Boolean);
  const data={...workbench,jobIds:workbench.job_ids||[],removed:workbench.removed||[],stays:(workbench.stays||[]).map(s=>({...s,task_allocations:(allocations||[]).filter(a=>a.stay_id===s.id).map(a=>({order_id:a.service_order_id,share:Number(a.share)}))}))};
  const editable=ctx.canEdit(data.trip),done=data.stays.filter(reviewedStop).length,amounts=routeAmounts(track);
  const v=ctx.vehicles().find(v=>v.id===data.trip.vehicle_id),name=[v?.plate,v?.name||v?.model].filter(Boolean).join(' · ')||'Поездка';
  root.innerHTML='<button type="button" class="btn ghost gps-back" data-ut-back>← К журналу</button><header class="journal-trip-head"><div><h2>'+esc(name)+'</h2><p>'+when(data.trip.started_at)+' — '+when(data.trip.finished_at)+'</p></div><div class="journal-trip-states"><span class="tag">Связана с выездом</span><span class="tag">Проверено '+done+' из '+data.stays.length+'</span></div></header><div class="journal-trip-tabs seg"><button type="button" data-journal-pane="stops" aria-pressed="true">Разбор остановок</button><button type="button" data-journal-pane="route" aria-pressed="false">Маршрут</button><button type="button" data-journal-pane="documents" aria-pressed="false">Оформление и история</button></div><div class="journal-timeline-host">'+timelineHTML(data.trip,track,data.stays)+'</div><section class="journal-trip-stops"></section><section class="journal-trip-route" hidden></section><section class="journal-trip-documents" hidden><h3>Оформление поездки</h3><p>Связана с выездом '+esc(data.trip.number||id.slice(0,8))+'. Привязка не подтверждает присутствие и выполнение заданий.</p><button type="button" class="btn" data-journal-open-trip>Открыть карточку выезда</button><h3>История решений</h3>'+(data.history||[]).map(h=>'<p>'+when(h.recorded_at)+' · '+esc(h.reason)+'</p>').join('')+'</section><p class="journal-trip-message" role="status"></p>';
  const host=root.querySelector('.journal-trip-stops');host.innerHTML=presenceHTML(data,jobs,ctx.people(),{readonly:!editable,orders,workspace:true}).replaceAll('id="wb','id="journalWb');wirePresenceRecovery(host);
  review=mountPresenceReview(host,data,{jobs,profiles:ctx.people(),readonly:!editable,leaflet:ctx.leaflet,makeBase:ctx.makeTrackBase,owner:uid,initialMode:'all',onJobChange:(row,job)=>ctx.renderAllocations(row,job,orders),track});
  const message=root.querySelector('.journal-trip-message');let pane='stops';
  function switchPane(next){if(!current())return;pane=next;root.querySelector('.journal-trip-stops').hidden=next!=='stops';root.querySelector('.journal-trip-route').hidden=next!=='route';root.querySelector('.journal-trip-documents').hidden=next!=='documents';root.querySelectorAll('[data-journal-pane]').forEach(b=>{b.classList.toggle('on',b.dataset.journalPane===next);b.setAttribute('aria-pressed',String(b.dataset.journalPane===next));});if(next==='route'&&!routeMap)routeMap=mountJournalRoute(root.querySelector('.journal-trip-route'),{trip:data.trip,track,stays:data.stays,leaflet:ctx.leaflet?.(),makeBase:ctx.makeTrackBase,canEdit:editable,onRebuild:rebuild,onStop:stopId=>{switchPane('stops');review?.select(stopId);}});}
  root.querySelectorAll('[data-journal-pane]').forEach(b=>b.onclick=()=>switchPane(b.dataset.journalPane));root.querySelector('[data-ut-back]').onclick=back;root.querySelector('[data-journal-open-trip]').onclick=()=>ctx.openTrip(id);
  root.querySelectorAll('[data-journal-stop]').forEach(b=>b.onclick=()=>{switchPane('stops');review?.select(b.dataset.journalStop);});
  async function rebuild(){
   if(!current()||!ctx.canEdit(data.trip))return;
   if(review?.isDirty()){message.textContent='Сначала сохраните решение по остановке или отмените изменения.';return;}
   message.textContent='Проверяем и достраиваем трек…';
   try{await ctx.rebuild(id);if(current())await mount(root,entry,{back,changed});}catch(e){if(current())message.textContent='Не удалось проверить трек: '+e.message;}
  }
  const detect=host.querySelector('[data-presence-detect]');if(detect)detect.onclick=()=>{switchPane('route');return rebuild();};
  const save=host.querySelector('[data-presence-save]');if(save)save.onclick=async()=>{
   if(!current()||!ctx.canEdit(data.trip))return;
   const stay=readPresenceForm(host,data.stays).find(s=>s.id===host.dataset.reviewActive);
   try{
    if(!stay||!['approved','rejected'].includes(stay.status))throw Error('Выберите решение по остановке.');validatePresence([stay]);
    if(presenceRoadConflicts(stay,track).length)throw Error('Присутствие пересекается с движением. Разберите конфликт в разделе «Маршрут».');
    if((stay.task_allocations||[]).reduce((n,a)=>n+a.share,0)>1.000001)throw Error('Сумма долей превышает 100%.');
    save.disabled=true;message.textContent='Сохраняем решение…';
    await ctx.save(data.trip,stay,host.querySelector('.journal-review-note')?.value);
    if(current()){review?.markSaved();await mount(root,entry,{back,changed});changed?.(id,{...stay,__previousStatus:data.stays.find(s=>s.id===stay.id)?.status});if(uid===ctx.userId()&&root.isConnected&&root.dataset.journalTrip===id)root.querySelector('.journal-trip-message').textContent='Решение сохранено.';}
   }catch(e){if(current()){message.textContent=e.message;save.disabled=false;}}
  };
  const diagnostics=data.stays.flatMap(s=>presenceRoadConflicts(s,track).map(()=>s));if(diagnostics.length){const warning=document.createElement('div');warning.className='journal-conflict';warning.innerHTML='<strong>Есть пересечение дороги и принятого присутствия.</strong><button type="button" class="btn" data-journal-conflict>Разобрать конфликт</button>';root.querySelector('.journal-timeline-host').append(warning);warning.querySelector('button').onclick=()=>{switchPane('stops');review?.select(diagnostics[0].id);};}
  if(amounts.total!=null)root.querySelector('.journal-trip-head p').append(' · '+amounts.total.toLocaleString('ru-RU',{maximumFractionDigits:1})+' км по GPS и дорогам');
  view={destroy(){routeMap?.destroy();review?.destroy();root.classList.remove('journal-trip-detail');},isDirty:()=>review?.isDirty()};switchPane(pane);
 }
 return {list,mount,destroy,isDirty:()=>view?.isDirty()};
}
