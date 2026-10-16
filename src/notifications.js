import {frameNotifications} from './workspace-ui.js';
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
    const [kind]=types[row.entity_kind]||['Событие','•'],route=notificationRoute(row);
    return `${heading}<article class="notice-row${row.read_at?'':' unread'}" data-notice="${esc(row.id)}"><div class="notice-icon" aria-hidden="true"></div><div class="notice-content"><span class="notice-kind">${kind}${row.read_at?'':' · новое'}</span><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p>${route?`<a href="${esc(route)}" data-notice-open="${esc(row.id)}">Открыть ${kind.toLowerCase()}</a>`:''}</div><div class="notice-meta"><time datetime="${esc(row.created_at)}" title="${esc(day)}">${valid?timeFormat.format(date):'—'}</time><button type="button" class="notice-read" data-notice-read="${esc(row.id)}" aria-label="${row.read_at?'Отметить непрочитанным':'Отметить прочитанным'}" title="${row.read_at?'Отметить непрочитанным':'Отметить прочитанным'}">${row.read_at?'○':'✓'}</button></div></article>`;
  }).join('');
}

// Current work awaiting this curator. The inbox is a history and cannot be used
// as a source of pending decisions: reading an event does not resolve its record.
export async function loadNotificationDecisions(db,uid) {
  const [orders,trips]=await Promise.all([
    db.from('service_orders').select('id,number,title,status,curator_id').eq('curator_id',uid).eq('status','review').order('updated_at',{ascending:false}).limit(101),
    db.from('trips').select('id,vehicle_label,date_from,status,curator_id').eq('curator_id',uid).in('status',['finished','done']).is('deleted_at',null).order('date_from',{ascending:false}).limit(101),
  ]);
  if(orders.error)throw orders.error;if(trips.error)throw trips.error;
  const ownOrders=(orders.data||[]).filter(o=>o.curator_id===uid&&o.status==='review').slice(0,100);
  const ownTrips=(trips.data||[]).filter(t=>t.curator_id===uid&&['finished','done'].includes(t.status)).slice(0,100);
  const stays=ownTrips.length?await db.from('trip_stays').select('id,trip_id,status,stay_to').in('trip_id',ownTrips.map(t=>t.id)).eq('status','detected').not('stay_to','is',null).limit(1001):{data:[]};
  if(stays.error)throw stays.error;
  const items=ownOrders.map(o=>({entity_kind:'order',entity_id:o.id,title:`Задание №${o.number} · ${o.title}`,kind:'Проверка результата',body:'Исполнитель передал результат на проверку. Откройте задание, чтобы проверить объём и остаток.',action:'Проверить результат'}));
  for(const t of ownTrips){const pending=(stays.data||[]).filter(s=>s.trip_id===t.id&&s.status==='detected'&&s.stay_to).length;if(pending)items.push({entity_kind:'trip',entity_id:t.id,title:t.vehicle_label||'Выезд',kind:'Проверка присутствия',body:`Дата выезда: ${t.date_from||'не указана'}. Записей GPS без решения: ${pending}.`,action:'Проверить присутствие'});}
  return {items,truncated:(orders.data||[]).length>100||(trips.data||[]).length>100||(stays.data||[]).length>=1000};
}

