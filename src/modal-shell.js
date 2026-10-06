// Legacy .on remains the application contract; native dialogs own the top layer,
// keyboard containment and inert background, including nested prompts.
export function installModalShell({dismiss = {}, canDismiss = () => true, confirmDiscard, dirtyIds = []} = {}) {
  const states = new Map(), dirtySet = new Set(dirtyIds);
  const snapshot = node => JSON.stringify({fields:[...node.querySelectorAll('input,select,textarea')].map(el => [el.id, el.value, el.checked, el.multiple ? [...el.selectedOptions].map(o=>o.value) : null]),scope:[...node.querySelectorAll('[data-cs].on')].map(el=>el.dataset.cs),coordinates:node.querySelector('#pointCoords')?.textContent});
  const api = {
    markClean(id) { const state=states.get(id); if(state) state.baseline=snapshot(state.node); },
    async requestClose(id) {
      const state=states.get(id); if(!state || state.pending || !canDismiss(id)) return false;
      state.pending=true;
      try {
        if(dirtySet.has(id) && state.baseline!==snapshot(state.node) && !await confirmDiscard()) return false;
        state.replaying=true;
        try { if(dismiss[id]) dismiss[id](); else if(id==='phView')state.node.hidden=true;else state.node.classList.remove('on'); } finally {state.replaying=false;}
        return true;
      } finally { state.pending=false; }
    }
  };
  for(const old of document.querySelectorAll('.overlay,#moreSheet,#phView')) {
    const node=document.createElement('dialog');
    for(const attr of old.attributes) node.setAttribute(attr.name,attr.value);
    node.setAttribute('aria-modal','true');if(node.id==='phView')node.setAttribute('aria-label','Просмотр фотографии');
    while(old.firstChild) node.append(old.firstChild);
    old.replaceWith(node);
    const modal=node.querySelector('.modal'), title=modal?.querySelector('h3');
    if(title) {
      title.id ||= `${node.id}Title`;node.setAttribute('aria-labelledby',title.id);
      const head=document.createElement('div');head.className='modal-head';title.before(head);head.append(title);
      const close=document.createElement('button');close.type='button';close.className='btn modal-close';close.textContent='✕';close.setAttribute('aria-label','Закрыть окно');
      close.onclick=()=>api.requestClose(node.id);head.append(close);
    }
    for(const label of node.querySelectorAll('label')){const field=label.nextElementSibling;if(!label.control&&field?.matches('input,select,textarea')&&field.id)label.htmlFor=field.id;}
    const state={node,baseline:'',pending:false,trigger:null};states.set(node.id,state);
    // Cancel buttons have established cleanup handlers. Guard before those run.
    node.addEventListener('click',async e=>{
      const button=e.target.closest('button');
      if(!button || button.closest('dialog')!==node || button.classList.contains('modal-close') || state.replaying) return;
      if(!/^(Отмена(?: правки)?|Закрыть|Позже)$/.test(button.textContent.trim()) || !dirtySet.has(node.id) || state.baseline===snapshot(node)) return;
      e.preventDefault();e.stopImmediatePropagation();
      if(state.pending)return;
      state.pending=true;
      try {if(await confirmDiscard()){state.replaying=true;button.click();state.replaying=false;}} finally {state.pending=false;}
    },true);
    node.addEventListener('cancel',e=>{e.preventDefault();api.requestClose(node.id);});
    node.addEventListener('click',e=>{if(e.target===node){e.stopImmediatePropagation();api.requestClose(node.id);}},true);
    new window.MutationObserver(()=>{
      const on=node.id==='phView'?!node.hidden:node.classList.contains('on');
      if(on&&!node.open) {
        state.trigger=document.activeElement;state.baseline=snapshot(node);
        const close=node.querySelector('.modal-close');if(close)close.hidden=!canDismiss(node.id);
        if(node.id==='cfgOverlay')node.querySelector('#cfgCancel').hidden=!canDismiss(node.id);
        // Focus the form or neutral cancel action, never a destructive action.
        node.showModal();
        const first=[...node.querySelectorAll('input:not([type=hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled),button.ghost:not(:disabled)')].find(el=>el.getClientRects().length) || close || node.querySelector('button:not(:disabled)');
        first?.focus({preventScroll:true});
      } else if(!on&&node.open) node.close();
    }).observe(node,{attributes:true,attributeFilter:['class','hidden']});
    node.addEventListener('close',()=>{
      if(node.open)return;
      node.classList.remove('on');if(node.id==='phView')node.hidden=true;
      if(state.trigger?.isConnected && !state.trigger.closest('dialog:not([open])'))state.trigger.focus({preventScroll:true});
    });
    const lastRows=[...modal?.querySelectorAll('.row') || []].filter(row=>row.querySelector('button') && [...row.querySelectorAll('button')].some(b=>/^(Отмена|Закрыть|Позже|Сохранить|Подтвердить)$/.test(b.textContent.trim())));
    lastRows.at(-1)?.classList.add('modal-actions');
  }
  return api;
}

export function protectNativeForm(dialog, {trigger, confirmDiscard}) {
  const snapshot=()=>JSON.stringify([...dialog.querySelectorAll('input,select,textarea')].map(el=>[el.value,el.checked,el.multiple?[...el.selectedOptions].map(o=>o.value):null]));
  const baseline=snapshot();let pending=false;
  const cancel=async()=>{
    if(pending)return;pending=true;
    try {if(snapshot()===baseline || await confirmDiscard())dialog.close();}finally {pending=false;}
  };
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  dialog.querySelector('form[method=dialog]')?.addEventListener('submit',e=>{e.preventDefault();cancel();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cancel();}});
  dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});});
}
