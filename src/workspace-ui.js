import {openEntityPanel} from './entity-actions.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const element=(doc,tag,className)=>{const node=doc.createElement(tag);node.className=className;return node;};

// Screen structure is separate from record ownership and save handlers.
// Existing inputs are moved, never copied, so drafts and listeners survive.
function framePane(view,headerNodes){
 const pane=view?.querySelector('.pane');if(!pane||pane.querySelector(':scope>.workspace-masthead'))return;
 const doc=pane.ownerDocument,head=element(doc,'header','workspace-masthead'),inner=element(doc,'div','workspace-header-inner'),main=element(doc,'main','workspace-main');
 for(const node of headerNodes.filter(Boolean))inner.append(node);
 head.append(inner);while(pane.firstChild)main.append(pane.firstChild);pane.append(head,main);view.classList.add('workspace-page');
}

export function installWorkspaceStructure(root=document){
 const job=root.querySelector('.view-job'),trip=root.querySelector('.view-trip');
 if(job){
  const context=element(root,'section','card request-context');context.id='requestContext';context.hidden=true;
  const grid=element(root,'div','request-workspace-grid');grid.append(context,root.getElementById('jobOrders'));root.getElementById('jobOverviewPane').append(grid);
  framePane(job,[job.querySelector('.crumbs'),job.querySelector('.trip-head'),job.querySelector('.request-toolbar')]);
  const form=job.querySelector('.job-ref');if(form)form.id='requestContextFields';
 }
 if(trip){
  const plan=trip.querySelector('#tpPlanPane .trip-grid'),sidebar=element(root,'aside','trip-planning-sidebar');
  if(plan){sidebar.append(plan.querySelector('.wb-plan-card'),plan.querySelector('.wb-task-card'));plan.append(sidebar);}
  const stops=trip.querySelector('.wb-route-details');if(stops)stops.open=true;
  const routeTitle=trip.querySelector('.wb-route-card h3');if(routeTitle?.firstChild)routeTitle.firstChild.textContent='Маршрут и остановки ';
  const crewTitle=trip.querySelector('.wb-plan-card h3');if(crewTitle)crewTitle.textContent='Состав поездки';
  const responsibility=root.getElementById('tripResponsibilityMeta');if(responsibility){responsibility.className='workspace-responsibility-caption';trip.querySelector('.wb-plan-card').append(responsibility);}
  const toolbar=trip.querySelector('.trip-toolbar');toolbar.before(root.getElementById('tpReviewSummary'));
  framePane(trip,[trip.querySelector('.crumbs'),trip.querySelector('.trip-head')]);
 }
 for(const [id,title,description,prefix] of [
  ['plJobs','Заявки','Потребности клиентов и задания на исполнение','job'],
  ['plOrders','Рабочая доска','Назначение, выполнение и проверка заданий','order'],
  ['plTrips','Выезды','Планы поездок, маршруты и GPS-журнал','trip']
 ]){
  const section=root.getElementById(id);if(!section)continue;
  const sticky=section.querySelector('.stickyhead'),header=element(root,'header','workspace-dispatcher-head'),line=element(root,'div','workspace-heading-row');
  line.innerHTML=`<div><p class="design-eyebrow">Диспетчерская · ${escape(title)}</p><h1>${escape(title)}</h1><p class="workspace-subtitle">${escape(description)}</p></div>`;
  const add=root.getElementById(prefix+'Add');if(add){const label=add.querySelector('.dispatcher-add-label');if(label)label.textContent='Создать';line.append(add);}
  header.append(line,sticky.querySelector('.subtabs'));sticky.prepend(header);
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
 const catalog=root.querySelector('.view-catalog'),catalogHead=catalog?.querySelector('.workspace-header-inner');
 if(catalogHead){
  const row=element(root,'div','workspace-heading-row'),actions=element(root,'div','catalog-page-actions');
  row.append(catalogHead.firstElementChild,actions);catalogHead.append(row);
  for(const id of ['catAdd','emShowAdd','stockAdd'])actions.append(root.getElementById(id));
  const tabs=[...catalog.querySelectorAll('.subtabs')];if(tabs.length){tabs[0].classList.add('catalog-main-nav');catalogHead.append(tabs[0]);tabs.slice(1).forEach(tab=>tab.remove());}
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
}

export function setCatalogWorkspace(name,root=document){
 const description=root.querySelector('.view-catalog .design-description');if(description)description.textContent=({works:'Нормы времени, применимость и стоимость работ.',models:'Модели оборудования, гарантия и сервисные интервалы.',materials:'Материалы, единицы измерения и актуальные цены.'})[name]||'';
 for(const [section,id,label] of [['works','catAdd','Добавить работу'],['models','emShowAdd','Добавить модель'],['materials','stockAdd','Добавить материал']]){
  const button=root.getElementById(id);if(button?.closest('.catalog-page-actions')){button.hidden=name!==section;button.textContent=label;}
 }
}

export function setSettingsWorkspace(name,root=document){
 const heading=root.querySelector('.view-settings .design-page-head h2');if(heading)heading.textContent=({tariffs:'Тарифы и параметры',fleet:'Автопарк',users:'Пользователи и роли',theme:'Моё оформление'})[name]||'Настройки';
 const description=root.querySelector('.view-settings .design-description');if(description)description.textContent=({tariffs:'Правила рабочего дня и тарифы для новых расчётов.',fleet:'Служебные автомобили, связь с GPS и проверенный одометр.',users:'Сотрудники, подчинённость и доступ к приложению.',theme:'Личное оформление вашего рабочего места.'})[name]||'';
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

export function presentRequestWorkspace({saved,editable,client,equipment,status,engineers,due,notes,phone,address,confirmDiscard},root=document){
 const context=root.getElementById('requestContext'),form=root.getElementById('requestContextFields');if(!context||!form)return;
 const view=context.closest('.view');view.classList.toggle('request-saved',saved);context.hidden=!saved;form.hidden=saved&&!form.closest('dialog[open]');
 const title=root.getElementById('jobTitle');let stage=view.querySelector('.request-workspace-stage');if(!stage&&title){stage=element(root,'span','design-status request-workspace-stage');title.parentElement.append(stage);}if(stage){stage.textContent=status||'';stage.hidden=!saved;}
 const actions=root.getElementById('jobActs');
 if(!context.querySelector('.request-context-data')){
  context.innerHTML='<div class="workspace-section-head"><div><p class="design-eyebrow">Заявка</p><h3>Контекст клиента</h3></div><button class="btn sm ghost" id="requestEditContext" type="button">Изменить</button></div><dl class="request-context-data"></dl><div class="request-contact-actions"></div>';
  context.querySelector('.request-contact-actions').append(actions);
  const responsibility=root.getElementById('jobResponsibilityMeta');if(responsibility){responsibility.className='workspace-responsibility-caption';context.querySelector('.request-contact-actions').before(responsibility);}
 }
 const rows=[['Заказчик',client],['Оборудование',equipment||'Без привязки'],['Потребность',notes||'Не указана'],['Адрес',address],['Контакт',phone],['Срок',due],['Стадия',status],['Инженеры',engineers]];
 context.querySelector('dl').innerHTML=rows.filter(([,value])=>value).map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
 const edit=context.querySelector('#requestEditContext');edit.hidden=!editable;edit.onclick=()=>openEntityPanel({title:'Изменить заявку',panel:form,trigger:edit,confirmDiscard});
}

export function positionOrderResult(root=document){
 const scope=root.getElementById('orderPane-scope'),summary=root.getElementById('orderResultSummary');if(!scope||!summary)return;
 scope.prepend(summary);const h=summary.querySelector('h3');if(h)h.textContent='Работы и материалы';
}

export function frameOrderWorkspace({record,editable,people},root=document){
 const editor=root.getElementById('orderEditor');if(!editor||editor.querySelector(':scope>.workspace-masthead'))return;
 const doc=editor.ownerDocument,head=element(doc,'header','workspace-masthead'),inner=element(doc,'div','workspace-header-inner'),main=element(doc,'main','workspace-main');
 const title=editor.querySelector('.trip-head h2');if(record.id&&title)title.textContent=record.title||'Задание';
 inner.append(editor.querySelector('.crumbs'),editor.querySelector('.trip-head'));head.append(inner);
 while(editor.firstChild)main.append(editor.firstChild);editor.append(head,main);editor.closest('.view')?.classList.add('workspace-page');
 const toolbar=editor.querySelector('.order-toolbar');
 if(record.id){
  const briefing=element(doc,'section','order-briefing-layout'),aside=element(doc,'aside','card order-team-card');
  const name=id=>people.find(p=>p.id===id)?.full_name||'Не назначен';
  aside.innerHTML=`<div class="workspace-section-head"><h3>Команда и ответственность</h3></div><p class="workspace-lead-person">${escape(name(record.lead_engineer))}</p><p class="hint">Ответственный инженер</p><div class="workspace-team-list">${(record.engineer_ids||[]).filter(id=>id!==record.lead_engineer).map(id=>`<p>${escape(name(id))}</p>`).join('')}</div><dl class="workspace-responsibility"><div><dt>Куратор</dt><dd>${escape(name(record.curator_id))}</dd></div><div><dt>Владелец</dt><dd>${escape(name(record.owner_id))}</dd></div></dl>${editable?'<button type="button" class="btn sm ghost" data-edit-organization>Организация задания</button>':''}`;
  const brief=root.getElementById('orderBrief');brief.querySelector('.order-team-meta')?.remove();
  const context=element(doc,'dl','order-brief-context');context.innerHTML=`<div><dt>Заказчик</dt><dd>${escape(record.jobs?.clients?.name||'Не указан')}</dd></div><div><dt>Оборудование</dt><dd>${escape(record.jobs?.equipment?.model||'Без привязки')}</dd></div>`;brief.querySelector('.order-brief-head').after(context);
  const linked=(record.trip_service_orders||[]).find(x=>x.trips&&!x.trips.deleted_at);if(linked){const travel=element(doc,'button','btn sm');travel.type='button';travel.textContent='Открыть связанный выезд →';travel.onclick=()=>root.querySelector('#orderTrips [data-order-trip="'+linked.trips.id+'"]')?.click();brief.append(travel);}
  briefing.append(brief,aside);toolbar.before(briefing);
  const organization=root.getElementById('orderOrganization');organization.hidden=true;root.getElementById('orderAuxiliary').append(organization);
  if(editable){const details=element(doc,'details','workspace-organization-editor');details.innerHTML='<summary>Организация задания</summary>';organization.hidden=false;details.append(organization);aside.querySelector('[data-edit-organization]')?.replaceWith(details);}
  const composition=root.getElementById('orderComposition'),details=element(doc,'details','workspace-composition-editor');details.innerHTML=`<summary>${editable?'Плановые данные и изменение состава':'Плановые данные задания'}</summary>`;composition.before(details);details.append(composition);
  // The brief stays in view when switching between scope, travel and evidence.
  const emptyGrid=editor.querySelector('.order-grid');if(emptyGrid&&!emptyGrid.children.length)emptyGrid.remove();
  positionOrderResult(root);
 }
 const savebar=editor.querySelector('.order-savebar');if(savebar){const state=root.getElementById('orderSaveState'),save=root.getElementById('orderSave');if(state)inner.querySelector('.entity-head-meta').append(state);if(save)inner.querySelector('.entity-header-actions').append(save);savebar.remove();}
}
