import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
const job=fixtureIDs.job,order=fixtureIDs.order,trip=fixtureIDs.trip,other='00000000-0000-4000-8000-000000000003';
async function boot(page,info,{role='logist',stage='assigned',route='job/'+job,failAssignment=false,routeBuilder=false,tripResultJourney=false,standaloneWorkPlan=false,paymentJourney=false,roadJourney=false,scopedFinanceJourney=false,tripOrderPicker=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.install({time:new Date('2026-10-05T17:00Z')});await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,preserveRanges:true,unifiedJournalJourney:roadJourney,managerJourney:{stage,failAssignment,routeBuilder,tripResultJourney,standaloneWorkPlan,paymentJourney,roadJourney,scopedFinanceJourney,tripOrderPicker}});await page.goto('/#/'+route);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.view.active')).toBeVisible();return errors;
}
async function navigate(page,view,hash){await page.evaluate(hash=>{location.hash=hash;},hash);await expect(page.locator('.view-'+view)).toHaveClass(/active/);}
async function reopenRequest(page){await navigate(page,'planner','/planner/jobs');await navigate(page,'job','/job/'+job);}
async function shot(page,info,name){const folder='test-results/manager-workflow/'+info.project.name;mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/'+name+'.png',animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
const dialog=page=>page.locator('dialog.entity-panel-dialog:visible').last();
async function cancelEditor(page){await dialog(page).locator('[data-entity-cancel]').click();await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmYes').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);}
async function keepOnlyOther(page,select){await page.locator(select+' + .engineer-picker').click();const choices=page.locator('.engineer-options');await expect(choices).toBeVisible();await choices.locator('input[type=checkbox]').first().uncheck();await choices.getByRole('button',{name:'Готово',exact:true}).click();}

test('V16: chooses an existing assignment from the trip menu and writes only when saving the plan',async({page},info)=>{
 const errors=await boot(page,info,{route:'trip/'+trip,tripOrderPicker:true});
 const writes=()=>page.evaluate(()=>window.__visualQA.financeWrites.filter(write=>write.name==='trip_plan_save_tasks'));
 await page.locator('#tripMore').click();
 await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:'Привязать задание'}).click();
 const picker=page.getByRole('dialog',{name:'Привязать задание'}),search=picker.getByRole('searchbox');
 await search.fill('нет такого задания');
 await expect(picker.getByText('Заданий по этому запросу нет.')).toBeVisible();
 await expect(picker.getByRole('radio')).toHaveCount(0);
 await search.fill('102');
 await picker.getByRole('radio',{name:/№102/}).check();
 await picker.getByRole('button',{name:'Добавить в план'}).click();
 await expect(picker).toHaveCount(0);
 await expect(page).toHaveURL(/\/plan$/);
 await expect(page.locator('#tpLinkedOrders')).toContainText('102');
 expect(await writes()).toEqual([]);
 await page.locator('#tpSave').click();
 await page.locator('#promptOverlay [data-pf=reason]').fill('Дополнительные работы по заявке');
 await page.locator('#promptOverlay #promptYes').click();
 await expect.poll(writes).toEqual([expect.objectContaining({args:expect.objectContaining({p_trip:trip,p_order_ids:[order,'20000000-0000-4000-8000-000000000002']})})]);
 await clean(page,errors);
});

test('M15: payment fields inherit independently and open the work exception for reset',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',tripResultJourney:'engineer',paymentJourney:true});
 const card=view=>page.locator('.view-'+view+'.active .entity-payment-terms');
 const field=(root,key)=>root.locator('[data-payment-field="'+key+'"]');
 const values=(root,...terms)=>expect(root.locator('.payment-term-values dd')).toHaveText(terms);
 const edit=async(root,terms)=>{
  await root.getByRole('button',{name:'Изменить условия'}).click();
  const form=dialog(page);
  for(const [key,value] of Object.entries(terms))await field(form,key).selectOption(value);
  await form.locator('[data-entity-save]').click();
  await expect(form).toHaveCount(0);
 };
 await expect(card('job')).toBeVisible();
 await values(card('job'),'Вне гарантии','Клиент');
 await edit(card('job'),{warranty:'warranty'});
 await values(card('job'),'Гарантийная','DLight · Производство');
 await edit(card('job'),{warranty:'warranty',payer:'tp-factory'});
 await values(card('job'),'Гарантийная','DLight · Производство');
 await shot(page,info,'request-payment-terms');
 await navigate(page,'order','/order/'+order+'/overview');
 await values(card('order'),'Гарантийная','DLight · Производство');
 await edit(card('order'),{payer:'tp-service'});
 await values(card('order'),'Гарантийная','DLight · Отдел сервиса');
 await navigate(page,'order','/order/'+order+'/scope/'+trip);
 const panel=page.locator('#orderTripResults'),expand=panel.locator('[data-visit-expand]').first();
 await expand.click();
 const resultNote=panel.locator('[data-visit-line] [data-visit-field=note]').first();
 await resultNote.fill('Черновик остаётся в работе');
 const work=panel.locator('[data-work-payment]').first();
 await expect(field(work,'warranty').locator('option').first()).toHaveText('Наследовать · Гарантийная');
 await expect(field(work,'payer').locator('option').first()).toHaveText('Наследовать · DLight · Отдел сервиса');
 await field(work,'warranty').selectOption('paid');
 await work.locator('[data-payment-save]').click();
 await expect(panel.locator('.payment-work-cue').first()).toContainText('Вне гарантии · DLight · Отдел сервиса · Свои условия');
 await expect(resultNote).toHaveValue('Черновик остаётся в работе');
 await shot(page,info,'work-payment-terms');
 await page.locator('#orderTab-overview').click();
 await card('order').locator('[data-payment-exception]').click();
 await expect(work).toBeVisible();
 await work.locator('[data-payment-reset]').click();
 await expect(panel.locator('.payment-work-cue').first()).toHaveText('Гарантийная · DLight · Отдел сервиса');
 await expect(resultNote).toHaveValue('Черновик остаётся в работе');
 await navigate(page,'trip','/trip/'+trip+'/overview');
 await values(card('trip'),'Смешанные условия','Разные плательщики');
 await edit(card('trip'),{payer:'tp-service'});
 await values(card('trip'),'Смешанные условия','DLight · Отдел сервиса');
 await shot(page,info,'trip-payment-terms');
 const writes=await page.evaluate(()=>window.__visualQA.paymentWrites);
 expect(writes.map(row=>[row.p_scope,row.p_terms])).toEqual([
  ['job',{warranty:'warranty'}],['job',{warranty:'warranty',payer:'tp-factory'}],['order',{payer:'tp-service'}],['work',{warranty:'paid'}],['work',{}],['trip',{payer:'tp-service'}]]);
 await clean(page,errors);
});

