const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = {job:['Заявка','▤'],order:['Задание','✓'],trip:['Выезд','↗']};
const dateFormat = new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',day:'numeric',month:'long',year:'numeric'});
const timeFormat = new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit'});
export function notificationRoute(row) {
  return types[row.entity_kind] && /^[a-f\d-]{36}$/i.test(row.entity_id || '') ? `#/${row.entity_kind}/${row.entity_id}` : null;
}
export function notificationRowsHTML(rows) {
  let previous='';
  return rows.map(row=>{
    const date=new Date(row.created_at), valid=Number.isFinite(+date), day=valid?dateFormat.format(date):'Без даты';
    const heading=day===previous?'':`<h3 class="notice-day">${esc(day)}</h3>`;previous=day;
    const [kind,icon]=types[row.entity_kind]||['Событие','•'],route=notificationRoute(row);
    return `${heading}<article class="notice-row${row.read_at?'':' unread'}" data-notice="${esc(row.id)}"><div class="notice-icon" aria-hidden="true">${icon}</div><div class="notice-content"><span class="notice-kind">${kind}${row.read_at?'':' · новое'}</span><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p>${route?`<a href="${esc(route)}" data-notice-open="${esc(row.id)}">Открыть ${kind.toLowerCase()}</a>`:''}</div><div class="notice-meta"><time datetime="${esc(row.created_at)}" title="${esc(day)}">${valid?timeFormat.format(date):'—'}</time><button type="button" class="notice-read" data-notice-read="${esc(row.id)}" aria-label="${row.read_at?'Отметить непрочитанным':'Отметить прочитанным'}" title="${row.read_at?'Отметить непрочитанным':'Отметить прочитанным'}">${row.read_at?'○':'✓'}</button></div></article>`;
  }).join('');
}

