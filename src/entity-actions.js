import {captureNativeForm,nativeFieldValue} from './native-form-state.js';
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
const drafts=new WeakMap();
export function entityFieldValue(el){const draft=drafts.get(el);return draft&&!draft.state.saving?draft.value:nativeFieldValue(el);}
export function openEntityPanel({title,panel,trigger,confirmDiscard=async()=>true,onSave,onSaved,onCancel,dispose=false}){
 if(!panel)return;
 const snapshot=onSave?captureNativeForm(panel):null,state={saving:false},disabled=[];let committed=false;
 if(snapshot)for(const field of snapshot.fields)drafts.set(field.el,{value:field.value,state});
 const placeholder=document.createComment('entity panel');panel.before(placeholder);const hidden=panel.hidden,display=panel.style.display;
 const dialog=document.createElement('dialog');dialog.className='entity-panel-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML=`<div class="entity-dialog-head"><h3>${esc(title)}</h3><form method="dialog"><button class="btn" aria-label="Закрыть">×</button></form></div><div class="entity-dialog-body"></div>`;
 panel.hidden=false;panel.style.display='';dialog.querySelector('.entity-dialog-body').append(panel);document.body.append(dialog);
 const footer=panel.querySelector('.entity-dialog-foot,.entity-dialog-footer'),footerPlace=document.createComment('dialog footer');if(footer){footer.before(footerPlace);dialog.append(footer);}
 const guard=protectNativeForm(dialog,{trigger,confirmDiscard,isBusy:()=>state.saving});
 if(onSave){const controls=document.createElement('footer');controls.className='entity-dialog-foot entity-editor-footer';controls.innerHTML='<p class="entity-editor-state hint" role="status">Изменения сохранятся после подтверждения.</p><p class="entity-editor-error err" role="alert"></p><div class="row"><button type="button" class="btn ghost" data-entity-cancel>Отмена</button><button type="button" class="btn amber" data-entity-save>Сохранить изменения</button></div>';dialog.append(controls);controls.querySelector('[data-entity-cancel]').onclick=guard.requestClose;
 controls.querySelector('[data-entity-save]').onclick=async()=>{if(state.saving)return;const invalid=[...panel.querySelectorAll('input,select,textarea')].find(el=>!el.checkValidity());if(invalid){invalid.reportValidity();return;}state.saving=true;controls.querySelector('[role=alert]').textContent='';controls.querySelector('[role=status]').textContent='Сохраняем…';for(const el of dialog.querySelectorAll('input,select,textarea,button')){disabled.push([el,el.disabled]);el.disabled=true;}try{const result=await onSave();if(result===false)throw Error('Изменения не сохранены. Проверьте поля и повторите.');committed=true;state.saving=false;for(const [el,wasDisabled] of disabled.splice(0))el.disabled=wasDisabled;dialog.close();await onSaved?.(result);}catch(error){if(dialog.isConnected){controls.querySelector('[role=alert]').textContent=error.message||'Не удалось сохранить изменения';controls.querySelector('[role=status]').textContent='Не сохранено';}}finally{state.saving=false;for(const [el,wasDisabled] of disabled.splice(0))el.disabled=wasDisabled;}};
 }
 dialog.addEventListener('close',()=>{if(snapshot&&!committed)snapshot.restore();if(snapshot)for(const {el} of snapshot.fields)drafts.delete(el);if(footer)footerPlace.replaceWith(footer);placeholder.replaceWith(panel);panel.hidden=hidden;panel.style.display=display;if(dispose)panel.remove();dialog.remove();if(snapshot&&!committed)onCancel?.();},{once:true});dialog.showModal();return dialog;
}
