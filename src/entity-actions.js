import {protectNativeForm} from './modal-shell.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountEntityActions({trigger,items}){
 if(!trigger)return;
 trigger.classList.add('entity-actions-trigger');trigger.type='button';trigger.textContent='⋯';trigger.setAttribute('aria-label','Другие действия');trigger.setAttribute('aria-haspopup','dialog');
 trigger.onclick=()=>{
  const choices=(typeof items==='function'?items():items).filter(x=>!x.hidden),dialog=document.createElement('dialog');dialog.className='entity-actions-menu';dialog.setAttribute('aria-label','Другие действия');
  dialog.innerHTML='<div class="entity-dialog-head"><h3>Другие действия</h3><form method="dialog"><button class="btn" aria-label="Закрыть">×</button></form></div><div class="entity-menu-list">'+choices.map((x,i)=>`<button type="button" class="entity-menu-item${x.danger?' danger':''}" data-action="${i}" ${x.disabled?'disabled':''}>${esc(x.label)}</button>`).join('')+'</div>';
  dialog.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{dialog.close();choices[Number(b.dataset.action)].onSelect?.(trigger);});
  document.body.append(dialog);protectNativeForm(dialog,{trigger,confirmDiscard:async()=>true});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 };
}
export function openEntityPanel({title,panel,trigger,confirmDiscard=async()=>true}){
 if(!panel)return;
 const placeholder=document.createComment('entity panel');panel.before(placeholder);const hidden=panel.hidden,display=panel.style.display;
 const dialog=document.createElement('dialog');dialog.className='entity-panel-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML=`<div class="entity-dialog-head"><h3>${esc(title)}</h3><form method="dialog"><button class="btn" aria-label="Закрыть">×</button></form></div><div class="entity-dialog-body"></div>`;
 panel.hidden=false;panel.style.display='';dialog.querySelector('.entity-dialog-body').append(panel);document.body.append(dialog);
 const footer=panel.querySelector('.entity-dialog-foot,.entity-dialog-footer'),footerPlace=document.createComment('dialog footer');if(footer){footer.before(footerPlace);dialog.append(footer);}
 protectNativeForm(dialog,{trigger,confirmDiscard});dialog.addEventListener('close',()=>{if(footer)footerPlace.replaceWith(footer);placeholder.replaceWith(panel);panel.hidden=hidden;panel.style.display=display;dialog.remove();},{once:true});dialog.showModal();return dialog;
}
