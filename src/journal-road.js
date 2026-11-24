import {openEntityPanel} from './entity-actions.js';
import {journalIcon as icon} from './journal-icons.js';
import {distanceText,intervalText} from './core/journal-display.js';
import {bindInlinePayment,inlinePaymentHTML,paymentLabel,roadPaymentView} from './payment-terms.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const clock=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit'});
const cents=value=>Math.round(Number(value)*100);
const assigned=row=>Object.values(row.shares).reduce((sum,km)=>sum+cents(km),0);
const remainder=row=>row.km==null?null:Math.max(0,cents(row.km)-assigned(row))/100;
const unknownPayer=value=>!value||value==='mixed';
const needsPayer=(model,row)=>row.returning&&
 ((row.km==null||remainder(row)>0)&&!(row.local?.payer||model.item.local?.payer)
 || Object.keys(row.shares).some(job=>unknownPayer(roadPaymentView(model,row,job).effective.payer)));
const splitLimits=row=>({min:Math.floor(Date.parse(row.start_at)/60000)+1,max:Math.ceil(Date.parse(row.end_at)/60000)-1});

export async function readRoadModel(db,tripId){
 const {data,error}=await db.rpc('journal_road_read',{p_trip:tripId});
 if(error){if(['PGRST202','42883'].includes(error.code))return null;throw error;}
 if(data?.item?.id!==tripId||!Array.isArray(data.sections))throw Error('Маршрут не удалось загрузить');
 return data;
}

export async function saveRoadModel(db,model,id,action,value){
 const {data,error}=await db.rpc('journal_road_save',{p_trip:model.item.id,p_id:id,p_revision:model.revision,p_source:model.source,p_action:action,p_value:value});
 if(error)throw error;
 if(data?.item?.id!==model.item.id||!Array.isArray(data.sections))throw Error('Обновите участки после сохранения');
 return data;
}