export function createNotifications({db,userId,host,badge,onPush,onOpen,onError,loadDecisions}) {
  let owner=null,rows=[],offset=0,more=false,version=0,badgeVersion=0,decisionVersion=0,timer=null,searchTimer=null;
  let unread=false,search='',kind='',loading=false,newest=null;
  const current = (uid,v) => uid===userId() && owner===uid && v===version;
  function reset() {
    owner=null;rows=[];version++;badgeVersion++;decisionVersion++;loading=false;offset=0;newest=null;
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
    box.innerHTML='<header class="notice-header"><div><h1>Уведомления</h1><p>Изменения в ваших заявках, заданиях и выездах.</p></div></header><div class="notice-toolbar"><div class="notice-tabs" role="group" aria-label="Фильтр уведомлений"><button type="button" data-notice-filter="all">Все</button><button type="button" data-notice-filter="unread">Непрочитанные</button></div><label class="sr-only" for="noticeSearch">Поиск уведомлений</label><input id="noticeSearch" type="search" placeholder="Поиск по уведомлениям"><label class="sr-only" for="noticeKind">Тип события</label><select id="noticeKind"><option value="">Все события</option><option value="job">Заявки</option><option value="order">Задания</option><option value="trip">Выезды</option></select></div><div class="notice-actions"><button type="button" class="btn sm ghost" data-notice-all>Прочитать все</button><button type="button" class="btn sm ghost" data-notice-refresh>Обновить</button></div><div class="notice-status" role="status" aria-live="polite"></div><div class="notice-list"></div><button type="button" class="btn notice-more" data-notice-more hidden>Показать ещё</button><section class="notice-device"><div><h2>Push на этом устройстве</h2><p>Уведомления сохраняются в приложении независимо от настройки push.</p></div><button type="button" class="btn" data-notice-push>Настроить push</button></section>';
    if(loadDecisions){
      box.querySelector('.notice-header h1').textContent='Уведомления и решения';
      const layout=box.ownerDocument.createElement('div');layout.className='notice-workspace';const incoming=box.ownerDocument.createElement('section');incoming.className='notice-incoming';incoming.setAttribute('aria-label','Входящие уведомления');
      for(const node of [...box.children])if(!node.matches('.notice-header,.notice-device'))incoming.append(node);
      const decisions=box.ownerDocument.createElement('aside');decisions.className='notice-decisions';decisions.setAttribute('aria-label','Ожидают решения');decisions.innerHTML='<header><h2>Ожидают решения <span data-decision-count></span></h2><p>Текущие состояния записей, за проверку которых вы отвечаете.</p></header><div data-decision-status role="status" aria-live="polite"></div><div data-decision-list></div><button type="button" class="btn sm ghost" data-decision-retry hidden>Повторить загрузку</button>';
      layout.append(incoming,decisions);box.querySelector('.notice-device').before(layout);decisions.querySelector('[data-decision-retry]').onclick=refreshDecisions;
    }
    box.querySelector('[data-notice-push]').onclick=onPush;frameNotifications(box);
    box.querySelector('#noticeSearch').value=search;box.querySelector('#noticeKind').value=kind;
    const paintFilter=()=>box.querySelectorAll('[data-notice-filter]').forEach(b=>{const on=(b.dataset.noticeFilter==='unread')===unread;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});paintFilter();
    box.querySelectorAll('[data-notice-filter]').forEach(b=>b.onclick=()=>{unread=b.dataset.noticeFilter==='unread';paintFilter();load();});
    box.querySelector('#noticeSearch').oninput=e=>{search=e.target.value.trim();clearTimeout(searchTimer);version++;clearList();searchTimer=setTimeout(()=>load(),250);};
    box.querySelector('#noticeKind').onchange=e=>{kind=e.target.value;load();};
    box.querySelector('[data-notice-refresh]').onclick=()=>Promise.all([load(),refreshDecisions()]);
    box.querySelector('[data-notice-more]').onclick=()=>load(true);
    box.querySelector('[data-notice-all]').onclick=async e=>{
      const uid=owner,v=version,cutoff=newest;if(!cutoff)return;e.target.disabled=true;
      try{const {error}=await db().rpc('notification_mark_all_read',{p_before:cutoff});if(error)throw error;if(current(uid,v)){await load();refreshBadge();}}
      catch(error){if(current(uid,v))onError(error.message||'Не удалось отметить уведомления');}
      finally{if(current(uid,v))e.target.disabled=false;}
    };
  }
  async function refreshDecisions(){
    const uid=userId(),v=++decisionVersion,box=host();if(!loadDecisions||!uid||!box?.querySelector('[data-decision-list]'))return;
    const valid=()=>uid===userId()&&owner===uid&&v===decisionVersion;
    const status=box.querySelector('[data-decision-status]'),list=box.querySelector('[data-decision-list]'),count=box.querySelector('[data-decision-count]'),retry=box.querySelector('[data-decision-retry]');
    status.textContent='Проверяем текущие состояния…';list.innerHTML='';count.textContent='';retry.hidden=true;
    try{const result=await loadDecisions(uid);if(!valid())return;const items=(result.items||[]).filter(notificationRoute);
      count.textContent=String(items.length)+(result.truncated?'+':'');status.textContent=result.truncated?'Показана часть очереди. Остальные записи доступны в заданиях и выездах.':items.length?'':'Сейчас нет записей, ожидающих вашей проверки.';
      list.innerHTML=items.map(row=>`<article class="notice-decision-card"><span class="notice-kind">${esc(row.kind)}</span><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p><a class="btn ${row.entity_kind==='order'?'amber':''}" href="${esc(notificationRoute(row))}" data-decision-open>${esc(row.action)}</a></article>`).join('');
      list.querySelectorAll('[data-decision-open]').forEach(a=>a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(valid())onOpen(a.getAttribute('href'));});
    }catch{if(valid()){status.textContent='Не удалось проверить очередь решений.';retry.hidden=false;}}
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
  function open(){const uid=userId();if(!uid)return;if(owner!==uid){reset();owner=uid;unread=false;search='';kind='';}scaffold();start();return Promise.all([load(),refreshDecisions()]);}
  return {open,start,reset,refreshBadge};
}
