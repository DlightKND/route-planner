const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const roleName = role => ({admin:'Администратор',logist:'Логист',engineer:'Инженер'}[role] || role || 'Сотрудник');
export const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('').toLocaleUpperCase('ru-RU') || 'Я';
export function openAccountProfile({profile, user, readOrg, logout, settings, trigger}) {
  const dialog = document.createElement('dialog');
  dialog.className='modal account-profile';
  dialog.setAttribute('aria-labelledby','accountProfileTitle');
  const name=profile.full_name || user.email || 'Мой профиль';
  dialog.innerHTML=`<div class="account-profile-head"><h2 id="accountProfileTitle">Мой профиль</h2><button type="button" class="btn sm" data-profile-close aria-label="Закрыть профиль">✕</button></div><div class="account-identity"><div class="account-avatar" aria-label="Аватар">${esc(initials(name))}</div><div><h3>${esc(name)}</h3><p>${esc(roleName(profile.role))}</p></div></div><dl class="account-details"><div><dt>Электронная почта</dt><dd>${esc(user.email || 'Не указана')}</dd></div>${profile.contact?`<div><dt>Контакт</dt><dd>${esc(profile.contact)}</dd></div>`:''}</dl><div class="account-org" role="status">Загружаю структуру…</div><div class="account-profile-actions"><button type="button" class="btn" data-profile-settings>Личные настройки</button><button type="button" class="btn red" data-profile-logout>Выйти</button></div>`;
  // An existing account image is presentation only; it never supplies permissions.
  const url=user.user_metadata?.avatar_url || user.user_metadata?.picture;
  if (typeof url==='string' && /^https:\/\//i.test(url)) {
    const img=document.createElement('img');img.src=url;img.alt=name;img.referrerPolicy='no-referrer';
    img.addEventListener('error',()=>img.remove());dialog.querySelector('.account-avatar').append(img);
  }
  dialog.querySelector('[data-profile-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-profile-settings]').onclick=()=>{dialog.close();settings();};
  // Close first so the established sign-out confirmation is above the page.
  dialog.querySelector('[data-profile-logout]').onclick=()=>{dialog.close();logout();};
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});});
  document.body.append(dialog);dialog.showModal();
  const box=dialog.querySelector('.account-org');
  readOrg().then(org=>{
    if(!dialog.isConnected)return;
    const person=p=>`<div class="account-person"><b>${esc(p.full_name || 'Сотрудник')}</b><span>${esc(p.job_title || roleName(p.role))}</span></div>`;
    box.innerHTML=`${org.job_title?`<dl class="account-details"><div><dt>Должность</dt><dd>${esc(org.job_title)}</dd></div></dl>`:''}<h3>Руководитель</h3>${org.manager?person(org.manager):'<p class="hint">Не назначен</p>'}<h3>Прямые подчинённые · ${(org.reports||[]).length}</h3>${(org.reports||[]).map(person).join('') || '<p class="hint">Нет назначенных сотрудников</p>'}`;
  }).catch(()=>{if(dialog.isConnected)box.innerHTML='<p class="err">Не удалось загрузить структуру сотрудников.</p><button type="button" class="btn sm" data-profile-retry>Повторить</button>';box.querySelector('[data-profile-retry]')?.addEventListener('click',()=>{dialog.close();openAccountProfile({profile,user,readOrg,logout,settings,trigger});});});
  return dialog;
}
