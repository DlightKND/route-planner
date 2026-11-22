import {intervalText} from './core/journal-display.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=stay=>`${Date.parse(stay.stay_from)}/${Date.parse(stay.stay_to)}`;
const minutes=stay=>(Date.parse(stay.stay_to)-Date.parse(stay.stay_from))/60000;
const duration=value=>value.toLocaleString('ru',{maximumFractionDigits:1})+' мин';

export function observedSourceStops(parts){
 return parts.flatMap(part=>{
  const stops=[];
  let start=null,last=null;
  function finish(){
   if(start&&last&&Date.parse(last.ts)-Date.parse(start.ts)>=600000){
    const stay={id:'observed-'+start.ts,stay_from:start.ts,stay_to:last.ts,lat:+start.lat,lng:+start.lng,status:'detected'};
    stay.minutes_raw=minutes(stay);
    stops.push(stay);
   }
   start=last=null;
  }
  for(const point of part){
   if(point.status!=='idle'){finish();continue;}
   if(start&&(Math.abs(point.lat-start.lat)>.001||Math.abs(point.lng-start.lng)>.001))finish();
   start??=point;last=point;
  }
  finish();return stops;
 });
}

export function mountSourceStops(root,{stays,source,quote,draft,writable,save,openMap}){
 let prior=draft?.stops||[],revision=draft?.revision??0,writing=false,baseline;
 let stale=!!draft&&(draft.source_revision!==quote.revision||draft.source_points!==quote.points);
 const controls=stays.map((stay,index)=>{
  const id='gps-source-stop-'+index;
  return `<li class="gps-source-stop"><div>
   <strong>Стоянка ${index+1} · ${escape(intervalText(stay.stay_from,stay.stay_to))}</strong>
   <span>${duration(stay.minutes_raw)}</span></div>
   <button type="button" class="btn sm ghost" data-source-location="${index}" aria-label="Стоянка ${index+1} на карте">На карте</button>
   ${writable?`<label for="${id}">Решение<select id="${id}" data-source-choice><option value="">На проверке</option><option value="include">Учесть</option><option value="exclude">Пропустить</option></select></label>
   <label for="${id}-note">Комментарий<input type="text" id="${id}-note" data-source-note maxlength="500" disabled></label>`:''}</li>`;
 }).join('');
 root.innerHTML='<header><h3>Стоянки</h3><button type="button" class="btn ghost" data-source-route>Карта маршрута</button></header>'+
  (stays.length?'<ul class="gps-source-stops">'+controls+'</ul>':'<p class="hint">В последовательных GPS-точках нет стоянок от 10 минут.</p>')+
  (writable&&(stays.length||stale)?'<div class="gps-source-stops-footer"><span data-source-total></span><button type="button" class="btn amber" data-source-save>Сохранить выбор</button></div>':'')+
  '<p role="status" class="hint" data-source-status></p>';
 const fieldRows=[...root.querySelectorAll('.gps-source-stop')];
 const status=root.querySelector('[data-source-status]'),total=root.querySelector('[data-source-total]');
 const button=root.querySelector('[data-source-save]');
 const select=row=>row.querySelector('[data-source-choice]');
 const note=row=>row.querySelector('[data-source-note]');
 function restore(){
  const saved=new Map(prior.map(stay=>[key(stay),stay]));
  for(const [index,row] of fieldRows.entries()){
   const control=select(row);
   if(!control)break;
   const decision=saved.get(key(stays[index]));
   control.value=decision?.decision||'';
   note(row).value=decision?.note||'';
  }
 }
 function payload(){
  return fieldRows.flatMap((row,index)=>{
   const decision=select(row)?.value;
   if(!decision)return [];
   const {stay_from,stay_to}=stays[index];
   return [{stay_from,stay_to,decision,note:note(row).value.trim()}];
  });
 }
 const signature=rows=>JSON.stringify(rows.map(stay=>[key(stay),stay.decision,stay.note||'']));
 const dirty=()=>!!button&&(inMemoryChange()||stale);
 function inMemoryChange(){return !!button&&signature(payload())!==baseline;}
 function paint(){
  if(!button)return;
  const included=payload().filter(stay=>stay.decision==='include');
  total.textContent='Выбрано: '+included.length+' · '+duration(included.reduce((sum,stay)=>sum+minutes(stay),0));
  button.disabled=writing||!dirty();
  for(const row of fieldRows){select(row).disabled=writing;note(row).disabled=writing||!select(row).value;}
 }
 restore();baseline=signature(payload());paint();
 if(stale)status.textContent='GPS изменился. Сверьте стоянки и сохраните выбор заново.';
 else if(prior.length)status.textContent='Выбор и комментарии сохранены в GPS-записи.';
 root.querySelector('[data-source-route]').onclick=()=>openMap();
 root.querySelectorAll('[data-source-location]').forEach(control=>control.onclick=()=>openMap(stays[Number(control.dataset.sourceLocation)].id));
 if(button){
  root.addEventListener('input',paint);
  root.addEventListener('change',paint);
  button.onclick=async()=>{
   if(writing||!dirty())return;
   const stops=payload();
   writing=true;paint();status.textContent='Сохраняем выбор…';
   try{
    revision=await save({p_track:source.id,p_source_revision:quote.revision,p_source_points:quote.points,p_expected:revision,p_stops:stops});
    prior=stops;baseline=signature(stops);stale=false;
    status.textContent='Выбор сохранён. После привязки он будет доступен в выезде для проверки.';
   }catch(error){status.textContent=error.message||'Не удалось сохранить выбор.';}
   finally{writing=false;paint();}
  };
 }
 return {isDirty:inMemoryChange,isSaving:()=>writing,discard(){restore();paint();}};
}