test('M16: road shares, payment terms and an edited tariff survive a split and reopen from the trip card',async({page},info)=>{
 const errors=await boot(page,info,{route:'journal/trip/'+trip+'/route',paymentJourney:true,roadJourney:true,stage:'in_progress'});
 const roads=page.locator('.journal-road-sections');
 await expect(roads.getByRole('table',{name:'Участки дороги'})).toBeVisible();
 await expect(roads.locator('[data-road-row]').last()).toContainText('Нужно назначить плательщика');
 await roads.locator('[data-road-filter=unassigned]').click();
 await expect(roads.locator('[data-road-row]:visible')).toHaveCount(1);
 await roads.locator('[data-road-filter=all]').click();
 const row=roads.locator('[data-road-row]').first(),expand=row.locator('[data-road-expand]');
 await expand.click();
 const detail=roads.locator('.journal-road-detail:visible').first(),terms=detail.locator('[data-road-payment]');
 await detail.getByRole('button',{name:'Распределить по заявкам'}).click();
 const form=dialog(page),km=form.getByRole('textbox',{name:/Километры/}).first();
 await km.fill('21');
 await expect(form.locator('[data-road-balance]')).toContainText('Сверх длины');
 await form.locator('[data-entity-save]').click();
 await expect(form.getByRole('alert')).toContainText('больше длины');
 await km.fill('12,5');await form.locator('[data-entity-save]').click();
 await expect(detail).toContainText('12,5 из 20 км распределено');
 await terms.locator('[data-payment-field=payer]').selectOption('tp-service');
 await terms.locator('[data-payment-save]').click();
 await expect(terms).toContainText('Задано здесь');
 await detail.getByRole('button',{name:'Разделить участок'}).click();
 const split=page.locator('.journal-route-map').getByRole('form',{name:'Разделение участка'});
 await expect(split.getByRole('slider')).toBeVisible();
 await expect(page.locator('.journal-trip-route .journal-route-map path[stroke="#266fe0"]')).toBeVisible();
 await expect(split.locator('[data-road-split-summary]')).toContainText(/10 км.*\/.*10 км/);
 await split.getByRole('button',{name:'Разделить',exact:true}).click();
 await expect(roads.locator('[data-road-row]')).toHaveCount(3);
 await expect(detail).toContainText('6,25 из 10 км распределено');
 await shot(page,info,'journal-road-payment');
 await navigate(page,'trip','/trip/'+trip+'/economy');
 await page.locator('#tpReviewCosts').click();
 const costs=page.getByRole('dialog',{name:'Распределить расходы'}),accounting=costs.locator('#tpJournalRoadAccounting');
 await expect(accounting).toBeVisible();
 const charge=accounting.locator('tbody tr').first();
 await expect(charge.locator('td').nth(1)).toHaveText('—');
 await charge.locator('[data-road-rate]').click();
 await dialog(page).locator('[data-rate=revenue]').fill('25');
 await dialog(page).locator('[data-entity-save]').click();
 await expect(charge.locator('td').nth(1)).toContainText('156,25');
 await costs.getByRole('button',{name:'Закрыть'}).click();await expect(costs).toHaveCount(0);
 await page.locator('#tpTabOverview').click();
 const linked=page.locator('#payment-trip-card');
 await linked.locator('details summary').click();
 await linked.locator('[data-payment-exception]').first().click();
 await expect(roads.locator('.journal-road-detail:visible').first()).toContainText('Задано здесь');
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.roadWrites.map(row=>row.p_action))).toEqual(['shares','terms','split','rates']);
 await clean(page,errors);
});

test('M17: accepted road and work feed the three financial views and total adjustments stay in their card',async({page},info)=>{
 const errors=await boot(page,info,{route:'order/'+order+'/plan-fact',scopedFinanceJourney:true,roadJourney:true,stage:'in_progress'});
 const finance=page.locator('.view.active .scoped-finance'),fact=finance.locator('.scoped-finance-money').nth(1);
 const plan=finance.locator('.scoped-finance-money').first();
 const totals=(revenue,cost)=>expect(fact.locator('dd')).toHaveText([revenue,cost]);
 await totals('950 грн','635 грн');
 await expect(finance.getByRole('table',{name:'Вклад по выездам',exact:true})).toBeVisible();
 const mileage=finance.getByRole('table',{name:'Пробег по выездам',exact:true});
 await mileage.getByRole('button',{name:/Пробег выезда/}).click();
 await expect(mileage.getByRole('table',{name:'Детали пробега'})).toBeVisible();
 await expect(mileage.getByRole('button',{name:'Журнал GPS'})).toBeVisible();
 await expect(finance.getByRole('columnheader',{name:'Состояние'})).toBeAttached();
 await finance.getByRole('button',{name:'Таблицы',exact:true}).click();
 await expect(finance.getByRole('table',{name:'Экономика · план и факт'})).toBeVisible();
 await finance.locator('[data-finance-section=breakdown] summary').click();
 await expect(finance.getByRole('row',{name:/Приход от пробега/})).toContainText('400 грн');
 await finance.locator('[data-finance-section=rates] summary').click();
 await finance.locator('[data-finance-rate]').first().click();
 const editor=finance.locator('.scoped-finance-editor');
 await editor.locator('[data-rate-mode=fact][data-rate-metric=revenue]').fill('600');
 await editor.locator('[data-rate-mode=fact][data-rate-metric=cost]').fill('70');
 await editor.locator('[data-finance-save]').click();
 await totals(/1\s050 грн/,'395 грн');
 await shot(page,info,'task-finance-rates');
 await finance.getByRole('button',{name:'Изменить тарифы · База → Объект',exact:true}).click();
 await expect(editor.locator('legend')).toHaveText('План');
 await editor.locator('[data-road-rate-metric=revenue]').fill('25');
 await editor.locator('[data-road-rate-metric=cost]').fill('6');
 await editor.locator('[data-finance-save]').click();
 await expect(plan.locator('dd')).toHaveText([/1\s540 грн/,'914 грн']);
 await totals(/1\s050 грн/,'395 грн');
 await navigate(page,'trip','/trip/'+trip+'/economy');
 await totals(/1\s050 грн/,'395 грн');
 const group=finance.getByRole('table',{name:'Трудозатраты по работам',exact:true});
 await expect(group.getByRole('columnheader',{name:'Задание',exact:true})).toBeVisible();
 await group.getByRole('button',{name:/Работы задания №/}).click();
 await expect(finance.getByRole('table',{name:/Работы задания №/})).toBeVisible();
 await finance.getByRole('searchbox',{name:'Найти работу'}).fill('Нет такой работы');
 await expect(finance.getByRole('table',{name:/Работы задания №/})).toBeHidden();
 await finance.getByRole('searchbox',{name:'Найти работу'}).fill('');
 await expect(finance.getByRole('table',{name:/Работы задания №/})).toBeVisible();
 await finance.locator('[data-finance-section=totals] summary').click();
 await finance.getByRole('button',{name:'Изменить итог · Приход · Факт'}).click();
 await editor.locator('[data-finance-value]').fill('1600');
 await expect(editor.locator('[data-finance-delta]')).toHaveText('+550');
 await editor.locator('[data-finance-save]').click();
 await expect(editor.getByRole('alert')).toContainText('Укажите причину');
 await editor.locator('[data-finance-reason]').fill('Согласовано с заказчиком');
 await editor.locator('[data-finance-save]').click();
 await totals(/1\s600 грн/,'395 грн');
 await expect(fact).toContainText('Итог скорректирован');
 await shot(page,info,'trip-finance-correction');
 await navigate(page,'job','/job/'+job+'/plan-fact');
 await totals(/1\s050 грн/,'395 грн');
 await expect(plan.locator('dd')).toHaveText([/1\s540 грн/,'914 грн']);
 await navigate(page,'trip','/trip/'+trip+'/economy');
 await totals(/1\s600 грн/,'395 грн');
 await finance.locator('[data-finance-section=totals] summary').click();
 await finance.getByRole('button',{name:'Изменить итог · Приход · Факт'}).click();
 await editor.getByRole('button',{name:'Вернуть расчёт'}).click();
 await totals(/1\s050 грн/,'395 грн');
 const writes=await page.evaluate(()=>window.__visualQA.scopedFinanceWrites);
 expect(writes.map(row=>[row.p_scope,row.p_value])).toEqual([
  ['work',{fact:{revenue:600,cost:70}}],['road_plan',{revenue:25,cost:6}],
  ['trip',{value:1600,reason:'Согласовано с заказчиком'}],['trip',{}]]);
 await clean(page,errors);
});

