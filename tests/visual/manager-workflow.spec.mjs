import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
const job=fixtureIDs.job,order=fixtureIDs.order,trip=fixtureIDs.trip,other='00000000-0000-4000-8000-000000000003';
async function boot(page,info,{role='logist',stage='assigned',route='job/'+job,failAssignment=false,routeBuilder=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.install({time:new Date('2026-10-05T17:00Z')});await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,preserveRanges:true,managerJourney:{stage,failAssignment,routeBuilder}});await page.goto('/#/'+route);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.view.active')).toBeVisible();return errors;
}
async function navigate(page,view,hash){await page.evaluate(hash=>{location.hash=hash;},hash);await expect(page.locator('.view-'+view)).toHaveClass(/active/);}
async function reopenRequest(page){await navigate(page,'planner','/planner/jobs');await navigate(page,'job','/job/'+job);}
async function shot(page,info,name){const folder='test-results/manager-workflow/'+info.project.name;mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/'+name+'.png',animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
const dialog=page=>page.locator('dialog.entity-panel-dialog:visible').last();
async function cancelEditor(page){await dialog(page).locator('[data-entity-cancel]').click();await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmYes').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);}
async function keepOnlyOther(page,select){await page.locator(select+' + .engineer-picker').click();const choices=page.locator('.engineer-options');await expect(choices).toBeVisible();await choices.locator('input[type=checkbox]').first().uncheck();await choices.getByRole('button',{name:'Готово',exact:true}).click();}

test('M1 M2: request deadline, note, team and status have explicit save and real cancellation',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('#jobOverviewState')).toBeVisible();const initialDue=await page.locator('#jbDue').inputValue(),initialStatus=await page.locator('#jbStatus').inputValue(),initialVisit=await page.locator('#jbDate').inputValue(),initialCrew=await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value));
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await expect(page.locator('#jbDate')).toBeHidden();await expect(dialog(page)).toContainText('Задания и дорога планируются в графике.');await page.locator('#jbDue').fill('2026-10-12');await page.locator('#jbNotes').fill('Согласован новый срок');await page.waitForTimeout(900);expect(await page.evaluate(()=>window.__visualQA.financeWrites.length)).toBe(0);await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await reopenRequest(page);await expect(page.locator('#jbDue')).toHaveValue('2026-10-12');await expect(page.locator('#jbNotes')).toHaveValue('Согласован новый срок');
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await page.locator('#jbDue').fill('2026-10-20');await page.locator('#jbNotes').fill('Эта заметка отменена');await cancelEditor(page);await expect(page.locator('#jbDue')).toHaveValue('2026-10-12');await expect(page.locator('#jbNotes')).toHaveValue('Согласован новый срок');
 await page.locator('#requestEditContext').click();await page.locator('#jbStatus').selectOption('in_progress');await keepOnlyOther(page,'#jbEng');await cancelEditor(page);await expect(page.locator('#jbStatus')).toHaveValue(initialStatus);expect(await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value))).toEqual(initialCrew);
 await page.locator('#jobMore').click();await page.getByRole('button',{name:'Изменить срок и заметку',exact:true}).click();await page.locator('#jbNotes').fill('Последующая отдельная правка');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);const saved=await page.evaluate(()=>window.__visualQA.financeWrites.at(-1).args.p_rec);expect(saved).toMatchObject({due_date:'2026-10-12',notes:'Последующая отдельная правка',status:initialStatus,scheduled_date:initialVisit||null,engineer_ids:initialCrew});expect(initialDue).not.toBe('2026-10-12');
 await page.locator('#requestEditContext').click();await page.locator('#jbStatus').selectOption('in_progress');await keepOnlyOther(page,'#jbEng');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await reopenRequest(page);await expect(page.locator('#jbStatus')).toHaveValue('in_progress');expect(await page.locator('#jbEng').evaluate(e=>[...e.selectedOptions].map(o=>o.value))).toEqual([other]);await shot(page,info,'request-saved');await clean(page,errors);
});
for(const stage of ['draft','assigned','in_progress','paused','review'])test('M3 M6 M7: manager plans '+stage+' without changing SLA, trip crew or recorded work',async({page},info)=>{
 const errors=await boot(page,info,{stage,route:'order/'+order}),before=await page.evaluate(()=>window.__visualQA.managerState);await page.locator('[data-order-edit-dates]').click();await page.locator('#orderPlanTo').fill('2026-10-12');await page.locator('#orderPlanReason').fill('Согласован срок с заказчиком');await expect(dialog(page)).toContainText('SLA');await expect(dialog(page).locator('.planning-warnings')).toContainText('позже срока');await shot(page,info,'task-'+stage+'-planning');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);await expect(page.locator('.order-planning-summary')).toContainText('12.10.2026');
 await page.locator('[data-order-edit-crew]').click();await keepOnlyOther(page,'#orderPlanCrew');await page.locator('#orderPlanLead').selectOption(other);await page.locator('#orderPlanReason').fill('Передаём следующему инженеру');await dialog(page).locator('[data-entity-save]').click();await expect(page.locator('[data-entity-save]')).toHaveCount(0);const state=await page.evaluate(()=>window.__visualQA.managerState);expect(state.order).toMatchObject({status:stage,date_to:'2026-10-12',engineer_ids:[other],lead_engineer:other});expect(state.request).toEqual(before.request);expect(state.trip).toEqual(before.trip);expect(state.order.items).toEqual(before.order.items);await navigate(page,'planner','/planner/orders');await navigate(page,'order','/order/'+order);await expect(page.locator('.order-planning-summary')).toContainText('12.10.2026');await shot(page,info,'task-'+stage+'-saved');await clean(page,errors);
});