function matchingStay(stays,draft){
 const exact=stays.filter(stay=>!stay.manual_origin&&key(stay)===key(draft));
 if(exact.length===1)return exact[0];
 const start=Date.parse(draft.stay_from),end=Date.parse(draft.stay_to);
 const candidates=stays.filter(stay=>{
  if(stay.manual_origin||stay.lat==null||stay.lng==null||
     Math.abs(stay.lat-draft.lat)>.003||Math.abs(stay.lng-draft.lng)>.003)return false;
  const from=Date.parse(stay.stay_from),to=Date.parse(stay.stay_to);
  const overlap=Math.min(to,end)-Math.max(from,start);
  return overlap*2>=Math.max(to-from,end-start);
 });
 return candidates.length===1?candidates[0]:null;
}

export function mountLinkedStopDrafts(root,drafts,stays,openStay){
 const decisions=drafts.flatMap(draft=>draft.stops.map(stay=>({stay,sourceCurrent:draft.source_current})));
 if(!decisions.length)return;
 root.classList.add('journal-source-choices');
 root.innerHTML='<h3>Выбор до привязки GPS</h3><ul class="gps-source-stops"></ul>';
 const list=root.querySelector('ul');
 for(const {stay,sourceCurrent} of decisions){
  const row=root.ownerDocument.createElement('li');
  const target=sourceCurrent?matchingStay(stays,stay):null;
  row.className='gps-source-stop';
  row.innerHTML=`<div><strong>${escape(intervalText(stay.stay_from,stay.stay_to))} · ${duration(minutes(stay))}</strong>
   <span>${stay.decision==='include'?'Предложено учесть':'Предложено пропустить'}</span></div>`+
   (stay.note?'<p>'+escape(stay.note)+'</p>':'')+
   (target?'<button type="button" class="btn sm ghost">Проверить стоянку</button>':
    '<span class="hint">'+(sourceCurrent?'Нужно сопоставить со стоянками выезда.':'GPS изменился. Требуется повторная сверка.')+'</span>');
  if(target)row.querySelector('button').onclick=()=>openStay(target.id,stay);
  list.append(row);
 }
}
