import {calculateRoadAccounting} from './journal-road-accounting.js';
import {saveRoadModel} from './journal-road.js';
import {distanceText} from './core/journal-display.js';
import {journalIcon} from './journal-icons.js';

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

export function mountEntityFinance(root,{db,scope,id,current,onTrip,onGPS,onOrder,onReport,onReady,onAllocate}){
 let model,request=0,view=null,saving=false,searchText='',attentionOnly=false;
 const disclosures=new Set(['labor','mileage']);
 root.hidden=true;
 async function load(){
  if(root.querySelector('[data-finance-editor-row]'))return;
  const version=++request;
  try{
   const result=await readFinance(db(),scope,id);
   if(!current()||version!==request||!result)return;
   const initial=!model;
   model=result;root.hidden=false;root.dataset.financeReady='';render();
   if(initial)onReady?.();
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
 const moneyRow=([label,plan,fact])=>`<tr><th scope="row">${label}</th><td>${esc(cash(plan))}</td><td>${esc(cash(fact))}</td><td>${difference(plan,fact)}</td></tr>`;
 const table=(rows,name)=>`<div class="scoped-finance-scroll"><table aria-label="${name}"><thead><tr><th scope="col">Показатель</th><th scope="col">План</th><th scope="col">Факт</th><th scope="col">Δ</th></tr></thead>
   <tbody>${rows.filter(row=>row[0]!=='Результат').map(moneyRow).join('')}</tbody>
   ${rows.some(row=>row[0]==='Результат')?`<tfoot>${moneyRow(rows.find(row=>row[0]==='Результат'))}</tfoot>`:''}</table></div>`;
 const disclosure=(key,title,html)=>`<details data-finance-section="${key}" ${disclosures.has(key)?'open':''}><summary>${title}</summary>${html}</details>`;
 function render(){
  view??=root.ownerDocument.defaultView.matchMedia('(max-width:760px)').matches?'tables':'charts';
  const data=calculateEntityFinance(model);
  const sections=data.mileage.flatMap((trip,index)=>trip.sections.map(section=>({trip,index,section})));
  const scale=Math.max(1,...data.summary.flatMap(([,plan,fact])=>[Math.abs(plan||0),Math.abs(fact||0)]));
  root.innerHTML=`<div class="scoped-finance-head" aria-label="Плановые и фактические суммы">
   ${Object.entries(data.modes).map(([key,value])=>`<section class="scoped-finance-money"><header><h3>${modeTitles[key]}</h3>
     ${value.corrected?'<span class="scoped-finance-status">Итог скорректирован</span>':value.partial?'<span class="scoped-finance-status">Данные неполные</span>':''}</header>
     <dl>${Object.keys(metricTitles).map(metric=>`<div><dt>${metricTitles[metric]}</dt><dd><strong>${value[metric]==null?'—':format.format(value[metric])}</strong>${value[metric]==null?'':' <span>'+esc(model.currency)+'</span>'}</dd></div>`).join('')}</dl></section>`).join('')}
   </div>
   <div class="scoped-finance-layout"><div class="scoped-finance-work-column" ${data.works.length||data.mileage.length?'':'hidden'}>
    ${data.works.length?workTable(data.works):''}
    ${scope==='order'&&data.mileage.length?tripContributions(data.works,data.mileage):''}
    ${data.mileage.length?mileageTable(data.mileage):''}
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
    ${onAllocate&&data.mileage.length?allocationActions(data.mileage):''}
   </section></div>`;
  root.querySelectorAll('details[data-finance-section]').forEach(node=>{node.ontoggle=()=>node.open?disclosures.add(node.dataset.financeSection):disclosures.delete(node.dataset.financeSection);});
  root.querySelectorAll('[data-finance-mode]').forEach(button=>{button.onclick=()=>{view=button.dataset.financeMode;
   root.querySelectorAll('[data-finance-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
   root.querySelectorAll('[data-finance-view]').forEach(el=>{el.hidden=el.dataset.financeView!==view;});
  };});
  root.querySelectorAll('[data-finance-trip]').forEach(button=>{button.onclick=()=>onTrip?.(data.mileage[Number(button.dataset.financeTrip)]);});
  root.querySelectorAll('[data-finance-gps]').forEach(button=>{button.onclick=()=>onGPS?.(button.dataset.financeGps);});
  root.querySelectorAll('[data-finance-mileage-toggle]').forEach(button=>{button.onclick=()=>{
   const key=button.getAttribute('aria-controls'),detail=root.ownerDocument.getElementById(key);
   const open=detail.hidden;detail.hidden=!open;button.setAttribute('aria-expanded',String(open));
   if(open)disclosures.add(key);else disclosures.delete(key);
  };});
  root.querySelectorAll('[data-finance-source]').forEach(button=>{button.onclick=()=>onTrip?.({id:button.dataset.financeSource});});
  root.querySelectorAll('[data-finance-order]').forEach(button=>{button.onclick=()=>onOrder?.(button.dataset.financeOrder);});
  root.querySelectorAll('[data-finance-report]').forEach(button=>{button.onclick=()=>onReport?.(button.dataset.financeReport);});
  root.querySelectorAll('[data-finance-allocate]').forEach(button=>{button.onclick=()=>onAllocate?.(data.mileage[Number(button.dataset.financeAllocate)]);});
  root.querySelectorAll('[data-finance-rate]').forEach(button=>{button.onclick=()=>editRates(data.works[Number(button.dataset.financeRate)],button);});
  root.querySelectorAll('[data-finance-road-rate]').forEach(button=>{button.onclick=()=>editRoadRate(sections[Number(button.dataset.financeRoadRate)],button);});
  root.querySelectorAll('[data-finance-total]').forEach(button=>{button.onclick=()=>editTotal(button.dataset.financeTotal,data,button);});
  wireWorkTable();
 }
 const units=value=>value==null?'—':format.format(value);
 function allocationActions(trips){
  const button=(index,label)=>`<button type="button" class="btn" data-finance-allocate="${index}">${esc(label)}</button>`;
  return trips.length===1?`<div class="scoped-finance-allocation">${button(0,'Распределить расходы')}</div>`:
   disclosure('allocation','Распределить расходы',`<div class="scoped-finance-allocation">${trips.map((trip,i)=>button(i,trip.title||trip.date||'Выезд')).join('')}</div>`);
 }
 function tripContributions(works,trips){
  const byTrip=trips.map(trip=>knownSum(works.flatMap(work=>(work.sources||[]).filter(source=>source.trip===trip.id).map(source=>amount(source.hours)))));
  return `<section class="scoped-finance-work"><header><h3>Вклад по выездам</h3></header>
   <div class="scoped-finance-scroll"><table aria-label="Вклад по выездам"><thead><tr><th>Выезд</th><th>Принято, чел·ч</th><th>Результат</th></tr></thead>
    <tbody>${trips.map((trip,i)=>`<tr><th scope="row"><button type="button" class="btn ghost" data-finance-trip="${i}">${esc(trip.title||trip.date||'Выезд')}</button></th><td>${units(byTrip[i])}</td>
     <td><button class="btn ghost" type="button" data-finance-report="${esc(trip.id)}">${byTrip[i]==null?'Открыть работы':'Смотреть результат'}</button></td></tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Итого</th><td>${units(knownSum(byTrip))}</td><td></td></tr></tfoot></table></div></section>`;
 }
 function mileageTable(trips){
  const trip=scope==='trip'?trips[0]:null;
  const sections=trip?.sections.filter(section=>section.mode==='fact')||[];
  if(trip&&!sections.length)sections.push(...trip.sections.filter(section=>section.mode==='plan'));
  const bySection=sections.length>0,title=bySection?'Пробег по участкам':'Пробег по выездам';
  const rows=bySection?sections.map(section=>`<tr><th scope="row">${esc(section.title)}</th>
   <td>${section.mode==='plan'?units(section.km):'—'}</td><td>${section.mode==='fact'?units(section.km):'—'}</td></tr>`):
   trips.map((row,index)=>{
    const title=esc(row.title||row.date||'Выезд'),key='finance-mileage-'+scope+'-'+id+'-'+row.id,expanded=disclosures.has(key);
    return `<tr><th scope="row"><button type="button" class="btn ghost" data-finance-trip="${index}">${title}</button></th>
     <td>${units(row.plan_km)}</td><td>${units(row.actual)}</td><td><button type="button" class="btn ghost" data-finance-mileage-toggle
     aria-controls="${esc(key)}" aria-expanded="${expanded}" aria-label="Пробег выезда · ${title}">${journalIcon('chevron')}</button></td></tr>
     <tr class="scoped-finance-work-detail" id="${esc(key)}" ${expanded?'':'hidden'}><td colspan="4">
     <header class="scoped-finance-work-detail-head"><h4>Пробег выезда</h4>
     ${onGPS?`<button type="button" class="btn ghost" data-finance-gps="${esc(row.id)}">Журнал GPS</button>`:''}</header>
     <table aria-label="Детали пробега"><thead><tr><th scope="col">Показатель</th><th scope="col">План, км</th><th scope="col">Факт, км</th></tr></thead>
      <tbody><tr><th scope="row">Пробег всего</th><td>${units(row.plan_km)}</td><td>${units(row.fact_km??(row.whole||row.plan_km!=null?row.actual:null))}</td></tr>
      ${row.whole?'':`<tr><th scope="row">${scope==='job'?'Пробег по заявке':'Пробег по заданию'}</th><td>${units(row.plan_km)}</td><td>${units(row.actual)}</td></tr>`}</tbody>
     </table></td></tr>`;
   });
  return disclosure('mileage',title,`<div class="scoped-finance-scroll"><table aria-label="${title}">
   <thead><tr><th scope="col">${bySection?'Участок':'Выезд'}</th><th scope="col">План, км</th><th scope="col">Факт, км</th>${bySection?'':'<th scope="col"><span class="sr-only">Детали</span></th>'}</tr></thead>
   <tbody>${rows.join('')}</tbody><tfoot><tr><th scope="row">${trip?'Всего по выезду':'Итого'}</th>
    <td>${units(knownSum(trips.map(row=>amount(row.plan_km))))}</td><td>${units(knownSum(trips.map(row=>amount(row.actual))))}</td>${bySection?'':'<td></td>'}</tr></tfoot>
   </table></div>`);
 }
 function workTable(rows){
  const grouped=scope!=='order',groups=new Map();
  for(const row of rows){
   const key=grouped?row.order_id:row.id;
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(row);
  }
  const attention=row=>Number(row.pending_count)>0||Number(row.fact_hours)>Number(row.plan_hours);
  const planHours=row=>row.plan_in_scope===false?null:amount(row.plan_hours);
  const accepted=row=>`${units(row.fact_qty)} из ${units(row.snapshot_qty)} ${esc(row.unit||'')}`;
  const flagged=[...groups.values()].filter(works=>works.some(attention)).length;
  return `<details class="scoped-finance-work" data-finance-section="labor" ${disclosures.has('labor')?'open':''}><summary>Трудозатраты по работам</summary>
   <header><label><span class="sr-only">Найти работу</span><input type="search" data-finance-work-search value="${esc(searchText)}" placeholder="Работа, задание или заявка"></label>
    <button type="button" class="btn" aria-pressed="${attentionOnly}" data-finance-work-alert>Внимание <span class="scoped-finance-work-cue">${flagged}</span></button></header>
   <p class="hint" data-finance-work-count role="status"></p>
   <div class="scoped-finance-scroll"><table aria-label="Трудозатраты по работам">
    <thead><tr><th scope="col">${grouped?'Задание':'Работа'}</th><th scope="col">План, н-ч</th><th scope="col">Факт, чел·ч</th>
     ${grouped?'':'<th scope="col">Принятый объём</th><th scope="col">Состояние</th>'}<th scope="col"><span class="sr-only">Источники</span></th></tr></thead><tbody>
    ${[...groups].map(([key,works])=>{
     const [row]=works,plan=knownSum(works.map(planHours)),fact=knownSum(works.map(work=>amount(work.fact_hours)));
     const complete=work=>Number(work.fact_qty)>=Number(work.snapshot_qty);
     const excess=Number(row.fact_hours)>Number(row.plan_hours),pending=Number(row.pending_count)>0;
     const status=excess?'Перерасход +'+units(round(row.fact_hours-row.plan_hours)):
      pending?'На приёмке':complete(row)?'Выполнена':row.fact_hours==null?'Ожидает факта':'В работе';
     const number='Задание №'+esc(row.number),detailId='finance-work-'+esc(scope)+'-'+esc(key);
     const search=[row.number,row.order_title,...works.map(work=>work.title)].join(' ').toLocaleLowerCase('ru');
     const summary=grouped?esc(row.order_title||number):esc(row.title),open=disclosures.has(detailId);
     const details=grouped?`<header class="scoped-finance-work-detail-head"><h4>Работы задания №${esc(row.number)}</h4>
       <button type="button" class="btn ghost" data-finance-order="${esc(row.order_id)}">Открыть работы</button></header>
       <table aria-label="Работы задания №${esc(row.number)}"><thead><tr><th>Работа</th><th>План, н-ч</th><th>Факт, чел·ч</th><th>Принято</th></tr></thead>
        <tbody>${works.map(work=>`<tr><th scope="row">${esc(work.title)}</th><td>${units(planHours(work))}</td>
         <td>${units(work.fact_hours)}</td><td>${accepted(work)}</td></tr>`).join('')}</tbody></table>`:
      `<h4>Источники результата</h4>${row.sources?.length?
       `<table aria-label="Источники результата"><thead><tr><th scope="col">Выезд</th><th scope="col">Факт, чел·ч</th><th scope="col">Принято</th></tr></thead>
       <tbody>${row.sources.map(source=>
       `<tr><th scope="row"><button type="button" class="btn ghost" data-finance-source="${esc(source.trip)}">Открыть выезд</button><small class="hint">${esc(String(source.at||'').slice(0,10))}</small></th>
        <td>${units(source.hours)}</td><td>${units(source.qty)} ${esc(row.unit||'')}</td></tr>`).join('')}</tbody>
       <tfoot><tr><th scope="row">Итого</th><td>${units(row.fact_hours)}</td><td></td></tr></tfoot></table>`:
       '<p class="hint">Принятых результатов пока нет.</p>'}`;
     return `<tr data-finance-work-row data-attention="${works.some(attention)}" data-search="${esc(search)}" data-plan="${plan??''}" data-fact="${fact??''}">
      <th scope="row">${summary}<small class="hint">${number}${grouped?' · Выполнено '+works.filter(complete).length+' из '+works.length:''}</small></th>
      <td data-caption="План, н-ч">${units(plan)}</td><td data-caption="Факт, чел·ч">${units(fact)}</td>
      ${grouped?'':`<td data-caption="Принятый объём">${accepted(row)}</td><td data-caption="Состояние"><span class="${excess||pending?'scoped-finance-work-cue':''}">${status}</span></td>`}
      <td><button type="button" class="btn ghost" data-finance-work-toggle aria-expanded="${open}" aria-controls="${detailId}"
       aria-label="${grouped?'Работы задания №'+esc(row.number):'Источники работы «'+esc(row.title)+'»'}"><span aria-hidden="true">⌄</span></button></td></tr>
      <tr class="scoped-finance-work-detail" id="${detailId}" ${open?'':'hidden'}><td colspan="${grouped?4:6}">${details}</td></tr>`;
    }).join('')}
    </tbody><tfoot><tr><th scope="row" data-finance-work-total>Итого</th><td data-finance-work-plan></td><td data-finance-work-fact></td><td colspan="${grouped?1:3}"></td></tr></tfoot>
   </table></div><p class="hint" data-finance-work-empty hidden>Работ по этому фильтру нет.</p></details>`;
 }
 function wireWorkTable(){
  const input=root.querySelector('[data-finance-work-search]');if(!input)return;
  const alert=root.querySelector('[data-finance-work-alert]'),rows=[...root.querySelectorAll('[data-finance-work-row]')];
  const count=root.querySelector('[data-finance-work-count]'),footer=input.closest('.scoped-finance-work').querySelector('.scoped-finance-scroll>table>tfoot');
  const table=footer.closest('table');
  table.classList.toggle('scoped-finance-by-work',scope==='order');
  const total=(shown,key)=>knownSum(shown.map(row=>amount(row.dataset[key])));
  function filter(){
   searchText=input.value;
   attentionOnly=alert.getAttribute('aria-pressed')==='true';
   const query=searchText.trim().toLocaleLowerCase('ru');
   for(const row of rows){
    row.hidden=!row.dataset.search.includes(query)||attentionOnly&&row.dataset.attention!=='true';
    const detail=row.nextElementSibling;
    detail.hidden=row.hidden||!disclosures.has(detail.id);
   }
   const shown=rows.filter(row=>!row.hidden);
   count.textContent='Показано '+shown.length+' из '+rows.length;
   root.querySelector('[data-finance-work-empty]').hidden=shown.length>0;footer.hidden=!shown.length;
   footer.querySelector('[data-finance-work-total]').textContent=query||attentionOnly?'Итого по фильтру':'Итого';
   for(const key of ['plan','fact']){
    const sum=total(shown,key);footer.querySelector('[data-finance-work-'+key+']').textContent=sum==null?'—':format.format(sum);
   }
  }
  input.oninput=filter;
  alert.onclick=()=>{alert.setAttribute('aria-pressed',String(alert.getAttribute('aria-pressed')!=='true'));filter();};
  for(const button of table.querySelectorAll('[data-finance-work-toggle]')){
   button.onclick=()=>{
    const key=button.getAttribute('aria-controls'),open=disclosures.has(key);
    if(open)disclosures.delete(key);else disclosures.add(key);
    button.setAttribute('aria-expanded',String(!open));
    filter();
   };
  }
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
    <div><span class="hint">Расчёт, ${esc(model.currency)}</span><strong>${base==null?'—':format.format(base)}</strong></div>
    <label>Согласовано, ${esc(model.currency)}<input data-finance-value type="text" inputmode="decimal" value="${financeValue(previous.value??base)}"></label>
    <div><span class="hint">Разница, ${esc(model.currency)}</span><strong data-finance-delta>${difference(base,previous.value??base)}</strong></div>
   </div><label>Причина<textarea rows="2" maxlength="1000" data-finance-reason>${esc(previous.reason||'')}</textarea></label>
   <p class="hint scoped-finance-correction-note">Корректировка применяется к итогу этой карточки.</p>`,
   trigger,panel=>{
    const value=decimal(panel.querySelector('[data-finance-value]').value),reason=panel.querySelector('[data-finance-reason]').value.trim();
    if(value==null)throw Error('Введите согласованную сумму');
    if(!reason)throw Error('Укажите причину корректировки');
    return save(scope,key,previous,{value,reason});
   },previous.value!=null?()=>save(scope,key,previous,{}):null,'Вернуть расчёт','Сохранить');
  if(panel){
   panel.classList.add('scoped-finance-total-editor');
   const input=panel.querySelector('[data-finance-value]');
   input.oninput=()=>{panel.querySelector('[data-finance-delta]').textContent=difference(base,decimal(input.value));};
  }
 }
 return {load};
}