export function createNotifications({db,userId,host,badge,onPush,onOpen,onError}) {
  let owner=null,rows=[],offset=0,more=false,version=0,badgeVersion=0,timer=null,searchTimer=null;
  let unread=false,search='',kind='',loading=false,newest=null;
  const current = (uid,v) => uid===userId() && owner===uid && v===version;
  function reset() {
    owner=null;rows=[];version++;badgeVersion++;loading=false;offset=0;newest=null;
    clearInterval(timer);clearTimeout(searchTimer);timer=null;
    if(host())host().innerHTML='';if(badge()){badge().hidden=true;badge().textContent='';}
  }
  async function refreshBadge() {
    const uid=userId(),v=++badgeVersion;if(!uid)return;
    try {
      const {count,error}=await db().from('notification_inbox').select('id',{count:'exact',head:true}).eq('recipient_id',uid).is('read_at',null);
      if(error)throw error;if(uid!==userId()||v!==badgeVersion)return;
      const b=badge();if(b){b.hidden=!count;b.textContent=count>99?'99+':String(count||'');b.setAttribute('aria-label',`${count||0} непрочитанных уведомлений`);}
    } catch { /* The inbox itself reports load errors; polling is silent. */ }
  }
  function start() { if(!timer)timer=setInterval(()=>{if(globalThis.document?.visibilityState!=='hidden')refreshBadge();},60000);refreshBadge(); }
  function scaffold() {
    const box=host();if(!box)return;
    box.innerHTML='<header class="notice-header"><div><h1>Уведомления</h1></div><button type="button" class="btn ghost" data-notice-push>Настроить push</button></header><div class="notice-toolbar"><div class="notice-tabs" role="group" aria-label="Фильтр уведомлений"><button type="button" data-notice-filter="all">Все</button><button type="button" data-notice-filter="unread">Непрочитанные</button></div><label class="sr-only" for="noticeSearch">Поиск уведомлений</label><input id="noticeSearch" type="search" placeholder="Поиск по уведомлениям"><label class="sr-only" for="noticeKind">Тип события</label><select id="noticeKind"><option value="">Все события</option><option value="job">Заявки</option><option value="order">Задания</option><option value="trip">Выезды</option></select></div><div class="notice-actions"><button type="button" class="btn sm ghost" data-notice-all>Прочитать все</button><button type="button" class="btn sm ghost" data-notice-refresh>Обновить</button></div><div class="notice-status" role="status" aria-live="polite"></div><div class="notice-list"></div><button type="button" class="btn notice-more" data-notice-more hidden>Показать ещё</button>';
    box.querySelector('[data-notice-push]').onclick=onPush;
    box.querySelector('#noticeSearch').value=search;box.querySelector('#noticeKind').value=kind;
    const paintFilter=()=>box.querySelectorAll('[data-notice-filter]').forEach(b=>{const on=(b.dataset.noticeFilter==='unread')===unread;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});paintFilter();
    box.querySelectorAll('[data-notice-filter]').forEach(b=>b.onclick=()=>{unread=b.dataset.noticeFilter==='unread';paintFilter();load();});
    box.querySelector('#noticeSearch').oninput=e=>{search=e.target.value.trim();clearTimeout(searchTimer);version++;clearList();searchTimer=setTimeout(()=>load(),250);};
    box.querySelector('#noticeKind').onchange=e=>{kind=e.target.value;load();};
    box.querySelector('[data-notice-refresh]').onclick=()=>load();
    box.querySelector('[data-notice-more]').onclick=()=>load(true);
    box.querySelector('[data-notice-all]').onclick=async e=>{
      const uid=owner,v=version,cutoff=newest;if(!cutoff)return;e.target.disabled=true;
      try{const {error}=await db().rpc('notification_mark_all_read',{p_before:cutoff});if(error)throw error;if(current(uid,v)){await load();refreshBadge();}}
      catch(error){if(current(uid,v))onError(error.message||'Не удалось отметить уведомления');}
      finally{if(current(uid,v))e.target.disabled=false;}
    };
  }
  function clearList(){const box=host();if(!box)return;box.querySelector('.notice-list').innerHTML='';box.querySelector('[data-notice-more]').hidden=true;box.querySelector('[data-notice-all]').disabled=true;}
  async function setRead(row,read) {
    const uid=owner,v=version;
    const {error}=await db().rpc('notification_set_read',{p_id:row.id,p_read:read});if(error)throw error;
    if(!current(uid,v))return false;
    row.read_at=read?new Date().toISOString():null;
    if(unread && read){rows=rows.filter(r=>r.id!==row.id);offset=Math.max(0,offset-1);if(loading){await load();refreshBadge();return true;}}
    paintRows();refreshBadge();return true;
  }
  function paintRows() {
    const box=host();if(!box)return;
    box.querySelector('.notice-list').innerHTML=notificationRowsHTML(rows);
    box.querySelector('.notice-status').textContent=rows.length?'':search?'По этому запросу ничего не найдено.':unread?'Все уведомления прочитаны.':'Уведомлений пока нет. Новые события появятся здесь.';
    box.querySelector('[data-notice-more]').hidden=!more;
    box.querySelector('[data-notice-all]').disabled=!newest;
    box.querySelectorAll('[data-notice-read]').forEach(b=>b.onclick=async()=>{const uid=owner,row=rows.find(r=>r.id===b.dataset.noticeRead);if(!row)return;b.disabled=true;try{await setRead(row,!row.read_at);}catch(error){if(uid===userId())onError(error.message||'Не удалось отметить уведомление');b.disabled=false;}});
    box.querySelectorAll('[data-notice-open]').forEach(a=>a.onclick=async e=>{
      if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();
      const uid=owner,row=rows.find(r=>r.id===a.dataset.noticeOpen);if(!row)return;
      try{if(!row.read_at)await setRead(row,true);}catch(error){if(uid===userId())onError(error.message||'Не удалось отметить уведомление');}
      if(uid===userId())onOpen(notificationRoute(row));
    });
  }
  async function load(append=false) {
    const uid=userId();if(!uid)return;if(append&&loading)return;
    const v=++version;loading=true;const start=append?offset:0;
    const box=host();if(!box?.querySelector('.notice-list')){loading=false;return;}
    if(!append){rows=[];offset=0;newest=null;clearList();}
    box.querySelector('.notice-status').textContent='Загружаем уведомления…';box.querySelector('[data-notice-more]').disabled=true;
    try{
      let query=db().from('notification_inbox').select('id,recipient_id,entity_kind,entity_id,title,body,created_at,read_at,source').eq('recipient_id',uid).order('created_at',{ascending:false}).order('id',{ascending:false});
      if(unread)query=query.is('read_at',null);if(kind)query=query.eq('entity_kind',kind);
      if(search)query=query.ilike('search_text','%'+search.replace(/[\\%_]/g,'\\$&')+'%');
      const {data,error}=await query.range(start,start+49);if(error)throw error;
      if(!current(uid,v))return;offset=start+(data||[]).length;
      const own=(data||[]).filter(r=>r.recipient_id===uid);
      rows=append?[...rows,...own.filter(r=>!rows.some(old=>old.id===r.id))]:own;more=(data||[]).length===50;
      // Cutoff never includes events that arrived after the first visible page.
      if(!append)newest=rows[0]?.created_at||null;
      paintRows();refreshBadge();
    }catch(error){if(!current(uid,v))return;box.querySelector('.notice-status').textContent='Не удалось загрузить уведомления. Нажмите «Обновить», чтобы повторить.';if(append)box.querySelector('[data-notice-more]').hidden=false;}
    finally{if(current(uid,v)){loading=false;box.querySelector('[data-notice-more]').disabled=false;}}
  }
  function open(){const uid=userId();if(!uid)return;if(owner!==uid){reset();owner=uid;unread=false;search='';kind='';}scaffold();start();return load();}
  return {open,start,reset,refreshBadge};
}
