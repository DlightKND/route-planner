import {calculateRoadAccounting} from './journal-road-accounting.js';
import {saveRoadModel} from './journal-road.js';
import {distanceText} from './core/journal-display.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const modeTitles={plan:'План',fact:'Факт'},metricTitles={revenue:'Приход',cost:'Расход'};
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const amount=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const knownSum=values=>values.some(value=>value!=null)?round(values.reduce((sum,value)=>sum+(value??0),0)):null;
const product=(quantity,rate)=>quantity===0?0:quantity==null||rate==null?null:round(quantity*rate);
const difference=(plan,fact)=>plan==null||fact==null?'—':(fact>plan?'+':'')+format.format(round(fact-plan));
const financeValue=value=>value==null?'':String(value).replace('.',',');

function plannedRevenue(line,pricing){
 const baseline=amount(line.base_revenue);
 const terms=line.terms||{},payer=terms.payer,warranty=terms.warranty||(line.billable===false?'warranty':'paid');
 if(!payer&&!terms.warranty)return baseline;
 if(!line.hourly)return !payer&&warranty===(line.billable===false?'warranty':'paid')?baseline:null;
 const profiles=pricing?.profiles||[];
 const profile=payer==='service'?profiles.find(p=>p.id===payer):
  payer==='warranty-dept'?profiles.find(p=>p.id===payer)||profiles.find(p=>p.def_warranty):
  profiles.find(p=>p.id===line.tariff_profile)||profiles.find(p=>p[warranty==='warranty'?'def_warranty':'def_paid']);
 const rate=amount(profile?.[warranty==='warranty'?'work_warr':'work_paid']?.rate);
 return rate??(!payer||payer.startsWith('client:')?warranty==='paid'?amount(pricing?.tariffs?.hour):baseline:null);
}
function calculateLine(line,pricing){
 const planQty=amount(line.plan_qty),factQty=amount(line.fact_qty),baseRevenue=amount(line.base_revenue),baseCost=amount(line.base_cost);
 if(line.kind==='material')return {...line,computed:{
  plan:{revenue:product(planQty,baseRevenue),cost:product(planQty,baseCost)},
  fact:{revenue:product(factQty,baseRevenue),cost:product(factQty,baseCost)}
 }};
 const hourlyCost=amount(line.hour_cost),originalQty=amount(line.snapshot_qty),planHours=amount(line.plan_hours);
 const planTime=originalQty>0&&planHours!=null?planHours*planQty/originalQty:null;
 const factHours=amount(line.fact_hours),acceptedQty=amount(line.accepted_qty)||0;
 const planRevenue=plannedRevenue(line,pricing);
 const planCostRate=amount(line.rates?.plan?.cost),factCostRate=amount(line.rates?.fact?.cost);
 const fallbackCost=amount(line.hourly?hourlyCost:baseCost);
 const fallbackQuantity=line.hourly?factQty:Math.max(0,factQty-acceptedQty);
 const manualQuantity=Math.max(0,factQty-acceptedQty);
 const approvedCost=factHours==null?null:product(factHours,factCostRate??hourlyCost);
 const manualCost=manualQuantity===0?0:product(manualQuantity,factCostRate!=null?(line.hourly?factCostRate:null):fallbackCost);
 const factCost=factHours==null?product(fallbackQuantity,factCostRate!=null?(line.hourly?factCostRate:null):fallbackCost):
  approvedCost==null||manualCost==null?null:round(approvedCost+manualCost);
 return {...line,defaults:{plan:{revenue:planRevenue,cost:hourlyCost},fact:{revenue:baseRevenue,cost:hourlyCost}},
  computed:{
   plan:{revenue:product(planQty,amount(line.rates?.plan?.revenue)??planRevenue),
    cost:planQty===0?0:planTime==null?planCostRate==null?product(planQty,baseCost):null:product(planTime,planCostRate??hourlyCost)},
   fact:{revenue:product(factQty,amount(line.rates?.fact?.revenue)??baseRevenue),cost:factCost}
  }};
}
function calculateTrip(row){
 const scope=row.whole?null:row;
 const book=row.road?.tariffs?calculateRoadAccounting(row.road,row.fact_km,scope):null;
 const planLegs=row.plan_legs||[];
 const planKm=planLegs.reduce((sum,section)=>sum+Number(section.km),0);
 const basePlan={revenue:amount(row.plan_revenue),cost:amount(row.plan_cost)};
 const baseRates=Object.fromEntries(Object.entries(basePlan).map(([metric,value])=>[metric,value!=null&&planKm>0?value/planKm:null]));
 const planSections=planLegs.map(section=>({...section,defaults:baseRates,mode:'plan'}));
 const plan=Object.fromEntries(Object.entries(basePlan).map(([metric,baseline])=>{
  const changed=planSections.filter(section=>section.rates?.[metric]!=null);
  if(!changed.length)return [metric,baseline];
  if(baseline==null)return [metric,changed.length===planSections.length
   ?knownSum(changed.map(section=>product(section.km,section.rates[metric]))):null];
  const delta=changed.reduce((sum,section)=>sum+section.km*(section.rates[metric]-baseRates[metric]),0);
  return [metric,round(baseline+delta)];
 }));
 return {...row,computed:{
  plan,
  fact:{revenue:book?book.revenue:null,cost:amount(row.approved_cost)??(book?book.cost:amount(row.legacy_fact_cost))}
 },actual:book?book.total:amount(row.legacy_fact_km),
  sections:[...planSections,...(book?.rows.filter(section=>row.whole||section.assigned>0)||[]).map(section=>({...section,mode:'fact'}))],
  incomplete:!!book?.unmeasured||!!book?.rows.some(section=>section.returning&&(section.km==null||section.pending>0)&&!section.local?.payer&&!row.road.item.local?.payer)};
}

