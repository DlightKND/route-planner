import {journalIcon} from './journal-icons.js';
import {openEntityPanel} from './entity-actions.js';
import {presenceBounds} from './core/trip-presence-recovery.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const element=(doc,tag,className)=>{const node=doc.createElement(tag);node.className=className;return node;};

export function restoreGpsResolutionPrompt(overlay){
 if(overlay._gpsInert){for(const [node,previous] of overlay._gpsInert)node.inert=previous;delete overlay._gpsInert;}
 if(overlay._gpsReturnAnchor){overlay._gpsReturnAnchor.replaceWith(overlay);delete overlay._gpsReturnAnchor;}overlay.classList.remove('gps-inline-overlay');
 const workspace=overlay.querySelector('.gps-resolution-workspace'),fields=overlay.querySelector('#promptFields');if(workspace){workspace.before(fields);workspace.remove();}overlay.querySelector('.modal')?.classList.remove('gps-resolution-modal');
}

export function frameGpsResolutionPrompt(overlay,context,onSwitch){
 const doc=overlay.ownerDocument,fields=overlay.querySelector('#promptFields'),workspace=element(doc,'div','gps-resolution-workspace'),main=element(doc,'div','gps-resolution-main'),aside=element(doc,'aside','gps-resolution-summary');
 overlay.querySelector('.modal').classList.add('gps-resolution-modal');
 const choices=[['link','Связать с выездом','Выберите выезд той же машины на даты записи.'],['create','Создать выезд','Выберите существующие задания в форме нового выезда.'],['charge','Списание инженеру','Проверь пробег, ставку и основание перед списанием.']];
 main.innerHTML=`<p class="design-eyebrow">${escape(context.vehicle)} · ${escape(context.period)}</p><h3>Выберите результат оформления</h3><p class="hint">Запись не будет создана или привязана до подтверждения.</p><div class="gps-resolution-choices">${choices.map(([key,title,description])=>`<button type="button" data-gps-choice="${key}" aria-pressed="${key===context.action}" ${key==='charge'&&!context.canCharge?'disabled':''}><strong>${title}</strong><span>${description}</span></button>`).join('')}</div><h3>Параметры решения</h3>`;
 fields.before(workspace);main.append(fields);workspace.append(main,aside);
 const paint=()=>{
  const field=key=>fields.querySelector('[data-pf="'+key+'"]'),selected=key=>field(key)?.selectedOptions?.[0]?.textContent||'Не выбрано';let amount='';try{amount=context.action==='charge'?context.cost(field('km').value):'';}catch{amount='Проверь пробег';}
  const selectedTrip=context.linkOptions?.find(trip=>trip.id===field('trip')?.value);
  const linkEffect=selectedTrip?.link_mode==='supplement'
   ?'<p class="hint">Запись появится отдельно. Пробег, статус и принятые часы выезда сохранятся.</p>'
   :selectedTrip?.link_mode==='import'?'<p class="hint">GPS станет основным треком. Выезд перейдёт на проверку.</p>':'';
  aside.innerHTML=`<h3>Что будет сохранено</h3><dl><div><dt>Операция</dt><dd>${escape(choices.find(x=>x[0]===context.action)[1])}</dd></div><div><dt>GPS-запись</dt><dd>${escape(context.km)} км · ${escape(context.points)} точек</dd></div><div><dt>Разрывы GPS</dt><dd>${escape(context.gaps)}</dd></div><div><dt>${context.action==='link'?'Выезд':context.action==='create'?'Задания':'Инженер'}</dt><dd>${escape(context.action==='create'?'Выбираются в форме выезда':selected(context.action==='link'?'trip':'engineer'))}</dd></div>${context.action==='charge'?'<div><dt>Ставка</dt><dd>'+escape(context.rate)+'</dd></div>':''}${amount?'<div><dt>Сумма после проверки</dt><dd>'+escape(amount)+'</dd></div>':''}</dl>${linkEffect}<p class="hint">При ошибке сохранения решение можно повторить после исправления данных.</p>`;
 };
 workspace.querySelectorAll('[data-gps-choice]').forEach(button=>button.onclick=()=>{if(button.dataset.gpsChoice!==context.action)onSwitch(button.dataset.gpsChoice);});fields.addEventListener('input',paint);fields.addEventListener('change',paint);paint();
 const target=doc.querySelector('.gps-journal-detail .gps-resolution-entry');if(target&&doc.defaultView.matchMedia('(min-width: 1100px)').matches){const anchor=doc.createComment('GPS form return');overlay.before(anchor);overlay._gpsReturnAnchor=anchor;overlay.classList.add('gps-inline-overlay');target.closest('.gps-journal-detail').append(overlay);overlay._gpsInert=[];let child=overlay;while(child.parentElement&&child.parentElement!==doc.body){for(const sibling of child.parentElement.children)if(sibling!==child){overlay._gpsInert.push([sibling,sibling.inert]);sibling.inert=true;}child=child.parentElement;}overlay.scrollIntoView?.({block:'nearest'});}
}