export function mountRoadSections(root,{db,tripId,focus,current,onSplitPoint,splitHost,adapter}){
 let model=null,pendingId=null,selected=null,loading=0,busy=false,filter='all';
 const expanded=new Set();
 const jobs=()=>model.item.jobs||[];
 const byId=id=>model?.sections.find(row=>row.id===id);
 const title=id=>jobs().find(job=>job.id===id)?.title||'Заявка';
 const clearSplit=()=>{splitHost.querySelector('[data-road-split-editor]')?.remove();onSplitPoint?.(null);};
 root.hidden=true;

 function select(id,{reveal=false}={}){
  const row=byId(id);if(!row)return;
  selected=id;
  if(reveal){expanded.add(id);filter='all';render();}
  root.querySelectorAll('[data-road-select]').forEach(button=>{
   const active=button.dataset.roadSelect===id;
   button.setAttribute('aria-pressed',String(active));button.closest('tr').classList.toggle('is-active',active);
  });
  focus?.(row);
  if(reveal){const button=[...root.querySelectorAll('[data-road-expand]')].find(button=>button.dataset.roadExpand===id);
   button?.scrollIntoView({block:'nearest'});button?.focus({preventScroll:true});}
 }

 async function load(){
  const request=++loading;
  try{
   const data=await (adapter?adapter.read():readRoadModel(db(),tripId));
   if(!current()||request!==loading)return;
   if(!data)return;
   const search=root.querySelector('[data-road-search]')?.value||'';
   model=data;root.hidden=false;render(search);
   const id=pendingId||selected;
   if(id&&byId(id)){select(id,{reveal:!!pendingId});pendingId=null;}
  }catch(error){
   if(!current()||request!==loading)return;
   root.hidden=false;root.innerHTML='<p class="err" role="alert">'+esc(error.message)+'</p><button type="button" class="btn ghost" data-road-retry>Обновить участки</button>';
   root.querySelector('button').onclick=load;
  }
 }

 async function save(row,action,value){
  if(!current()||busy)throw Error('Дождитесь сохранения или обновите участки');
  busy=true;loading++;
  try{
   const data=await (adapter?adapter.save(model,row,action,value):saveRoadModel(db(),model,row.id,action,value));
   if(!current())return false;
   model=data;return true;
  }finally{busy=false;}
 }

 function render(search=root.querySelector('[data-road-search]')?.value||''){
  clearSplit();
  const rows=model.sections;
  const body=rows.map((row,index)=>{
   const id=esc(row.id),open=expanded.has(row.id),shares=Object.keys(row.shares);
   const requestText=shares.length?shares.map(title).join(', '):row.request_id?title(row.request_id):'Без заявки';
   const pending=remainder(row),warning=needsPayer(model,row);
   const label=warning?'Нужно назначить плательщика':row.km==null
    ?(model.preview&&row.measured_km>0?'Измерено '+distanceText(row.measured_km)+' · есть разрыв':'Пробег неизвестен'):'';
   const terms=roadPaymentView(model,row);
   const basis=model.preview?'':row.manual?'Распределено вручную':row.returning?(shares.length?'Автоматически · возврат по заявкам рейса':'Ожидает распределения возврата'):
    row.request_id?'Автоматически · дорога до объекта «'+title(row.request_id)+'»':row.km==null?'':'Уточните заявку пункта назначения';
   const sharesTable=shares.length?`<div class="journal-road-share-card"><table class="journal-road-shares" aria-label="Километры по заявкам"><thead><tr><th>Заявка</th><th>Км</th></tr></thead><tbody>${shares.map(job=>{
    const view=roadPaymentView(model,row,job);
    return `<tr><th scope="row">${esc(title(job))}${row.returning?`<span class="hint">Плательщик · ${esc(paymentLabel(view,'payer',view.effective.payer))}</span>`:''}</th><td>${number.format(row.shares[job])}</td></tr>`;
   }).join('')}</tbody></table></div>`:'';
   const {min,max}=splitLimits(row);
   return `<tr class="journal-road-row" data-road-row="${id}" data-unassigned="${pending>0||!shares.length&&!row.request_id}">
    <th scope="row"><button type="button" class="journal-road-select" data-road-select="${id}" aria-pressed="${selected===row.id}">${esc(row.title)}</button>
     <span class="hint">${esc(intervalText(row.start_at,row.end_at))}</span>${label?`<span class="hint${warning?' payment-term-exception':''}">${label}</span>`:''}
     <span class="hint journal-road-mobile-requests">${esc(requestText)}</span></th>
    <td class="journal-road-km">${distanceText(row.km)}</td>
    <td class="journal-road-request-cell">${esc(requestText)}${pending>0?`<span class="hint">${distanceText(pending)} без заявки</span>`:''}</td>
    <td><button type="button" class="btn ghost journal-road-expand" aria-expanded="${open}" aria-controls="route-road-${index}" aria-label="Участок «${esc(row.title)}»" data-road-expand="${id}">${icon('chevron')}</button></td>
   </tr><tr id="route-road-${index}" ${open?'':'hidden'}><td colspan="4"><div class="journal-road-detail">
    <div class="journal-road-detail-head"><div><h3>Распределение по заявкам</h3><p class="hint">${row.km==null?'Пробег участка неизвестен.':number.format(assigned(row)/100)+' из '+distanceText(row.km)+' распределено'}</p></div>
     <div class="journal-road-buttons">${model.editable&&row.km!=null&&jobs().length?`<button type="button" class="btn" data-road-allocate="${id}">Распределить по заявкам</button>`:''}
     ${model.editable&&min<=max?`<button type="button" class="btn" data-road-split="${id}">Разделить участок</button>`:''}</div></div>
    ${basis?`<p class="hint">${esc(basis)}</p>`:''}${sharesTable}${model.preview?'':inlinePaymentHTML(terms)}
   </div></td></tr>`;
  }).join('');
  const left=rows.reduce((sum,row)=>sum+cents(remainder(row)||0),0)/100;
  root.innerHTML=`<h2>Участки дороги</h2>${model.preview?'<p class="hint">'+(model.stale?'GPS изменился. Сверьте сохранённые точки разделения. ':'')+'Распределение километров по заявкам доступно после привязки.</p>':''}${rows.length?`
   <label><span class="sr-only">Найти участок</span><input type="search" data-road-search value="${esc(search)}" placeholder="Участок или заявка"></label>
   <div class="journal-road-filters" role="group" aria-label="Фильтр участков">${[['all','Все'],['unassigned','Без заявки']].map(([key,label])=>
    `<button type="button" data-road-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div>
   <p class="hint" data-road-count role="status"></p>
   <table class="journal-road-table" aria-label="Участки дороги"><thead><tr><th>Участок</th><th>Пробег</th><th class="journal-road-request-cell">Заявки</th><th><span class="sr-only">Подробнее</span></th></tr></thead><tbody>${body}</tbody></table>
   <p class="hint" data-road-empty hidden>Участков по этому фильтру нет.</p>${left>0?`<p class="hint">${distanceText(left)} без заявки</p>`:''}`:'<p class="hint">В этой записи нет участков между стоянками.</p>'}`;
  if(!rows.length)return;
  function applyFilter(){
   const value=root.querySelector('[data-road-search]').value.toLocaleLowerCase('ru').trim();
   let count=0;
   for(const row of root.querySelectorAll('[data-road-row]')){
    row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(value)||filter==='unassigned'&&row.dataset.unassigned!=='true';
    row.nextElementSibling.hidden=row.hidden||!expanded.has(row.dataset.roadRow);
    count+=Number(!row.hidden);
   }
   root.querySelector('[data-road-count]').textContent='Показано '+count+' из '+rows.length;
   root.querySelector('[data-road-empty]').hidden=count>0;
  }
  root.querySelector('[data-road-search]').oninput=applyFilter;
  root.querySelectorAll('[data-road-filter]').forEach(button=>{button.onclick=()=>{
   filter=button.dataset.roadFilter;root.querySelectorAll('[data-road-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));applyFilter();
  };});
  root.querySelectorAll('[data-road-select]').forEach(button=>{button.onclick=()=>select(button.dataset.roadSelect);});
  root.querySelectorAll('[data-road-expand]').forEach(button=>{button.onclick=()=>{
   const id=button.dataset.roadExpand;if(expanded.has(id))expanded.delete(id);else{expanded.add(id);select(id);}
   button.setAttribute('aria-expanded',String(expanded.has(id)));applyFilter();
  };});
  root.querySelectorAll('[data-road-allocate]').forEach(button=>{button.onclick=()=>allocate(button,byId(button.dataset.roadAllocate));});
  root.querySelectorAll('[data-road-split]').forEach(button=>{button.onclick=()=>split(button,byId(button.dataset.roadSplit));});
  root.querySelectorAll('[data-road-payment]').forEach(block=>{
   const row=byId(block.dataset.roadPayment);
   bindInlinePayment(block,roadPaymentView(model,row),(_view,terms)=>save(row,'terms',terms),()=>{
    if(!current())return;
    render();const next=[...root.querySelectorAll('[data-road-payment]')].find(block=>block.dataset.roadPayment===row.id);
    next?.querySelector('[data-payment-save]')?.focus({preventScroll:true});
   });
  });
  applyFilter();
 }

 function openPanel(title,panel,trigger,saveLabel,onSave,onCancel){
  panel.hidden=true;panel.className='journal-road-editor';root.append(panel);
  openEntityPanel({title,panel,trigger,dispose:true,saveLabel,saveHint:'',onSave,onSaved:()=>{
   if(!current())return;
   render();const button=[...root.querySelectorAll('[data-road-expand]')].find(button=>button.dataset.roadExpand===selected);
   button?.focus({preventScroll:true});
  },onCancel});
 }
 function allocate(trigger,row){
  const panel=root.ownerDocument.createElement('section'),limit=cents(row.km);
  panel.innerHTML=`<p class="hint">Длина участка — ${distanceText(row.km)}. Остаток можно оставить без заявки.</p>
   <div class="journal-road-editor-fields">${jobs().map(job=>`<label>${esc(job.title)}<input type="text" inputmode="decimal" data-job="${esc(job.id)}" value="${row.shares[job.id]?number.format(row.shares[job.id]):''}" aria-label="Километры · ${esc(job.title)}"></label>`).join('')}</div>
   <p class="hint" data-road-balance role="status"></p>`;
  const inputs=[...panel.querySelectorAll('input')],balance=panel.querySelector('[data-road-balance]');
  const values=()=>inputs.map(el=>[el.dataset.job,el.value.trim()===''?0:/^\d+(?:[,.]\d{1,2})?$/.test(el.value.trim())?Number(el.value.trim().replace(',','.')):NaN]);
  const total=items=>items.reduce((sum,[,km])=>sum+cents(km),0);
  const update=()=>{const remaining=limit-total(values());balance.textContent=Number.isNaN(remaining)?'Введите километры с точностью до сотых.':
   remaining<0?'Сверх длины участка · '+distanceText(-remaining/100):'Без заявки · '+distanceText(remaining/100);balance.classList.toggle('payment-term-exception',remaining<0||Number.isNaN(remaining));};
  panel.oninput=update;update();
  openPanel('Распределить километры · '+row.title,panel,trigger,'Сохранить',()=>{
   const items=values();
   if(!Number.isFinite(total(items)))throw Error('Введите километры с точностью до сотых');
   if(total(items)>limit)throw Error('Распределено больше длины участка');
   return save(row,'shares',Object.fromEntries(items.filter(([,km])=>km>0)));
  });
 }
 function split(trigger,row,initial){
  const {min,max}=splitLimits(row);
  if(min>max)return;
  clearSplit();
  select(row.id);
  const panel=root.ownerDocument.createElement('form');
  panel.dataset.roadSplitEditor='';panel.className='journal-road-editor';
  panel.setAttribute('aria-label','Разделение участка');
  panel.innerHTML=`<h3>Разделить участок</h3><p class="hint">Выберите точку на линии или на шкале времени.</p>
   <label>Точка разделения <output></output><input type="range" min="${min}" max="${max}" value="${initial??Math.round((min+max)/2)}"></label>
   <p class="hint" data-road-split-summary role="status"></p><p class="err" role="alert" hidden></p>
   <div class="journal-road-buttons"><button type="button" class="btn ghost">Отмена</button><button type="submit" class="btn amber">${model.preview?'Сохранить разделение':'Разделить'}</button></div>`;
  const slider=panel.querySelector('input'),time=panel.querySelector('output'),summary=panel.querySelector('[data-road-split-summary]');
  let timer,request=0;
  const update=()=>{
   const at=Number(slider.value)*60000,version=++request;
   time.textContent=clock.format(at);
   slider.setAttribute('aria-valuetext',time.textContent);
   summary.textContent=intervalText(row.start_at,at)+' · '+intervalText(at,row.end_at);
   onSplitPoint?.(row,at,next=>{slider.value=String(Math.round(next/60000));update();});
   clearTimeout(timer);
   timer=setTimeout(async()=>{
    if(!current()||!panel.isConnected)return;
    try{
     const {data,error}=adapter?{data:adapter.preview(model,row,at/1000)}:
      await db().rpc('journal_road_split_preview',{p_trip:tripId,p_id:row.id,p_revision:model.revision,p_source:model.source,p_at:at/1000});
     if(error||!data||version!==request||!current()||!panel.isConnected)return;
     const label=(from,to,km)=>intervalText(from,to)+' · '+(km==null?'пробег неизвестен':distanceText(km));
     summary.textContent=label(row.start_at,at,data.left)+' / '+label(at,row.end_at,data.right);
    }catch{/* The selected time stays available while the preview is unreachable. */}
   },160);
  };
  const [cancel,submit]=panel.querySelectorAll('button'),errorBox=panel.querySelector('[role=alert]');
  cancel.onclick=()=>{clearTimeout(timer);clearSplit();trigger?.focus();};
  panel.onsubmit=async event=>{
   event.preventDefault();cancel.disabled=submit.disabled=slider.disabled=true;errorBox.hidden=true;
   try{if(await save(row,'split',Number(slider.value)*60)){render();select(row.id,{reveal:true});}}
   catch(error){errorBox.textContent=error.message;errorBox.hidden=false;}
   finally{cancel.disabled=submit.disabled=slider.disabled=false;}
  };
  for(const type of ['pointerdown','mousedown','dblclick','wheel'])panel.addEventListener(type,event=>event.stopPropagation());
  splitHost.append(panel);
  slider.oninput=update;update();slider.focus({preventScroll:true});splitHost.scrollIntoView({block:'nearest'});
 }
 async function prepareCut(at){
  if(!model)await load();
  if(!model?.editable)throw Error('Сначала проверьте основной трек и загрузите участки дороги.');
  if(model.sections.some(row=>Date.parse(row.start_at)===at*1000&&row.id!==row.base_id))
   throw Error('Точка разделения уже есть в выезде.');
  const row=model.sections.find(row=>Date.parse(row.start_at)<at*1000&&at*1000<Date.parse(row.end_at));
  if(!row)throw Error('Точка разделения не попала в участок дороги выезда.');
  select(row.id,{reveal:true});
  const trigger=[...root.querySelectorAll('[data-road-split]')].find(button=>button.dataset.roadSplit===row.id);
  split(trigger,row,at/60);
 }
 return {load,prepareCut,isSaving:()=>busy,open(id){pendingId=id;if(byId(id)){select(id,{reveal:true});pendingId=null;}}};
}