test('M1 M2: request deadline, note, team and status have explicit save and real cancellation',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('#jobOverviewState')).toBeVisible();const initialDue=await page.locator('#jbDue').inputValue(),initialStatus=await page.locator('#jbStatus').inputValue(),initialVisit=await page.locator('#jbDate').inputValue(),initialCrew=await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value));
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await expect(page.locator('#jbDate')).toBeHidden();await expect(dialog(page)).toContainText('Задания и дорога планируются в графике.');await page.locator('#jbDue').fill('2026-10-12');await page.locator('#jbNotes').fill('Согласован новый срок');await page.waitForTimeout(900);expect(await page.evaluate(()=>window.__visualQA.financeWrites.length)).toBe(0);await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await reopenRequest(page);await expect(page.locator('#jbDue')).toHaveValue('2026-10-12');await expect(page.locator('#jbNotes')).toHaveValue('Согласован новый срок');
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await page.locator('#jbDue').fill('2026-10-20');await page.locator('#jbNotes').fill('Эта заметка отменена');await cancelEditor(page);await expect(page.locator('#jbDue')).toHaveValue('2026-10-12');await expect(page.locator('#jbNotes')).toHaveValue('Согласован новый срок');
 await page.locator('#requestEditContext').click();await page.locator('#jbStatus').selectOption('in_progress');await keepOnlyOther(page,'#jbEng');await cancelEditor(page);await expect(page.locator('#jbStatus')).toHaveValue(initialStatus);expect(await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value))).toEqual(initialCrew);
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await page.locator('#jbNotes').fill('Последующая отдельная правка');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);const saved=await page.evaluate(()=>window.__visualQA.financeWrites.at(-1).args.p_rec);expect(saved).toMatchObject({due_date:'2026-10-12',notes:'Последующая отдельная правка',status:initialStatus,scheduled_date:initialVisit||null,engineer_ids:initialCrew});expect(initialDue).not.toBe('2026-10-12');
 await page.locator('#requestEditContext').click();await page.locator('#jbStatus').selectOption('in_progress');await keepOnlyOther(page,'#jbEng');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await reopenRequest(page);await expect(page.locator('#jbStatus')).toHaveValue('in_progress');expect(await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value))).toEqual([other]);await shot(page,info,'request-saved');await clean(page,errors);
});
for(const stage of ['draft','assigned','in_progress','paused','review'])test('M3 M6 M7: manager plans '+stage+' without changing SLA, trip crew or recorded work',async({page},info)=>{
 const errors=await boot(page,info,{stage,route:'order/'+order}),before=await page.evaluate(()=>window.__visualQA.managerState);await page.locator('#orderEditData').click();await page.locator('#orderPlanTo').fill('2026-10-12');await page.locator('#orderPlanReason').fill('Согласован срок с заказчиком');await expect(dialog(page)).toContainText('SLA');await expect(dialog(page).locator('.planning-warnings')).toContainText('позже срока');await shot(page,info,'task-'+stage+'-planning');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await expect(page.locator('.workflow-head-facts')).toContainText('12.10.2026');
 await page.locator('#orderEditData').click();await keepOnlyOther(page,'#orderPlanCrew');await page.locator('#orderPlanLead').selectOption(other);await page.locator('#orderPlanReason').fill('Передаём следующему инженеру');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);const state=await page.evaluate(()=>window.__visualQA.managerState);expect(state.order).toMatchObject({status:stage,date_to:'2026-10-12',engineer_ids:[other],lead_engineer:other});expect(state.request).toEqual(before.request);expect(state.trip).toEqual(before.trip);expect(state.order.items).toEqual(before.order.items);await navigate(page,'planner','/planner/orders');await navigate(page,'order','/order/'+order);await expect(page.locator('.workflow-head-facts')).toContainText('12.10.2026');await shot(page,info,'task-'+stage+'-saved');await clean(page,errors);
});

