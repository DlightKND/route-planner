import {planningPeriod} from './core/planning-dates.js';
import {journalIcon} from './journal-icons.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6});
const fmt=value=>number.format(Number(value)||0);
const lastVersion=trip=>trip.versions?.at(-1)?.result;
const stateLabel=trip=>({submitted:'На приёмке',accepted:'Принято',returned:'Возвращено'}[trip.state]||
 (trip.presence?.confirmed?'Посещения подтверждены':'Ожидает проверки GPS'));
const tripLabel=trip=>[trip.label||'Выезд',planningPeriod(trip.date_from,trip.date_to)].filter(Boolean).join(' · ');
const nonnegative=value=>/^\d+(?:[.,]\d+)?$/.test(String(value).trim())?Number(String(value).trim().replace(',','.')):NaN;
const pastQty=(item,accepted)=>Number(item.done_qty||0)-Number(accepted?.items?.find(row=>row.id===item.id)?.qty||0);
const maxQty=(item,accepted)=>Math.max(0,Number((Number(item.planned_qty)-Number(item.transferred_qty||0)-pastQty(item,accepted)).toPrecision(15)));
const plannedHours=(item,catalog)=>{
 if(item.kind==='material')return 0;
 if(item.planned_labor_hours!=null)return Number(item.planned_labor_hours);
 return /^(?:ч|н-ч|час(?:а|ов)?)$/i.test(item.unit||'')?Number(item.planned_qty):
  Math.max(0,Number(catalog.get(item.work_catalog_id)?.norm_hours)||0)*Number(item.planned_qty);
};

export function proposedTripHours(items,accepted,budget,catalog){
 const hours=Object.fromEntries(items.map(item=>[item.id,0]));
 const eligible=items.filter(item=>item.kind!=='material'&&maxQty(item,accepted)>0);
 const cents=Math.round(Number(budget||0)*100),total=eligible.reduce((sum,item)=>sum+plannedHours(item,catalog),0);
 const shares=eligible.map(item=>{
  const exact=cents*(total?plannedHours(item,catalog)/total:1/eligible.length);
  return {id:item.id,whole:Math.floor(exact),fraction:exact%1};
 });
 const unassigned=cents-shares.reduce((sum,share)=>sum+share.whole,0);
 shares.sort((a,b)=>b.fraction-a.fraction).forEach((share,i)=>{hours[share.id]=(share.whole+(i<unassigned?1:0))/100;});
 return hours;
}

