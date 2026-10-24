import {journalIcon} from '../journal-icons.js';
// A single visual adapter for static, asynchronously mounted and top-layer UI.
// Existing IDs, native form state, handlers and permission checks stay owned by screens.
export const UI_SELECTORS = {
  segment: '.seg:not(.chipseg):not(.unassigned-filter):not(.journal-trip-tabs),.summary-view-switch,.summary-period-presets,.notice-tabs,.rquick,.presence-kind',
  filters: '.chipseg,.chips,.echips,.activity-filters,.unassigned-filter,.design-filter-chips',
  count: '.chip-n,.cnt,.rchip .n,.unassigned-filter button b,[data-activity-count],.engineer-picker-count,.ui-count',
  card: '.card,.kcard,.record-card,.notice-row,.staff-row,.stock-row,.emrow,.eqitem,.pt,.order-brief,.order-child,.trip-choice-card,.order-result-summary,.summary-quick-actions,.planwarn',
  popover: '.pop,.map-pop,.gpop,.ctxmenu,.entity-actions-menu,.engineer-options,.planner-filter-panel,.dispatcher-menu,.info-hint-popover',
  badge: '.pill,.design-status,.journal-recovery-badge,.journal-review-progress,.activity-type',
  geometry: '.vg-block,.vg-piece,.vg-group,.vg-cut-handle,.vg-win-line,.leaflet-marker-icon,.leaflet-interactive,.journal-time-part',
};
const isIcon = el => el.matches('.vg-plan-tools,.vg-divide,.qm,.ph-close,.ph-del,.avx,.foldx-btn,.depot-toggle,.gp-close,.mleg-close,.modal-close,.entity-actions-trigger,.leaflet-control-zoom a,[data-gtools]') ||
  (!el.querySelector('input,select,textarea') && (/^[←→↗↻↺×✕✖⋯…+−–?☰⌕]$/.test(el.textContent.trim()) || (!el.textContent.trim() && !!el.querySelector('svg'))));