test('M4: the task editor saves name and period before a handoff that uses the fresh revision',async({page},info)=>{
 const errors=await boot(page,info,{route:'order/'+order});await page.locator('#orderTab-scope').click();await expect(page.locator('#orderPane-scope #orderOrganization')).toHaveCount(0);await page.locator('#orderEditData').click();const edit=page.getByRole('dialog',{name:'Изменить задание'});await edit.locator('#orderPlanTitle').fill('Диагностика насоса');await edit.locator('#orderPlanTo').fill('2026-10-12');await edit.locator('#orderPlanReason').fill('Согласовали новый срок с клиентом');await edit.getByRole('button',{name:'Сохранить изменения'}).click();await expect(edit).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_save_one','service_order_organization_save']);
 await page.locator('#orderMore').click();await page.getByRole('button',{name:'Ответственность',exact:true}).click();await dialog(page).locator('select[name=person]').selectOption(other);await dialog(page).locator('input[name=reason]').fill('Новый ведущий куратор задания');await dialog(page).getByRole('button',{name:'Передать',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_save_one','service_order_organization_save','entity_responsibility_assign']);const writes=await page.evaluate(()=>window.__visualQA.managerWrites);expect(writes[2].args.p_expected).toBe(2);await page.locator('#orderTab-overview').click();await expect(page.locator('.workflow-head-facts')).toContainText('12.10.2026');await expect(page.locator('.workflow-subject')).toHaveText('Диагностика насоса');await shot(page,info,'responsibility-saved');await clean(page,errors);
});

test('M5: manager changes trip dates through plan save instead of sending a request',async({page},info)=>{
 const errors=await boot(page,info,{route:'trip/'+trip});await page.locator('#tripMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:/^(Изменить даты выезда|Запросить перенос)$/}).click();await expect(page.locator('#reschedOverlay')).toBeHidden();const editor=page.getByRole('dialog',{name:'Изменить выезд'});await expect(editor).toContainText('Сохранить изменения');await editor.locator('#tpFrom').fill('2026-10-12');await editor.locator('#tpTo').fill('2026-10-13');await editor.locator('#tpChangeReason').fill('Согласовали новые даты выезда');await editor.locator('[data-entity-save]').click();await expect(editor).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.__visualQA.financeWrites.filter(w=>w.name==='trip_plan_save_tasks').length)).toBe(1);await expect(page.locator('#tpFrom')).toHaveValue('2026-10-12');const state=await page.evaluate(()=>window.__visualQA);expect(state.reads).not.toContain('rpc:trip_reschedule_request');expect(state.managerState.order.date_from).toBe('2026-10-05');expect(state.managerState.request.due_date).toBe('2026-10-09');await shot(page,info,'trip-dates-saved');await clean(page,errors);
});

test('M3 M5: engineer proposes a deadline and requests trip rescheduling without manager planning rights',async({page},info)=>{
 const errors=await boot(page,info,{role:'engineer',route:'order/'+order});await expect(page.locator('[data-order-edit-dates],[data-order-edit-crew]')).toHaveCount(0);await page.locator('#orderMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:'Предложить срок',exact:true}).click();await page.locator('#orderDeadlineDate').fill('2026-10-12');await page.locator('#orderDeadlineReason').fill('Нужен дополнительный день');await page.locator('#orderDeadlineSend').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_deadline_propose']);await dialog(page).getByRole('button',{name:'Закрыть',exact:true}).click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();await navigate(page,'trip','/trip/'+trip);await page.locator('#tripMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:/^(Изменить даты выезда|Запросить перенос)$/}).click();await expect(page.locator('#reschedOverlay')).toBeVisible();await page.locator('#rsFrom').fill('2026-10-12');await page.locator('#rsTo').fill('2026-10-13');await page.locator('#rsReason').fill('Согласовать перенос');await page.locator('#rsSend').click();await expect(page.locator('#reschedOverlay')).toBeHidden();await expect(page.locator('#tpFrom')).toHaveValue('2026-10-05');expect(await page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_deadline_propose','trip_reschedule_request']);await clean(page,errors);
});


test('M4: a failed handoff keeps the separately saved period and the latest version',async({page},info)=>{
 const errors=await boot(page,info,{route:'order/'+order,failAssignment:true});await page.locator('#orderTab-scope').click();await expect(page.locator('#orderPane-scope #orderOrganization')).toHaveCount(0);await page.locator('#orderEditData').click();const edit=page.getByRole('dialog',{name:'Изменить задание'});await edit.locator('#orderPlanTo').fill('2026-10-12');await edit.locator('#orderPlanReason').fill('Согласовали новый срок с клиентом');await edit.getByRole('button',{name:'Сохранить изменения'}).click();await expect(edit).toHaveCount(0);await page.locator('#orderMore').click();await page.getByRole('button',{name:'Ответственность',exact:true}).click();await dialog(page).locator('select[name=person]').selectOption(other);await dialog(page).locator('input[name=reason]').fill('Передаём другому куратору');await dialog(page).getByRole('button',{name:'Передать',exact:true}).click();await expect(dialog(page)).toContainText('Передача отклонена');expect(await page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_organization_save']);expect(await page.evaluate(()=>window.__visualQA.managerState.order)).toMatchObject({date_to:'2026-10-12',revision:1});await shot(page,info,'handoff-failed-plan-saved');await clean(page,errors);
});

test('M7: request tasks show their period and a new task shows the independent request SLA',async({page},info)=>{
 const errors=await boot(page,info);await page.locator('#jobTabTasks').click();await expect(page.locator('.order-child-period').first()).toContainText('05.10.2026');await page.locator('#jobOrders [data-order-new]').click();await expect(page.locator('.view-order')).toHaveClass(/active/);await expect(page.locator('.order-planning-summary')).toContainText('09.10.2026');await page.locator('#orderTo').fill('2026-10-14');await expect(page.locator('.order-planning-summary .planning-warnings')).toContainText('позже срока');expect(await page.evaluate(()=>window.__visualQA.managerWrites)).toEqual([]);await shot(page,info,'new-task-sla');await clean(page,errors);
});

test('M7: related record tables keep search, work details and trip actions in their card',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',tripResultJourney:'manager'});
 await page.locator('#jobTabTasks').click();
 const taskTable=page.locator('#jobOrders').getByRole('table',{name:'Задания',exact:true});
 await expect(taskTable.locator('thead th').first()).toHaveText('Задание');
 const disclosure=taskTable.getByRole('button',{name:/Раскрыть задание №/}).first();
 await disclosure.click();
 await expect(taskTable.getByRole('heading',{name:'Работы задания'})).toBeVisible();
 const search=page.locator('#jobOrders').getByRole('searchbox',{name:'Найти задание'});
 await search.fill('Нет такого задания');
 await expect(disclosure).toBeHidden();
 await expect(page.locator('#jobOrders [data-related-empty]')).toBeVisible();
 await search.fill('');
 await expect(taskTable.getByRole('heading',{name:'Работы задания'})).toBeVisible();
 await shot(page,info,'request-task-table');
 await page.locator('#jobTabTrips').click();
 const trips=page.locator('#jobLinkedTrips').getByRole('table',{name:'Выезды',exact:true});
 await expect(trips.locator('thead th').nth(2)).toHaveText('Часы по посещениям');
 await expect(page.locator('#jobLinkedTrips').getByRole('searchbox',{name:'Найти выезд'})).toBeVisible();
 await trips.getByRole('button',{name:/Раскрыть выезд/}).first().click();
 const status=trips.locator('.related-task-reference .related-status').first();
 await expect(status).toHaveText('В работе');
 expect(await status.evaluate(node=>{const text=node.ownerDocument.createRange();text.selectNodeContents(node);return text.getClientRects().length;})).toBe(1);
 await shot(page,info,'request-trip-table');
 await navigate(page,'trip','/trip/'+trip+'/plan');
 await expect(page.locator('#tpLinkedOrders').getByRole('table',{name:'Задания выезда',exact:true})).toBeVisible();
 await expect(page.locator('#tpTaskPicker')).not.toHaveAttribute('open');
 await shot(page,info,'trip-task-table');
 await clean(page,errors);
});

test('M7: choosing a result among several linked tasks opens the trip table filtered by request',async({page},info)=>{
 const errors=await boot(page,info,{route:'job/'+job+'/trips',stage:'in_progress',tripResultJourney:'multiple'});
 await page.locator('#jobLinkedTrips').getByRole('button',{name:'Отчитаться о работах'}).click();
 const list=page.locator('#tpLinkedOrders'),records=list.locator('[data-related-row]');
 await expect(page.locator('#tpTabPlan')).toHaveAttribute('aria-selected','true');
 await expect(list.getByRole('table',{name:'Задания выезда'})).toBeVisible();
 await expect(records).toHaveCount(2);
 await expect(records.filter({hasText:'Работы по другой заявке'})).toHaveCount(0);
 await list.getByRole('button',{name:'Снять фильтр по заявке'}).click();
 await expect(records).toHaveCount(3);
 await expect(records.filter({hasText:'Работы по другой заявке'})).toBeVisible();
 await expect(list.getByRole('searchbox')).toBeFocused();
 await records.first().getByRole('button',{name:'Отчитаться о работах'}).click();
 await expect(page.locator('.view-order')).toHaveClass(/active/);
 await expect(page.locator('#orderTab-scope')).toHaveAttribute('aria-selected','true');
 await clean(page,errors);
});

test('M8: closing a partial task offers its remaining work when the request gets a new task',async({page},info)=>{
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.continue():route.abort());
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,remainderJourney:true});
 await page.goto('/#/order/'+fixtureIDs.activeOrder);
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.locator('#orderMore').click();
 await page.getByRole('button',{name:'Закрыть с остатком',exact:true}).filter({visible:true}).click();
 await page.locator('#promptFields textarea').fill('Принят выполненный объём');
 await page.locator('#promptYes').click();
 await expect(page.locator('#orderOverviewState h2')).toHaveText('Закрыто с остатком');
 expect(await page.evaluate(()=>window.__visualQA.remainderWrites.length)).toBe(1);

 await page.locator('.workflow-crumb-link').click();
 await expect(page.locator('#jobOverviewState h2')).toHaveText('Есть остаток работ');
 await page.locator('#jobRecordResult').click();
 const candidates=page.locator('#orderRequestRemainders [data-remainder-item]');
 await expect(candidates).toHaveCount(2);
 await expect(candidates.first()).not.toBeChecked();
 await candidates.first().check();
 await page.locator('#orderTitle').fill('Второй этап');
 await shot(page,info,'request-remainder');
 await page.locator('#orderSave').click();
 await expect(page.locator('.view-order.active .workflow-subject')).toHaveText('Второй этап');
 const writes=await page.evaluate(()=>window.__visualQA.remainderWrites);
 expect(writes.map(write=>write.name)).toEqual(['service_order_close_with_remainder','service_order_create_with_remainders']);
 expect(writes[1].args.p_remainders).toHaveLength(1);
 expect(writes[1].args.p_items).toEqual([]);
 await clean(page,errors);
});


async function mockTripRouting(page){
 await page.route('**/functions/v1/ors',route=>{
  const {body}=route.request().postDataJSON();
  return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{properties:{summary:{distance:128000,duration:7200}},geometry:{type:'LineString',coordinates:body.coordinates}}]})});
 });
}

