// Keep native select state as the form contract; render choices in the top layer.
export function installEngineerPickers(root = document) {
  if (!window.MutationObserver) return;
  const mounted = new Map();
  let active = null;
  const close = () => {
    if (!active) return;
    const {panel,button} = active;
    if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
    panel.remove(); button.setAttribute('aria-expanded','false'); active = null;
  };
  const scan = () => {
    for (const [select,button] of mounted) {
      if (active?.select===select && select.disabled) close();
      if (!select.isConnected) { if (active?.select === select) close(); button.remove(); mounted.delete(select); }
    }
    root.querySelectorAll('select[multiple]').forEach(select => {
      let button = mounted.get(select);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'engineer-picker btn';
        button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false');
        select.dataset.crewNative = 'true'; select.after(button); mounted.set(select,button);
        button.onclick = () => {
          if (active?.select === select) { close(); return; }
          close();
          const panel = document.createElement('div'); panel.className = 'engineer-options'; panel.setAttribute('role','dialog');
          panel.setAttribute('aria-label',select.getAttribute('aria-label') || 'Выбор инженеров');
          panel.setAttribute('popover','auto');
          const title = document.createElement('div');title.className='engineer-options-title';title.textContent='Инженеры';panel.append(title);
          for (const option of select.options) {
            const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
            input.type='checkbox';input.checked=option.selected;input.disabled=option.disabled;
            text.textContent=option.textContent;label.append(input,text);panel.append(label);
            input.onchange=()=>{option.selected=input.checked;select.dispatchEvent(new window.Event('change',{bubbles:true}));scan();};
          }
          if (!select.options.length) { const empty=document.createElement('p');empty.textContent='Нет доступных инженеров';panel.append(empty); }
          const done=document.createElement('button');done.type='button';done.className='btn sm';done.textContent='Готово';panel.append(done);
          done.onclick=()=>{close();button.focus();};
          (select.closest('dialog') || document.body).append(panel);
          active={panel,button,select};button.setAttribute('aria-expanded','true');
          const box=button.getBoundingClientRect(),width=Math.min(Math.max(box.width,240),window.innerWidth-16);
          panel.style.width=width+'px';panel.style.left=Math.max(8,Math.min(box.left,window.innerWidth-width-8))+'px';
          panel.style.maxHeight=Math.max(120,Math.min(320,window.innerHeight-32))+'px';
          if (panel.showPopover) panel.showPopover();
          const height=panel.getBoundingClientRect().height;
          panel.style.top=Math.max(8,box.bottom+height+8<window.innerHeight?box.bottom+4:box.top-height-4)+'px';
          panel.addEventListener('toggle',e=>{if(e.newState==='closed'&&active?.panel===panel){panel.remove();button.setAttribute('aria-expanded','false');active=null;}});
          (panel.querySelector('input:not(:disabled)') || done).focus();
        };
      }
      const names=[...select.options].filter(o=>o.selected).map(o=>o.textContent.trim());
      const label=names.length?names.join(', '):'Выбрать инженеров';
      if(button.textContent!==label+' ▾')button.textContent=label+' ▾';
      button.title=label;if(button.disabled!==select.disabled)button.disabled=select.disabled;
      button.setAttribute('aria-label',(select.getAttribute('aria-label') || 'Инженеры')+': '+label);
    });
  };
  new window.MutationObserver(scan).observe(root.body || root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});
  root.addEventListener('change',scan);root.addEventListener('crew-sync',scan);
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();e.stopPropagation();const b=active.button;close();b.focus();}},true);
  root.addEventListener('pointerdown',e=>{if(active&&!active.panel.contains(e.target)&&!active.button.contains(e.target))close();},true);
  window.addEventListener('resize',close);
  root.addEventListener('scroll',e=>{if(active&&!active.panel.contains(e.target))close();},true);
  scan();
}
