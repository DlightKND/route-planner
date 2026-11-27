import {openEntityPanel} from './entity-actions.js';

const keys=['warranty','payer'];
const warranties={paid:'Вне гарантии',warranty:'Гарантийная'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Payers are tariff profiles from settings; the stored value is the profile id.
const profilesOf=model=>model?.profiles||model?.tariffs?.tariff_profiles||[];
const known=(profiles,id)=>!!id&&profiles.some(profile=>profile.id===id);
const flagged=(profiles,warranty)=>profiles.filter(profile=>profile[warranty==='warranty'?'def_warranty':'def_paid']).map(profile=>profile.id).sort()[0]||null;
// Default payer of a request: the profile its works were billed to, the client profile for paid work, then the flagged default.
export function defaultPayer(job,warranty,profiles){
 const billed=job?.profiles?.[warranty==='warranty'?'warranty':'paid'];
 if(known(profiles,billed))return billed;
 if(warranty!=='warranty'&&known(profiles,job?.default_profile))return job.default_profile;
 return flagged(profiles,warranty);
}
// Local terms from the request down to the card itself; the most specific value wins.
function resolve(job,chain,profiles){
 const pick=key=>chain.reduceRight((found,local)=>found||local?.[key]||null,null);
 const warranty=pick('warranty')||'paid';
 return {warranty,payer:pick('payer')||defaultPayer(job,warranty,profiles)};
}
// A work profile chosen by hand (not the default it would get anyway) is the work's own payer.
const manualProfile=(job,work,profiles)=>known(profiles,work?.tariff_profile)&&work.tariff_profile!==defaultPayer({...job,profiles:null},work.billable===false?'warranty':'paid',profiles)?{payer:work.tariff_profile}:{};
const different=(local,parent)=>keys.some(key=>local[key]&&local[key]!==parent[key]);
const requestOrigin=job=>job?'Из заявки · '+job.title:'';

export function paymentView(model,workId){
 if(!model)return null;
 const {scope,item,editable}=model,profiles=profilesOf(model);
 if(workId){
  const work=item.works?.find(row=>row.id===workId);
  if(!work)return null;
  const chain=[item.job?.local,item.local,manualProfile(item.job,work,profiles)];
  return makeView('work',item.id,work,item.job?[item.job]:[],resolve(item.job,chain,profiles),resolve(item.job,[...chain,work.local],profiles),editable,'Из задания №'+item.number,profiles);
 }
 if(scope==='job')return makeView('job',item.id,item,[item],resolve(item,[],profiles),resolve(item,[item.local],profiles),editable,'',profiles);
 if(scope==='order')return makeView('order',item.id,item,item.job?[item.job]:[],resolve(item.job,[item.job?.local],profiles),resolve(item.job,[item.job?.local,item.local],profiles),editable,requestOrigin(item.job),profiles);
 const jobs=item.jobs||[];
 return makeView('trip',item.id,item,jobs,tripTerms(jobs,[],profiles),tripTerms(jobs,[item.local],profiles),editable,jobs.length===1?requestOrigin(jobs[0]):jobs.length?'По связанным заявкам':'',profiles);
}

function tripTerms(jobs,extra,profiles){
 if(!jobs.length)return resolve(null,extra,profiles);
 const values=jobs.map(job=>resolve(job,[job.local,...extra],profiles));
 return Object.fromEntries(keys.map(key=>[key,values.every(value=>value[key]===values[0][key])?values[0][key]:'mixed']));
}

export function roadPaymentView(model,section,request){
 const jobs=model.item.jobs||[],allocated=Object.keys(section.shares||{}),profiles=profilesOf(model);
 const jobId=request===undefined?(allocated.length===1?allocated[0]:null):request;
 const job=jobs.find(row=>row.id===jobId),scope=job?[job]:jobs;
 return makeView('road',model.item.id,section,jobs,tripTerms(scope,[model.item.local],profiles),tripTerms(scope,[model.item.local,section.local],profiles),model.editable,'Из выезда',profiles);
}

function makeView(scope,id,item,jobs,parent,effective,editable,origin,profiles){
 const local=item.local||{};
 const payers=Object.fromEntries(profiles.map(profile=>[profile.id,profile.name]));
 const names={warranty:{...warranties,mixed:'Смешанные условия'},payer:{...payers,mixed:'Разные плательщики'}};
 return {scope,id,subject:['work','road'].includes(scope)?item.id:'',item,editable,origin,local,parent,effective,names,
  options:{warranty:warranties,payer:payers},exception:scope!=='job'&&different(local,parent)};
}

export function paymentExceptions(model){
 const rows=[],profiles=profilesOf(model);
 for(const item of model.scope==='order'?[model.item]:model.orders||[]){
  const scope={scope:'order',item,profiles};
  if(model.scope==='job'&&paymentView(scope).exception)rows.push({scope:'order',id:item.id,label:'Задание №'+item.number});
  for(const work of item.works||[])if(paymentView(scope,work.id)?.exception)rows.push({scope:'work',id:item.id,work:work.id,label:work.title});
 }
 if(model.scope==='job')for(const trip of model.trips||[]){
  if(different(trip.local||{},resolve(model.item,[model.item.local],profiles)))rows.push({scope:'trip',id:trip.id,label:trip.title});
 }
 for(const road of model.roads||[]){
  const item=model.scope==='trip'?model.item:{...road.item,jobs:road.item.jobs.map(job=>job.id===model.item.id?model.item:job)};
  for(const section of road.sections)if(roadPaymentView({item,profiles:profilesOf(road).length?profilesOf(road):profiles},section,model.scope==='job'?model.item.id:undefined).exception)
   rows.push({scope:'road',id:item.id,roadId:section.id,label:'Участок · '+section.title});
 }
 return rows;
}

const labels={warranty:'Гарантия',payer:'Плательщик'};
export const paymentLabel=(view,key,value)=>view.names[key][value]||(key==='payer'?'Не выбран':'Не указана');
const label=paymentLabel;
const readout=view=>'<dl class="payment-term-values">'+keys.map(key=>`<div><dt>${labels[key]}</dt><dd>${esc(label(view,key,view.effective[key]))}</dd></div>`).join('')+'</dl>';
const controls=view=>'<div class="payment-term-fields">'+keys.map(key=>{
 const fallback=view.scope==='job'?(key==='payer'?'По умолчанию · '+label(view,key,view.parent.payer):'Вне гарантии'):'Наследовать · '+label(view,key,view.parent[key]);
 return `<label>${labels[key]}<select data-payment-field="${key}"><option value="">${esc(fallback)}</option>${Object.entries(view.options[key])
  .map(([id,title])=>`<option value="${esc(id)}" ${view.local[key]===id?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
}).join('')+'</div>';
const readControls=root=>Object.fromEntries([...root.querySelectorAll('[data-payment-field]')].filter(field=>field.value).map(field=>[field.dataset.paymentField,field.value]));

export function workPaymentCue(view){
 if(!view)return '';
 return `<span class="hint payment-work-cue${view.exception?' payment-term-exception':''}">${esc(keys.map(key=>label(view,key,view.effective[key])).join(' · '))}${view.exception?' · Свои условия':''}</span>`;
}

export function inlinePaymentHTML(view){
 if(!view)return '';
 const work=view.scope==='work';
 return `<section class="payment-inline" ${work?'data-work-payment':'data-road-payment'}="${esc(view.subject)}" aria-label="Условия оплаты">
  <div class="payment-inline-head"><h4>Условия оплаты</h4><span class="hint${view.exception?' payment-term-exception':''}">${view.exception?'Задано здесь':esc(view.origin)}</span></div>
  ${view.editable?controls(view)+`<div class="payment-inline-actions">${Object.keys(view.local).length?`<button type="button" class="btn ghost" data-payment-reset>Вернуть условия ${work?'задания':'выезда'}</button>`:''}<button type="button" class="btn" data-payment-save>Сохранить условия</button></div><p class="err" role="alert" hidden></p>`:readout(view)}</section>`;
}

export async function readPaymentModel(db,scope,id){
 const {data,error}=await db.rpc('entity_payment_terms_read',{p_scope:scope,p_id:id});
 if(error&&!['PGRST202','42883'].includes(error.code))throw error;
 return data?.scope===scope&&data.item?.id===id?data:null;
}

export async function savePaymentModel(db,view,terms){
 const {data,error}=await db.rpc('entity_payment_terms_save',{p_scope:view.scope,p_id:view.id,p_subject:view.subject,p_previous:view.local,p_terms:terms});
 if(error)throw error;
 view.item.local=data;
}

export function bindInlinePayment(element,view,save,onSaved){
 if(!view?.editable)return;
 const status=element.querySelector('[role=alert]'),controls=[...element.querySelectorAll('select,button')];
 const submit=async terms=>{
  controls.forEach(control=>{control.disabled=true;});status.hidden=true;
  try{await save(view,terms);onSaved();}
  catch(error){status.textContent=error.message||'Не удалось сохранить условия';status.hidden=false;}
  finally{controls.forEach(control=>{control.disabled=false;});}
 };
 element.querySelector('[data-payment-save]').onclick=()=>submit(readControls(element));
 const reset=element.querySelector('[data-payment-reset]');if(reset)reset.onclick=()=>submit({});
}

// One line of the card's terms above its works table (mockup v65): warranty, payer and where they come from.
export function paymentScopeSummaryHTML(model){
 const view=paymentView(model);if(!view)return '';
 const note=view.exception?`Свои условия · ${view.origin||'заданы здесь'}`:view.origin;
 return `<div class="payment-scope-summary"><div><strong>${esc(label(view,'warranty',view.effective.warranty))}</strong><span>${esc(label(view,'payer',view.effective.payer))}</span>${note?`<span class="hint${view.exception?' payment-term-exception':''}">${esc(note)}</span>`:''}</div>${view.editable?'<button type="button" class="btn" data-payment-scope-edit>Изменить условия</button>':''}</div>`;
}
// The card's terms editor as a dialog, from any trigger.
export function editPaymentTerms({doc,model,save,trigger,onSaved}){
 const view=paymentView(model);if(!view?.editable)return null;
 const panel=doc.createElement('section');panel.hidden=true;panel.className='payment-card-editor';panel.innerHTML=controls(view);doc.body.append(panel);
 return openEntityPanel({title:'Условия оплаты',panel,trigger,dispose:true,saveLabel:'Сохранить условия',saveHint:'',onSave:()=>save(view,readControls(panel)),onSaved});
}
export function mountPaymentCard({root,model,save,onOpen,onChange}){
 if(!root)return;
 const view=paymentView(model);root.hidden=!view;
 if(!view){root.innerHTML='';return;}
 const exceptions=paymentExceptions(model);
 const links=exceptions.map((row,index)=>`<button type="button" class="btn ghost" data-payment-exception="${index}">${esc(row.label)}</button>`).join('');
 const note=view.exception?`Свои условия · ${view.origin||'заданы в выезде'}`:view.origin||(view.scope==='job'?'Эти условия наследуют задания и выезды.':'');
 root.innerHTML=`<header class="payment-inline-head"><h3>Условия оплаты</h3>${view.editable?'<button type="button" class="btn ghost" data-payment-card-edit>Изменить условия</button>':''}</header>${readout(view)}
  ${note?`<p class="hint${view.exception?' payment-term-exception':''}">${esc(note)}</p>`:''}
  ${exceptions.length===1?`<div class="payment-exceptions"><strong>Исключение в условиях</strong>${links}</div>`:exceptions.length?`<details class="payment-exceptions"><summary>Исключения в условиях · ${exceptions.length}</summary>${links}</details>`:''}`;
 root.querySelectorAll('[data-payment-exception]').forEach(button=>{button.onclick=()=>onOpen?.(exceptions[Number(button.dataset.paymentException)]);});
 const edit=root.querySelector('[data-payment-card-edit]');
 if(edit)edit.onclick=()=>{
  editPaymentTerms({doc:root.ownerDocument,model,save,trigger:edit,onSaved:()=>{mountPaymentCard({root,model,save,onOpen,onChange});onChange?.();}});
 };
}
