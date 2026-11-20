import {planningPeriod} from './core/planning-dates.js';

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

const header='<thead><tr><th scope="col">Работа</th><th scope="col">План, н-ч</th><th scope="col">Факт, чел·ч</th><th scope="col">Комментарий</th></tr></thead>';

export function mountOrderTripResults({root,order,items,catalog,data,user,manager,mayReport,requestedTrip,onWrite,onReturnReason,onGPS,onTrip,onReload}){
 const trips=data.trips||[],works=items.filter(item=>item.kind!=='material'),material=items.filter(item=>item.kind==='material');
 let selected=trips.find(trip=>trip.id===requestedTrip)||(trips.length===1?trips[0]:null);
 let editing=false,review=false,busy=false,fields=null,operation=null;
 const entries=new Map(catalog.map(item=>[item.id,item]));
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
  editing=false;review=false;operation=null;restore();render();
 }
 function distributed(){return fields?.rows.reduce((sum,row)=>sum+(nonnegative(row.hours)||0),0)||0;}
 function updateMetrics(){
  const total=root.querySelector('[data-trip-distributed]');if(total)total.textContent=fmt(distributed())+' чел·ч';
  const explanation=root.querySelector('[data-trip-override]');if(explanation)explanation.hidden=Math.round(distributed()*100)===Math.round(Number(selected.presence?.available||0)*100);
 }
 function visibleRows(result){
  return items.map(item=>{
   const row=result?.items?.find(entry=>entry.id===item.id);
   return '<tr><th scope="row">'+esc(item.title)+'</th><td>'+esc(fmt(row?.qty||0)+' '+item.unit)+'</td>'
    +'<td>'+esc(item.kind==='material'?'—':fmt(row?.hours||0))+'</td><td>'+esc(row?.note||'—')+'</td></tr>';
  }).join('');
 }
 function tableResult(result){
  const total=Number(result?.hours??result?.items?.reduce((sum,row)=>sum+Number(row.hours||0),0))||0;
  return '<div class="order-trip-result-scroll" role="region" aria-label="Результат по работам" tabindex="0"><table class="workflow-related-table"><thead><tr><th scope="col">Позиция</th><th scope="col">Объём</th><th scope="col">Факт, чел·ч</th><th scope="col">Комментарий</th></tr></thead><tbody>'
   +visibleRows(result)+'</tbody><tfoot><tr><th scope="row">Итого, чел·ч</th><td></td><td>'+fmt(total)+'</td><td></td></tr></tfoot></table></div>';
 }
 function cumulative(){
  return '<div class="order-trip-result-scroll" role="region" aria-label="Принятые работы по выездам" tabindex="0"><table class="workflow-related-table">'+header+'<tbody>'+works.map(item=>{
   const rows=trips.map(trip=>({trip,row:lastVersion(trip)?.items?.find(entry=>entry.id===item.id)}));
   const hours=data.accepted_hours?.[item.id];
   return '<tr><th scope="row">'+esc(item.title)+'</th><td>'+fmt(plannedHours(item,entries))+'</td><td>'+(hours==null?'—':fmt(hours))+'</td><td>'
    +(rows.length?'<details><summary>По выездам</summary>'+rows.map(({trip,row})=>'<p>'+buttons(esc(tripLabel(trip)),'data-trip-receipt="'+esc(trip.id)+'"','ghost')+
      ' <span class="hint">'+esc(stateLabel(trip))+(row?' · '+fmt(row.hours)+' чел·ч':'')+'</span>'+(row?.note?'<br>'+esc(row.note):'')+'</p>').join('')+'</details>':'—')
    +'</td></tr>';
  }).join('')+'</tbody></table></div>';
 }
 function editorRows(){
  const accepted=lastVersion(selected);
  return [...works,...material].map(item=>{
   const value=fields.rows.find(row=>row.id===item.id),max=maxQty(item,accepted);
   const hours=item.kind!=='material'?'<label>Факт, чел·ч<input type="text" inputmode="decimal" data-visit-field="hours" value="'+esc(value.hours)+'"></label>':'';
   return '<details class="order-trip-work" data-visit-line="'+esc(item.id)+'"><summary><span>'+esc(item.title)+'</span><span class="hint">'+
    (item.kind==='material'?'Материал':fmt(plannedHours(item,entries))+' н-ч')+'</span><span data-visit-preview>'+esc(item.kind==='material'?fmt(value.qty)+' '+item.unit:value.hours===''?'—':fmt(value.hours)+' чел·ч')+
    '</span></summary><div class="order-trip-work-fields">'+hours+
    '<label>'+(item.kind==='material'?'Использовано':'Выполнено')+' · '+esc(item.unit)+'<input type="text" inputmode="decimal" data-visit-field="qty" value="'+esc(value.qty)+'"><span class="hint">Доступно '+fmt(max)+' '+esc(item.unit)+'</span></label>'+
    (item.kind==='material'?'':'<label class="order-trip-complete"><input type="checkbox" data-visit-complete '+(max>0&&Number(value.qty)===max?'checked':'')+'> Работа завершена</label>')+
    '<label class="order-trip-work-note">Комментарий<textarea maxlength="4000" rows="2" data-visit-field="note">'+esc(value.note)+'</textarea></label></div></details>';
  }).join('');
 }
 function error(message,target){
  const output=root.querySelector('[data-trip-result-error]');
  if(!output)return;
  output.textContent=message;output.hidden=false;
  if(target){target.closest('details').open=true;target.focus();}else output.focus();
 }
 function formError(){
  if(!selected.presence?.confirmed||!['finished','done'].includes(selected.status))return ['Сначала завершите выезд и подтвердите рабочие посещения в GPS-журнале'];
  if(fields.presenceRevision!==selected.revision)return ['Данные GPS изменились. Обновите предложенные часы'];
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
  const trip=selected;persist();busy=true;
  const controls=[...root.querySelectorAll('button,input,textarea,select')].filter(button=>!button.disabled);
  controls.forEach(button=>{button.disabled=true;});
  try{
   await onWrite({p_order:order.id,p_trip:trip.id,p_order_revision:order.revision,p_trip_revision:trip.revision,
    p_expected_event:trip.event??null,p_operation:operation.id,p_action:action,p_result:result});
   try{root.ownerDocument.defaultView.sessionStorage.removeItem(key(trip));}catch{/* Server state is already current. */}
   await onReload(trip.id,action);
  }catch(cause){error(cause.message||'Не удалось сохранить результат');}
  finally{busy=false;controls.forEach(button=>{button.disabled=false;});}
 }
 function render(){
  const trip=selected,accepted=trip&&lastVersion(trip),readOnly=trip&&(!trip.linked||trip.status==='cancelled'||!mayReport||
   !!accepted&&!editing||trip.state==='submitted'&&!manager);
  const tabs='<label class="order-trip-picker">Результат по выезду<select data-visit-select><option value="">Все выезды</option>'+trips.map(t=>
   '<option value="'+esc(t.id)+'" '+(t===trip?'selected':'')+'>'+esc(tripLabel(t)+' · '+stateLabel(t))+'</option>').join('')+'</select></label>';
  let content=trips.length?cumulative():'<p class="hint">Связанные выезды недоступны.</p>';
  if(trip){
   const state='<p class="hint">'+esc(stateLabel(trip))+'</p>';
   const links='<div class="order-trip-actions">'+buttons('Открыть выезд','data-visit-trip')+buttons('Сверить данные GPS','data-visit-gps','ghost')+'</div>';
   if(readOnly){
    content=state+links+(trip.latest?tableResult(trip.latest):'<p class="hint">Результат пока не внесён.</p>');
    if(accepted&&manager&&mayReport&&trip.linked&&trip.status!=='cancelled')content+=buttons('Исправить результат','data-visit-edit');
   }else{
    const mismatch=fields.presenceRevision!==trip.revision;
    content='<dl class="order-trip-metrics"><div><dt>На распределении</dt><dd>'+(trip.presence?.confirmed?fmt(trip.presence.available)+' чел·ч':'—')+'</dd></div><div><dt>Распределено</dt><dd data-trip-distributed></dd></div></dl>'+state+links;
    if(trip.state==='returned')content+='<p class="hint">Причина возврата · '+esc(trip.latest?.correction)+'</p>';
    content+=review?'<h3>Проверьте результат задания</h3>'+tableResult({items:fields.rows.map(row=>({...row,qty:nonnegative(row.qty),hours:nonnegative(row.hours)}))})+
      (fields.reason?'<p>Причина корректировки · '+esc(fields.reason)+'</p>':'')+
      '<div class="order-trip-actions">'+buttons('Вернуться к работам','data-visit-back','ghost')+buttons(manager?'Принять результат':'Передать на приёмку','data-visit-commit','amber')+'</div>'
     :(mismatch?'<p class="hint">Данные GPS изменились. Ручной ввод сохранён.</p>':'')+
      (trip.presence?.confirmed?buttons(mismatch?'Обновить предложенные часы':'Распределить по нормам','data-visit-suggest','ghost'):'<p class="hint">Отчёт можно подготовить до подтверждения посещений.</p>')+
      editorRows()+'<label data-trip-override>Причина корректировки трудозатрат<textarea data-visit-key="reason" maxlength="1000">'+esc(fields.reason)+'</textarea></label>'+
      (editing?'<label>Причина исправления<textarea data-visit-key="correction" maxlength="1000">'+esc(fields.correction)+'</textarea></label>':'')+
      '<p class="hint">Черновик сохраняется на этом устройстве</p><div class="order-trip-actions">'+buttons('Проверить результат','data-visit-review')+
      (trip.state==='submitted'&&manager?buttons('Вернуть на доработку','data-visit-return','ghost'):'')+'</div>';
   }
   if(trip.versions?.length)content+='<details class="order-trip-versions"><summary>Версии результата · '+trip.versions.length+'</summary>'+trip.versions.map((v,i)=>
    '<details><summary>Версия '+(i+1)+' · '+fmt(v.result.hours)+' чел·ч</summary>'+
    (v.result.correction?'<p>'+esc(v.result.correction)+'</p>':'')+tableResult(v.result)+'</details>').join('')+'</details>';
  }
  root.innerHTML='<header class="order-trip-result-head"><h3>Работы задания по выездам</h3>'+tabs+'</header><p data-trip-result-error role="alert" tabindex="-1" hidden></p>'+content;updateMetrics();
  bind();
 }
 function bind(){
  const get=selector=>root.querySelector(selector);
  get('[data-visit-select]').onchange=e=>switchTrip(e.target.value);
  root.querySelectorAll('[data-trip-receipt]').forEach(button=>{button.onclick=()=>switchTrip(button.dataset.tripReceipt);});
  const wire=(selector,fn)=>{const button=get(selector);if(button)button.onclick=fn;};
  wire('[data-visit-trip]',()=>onTrip(selected.id));wire('[data-visit-gps]',()=>onGPS(selected.id));
  wire('[data-visit-edit]',()=>{editing=true;persist();render();});
  wire('[data-visit-back]',()=>{review=false;render();});
  wire('[data-visit-review]',()=>{const issue=formError();if(issue){error(...issue);return;}review=true;persist();render();});
  wire('[data-visit-commit]',()=>write(manager?'accepted':'submitted'));
  wire('[data-visit-return]',async()=>{const reason=await onReturnReason();if(reason?.trim())await write('returned',reason.trim());});
  wire('[data-visit-suggest]',()=>{
   const proposal=proposedTripHours(items,lastVersion(selected),selected.presence?.available,entries);
   const refreshed=fields.presenceRevision!==selected.revision;
   for(const row of fields.rows)if(!row.manual||!refreshed){row.hours=proposal[row.id];row.manual=false;}
   fields.presenceRevision=selected.revision;persist();render();
  });
  root.querySelectorAll('[data-visit-key]').forEach(input=>{input.oninput=()=>{fields[input.dataset.visitKey]=input.value;persist();};});
  root.querySelectorAll('[data-visit-line]').forEach(line=>{
   const row=fields.rows.find(value=>value.id===line.dataset.visitLine),item=items.find(value=>value.id===row.id);
   const qty=line.querySelector('[data-visit-field=qty]'),complete=line.querySelector('[data-visit-complete]');
   if(complete)complete.onchange=()=>{row.qty=complete.checked?(row.partial=row.qty,maxQty(item,lastVersion(selected))):row.partial??0;qty.value=row.qty;persist();};
   line.querySelectorAll('[data-visit-field]').forEach(input=>{input.oninput=()=>{
    const field=input.dataset.visitField;row[field]=input.value;
    if(field==='hours'){row.manual=true;line.querySelector('[data-visit-preview]').textContent=input.value?input.value+' чел·ч':'—';}
    if(field==='qty'&&item.kind==='material')line.querySelector('[data-visit-preview]').textContent=input.value?input.value+' '+item.unit:'—';
    if(field==='qty'&&complete)complete.checked=maxQty(item,lastVersion(selected))>0&&nonnegative(row.qty)===maxQty(item,lastVersion(selected));
    updateMetrics();persist();
   };});
  });
 }
 restore();render();
 return {select:switchTrip};
}