export function controlKind(el) {
  if(el.matches(UI_SELECTORS.geometry))return 'geometry';
  if(el.matches('input'))return ['checkbox','radio','range','color','file','hidden'].includes(el.type)?el.type:'field';
  if(el.matches('select,textarea'))return 'field';
  if(el.matches('[role=switch]'))return 'switch';
  if(el.matches('.fab-add,#pointToolsFab'))return 'fab';
  if(el.matches('[role=tab],.subtab,.entity-tabs>button,.journal-trip-tabs>button,.side-tabs2>button'))return 'tab';
  if(el.matches('.nav-i,.rail button,.rail a'))return 'navigation';
  if(el.matches('.chip,.echip,.rchip,.veh-btn,.son,[data-activity-filter],.design-filter-chips>button') || el.parentElement?.matches(UI_SELECTORS.filters))return 'chip';
  if(el.parentElement?.matches(UI_SELECTORS.segment))return 'segment';
  if(el.matches('.entity-menu-item,.ctxmenu button,.gp-secondary>button'))return 'menu';
  if(el.matches('.order-child,.order-card-title,.trip-job-open,.trip-review-item,.presence-stop,.gps-record-open,.wf-row,.wk-h,.depot-car,.notice-read,.journal-time-part,.journal-conflict'))return 'row';
  if(isIcon(el))return 'icon';
  if(el.matches('a:not(.btn):not(.crumb)'))return 'link';
  if(el.matches('summary,[role=button]:not(button)'))return 'disclosure';
  return 'button';
}
export function installApplicationDesignSystem(root=document) {
  const html=root.documentElement;
  if(html.dataset.uiSystem)return;
  html.dataset.uiSystem='0.7';html.id='dlight-ui';
  const assign=(el,key,value)=>{if(el.dataset[key]!==value)el.dataset[key]=value;};
  const scan=()=>{
    root.querySelectorAll('button,a,input,select,textarea,summary,[role=button]').forEach(el=>{
      if(el.closest('.ds-kit'))return;
      if(el.matches('[data-journal-list-toggle],[data-journal-exit],[data-journal-refresh],.planner-filter-menu>summary')&&!el.querySelector('[data-ui-compact-label]')){
        const text=el.textContent.trim();if(text){el.setAttribute('aria-label',text);const icon=root.createElement('span'),label=root.createElement('span');icon.className='ui-compact-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=journalIcon(el.matches('.planner-filter-menu>summary')?'filters':el.matches('[data-journal-refresh]')?'clock':el.matches('[data-journal-exit]')?'chevron':'tasks');label.dataset.uiCompactLabel='';label.textContent=text;el.replaceChildren(icon,label);el.dataset.uiCompact='true';}
      }
      const kind=controlKind(el);assign(el,'ui',kind);
      if(['button','icon','menu'].includes(kind))assign(el,'uiVariant',el.matches('.red,.danger,[data-danger=true]')?'destructive':/^(Отмена(?: правки)?|Назад|Закрыть|Позже)$/.test(el.textContent.trim())?'secondary':el.matches('.amber')?'primary':el.matches('.ghost')?'tertiary':'secondary');
      if(el.matches('.sm'))assign(el,'uiSize','s');
      if(kind==='range'){
        const min=Number(el.min||0),max=Number(el.max||100),value=Number(el.value),fill=max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0;
        el.style.setProperty('--ui-range-fill',fill+'%');
        if(!el.dataset.uiExact){
          el.dataset.uiExact='true';const row=root.createElement('div');row.className='ui-range-exact';
          const label=el.id==='rBuf'?'Ширина коридора, км':el.id==='rIso'?'Время изохроны, мин':el.getAttribute('aria-label')||'Точное значение';
          const decrease=root.createElement('button'),increase=root.createElement('button'),input=root.createElement('input');
          decrease.type=increase.type='button';decrease.textContent='−';increase.textContent='+';decrease.setAttribute('aria-label','Уменьшить: '+label);increase.setAttribute('aria-label','Увеличить: '+label);
          input.type='number';input.setAttribute('aria-label',label);input.min=el.min;input.max=el.max;input.step=el.step||'1';input.value=el.value;
          const commit=()=>{if(input.value===''||!input.checkValidity())return;el.value=input.value;el.dispatchEvent(new root.defaultView.Event('input',{bubbles:true}));el.dispatchEvent(new root.defaultView.Event('change',{bubbles:true}));};
          input.onchange=commit;decrease.onclick=()=>{input.stepDown();commit();};increase.onclick=()=>{input.stepUp();commit();};
          el.addEventListener('input',()=>{input.value=el.value;});el.addEventListener('change',()=>{input.value=el.value;});
          row.append(decrease,input,increase);(el.closest('.row')||el).after(row);
          el.uiExactControls={input,decrease,increase};
        }
        const controls=el.uiExactControls;if(controls)for(const [control,disabled] of [[controls.input,el.disabled],[controls.decrease,el.disabled||value<=min],[controls.increase,el.disabled||value>=max]])if(control.disabled!==disabled)control.disabled=disabled;
      }
      if(kind==='chip'||kind==='segment'){
        // Legacy class-driven filters keep their handlers; expose the same state to AT.
        if(!el.hasAttribute('aria-pressed')&&!el.matches('[aria-haspopup],[data-epop],.design-filter-chips>button'))el.dataset.uiPressedOwner='adapter';
        if(el.dataset.uiPressedOwner==='adapter')el.setAttribute('aria-pressed',String(el.matches('.on,[data-rnow]')||el.matches('.echip:not(.off):not(.all)')));
      }
    });
    root.querySelectorAll(UI_SELECTORS.segment).forEach(el=>assign(el,'uiGroup','segments'));
    root.querySelectorAll(UI_SELECTORS.filters).forEach(el=>assign(el,'uiGroup','filters'));
    root.querySelectorAll(UI_SELECTORS.card).forEach(el=>assign(el,'uiSurface','card'));
    root.querySelectorAll(UI_SELECTORS.popover).forEach(el=>assign(el,'uiSurface','popover'));
    root.querySelectorAll('dialog,.modal,.presence-editor').forEach(el=>assign(el,'uiSurface',el.matches('.overlay,#moreSheet,#phView')?'overlay':el.matches(UI_SELECTORS.popover)?'popover':'dialog'));
    root.querySelectorAll(UI_SELECTORS.count).forEach(el=>{
      assign(el,'ui','count');
      const parent=el.closest('button'),key=parent?.dataset.js||parent?.dataset.ts||parent?.dataset.os||parent?.dataset.utMode||'';
      const tone=el.dataset.uiTone||(['pending','review'].includes(key)?'danger':['completed','approved','accepted'].includes(key)?'success':['paused','recovery','gps'].includes(key)?'warning':'neutral');
      assign(el,'uiTone',tone);assign(el,'uiEmpty',String(/^0$/.test(el.textContent.trim())));
    });
    root.querySelectorAll(UI_SELECTORS.badge).forEach(el=>assign(el,'ui','badge'));
    root.querySelectorAll('table').forEach(table=>{
      if(table.closest('.ds-kit')||table.parentElement.matches('[data-ui-table-frame],[class*=scroll]'))return;
      const frame=root.createElement('div');frame.dataset.uiTableFrame='';frame.tabIndex=0;frame.setAttribute('role','region');frame.setAttribute('aria-label',table.getAttribute('aria-label')||'Таблица с горизонтальной прокруткой');table.before(frame);frame.append(table);
    });
    root.querySelectorAll('label').forEach(el=>{if(el.querySelector(':scope>input[type=checkbox],:scope>input[type=radio]'))assign(el,'ui',el.matches('.wb-task-share-row,[data-task-allocation-row]')?'layout':'option');});
  };
  let queued=false,disposed=false;
  const schedule=()=>{if(queued||disposed)return;queued=true;root.defaultView.queueMicrotask(()=>{queued=false;if(!disposed)scan();});};
  const observer=new root.defaultView.MutationObserver(schedule);
  observer.observe(root.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','role','disabled','aria-busy']});
  root.addEventListener('change',schedule);
  root.addEventListener('input',schedule);
  const keydown=event=>{
    const button=event.target.closest('[data-ui=segment]'),group=button?.parentElement;
    if(!group||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const options=[...group.querySelectorAll(':scope>button:not(:disabled):not([hidden])')],index=options.indexOf(button);
    if(index<0)return;
    event.preventDefault();const next=event.key==='Home'?options[0]:event.key==='End'?options.at(-1):options[(index+(event.key==='ArrowRight'?1:-1)+options.length)%options.length];
    next.focus();next.click();
  };
  root.addEventListener('keydown',keydown);
  scan();
  return {refresh:scan,destroy(){disposed=true;observer.disconnect();root.removeEventListener('change',schedule);root.removeEventListener('input',schedule);root.removeEventListener('keydown',keydown);}};
}