export function framePresenceWorkspace(dialog,stay){
 const row=dialog.querySelector('[data-presence-id]'),table=row?.closest('.wb-table-scroll');if(!row||!table)return;
 const doc=dialog.ownerDocument,workspace=element(doc,'div','presence-workspace');workspace.dataset.presenceId=row.dataset.presenceId;
 const evidence=element(doc,'section','presence-evidence-panel'),decision=element(doc,'section','presence-decision-panel');
 evidence.innerHTML='<h3>Интервалы присутствия</h3>';decision.innerHTML='<h3>Команда и доли</h3>';
 for(const [index,cell] of [...row.children].entries()){
  const field=element(doc,'div','presence-workspace-field'),label=element(doc,'p','presence-field-label');label.textContent=cell.dataset.label;field.append(label);while(cell.firstChild)field.append(cell.firstChild);
  (index===0||index===4?evidence:decision).append(field);
 }
 workspace.append(evidence,decision);table.replaceWith(workspace);
 const metrics=element(doc,'div','presence-review-metrics'),bounds=presenceBounds(stay),calendar=stay.stay_from&&stay.stay_to?(Date.parse(stay.stay_to)-Date.parse(stay.stay_from))/60000:null;
 const amount=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+' мин';
 metrics.innerHTML=[['Календарная длительность',amount(calendar)],['Наблюдено GPS',amount(bounds?.gps??stay.minutes_raw)],['Предложено дополнительно',amount(bounds?bounds.extra:stay.minutes_raw!=null?0:null)],['Итог к подтверждению','']].map(([label,value],i)=>`<div><span>${label}</span><b ${i===3?'data-presence-review-total':''}>${value}</b></div>`).join('');workspace.before(metrics);
 const paint=()=>{const input=workspace.querySelector('[data-presence="minutes_mgr"]');metrics.querySelector('[data-presence-review-total]').textContent=amount(input.value===''?null:Number(input.value));};paint();dialog.addEventListener('input',()=>doc.defaultView.queueMicrotask(paint));
 const title=dialog.querySelector('#presenceEditorTitle');if(title)title.textContent='Проверка присутствия';
 const footer=dialog.querySelector('.presence-editor-foot'),later=element(doc,'button','btn ghost');later.type='button';later.textContent='Проверить позже';later.onclick=()=>dialog.querySelector('.presence-editor-head button').click();footer.prepend(later);
 const body=element(doc,'div','presence-editor-body');for(const child of [...dialog.children])if(child.tagName!=='FORM'&&child!==footer)body.append(child);dialog.insertBefore(body,footer);
}

// Screen structure is separate from record ownership and save handlers.
// Existing inputs are moved, never copied, so drafts and listeners survive.
function framePane(view,headerNodes){
 const pane=view?.querySelector('.pane');if(!pane||pane.querySelector(':scope>.workspace-masthead'))return;
 const doc=pane.ownerDocument,head=element(doc,'header','workspace-masthead'),inner=element(doc,'div','workspace-header-inner'),main=element(doc,'main','workspace-main');
 for(const node of headerNodes.filter(Boolean))inner.append(node);
 head.append(inner);while(pane.firstChild)main.append(pane.firstChild);pane.append(head,main);view.classList.add('workspace-page');
}

