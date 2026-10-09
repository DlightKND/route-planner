const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const APPROVAL_NAMES={window:'Рабочее окно',split:'Разделение блока',order_complete:'Выполнение задания',order_deadline:'Срок задания',trip_reschedule:'Перенос выезда',job_change:'Правка заявки',finance:'Работы и материалы',stay:'Присутствие на объекте',presence:'Проверка присутствия',trip_confirm:'Подтверждение выезда',trip_cost:'Выездные затраты',track_charge:'Списание по GPS',track_cancel:'Отмена списания'};
const STATES={pending:'Ожидает решения',approved:'Согласовано',rejected:'Отклонено',cancelled:'Отозвано'};
const ACTIONS={submitted:'отправил',delegated:'передал выше',approved:'согласовал',rejected:'отклонил',cancelled:'отозвал'};
const time=h=>String(Math.floor(+h)).padStart(2,'0')+':'+String(Math.round((+h%1)*60)).padStart(2,'0');
export function approvalPreview(row){
 const p=row.preview||{};
 if(row.kind==='window'){const label={start:'Начало дня',end:'Конец дня',tol:'Допуск'}[p.field]||'Граница';return label+': '+time(p.before?.[p.field]??p.value)+' → '+time(p.value)+(p.field==='tol'?' ч':'');}
 if(row.kind==='split')return 'Начало: '+(p.plan?.start?.d||'')+' '+time(p.plan?.start?.t||0)+' · '+(p.plan?.cuts||[]).map(c=>'после '+c.after+' ч → '+c.at.d+' '+time(c.at.t)).join('; ');
 if(row.kind==='track_charge')return p.data.km+' км · '+p.data.cost+' · '+p.data.reason;
 if(row.kind==='track_cancel')return p.reason||'';
 if(row.kind==='finance')return (row.details||[]).map(i=>(i.title||'Строка')+' · '+i.planned_qty+' '+(i.unit||'')+' · '+(i.financial_revenue_snapshot??i.unit_price_snapshot??'—')).join('; ');
 if(row.kind==='order_complete')return (row.details?.title||'Задание')+' · '+(row.details?.items||[]).map(i=>i.title+': '+i.done_qty+' / '+i.planned_qty+' '+(i.unit||'')).join('; ');
 if(row.kind==='trip_cost')return (p.lines||[]).length+' строк затрат · '+(p.lines||[]).reduce((n,x)=>n+Number(x.amount||0),0).toLocaleString('ru-RU');
 if(row.kind==='presence')return (p.stays||[]).map(s=>(s.status==='approved'?'Учесть':'Исключить')+' · '+(s.minutes_mgr??s.minutes??0)+' мин · '+(s.crew_ids||[]).length+' участников').join('; ');
 if(row.kind==='trip_confirm')return (row.details?.vehicle||'Выезд')+' · '+(row.details?.from||'')+' · '+(row.details?.km??'—')+' км';
 if(row.kind==='order_deadline')return 'Новый срок: '+(row.details?.proposed_date_to||'')+' · '+(row.details?.reason||'');
 if(row.kind==='trip_reschedule')return (row.details?.new_from||row.details?.date_from||'')+' → '+(row.details?.new_to||row.details?.date_to||'')+' · '+(row.details?.reason||'');
 if(row.kind==='job_change')return row.details?.what||'';
 return p.reason||(p.minutes!=null?p.minutes+' мин':'');
}
export function createApprovals(ctx){
 let rows=[],generation=0;
 const name=id=>ctx.people().find(p=>p.id===id)?.full_name||'Сотрудник';
 async function rpc(fn,args={}){const {data,error}=await ctx.db().rpc(fn,args);if(error)throw error;return data;}
 async function load(){const uid=ctx.userId(),g=++generation;if(!uid){rows=[];return rows;}const data=await rpc('approval_list');if(uid!==ctx.userId()||g!==generation)return rows;rows=data||[];const count=rows.filter(r=>r.status==='pending').length;ctx.badge?.(count);return rows;}
 function pendingDay(engineer,date){return rows.filter(r=>r.status==='pending'&&((r.entity_kind==='staff'&&r.entity_id===engineer)||(r.kind==='split'&&r.preview?.engineer===engineer))&&r.date===date);}
 function controls(row){return row.can_decide?'<button class="btn sm amber" data-approval-action="approve" data-approval-id="'+esc(row.id)+'">Согласовать</button><button class="btn sm ghost" data-approval-action="reject" data-approval-id="'+esc(row.id)+'">Отклонить</button>'+(row.next_manager?'<button class="btn sm ghost" data-approval-action="delegate" data-approval-id="'+esc(row.id)+'">Передать выше</button>':''):row.can_cancel?'<button class="btn sm ghost" data-approval-action="cancel" data-approval-id="'+esc(row.id)+'">Отозвать</button>':'';}
 function dayHtml(engineer,date){return pendingDay(engineer,date).map(r=>'<div class="vg-request">'+esc(name(r.requester)+' · '+approvalPreview(r))+'<span class="hint">Рассматривает: '+esc(name(r.assignee))+'</span>'+controls(r)+'</div>').join('');}
 async function action(row,action){
  const uid=ctx.userId();let note='';
  if(action==='delegate'||action==='reject'){
   const answer=await ctx.prompt(action==='delegate'?'Передать согласование: '+(row.next_manager?.name||'руководителю'):'Отклонить согласование',[{key:'note',label:'Комментарий',type:'textarea'}],{okText:action==='delegate'?'Передать':'Отклонить'});if(!answer)return;note=answer.note||'';
  }
  if(uid!==ctx.userId())return;
  if(action==='approve'&&ctx.beforeApprove&&!await ctx.beforeApprove(row))return;
  if(action==='delegate')await rpc('approval_escalate',{p_id:row.id,p_expected:row.revision,p_note:note});
  else if(action==='cancel')await rpc('approval_cancel',{p_id:row.id,p_expected:row.revision});
  else await rpc('approval_decide',{p_id:row.id,p_expected:row.revision,p_accept:action==='approve',p_note:note});
  ctx.notify(action==='delegate'?'Согласование передано руководителю':action==='cancel'?'Предложение отозвано':action==='approve'?'Изменение согласовано':'Предложение отклонено');
  await load();await ctx.changed?.(row,action);
 }
 function wire(root){root.querySelectorAll('[data-approval-action]').forEach(button=>button.onclick=async event=>{event.stopPropagation();const row=rows.find(r=>r.id===button.dataset.approvalId);if(!row)return;button.disabled=true;try{await action(row,button.dataset.approvalAction);if(ctx.host()?.isConnected&&ctx.host().offsetParent!==null)paint();}catch(e){ctx.notify(e.message,'err');}finally{button.disabled=false;}});}
 function paint(){const host=ctx.host();if(!host)return;const pending=rows.filter(r=>r.status==='pending'),closed=rows.filter(r=>r.status!=='pending');
 const card=r=>'<article class="card approval-card"><div class="approval-heading"><b>'+esc(APPROVAL_NAMES[r.kind]||r.kind)+'</b><span class="hint">'+esc(STATES[r.status])+'</span></div><p>'+esc(approvalPreview(r))+'</p><p class="hint">'+esc(r.reason)+' · '+esc(r.date||'')+'</p><p class="hint">От '+esc(name(r.requester))+' · рассматривает '+esc(name(r.assignee))+'</p><div class="approval-actions">'+controls(r)+'<button class="btn sm ghost" data-approval-open="'+esc(r.id)+'">Открыть объект</button></div><details><summary>История</summary>'+r.history.map(e=>'<p class="hint">'+esc(new Date(e.at).toLocaleString('ru-RU'))+' · '+esc(name(e.actor))+' '+esc(ACTIONS[e.action]||e.action)+(e.recipient?' → '+esc(name(e.recipient)):'')+(e.note?' · '+esc(e.note):'')+'</p>').join('')+'</details></article>';
 host.innerHTML='<div class="pane-head"><button class="btn sm ghost" data-approval-refresh>Обновить</button><span class="hint">На рассмотрении: '+pending.length+'</span></div>'+ (pending.length?pending.map(card).join(''):'<p class="hint" role="status">Согласований на рассмотрении нет.</p>')+(closed.length?'<details class="approval-closed"><summary>Рассмотренные · '+closed.length+'</summary>'+closed.map(card).join('')+'</details>':'');
 host.querySelector('[data-approval-refresh]').onclick=open;wire(host);host.querySelectorAll('[data-approval-open]').forEach(b=>b.onclick=()=>{const r=rows.find(x=>x.id===b.dataset.approvalOpen);if(r)ctx.openEntity(r);});
 }
 async function open(){const host=ctx.host();if(host)host.innerHTML='<p class="hint">Загрузка согласований…</p>';try{await ctx.ensureRefs();await load();paint();}catch(e){if(host)host.innerHTML='<p class="err" role="alert">'+esc(e.message)+'</p><button class="btn sm ghost" data-retry>Повторить</button>';host?.querySelector('[data-retry]')?.addEventListener('click',open);}}
 async function delegate(kind,target,payload={}){
  const org=await rpc('account_org_read');if(!org.manager)throw Error('В структуре сотрудников не указан активный руководитель');
  const answer=await ctx.prompt('Передать: '+org.manager.full_name,[{key:'reason',label:'Комментарий',type:'textarea'}],{okText:'Передать выше'});if(!answer)return false;
  await rpc('approval_delegate',{p_kind:kind,p_target:target,p_payload:payload,p_reason:answer.reason||''});ctx.notify('Согласование передано руководителю');await load();return true;
 }
 return {load,open,delegate,dayHtml,wire,reset(){generation++;rows=[];ctx.badge?.(0);}};
}
// Explicit secondary actions preserve the existing primary decision flow.
const delegateButtons=new WeakSet();
export function mountApprovalDelegate(button,onDelegate){
 if(!button||delegateButtons.has(button))return;delegateButtons.add(button);
 const extra=button.ownerDocument.createElement('button');extra.type='button';extra.className='btn sm ghost';extra.textContent='Передать выше';extra.dataset.delegateFor=button.id;
 button.insertAdjacentElement('afterend',extra);extra.onclick=async e=>{e.stopPropagation();extra.disabled=true;try{await onDelegate();}finally{extra.disabled=false;}};
}
