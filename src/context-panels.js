const contexts=new WeakMap();
// Small context panels share the top layer without disabling the whole page.
export function openContextPanel(panel, {trigger, label, onClose, remove=false}={}) {
  contexts.get(panel)?.dispose();
  panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label',label || panel.getAttribute('aria-label') || 'Действия');
  trigger?.setAttribute('aria-expanded','true');let closed=false;
  const dispose=()=>{panel.removeEventListener('toggle',toggle);panel.removeEventListener('keydown',key);contexts.delete(panel);};
  const close=()=>{
    if(closed)return;closed=true;dispose();
    if(panel.matches(':popover-open'))panel.hidePopover();
    panel.classList.remove('on');trigger?.setAttribute('aria-expanded','false');
    onClose?.();if(remove)panel.remove();
  };
  const toggle=e=>{if(e.newState==='closed'&&!panel.matches(':popover-open'))close();};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();trigger?.focus({preventScroll:true});}};
  contexts.set(panel,{dispose});panel.addEventListener('toggle',toggle);panel.addEventListener('keydown',key);
  panel.showPopover();
  (panel.querySelector('button:not(:disabled),input:not(:disabled),summary') || panel).focus({preventScroll:true});
  return close;
}
