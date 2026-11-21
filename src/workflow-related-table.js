import {journalIcon} from './journal-icons.js';
import {planningPeriod} from './core/planning-dates.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const quantity=value=>value==null?'—':format.format(Number(value));
const plural=new Intl.PluralRules('ru');
const counted=(count,one,few,many)=>count+' '+({one,few,many}[plural.select(count)]||many);
const tableState=new WeakMap();

export function relatedTable({idPrefix,title,searchLabel,placeholder,columns,rows,actions='',filter='',review=false,totalHours=false,empty}){
 return `<section class="related-records" aria-label="${title}">
  <header class="related-table-head"><div><h3>${title}</h3><div class="related-header-actions">${actions}</div></div>
   <div><label><span class="sr-only">${searchLabel}</span><input type="search" data-related-search placeholder="${placeholder}"></label>
    <p class="hint" data-related-count role="status"></p></div>
   ${review?`<button class="chip related-review-filter" type="button" aria-pressed="false" data-related-review>На проверке
    <span>${rows.filter(row=>row.review).length}</span></button>`:filter}</header>
  <div class="related-table-scroll"><table class="related-record-table" aria-label="${title}"><colgroup><col><col class="related-people-col"><col class="related-detail-col"><col class="related-status-col"><col class="related-commands-col"></colgroup>
   <thead><tr>${columns.map(column=>`<th scope="col" title="${column}">${column}</th>`).join('')}<th scope="col"><span class="sr-only">Действия и раскрытие</span></th></tr></thead>
   <tbody>${rows.map(row=>{
    const key=idPrefix+'-'+row.id;
    return `<tr data-related-row data-search="${esc(row.search.toLocaleLowerCase('ru'))}" data-review="${Boolean(row.review)}" data-hours="${row.hours??''}" data-works="${row.works??''}">
     <th scope="row">${row.cells[0]}</th>${row.cells.slice(1).map((cell,i)=>`<td data-label="${columns[i+1]}">${cell}</td>`).join('')}
     <td class="related-row-actions"><div>${row.actions?`<div class="related-action-buttons">${row.actions}</div>`:''}<button type="button" class="btn ghost related-disclose" aria-expanded="false"
      aria-controls="${esc(key)}" aria-label="Раскрыть ${esc(row.label)}" data-related-toggle="${esc(row.label)}">${journalIcon('chevron')}</button></div></td></tr>
    <tr class="related-detail" id="${esc(key)}" hidden><td colspan="5">${row.detail}</td></tr>`;
   }).join('')}</tbody><tfoot><tr><th scope="row" data-related-total>Итого</th><td></td>
    <td>${totalHours?'<span data-related-hours></span>':''}</td><td></td><td></td></tr></tfoot>
  </table></div><p class="hint related-empty" data-related-empty hidden>${rows.length?'Ничего не найдено. Измените поиск.':empty}</p></section>`;
}

export function wireRelatedTable(node,key){
 const root=node.querySelector('.related-records');
 if(!root)return;
 const input=root.querySelector('[data-related-search]'),review=root.querySelector('[data-related-review]');
 const rows=[...root.querySelectorAll('[data-related-row]')];
 const previous=tableState.get(node);
 const state=previous&&previous.key===key?previous:{key,search:'',review:false,expanded:new Set()};
 tableState.set(node,state);
 input.value=state.search;
 review?.setAttribute('aria-pressed',String(state.review));
 function filter(){
  state.search=input.value;
  state.review=review?.getAttribute('aria-pressed')==='true';
  const search=input.value.trim().toLocaleLowerCase('ru'),reviewOnly=review?.getAttribute('aria-pressed')==='true';
  for(const row of rows){
   row.hidden=!row.dataset.search.includes(search)||reviewOnly&&row.dataset.review!=='true';
   row.nextElementSibling.hidden=row.hidden||row.querySelector('[data-related-toggle]').getAttribute('aria-expanded')!=='true';
  }
  const visible=rows.filter(row=>!row.hidden),footer=root.querySelector('tfoot');
  root.querySelector('[data-related-count]').textContent='Показано '+visible.length+' из '+rows.length;
  root.querySelector('[data-related-empty]').hidden=visible.length>0;
  footer.hidden=!visible.length;
  const hours=footer.querySelector('[data-related-hours]');
  const works=visible.reduce((sum,row)=>sum+Number(row.dataset.works||0),0);
  const summary=hours?counted(visible.length,'выезд','выезда','выездов'):
   counted(visible.length,'задание','задания','заданий')+' · '+counted(works,'работа','работы','работ');
  footer.querySelector('[data-related-total]').textContent=(search||reviewOnly?'Итого по фильтру':'Итого')+' · '+summary;
  if(hours){
   const values=visible.filter(row=>row.dataset.hours!=='').map(row=>Number(row.dataset.hours));
   hours.textContent=values.length?quantity(values.reduce((total,value)=>total+value,0))+' чел·ч':'—';
  }
 }
 input.oninput=filter;
 if(review)review.onclick=()=>{
  review.setAttribute('aria-pressed',String(review.getAttribute('aria-pressed')!=='true'));filter();
 };
 for(const toggle of root.querySelectorAll('[data-related-toggle]')){
  const id=toggle.getAttribute('aria-controls');
  const apply=open=>{
   toggle.setAttribute('aria-expanded',String(open));
   toggle.setAttribute('aria-label',(open?'Свернуть ':'Раскрыть ')+toggle.dataset.relatedToggle);
  };
  apply(state.expanded.has(id));
  toggle.onclick=()=>{
   if(state.expanded.has(id))state.expanded.delete(id);else state.expanded.add(id);
   apply(state.expanded.has(id));filter();
  };
 }
 filter();
}