function addOverviewState(panel, prefix, action){
 const state=element(panel.ownerDocument,'section','workflow-overview-state');
 state.setAttribute('aria-label','Текущее состояние');
 state.innerHTML='<div><span>Текущая ситуация</span><h2></h2><p></p></div>';
 state.id=prefix+'OverviewState';
 if(action)state.append(action);
 panel.prepend(state);
 return state;
}

export function setOverviewState(root, title, detail){
 if(!root)return;
 root.querySelector('h2').textContent=title;
 root.querySelector('p').textContent=detail;
}

function frameRecordActions(view){
 const controls=view.querySelector('.entity-header-actions');
 const crumb=view.querySelector('.crumbs');
 if(controls)crumb.append(controls);
 const back=crumb.querySelector('button.crumb');
 back.classList.add('btn','workflow-back');
 back.setAttribute('aria-label',back.textContent);
 back.innerHTML=journalIcon('back');
 crumb.querySelector('.crumb-sep').hidden=true;
 view.classList.add('workflow-card');
}

export function installWorkspaceStructure(root=document){
 frameMapWorkspace(root);
 const job=root.querySelector('.view-job'),trip=root.querySelector('.view-trip');
 if(job){
  const estimate=root.getElementById('jobEstimatePane'),base=element(root,'details','request-estimate-base workflow-finance-tool'),heading=element(root,'header','workspace-section-head');
  heading.innerHTML='<h2>План/факт заявки</h2>';
  base.id='jobBaseEstimate';base.open=true;
  base.innerHTML='<summary>Смета заявки</summary>';const lines=element(root,'div','request-estimate-lines');for(const card of [...estimate.querySelectorAll(':scope>.card')])lines.append(card);base.append(lines,root.getElementById('jobHeadEcon'));
  const cost=element(root,'section','workflow-request-cost');cost.id='jobTaskCosts';
  estimate.append(heading,cost,base);
  const context=element(root,'section','card request-context');context.id='requestContext';context.hidden=true;
  const overview=root.getElementById('jobOverviewPane');
  overview.append(context);
  if(root.getElementById('jobPendingDecisions'))overview.append(root.getElementById('jobPendingDecisions'));
  overview.append(root.getElementById('jobActivitySection'));
  addOverviewState(overview,'job',root.getElementById('jobRecordResult')).hidden=true;
  frameRecordActions(job);
  framePane(job,[job.querySelector('.crumbs'),job.querySelector('.trip-head'),job.querySelector('.request-toolbar')]);
  const form=job.querySelector('.job-ref');if(form)form.id='requestContextFields';
 }
 if(trip){
  const plan=trip.querySelector('#tpPlanPane .trip-grid'),sidebar=element(root,'aside','trip-planning-sidebar');
  const overview=root.getElementById('tpOverviewPane'),route=plan?.querySelector('.wb-route-card');
  if(plan){
   const editor=element(root,'details','workflow-trip-edit');
   editor.innerHTML='<summary>Параметры плана</summary>';
   editor.append(plan.querySelector('.wb-plan-card'));
   sidebar.append(plan.querySelector('.wb-task-card'),editor);plan.append(sidebar);
  }
  const crewTitle=trip.querySelector('.wb-plan-card h3');if(crewTitle)crewTitle.textContent='Состав поездки';
  const responsibility=root.getElementById('tripResponsibilityMeta');if(responsibility){responsibility.className='workspace-responsibility-caption';trip.querySelector('.wb-plan-card').append(responsibility);}
  const state=addOverviewState(overview,'trip',root.getElementById('tripRecordResult'));
  const description=element(root,'section','workflow-trip-description');description.innerHTML='<h2>Описание выезда</h2><p id="tripOverviewDescription"></p>';
  const grid=element(root,'div','workflow-trip-overview');
  const details=element(root,'div','workflow-trip-details');details.append(description,root.getElementById('tripActivitySection'));
  overview.prepend(grid);grid.append(route,state,details);
  const toolbar=trip.querySelector('.trip-toolbar');
  const economy=root.getElementById('tpEconomyPane'),legacy=element(root,'details','workflow-finance-tool');
  legacy.id='tpContractEconomy';legacy.open=true;legacy.innerHTML='<summary>Договорная смета и ручные суммы</summary>';
  const oldEconomy=root.getElementById('tpEconBody').closest('.card'),oldSummary=root.getElementById('tripHeadEcon');
  economy.append(legacy);legacy.append(oldSummary,oldEconomy);
  const allocation=element(root,'details','workflow-finance-tool');allocation.id='tpCostReview';
  allocation.innerHTML='<summary>Распределение затрат по заданиям</summary>';
  allocation.append(root.getElementById('tpTripAllocation'));economy.append(allocation);
  economy.prepend(root.getElementById('tpReviewSummary'));
  root.getElementById('tpPlanPane').prepend(root.getElementById('tpLinkedOrders'));
  root.getElementById('tpPlanPane').prepend(root.getElementById('tripOrderParent'));
  frameRecordActions(trip);
  framePane(trip,[trip.querySelector('.crumbs'),trip.querySelector('.trip-head'),toolbar]);
 }
 for(const [id,title,description,prefix] of [
  ['plJobs','Заявки','Потребности клиентов и задания на исполнение','job'],
  ['plOrders','Задания','Назначение, выполнение и проверка заданий','order'],
  ['plTrips','Выезды','Планы поездок, маршруты и GPS-журнал','trip']
 ]){
  const section=root.getElementById(id);if(!section)continue;
  const sticky=section.querySelector('.stickyhead'),header=element(root,'header','workspace-dispatcher-head workspace-section-rail'),line=element(root,'div','workspace-heading-row');
  line.innerHTML=`<div><h1>${escape(title)}</h1><p class="workspace-subtitle">${escape(description)}</p></div>`;
  const add=root.getElementById(prefix+'Add');if(add){const label=add.querySelector('.dispatcher-add-label');if(label)label.textContent='Создать';line.append(add);}
  const tabs=sticky.querySelector('.subtabs');tabs.classList.add('workspace-page-tabs');header.append(line,tabs);sticky.prepend(header);
  const toolbar=sticky.querySelector('.dispatcher-toolbar');toolbar.classList.add('workspace-filterbar');
  const chips=sticky.querySelector('.chips');if(chips)toolbar.after(chips);
  const board=element(root,'div','workspace-board-heading');board.innerHTML='<h2>Рабочая очередь</h2><span class="hint" data-board-count></span>';sticky.after(board);
  const list=root.getElementById(prefix+'List');
  const update=()=>{board.querySelector('h2').textContent=list.classList.contains('klist')?'Список':'Канбан';board.querySelector('[data-board-count]').textContent='Записей: '+list.querySelectorAll('.kcard').length;};
  const Observer=root.defaultView?.MutationObserver;if(Observer)new Observer(update).observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});update();
 }
 for(const selector of ['.view-catalog','.view-settings']){
  const view=root.querySelector(selector);if(view)framePane(view,[view.querySelector('.design-page-head')]);
 }
 for(const button of root.querySelectorAll('#settingsNav [data-sec]')){const icon=({day:'clock',tariffs:'file',gps:'route',fleet:'car',users:'crew',theme:'person',diagnostics:'tasks'})[button.dataset.sec];button.insertAdjacentHTML('afterbegin',journalIcon(icon));}
 const catalog=root.querySelector('.view-catalog'),catalogHead=catalog?.querySelector('.workspace-header-inner');
 if(catalogHead){
  catalogHead.closest('.workspace-masthead').classList.add('workspace-section-rail');
  const row=element(root,'div','workspace-heading-row'),actions=element(root,'div','catalog-page-actions');
  row.append(catalogHead.firstElementChild,actions);catalogHead.append(row);
  for(const id of ['catAdd','emShowAdd','stockAdd'])actions.append(root.getElementById(id));
  const tabs=[...catalog.querySelectorAll('.subtabs')];if(tabs.length){tabs[0].classList.add('catalog-main-nav','workspace-page-tabs');catalogHead.append(tabs[0]);tabs.slice(1).forEach(tab=>tab.remove());}
  setCatalogWorkspace('works',root);
 }
 const fleet=root.querySelector('[data-sec-panel="fleet"]');
 if(fleet){
  const list=root.getElementById('vehList'),editor=element(root,'details','settings-record-editor');editor.id='fleetRecordEditor';editor.innerHTML='<summary>Добавить или изменить автомобиль</summary>';
  while(list.nextSibling)editor.append(list.nextSibling);fleet.append(editor);
  fleet.addEventListener('click',e=>{if(e.target.closest('[data-vhedit]')){editor.open=true;root.defaultView.requestAnimationFrame(()=>editor.scrollIntoView({block:'nearest'}));}},true);
 }
 const dash=root.querySelector('.view-dash');
 if(dash){const title=dash.querySelector('.pane-head h2');if(title)title.textContent='График и работа';framePane(dash,[dash.querySelector('.stickyhead')]);}
 root.getElementById('appShell')?.classList.add('workspace-shell');
 const dismissCardMenus=event=>{for(const menu of root.querySelectorAll('.workspace-card-details[open]'))if(!menu.contains(event.target))menu.open=false;};
 root.addEventListener('click',dismissCardMenus);
 root.addEventListener('pointerdown',dismissCardMenus);
 root.addEventListener('wheel',dismissCardMenus,{passive:true});
 root.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||root.querySelector('dialog[open],:popover-open'))return;
  const menu=[...root.querySelectorAll('.workspace-card-details[open]')].at(-1);if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}
 });
 root.addEventListener('toggle',event=>{
  const menu=event.target;if(!menu.matches?.('.workspace-card-details')||!menu.open)return;
  const place=()=>{
   const panel=menu.querySelector('.acts,.order-status-label');if(!panel)return;
   panel.style.top='100%';panel.style.bottom='auto';panel.style.right='';
   const win=root.defaultView,rail=root.querySelector('.rail'),board=menu.closest('.kanban')?.getBoundingClientRect();
   const viewportLimit=win.innerWidth<=760&&rail?rail.getBoundingClientRect().top-8:win.innerHeight-8;
   if(panel.getBoundingClientRect().bottom>Math.min(viewportLimit,board?board.bottom-8:viewportLimit)){panel.style.top='auto';panel.style.bottom='100%';}
   const bounds=panel.getBoundingClientRect(),left=Math.max(8,board?.left??8),right=Math.min(win.innerWidth-8,board?.right??win.innerWidth-8);
   const offset=bounds.left<left?left-bounds.left:bounds.right>right?right-bounds.right:0;
   if(offset)panel.style.right=((parseFloat(win.getComputedStyle(panel).right)||0)-offset)+'px';
  };
  root.defaultView.requestAnimationFrame(place);
 },true);
}

