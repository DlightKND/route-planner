const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const CONFIG = {
  job: { comments:'job_comments', owner:'job_id', history:'job_history', historyOwner:'job_id' },
  order: { comments:'service_order_comments', owner:'order_id', history:'service_order_history', historyOwner:'order_id' },
  trip: { comments:'trip_comments', owner:'trip_id', history:'trip_revision_history', historyOwner:'trip_id' }
};

const time = value => value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}) : '—';
const actor = (id,people) => id ? (people.find(p=>p.id===id)?.full_name||'Сотрудник') : 'Система';

function render(rows,people) {
  if (!rows.length) return '<p class="hint">Пока нет записей.</p>';
  return rows.map(row => {
    const who=esc(actor(row.actor_id,people));
    if (row.kind==='comment') return `<article class="activity-entry is-comment"><header>${who}<time>${esc(time(row.created_at))}</time></header><p>${esc(row.body).replaceAll('\n','<br>')}</p></article>`;
    const label=esc(row.event||row.reason||`Изменение плана · версия ${row.revision??'—'}`);
    return `<article class="activity-entry"><header>${who}<time>${esc(time(row.recorded_at))}</time></header><p>${label}</p></article>`;
  }).join('');
}

export async function loadEntityActivity(db,entity,id,people=[]) {
  const c=CONFIG[entity];
  if (!c) throw new Error('Неизвестный тип карточки');
  const [comments,history]=await Promise.all([
    db.from(c.comments).select('id,author_id,created_at,body').eq(c.owner,id).order('created_at',{ascending:false}).limit(100),
    db.from(c.history).select(entity==='job'?'id,actor_id,recorded_at,event,changed_fields':entity==='trip'?'id,actor_id,recorded_at,reason,revision':'id,actor_id,recorded_at,reason').eq(c.historyOwner,id).order('recorded_at',{ascending:false}).limit(100)
  ]);
  if (comments.error) throw comments.error;
  if (history.error) throw history.error;
  const entries=[...(comments.data||[]).map(row=>({...row,kind:'comment'})),...(history.data||[]).map(row=>({...row,kind:'event'}))];
  entries.sort((a,b)=>Date.parse(b.created_at||b.recorded_at)-Date.parse(a.created_at||a.recorded_at));
  return render(entries,people);
}

export function mountEntityActivity({root,db,entity,id,userId,people=()=>[],onError=()=>{}}) {
  if (!root || !id) return;
  root.dataset.entityId=id;
  root.innerHTML='<div class="entity-activity-feed" aria-live="polite"><p class="hint">Загружаю историю…</p></div><form class="entity-activity-form"><label>Комментарий<textarea name="body" maxlength="4000" rows="3" required placeholder="Добавить комментарий"></textarea></label><button class="btn sm amber" type="submit">Отправить</button><span class="hint" role="status"></span></form>';
  const feed=root.querySelector('.entity-activity-feed'), form=root.querySelector('.entity-activity-form'), status=form.querySelector('[role=status]');
  const refresh=async()=>{
    try { const html=await loadEntityActivity(db,entity,id,people()); if(root.dataset.entityId===id)feed.innerHTML=html; }
    catch(error) { if(root.dataset.entityId===id){feed.innerHTML=`<p class="hint">История недоступна: ${esc(error.message)}</p>`;onError(error);} }
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const input=form.elements.body,body=input.value.trim(),button=form.querySelector('button');
    if (!body) { status.textContent='Введите комментарий.'; return; }
    button.disabled=true;status.textContent='Отправляю…';
    try {
      const c=CONFIG[entity];
      const {error}=await db.from(c.comments).insert({[c.owner]:id,body,author_id:userId()});
      if (error) throw error;
      input.value='';status.textContent='Комментарий добавлен.';await refresh();
    } catch(error) { status.textContent=error.message||'Не удалось добавить комментарий.';onError(error); }
    finally { button.disabled=false; }
  };
  refresh();
}