test('M9: trip overview reads the route and the main map saves changes to the same trip',async({page},info)=>{
 const errors=await boot(page,info,{route:'trip/'+trip,routeBuilder:true});
 await mockTripRouting(page);
 const points=page.locator('#tpRouteStops [data-route-point]');
 await expect(points).toHaveCount(3);
 await expect(page.getByRole('heading',{name:'Маршрут выезда'})).toBeVisible();
 await expect(page.locator('#tpRoutePointTime')).toBeHidden();
 await points.nth(1).click();await expect(points.nth(1)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#tpRouteStops [data-up],#tpRouteStops [data-wprm]')).toHaveCount(0);
 await shot(page,info,'trip-route-overview');
 await page.locator('#tpViewMap').click();
 await expect(page).toHaveURL(/\/map$/);
 await expect(page.locator('#routeBlock')).toBeHidden();
 await page.goBack();
 await expect(page.locator('#tpViewMap')).toBeVisible();
 await page.locator('#tripMore').click();
 await page.getByRole('button',{name:'Редактировать маршрут на карте',exact:true}).click();
 await expect(page).toHaveURL(/\/map\/edit$/);
 await expect(page.locator('#rTripRouteContext')).toBeVisible();
 await expect(page.locator('#rStops .route-pt')).toHaveCount(3);
 await page.locator('#rStops [data-rup="1"]').click();
 await expect(page.locator('#rSaveTrip')).toBeDisabled();
 await page.locator('#rBuild').click();
 await expect(page.locator('#rSaveTrip')).toBeEnabled();
 await page.locator('#rSaveTrip').click();
 await page.locator('#promptNo').click();
 expect(await page.evaluate(()=>window.__visualQA.financeWrites)).toEqual([]);
 await page.locator('#rSaveTrip').click();
 await page.locator('[data-pf=reason]').fill('Согласован объезд');
 await page.locator('#promptYes').click();
 await expect(page.locator('.view-trip.active')).toBeVisible();
 const [save]=await page.evaluate(()=>window.__visualQA.financeWrites.filter(write=>write.name==='trip_plan_save_tasks'));
 expect(save.args).toMatchObject({p_trip:trip,p_expected:0,p_order_ids:[order,fixtureIDs.activeOrder],p_reason:'Согласован объезд'});
 expect(save.args.p_plan.route_stops.map(point=>point.type)).toEqual(['start','wp','job']);
 expect(save.args.p_plan.route_stops[2].job_id).toBe(job);
 await clean(page,errors);
});


test('M9: remaining travel is calculated from current GPS without changing confirmed travel',async({page},info)=>{
 const errors=await boot(page,info,{route:'trip/'+trip,routeBuilder:'active'});
 await mockTripRouting(page);
 await expect(page.locator('#tpRoutePointTime')).toBeVisible();
 await expect(page.locator('.view-trip.active #rRebuildRemaining')).toHaveCount(0);
 await page.locator('#tripMore').click();
 await page.getByRole('button',{name:'Редактировать маршрут на карте',exact:true}).click();
 await expect(page.locator('#rRebuildRemaining')).toBeVisible();
 await page.locator('#rRebuildRemaining').click();
 await expect(page.locator('#rStatus')).toContainText('Осталось');
 expect(await page.evaluate(()=>window.__visualQA.financeWrites)).toEqual([]);
 await page.locator('#rSaveTrip').click();
 await page.locator('[data-pf=reason]').fill('Обновили расчёт от автомобиля');
 await page.locator('#promptYes').click();
 await expect(page.locator('.view-trip.active')).toBeVisible();
 const [save]=await page.evaluate(()=>window.__visualQA.financeWrites.filter(write=>write.name==='trip_plan_save_tasks'));
 expect(save.args.p_plan.remaining_route).toMatchObject({position_ts:'2026-10-05T16:58:00Z',stops:[{type:'start',lat:49.98,lng:36.22},{type:'wp',name:'Промежуточная точка'}]});
 expect(save.args.p_plan).not.toHaveProperty('fact_km');
 expect(save.args.p_plan.route_stops.map(point=>point.type)).toEqual(['start','job','wp']);
 await clean(page,errors);
});

test('M10: the engineer resumes a trip draft, reviews it and sends it to the curator',async({page},info)=>{
 const errors=await boot(page,info,{role:'engineer',stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'engineer'});
 const panel=page.locator('#orderTripResults'),line=panel.locator('[data-visit-line]').first();
 const expand=panel.locator('[data-visit-expand]').first();
 const materials=panel.locator('.order-trip-materials');
 const used=materials.locator('[data-visit-field=qty]').first();
 await expect(panel.locator('[data-visit-select]')).toHaveValue(trip);
 await expect(panel.locator('[data-visit-review]')).toBeInViewport();
 const workTable=panel.getByRole('table',{name:'Работы задания',exact:true});
 await expect(workTable.locator('thead th')).toHaveText(['Работа','План, н-ч','Факт, чел·ч','Комментарий','Детали работы']);
 await expect(expand).toHaveAttribute('aria-expanded','false');
 await expect(expand.locator('svg')).toBeVisible();
 expect((await expand.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await expand.click();
 await expect(expand).toHaveAttribute('aria-expanded','true');
 await expect(panel.locator('[data-work-plan-save]')).toHaveCount(0);
 await expect(line.locator('[data-visit-field=hours]')).toHaveValue('2');
 await expect(line.locator('[data-visit-source]')).toHaveText('Предложено 2 чел·ч');
 await line.locator('[data-visit-field=hours]').fill('1,5');
 await expect(workTable.locator('[data-trip-work-total]')).toHaveText('1,5');
 await expect(line.locator('[data-visit-source]')).toHaveText('Вручную');
 await line.locator('[data-visit-reset]').click();
 await expect(workTable.locator('[data-trip-work-total]')).toHaveText('2');
 await line.locator('[data-visit-field=qty]').fill('3');
 await line.locator('.order-trip-complete').click();
 await expect(line.getByRole('switch')).toBeChecked();
 await expect(line.locator('[data-visit-field=qty]')).toBeHidden();
 await line.locator('.order-trip-complete').click();
 await expect(line.locator('[data-visit-field=qty]')).toHaveValue('3');
 await panel.locator('[data-visit-review]').click();
 await expect(panel.locator('[role=alert]')).toContainText('Укажите, что осталось сделать');
 await line.locator('[data-visit-field=note]').fill('Осталась проверка');
 await materials.locator('summary').click();
 await used.fill('1');
 await page.reload();
 await expect(panel.locator('[data-visit-select]')).toHaveValue(trip);
 await expand.click();
 await expect(line.locator('[data-visit-field=qty]')).toHaveValue('3');
 await expect(line.locator('[data-visit-field=note]')).toHaveValue('Осталась проверка');
 await shot(page,info,'trip-result-work-details');
 await materials.locator('summary').click();
 await expect(used).toHaveValue('1');
 await panel.locator('[data-visit-review]').click();
 await expect(panel).toContainText('Проверьте результат задания');
 await shot(page,info,'trip-result-review');
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('На приёмке');
 await expect(panel.locator('[data-visit-line]')).toHaveCount(0);
 const [write]=await page.evaluate(()=>window.__visualQA.visitWrites);
 expect(write).toMatchObject({p_action:'submitted',p_order:order,p_trip:trip,p_trip_revision:4});
 expect(write.p_result.items[0]).toMatchObject({qty:3,hours:2,note:'Осталась проверка'});
 expect(write.p_result.items[1]).toMatchObject({qty:1,hours:0});
 await clean(page,errors);
});

test('M11: the curator saves a work norm without changing the trip report draft',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'manager'});
 const panel=page.locator('#orderTripResults');
 await panel.locator('[data-visit-expand]').first().click();
 const group=panel.locator('[data-work-plan]').first(),norm=group.getByRole('textbox',{name:'План, н-ч'});
 const work=panel.locator('[data-visit-line]').first();
 await expect(norm).toHaveValue('6');
 await work.locator('[data-visit-field=qty]').fill('4');
 await norm.fill('-1');
 await group.getByRole('button',{name:'Сохранить план'}).click();
 await expect(norm).toHaveAttribute('aria-invalid','true');
 expect(await page.evaluate(()=>window.__visualQA.workPlanWrites)).toEqual([]);
 await norm.fill('8,25');
 await norm.press('Enter');
 await expect(group.getByRole('status')).toHaveText('План сохранён');
 await expect(panel.locator('.order-trip-work-row [data-label="План, н-ч"]').first()).toHaveText('8,25');
 await expect(work.locator('[data-visit-field=hours]')).toHaveValue('2');
 await expect(work.locator('[data-visit-field=qty]')).toHaveValue('4');
 expect(await page.evaluate(()=>window.__visualQA.workPlanWrites)).toMatchObject([{p_order:order,p_expected:0,p_hours:8.25}]);
 await panel.locator('[data-visit-review]').click();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Принято');
 const [saved]=await page.evaluate(()=>window.__visualQA.visitWrites);
 expect(saved.p_order_revision).toBe(1);
 expect(saved.p_result.items[0]).toMatchObject({qty:4,hours:2});
 await clean(page,errors);
});