export function mountOrderTripResults({root,order,items,catalog,data,user,manager,mayReport,requestedTrip,onWrite,onPlanWrite,onReturnReason,onGPS,onTrip,onReload}){
 const trips=data.trips||[],works=items.filter(item=>item.kind!=='material'),material=items.filter(item=>item.kind==='material');
 let selected=trips.find(trip=>trip.id===requestedTrip)||(trips.length===1?trips[0]:null);
 let editing=false,review=false,busy=false,fields=null,operation=null;
 const entries=new Map(catalog.map(item=>[item.id,item]));
 const expanded=new Set();
 const buttons=(title,attribute,kind='')=>'<button type="button" class="btn '+kind+'" '+attribute+'>'+title+'</button>';
 const key=trip=>'dlight:order-trip-result:'+user+':'+order.id+':'+trip.id;
 function saved(trip){
  try{
   const draft=JSON.parse(root.ownerDocument.defaultView.sessionStorage.getItem(key(trip)));
   return draft?.event===trip.event&&typeof draft?.fields?.reason==='string'&&typeof draft.fields.correction==='string'
    &&Array.isArray(draft.fields.rows)&&draft.fields.rows.every(row=>typeof row.note==='string')?draft:null;
  }catch{return null;}
 }
 function persist(){
  if(!selected||!fields)return;
  try{root.ownerDocument.defaultView.sessionStorage.setItem(key(selected),JSON.stringify({event:selected.event,editing,fields,operation}));}catch{/* In-memory fields remain available. */}
 }
 function initialFields(trip){
  const accepted=lastVersion(trip),latest=trip.latest||accepted,proposed=proposedTripHours(items,accepted,trip.presence?.available,entries);
  return {rows:items.map(item=>{
   const row=latest?.items?.find(row=>row.id===item.id);
   return {id:item.id,qty:row?.qty??0,hours:row?.hours??(trip.presence?.confirmed?proposed[item.id]:''),note:row?.note||'',manual:!!row};
  }),reason:latest?.reason||'',correction:'',presenceRevision:trip.state==='submitted'?trip.submitted_revision:trip.revision};
 }
 function restore(){
  if(!selected){fields=null;return;}
  const draft=saved(selected);
  fields=draft?.fields||initialFields(selected);
  if(draft&&(items.length!==fields.rows.length||items.some(item=>!fields.rows.some(row=>row.id===item.id))))fields=initialFields(selected);
  editing=!!draft?.editing&&manager&&mayReport;
  operation=draft?.operation||null;
 }
 function switchTrip(id){
  persist();
  selected=trips.find(trip=>trip.id===id)||null;
  expanded.clear();
  editing=false;review=false;operation=null;restore();render();
 }
 function distributed(){return fields?.rows.reduce((sum,row)=>sum+(nonnegative(row.hours)||0),0)||0;}
 function updateMetrics(){
  const total=root.querySelector('[data-trip-distributed]');if(total)total.textContent=fmt(distributed())+' чел·ч';
  const tableTotal=root.querySelector('[data-trip-work-total]');if(tableTotal)tableTotal.textContent=fmt(distributed());
  const explanation=root.querySelector('[data-trip-override]');if(explanation)explanation.hidden=Math.round(distributed()*100)===Math.round(Number(selected.presence?.available||0)*100);
 }
 function visibleRows(result){
  return (result?.items||[]).map(row=>{
   const item=items.find(item=>item.id===row.id)||{};
   return '<tr><th scope="row">'+esc(row.title??item.title)+'</th><td>'+esc(fmt(row.qty)+' '+(row.unit??item.unit??''))+'</td>'
    +'<td>'+esc((row.kind??item.kind)==='material'?'—':fmt(row.hours))+'</td><td>'+esc(row.note||'—')+'</td></tr>';
  }).join('');
 }
 function tableResult(result){
  const total=Number(result?.hours??result?.items?.reduce((sum,row)=>sum+Number(row.hours||0),0))||0;
  return '<div class="order-trip-result-scroll" role="region" aria-label="Результат по работам" tabindex="0"><table class="workflow-related-table"><thead><tr><th scope="col">Позиция</th><th scope="col">Объём</th><th scope="col">Факт, чел·ч</th><th scope="col">Комментарий</th></tr></thead><tbody>'
   +visibleRows(result)+'</tbody><tfoot><tr><th scope="row">Итого, чел·ч</th><td></td><td>'+fmt(total)+'</td><td></td></tr></tfoot></table></div>';
 }
 function notePreview(note){return note?.trim().split(/\r?\n/,1)[0]||'—';}
 function workRow(item,hours,note,details,complete=false){
  const id=esc(item.id),open=expanded.has(item.id);
  return `<tr class="order-trip-work-row" data-work-row="${id}">
   <th scope="row"><strong>${esc(item.title)}</strong><span class="hint order-trip-work-completed" ${complete?'':'hidden'}>Завершена</span></th>
   <td class="order-trip-number" data-label="План, н-ч">${fmt(plannedHours(item,entries))}</td>
   <td class="order-trip-number" data-label="Факт, чел·ч" data-visit-preview>${hours===''||hours==null?'—':esc(fmt(hours))}</td>
   <td class="order-trip-note" data-empty="${!note?.trim()}"><span data-visit-note>${esc(notePreview(note))}</span></td>
   <td class="order-trip-disclosure"><button type="button" class="btn" data-visit-expand="${id}" aria-label="Детали работы «${esc(item.title)}»" aria-expanded="${open}" aria-controls="trip-work-${id}">${journalIcon('chevron')}</button></td>
  </tr><tr class="order-trip-work-detail" id="trip-work-${id}" ${open?'':'hidden'}><td colspan="5">${details}</td></tr>`;
 }
 function workTable(rows,hours,actions='',live=false){
  const plan=works.reduce((sum,item)=>sum+plannedHours(item,entries),0);
  return `<section class="order-trip-work-card"><header class="order-trip-result-head"><h3>Работы задания</h3>${actions}</header>
   ${rows?`<table class="order-trip-work-table" aria-label="Работы задания">
    <colgroup><col class="order-trip-work-name"><col class="order-trip-value"><col class="order-trip-value"><col><col class="order-trip-command"></colgroup>
    <thead><tr><th scope="col">Работа</th><th scope="col" class="order-trip-number">План, н-ч</th><th scope="col" class="order-trip-number">Факт, чел·ч</th><th scope="col">Комментарий</th><th scope="col"><span class="sr-only">Детали работы</span></th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><th scope="row">Итого</th><td class="order-trip-number" data-label="План, н-ч">${fmt(plan)}</td><td class="order-trip-number" data-label="Факт, чел·ч" ${live?'data-trip-work-total':''}>${hours==null?'—':fmt(hours)}</td><td></td><td></td></tr></tfoot></table>`:
    '<p class="hint order-trip-work-empty">Работы ещё не добавлены.</p>'}</section>`;
 }
 function planEditor(item){
  const value=fmt(plannedHours(item,entries));
  if(!onPlanWrite||!manager||['completed','cancelled'].includes(order.status)||!Object.hasOwn(item,'planned_labor_hours')){
   return `<div><span class="hint">План, н-ч</span><p>${value}</p></div>`;
  }
  const id=esc(item.id);
  return `<div class="order-trip-work-plan" data-work-plan="${id}">
   <label>План, н-ч<input id="work-plan-${id}" type="text" inputmode="decimal" maxlength="16" value="${esc(String(plannedHours(item,entries)).replace('.',','))}"
    aria-describedby="work-plan-status-${id}"></label>
   <p id="work-plan-status-${id}" class="hint" role="status" hidden></p>
   ${buttons('Сохранить план','data-work-plan-save')}
  </div>`;
 }
 function cumulative(actions){
  const rows=works.map(item=>{
   const visits=trips.map(trip=>({trip,row:lastVersion(trip)?.items?.find(entry=>entry.id===item.id)}));
   const latest=visits.findLast(({row})=>row?.note)?.row;
   const details=`<div class="order-trip-work-fields">${planEditor(item)}<div class="order-trip-related-visits">${visits.map(({trip,row})=>
    `<div>${buttons(esc(tripLabel(trip)),'data-trip-receipt="'+esc(trip.id)+'"','ghost')}
     <span class="hint">${esc(stateLabel(trip))}</span><span>${row?fmt(row.hours)+' чел·ч':'—'}</span><p>${esc(row?.note||'—')}</p></div>`).join('')}</div></div>`;
   return workRow(item,data.accepted_hours?.[item.id],latest?.note,details,maxQty(item,null)===0);
  }).join('');
  const accepted=Object.values(data.accepted_hours||{});
  return workTable(rows,accepted.length?accepted.reduce((sum,hours)=>sum+Number(hours),0):null,actions);
 }
 function editorRows(proposal){
  const accepted=lastVersion(selected);
  return works.map(item=>{
   const value=fields.rows.find(row=>row.id===item.id),max=maxQty(item,accepted),id=esc(item.id);
   const complete=max>0&&nonnegative(value.qty)===max;
   const history=Number(data.accepted_hours?.[item.id]||0)-Number(accepted?.items?.find(row=>row.id===item.id)?.hours||0);
   const details=`<div class="order-trip-work-fields" data-visit-line="${id}">
    <div class="order-trip-work-edit"><section><h4>Трудозатраты</h4><div class="order-trip-work-labor">
     ${planEditor(item)}
     <div><label>Факт, чел·ч<input type="text" inputmode="decimal" data-visit-field="hours" value="${esc(value.hours)}" aria-describedby="work-source-${id}"></label>
     <p class="hint" id="work-source-${id}" data-visit-source></p>${selected.presence?.confirmed?
      buttons('Вернуть '+fmt(proposal[item.id])+' чел·ч','data-visit-reset hidden','ghost'):''}</div></div>
     ${history>0?`<p class="hint">Ранее принято ${fmt(history)} чел·ч · всего с этим выездом <span data-visit-cumulative data-prior="${history}"></span> чел·ч</p>`:''}
    </section><label class="order-trip-work-note">Комментарий<textarea maxlength="4000" rows="3" placeholder="Комментарий к работе" data-visit-field="note">${esc(value.note)}</textarea></label></div>
    <section class="order-trip-outcome"><h4>Результат работы</h4><div class="order-trip-outcome-controls">
     <label class="order-trip-complete"><input class="sr-only" type="checkbox" role="switch" aria-label="Работа завершена" data-visit-complete ${complete?'checked':''}>
      <span>Частично</span><span class="order-trip-complete-track" aria-hidden="true"></span><span>Завершена</span></label>
     <label class="order-trip-quantity" data-visit-partial ${complete?'hidden':''}>Выполнено, ${esc(item.unit)}<input type="text" inputmode="decimal" data-visit-field="qty" value="${esc(value.qty)}"><span class="hint">Доступно ${fmt(max)} ${esc(item.unit)}</span></label>
     <p data-visit-completed ${complete?'':'hidden'}>Выполнено <strong>${fmt(max)}</strong> ${esc(item.unit)}</p>
    </div></section></div>`;
   return workRow(item,value.hours,value.note,details,complete);
  }).join('');
 }
 function materialTable(result,editable=false){
  if(!material.length)return '';
  return `<details class="order-trip-materials"><summary>Материалы задания · ${material.length}</summary>
   <table class="workflow-related-table" aria-label="Материалы задания"><thead><tr><th scope="col">Материал</th><th scope="col">План</th><th scope="col">Факт</th><th scope="col">Комментарий</th></tr></thead>
   <tbody>${material.map(item=>{
    const row=result?.items?.find(entry=>entry.id===item.id);
    return `<tr ${editable?'data-visit-line="'+esc(item.id)+'"':''}><th scope="row">${esc(item.title)}<span class="hint">${esc(item.unit)}</span></th>
     <td>${fmt(item.planned_qty)}</td><td>${editable?`<input type="text" inputmode="decimal" data-visit-field="qty" aria-label="Использовано, ${esc(item.title)}" value="${esc(row.qty)}"><span class="hint">Доступно ${fmt(maxQty(item,lastVersion(selected)))}</span>`:row?fmt(row.qty):'—'}</td>
     <td>${editable?`<textarea rows="2" maxlength="4000" data-visit-field="note" aria-label="Комментарий, ${esc(item.title)}">${esc(row.note)}</textarea>`:esc(row?.note||'—')}</td></tr>`;
   }).join('')}</tbody></table></details>`;
 }
 function readOnlyRows(result){
  return works.map(item=>{
   const value=result.items?.find(row=>row.id===item.id);
   const details=`<div class="order-trip-work-fields"><div class="order-trip-work-edit">
    <section><h4>Трудозатраты</h4><div class="order-trip-work-labor">${planEditor(item)}
    <div><span class="hint">Факт, чел·ч</span><p>${value?fmt(value.hours):'—'}</p></div></div></section>
    <div class="order-trip-work-note"><span class="hint">Комментарий</span><p>${esc(value?.note||'—')}</p></div></div>
    <section class="order-trip-outcome"><h4>Результат работы</h4><p>${value?'Выполнено '+fmt(value.qty)+' '+esc(item.unit):'Результат пока не внесён.'}</p></section></div>`;
   return workRow(item,value?.hours,value?.note,details);
  }).join('');
 }
 function setExpanded(toggle,open){
  const row=root.ownerDocument.getElementById(toggle.getAttribute('aria-controls'));
  row.hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));
  if(open)expanded.add(toggle.dataset.visitExpand);else expanded.delete(toggle.dataset.visitExpand);
 }
 function lockControls(){
  busy=true;
  const controls=[...root.querySelectorAll('button,input,textarea,select')].filter(control=>!control.disabled);
  controls.forEach(control=>{control.disabled=true;});
  return ()=>{
   busy=false;
   controls.forEach(control=>{control.disabled=false;});
  };
 }
 async function savePlan(group,item){
  if(busy)return;
  const input=group.querySelector('input'),status=group.querySelector('[role=status]');
  const next=nonnegative(input.value);
  if(!Number.isFinite(next)||next>10000){
   input.setAttribute('aria-invalid','true');
   status.textContent='Введите от 0 до 10 000 н-ч';status.hidden=false;input.focus();return;
  }
  input.removeAttribute('aria-invalid');status.hidden=true;
  const unlock=lockControls();
  try{
   const saved=await onPlanWrite({p_order:order.id,p_item:item.id,p_expected:order.revision,p_hours:next});
   order.revision=saved.revision;item.planned_labor_hours=saved.hours;
   if(selected?.presence?.confirmed&&fields?.presenceRevision===selected.revision){
    const updated=proposedTripHours(items,lastVersion(selected),selected.presence.available,entries);
    for(const row of fields.rows)if(!row.manual)row.hours=updated[row.id];
    persist();
   }
   render();
   const activeStatus=root.ownerDocument.getElementById(status.id);
   if(activeStatus){activeStatus.textContent='План сохранён';activeStatus.hidden=false;root.ownerDocument.getElementById(input.id)?.focus();}
  }catch(cause){
   status.textContent=cause.message||'Не удалось сохранить план';status.hidden=false;
  }finally{unlock();}
 }
 function error(message,target){
  const output=root.querySelector('[data-trip-result-error]');
  if(!output)return;
  output.textContent=message;output.hidden=false;
  if(!target){output.focus();return;}
  const details=target.closest('details');
  if(details)details.open=true;
  const row=target.closest('.order-trip-work-detail');
  if(row){
   const toggle=row.previousElementSibling.querySelector('[data-visit-expand]');
   setExpanded(toggle,true);
   if(target.closest('[hidden]')){target.closest('[data-visit-line]').querySelector('[data-visit-complete]').focus();return;}
  }
  target.focus();
 }
 function formError(){
  if(!selected.presence?.confirmed||!['finished','done'].includes(selected.status))return ['Сначала завершите выезд и подтвердите рабочие посещения в GPS-журнале'];
  if(fields.presenceRevision!==selected.revision)return ['Данные GPS изменились. Обновите предложенные часы'];
  if(!fields.rows.length)return ['В задании нет работ или материалов для отчёта'];
  for(const row of fields.rows){
   const item=items.find(item=>item.id===row.id),line=root.querySelector('[data-visit-line="'+row.id+'"]');
   const max=maxQty(item,lastVersion(selected)),quantity=nonnegative(row.qty),hours=item.kind==='material'?0:nonnegative(row.hours);
   if(!Number.isFinite(quantity)||quantity>max)return ['Проверьте выполненный объём: '+item.title,line?.querySelector('[data-visit-field=qty]')];
   if(!Number.isFinite(hours)||hours>10000||Math.abs(hours*100-Math.round(hours*100))>1e-7)return ['Укажите неотрицательные трудозатраты с точностью до сотых: '+item.title,line?.querySelector('[data-visit-field=hours]')];
   if(item.kind!=='material'&&quantity<max&&(quantity>0||hours>0)&&!row.note.trim())return ['Укажите, что осталось сделать: '+item.title,line?.querySelector('[data-visit-field=note]')];
  }
  if(Math.round(distributed()*100)!==Math.round(Number(selected.presence?.available||0)*100)&&!fields.reason.trim())return ['Укажите причину корректировки трудозатрат'];
  if(editing&&!fields.correction.trim())return ['Укажите причину исправления принятого результата'];
  return null;
 }
 async function write(action,correction){
  if(busy)return;
  if(action!=='returned'){
   const issue=formError();if(issue){review=false;render();error(issue[0]);return;}
  }
  const result={items:fields.rows.map(row=>({id:row.id,qty:nonnegative(row.qty),hours:row.hours===''?0:nonnegative(row.hours),note:row.note})),
   reason:fields.reason,correction:correction??fields.correction};
  const signature=JSON.stringify([action,result]);
  if(operation?.signature!==signature)operation={signature,id:root.ownerDocument.defaultView.crypto.randomUUID()};
  const trip=selected;persist();
  const unlock=lockControls();
  try{
   await onWrite({p_order:order.id,p_trip:trip.id,p_order_revision:order.revision,p_trip_revision:trip.revision,
    p_expected_event:trip.event??null,p_operation:operation.id,p_action:action,p_result:result});
   try{root.ownerDocument.defaultView.sessionStorage.removeItem(key(trip));}catch{/* Server state is already current. */}
   await onReload(trip.id,action);
  }catch(cause){error(cause.message||'Не удалось сохранить результат');}
  finally{unlock();}
 }
 function render(){
  const trip=selected,accepted=trip&&lastVersion(trip),readOnly=trip&&(!trip.linked||trip.status==='cancelled'||!mayReport||
   !!accepted&&!editing||trip.state==='submitted'&&!manager);
  const picker='<select class="order-trip-picker" data-visit-select aria-label="Результат по выезду"><option value="">Все выезды</option>'+trips.map(t=>
   '<option value="'+esc(t.id)+'" '+(t===trip?'selected':'')+'>'+esc(tripLabel(t))+'</option>').join('')+'</select>';
  const tripControl=trip?buttons('Открыть выезд','data-visit-trip','ghost'):'';
  const selection=picker+tripControl;
  const confirmed=trips.filter(t=>t.presence?.confirmed&&t.linked&&t.status!=='cancelled');
  const available=trip?(trip.presence?.confirmed?Number(trip.presence.available):null):
   (confirmed.length?confirmed.reduce((sum,t)=>sum+Number(t.presence.available),0):null);
  const metric=value=>value==null?'—':fmt(value)+' чел·ч';
  const recorded=trips.flatMap(t=>lastVersion(t)?.items||[]);
  const distributedHours=trip?(readOnly?trip.latest?.hours:distributed()):recorded.length?recorded.reduce((sum,row)=>sum+Number(row.hours||0),0):null;
  const context=`<div class="order-trip-context"><dl class="order-trip-metrics">
   <div><dt>На распределении</dt><dd>${metric(available)}</dd></div>
   <div><dt>Распределено</dt><dd ${trip&&!readOnly?'data-trip-distributed':''}>${metric(distributedHours)}</dd></div></dl>
   ${trip&&!trip.presence?.confirmed?buttons('Сверить данные GPS','data-visit-gps'):''}</div>`;
  let content='';
  const proposal=trip&&!readOnly?proposedTripHours(items,accepted,available,entries):null;
  if(!trip){
   content=cumulative(selection)+materialTable({items:material.flatMap(item=>{
    const contributions=recorded.filter(row=>row.id===item.id);
    return contributions.length?[{id:item.id,qty:contributions.reduce((sum,row)=>sum+Number(row.qty),0)}]:[];
   })});
  }else{
   const tripContext=trip.state?`<p class="hint">${esc(stateLabel(trip))}${accepted?' · версия '+trip.versions.length:''}</p>`:'';
   if(readOnly){
    content=tripContext;
    const revise=accepted&&manager&&mayReport&&trip.linked&&trip.status!=='cancelled'?buttons('Исправить результат','data-visit-edit'):'';
    content+=workTable(readOnlyRows(trip.latest||{}),trip.latest?.hours,selection+revise)+materialTable(trip.latest);
   }else{
    const mismatch=fields.presenceRevision!==trip.revision;
    content=tripContext;
    if(trip.state==='returned')content+='<p class="hint">Причина возврата · '+esc(trip.latest?.correction)+'</p>';
    content+=review?'<section class="order-trip-review"><header class="order-trip-result-head"><h3 tabindex="-1">Проверьте результат задания</h3>'+
      buttons('Вернуться к работам','data-visit-back')+'</header><p class="order-trip-review-hours">'+metric(distributed())+'</p><p class="hint">'+esc(tripLabel(trip))+'</p>'+
      tableResult({items:fields.rows.map(row=>({...row,qty:nonnegative(row.qty),hours:nonnegative(row.hours)}))})+
      (fields.reason?'<p>Причина корректировки · '+esc(fields.reason)+'</p>':'')+
      '</section><div class="order-trip-submit">'+buttons(manager?'Принять результат':'Передать на приёмку','data-visit-commit','amber')+'</div>'
     :(mismatch?'<p class="hint">Данные GPS изменились. Ручной ввод сохранён.</p>':'')+
      (trip.presence?.confirmed?'':'<p class="hint">Отчёт можно подготовить до подтверждения посещений.</p>')+
      workTable(editorRows(proposal),distributed(),selection+(trip.presence?.confirmed?
       buttons(mismatch?'Обновить предложенные часы':'Распределить по нормам','data-visit-suggest'):''),true)+
      materialTable({items:fields.rows},true)+'<label data-trip-override>Причина корректировки трудозатрат<textarea data-visit-key="reason" maxlength="1000">'+esc(fields.reason)+'</textarea></label>'+
      (editing?'<label>Причина исправления<textarea data-visit-key="correction" maxlength="1000">'+esc(fields.correction)+'</textarea></label>':'')+
      '<p class="hint">Черновик сохраняется на этом устройстве</p>'+
      (trip.state==='submitted'&&manager?buttons('Вернуть на доработку','data-visit-return','ghost'):'')+
      '<div class="order-trip-submit">'+buttons('Проверить результат →','data-visit-review','amber')+'</div>';
   }
   if(trip.versions?.length)content+='<details class="order-trip-versions"><summary>Версии результата · '+trip.versions.length+'</summary>'+trip.versions.map((v,i)=>
    '<details><summary>Версия '+(i+1)+' · '+fmt(v.result.hours)+' чел·ч</summary>'+
    (v.result.correction?'<p>'+esc(v.result.correction)+'</p>':'')+tableResult(v.result)+'</details>').join('')+'</details>';
  }
  root.innerHTML=context+'<p data-trip-result-error role="alert" tabindex="-1" hidden></p>'+content;
  updateMetrics();
  bind(proposal);
 }
 function bind(proposal){
  const get=selector=>root.querySelector(selector);
  const picker=get('[data-visit-select]');
  if(picker)picker.onchange=e=>switchTrip(e.target.value);
  root.querySelectorAll('[data-trip-receipt]').forEach(button=>{button.onclick=()=>switchTrip(button.dataset.tripReceipt);});
  root.querySelectorAll('[data-visit-expand]').forEach(button=>{button.onclick=()=>setExpanded(button,button.getAttribute('aria-expanded')!=='true');});
  root.querySelectorAll('[data-work-plan]').forEach(group=>{
   const submit=()=>savePlan(group,works.find(item=>item.id===group.dataset.workPlan));
   group.querySelector('[data-work-plan-save]').onclick=submit;
   group.querySelector('input').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void submit();}};
  });
  const wire=(selector,fn)=>{const button=get(selector);if(button)button.onclick=fn;};
  wire('[data-visit-trip]',()=>onTrip(selected.id));wire('[data-visit-gps]',()=>onGPS(selected.id));
  wire('[data-visit-edit]',()=>{editing=true;persist();render();});
  wire('[data-visit-back]',()=>{review=false;render();get('[data-visit-review]').focus();});
  wire('[data-visit-review]',()=>{
   const issue=formError();if(issue){error(...issue);return;}
   review=true;persist();render();get('.order-trip-review h3').focus();
  });
  wire('[data-visit-commit]',()=>write(manager?'accepted':'submitted'));
  wire('[data-visit-return]',async()=>{const reason=await onReturnReason();if(reason?.trim())await write('returned',reason.trim());});
  wire('[data-visit-suggest]',()=>{
   const refreshed=fields.presenceRevision!==selected.revision;
   for(const row of fields.rows)if(!row.manual||!refreshed){row.hours=proposal[row.id];row.manual=false;}
   fields.presenceRevision=selected.revision;persist();render();
  });
  root.querySelectorAll('[data-visit-key]').forEach(input=>{input.oninput=()=>{fields[input.dataset.visitKey]=input.value;persist();};});
  root.querySelectorAll('[data-visit-line]').forEach(line=>{
   const row=fields.rows.find(value=>value.id===line.dataset.visitLine),item=items.find(value=>value.id===row.id);
   const qty=line.querySelector('[data-visit-field=qty]'),complete=line.querySelector('[data-visit-complete]');
   const summary=line.closest('.order-trip-work-detail')?.previousElementSibling;
   const labor=line.querySelector('[data-visit-field=hours]'),reset=line.querySelector('[data-visit-reset]');
   const max=maxQty(item,lastVersion(selected));
   function refreshRow(){
    if(!summary)return;
    const hours=nonnegative(row.hours),done=max>0&&nonnegative(row.qty)===max;
    summary.querySelector('[data-visit-preview]').textContent=Number.isFinite(hours)?fmt(hours):'—';
    summary.querySelector('.order-trip-work-completed').hidden=!done;
    const note=summary.querySelector('[data-visit-note]');
    note.textContent=notePreview(row.note);note.parentElement.dataset.empty=String(!row.note.trim());
    const source=line.querySelector('[data-visit-source]');
    source.textContent=row.manual?'Вручную':selected.presence?.confirmed?'Предложено '+fmt(proposal[row.id])+' чел·ч':'';
    if(reset)reset.hidden=!row.manual;
    const cumulative=line.querySelector('[data-visit-cumulative]');
    if(cumulative)cumulative.textContent=fmt(Number(cumulative.dataset.prior)+(hours||0));
    complete.checked=done;
    line.querySelector('[data-visit-partial]').hidden=done;
    line.querySelector('[data-visit-completed]').hidden=!done;
   }
   if(complete)complete.onchange=()=>{
    if(complete.checked)row.partial=row.qty;
    row.qty=complete.checked?max:row.partial??0;qty.value=row.qty;
    refreshRow();persist();
   };
   if(reset)reset.onclick=()=>{
    row.hours=proposal[row.id];row.manual=false;labor.value=row.hours;labor.focus();
    refreshRow();updateMetrics();persist();
   };
   line.querySelectorAll('[data-visit-field]').forEach(input=>{input.oninput=()=>{
    const field=input.dataset.visitField;row[field]=input.value;
    if(field==='hours')row.manual=true;
    if(field==='qty'&&complete&&max>0&&nonnegative(row.qty)===max){row.partial=0;complete.focus();}
    refreshRow();
    updateMetrics();persist();
   };});
   refreshRow();
  });
 }
 restore();render();
 return {select:switchTrip};
}