export function calculateEntityFinance(model){
 const lines=model.lines.map(line=>calculateLine(line,model.pricing)),mileage=model.trips.map(calculateTrip);
 const works=lines.filter(line=>line.kind!=='material'),materials=lines.filter(line=>line.kind==='material');
 const extras=amount(model.extra_parts_cost)||0;
 const breakdown=[
  ['Приход от работ',works,'revenue'],
  ['Приход от запчастей',materials,'revenue'],
  ['Приход от пробега',mileage,'revenue'],
  ['Расход на труд',works,'cost'],
  ['Расход на запчасти',materials,'cost',extras],
  ['Расход на выезды',mileage,'cost']
 ].map(([label,rows,metric,extra])=>[label,...Object.keys(modeTitles).map(mode=>
  knownSum([...rows.map(row=>row.computed[mode][metric]),...(extra&&mode==='fact'?[extra]:[])]))]);
 const affecting=[...lines,...mileage];
 const workProgress=new Map();
 for(const row of works){
  const key=row.root_id||row.id,progress=workProgress.get(key)||{plan:0,fact:0};
  progress.plan+=Number(row.plan_qty)||0;progress.fact+=Number(row.fact_qty)||0;workProgress.set(key,progress);
 }
 const workIncomplete=[...workProgress.values()].some(row=>row.fact<row.plan);
 const calculated=Object.fromEntries(Object.keys(modeTitles).map((mode,index)=>[mode,{
  revenue:knownSum(breakdown.slice(0,3).map(row=>row[index+1])),
  cost:knownSum(breakdown.slice(3).map(row=>row[index+1])),
  partial:affecting.some(row=>row.computed[mode].revenue==null||row.computed[mode].cost==null)
   ||mode==='fact'&&(mileage.some(row=>row.incomplete)||workIncomplete)
 }]));
 const modes=Object.fromEntries(Object.keys(modeTitles).map(key=>[key,{
  ...calculated[key],...Object.fromEntries(Object.keys(metricTitles).filter(metric=>model.corrections[key+':'+metric])
   .map(metric=>[metric,amount(model.corrections[key+':'+metric].value)])),
  corrected:Object.keys(metricTitles).some(metric=>model.corrections[key+':'+metric])
 }]));
 const result=mode=>mode.partial||mode.revenue==null||mode.cost==null?null:round(mode.revenue-mode.cost);
 return {lines,works,mileage,calculated,modes,breakdown,
  summary:[['Приход',modes.plan.revenue,modes.fact.revenue],['Расход',modes.plan.cost,modes.fact.cost],
   ['Результат',result(modes.plan),result(modes.fact)]]};
}

