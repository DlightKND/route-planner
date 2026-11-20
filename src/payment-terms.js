import {openEntityPanel} from './entity-actions.js';

const keys=['warranty','payer'];
const warranties={paid:'Вне гарантии',warranty:'Гарантийная'};
const departments={'warranty-dept':'Гарантийный отдел',service:'Сервисный отдел'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requestTerms=job=>job?{warranty:'paid',payer:'client:'+job.id,...job.local}:{warranty:null,payer:null};
const different=(local,parent)=>keys.some(key=>local[key]&&local[key]!==parent[key]);
const requestOrigin=job=>job?'Из заявки · '+job.title:'';

export function paymentView(model,workId){
 if(!model)return null;
 const {scope,item,editable}=model;
 if(workId){
  const work=item.works?.find(row=>row.id===workId);
  if(!work)return null;
  return makeView('work',item.id,work,item.job?[item.job]:[],{...requestTerms(item.job),...item.local},editable,'Из задания №'+item.number);
 }
 if(scope==='job')return makeView('job',item.id,item,[item],{warranty:'paid',payer:'client:'+item.id},editable,'');
 if(scope==='order')return makeView('order',item.id,item,item.job?[item.job]:[],requestTerms(item.job),editable,requestOrigin(item.job));
 const jobs=item.jobs||[],values=jobs.map(requestTerms);
 const parent=Object.fromEntries(keys.map(key=>[key,!values.length?null:values.every(value=>value[key]===values[0][key])?values[0][key]:'mixed']));
 return makeView('trip',item.id,item,jobs,parent,editable,jobs.length===1?requestOrigin(jobs[0]):jobs.length?'По связанным заявкам':'');
}

function makeView(scope,id,item,jobs,parent,editable,origin){
 const local=item.local||{};
 const clients=Object.fromEntries(jobs.map(job=>['client:'+job.id,job.title]));
 const payerNames={...clients,...departments,mixed:'Разные плательщики'};
 const effective={...parent,...local};
 const names={warranty:{...warranties,mixed:'Смешанные условия'},payer:payerNames};
 return {scope,id,subject:scope==='work'?item.id:'',item,editable,origin,local,parent,effective,names,
  options:{warranty:warranties,payer:{...clients,...departments}},exception:scope!=='job'&&different(local,parent)};
}

export function paymentExceptions(model){
 const rows=[];
 for(const item of model.scope==='order'?[model.item]:model.orders||[]){
  const scope={scope:'order',item};
  if(model.scope==='job'&&paymentView(scope).exception)rows.push({scope:'order',id:item.id,label:'Задание №'+item.number});
  for(const work of item.works||[])if(paymentView(scope,work.id)?.exception)rows.push({scope:'work',id:item.id,work:work.id,label:work.title});
 }
 if(model.scope==='job')for(const trip of model.trips||[]){
  if(different(trip.local||{},requestTerms(model.item)))rows.push({scope:'trip',id:trip.id,label:trip.title});
 }
 return rows;
}

const labels={warranty:'Гарантия',payer:'Плательщик'};
const label=(view,key,value)=>view.names[key][value]||(key==='payer'?'Не выбран':'Не указана');
const readout=view=>'<dl class="payment-term-values">'+keys.map(key=>`<div><dt>${labels[key]}</dt><dd>${esc(label(view,key,view.effective[key]))}</dd></div>`).join('')+'</dl>';
const controls=view=>'<div class="payment-term-fields">'+keys.map(key=>{
 const fallback=view.scope==='job'?(key==='payer'?'Клиент заявки':'Вне гарантии'):'Наследовать · '+label(view,key,view.parent[key]);
 return `<label>${labels[key]}<select data-payment-field="${key}"><option value="">${esc(fallback)}</option>${Object.entries(view.options[key])
  .map(([id,title])=>`<option value="${esc(id)}" ${view.local[key]===id?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
}).join('')+'</div>';
const readControls=root=>Object.fromEntries([...root.querySelectorAll('[data-payment-field]')].filter(field=>field.value).map(field=>[field.dataset.paymentField,field.value]));

export function workPaymentCue(view){
 if(!view)return '';
 return `<span class="hint payment-work-cue${view.exception?' payment-term-exception':''}">${esc(keys.map(key=>label(view,key,view.effective[key])).join(' · '))}${view.exception?' · Свои условия':''}</span>`;
}

export function workPaymentHTML(view){
 if(!view)return '';
 return `<section class="payment-inline" data-work-payment="${esc(view.subject)}" aria-label="Условия оплаты">
  <div class="payment-inline-head"><h4>Условия оплаты</h4><span class="hint${view.exception?' payment-term-exception':''}">${view.exception?'Задано здесь':esc(view.origin)}</span></div>
  ${view.editable?controls(view)+`<div class="payment-inline-actions">${Object.keys(view.local).length?'<button type="button" class="btn ghost" data-payment-reset>Вернуть условия задания</button>':''}<button type="button" class="btn" data-payment-save>Сохранить условия</button></div><p class="err" role="alert" hidden></p>`:readout(view)}</section>`;
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

export function bindWorkPayment(element,view,save,onSaved){
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
  const panel=root.ownerDocument.createElement('section');panel.hidden=true;panel.className='payment-card-editor';panel.innerHTML=controls(view);root.append(panel);
  openEntityPanel({title:'Условия оплаты',panel,trigger:edit,dispose:true,saveLabel:'Сохранить условия',saveHint:'',
   onSave:()=>save(view,readControls(panel)),onSaved:()=>{mountPaymentCard({root,model,save,onOpen,onChange});onChange?.();}});
 };
}