// Keep the map's actual controls and their handlers. Each tab is a workspace,
// rather than a second scope switch above an unrelated legacy list.
export function frameMapWorkspace(root=document){
 const side=root.querySelector('.view-map .side');if(!side||side.classList.contains('map-workspace'))return;
 side.classList.add('map-workspace');side.setAttribute('aria-label','Рабочая панель карты');
 const points=root.querySelector('#pointsBlock>.block-body'),tabs=root.getElementById('sideTabs');tabs.setAttribute('aria-label','Раздел карты');
 const head=element(root,'header','map-workspace-head');head.innerHTML='<div><h2 data-map-heading>В работе</h2><p class="map-workspace-description" data-map-description></p></div>';
 head.append(root.getElementById('pointTools'));points.prepend(head);
 const scope=root.getElementById('mapScope');scope.hidden=true;scope.setAttribute('aria-hidden','true');points.querySelector('.chipsep')?.remove();
 const tools=root.getElementById('sideTools');tools.classList.add('map-workspace-filters');
 const filter=root.getElementById('typeFilter');filter.setAttribute('aria-label','Тип точки');
 const listHead=root.getElementById('listHead'),label=element(root,'strong','map-list-caption');listHead.prepend(label);
 root.getElementById('rWp').placeholder='Найти адрес или место';
 const route=root.querySelector('#routeBlock>.block-body'),scroll=element(root,'div','map-route-scroll');
 route.querySelector('.route-panel-title')?.remove();
 const routeHead=element(root,'header','map-workspace-head');routeHead.innerHTML='<div><h2>Создание маршрута</h2><p class="map-workspace-description">Собери остановки и проверь порядок перед построением.</p></div>';
 const stops=element(root,'section','map-route-section');stops.innerHTML='<h3>Остановки маршрута</h3>';stops.append(root.getElementById('rStops'));
 const add=element(root,'section','map-route-section map-route-add');add.innerHTML='<h3>Добавить остановку</h3><label for="rWp">Адрес или название места</label>';
 add.append(route.querySelector('.route-address'),root.getElementById('rWpMode'),root.getElementById('rWpHint'),root.getElementById('rWpRes'));
 const footer=element(root,'footer','map-route-footer');footer.append(route.querySelector('.route-primary'),root.getElementById('rStatus'));
 scroll.append(routeHead,stops,add,root.getElementById('rVariants'),route.querySelector('.route-settings'));route.append(scroll,footer);
 const paint=()=>{
  const mode=tabs.querySelector('button.on')?.dataset.sb||'points';side.dataset.mapPanel=mode;side.classList.toggle('list-folded',(mode==='points'||mode==='directory')&&root.getElementById('pointsBox').classList.contains('folded'));
  routeHead.querySelector('h2').textContent=Number(root.getElementById('rCount').textContent)>0?'План маршрута':'Создание маршрута';
  const directory=mode==='directory';head.querySelector('[data-map-heading]').textContent=directory?'Справочник точек':'В работе';
  head.querySelector('[data-map-description]').textContent=directory?'Клиенты, оборудование и депо.':'Заявки и машины, которым нужно внимание.';
  label.textContent=directory?'Точки справочника':'Рабочая очередь';
  const input=root.getElementById('search');input.placeholder=directory?'Найти клиента или депо':'Найти клиента или машину';
 };
 paint();const Observer=root.defaultView?.MutationObserver;if(Observer)new Observer(paint).observe(tabs,{attributes:true,childList:true,characterData:true,subtree:true,attributeFilter:['class','style']});
}

