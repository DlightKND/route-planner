// Справочник: клиенты → точки → техника → сервисная история (26.11.2026).
//
// Клиент — организация (public.customers). Точка — место на карте
// (public.clients: заявки, техника и маршруты ссылаются на неё). Техника стоит
// на точке. Сервисная история техники собирается из заявок на неё, их заданий,
// визитов и замеров моточасов.

const STATUS={open:'открыта',planned:'запланирована',in_progress:'в работе',done:'закрыта',cancelled:'отменена'};
const ORDER_STATUS={draft:'черновик',assigned:'назначено',in_progress:'в работе',paused:'на паузе',review:'на проверке',completed:'выполнено',done:'выполнено',closed:'закрыто',cancelled:'отменено'};
const num=v=>{const n=Number(v);return Number.isFinite(n)?String(Math.round(n*100)/100).replace('.',','):'—';};
const dateText=v=>{if(!v)return '';const d=new Date(String(v).length<=10?v+'T12:00:00':v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});};
const dayKey=v=>String(v||'').slice(0,10);

export function createReferenceDirectory(ctx){
 const {esc,$,renderCatalogTable}=ctx;
 // Клиент Supabase появляется после входа — берём его в момент запроса.
 const sb={from:t=>ctx.db().from(t),rpc:(n,a)=>ctx.db().rpc(n,a)};
 let customers=[],customersError=null,customersLoaded=false,customerEditId=null,eqCardId=null,historyToken=0;

 const points=()=>(ctx.points()||[]).filter(p=>!p.is_base&&!p.deleted_at);
 const equipment=()=>Object.values(ctx.eqByPoint()||{}).flat().filter(e=>!e.deleted_at);
 const customerOf=point=>customers.find(c=>c.id===point?.customer_id)||null;
 const pointsOf=id=>points().filter(p=>p.customer_id===id);
 const eqOf=pointIds=>equipment().filter(e=>pointIds.includes(e.client_id));
 const pointName=id=>(ctx.points()||[]).find(p=>p.id===id)?.name||'—';
 const eqLabel=e=>[e.model||'Техника',e.serial?'№ '+e.serial:''].filter(Boolean).join(' · ');
 const warrantyUntil=e=>{if(e.factory_warranty_until)return e.factory_warranty_until;const m=(ctx.models()||[]).find(x=>x.id===e.model_id);if(!m?.warranty_months||!e.installed_on)return null;const d=new Date(e.installed_on+'T12:00:00');d.setMonth(d.getMonth()+Number(m.warranty_months));return d.toISOString().slice(0,10);};

 async function loadCustomers(){
  const {data,error}=await sb.from('customers').select('*').is('deleted_at',null).order('name');
  if(error){customersError=error;customersLoaded=false;throw error;}
  customers=data||[];customersError=null;customersLoaded=true;return customers;
 }
 async function ensureCustomers(){if(!customersLoaded)await loadCustomers();return customers;}

 // ---------- Клиенты ----------
 async function renderCustomers(){
  const box=$('custList');if(!box)return;
  try{await ensureCustomers();}catch(e){ctx.listLoadError(box,e,renderCustomers);return;}
  const q=($('custSearch')?.value||'').trim().toLowerCase();
  const rows=customers.map(c=>{const pts=pointsOf(c.id);return {...c,points:pts.length,equipment:eqOf(pts.map(p=>p.id)).length};})
   .filter(c=>!q||[c.name,c.legal_name,c.tax_id,c.phone,c.contact_person].some(v=>String(v||'').toLowerCase().includes(q)));
  renderCatalogTable(box,{label:'Клиенты',scope:'customers',rows,rowClass:'emrow',rowLabel:c=>c.name,
   empty:customers.length?'По запросу ничего не найдено.':'Клиентов пока нет. Добавьте первого клиента.',columns:[
    {key:'name',label:'Клиент',value:c=>c.name,render:c=>'<button type="button" class="catalog-record-link" data-cust-open="'+esc(c.id)+'">'+esc(c.name)+'</button>'+(c.legal_name&&c.legal_name!==c.name?'<small class="ref-sub">'+esc(c.legal_name)+'</small>':'')},
    {key:'contact',label:'Контакт',value:c=>[c.contact_person,c.phone].filter(Boolean).join(' · ')||null},
    {key:'points',label:'Точки',type:'number',value:c=>c.points},
    {key:'equipment',label:'Техника',type:'number',value:c=>c.equipment}
   ],actions:[{attribute:'data-cust-open',label:'Открыть',run:openCustomer},...(ctx.canWrite()?[{attribute:'data-cust-del',label:'Удалить клиента',danger:true,run:deleteCustomer}]:[])]});
 }

 function fillCustomer(c){
  for(const [id,key] of [['custName','name'],['custLegal','legal_name'],['custTax','tax_id'],['custPhone','phone'],['custEmail','email'],['custContact','contact_person'],['custNotes','notes']])$(id).value=c?.[key]||'';
  $('custErr').textContent='';
 }
 function paintCustomerLinks(){
  const id=customerEditId,pts=id?pointsOf(id):[],eqs=eqOf(pts.map(p=>p.id)),may=ctx.canWrite();
  $('custLinks').hidden=!id;
  $('custPoints').innerHTML=pts.length?'<ul class="ref-list">'+pts.map(p=>{const n=eqOf([p.id]).length;return '<li><button type="button" class="ref-link" data-cust-point="'+esc(p.id)+'"><b>'+esc(p.name)+'</b><small>'+esc([p.address,n?n+' ед. техники':'техники нет'].filter(Boolean).join(' · '))+'</small></button>'
   +(may?'<button type="button" class="btn ghost" data-cust-unlink="'+esc(p.id)+'" aria-label="Отвязать точку '+esc(p.name)+'">Отвязать</button>':'')+'</li>';}).join('')+'</ul>'
   :'<p class="hint">Точек нет. Привяжите существующую или поставьте новую на карте.</p>';
  $('custEquipment').innerHTML=eqs.length?'<ul class="ref-list">'+eqs.map(e=>'<li><button type="button" class="ref-link" data-cust-eq="'+esc(e.id)+'"><b>'+esc(eqLabel(e))+'</b><small>'+esc([pointName(e.client_id),e.last_service?'ТО '+dateText(e.last_service):''].filter(Boolean).join(' · '))+'</small></button></li>').join('')+'</ul>'
   :'<p class="hint">Техники на точках клиента нет.</p>';
  const free=points().filter(p=>p.customer_id!==id).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
  $('custAttach').hidden=!may;
  $('custAttachPoint').innerHTML='<option value="">— выбрать точку —</option>'+free.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(p.customer_id?' · сейчас: '+esc(customerOf(p)?.name||'другой клиент'):' · без клиента')+'</option>').join('');
  $('custPoints').querySelectorAll('[data-cust-point]').forEach(b=>b.onclick=()=>{closeCustomer();ctx.openPoint(b.dataset.custPoint);});
  $('custPoints').querySelectorAll('[data-cust-unlink]').forEach(b=>b.onclick=()=>linkPoint(b.dataset.custUnlink,null));
  $('custEquipment').querySelectorAll('[data-cust-eq]').forEach(b=>b.onclick=()=>{closeCustomer();openEquipmentCard(b.dataset.custEq);});
 }
 async function openCustomer(id){
  try{await ensureCustomers();}catch(e){ctx.notify('Клиенты недоступны: '+e.message,'err');return;}
  const c=id?customers.find(x=>x.id===id):null;if(id&&!c)return;
  customerEditId=c?.id||null;fillCustomer(c);
  $('custTitle').textContent=c?c.name:'Новый клиент';
  const may=ctx.canWrite();
  $('custForm').querySelectorAll('input,textarea').forEach(el=>el.disabled=!may);
  $('custSave').hidden=!may;$('custDelete').hidden=!may||!c;
  paintCustomerLinks();
  $('custOverlay').classList.add('on');ctx.markClean?.('custOverlay');
  if(!c)$('custName').focus();
 }
 function closeCustomer(){$('custOverlay').classList.remove('on');}
 async function saveCustomer(){
  const rec={name:$('custName').value.trim(),legal_name:$('custLegal').value.trim(),tax_id:$('custTax').value.trim(),phone:$('custPhone').value.trim(),email:$('custEmail').value.trim(),contact_person:$('custContact').value.trim(),notes:$('custNotes').value.trim()};
  if(!rec.name){$('custErr').textContent='Укажите название клиента.';$('custName').focus();return;}
  if(customers.some(c=>c.id!==customerEditId&&c.name.trim().toLowerCase()===rec.name.toLowerCase())){$('custErr').textContent='Клиент с таким названием уже есть.';return;}
  $('custSave').disabled=true;
  const res=customerEditId?await sb.from('customers').update(rec).eq('id',customerEditId).select('*').single():await sb.from('customers').insert(rec).select('*').single();
  $('custSave').disabled=false;
  if(res.error){$('custErr').textContent='Ошибка: '+res.error.message;return;}
  const created=!customerEditId;customerEditId=res.data?.id||customerEditId;
  await loadCustomers();await renderCustomers();ctx.showToast(created?'Клиент добавлен':'Клиент сохранён');
  if(created){$('custTitle').textContent=rec.name;$('custDelete').hidden=false;paintCustomerLinks();ctx.markClean?.('custOverlay');}else closeCustomer();
 }
 async function deleteCustomer(id){
  const c=customers.find(x=>x.id===id);if(!c)return;
  const n=pointsOf(id).length;
  if(n){ctx.notify('Удалить нельзя: у клиента '+n+' '+ctx.plural(n,'точка','точки','точек')+'. Перенесите их другому клиенту или отвяжите.','err');return;}
  if(!await ctx.confirmDialog('«'+c.name+'» пропадёт из справочника. Сразу после удаления его можно вернуть.',{title:'Удалить клиента?',danger:true,okText:'Удалить клиента'}))return;
  const {error}=await sb.rpc('soft_delete_customer',{p_id:id});if(error){ctx.notify('Ошибка: '+error.message,'err');return;}
  closeCustomer();await loadCustomers();renderCustomers();
  ctx.undoToast('Клиент удалён',async()=>{const {error:e2}=await sb.from('customers').update({deleted_at:null}).eq('id',id);if(e2){ctx.notify(e2.message,'err');return;}await loadCustomers();renderCustomers();ctx.showToast('Восстановлено');});
 }
 async function linkPoint(pointId,customerId){
  if(!pointId)return;
  const {error}=await sb.from('clients').update({customer_id:customerId}).eq('id',pointId);
  if(error){ctx.notify('Ошибка: '+error.message,'err');return;}
  const p=(ctx.points()||[]).find(x=>x.id===pointId);if(p)p.customer_id=customerId;
  paintCustomerLinks();renderCustomers();renderPoints();ctx.showToast(customerId?'Точка привязана':'Точка отвязана');
 }

 // ---------- Точки ----------
 async function renderPoints(){
  const box=$('pointList');if(!box)return;
  try{await ensureCustomers();}catch{/* без клиентов список точек всё равно полезен */}
  const q=($('pointSearch')?.value||'').trim().toLowerCase();
  const rows=points().map(p=>({...p,customer:customerOf(p)?.name||null,equipment:eqOf([p.id]).length}))
   .filter(p=>!q||[p.name,p.address,p.customer,p.contact_person,p.phone].some(v=>String(v||'').toLowerCase().includes(q)));
  renderCatalogTable(box,{label:'Точки',scope:'points',rows,rowClass:'emrow',rowLabel:p=>p.name,
   empty:points().length?'По запросу ничего не найдено.':'Точек пока нет. Точки ставятся на карте.',columns:[
    {key:'name',label:'Точка',value:p=>p.name,render:p=>'<button type="button" class="catalog-record-link" data-point-open="'+esc(p.id)+'">'+esc(p.name)+'</button>'+(p.address?'<small class="ref-sub">'+esc(p.address)+'</small>':'')},
    {key:'customer',label:'Клиент',value:p=>p.customer,render:p=>p.customer_id&&p.customer?'<button type="button" class="catalog-record-link" data-point-customer="'+esc(p.customer_id)+'">'+esc(p.customer)+'</button>':'<span class="hint">без клиента</span>'},
    {key:'contact',label:'Контакт',value:p=>[p.contact_person,p.phone].filter(Boolean).join(' · ')||null},
    {key:'equipment',label:'Техника',type:'number',value:p=>p.equipment}
   ],actions:[{attribute:'data-point-open',label:'Открыть точку',run:id=>ctx.openPoint(id)},{attribute:'data-point-eq',label:'Техника точки',run:id=>ctx.openPointEquipment(id)},{attribute:'data-point-map',label:'Показать на карте',run:id=>ctx.showPoint(id)}]});
  box.querySelectorAll('[data-point-customer]').forEach(b=>b.onclick=()=>openCustomer(b.dataset.pointCustomer));
 }

 // ---------- Техника ----------
 async function renderEquipment(){
  const box=$('eqRefList');if(!box)return;
  try{await ensureCustomers();}catch{/* клиент в строке просто не подпишется */}
  const q=($('eqRefSearch')?.value||'').trim().toLowerCase();
  const rows=equipment().map(e=>{const p=(ctx.points()||[]).find(x=>x.id===e.client_id);return {...e,point:p?.name||null,customer:customerOf(p)?.name||null,warranty:warrantyUntil(e)};})
   .filter(e=>!q||[e.model,e.serial,e.kind,e.point,e.customer].some(v=>String(v||'').toLowerCase().includes(q)));
  renderCatalogTable(box,{label:'Техника клиентов',scope:'equipment',rows,rowClass:'emrow',rowLabel:e=>eqLabel(e),
   empty:equipment().length?'По запросу ничего не найдено.':'Техники пока нет. Технику добавляют в карточке точки.',columns:[
    {key:'model',label:'Техника',value:e=>e.model||null,render:e=>'<button type="button" class="catalog-record-link" data-eqref-open="'+esc(e.id)+'">'+esc(e.model||'Техника')+'</button>'+(e.serial?'<small class="ref-sub">№ '+esc(e.serial)+'</small>':'')},
    {key:'kind',label:'Тип',value:e=>e.kind||null},
    {key:'point',label:'Точка',value:e=>e.point},
    {key:'customer',label:'Клиент',value:e=>e.customer},
    {key:'service',label:'Последнее ТО',type:'date',value:e=>e.last_service||null,render:e=>e.last_service?esc(dateText(e.last_service)):'<span class="hint">не было</span>'},
    {key:'warranty',label:'Гарантия до',type:'date',value:e=>e.warranty||null,render:e=>e.warranty?esc(dateText(e.warranty)):'—'}
   ],actions:[{attribute:'data-eqref-open',label:'Сервисная история',run:openEquipmentCard}]});
 }

 async function openEquipmentCard(id){
  const e=equipment().find(x=>x.id===id);if(!e)return;
  eqCardId=id;
  const p=(ctx.points()||[]).find(x=>x.id===e.client_id),c=customerOf(p),w=warrantyUntil(e),model=(ctx.models()||[]).find(m=>m.id===e.model_id);
  $('eqCardTitle').textContent=e.model||'Техника';
  $('eqCardFacts').innerHTML=[
   ['Серийный номер',e.serial||'—'],['Тип',e.kind||model?.kind||'—'],
   ['Точка',p?'<button type="button" class="ref-link inline" data-eqcard-point="'+esc(p.id)+'">'+esc(p.name)+'</button>':'—',true],
   ['Клиент',c?'<button type="button" class="ref-link inline" data-eqcard-customer="'+esc(c.id)+'">'+esc(c.name)+'</button>':'без клиента',!!c],
   ['Установлена',dateText(e.installed_on)||'—'],['Гарантия до',dateText(w)||'—'],
   ['Последнее ТО',dateText(e.last_service)||'не было'],['Последний визит',dateText(e.last_visit)||'—'],
   ['Интервал ТО',model?.service_interval_hours?num(model.service_interval_hours)+' моточасов':'—']
  ].map(([k,v,html])=>'<div><dt>'+esc(k)+'</dt><dd>'+(html?v:esc(v))+'</dd></div>').join('');
  $('eqCardFacts').querySelector('[data-eqcard-point]')?.addEventListener('click',()=>{closeEquipmentCard();ctx.openPoint(p.id);});
  $('eqCardFacts').querySelector('[data-eqcard-customer]')?.addEventListener('click',()=>{closeEquipmentCard();openCustomer(c.id);});
  $('eqCardEdit').hidden=!ctx.canWrite();
  $('eqCardHistory').innerHTML='<p class="hint" role="status">Загружаем историю…</p>';
  $('eqCardOverlay').classList.add('on');
  await paintHistory(e);
 }
 function closeEquipmentCard(){$('eqCardOverlay').classList.remove('on');}

 async function loadHistory(e){
  const jobsRes=await sb.from('jobs').select('id,number,status,scheduled_date,due_date,created_at,notes,deleted_at').eq('equipment_id',e.id).is('deleted_at',null).order('created_at',{ascending:false});
  if(jobsRes.error)throw jobsRes.error;
  const jobs=jobsRes.data||[],ids=jobs.map(j=>j.id);
  const [orders,visits,readings]=await Promise.all([
   ids.length?sb.from('service_orders').select('id,number,status,date_from,date_to,job_id,service_order_items(id,kind,title,unit,planned_qty,done_qty,request_finance_void_event_id)').in('job_id',ids):{data:[]},
   ids.length?sb.from('job_visits').select('job_id,started_at,ended_at').in('job_id',ids):{data:[]},
   sb.from('equipment_readings').select('taken_on,moto_hours,kind,note,job_id').eq('equipment_id',e.id)
  ]);
  for(const r of [orders,visits,readings])if(r.error)throw r.error;
  return {jobs,orders:orders.data||[],visits:visits.data||[],readings:readings.data||[]};
 }
 // Одна запись истории — одна заявка: когда была, что сделали, что поставили.
 // Замеры без заявки идут отдельными строками.
 function historyEntries({jobs,orders,visits,readings}){
  const entries=jobs.map(j=>{
   const own=orders.filter(o=>o.job_id===j.id),items=own.flatMap(o=>o.service_order_items||[]).filter(i=>!i.request_finance_void_event_id);
   const seen=visits.filter(v=>v.job_id===j.id).map(v=>v.started_at).filter(Boolean).sort();
   const when=seen[0]||own.map(o=>o.date_from).filter(Boolean).sort()[0]||j.scheduled_date||j.created_at;
   const works=items.filter(i=>i.kind!=='material'),parts=items.filter(i=>i.kind==='material');
   return {kind:'job',when:dayKey(when),job:j,orders:own,works,parts,readings:readings.filter(r=>r.job_id===j.id),visits:seen.length};
  });
  for(const r of readings.filter(r=>!r.job_id||!jobs.some(j=>j.id===r.job_id)))entries.push({kind:'reading',when:dayKey(r.taken_on),reading:r});
  return entries.sort((a,b)=>String(b.when).localeCompare(String(a.when)));
 }
 function qtyText(i){const done=Number(i.done_qty)||0,plan=Number(i.planned_qty)||0,unit=i.unit||'';return done>0?num(done)+(plan&&plan!==done?' из '+num(plan):'')+' '+unit:'план '+num(plan)+' '+unit;}
 async function paintHistory(e){
  const token=++historyToken,box=$('eqCardHistory');
  let data;try{data=await loadHistory(e);}catch(err){if(token===historyToken)box.innerHTML='<p class="err">История не загрузилась: '+esc(err.message||'нет связи')+'</p>';return;}
  if(token!==historyToken||eqCardId!==e.id)return;
  const entries=historyEntries(data);
  if(!entries.length){box.innerHTML='<p class="hint">Заявок и замеров по этой технике пока нет.</p>';return;}
  box.innerHTML='<ol class="eq-history">'+entries.map(x=>{
   if(x.kind==='reading')return '<li class="eq-history-item is-reading"><time datetime="'+esc(x.when)+'">'+esc(dateText(x.when))+'</time><div><b>Замер моточасов: '+esc(num(x.reading.moto_hours))+'</b>'+(x.reading.note?'<p>'+esc(x.reading.note)+'</p>':'')+'</div></li>';
   const j=x.job,label='Заявка'+(j.number?' №'+j.number:''),status=STATUS[j.status]||j.status||'';
   const tasks=x.orders.map(o=>'Задание'+(o.number?' №'+o.number:'')+' · '+(ORDER_STATUS[o.status]||o.status)).join(', ');
   const list=(title,rows)=>rows.length?'<div class="eq-history-group"><span>'+title+'</span><ul>'+rows.map(i=>'<li>'+esc(i.title)+' <small>'+esc(qtyText(i))+'</small></li>').join('')+'</ul></div>':'';
   return '<li class="eq-history-item is-'+esc(j.status)+'"><time datetime="'+esc(x.when)+'">'+esc(dateText(x.when))+'</time><div>'
    +'<b><button type="button" class="ref-link inline" data-eqhist-job="'+esc(j.id)+'">'+esc(label)+'</button></b> <span class="eq-history-status">'+esc(status)+'</span>'
    +(tasks?'<p class="hint">'+esc(tasks)+(x.visits?' · '+x.visits+' '+ctx.plural(x.visits,'визит','визита','визитов'):'')+'</p>':'')
    +(j.notes?'<p>'+esc(j.notes)+'</p>':'')
    +list('Работы',x.works)+list('Запчасти и материалы',x.parts)
    +x.readings.map(r=>'<p class="hint">Моточасы: '+esc(num(r.moto_hours))+(r.taken_on?' · '+esc(dateText(r.taken_on)):'')+'</p>').join('')
    +'</div></li>';
  }).join('')+'</ol>';
  box.querySelectorAll('[data-eqhist-job]').forEach(b=>b.onclick=()=>{closeEquipmentCard();ctx.openJob(b.dataset.eqhistJob);});
 }

 // ---------- Клиент в окне точки ----------
 // Список клиентов для окна точки на карте: выбранный, «без клиента» и
 // «новый клиент с названием точки» для только что поставленной точки.
 async function customerOptions(select,{selected=null,offerNew=false}={}){
  if(!select)return;
  try{await ensureCustomers();}catch{select.innerHTML='<option value="">— клиенты недоступны —</option>';select.disabled=true;return;}
  select.disabled=false;
  select.innerHTML=(offerNew?'<option value="__new">+ Новый клиент с названием точки</option>':'')+'<option value="">— без клиента —</option>'
   +customers.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  select.value=selected||(offerNew?'__new':'');
 }
 // Значение поля → id клиента; «новый» создаётся здесь же.
 async function resolveCustomer(value,name){
  if(value!=='__new')return value||null;
  const existing=customers.find(c=>c.name.trim().toLowerCase()===String(name||'').trim().toLowerCase());if(existing)return existing.id;
  const {data,error}=await sb.from('customers').insert({name:String(name||'').trim()||'Без названия'}).select('id').single();
  if(error)throw error;await loadCustomers();return data.id;
 }

 // ---------- wiring ----------
 $('custAdd')&&($('custAdd').onclick=()=>openCustomer(null));
 $('custSave').onclick=saveCustomer;
 $('custDelete').onclick=()=>customerEditId&&deleteCustomer(customerEditId);
 $('custCancel').onclick=closeCustomer;
 $('custAttachBtn').onclick=()=>{const v=$('custAttachPoint').value;if(v&&customerEditId)linkPoint(v,customerEditId);};
 $('custSearch')&&($('custSearch').oninput=renderCustomers);
 $('pointSearch')&&($('pointSearch').oninput=renderPoints);
 $('eqRefSearch')&&($('eqRefSearch').oninput=renderEquipment);
 $('eqCardClose').onclick=closeEquipmentCard;
 $('eqCardEdit').onclick=()=>{const e=equipment().find(x=>x.id===eqCardId);if(!e)return;closeEquipmentCard();ctx.editEquipment(e.client_id,e.id);};
 $('pointMapAdd')&&($('pointMapAdd').onclick=()=>ctx.goMap());

 return {loadCustomers,renderCustomers,renderPoints,renderEquipment,openCustomer,openEquipmentCard,customerOptions,resolveCustomer,customers:()=>customers,historyEntries};
}