test('M12: planned parts stay with the work from draft through acceptance',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'parts'});
 const panel=page.locator('#orderTripResults');
 const expand=panel.locator('[data-visit-expand]').first();
 const group=panel.locator('[data-work-parts]').filter({has:page.locator('[data-work-part-attach]')});
 const work=panel.locator('[data-visit-line]').first();
 await expand.click();
 await work.locator('.order-trip-complete').click();
 await group.locator(':scope > summary').click();
 const part=await group.locator('select option').nth(1).evaluate(option=>({id:option.value,name:option.textContent}));
 await group.locator('select').selectOption(part.id);
 await group.getByRole('button',{name:'Привязать запчасть'}).click();
 const parts=panel.locator('.order-trip-work-fields .order-trip-materials');
 await expect(parts.locator(':scope > summary')).toHaveText('Запчасти · 1');
 await expect(panel.locator('[data-work-parts=unassigned] [data-visit-line="'+part.id+'"]')).toHaveCount(0);
 await expect(work.getByRole('switch')).toBeChecked();
 const [assignment]=await page.evaluate(()=>window.__visualQA.workPartWrites);
 expect(assignment).toMatchObject({p_part:part.id,p_expected:0});
 await parts.getByRole('textbox',{name:'Использовано, '+part.name}).fill('1');
 await parts.locator('.order-trip-part-actions summary').click();
 await parts.getByRole('textbox',{name:'Комментарий, '+part.name}).fill('Установлена при диагностике');
 await page.reload();
 await expand.click();
 await parts.locator(':scope > summary').click();
 await expect(parts.getByRole('textbox',{name:'Использовано, '+part.name})).toHaveValue('1');
 await shot(page,info,'trip-result-nested-parts');
 await panel.locator('[data-visit-review]').click();
 const reviewed=panel.locator('.order-trip-review tbody tr').filter({hasText:part.name});
 await expect(reviewed).toHaveCount(1);
 await expect(reviewed.locator('th')).not.toHaveText(part.name);
 await expect(reviewed).toContainText(part.name+' · 1');
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Принято');
 await expand.click();
 await parts.locator(':scope > summary').click();
 await expect(parts.getByRole('row').last()).toContainText(part.name);
 const [accepted]=await page.evaluate(()=>window.__visualQA.visitWrites);
 expect(accepted).toMatchObject({p_order_revision:1,p_action:'accepted'});
 expect(accepted.p_result.items.find(item=>item.id===part.id)).toMatchObject({qty:1,hours:0,note:'Установлена при диагностике'});
 await clean(page,errors);
});