export function setCatalogWorkspace(name,root=document){
 const description=root.querySelector('.view-catalog .design-description');if(description)description.textContent=({works:'Нормы времени, применимость и стоимость работ.',models:'Модели оборудования, гарантия и сервисные интервалы.',materials:'Материалы, единицы измерения и актуальные цены.'})[name]||'';
 for(const [section,id,label] of [['works','catAdd','Добавить работу'],['models','emShowAdd','Добавить модель'],['materials','stockAdd','Добавить материал']]){
  const button=root.getElementById(id);if(button?.closest('.catalog-page-actions')){button.hidden=name!==section;button.textContent=label;}
 }
}

export function setSettingsWorkspace(name,root=document){
 const heading=root.querySelector('.view-settings .design-page-head h2');if(heading)heading.textContent='Настройки';
 const description=root.querySelector('.view-settings .design-description');if(description)description.hidden=true;
 root.querySelector('.view-settings')?.setAttribute('data-settings-current',name);
}

export function presentDispatcherSection(journal,root=document){
 const section=root.getElementById('plTrips'),title=section?.querySelector('.workspace-heading-row h1'),description=section?.querySelector('.workspace-subtitle');
 if(title)title.textContent=journal?'GPS-журнал':'Выезды';if(description)description.textContent=journal?'Поездки, проверка трека и оформление факта':'Планы поездок, маршруты и GPS-журнал';
 const board=section?.querySelector('.workspace-board-heading');if(board)board.hidden=journal;
}

