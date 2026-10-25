import {openContextPanel} from './context-panels.js';
let sequence=0;

// Native top-layer panels escape scrolling/clipping ancestors and keep details state in sync.
export function wireDetailsPopover(details,{label}={}){
 const trigger=details.querySelector(':scope>summary'),panel=details.querySelector(':scope>div'),win=details.ownerDocument.defaultView;
 if(!trigger||!panel)return {destroy(){}};
 panel.classList.add('anchored-context-panel');panel.id ||= 'context-panel-'+(++sequence);panel.setAttribute('popover','auto');
 trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
 let closePanel=null,pointerWasOpen=false;
 const place=()=>{
  const rail=win.innerWidth<=760?details.ownerDocument.querySelector('.rail')?.getBoundingClientRect().height||0:0;
  const bottom=(win.visualViewport?.height||win.innerHeight)-rail,gutter=16,anchor=trigger.getBoundingClientRect();
  panel.style.maxHeight=Math.max(48,bottom-2*gutter)+'px';
  const box=panel.getBoundingClientRect();
  panel.style.left=Math.max(gutter,Math.min(win.innerWidth-gutter-box.width,anchor.right-box.width))+'px';
  const below=anchor.bottom+8,above=anchor.top-8-box.height;
  panel.style.top=Math.max(gutter,Math.min(bottom-gutter-box.height,below+box.height<=bottom-gutter?below:above>=gutter?above:below))+'px';
 };
 const scroll=event=>{if(panel.contains(event.target))return;const anchor=trigger.getBoundingClientRect();if(anchor.bottom<0||anchor.top>win.innerHeight)closePanel?.();else place();};
 const closed=()=>{closePanel=null;details.open=false;win.removeEventListener('resize',place);win.removeEventListener('scroll',scroll,true);win.visualViewport?.removeEventListener('resize',place);};
 const show=()=>{
  if(closePanel)return;
  details.open=true;closePanel=openContextPanel(panel,{trigger,label:label||trigger.getAttribute('aria-label'),onClose:closed});place();
  [...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary')].find(el=>!el.closest('[hidden]')&&el.getClientRects().length)?.focus({preventScroll:true});
  win.addEventListener('resize',place);win.addEventListener('scroll',scroll,true);win.visualViewport?.addEventListener('resize',place);
 };
 const pointer=()=>{pointerWasOpen=details.open;};
 const click=event=>{event.preventDefault();const wasOpen=event.detail?pointerWasOpen:details.open;if(wasOpen){closePanel?.();details.open=false;}else show();};
 const toggle=()=>{if(details.open)show();else closePanel?.();};
 trigger.addEventListener('pointerdown',pointer);trigger.addEventListener('click',click);details.addEventListener('toggle',toggle);
 return {destroy(){closePanel?.();trigger.removeEventListener('pointerdown',pointer);trigger.removeEventListener('click',click);details.removeEventListener('toggle',toggle);}};
}
