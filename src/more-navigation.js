import {openContextPanel} from './context-panels.js';
import {journalIcon} from './journal-icons.js';

// Secondary destinations remain part of navigation: the rail stays interactive.
export function installMoreNavigation(doc=document){
 const panel=doc.getElementById('moreSheet'),trigger=doc.getElementById('moreBtn'),win=doc.defaultView;
 if(!panel||!trigger)return {close(){},destroy(){}};
 let closePanel=null,pointerWasOpen=false;
 trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
 const place=()=>{
  if(win.innerWidth>760){close();return;}
  const rail=doc.querySelector('.rail').getBoundingClientRect();
  panel.style.bottom=(win.innerHeight-rail.top+12)+'px';
  panel.style.maxHeight=Math.max(48,(win.visualViewport?.height||win.innerHeight)-rail.height-32)+'px';
 };
 const closed=()=>{closePanel=null;win.removeEventListener('resize',place);win.visualViewport?.removeEventListener('resize',place);};
 function close(restoreFocus=false){closePanel?.();if(restoreFocus)trigger.focus({preventScroll:true});}
 function build(){
  const list=panel.querySelector('#moreList');list.replaceChildren();
  for(const source of doc.querySelectorAll('.rail .nav-i.nav-sec')){
   if(source.classList.contains('hidden')||source.style.display==='none')continue;
   const button=doc.createElement('button'),label=doc.createElement('span');button.type='button';button.className='btn ghost sheet-row';button.dataset.moreDestination=source.dataset.tab||source.id;
   const svg=source.querySelector('svg');if(svg){const icon=svg.cloneNode(true);icon.setAttribute('aria-hidden','true');button.append(icon);}else button.innerHTML=journalIcon('person');
   label.textContent=source.id==='profileBtn'?'Мой профиль':source.querySelector('span')?.textContent||source.getAttribute('aria-label');button.append(label);
   if(source.classList.contains('active'))button.setAttribute('aria-current','page');
   // Preserve the original destination, permission checks and draft guards.
   button.onclick=()=>{close();win.setTimeout(()=>source.click(),0);};list.append(button);
  }
  const who=panel.querySelector('#sheetWho'),source=doc.getElementById('whoLabel');who.replaceChildren(...[...source?.childNodes||[]].map(node=>node.cloneNode(true)));
 }
 function open(){
  if(closePanel)return;build();closePanel=openContextPanel(panel,{trigger,label:'Другие разделы',onClose:closed});place();
  panel.querySelector('.sheet-row')?.focus({preventScroll:true});win.addEventListener('resize',place);win.visualViewport?.addEventListener('resize',place);
 }
 const pointer=()=>{pointerWasOpen=panel.matches(':popover-open');};
 const click=event=>{if(event.detail?pointerWasOpen:panel.matches(':popover-open'))close(true);else open();};
 const dismiss=()=>close(true);trigger.addEventListener('pointerdown',pointer);trigger.addEventListener('click',click);panel.querySelector('[data-more-close]').addEventListener('click',dismiss);
 return {close,destroy(){close();trigger.removeEventListener('pointerdown',pointer);trigger.removeEventListener('click',click);panel.querySelector('[data-more-close]').removeEventListener('click',dismiss);}};
}