export function frameNotifications(host){
 const doc=host.ownerDocument,head=host.querySelector('.notice-header');if(!head||host.querySelector(':scope>.workspace-masthead'))return;
 const masthead=element(doc,'header','workspace-masthead'),inner=element(doc,'div','workspace-header-inner'),main=element(doc,'main','workspace-main');
 const action=element(doc,'button','btn');action.type='button';action.textContent='Настроить push';action.onclick=()=>host.querySelector('[data-notice-push]')?.click();head.append(action);
 inner.append(head);masthead.append(inner);while(host.firstChild)main.append(host.firstChild);host.append(masthead,main);host.closest('.view')?.classList.add('workspace-inbox');
}

export function presentRequestWorkspace({saved,editable,client,equipment,status,notes,phone,contact,confirmDiscard,editContext},root=document){
 const context=root.getElementById('requestContext'),form=root.getElementById('requestContextFields');if(!context||!form)return;
 const view=context.closest('.view');view.classList.toggle('request-saved',saved);context.hidden=!saved;form.hidden=saved&&!form.closest('dialog[open]');
 const title=root.getElementById('jobTitle');let stage=view.querySelector('.request-workspace-stage');if(!stage&&title){stage=element(root,'span','design-status workflow-stage request-workspace-stage');title.after(stage);}if(stage){stage.textContent=status?status[0].toUpperCase()+status.slice(1):'';stage.hidden=!saved;}
 const actions=root.getElementById('jobActs');
 if(!context.querySelector('.request-context-data')){
  context.innerHTML='<h2>Суть обращения</h2><p class="request-description"></p><dl class="request-context-data"></dl><div class="request-contact-actions"></div>';
  context.querySelector('.request-contact-actions').append(actions);
  const edit=element(root,'button','btn workflow-edit');edit.id='requestEditContext';edit.type='button';edit.innerHTML=journalIcon('edit')+'<span>Изменить</span>';edit.setAttribute('aria-label','Изменить данные');
  view.querySelector('.entity-header-actions')?.prepend(edit);
  if(!edit.isConnected)context.prepend(edit);
 }
 context.querySelector('.request-description').textContent=notes||'Описание не указано.';
 const rows=[['Клиент',client],['Техника',equipment||'Без привязки'],['Контакт',contact||'Не указан'],['Телефон',phone||'Не указан']];
 context.querySelector('dl').innerHTML=rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
 const edit=root.getElementById('requestEditContext');edit.hidden=!saved||!editable;edit.onclick=()=>editContext?editContext(edit):openEntityPanel({title:'Изменить заявку',panel:form,trigger:edit,confirmDiscard});
}