test('M12: a manual result records parts under their work without a trip',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope',standaloneWorkPlan:'parts'});
 const panel=page.locator('#orderTripResults');
 await panel.getByRole('button',{name:'Отчитаться о работах'}).click();
 const parts=dialog(page).locator('.order-manual-parts');
 await expect(parts.locator('[data-result-qty]')).toBeHidden();
 await parts.locator('summary').click();
 const partId=await parts.locator('[data-result-item]').getAttribute('data-result-item');
 await parts.getByRole('spinbutton',{name:'Использовано всего'}).fill('1');
 await dialog(page).locator('#orderResultSave').click();
 await expect(dialog(page)).toHaveCount(0);
 const [write]=await page.evaluate(()=>window.__visualQA.entityWrites);
 expect(write.args.p_items).toContainEqual({id:partId,done_qty:1,result_note:''});
 await panel.locator('[data-visit-expand]').first().click();
 const result=panel.locator('.order-trip-work-fields .order-trip-materials');
 await result.locator('summary').click();
 await expect(result.locator('tbody tr td').nth(1)).toHaveText('1');
 await clean(page,errors);
});

test('M13: the curator adds an extra part to a draft and corrects the accepted cost',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'extras'});
 const panel=page.locator('#orderTripResults'),expand=panel.locator('[data-visit-expand]').first(),parts=panel.locator('.order-trip-parts');
 const qty=parts.getByRole('textbox',{name:'Факт использования: Кольцо'});
 await expand.click();
 await panel.locator('.order-trip-complete').click();
 await parts.locator(':scope > summary').click();
 await parts.getByRole('button',{name:'Добавить запчасть'}).click();
 const entry=page.getByRole('dialog',{name:'Добавить запчасть'});
 await entry.getByLabel('Название').fill('Кольцо');
 await entry.getByLabel('Использовано').fill('2');
 await entry.getByLabel('Цена за единицу, грн').fill('12,75');
 await shot(page,info,'trip-result-extra-part-entry');
 await entry.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(qty).toHaveValue('2');
 await expect(panel.locator('[data-extra-part] td').first()).toHaveText('0');
 await page.reload();
 await expand.click();
 await parts.locator(':scope > summary').click();
 await expect(qty).toHaveValue('2');
 await qty.fill('-2');
 await panel.locator('[data-visit-review]').click();
 await expect(panel.locator('[data-trip-result-error]')).toContainText('Проверьте расход запчасти «Кольцо»');
 await qty.fill('2');
 await panel.locator('[data-visit-review]').click();
 await expect(panel.locator('.order-trip-review')).toContainText('Кольцо · 2');
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Принято');
 await panel.getByRole('button',{name:'Исправить результат'}).click();
 await expand.click();
 await parts.locator(':scope > summary').click();
 await qty.fill('1');
 await panel.getByLabel('Причина исправления').fill('Уточнили расход');
 await panel.locator('[data-visit-review]').click();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Принято');
 const writes=await page.evaluate(()=>window.__visualQA.visitWrites);
 expect(writes.map(write=>write.p_result.extra_parts[0].qty)).toEqual([2,1]);
 expect(writes[0].p_result.extra_parts[0]).toMatchObject({title:'Кольцо',unit:'шт.',unit_cost:12.75});
 await clean(page,errors);
});

