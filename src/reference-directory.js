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
const serviceText=f=>{if(!f)return '—';const when=f.days==null?'':f.days<0?'просрочено '+(-f.days)+' дн':f.days===0?'сегодня':dateText(f.dueDate)+(f.state==='soon'?' · через '+f.days+' дн':'');
 const what=[f.level?.name,f.dueHours!=null?'при '+Math.round(f.dueHours)+' мч':''].filter(Boolean).join(' ');
 return [what,when].filter(Boolean).join(' · ')+(f.byCalendar?' (по сроку)':f.src==='estimate'?' (оценка по сменам)':f.src==='shift'?' (темп по сменам)':'');};

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
 // Список клиентов — вход в страницу клиента. Точки и техника живут на ней,
 // а здесь видно главное: сколько точек и техники, открытые заявки, ТО.
 let quick='';
 const NONE='none';
 function customerRows(){
  const all=points(),q=($('custSearch')?.value||'').trim().toLowerCase();
  const row=(c,pts)=>{const eqs=eqOf(pts.map(p=>p.id)),plans=eqs.map(e=>ctx.forecast(e)).filter(Boolean);
   const visits=eqs.map(e=>e.last_visit).filter(Boolean).sort();
   const open=pts.reduce((n,p)=>n+((ctx.stats(p.id)?.open)||0),0);
   const hit=q&&![c.name,c.legal_name,c.tax_id,c.phone,c.contact_person].some(v=>String(v||'').toLowerCase().includes(q))?(eqs.find(e=>[e.model,e.serial,e.kind].some(v=>String(v||'').toLowerCase().includes(q)))||null):null;
   const pointHit=q&&!hit&&![c.name,c.legal_name,c.tax_id,c.phone,c.contact_person].some(v=>String(v||'').toLowerCase().includes(q))?(pts.find(p=>[p.name,p.address].some(v=>String(v||'').toLowerCase().includes(q)))||null):null;
   return {...c,points:pts.length,equipment:eqs.length,open,overdue:plans.filter(f=>f.state==='overdue').length,soon:plans.filter(f=>f.state==='soon').length,visit:visits.at(-1)||null,
    match:hit?'найдено в технике: '+eqLabel(hit):pointHit?'найдено в точках: '+pointHit.name:null,
    hidden:!!q&&!hit&&!pointHit&&![c.name,c.legal_name,c.tax_id,c.phone,c.contact_person].some(v=>String(v||'').toLowerCase().includes(q))};};
  const rows=customers.map(c=>row(c,pointsOf(c.id)));
  const loose=all.filter(p=>!p.customer_id||!customers.some(c=>c.id===p.customer_id));
  if(loose.length)rows.push(row({id:NONE,name:'Точки без клиента',legal_name:'',none:true},loose));
  return rows.filter(r=>!r.hidden);
 }
 async function renderCustomers(){
  const box=$('custList');if(!box)return;
  try{await ensureCustomers();}catch(e){ctx.listLoadError(box,e,renderCustomers);return;}
  const all=customerRows(),counts={open:all.filter(r=>r.open>0).length,overdue:all.filter(r=>r.overdue>0).length};
  const chips=$('custQuick');
  if(chips){chips.innerHTML=[['open','С открытыми заявками'],['overdue','ТО просрочено']].map(([k,l])=>'<button type="button" class="btn chip" data-cust-quick="'+k+'" aria-pressed="'+(quick===k)+'">'+l+' · '+counts[k]+'</button>').join('');
   chips.querySelectorAll('[data-cust-quick]').forEach(b=>b.onclick=()=>{quick=quick===b.dataset.custQuick?'':b.dataset.custQuick;renderCustomers();});}
  const rows=all.filter(r=>!quick||(quick==='open'?r.open>0:r.overdue>0));
  const service=r=>r.overdue?'<span class="customer-service" data-state="overdue">просрочено у '+r.overdue+'</span>':r.soon?'<span class="customer-service" data-state="soon">скоро у '+r.soon+'</span>':'<span class="hint">—</span>';
  renderCatalogTable(box,{label:'Клиенты',scope:'customers',rows,rowClass:'emrow',rowLabel:c=>c.name,
   empty:customers.length?'По запросу ничего не найдено.':'Клиентов пока нет. Добавьте первого клиента.',columns:[
    {key:'name',label:'Клиент',value:c=>c.name,render:c=>'<button type="button" class="catalog-record-link" data-cust-open="'+esc(c.id)+'">'+esc(c.name)+'</button>'+(c.match?'<small class="ref-sub ref-match">'+esc(c.match)+'</small>':c.none?'<small class="ref-sub">ещё не привязаны к клиенту</small>':(c.legal_name&&c.legal_name!==c.name)||c.tax_id?'<small class="ref-sub">'+esc([c.legal_name!==c.name?c.legal_name:'',c.tax_id?'ЕДРПОУ '+c.tax_id:''].filter(Boolean).join(' · '))+'</small>':'')},
    {key:'points',label:'Точки',type:'number',value:c=>c.points},
    {key:'equipment',label:'Техника',type:'number',value:c=>c.equipment},
    {key:'open',label:'Заявки',type:'number',value:c=>c.open,render:c=>c.open?esc(c.open+' '+ctx.plural(c.open,'открыта','открыты','открыто')):'<span class="hint">нет</span>'},
    {key:'overdue',label:'ТО',type:'number',value:c=>c.overdue,render:service},
    {key:'visit',label:'Последний визит',type:'date',value:c=>c.visit,render:c=>c.visit?esc(dateText(c.visit)):'<span class="hint">не было</span>'}
   ],actions:[{attribute:'data-cust-open',label:'Открыть',run:openCustomer},...(ctx.canWrite()?[{attribute:'data-cust-del',label:'Удалить клиента',danger:true,run:id=>id!==NONE&&deleteCustomer(id)}]:[])]});
  box.querySelectorAll('[data-cust-del="'+NONE+'"]').forEach(b=>b.hidden=true);
 }

 // Новый клиент заводится в окне; дальше — его страница.
 function fillCustomer(){
  for(const id of ['custName','custLegal','custTax','custPhone','custEmail','custContact','custNotes'])$(id).value='';
  $('custErr').textContent='';
 }
 async function openCustomer(id){
  if(id)return ctx.openCustomerPage(id);
  if(!ctx.canWrite())return;
  try{await ensureCustomers();}catch(e){ctx.notify('Клиенты недоступны: '+e.message,'err');return;}
  fillCustomer();$('custTitle').textContent='Новый клиент';
  $('custOverlay').classList.add('on');ctx.markClean?.('custOverlay');$('custName').focus();
 }
 function closeCustomer(){$('custOverlay').classList.remove('on');}
 async function saveCustomer(){
  const rec={name:$('custName').value.trim(),legal_name:$('custLegal').value.trim(),tax_id:$('custTax').value.trim(),phone:$('custPhone').value.trim(),email:$('custEmail').value.trim(),contact_person:$('custContact').value.trim(),notes:$('custNotes').value.trim()};
  if(!rec.name){$('custErr').textContent='Укажите название клиента.';$('custName').focus();return;}
  if(customers.some(c=>c.name.trim().toLowerCase()===rec.name.toLowerCase())){$('custErr').textContent='Клиент с таким названием уже есть.';return;}
  $('custSave').disabled=true;
  const res=await sb.from('customers').insert(rec).select('*').single();
  $('custSave').disabled=false;
  if(res.error){$('custErr').textContent='Ошибка: '+res.error.message;return;}
  await loadCustomers();ctx.markClean?.('custOverlay');closeCustomer();ctx.showToast('Клиент добавлен');
  if(res.data?.id)await ctx.openCustomerPage(res.data.id);else renderCustomers();
 }
 async function deleteCustomer(id){
  const c=customers.find(x=>x.id===id);if(!c)return false;
  const n=pointsOf(id).length;
  if(n){ctx.notify('Удалить нельзя: у клиента '+n+' '+ctx.plural(n,'точка','точки','точек')+'. Перенесите их другому клиенту или отвяжите.','err');return false;}
  if(!await ctx.confirmDialog('«'+c.name+'» пропадёт из справочника. Сразу после удаления его можно вернуть.',{title:'Удалить клиента?',danger:true,okText:'Удалить клиента'}))return false;
  const {error}=await sb.rpc('soft_delete_customer',{p_id:id});if(error){ctx.notify('Ошибка: '+error.message,'err');return false;}
  await loadCustomers();renderCustomers();
  ctx.undoToast('Клиент удалён',async()=>{const {error:e2}=await sb.from('customers').update({deleted_at:null}).eq('id',id);if(e2){ctx.notify(e2.message,'err');return;}await loadCustomers();renderCustomers();ctx.showToast('Восстановлено');});
  return true;
 }

 async function openEquipmentCard(id){
  const e=equipment().find(x=>x.id===id);if(!e)return;
  eqCardId=id;
  const p=(ctx.points()||[]).find(x=>x.id===e.client_id),c=customerOf(p),w=warrantyUntil(e),model=(ctx.models()||[]).find(m=>m.id===e.model_id),f=ctx.forecast(e);
  $('eqCardTitle').textContent=e.model||'Техника';
  $('eqCardFacts').innerHTML=[
   ['Серийный номер',e.serial||'—'],['Тип',e.kind||model?.kind||'—'],
   ['Точка',p?'<button type="button" class="ref-link inline" data-eqcard-point="'+esc(p.id)+'">'+esc(p.name)+'</button>':'—',true],
   ['Клиент',c?'<button type="button" class="ref-link inline" data-eqcard-customer="'+esc(c.id)+'">'+esc(c.name)+'</button>':'без клиента',!!c],
   ['Установлена',dateText(e.installed_on)||'—'],['Гарантия до',dateText(w)||'—'],
   ['Следующее ТО',serviceText(f)],['Моточасы',f?.nowMh!=null?'≈ '+num(Math.round(f.nowMh))+' мч':'замеров нет'],['Последнее ТО',dateText(e.last_service)||'не было'],['Последний визит',dateText(e.last_visit)||'—'],
   ['План ТО',f?.plan?.length?f.plan.map(l=>l.name+' · '+num(l.interval_hours)+' мч'+(l.interval_months?' / '+l.interval_months+' мес':'')).join(', '):'не задан']
  ].map(([k,v,html])=>'<div><dt>'+esc(k)+'</dt><dd>'+(html?v:esc(v))+'</dd></div>').join('');
  $('eqCardFacts').querySelector('[data-eqcard-point]')?.addEventListener('click',()=>{closeEquipmentCard();ctx.openPoint(p.id);});
  $('eqCardFacts').querySelector('[data-eqcard-customer]')?.addEventListener('click',()=>{closeEquipmentCard();openCustomer(c.id);});
  $('eqCardEdit').hidden=!ctx.canWrite();$('eqCardJob').hidden=!ctx.canWrite()||!f;
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
   sb.from('equipment_readings').select('taken_on,moto_hours,kind,note,job_id,maintenance_level_id').eq('equipment_id',e.id)
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
 const readingTitle=r=>r.kind==='service'?(ctx.levelName?.(r.maintenance_level_id)||'ТО')+' · '+num(r.moto_hours)+' мч':'Замер моточасов: '+num(r.moto_hours);
 function qtyText(i){const done=Number(i.done_qty)||0,plan=Number(i.planned_qty)||0,unit=i.unit||'';return done>0?num(done)+(plan&&plan!==done?' из '+num(plan):'')+' '+unit:'план '+num(plan)+' '+unit;}
 async function paintHistory(e){
  const token=++historyToken,box=$('eqCardHistory');
  let data;try{data=await loadHistory(e);}catch(err){if(token===historyToken)box.innerHTML='<p class="err">История не загрузилась: '+esc(err.message||'нет связи')+'</p>';return;}
  if(token!==historyToken||eqCardId!==e.id)return;
  const entries=historyEntries(data);
  if(!entries.length){box.innerHTML='<p class="hint">Заявок и замеров по этой технике пока нет.</p>';return;}
  box.innerHTML='<ol class="eq-history">'+entries.map(x=>{
   if(x.kind==='reading')return '<li class="eq-history-item is-reading'+(x.reading.kind==='service'?' is-service':'')+'"><time datetime="'+esc(x.when)+'">'+esc(dateText(x.when))+'</time><div><b>'+esc(readingTitle(x.reading))+'</b>'+(x.reading.note?'<p>'+esc(x.reading.note)+'</p>':'')+'</div></li>';
   const j=x.job,label='Заявка'+(j.number?' №'+j.number:''),status=STATUS[j.status]||j.status||'';
   const tasks=x.orders.map(o=>'Задание'+(o.number?' №'+o.number:'')+' · '+(ORDER_STATUS[o.status]||o.status)).join(', ');
   const list=(title,rows)=>rows.length?'<div class="eq-history-group"><span>'+title+'</span><ul>'+rows.map(i=>'<li>'+esc(i.title)+' <small>'+esc(qtyText(i))+'</small></li>').join('')+'</ul></div>':'';
   return '<li class="eq-history-item is-'+esc(j.status)+'"><time datetime="'+esc(x.when)+'">'+esc(dateText(x.when))+'</time><div>'
    +'<b><button type="button" class="ref-link inline" data-eqhist-job="'+esc(j.id)+'">'+esc(label)+'</button></b> <span class="eq-history-status">'+esc(status)+'</span>'
    +(tasks?'<p class="hint">'+esc(tasks)+(x.visits?' · '+x.visits+' '+ctx.plural(x.visits,'визит','визита','визитов'):'')+'</p>':'')
    +(j.notes?'<p>'+esc(j.notes)+'</p>':'')
    +list('Работы',x.works)+list('Запчасти и материалы',x.parts)
    +x.readings.map(r=>'<p class="hint">'+esc(readingTitle(r))+(r.taken_on?' · '+esc(dateText(r.taken_on)):'')+'</p>').join('')
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
 $('custCancel').onclick=closeCustomer;
 $('custSearch')&&($('custSearch').oninput=renderCustomers);
 $('eqCardClose').onclick=closeEquipmentCard;
 $('eqCardEdit').onclick=()=>{const e=equipment().find(x=>x.id===eqCardId);if(!e)return;closeEquipmentCard();ctx.editEquipment(e.client_id,e.id);};
 $('eqCardService').onclick=async()=>{const e=equipment().find(x=>x.id===eqCardId);if(!e)return;if(await ctx.recordService(e))openEquipmentCard(e.id);};
 $('eqCardJob').onclick=()=>{const e=equipment().find(x=>x.id===eqCardId);if(!e)return;closeEquipmentCard();ctx.newMaintenanceJob(e.client_id,e.id);};

 return {loadCustomers,ensureCustomers,renderCustomers,openCustomer,deleteCustomer,openEquipmentCard,customerOptions,resolveCustomer,warrantyUntil,customers:()=>customers,historyEntries};
}