test('M4: cancelling handoff keeps the plan; saving precedes handoff and uses the fresh revision',async({page},info)=>{
 const errors=await boot(page,info,{route:'order/'+order});await page.locator('#orderTab-scope').click();await page.locator('.workspace-organization-editor>summary').click();await page.locator('#orderTo').fill('2026-10-12');await page.locator('#orderMore').click();await page.getByRole('button',{name:'Ответственность',exact:true}).click();await dialog(page).locator('select[name=person]').selectOption(other);await dialog(page).locator('input[name=reason]').fill('Новый ведущий куратор задания');await dialog(page).getByRole('button',{name:'Передать',exact:true}).click();await page.locator('[data-draft-choice=cancel]').click();expect(await page.evaluate(()=>window.__visualQA.managerWrites.length)).toBe(0);await expect(page.locator('#orderTo')).toHaveValue('2026-10-12');
 await dialog(page).getByRole('button',{name:'Передать',exact:true}).click();await page.locator('[data-draft-choice=save]').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_save_one','entity_responsibility_assign']);const writes=await page.evaluate(()=>window.__visualQA.managerWrites);expect(writes[1].args.p_expected).toBe(1);await page.locator('#orderTab-overview').click();await expect(page.locator('.order-planning-summary')).toContainText('12.10.2026');await shot(page,info,'responsibility-saved');await clean(page,errors);
});

test('M5: manager changes trip dates through plan save instead of sending a request',async({page},info)=>{
 const errors=await boot(page,info,{route:'trip/'+trip});await page.locator('#tripMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:/^(Изменить даты выезда|Запросить перенос)$/}).click();await expect(page.locator('#reschedOverlay')).toBeHidden();await page.locator('#tpFrom').fill('2026-10-12');await page.locator('#tpTo').fill('2026-10-13');await page.locator('#tpChangeReason').fill('Согласовали новые даты выезда');await page.locator('#tpSave').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.financeWrites.filter(w=>w.name==='trip_plan_save_tasks').length)).toBe(1);await expect(page.locator('#tpFrom')).toHaveValue('2026-10-12');const state=await page.evaluate(()=>window.__visualQA);expect(state.reads).not.toContain('rpc:trip_reschedule_request');expect(state.managerState.order.date_from).toBe('2026-10-05');expect(state.managerState.request.due_date).toBe('2026-10-09');await shot(page,info,'trip-dates-saved');await clean(page,errors);
});

test('M3 M5: engineer proposes a deadline and requests trip rescheduling without manager planning rights',async({page},info)=>{
 const errors=await boot(page,info,{role:'engineer',route:'order/'+order});await expect(page.locator('[data-order-edit-dates],[data-order-edit-crew]')).toHaveCount(0);await page.locator('[data-order-propose-date]').click();await page.locator('#orderDeadlineDate').fill('2026-10-12');await page.locator('#orderDeadlineReason').fill('Нужен дополнительный день');await page.locator('#orderDeadlineSend').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_deadline_propose']);await dialog(page).getByRole('button',{name:'Закрыть',exact:true}).click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();await navigate(page,'trip','/trip/'+trip);await page.locator('#tripMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:/^(Изменить даты выезда|Запросить перенос)$/}).click();await expect(page.locator('#reschedOverlay')).toBeVisible();await page.locator('#rsFrom').fill('2026-10-12');await page.locator('#rsTo').fill('2026-10-13');await page.locator('#rsReason').fill('Согласовать перенос');await page.locator('#rsSend').click();await expect(page.locator('#reschedOverlay')).toBeHidden();await expect(page.locator('#tpFrom')).toHaveValue('2026-10-05');expect(await page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_deadline_propose','trip_reschedule_request']);await clean(page,errors);
});


test('M4: a failed handoff reports the separately saved plan and keeps the latest version',async({page},info)=>{
 const errors=await boot(page,info,{route:'order/'+order,failAssignment:true});await page.locator('#orderTab-scope').click();await page.locator('.workspace-organization-editor>summary').click();await page.locator('#orderTo').fill('2026-10-12');await page.locator('#orderMore').click();await page.getByRole('button',{name:'Ответственность',exact:true}).click();await dialog(page).locator('select[name=person]').selectOption(other);await dialog(page).locator('input[name=reason]').fill('Передаём другому куратору');await dialog(page).getByRole('button',{name:'Передать',exact:true}).click();await page.locator('[data-draft-choice=save]').click();await expect(page.locator('#orderError')).toContainText('Изменения задания сохранены');expect(await page.evaluate(()=>window.__visualQA.managerWrites.map(w=>w.name))).toEqual(['service_order_save_one']);expect(await page.evaluate(()=>window.__visualQA.managerState.order)).toMatchObject({date_to:'2026-10-12',revision:1});await shot(page,info,'handoff-failed-plan-saved');await clean(page,errors);
});

test('M7: request tasks show their period and a new task shows the independent request SLA',async({page},info)=>{
 const errors=await boot(page,info);await page.locator('#jobTabTasks').click();await expect(page.locator('.order-child-period').first()).toContainText('05.10.2026');await page.locator('#jobOrders [data-order-new]').click();await expect(page.locator('.view-order')).toHaveClass(/active/);await expect(page.locator('.order-planning-summary')).toContainText('09.10.2026');await page.locator('#orderTo').fill('2026-10-14');await expect(page.locator('.order-planning-summary .planning-warnings')).toContainText('позже срока');expect(await page.evaluate(()=>window.__visualQA.managerWrites)).toEqual([]);await shot(page,info,'new-task-sla');await clean(page,errors);
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

 await page.locator('#orderRequest').click();
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