test('M14: a work photo survives reload and stays available from its accepted version',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'photos'});
 const panel=page.locator('#orderTripResults'),expand=panel.locator('[data-visit-expand]').first();
 const photoName='Результат.jpg',otherName='Лишнее.jpg';
 const photo=()=>panel.getByRole('button',{name:photoName,exact:true});
 await expand.click();
 await panel.locator('.order-trip-complete').click();
 const pixels=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffcc00';ctx.fillRect(0,0,4,4);
  return canvas.toDataURL('image/png').split(',')[1];
 });
 await panel.getByLabel('Фото результата').setInputFiles([photoName,otherName].map(name=>({name,mimeType:'image/png',buffer:Buffer.from(pixels,'base64')})));
 await expect(photo()).toBeVisible();
 await panel.getByRole('button',{name:'Убрать фото «'+otherName+'»'}).click();
 await expect(panel.getByRole('button',{name:otherName,exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__visualQA.workPhotoUploads)).toEqual([]);
 await page.reload();
 await expand.click();
 await expect(photo()).toBeVisible();
 await photo().click();
 const viewer=page.getByRole('dialog',{name:photoName});
 await expect.poll(()=>viewer.getByRole('img').evaluate(img=>img.naturalWidth)).toBe(4);
 await viewer.getByRole('button',{name:'Закрыть'}).click();
 await panel.locator('[data-visit-review]').click();
 await expect(photo()).toBeVisible();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel.locator('[data-trip-result-error]')).toContainText('Временная ошибка сохранения');
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Принято');
 await expand.click();
 await photo().click();
 await expect.poll(()=>viewer.getByRole('img').evaluate(img=>img.naturalWidth)).toBe(4);
 await shot(page,info,'accepted-work-photo');
 await viewer.getByRole('button',{name:'Закрыть'}).click();
 const result=await page.evaluate(()=>({writes:window.__visualQA.visitWrites,uploads:window.__visualQA.workPhotoUploads,downloads:window.__visualQA.workPhotoDownloads,attempts:window.__visualQA.workPhotoAttempts}));
 const [metadata]=result.writes[0].p_result.photos;
 expect(result.writes[0].p_result.photos).toHaveLength(1);
 expect(metadata).toMatchObject({name:photoName});
 const path=[order,trip,metadata.work_id,metadata.id+'.jpg'].join('/');
 expect(result.uploads).toMatchObject([{path,type:'image/jpeg'}]);
 expect(result.downloads).toEqual([path]);
 expect(result.attempts).toEqual([result.writes[0].p_operation,result.writes[0].p_operation]);
 await panel.getByRole('button',{name:'Исправить результат'}).click();
 if(await expand.getAttribute('aria-expanded')!=='true')await expand.click();
 await panel.getByRole('button',{name:'Убрать фото «'+photoName+'»'}).click();
 await panel.getByLabel('Причина исправления').fill('Убрано лишнее фото из новой версии');
 await panel.locator('[data-visit-review]').click();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Версии результата · 2');
 const history=panel.locator('.order-trip-versions');await history.locator(':scope > summary').click();
 await history.getByText('Версия 1 · 2 чел·ч',{exact:true}).click();
 await history.getByRole('button',{name:photoName,exact:true}).click();
 await expect.poll(()=>viewer.getByRole('img').evaluate(img=>img.naturalWidth)).toBe(4);
 await viewer.getByRole('button',{name:'Закрыть'}).click();
 await clean(page,errors);
});

for(const stage of ['in_progress','paused'])test('M11: the curator saves the work norm and records a manual result without a trip · '+stage,async({page},info)=>{
 const errors=await boot(page,info,{stage,route:'order/'+order+'/scope',standaloneWorkPlan:true});
 const panel=page.locator('#orderTripResults');
 await expect(panel.locator('[data-visit-select]')).toHaveCount(0);
 await panel.locator('[data-visit-expand]').first().click();
 const group=panel.locator('[data-work-plan]').first();
 await group.getByRole('textbox',{name:'План, н-ч'}).fill('7,5');
 await group.getByRole('button',{name:'Сохранить план'}).click();
 await expect(group.getByRole('status')).toHaveText('План сохранён');
 await panel.getByRole('button',{name:'Отчитаться о работах'}).click();
 const row=dialog(page).locator('[data-result-item]').first();
 await row.locator('[data-result-qty]').fill('3');
 await row.locator('[data-result-note]').fill('Осталась проверка');
 await dialog(page).locator('#orderResultSave').click();
 await expect(dialog(page)).toHaveCount(0);
 const writes=await page.evaluate(()=>window.__visualQA.entityWrites);
 expect(writes).toMatchObject([{name:'service_order_record_result',args:{p_id:order,p_expected:1}}]);
 await expect(panel.locator('[data-visit-note]').first()).toHaveText('Осталась проверка');
 await panel.locator('[data-visit-expand]').first().click();
 await expect(group.getByRole('textbox',{name:'План, н-ч'})).toHaveValue('7,5');
 await shot(page,info,'work-plan-without-trip-'+stage);
 await clean(page,errors);
});

test('M10: the curator accepts a trip report and corrects it with version history',async({page},info)=>{
 const errors=await boot(page,info,{stage:'in_progress',route:'order/'+order+'/scope/'+trip,tripResultJourney:'manager'});
 const panel=page.locator('#orderTripResults'),line=panel.locator('[data-visit-line]').first();
 await expect(panel).toContainText('На приёмке');
 await panel.locator('[data-visit-review]').click();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Версии результата · 1');
 await panel.locator('[data-visit-edit]').click();
 await panel.locator('[data-visit-expand]').first().click();
 await line.locator('[data-visit-field=qty]').fill('4');
 await panel.locator('[data-visit-review]').click();
 await expect(panel.locator('[role=alert]')).toContainText('Укажите причину исправления');
 await panel.locator('[data-visit-key=correction]').fill('Уточнили по акту');
 await panel.locator('[data-visit-review]').click();
 await panel.locator('[data-visit-commit]').click();
 await expect(panel).toContainText('Версии результата · 2');
 await panel.locator('.order-trip-versions > summary').click();
 await expect(panel.locator('.order-trip-versions > details')).toHaveCount(2);
 await shot(page,info,'trip-result-accepted');
 const [accepted,corrected]=await page.evaluate(()=>window.__visualQA.visitWrites);
 expect(accepted).toMatchObject({p_action:'accepted',p_order:order,p_trip:trip,p_order_revision:0});
 expect(corrected).toMatchObject({p_action:'accepted',p_expected_event:accepted.p_operation,p_order_revision:1,
  p_result:{correction:'Уточнили по акту'}});
 expect(corrected.p_result.items[0]).toMatchObject({qty:4,hours:2});
 await panel.locator('[data-visit-select]').selectOption('');
 await expect(panel.getByRole('table',{name:'Работы задания',exact:true}).locator('tfoot .order-trip-number').last()).toHaveText('2');
 await panel.locator('[data-visit-expand]').first().click();
 await panel.locator('[data-trip-receipt]').first().click();
 await expect(panel.locator('[data-visit-select]')).toHaveValue(trip);
 await clean(page,errors);
});
