import {openEntityPanel} from './entity-actions.js';
import {distanceText} from './core/journal-display.js';
import {readRoadModel,saveRoadModel} from './journal-road.js';
import {paymentLabel,roadPaymentView} from './payment-terms.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const real=value=>value!=null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const product=(km,rate)=>rate===null?null:round(km*rate);
const sum=rows=>rows.some(value=>value===null)?null:round(rows.reduce((total,value)=>total+value,0));
const metrics={revenue:'Приход',cost:'Расход'};

function ratesFor(model,row,request){
 const view=roadPaymentView(model,row,request),{payer,warranty}=view.effective;
 const profiles=model.tariffs.tariff_profiles||[],override=row.rates||{};
 const job=request&&model.item.jobs.find(job=>job.id===request);
 const defaultProfile=profiles.find(profile=>profile[warranty==='warranty'?'def_warranty':'def_paid']);
 const defaultRate=real(defaultProfile?.road?.km_rate)??real(model.tariffs.tariffs?.km);
 const baseCost=real(model.tariffs.costs?.km);
 let baseRevenue=null;
 if(payer?.startsWith('client:')){
  const billedJob=model.item.jobs.find(job=>job.id===payer.slice(7))||job;
  const configured=billedJob?.profiles?.[warranty];
  baseRevenue=real(profiles.find(profile=>profile.id===configured)?.road?.km_rate)??defaultRate;
 }else if(payer==='warranty-dept'){
  baseRevenue=real(profiles.find(profile=>profile.id===payer)?.road?.km_rate)??real(profiles.find(profile=>profile.def_warranty)?.road?.km_rate);
 }else if(payer==='service'){
  baseRevenue=real(profiles.find(profile=>profile.id===payer)?.road?.km_rate);
 }
 return {revenue:real(override.revenue)??baseRevenue,cost:real(override.cost)??baseCost,payer:paymentLabel(view,'payer',payer)};
}

export function calculateRoadAccounting(model,fact,scope=null){
 if(scope&&(scope.lower==null||scope.upper==null))return {rows:[],measured:null,outside:0,unmeasured:true,total:null,revenue:null,cost:null};
 const portion=km=>scope?round(km*Number(scope.upper))-round(km*Number(scope.lower)):Number(km);
 let unmeasured=false;
 const rows=model.sections.map(row=>{
  const charges=Object.entries(row.shares).filter(([request])=>!scope||request===scope.request_id)
   .map(([request,km])=>({km:portion(km),...ratesFor(model,row,request)})).filter(part=>part.km>0);
  const assigned=round(charges.reduce((total,part)=>total+part.km,0));
  const pending=row.km==null?null:Math.max(0,round(row.km-assigned));
  const defaults=ratesFor(model,row);
  const revenue=row.km==null?null:sum(charges.map(part=>product(part.km,part.revenue)));
  const cost=!scope&&round(row.measured_km-assigned)>0?product(round(row.measured_km-assigned),defaults.cost):0;
  const combinedCost=sum([cost,...charges.map(part=>product(part.km,part.cost))]);
  unmeasured ||= row.km==null;
  const revenueRates=[...new Set((charges.length?charges:[defaults]).map(part=>part.revenue))];
  return {...row,assigned,pending,computed:{revenue,cost:combinedCost},defaults:{...defaults,revenue:revenueRates.length===1?revenueRates[0]:null}};
 });
 const measured=round(rows.reduce((total,row)=>total+Number(scope?row.assigned:row.measured_km),0));
 const outside=scope||fact==null?0:Math.max(0,round(Number(fact)-measured));
 return {rows,measured,outside,unmeasured,total:round(measured+outside),
  revenue:sum(rows.map(row=>row.computed.revenue)),
  cost:sum([...rows.map(row=>row.computed.cost),outside>0?product(outside,real(model.tariffs.costs?.km)):0])};
}

export async function mountRoadAccounting(root,{db,trip,currency,current,onOpen}){
 root.hidden=true;
 let model;
 try{model=await readRoadModel(db,trip.id);}catch(error){
  if(current()){root.hidden=false;root.textContent=error.message||'Не удалось загрузить расчёт дороги';}return;
 }
 if(!current()||!model?.tariffs||!model.sections.length)return;
 root.hidden=false;
 const cash=value=>value===null?'—':fmt.format(value)+' '+currency;
 function paint(){
  const data=calculateRoadAccounting(model,trip.fact_km);
  root.innerHTML=`<h3>Фактическая дорога по участкам</h3><div class="road-accounting-totals"><span>Пробег <strong>${distanceText(data.total)}</strong></span><span>Приход <strong>${esc(cash(data.revenue))}</strong></span><span>Расход <strong>${esc(cash(data.cost))}</strong></span></div>
   ${data.unmeasured?'<p class="hint">В записи есть участки без подтверждённой длины.</p>':''}
   ${data.outside>0?`<p class="hint">${distanceText(data.outside)} подтверждённого пробега вне участков · без заявки</p>`:''}
   <details open><summary>Тарифы и суммы по участкам</summary><div class="road-accounting-scroll">
   <table class="journal-road-shares" aria-label="Тарифы по участкам"><thead><tr><th>Участок</th><th>Пробег</th><th>Приход</th><th>Расход</th><th><span class="sr-only">Изменение тарифа</span></th></tr></thead><tbody>
   ${data.rows.map((row,index)=>`<tr><th scope="row"><button type="button" class="journal-road-select" data-road-accounting-open="${index}">${esc(row.title)}</button><span class="hint">${esc(row.defaults.payer)}</span></th>
    <td>${distanceText(row.km)}</td><td>${esc(cash(row.computed.revenue))}</td><td>${esc(cash(row.computed.cost))}</td>
    <td>${model.editable?`<button type="button" class="btn ghost" data-road-rate="${index}" aria-label="Изменить тарифы · ${esc(row.title)}">Изменить</button>`:''}</td></tr>`).join('')}
   </tbody></table></div></details>`;
  root.querySelectorAll('[data-road-accounting-open]').forEach(button=>{button.onclick=()=>onOpen?.(data.rows[Number(button.dataset.roadAccountingOpen)]);});
  root.querySelectorAll('[data-road-rate]').forEach(button=>{button.onclick=()=>edit(data.rows[Number(button.dataset.roadRate)],button);});
 }
 function edit(row,trigger){
  const panel=root.ownerDocument.createElement('section');panel.hidden=true;panel.className='journal-road-editor';
  panel.innerHTML=`<div class="journal-road-editor-fields">${Object.entries(metrics).map(([key,title])=>
   `<label>${title}, ${esc(currency)}/км<input type="text" inputmode="decimal" data-rate="${key}" value="${row.rates?.[key]==null?'':row.rates[key]}" placeholder="${esc(row.defaults[key]===null?'Тариф не задан':fmt.format(row.defaults[key])+' · по расчёту')}"></label>`).join('')}</div>`;
  root.append(panel);
  openEntityPanel({title:'Тарифы · '+row.title,panel,trigger,dispose:true,saveLabel:'Сохранить тарифы',saveHint:'Пустое поле применяет расчётный тариф.',onSave:async()=>{
   if(!current())return false;
   const rates={};
   for(const field of panel.querySelectorAll('[data-rate]')){
    const value=field.value.trim();
    if(!value)continue;
    if(!/^\d+(?:[,.]\d{1,2})?$/.test(value))throw Error('Введите тариф с точностью до сотых');
    rates[field.dataset.rate]=Number(value.replace(',','.'));
   }
   model=await saveRoadModel(db,model,row.id,'rates',rates);return true;
  },onSaved:()=>{if(current())paint();}});
 }
 paint();
}