export function positionOrderResult(root=document){
 const scope=root.getElementById('orderPane-scope'),summary=root.getElementById('orderResultSummary');if(!scope||!summary)return;
 scope.prepend(summary);const h=summary.querySelector('h3');if(h)h.textContent='Работы и материалы';
}

export function frameOrderWorkspace({record,editable,people},root=document){
 const editor=root.getElementById('orderEditor');if(!editor||editor.querySelector(':scope>.workspace-masthead'))return;
 const doc=editor.ownerDocument,head=element(doc,'header','workspace-masthead'),inner=element(doc,'div','workspace-header-inner'),main=element(doc,'main','workspace-main');
 const title=editor.querySelector('.trip-head h2'),toolbar=editor.querySelector('.order-toolbar');
 const controls=editor.querySelector('.entity-header-actions'),crumbs=editor.querySelector('.crumbs');
 const back=root.getElementById('orderBack');
 back.classList.add('btn','workflow-back');
 back.setAttribute('aria-label',back.textContent);
 back.innerHTML=journalIcon('back');
 const breadcrumb=crumbs.querySelector(':scope>span');
 breadcrumb.textContent='Диспетчер / Задания';
 back.after(breadcrumb);
 if(record.id){
  title.textContent='Задание №'+record.number;
  const subject=title.nextElementSibling;subject.className='workflow-subject';subject.textContent=record.title||'';
  const status=editor.querySelector('.entity-head-meta .design-status');status.classList.add('workflow-stage');if(record.closed_with_remainder_at)status.textContent='Закрыто с остатком';title.after(status);
  const button=element(doc,'button','btn workflow-edit');button.id='orderEditData';button.type='button';button.innerHTML=journalIcon('edit')+'<span>Изменить</span>';button.setAttribute('aria-label','Изменить данные');button.hidden=true;
  controls.prepend(button);
  const origin=root.getElementById('orderRequest');
  if(origin)root.getElementById('orderBrief').append(origin);
 }
 crumbs.append(controls);
 inner.append(crumbs,editor.querySelector('.trip-head'),toolbar);head.append(inner);
 while(editor.firstChild)main.append(editor.firstChild);editor.append(head,main);editor.closest('.view')?.classList.add('workspace-page','workflow-card');
 if(record.id){
  const overview=root.getElementById('orderPane-overview');
  const primary=controls.querySelector('#orderRecordResult,[data-order-next]');
  if(primary){
   primary.classList.add('workflow-overview-action');
   if(primary.id==='orderRecordResult'){
    const recordButton=element(doc,'button','btn amber workflow-work-result');
    recordButton.type='button';recordButton.textContent=primary.textContent;
    recordButton.onclick=()=>primary.click();
    root.getElementById('orderPane-scope').prepend(recordButton);
   }
  }
  const state=addOverviewState(overview,'order',primary);
  const stage=editor.querySelector('.workflow-stage').textContent;
  setOverviewState(state,stage,({
   draft:'Проверьте состав работ и назначьте исполнителей.',
   assigned:'Можно начать выполнение работ.',
   in_progress:'Зафиксируйте объём, трудозатраты и использованные материалы.',
   paused:'Работы можно возобновить после согласования.',
   review:'Проверьте выполненные работы и остаток.',
   completed:record.closed_with_remainder_at?'Выберите оставшиеся работы при создании следующего задания из заявки.':'Выполненные работы доступны в план/факте.',
   cancelled:'Данные задания и история доступны для просмотра.'
  })[record.status]||'Откройте работы, чтобы проверить состав задания.');
  const name=id=>people.find(p=>p.id===id)?.full_name||'Не назначен';
  const brief=root.getElementById('orderBrief');brief.querySelector('.order-team-meta')?.remove();
  brief.querySelector('.order-brief-head .hint')?.remove();
  const context=element(doc,'dl','order-brief-context');context.innerHTML=`<div><dt>Клиент</dt><dd>${escape(record.jobs?.clients?.name||'Не указан')}</dd></div><div><dt>Техника</dt><dd>${escape(record.jobs?.equipment?.model||'Без привязки')}</dd></div><div><dt>Ответственный</dt><dd>${escape(name(record.lead_engineer))}</dd></div><div><dt>Куратор</dt><dd>${escape(name(record.curator_id))}</dd></div>`;brief.append(context);
  const organization=root.getElementById('orderOrganization');organization.hidden=true;root.getElementById('orderAuxiliary').append(organization);
  const composition=root.getElementById('orderComposition'),details=element(doc,'details','workspace-composition-editor');details.innerHTML=`<summary>${editable?'Плановые данные и изменение состава':'Плановые данные задания'}</summary>`;composition.before(details);details.append(composition);
  if(editable){
   const fields=element(doc,'details','workspace-organization-editor');
   fields.innerHTML='<summary>Организация задания</summary>';
   organization.hidden=false;fields.append(organization);details.before(fields);
  }
  const emptyGrid=editor.querySelector('.order-grid');if(emptyGrid&&!emptyGrid.children.length)emptyGrid.remove();
  positionOrderResult(root);
 }
 const travel=root.getElementById('orderTravel');if(travel){
  const actions=travel.querySelector('.order-line-adds'),target=travel.querySelector('.related-header-actions');
  if(actions&&target)target.append(actions);
 }
 const execution=root.getElementById('orderExecution'),results=root.getElementById('orderResults');if(execution&&results){const state=element(doc,'section','result-saved-state');state.id='orderResultSavedState';execution.firstElementChild?.replaceWith(state);const title=element(doc,'h3','result-section-title');title.textContent='Выполненные позиции';results.before(title);const fields=element(doc,'div','result-final-fields'),date=root.getElementById('orderResultDate')?.closest('label'),note=root.getElementById('orderResultNote')?.closest('label');if(date)fields.append(date);if(note)fields.append(note);results.after(fields);}
 const savebar=editor.querySelector('.order-savebar');if(savebar){const state=root.getElementById('orderSaveState'),save=root.getElementById('orderSave');if(state)inner.querySelector('.entity-head-meta').append(state);if(save)inner.querySelector('.entity-header-actions').append(save);savebar.remove();}
}