export function relatedWorkPreview(items,{open,accepted,tripScoped=false}){
 const work=items.filter(item=>item.kind!=='material'),parts=items.filter(item=>item.kind==='material');
 const byItem=new Map((accepted||[]).map(item=>[item.id,item]));
 const plan=item=>item.planned_labor_hours??(/^(?:ч|н-ч|час(?:а|ов)?|год(?:ина|ини|ин)?)$/i.test(item.unit||'')?item.planned_qty:null);
 const total=values=>values.some(value=>value!=null)?values.reduce((sum,value)=>sum+(Number(value)||0),0):null;
 const pair=(planned,fact)=>`<span class="related-work-measures"><span><small>План, н-ч</small><b>${quantity(planned)}</b></span>
  <span><small>Факт, чел·ч</small><b>${quantity(fact)}</b></span></span>`;
 return `<div class="related-work-head"><h4>Работы задания</h4>${open}</div>${work.length?work.map(item=>{
  const assigned=parts.filter(part=>part.parent_work_id===item.id);
  return `<details class="related-work-preview"><summary><span>${esc(item.title)}</span>${pair(plan(item),byItem.get(item.id)?.hours)}</summary>
   <div><h4>Запчасти</h4>${assigned.length?`<table class="related-parts-table" aria-label="Запчасти · ${esc(item.title)}">
    <thead><tr><th scope="col">Запчасть</th><th scope="col">План</th><th scope="col">Факт</th></tr></thead>
    <tbody>${assigned.map(part=>`<tr><th scope="row">${esc(part.title)}<small>${esc(part.unit)}</small></th><td>${quantity(part.planned_qty)}</td>
     <td>${quantity(tripScoped?byItem.get(part.id)?.qty:Number(part.done_qty)>0?part.done_qty:null)}</td></tr>`).join('')}</tbody></table>`:'<p class="hint">Запчасти не запланированы.</p>'}</div></details>`;
 }).join('')+`<div class="related-work-head"><strong>Итого</strong>${pair(total(work.map(plan)),total(work.map(item=>byItem.get(item.id)?.hours)))}</div>`:'<p class="hint">Работы пока не добавлены.</p>'}`;
}

export function relatedTripRows(trips,{people,status,visits,linkedTasks,open,openGPS,report}){
 return trips.map(trip=>{
  const visit=visits.get(trip.id),period=planningPeriod(trip.date_from,trip.date_to),crew=(trip.engineer_ids||[]).map(people);
  const vehicle=trip.vehicle_label||visit?.label||'Автомобиль не выбран',review=trip.status==='finished'&&!visit?.presence?.confirmed;
  const tasks=linkedTasks(trip.id),hours=visit?.presence?.confirmed?visit.presence.base:null;
  return {id:trip.id,label:'выезд · '+vehicle,search:[trip.number,vehicle,period,...crew].join(' '),review,hours,
   cells:[`${open(trip,trip.number?'Выезд №'+trip.number:'Выезд')}<small>${esc(period)}</small>`,
    `<strong>${esc(vehicle)}</strong><small>${esc(crew.join(', ')||'Команда не назначена')}</small>`,
    `${hours==null?'—':quantity(hours)+' чел·ч'}${visit?.presence?.confirmed&&visit.presence.available!=null?`<small>Доступно заданию ${quantity(visit.presence.available)} чел·ч</small>`:''}`,
    `<span class="related-status${review?' is-review':''}">${esc(trip.status==='finished'&&visit?.presence?.confirmed?'Посещения подтверждены':status(trip.status))}</span>`],
   actions:report(trip,visit),
   detail:`<dl class="related-trip-facts"><div><dt>Команда</dt><dd>${esc(crew.join(' · ')||'Не назначена')}</dd></div>
    <div><dt>Журнал GPS</dt><dd>${openGPS(trip)}</dd></div></dl><div class="related-work-head"><h4>Задания выезда</h4>${open(trip,'Открыть выезд')}</div>
    ${tasks||'<p class="hint">Связанных заданий пока нет.</p>'}`};
 });
}
