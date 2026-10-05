import { infoHint } from './info-hints.js';
import { entityPersonLabel } from './entity-people.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

// The owner retains authority after delegation. The curator receives
// operational decisions and alerts. Both assignments are entity-specific.
export function mountEntityResponsibility({
  root,db,kind,id,record,people,userId,role,onChange,onError=()=>{}
}){
  if(!root||!id)return;
  const person=pid=>people().find(p=>p.id===pid);
  const name=pid=>pid?entityPersonLabel(person(pid)):'Не назначен';
  let owner=record.owner_id||null,curator=record.curator_id||null;
  const actor=userId(),admin=role()==='admin',logist=role()==='logist';
  const canOwner=admin||owner===actor||(!owner&&logist);
  const canCurator=canOwner||curator===actor||(!curator&&logist);
  root.dataset.responsibilityId=id;
  root.innerHTML=`<h3>Ответственность ${infoHint('Куратор ведёт стадии, рассматривает изменения и получает уведомления. Владелец сохраняет права редактирования.', 'О владельце и кураторе')}</h3>
    <p class="hint">Владелец: <b data-owner>${esc(name(owner))}</b> · куратор: <b data-curator>${esc(name(curator))}</b></p>
    ${canOwner||canCurator?`<form class="responsibility-form">
      <label>Передать <select name="field">
        ${canCurator?'<option value="curator">Кураторство</option>':''}
        ${canOwner?'<option value="owner">Владение</option>':''}
      </select></label>
      <label>Кому <select name="person">${people().filter(p=>p.active!==false).map(p=>`<option value="${esc(p.id)}">${esc(entityPersonLabel(p))}</option>`).join('')}</select></label>
      <label>Причина <input name="reason" required minlength="5" maxlength="1000" placeholder="Почему передаётся ответственность"></label>
      <button type="submit" class="btn sm">Передать</button><span role="status" class="hint"></span>
    </form>`:''}
    <div class="responsibility-events" aria-live="polite"><p class="hint">Загружаю историю ответственности…</p></div>`;
  const events=root.querySelector('.responsibility-events');
  const refresh=async()=>{
    const [{data,error},interventions]=await Promise.all([
      db.from('entity_responsibility_events')
        .select('id,actor_id,previous_owner_id,previous_curator_id,owner_id,curator_id,reason,created_at')
        .eq('entity_kind',kind).eq('entity_id',id).order('created_at',{ascending:false}).limit(30),
      kind==='order'?Promise.resolve({data:[]}):db.from('entity_status_interventions')
        .select('id,actor_id,previous_status,next_status,reason,created_at')
        .eq('entity_kind',kind).eq('entity_id',id).order('created_at',{ascending:false}).limit(30)
    ]);
    if(error)throw error;
    if(interventions.error)throw interventions.error;
    if(root.dataset.responsibilityId!==id)return;
    const transfers=(data||[]).map(x=>({at:x.created_at,id:x.id,html:`<div class="hint">
      <time>${esc(new Date(x.created_at).toLocaleString('ru-RU'))}</time> ·
      ${esc(name(x.actor_id))}: ${esc(x.reason)}.
      ${x.owner_id!==x.previous_owner_id?`Владелец → ${esc(name(x.owner_id))}.`:''}
      ${x.curator_id!==x.previous_curator_id?`Куратор → ${esc(name(x.curator_id))}.`:''}
    </div>`}));
    const status=(interventions.data||[]).map(x=>({at:x.created_at,id:x.id,html:`<div class="hint">
      <time>${esc(new Date(x.created_at).toLocaleString('ru-RU'))}</time> ·
      ${esc(name(x.actor_id))}: смена стадии ${esc(x.previous_status)} → ${esc(x.next_status)}.
      Причина: ${esc(x.reason)}.
    </div>`}));
    const list=[...transfers,...status].sort((a,b)=>b.at.localeCompare(a.at)||Number(b.id)-Number(a.id));
    events.innerHTML=list.length?list.slice(0,30).map(x=>x.html).join(''):'<p class="hint">Событий ответственности пока не было.</p>';
  };
  refresh().catch(e=>{events.textContent='История недоступна: '+e.message;onError(e);});
  const form=root.querySelector('form');
  if(form)form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('button'),status=form.querySelector('[role=status]');
    const field=form.elements.field.value,p_person=form.elements.person.value,
      p_reason=form.elements.reason.value.trim();
    if(p_reason.length<5){status.textContent='Укажи причину не короче пяти символов';return;}
    button.disabled=true;status.textContent='Передаю…';
    try{
      const {data,error}=await db.rpc('entity_responsibility_assign',{
        p_kind:kind,p_id:id,p_field:field,p_person,p_reason,
        p_expected:kind==='order'?record.revision:null
      });
      if(error)throw error;
      owner=data.owner_id;curator=data.curator_id;
      root.querySelector('[data-owner]').textContent=name(owner);
      root.querySelector('[data-curator]').textContent=name(curator);
      form.elements.reason.value='';status.textContent='Передано';
      if(!admin&&owner!==actor&&curator!==actor)form.remove();
      await refresh();await onChange?.(data);
    }catch(e){status.textContent=e.message||'Не удалось передать';onError(e);}
    finally{button.disabled=false;}
  };
}