async function readFinance(db,scope,id){
 const {data,error}=await db.rpc('entity_finance_read',{p_scope:scope,p_id:id});
 if(error&&!['PGRST202','42883'].includes(error.code))throw error;
 return data?.scope===scope&&data.id===id?data:null;
}
const decimal=value=>/^\d{1,12}(?:[,.]\d{1,2})?$/.test(value.trim())?Number(value.trim().replace(',','.')):null;

export function mountEntityFinance(root,{db,scope,id,current,onTrip}){
 let model,request=0,view=null,saving=false;
 const disclosures=new Set();
 root.hidden=true;
 async function load(){
  if(root.querySelector('[data-finance-editor-row]'))return;
  const version=++request;
  try{
   const result=await readFinance(db(),scope,id);
   if(!current()||version!==request||!result)return;
   model=result;root.hidden=false;render();
  }catch(error){
   if(!current()||version!==request)return;
   root.hidden=false;root.innerHTML='<p class="err" role="alert">'+esc(error.message||'Экономика недоступна')+'</p><button class="btn ghost" type="button">Обновить расчёт</button>';
   root.querySelector('button').onclick=load;
  }
 }
 function cash(value){return value==null?'—':format.format(value)+' '+model.currency;}
 async function save(target,subject,previous,value,parent=id){
  if(!current())return false;
  if(saving)throw Error('Дождитесь сохранения');
  saving=true;
  try{
   const {data,error}=await db().rpc('entity_finance_adjust',{p_scope:target,p_id:parent,p_subject:subject,p_previous:previous,p_value:value});
   if(error)throw error;
   if(!current())return false;
   if(target==='work')model.lines.find(line=>line.id===subject).rates=data;
   else if(target==='road_plan')model.trips.find(trip=>trip.id===parent).plan_legs.find(leg=>leg.id===subject).rates=data;
   else if(Object.keys(data).length)model.corrections[subject]=data;
   else delete model.corrections[subject];
   return true;
  }finally{saving=false;}
 }
 const table=(rows,name)=>`<div class="scoped-finance-scroll"><table aria-label="${name}"><thead><tr><th>Показатель</th><th>План</th><th>Факт</th><th>Δ</th></tr></thead><tbody>
   ${rows.map(([label,plan,fact])=>`<tr><th scope="row">${label}</th><td>${esc(cash(plan))}</td><td>${esc(cash(fact))}</td><td>${difference(plan,fact)}</td></tr>`).join('')}</tbody></table></div>`;
 const disclosure=(key,title,html)=>`<details data-finance-section="${key}" ${disclosures.has(key)?'open':''}><summary>${title}</summary>${html}</details>`;
 function render(){
  view??=root.ownerDocument.defaultView.matchMedia('(max-width:760px)').matches?'tables':'charts';
  const data=calculateEntityFinance(model);
  const sections=data.mileage.flatMap((trip,index)=>trip.sections.map(section=>({trip,index,section})));
  const scale=Math.max(1,...data.summary.flatMap(([,plan,fact])=>[Math.abs(plan||0),Math.abs(fact||0)]));
  root.innerHTML=`<div class="scoped-finance-head" aria-label="Плановые и фактические суммы">
   ${Object.entries(data.modes).map(([key,value])=>`<section class="card scoped-finance-money"><header><h3>${modeTitles[key]}</h3>
     ${value.corrected?'<span class="hint payment-term-exception">Итог скорректирован</span>':value.partial?'<span class="hint payment-term-exception">Данные неполные</span>':''}</header>
     <dl>${Object.keys(metricTitles).map(metric=>`<div><dt>${metricTitles[metric]}</dt><dd><strong>${value[metric]==null?'—':format.format(value[metric])}</strong>${value[metric]==null?'':' <span>'+esc(model.currency)+'</span>'}</dd></div>`).join('')}</dl></section>`).join('')}
   </div>
   <div class="scoped-finance-layout"><div class="scoped-finance-work-column" ${data.works.length||data.mileage.length?'':'hidden'}>
    ${data.works.length?workTable(data.works):''}
    ${data.mileage.length?disclosure('mileage','Пробег по выездам',`<div class="scoped-finance-scroll"><table aria-label="Пробег по выездам">
      <thead><tr><th>Выезд</th><th>План</th><th>Факт</th></tr></thead><tbody>${data.mileage.map((row,index)=>`<tr>
      <th scope="row"><button type="button" class="btn ghost" data-finance-trip="${index}">${esc(row.title||row.date||'Выезд')}</button></th>
      <td>${distanceText(row.plan_km)}</td><td>${distanceText(row.actual)}</td></tr>`).join('')}</tbody></table></div>`):''}
   </div>
   <section class="card scoped-finance-details"><header><h3>Экономика</h3><div class="seg" role="group" aria-label="Представление экономики">
    ${[['charts','Диаграммы'],['tables','Таблицы']].map(([key,title])=>`<button type="button" data-finance-mode="${key}" aria-pressed="${view===key}">${title}</button>`).join('')}</div></header>
    <div class="scoped-finance-chart" data-finance-view="charts" ${view==='charts'?'':'hidden'}>
     ${data.summary.map(([title,plan,fact])=>`<section><h4>${title}</h4>${[['plan',plan],['fact',fact]].map(([key,value])=>`<div>
       <span>${modeTitles[key]}</span><span class="scoped-finance-bar" aria-hidden="true"><i class="${key}${value<0?' negative':''}" style="width:${Math.abs(value||0)/scale*100}%"></i></span>
       <strong>${esc(cash(value))}</strong></div>`).join('')}</section>`).join('')}
    </div>
    <div data-finance-view="tables" ${view==='tables'?'':'hidden'}>${table(data.summary,'Экономика · план и факт')}</div>
    ${disclosure('breakdown','Из чего сложились суммы',table(data.breakdown,'Статьи прихода и расхода'))}
    ${data.works.length||sections.length?disclosure('rates','Тарифы',`<div class="scoped-finance-scroll"><table aria-label="Тарифы по работам и дороге">
     <thead><tr><th>Позиция и плательщик</th><th>Ставки</th><th><span class="sr-only">Действия</span></th></tr></thead><tbody>
     ${data.works.map((row,index)=>`<tr><th scope="row">${esc(row.title)}<small class="hint">Задание №${esc(row.number)}</small></th>
       <td>${Object.keys(metricTitles).map(metric=>metricTitles[metric]+' '+cash(row.rates?.plan?.[metric]??row.defaults.plan[metric])).map(esc).join(' · ')}
       ${row.rates?.plan||row.rates?.fact?'<small class="hint payment-term-exception">Тариф задан вручную</small>':''}</td>
       <td>${row.editable?`<button class="btn" type="button" data-finance-rate="${index}" aria-label="Изменить тарифы · ${esc(row.title)}">Изменить</button>`:''}</td></tr>`).join('')}
     ${sections.map(({trip,section},index)=>`<tr><th scope="row">Дорога · ${esc(section.title)}<small class="hint">${modeTitles[section.mode]} · ${esc(section.defaults.payer||distanceText(section.km))}</small></th>
       <td>${Object.keys(metricTitles).map(metric=>metricTitles[metric]+' '+cash(section.rates?.[metric]??section.defaults[metric])).map(esc).join(' · ')}
       ${Object.keys(section.rates||{}).length?'<small class="hint payment-term-exception">Тариф задан вручную</small>':''}</td>
       <td>${(section.mode==='plan'?trip.plan_editable:trip.road.editable)?`<button class="btn" type="button" data-finance-road-rate="${index}" aria-label="Изменить тарифы · ${esc(section.title)}">Изменить</button>`:''}</td></tr>`).join('')}
     </tbody></table></div>`):''}
    ${disclosure('totals','Корректировки итогов',Object.entries(modeTitles).flatMap(([mode,heading])=>Object.entries(metricTitles).map(([metric,title])=>{
     const key=mode+':'+metric,override=model.corrections[key];
     return `<div class="scoped-finance-total"><div><strong>${title}</strong><small class="hint">${heading}</small></div><div><strong>${esc(cash(data.modes[mode][metric]))}</strong>
      ${override?`<small class="hint payment-term-exception">Вручную · ${esc(override.reason)}</small>`:''}</div>
      ${model.editable?`<button type="button" class="btn" data-finance-total="${key}" aria-label="Изменить итог · ${title} · ${heading}">Изменить</button>`:''}</div>`;
    })).join(''))}
   </section></div>`;
  root.querySelectorAll('details[data-finance-section]').forEach(node=>{node.ontoggle=()=>node.open?disclosures.add(node.dataset.financeSection):disclosures.delete(node.dataset.financeSection);});
  root.querySelectorAll('[data-finance-mode]').forEach(button=>{button.onclick=()=>{view=button.dataset.financeMode;
   root.querySelectorAll('[data-finance-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
   root.querySelectorAll('[data-finance-view]').forEach(el=>{el.hidden=el.dataset.financeView!==view;});
  };});
  root.querySelectorAll('[data-finance-trip]').forEach(button=>{button.onclick=()=>onTrip?.(data.mileage[Number(button.dataset.financeTrip)]);});
  root.querySelectorAll('[data-finance-source]').forEach(button=>{button.onclick=()=>onTrip?.({id:button.dataset.financeSource});});
  root.querySelectorAll('[data-finance-rate]').forEach(button=>{button.onclick=()=>editRates(data.works[Number(button.dataset.financeRate)],button);});
  root.querySelectorAll('[data-finance-road-rate]').forEach(button=>{button.onclick=()=>editRoadRate(sections[Number(button.dataset.financeRoadRate)],button);});
  root.querySelectorAll('[data-finance-total]').forEach(button=>{button.onclick=()=>editTotal(button.dataset.financeTotal,data,button);});
  wireWorkTable();
 }
 function workTable(rows){
  const units=value=>value==null?'—':format.format(value);
  const flagged=rows.filter(row=>Number(row.pending_count)>0||Number(row.fact_hours)>Number(row.plan_hours)).length;
  return `<section class="card scoped-finance-work">
   <header><h3>Трудозатраты по работам</h3><label><span class="sr-only">Найти работу</span><input type="search" data-finance-work-search placeholder="Работа или задание"></label>
    <button type="button" class="btn" aria-pressed="false" data-finance-work-alert>Внимание · ${flagged}</button></header>
   <p class="hint" data-finance-work-count role="status"></p>
   <div class="scoped-finance-scroll"><table aria-label="Трудозатраты по работам">
    <thead><tr><th>Работа</th><th>План, н-ч</th><th>Факт, чел·ч</th><th>Принято</th></tr></thead><tbody>
    ${rows.map(row=>{
     const excess=Number(row.fact_hours)>Number(row.plan_hours);
     const alert=excess||Number(row.pending_count)>0;
     return `<tr data-finance-work-row data-attention="${alert}" data-search="${esc((row.title+' '+row.number).toLocaleLowerCase('ru'))}"
      data-plan="${row.plan_in_scope===false?'':row.plan_hours??''}" data-fact="${row.fact_hours??''}"><th scope="row">
      ${esc(row.title)}<small class="hint">Задание №${esc(row.number)}</small>
      ${excess?`<small class="hint payment-term-exception">Перерасход +${units(round(row.fact_hours-row.plan_hours))}</small>`:''}
      ${Number(row.pending_count)>0?'<small class="hint payment-term-exception">На приёмке</small>':''}
      ${row.sources?.length?`<details class="scoped-finance-sources"><summary>Источники результата</summary>${row.sources.map(source=>
       `<small class="hint">${esc(String(source.at||'').slice(0,10))} · ${units(source.hours)} чел·ч · ${units(source.qty)} ${esc(row.unit||'')}
        <button type="button" class="btn ghost" data-finance-source="${esc(source.trip)}">Открыть выезд</button></small>`).join('')}</details>`:''}</th>
      <td>${row.plan_in_scope===false?'—':units(row.plan_hours)}</td><td>${units(row.fact_hours)}</td>
      <td>${units(row.fact_qty)} из ${units(row.snapshot_qty)} ${esc(row.unit||'')}</td></tr>`;
    }).join('')}
    </tbody><tfoot><tr><th scope="row" data-finance-work-total>Итого</th><td data-finance-work-plan></td><td data-finance-work-fact></td><td></td></tr></tfoot>
   </table></div><p class="hint" data-finance-work-empty hidden>Работ по этому фильтру нет.</p></section>`;
 }
 function wireWorkTable(){
  const input=root.querySelector('[data-finance-work-search]');if(!input)return;
  const alert=root.querySelector('[data-finance-work-alert]'),rows=[...root.querySelectorAll('[data-finance-work-row]')];
  const count=root.querySelector('[data-finance-work-count]'),footer=root.querySelector('.scoped-finance-work tfoot');
  const total=(shown,key)=>knownSum(shown.map(row=>amount(row.dataset[key])));
  function filter(){
   const query=input.value.trim().toLocaleLowerCase('ru'),attention=alert.getAttribute('aria-pressed')==='true';
   for(const row of rows)row.hidden=!row.dataset.search.includes(query)||attention&&row.dataset.attention!=='true';
   const shown=rows.filter(row=>!row.hidden);
   count.textContent='Показано '+shown.length+' из '+rows.length;
   root.querySelector('[data-finance-work-empty]').hidden=shown.length>0;footer.hidden=!shown.length;
   footer.querySelector('[data-finance-work-total]').textContent=query||attention?'Итого по фильтру':'Итого';
   for(const key of ['plan','fact']){
    const sum=total(shown,key);footer.querySelector('[data-finance-work-'+key+']').textContent=sum==null?'—':format.format(sum);
   }
  }
  input.oninput=filter;
  alert.onclick=()=>{alert.setAttribute('aria-pressed',String(alert.getAttribute('aria-pressed')!=='true'));filter();};
  filter();
 }
 function panelEditor(title,html,trigger,submit,reset,resetLabel,saveLabel){
  if(saving)return null;
  root.querySelector('[data-finance-editor-row]')?.remove();
  const doc=root.ownerDocument,row=trigger.closest('tr')||trigger.closest('.scoped-finance-total');
  const wrap=doc.createElement(row.tagName==='TR'?'tr':'div');
  wrap.dataset.financeEditorRow='';
  const panel=doc.createElement('form');panel.className='scoped-finance-editor';panel.setAttribute('aria-label',title);
  panel.innerHTML=`<h4>${esc(title)}</h4>${html}<p class="err" role="alert" hidden></p>
   <div class="payment-inline-actions"><button type="button" class="btn ghost" data-finance-cancel>Отмена</button>
    ${reset?`<button type="button" class="btn ghost" data-finance-reset>${resetLabel}</button>`:''}
    <button type="submit" class="btn amber" data-finance-save>${saveLabel}</button></div>`;
  if(row.tagName==='TR'){
   const cell=doc.createElement('td');cell.colSpan=3;cell.append(panel);wrap.append(cell);
  }else wrap.append(panel);
  row.after(wrap);
  const buttonType=[...trigger.attributes].find(attribute=>/^data-finance-/.test(attribute.name));
  const focus=()=>{
   const next=[...root.querySelectorAll('button['+buttonType.name+']')]
    .find(button=>button.getAttribute(buttonType.name)===buttonType.value);
   next?.focus({preventScroll:true});
  };
  const controls=[...panel.querySelectorAll('input,textarea,button')];
  const message=panel.querySelector('[role=alert]');
  const commit=async action=>{
   message.hidden=true;controls.forEach(control=>{control.disabled=true;});
   try{if(await action()&&current()){render();focus();}}
   catch(error){message.textContent=error.message;message.hidden=false;}
   finally{controls.forEach(control=>{control.disabled=false;});}
  };
  panel.onsubmit=event=>{event.preventDefault();void commit(()=>submit(panel));};
  panel.querySelector('[data-finance-cancel]').onclick=()=>{wrap.remove();focus();};
  const restore=panel.querySelector('[data-finance-reset]');if(restore)restore.onclick=()=>commit(reset);
  panel.querySelector('input')?.focus({preventScroll:true});
  return panel;
 }
 function editRates(row,trigger){
  const previous=row.rates||{};
  const units={revenue:model.currency+'/ед.',cost:model.currency+'/чел·ч'};
  panelEditor('Тарифы · '+row.title,`<div class="scoped-finance-rates">${Object.entries(modeTitles).map(([mode,title])=>`<fieldset><legend>${title}</legend>
   ${Object.entries(metricTitles).map(([metric,name])=>`<label>${name}, ${esc(units[metric])}
    <input data-rate-mode="${mode}" data-rate-metric="${metric}" type="text" inputmode="decimal" value="${financeValue(previous[mode]?.[metric])}"
     placeholder="${esc(row.defaults[mode][metric]==null?'По расчёту':format.format(row.defaults[mode][metric]))}"></label>`).join('')}</fieldset>`).join('')}</div>`,
  trigger,panel=>{
   const next={};
   for(const input of panel.querySelectorAll('[data-rate-mode]')){
    if(!input.value.trim())continue;
    const value=decimal(input.value);
    if(value==null)throw Error('Укажите неотрицательный тариф с точностью до сотых');
    (next[input.dataset.rateMode]??={})[input.dataset.rateMetric]=value;
   }
   return save('work',row.id,previous,next,row.order_id);
  },Object.keys(previous).length?()=>save('work',row.id,previous,{},row.order_id):null,'Вернуть тарифы','Сохранить тарифы');
 }
 function editRoadRate({trip,index,section},trigger){
  const previous=section.rates||{};
  const saveRates=async value=>{
   if(section.mode==='plan')return save('road_plan',section.id,previous,value,trip.id);
   if(!current())return false;
   if(saving)throw Error('Дождитесь сохранения');
   saving=true;
   try{
    const road=await saveRoadModel(db(),trip.road,section.id,'rates',value);
    if(!current())return false;
    model.trips[index].road=road;
    return true;
   }finally{saving=false;}
  };
  panelEditor('Тарифы · '+section.title,`<fieldset class="scoped-finance-road-rates"><legend>${modeTitles[section.mode]}</legend>
   ${Object.entries(metricTitles).map(([key,name])=>`<label>${name}, ${esc(model.currency)}/км
    <input data-road-rate-metric="${key}" type="text" inputmode="decimal" value="${financeValue(previous[key])}"
    placeholder="${esc(section.defaults[key]==null?'Тариф не задан':format.format(section.defaults[key]))}"></label>`).join('')}
   </fieldset>`,trigger,panel=>{
    const next={};
    for(const input of panel.querySelectorAll('[data-road-rate-metric]')){
     if(!input.value.trim())continue;
     const value=decimal(input.value);
     if(value==null)throw Error('Укажите неотрицательный тариф с точностью до сотых');
     next[input.dataset.roadRateMetric]=value;
    }
    return saveRates(next);
   },Object.keys(previous).length?()=>saveRates({}):null,'Вернуть тарифы','Сохранить тарифы');
 }
 function editTotal(key,data,trigger){
  const [mode,metric]=key.split(':'),base=data.calculated[mode][metric],previous=model.corrections[key]||{};
  const panel=panelEditor('Корректировка · '+metricTitles[metric]+' · '+modeTitles[mode],`<div class="scoped-finance-delta">
    <div><span class="hint">Расчёт</span><strong>${esc(cash(base))}</strong></div>
    <label>Согласовано, ${esc(model.currency)}<input data-finance-value type="text" inputmode="decimal" value="${financeValue(previous.value??base)}"></label>
    <div><span class="hint">Разница</span><strong data-finance-delta>${difference(base,previous.value??base)}</strong></div>
   </div><label>Причина<textarea rows="2" maxlength="1000" data-finance-reason>${esc(previous.reason||'')}</textarea></label>`,
   trigger,panel=>{
    const value=decimal(panel.querySelector('[data-finance-value]').value),reason=panel.querySelector('[data-finance-reason]').value.trim();
    if(value==null)throw Error('Введите согласованную сумму');
    if(!reason)throw Error('Укажите причину корректировки');
    return save(scope,key,previous,{value,reason});
   },previous.value!=null?()=>save(scope,key,previous,{}):null,'Вернуть расчёт','Сохранить');
  if(panel){const input=panel.querySelector('[data-finance-value]');input.oninput=()=>{panel.querySelector('[data-finance-delta]').textContent=difference(base,decimal(input.value));};}
 }
 return {load};
}
