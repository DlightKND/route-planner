import {test,expect} from '@playwright/test';
import {clickDispatcherControl} from './dispatcher-controls.mjs';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
async function start(page,info,route,options={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,entityAudit:true,...options});
 await page.goto('/#/'+route);await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.evaluate(()=>document.fonts.ready);return errors;
}
async function capture(page,info,name,errors){
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 mkdirSync('test-results/design-states/'+info.project.name,{recursive:true});
 await page.screenshot({path:'test-results/design-states/'+info.project.name+'/'+name+'.png',animations:'disabled'});
}
test('design state: assignment timeline and explicit independent composer',async({page},info)=>{
 const errors=await start(page,info,'order/'+fixtureIDs.activeOrder);await page.locator('#orderTab-history').click();
 const activity=page.locator('#orderActivity');await expect(activity.locator('.activity-entry')).toHaveCount(7);
 await expect(activity.getByRole('heading',{name:'Лента и доказательства'})).toBeVisible();await expect(activity.locator('textarea')).toBeHidden();
 await capture(page,info,'assignment-timeline',errors);
 await activity.locator('[data-activity-filter=result]').click();await expect(activity.locator('.is-result')).toHaveCount(1);await expect(activity.locator('.is-comment')).toHaveCount(0);
 await activity.locator('[data-activity-open-result]').click();await expect(page.locator('#orderPane-scope')).toBeVisible();
 await page.locator('#orderTab-history').click();await activity.locator('[data-activity-compose]').click();await activity.locator('textarea').fill('Черновик комментария');
 await page.locator('#orderTab-travel').click();await page.locator('#orderTab-history').click();await expect(activity.locator('textarea')).toHaveValue('Черновик комментария');
 expect(await page.evaluate(()=>window.__visualQA.entityWrites)).toEqual([]);
});
test('design state: assignment travel and crew-aware trip selection',async({page},info)=>{
 const errors=await start(page,info,'order/'+fixtureIDs.activeOrder,{designTripChoices:true});await page.locator('#orderTab-travel').click();
 await expect(page.locator('.order-travel-head')).toBeVisible();await expect(page.locator('#orderTrips .order-trip-identity')).toBeVisible();
 await capture(page,info,'assignment-travel',errors);await page.locator('#orderTripExisting').click();
 const dialog=page.locator('dialog.entity-trip-picker-dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('.trip-choice-card')).toHaveCount(2);
 await capture(page,info,'trip-selection',errors);await dialog.locator('[data-trip-choice-crew]').check();await expect(dialog.locator('.trip-choice-card')).toHaveCount(1);
 expect(await page.evaluate(()=>window.__visualQA.entityWrites)).toEqual([]);
});
test('design state: result draft remains distinct from saved data and review',async({page},info)=>{
 const errors=await start(page,info,'order/'+fixtureIDs.activeOrder);await page.locator('#orderRecordResult').click();
 const dialog=page.locator('dialog.entity-result-dialog');await expect(dialog.locator('#orderResultSavedState')).toContainText('Сохранённый результат');
 await dialog.locator('[data-result-qty]').first().fill('3');await expect(dialog.locator('#orderResultSubmitReview')).toBeDisabled();
 await expect(dialog.locator('#orderResultSavedState')).toContainText('несохранённые');await expect(dialog.locator('[data-result-projection]').first()).toContainText('3 ч');
 await capture(page,info,'result-editor-draft',errors);await dialog.locator('#orderResultLater').click();await page.locator('#confirmNo').click();await expect(dialog.locator('[data-result-qty]').first()).toHaveValue('3');
});
test('design state: curator review explains both remaining work and active travel',async({page},info)=>{
 const errors=await start(page,info,'order/'+fixtureIDs.activeOrder,{reviewOrder:true});await page.locator('[data-open-result-review]').click();
 const dialog=page.locator('dialog.entity-review-dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('[data-review-accept]')).toBeDisabled();
 await expect(dialog.locator('.review-blockers')).toContainText('Выезд не завершён');await expect(dialog.locator('.review-blockers')).toContainText('количественный остаток');
 await capture(page,info,'result-review-blocked',errors);
});
test('design state: schedule trip workspace exposes time parts and direct navigation',async({page},info)=>{
 const errors=await start(page,info,'dash',{lateScheduleCut:true});
 const block=page.locator('.vg-group[data-gb="t'+fixtureIDs.trip+'"]').first();await block.locator('[data-gtools]').click();
 const panel=page.locator('.gpop-workspace');await expect(panel).toBeVisible();await expect(panel.locator('.gp-days')).toBeVisible();
 await expect(panel.locator('[data-pop-map]')).toBeVisible();await expect(panel.locator('[data-pop-open]')).toBeVisible();
 expect(await panel.locator('.gp-layout').evaluate(el=>el.open)).toBe(true);await capture(page,info,'schedule-trip-workspace',errors);
});
test('design state: summary shares its header period and opens real quick actions',async({page},info)=>{
 const errors=await start(page,info,'dash',{preserveRanges:true});const period=page.locator('#summaryPeriod');
 await expect(period).toBeVisible();await expect(page.locator('.view-dash .rangebar')).toHaveCount(0);
 await expect(page.locator('#attnBody .summary-quick-actions')).toBeVisible();
 const fill=await page.locator('.summary-action-row').evaluate(el=>({outer:el.clientWidth,card:el.firstElementChild.getBoundingClientRect().width}));expect(Math.abs(fill.outer-fill.card)).toBeLessThanOrEqual(2);
 await capture(page,info,'summary-header-actions',errors);
 await period.locator('[data-summary-preset=week]').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 11.10.2026');
 await capture(page,info,'summary-period-week',errors);
 await period.locator('[data-summary-shift="1"]').focus();await page.keyboard.press('Enter');await expect(period.locator('[data-summary-dates]')).toContainText('12.10 — 18.10.2026');await expect(period.locator('[data-summary-shift="1"]')).toBeFocused();
 await period.locator('[data-summary-dates]').click();await page.locator('[data-pf=from]').fill('2026-09-01');await page.locator('[data-pf=to]').fill('2026-09-30');await page.locator('#promptYes').click();
 await expect(period.locator('[data-summary-preset=month]')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dl_range_summary')))).toEqual({from:'2026-09-01',to:'2026-09-30'});
 await expect(page.locator('#attnBody .wkrow[data-wk="2026-41"]')).toHaveCount(0);
 if(page.viewportSize().width<=1180)await page.locator('#dashSeg [data-dv=cards]').click();
 await expect(page.locator('#dashBody .summary-controls')).toBeVisible();await expect(page.locator('#dashBody .finance-scope-summary')).toContainText('подтверждено 1 из 1');await expect(period.locator('[data-summary-dates]')).toContainText('01.09 — 30.09.2026');
 if(page.viewportSize().width<=1180)await page.locator('#dashSeg [data-dv=feed]').click();
 await page.locator('[data-summary-create=order]').click();await expect(page.locator('#orderTitle')).toBeVisible();await expect(page.locator('#orderSave')).toBeVisible();
 await page.goto('/#/dash');await expect(period.locator('[data-summary-dates]')).toContainText('01.09 — 30.09.2026');await expect(page.locator('[data-summary-create=trip]')).toBeVisible();await page.locator('[data-summary-create=trip]').click();await expect(page.locator('#tpFrom')).toBeVisible();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
for(const role of ['engineer','admin'])test('design state: shared period respects '+role+' access',async({page},info)=>{
 const errors=await start(page,info,'dash',{role});const engineer=role==='engineer',period=page.locator(engineer?'#minePeriod':'#summaryPeriod');
 await expect(period).toBeVisible();await expect(period.locator('[data-summary-dates]')).toBeVisible();
 await period.locator('[data-summary-preset=week]').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 11.10.2026');
 if(engineer){
  await expect(page.locator('.view-planner')).toHaveClass(/active/);await expect(page.locator('#mineList .vg-feed')).toBeVisible();
  await expect(page.locator('#mineList .rangebar')).toHaveCount(0);await expect(page.locator('#mineList .wk-pct,#mineList .wk-mini')).toHaveCount(0);
  await expect(page.locator('#dashBody')).toBeHidden();await expect(page.locator('[data-summary-create]:visible')).toHaveCount(0);await expect(page.locator('#orderAdd')).toBeHidden();
 }else{
  await expect(page.locator('#attnBody [data-summary-create=order]')).toBeVisible();await expect(page.locator('#dashBody .summary-section')).toHaveCount(3);
 }
 const bounds=await period.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
 await capture(page,info,'period-role-'+role,errors);
});
test('design state: summary warning shares one row with quick actions',async({page},info)=>{
 const errors=await start(page,info,'dash',{summaryOrphans:true});const row=page.locator('.summary-action-row');
 await expect(row.locator('.planwarn')).toContainText('Заявки без действующего выезда');
 const [action,warning]=await row.locator(':scope>*').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 if(page.viewportSize().width>760){expect(action.right).toBeLessThan(warning.x);expect(action.y).toBe(warning.y);}else expect(action.bottom).toBeLessThan(warning.y);
 await capture(page,info,'summary-actions-warning',errors);
});
test('design state: schedule ellipsis leaves room for the stop action',async({page},info)=>{
 const errors=await start(page,info,'dash',{lateScheduleCut:true,runningSchedule:true});
 const group=page.locator('.vg-group.has-act[data-gb="t'+fixtureIDs.trip+'"]').first();await expect(group.locator('[data-gtools]')).toBeVisible();
 const lane=group.locator('..'),stop=lane.locator('.vg-block[data-gb="t'+fixtureIDs.trip+'"] [data-gact=finish]').first();
 if(await stop.isVisible()){const menu=await group.locator('[data-gtools]').boundingBox(),action=await stop.boundingBox();expect(menu.x+menu.width).toBeLessThanOrEqual(action.x);}else expect(await lane.evaluate(el=>el.clientWidth)).toBeLessThanOrEqual(131);
 await capture(page,info,'summary-schedule-stop',errors);await group.locator('[data-gtools]').click();await expect(page.locator('.gpop-workspace')).toBeVisible();
});
test('design state: presence evidence and decision stay separate',async({page},info)=>{
 const errors=await start(page,info,'trip/'+fixtureIDs.trip);await page.locator('#tpReviewPresence').click();
 const workspace=page.locator('.presence-review-workspace');await expect(workspace).toBeVisible();
 await expect(workspace.locator('.presence-review-sidebar')).toBeVisible();if(page.viewportSize().width<=1100){await expect(workspace.locator('.presence-review-detail')).toBeHidden();await capture(page,info,'presence-list',errors);await workspace.locator('[data-review-stop]').first().click();}await expect(workspace.locator('.presence-review-detail')).toBeVisible();
 await capture(page,info,'presence-review',errors);
});
test('design state: GPS resolution separates the operation, parameters and saved facts',async({page},info)=>{
 const errors=await start(page,info,'planner/tracking',{role:'admin',unassignedJourney:true});
 if(page.viewportSize().width<=1100)await page.locator('[data-ut-details]').first().click();if(await page.locator('[data-orphan-documents]').isVisible())await page.locator('[data-orphan-documents]').click();await page.getByRole('button',{name:'Создать документы',exact:true}).click();const overlay=page.locator('#promptOverlay');
 await expect(overlay.locator('.gps-resolution-workspace')).toBeVisible();await expect(overlay.locator('[data-gps-choice]')).toHaveCount(3);
 await overlay.locator('[data-pf=title]').fill('Черновик названия');await expect(overlay.locator('#promptYes')).toBeInViewport();await expect(overlay.locator('#promptNo')).toBeInViewport();await capture(page,info,'gps-resolution',errors);
 await overlay.locator('[data-gps-choice=charge]').click();await expect(overlay.locator('[data-pf=km]')).toBeVisible();await expect(overlay.locator('.gps-resolution-summary')).toContainText('12,5');
 await overlay.locator('[data-gps-choice=chain]').click();await expect(overlay.locator('[data-pf=title]')).toHaveValue('Черновик названия');
 await overlay.locator('#promptNo').click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();await expect(overlay).toBeHidden();expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('design state: request estimate keeps the agreed scope separate from execution',async({page},info)=>{
 const errors=await start(page,info,'job/'+fixtureIDs.job,{financeJourney:true});await page.locator('#jobTabEstimate').click();
 await expect(page.locator('.request-estimate-base')).toBeVisible();await expect(page.locator('#jbWorks')).toBeVisible();await expect(page.locator('#jbParts').locator('..')).toBeVisible();
 await capture(page,info,'request-estimate',errors);await page.locator('[data-estimate-tasks]').click();await expect(page.locator('#jobOverviewPane')).toBeVisible();
});
test('design state: new assignment keeps editable organization and scope together',async({page},info)=>{
 const errors=await start(page,info,'planner/orders');await page.locator('#orderAdd').click();
 await expect(page.locator('#orderTitle')).toBeVisible();await expect(page.locator('#orderComposition')).toBeVisible();await expect(page.locator('#orderSave')).toBeVisible();
 await capture(page,info,'assignment-create',errors);
});
test('design state: current decisions remain separate from incoming notifications',async({page},info)=>{
 const errors=await start(page,info,'notifications',{decisionQueue:true});const queue=page.locator('.notice-decisions');
 await expect(queue.locator('.notice-decision-card')).toHaveCount(2);await expect(queue).toContainText('Проверка результата');await expect(queue).toContainText('Проверка присутствия');
 await expect(page.locator('.notice-incoming .notice-toolbar')).toBeVisible();await capture(page,info,'notifications-decisions',errors);
 await queue.getByRole('link',{name:'Проверить результат',exact:true}).click();await expect(page.locator('[data-open-result-review]')).toBeVisible();expect(await page.evaluate(()=>window.__visualQA.entityWrites)).toEqual([]);
});
async function expandMapSheet(page){if(page.viewportSize().width<=760)await page.locator('#sideHandle').click();}
test('design state: map work and directory have one scope navigation and working filters',async({page},info)=>{
 const errors=await start(page,info,'map');await expandMapSheet(page);const side=page.locator('.map-workspace');
 await expect(side.locator('[data-map-heading]')).toHaveText('В работе');await expect(side.locator('#mapScope')).toBeHidden();await expect(side.locator('#workFeed .wf-row').first()).toBeVisible();
 await capture(page,info,'map-work',errors);await side.locator('#search').fill('Несуществующая точка 9999');await expect(side.locator('#workFeed .wf-row')).toHaveCount(0);await expect(side.locator('#workFeed')).toContainText('ничего не найдено');
 await side.locator('#search').fill('');await expect(side.locator('#workFeed .wf-row').first()).toBeVisible();await side.locator('[data-sb=directory]').click();
 await expect(side.locator('[data-map-heading]')).toHaveText('Справочник точек');await expect(side.locator('#list .pt').first()).toBeVisible();
 await side.locator('[data-tf=base]').click();await expect(side.locator('#list')).not.toContainText('Коммунальное предприятие');await side.locator('[data-tf=all]').click();
 await capture(page,info,'map-directory',errors);const expanded=(await side.boundingBox()).height;await side.locator('#listHead').click();await expect(side.locator('#pointsBox')).toBeHidden();await expect.poll(async()=>(await side.boundingBox()).height).toBeLessThan(expanded-20);await side.locator('[data-sb=route]').click();await expect(side.locator('#rBuild')).toBeInViewport();await side.locator('[data-sb=directory]').click();await expect(side.locator('#pointsBox')).toBeHidden();await side.locator('#listHead').click();await expect(side.locator('#pointsBox')).toBeVisible();
});
test('design state: map route keeps actions visible and independent from scrolling settings',async({page},info)=>{
 const errors=await start(page,info,'map');await expandMapSheet(page);await page.locator('[data-sb=route]').click();const side=page.locator('.map-workspace');
 await expect(side.locator('.map-route-scroll')).toBeVisible();await expect(side.locator('#rBuild')).toBeInViewport();await expect(side.locator('#rSaveTrip')).toBeInViewport();
 await capture(page,info,'map-route-empty',errors);await side.locator('#rWp').fill('Несохранённый адрес');await side.locator('.route-settings summary').click();
 await expect(side.locator('#chipOpt')).toBeDisabled();await side.locator('#rPref').selectOption('shortest');await side.locator('.map-route-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect(side.locator('#rBuild')).toBeInViewport();await side.locator('[data-sb=directory]').click();await side.locator('[data-sb=route]').click();await expect(side.locator('#rWp')).toHaveValue('Несохранённый адрес');
});
test('design state: map route preserves stop order controls and original client actions',async({page},info)=>{
 const errors=await start(page,info,'map');await expandMapSheet(page);await page.locator('[data-sb=directory]').click();
 const card=page.locator('#list .pt[data-cid=client-a]');await card.locator('.nm-t').click();await card.locator('[data-rt]').click();
 await expect(page.locator('[data-sb=route]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#rStops .route-pt')).toHaveCount(1);await expect(page.locator('#rStops [data-rrm]')).toBeVisible();
 await capture(page,info,'map-route-stops',errors);await page.locator('#rStops [data-rrm]').click();await expect(page.locator('#rStops .route-pt')).toHaveCount(0);await expect(page.locator('#rStops')).toContainText('Маршрут пока пуст');
 expect(await page.evaluate(()=>window.__visualQA.entityWrites)).toEqual([]);
});
test('design state: engineer map has no route editing or point creation',async({page},info)=>{
 const errors=await start(page,info,'map',{role:'engineer'});await expect(page.locator('[data-sb=route]')).toBeHidden();await expect(page.locator('#pointTools')).toBeHidden();
 await page.locator('[data-sb=directory]').click();await expect(page.locator('[data-map-heading]')).toHaveText('Справочник точек');await expect(page.locator('#list [data-edit]')).toHaveCount(0);await capture(page,info,'map-engineer-directory',errors);
});

test('layout: desktop rail stays left and page bottoms remain reachable in short windows',async({page},info)=>{
 await page.setViewportSize({width:page.viewportSize().width,height:600});
 const errors=await start(page,info,'planner/orders');
 const mobile=page.viewportSize().width<=760,rail=await page.locator('.rail').boundingBox();
 if(mobile){expect(rail.y+rail.height).toBeCloseTo(600,0);}else{
  expect(rail.x).toBe(0);expect(rail.y).toBe(0);expect(rail.width).toBe(76);expect(rail.height).toBe(600);
  expect((await page.locator('#appRoot').boundingBox()).x).toBe(76);
 }
 for(const [route,list] of [['orders','orderList'],['jobs','jobList'],['trips','tripList']]){
  await page.goto('/#/planner/'+route);await expect(page.locator('#'+list+' .kcard').first()).toBeVisible();
  await expect(page.locator('.workspace-heading-row .design-eyebrow')).toHaveCount(0);
  const pane=page.locator('.view-planner>.pane');await pane.evaluate(el=>el.scrollTop=el.scrollHeight);
  const bounds=await pane.boundingBox(),limit=mobile?(await page.locator('.rail').boundingBox()).y:600;
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(601);
  const bottom=await page.locator('#'+list+' .kcard:visible').evaluateAll(nodes=>Math.max(...nodes.map(el=>el.getBoundingClientRect().bottom)));
  expect(bottom,route+' last card clears the viewport and navigation').toBeLessThanOrEqual(limit-8);
  await capture(page,info,'bottom-'+route,errors);
 }
});

test('layout: map tabs use one straight indicator without an inset shadow',async({page},info)=>{
 const errors=await start(page,info,'map');await expandMapSheet(page);
 for(const mode of ['directory','route','work']){
  const target=mode==='work'?page.locator('#sideTabs button').first():page.locator('#sideTabs button[data-sb='+mode+']');
  await target.click();await target.focus();
  const style=await target.evaluate(el=>{const s=getComputedStyle(el);return {radius:s.borderRadius,shadow:s.boxShadow,line:parseFloat(s.borderBottomWidth)};});
  expect(style.radius).toBe('0px');expect(style.shadow).toBe('none');expect(style.line).toBe(3);
  await expect(page.locator('.map-workspace-head .design-eyebrow')).toHaveCount(0);
 }
 await capture(page,info,'map-straight-tabs',errors);
});

test('layout: summary schedule and statistics scroll independently below a fixed heading',async({page},info)=>{
 test.skip(page.viewportSize().width<=1180,'Narrow screens show one summary column at a time');
 await page.setViewportSize({width:page.viewportSize().width,height:600});
 const errors=await start(page,info,'dash',{lateScheduleCut:true});
 await expect(page.locator('#attnBody .vg-feed')).toBeVisible();await expect(page.locator('#dashBody .card').first()).toBeVisible();
 const heading=await page.locator('.view-dash .workspace-masthead').boundingBox();
 const columns=page.locator('.view-dash .dash-grid');
 // Long schedules and statistical reports must remain independent of one another.
 // Extend real rendered content to exercise overflow even with the small fixture.
 await columns.evaluate(grid=>{for(const col of grid.children){const spacer=document.createElement('div');spacer.style.height='1200px';spacer.textContent='Конец длинного отчёта';col.append(spacer);}});
 const schedule=page.locator('.dash-attn'),stats=page.locator('#dashBody');
 await schedule.hover();await page.mouse.wheel(0,350);await expect.poll(()=>schedule.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 expect(await stats.evaluate(el=>el.scrollTop)).toBe(0);
 const scheduleTop=await schedule.evaluate(el=>el.scrollTop);await stats.hover();await page.mouse.wheel(0,350);await expect.poll(()=>stats.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 expect(await schedule.evaluate(el=>el.scrollTop)).toBe(scheduleTop);
 expect((await page.locator('.view-dash .workspace-masthead').boundingBox()).y).toBe(heading.y);
 expect(await page.locator('.view-dash>.pane').evaluate(el=>el.scrollTop)).toBe(0);
 for(const col of [schedule,stats]){
  const r=await col.boundingBox();expect(r.y).toBeGreaterThanOrEqual(heading.y+heading.height);expect(r.y+r.height).toBeLessThanOrEqual(600);
 }
 await capture(page,info,'summary-independent-scroll',errors);
});

test('polish: wide workspaces use the available width and the rail indicator sits at the edge',async({page},info)=>{
 test.skip(page.viewportSize().width<1440,'Wide desktop composition');await page.setViewportSize({width:1920,height:1000});
 const errors=await start(page,info,'planner/orders');
 const heading=await page.locator('#plOrders .workspace-heading-row').boundingBox();expect(heading.x).toBe(108);expect(heading.x+heading.width).toBe(1888);
 const marker=await page.locator('.rail .nav-i.active').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el,'::before');return {edge:r.left+parseFloat(s.left),width:parseFloat(s.width)};});expect(marker.edge).toBe(0);expect(marker.width).toBe(4);
 await capture(page,info,'wide-dispatcher',errors);
 for(const route of ['catalog','job/'+fixtureIDs.job,'order/'+fixtureIDs.activeOrder,'trip/'+fixtureIDs.trip]){
  await page.goto('/#/'+route);const main=page.locator('.view-'+route.split('/')[0]+'.active .workspace-main');await expect(main).toBeVisible();
  await expect.poll(async()=>{const r=await main.boundingBox();return r&&{x:r.x,width:r.width};}).toEqual({x:76,width:1844});
 }
 const card=page.locator('#jobOrders .order-child').first();await page.goto('/#/job/'+fixtureIDs.job);await expect(card).toBeVisible();
 expect(await card.evaluate(el=>[...['Top','Right','Bottom','Left']].map(side=>getComputedStyle(el)['border'+side+'Width']))).toEqual(['1px','1px','1px','1px']);
 await capture(page,info,'wide-request',errors);
});

test('polish: settings advanced panels have padding and scrolled navigation stays flat',async({page},info)=>{
 const errors=await start(page,info,'settings',{role:'admin'});const details=page.locator('.settings-advanced').first();
 await details.locator('summary').click();await expect(page.locator('#stTrkKmh')).toBeVisible();
 expect(await details.evaluate(el=>{const s=getComputedStyle(el);return [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft];})).toEqual(['20px','20px','20px','20px']);
 const bounds=await details.boundingBox(),title=await details.locator('summary').boundingBox();expect(title.x-bounds.x).toBeGreaterThanOrEqual(20);
 await page.locator('.view-settings>.pane').evaluate(el=>el.scrollTop=500);
 const shadows=await page.evaluate(()=>[...document.querySelectorAll('.view-settings *,.rail *')].flatMap(el=>['', '::before','::after'].map(p=>getComputedStyle(el,p).boxShadow)).filter(v=>v!=='none'));
 expect(shadows).toEqual([]);await capture(page,info,'settings-flat-padding',errors);
});

test('polish: statistics cards stay separated and light schedule blocks use a light surface',async({page},info)=>{
 const errors=await start(page,info,'dash');await expect(page.locator('.vg-block').first()).toBeVisible();
 if(info.project.metadata.theme==='light')expect(await page.locator('.vg-block').first().evaluate(el=>{const sample=document.createElement('div');sample.style.background='var(--panel)';document.body.append(sample);const same=getComputedStyle(el).backgroundColor===getComputedStyle(sample).backgroundColor;sample.remove();return same;})).toBe(true);
 if(page.viewportSize().width<=1180)await page.locator('#dashSeg [data-dv=cards]').click();
 await expect(page.locator('#dashBody .summary-section')).toHaveCount(3);
 const gaps=await page.locator('#dashBody .summary-section').evaluateAll(cards=>cards.slice(1).map((el,i)=>el.getBoundingClientRect().top-cards[i].getBoundingClientRect().bottom));
 for(const gap of gaps)expect(gap).toBeGreaterThanOrEqual(24);await capture(page,info,'statistics-card-spacing',errors);
});

test('polish: native launch metadata uses the sampled yellow and valid padded icons',async({page},info)=>{
 await start(page,info,'map');const manifest=await (await page.request.get('/manifest.json')).json();expect(manifest.background_color).toBe('#ffed00');expect(manifest.theme_color).toBe('#ffed00');await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href','favicon.png');
 for(const icon of manifest.icons){expect(icon.src).toMatch(/^\.\/launch-icon-[a-f0-9]+-(192|512)\.png$/);const data=await (await page.request.get('/'+icon.src.replace(/^\.\//,''))).body();const size=Number(icon.sizes.split('x')[0]);expect(data.readUInt32BE(16)).toBe(size);expect(data.readUInt32BE(20)).toBe(size);expect(icon.purpose).toContain('maskable');}
});


test('kanban: status columns stay in one adaptive row and the last column remains reachable',async({page},info)=>{
 const errors=await start(page,info,'planner/orders');
 for(const [route,prefix,mode] of [['jobs','job','jobLayout'],['orders','order','orderViewMode'],['trips','trip','tripLayout']]){
  await page.goto('/#/planner/'+route);const board=page.locator('#'+prefix+'List');await expect(board).toHaveClass('kanban');
  const chips=page.locator('#'+prefix+'StatusChips button');await expect(chips.first()).toBeVisible();
  const count=await chips.count();for(let i=0;i<count;i++)if(await chips.nth(i).getAttribute('aria-pressed')==='false')await chips.nth(i).click();
  const columns=board.locator(':scope>.kcol');await expect(columns).toHaveCount(count);
  const rects=await columns.evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,width:r.width};}));
  expect(Math.max(...rects.map(r=>r.top))-Math.min(...rects.map(r=>r.top)),route+' has a single row').toBeLessThanOrEqual(1);
  expect(Math.max(...rects.map(r=>r.width))-Math.min(...rects.map(r=>r.width))).toBeLessThanOrEqual(1);
  expect(await board.evaluate(el=>el.scrollWidth>el.clientWidth),route+' scrolls horizontally instead of wrapping').toBe(true);
  await board.evaluate(el=>el.scrollLeft=el.scrollWidth);await expect(columns.last().locator('.kcol-h')).toBeInViewport();
  const right=await columns.last().boundingBox(),frame=await board.boundingBox();expect(right.x+right.width).toBeLessThanOrEqual(frame.x+frame.width+1);
  await capture(page,info,'kanban-'+route+'-last-column',errors);
  for(let i=2;i<count;i++)await chips.nth(i).click();await expect(columns).toHaveCount(2);
  if(await board.evaluate(el=>el.clientWidth>=540)){
   expect((await columns.first().boundingBox()).width).toBeGreaterThan(rects[0].width);
   expect(await board.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await clickDispatcherControl(page,'.view.active .planner-filter-menu:visible>summary');await page.locator('#'+mode).selectOption('list');await page.keyboard.press('Escape');await expect(board).toHaveClass('klist');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 }
});

async function openTrackPanel(page,info){
 const errors=await start(page,info,'trip/30000000-0000-4000-8000-000000000002/map',{mapTrackDesign:true});
 await expect(page.locator('.mleg')).toBeVisible();
 if(page.viewportSize().width>960)await page.locator('.mleg-details>summary').click();
 await expect(page.locator('.mleg-body')).toBeVisible();return errors;
}
test('map track: docked layer cards retain real visibility and the selected time window',async({page},info)=>{
 const errors=await openTrackPanel(page,info),inline=page.viewportSize().width<=960,panel=page.locator('.mleg-body');
 await expect(panel.locator('h2')).toHaveText('Параметры трека');await expect(panel.locator('.mleg-layer')).toHaveCount(6);
 expect(await panel.getAttribute('popover')).toBeNull();expect(await panel.evaluate(el=>getComputedStyle(el).position)).toBe('static');
 if(inline){await expect(page.locator('#trackBlock .mleg')).toBeVisible();await expect(page.locator('[data-sb=track]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#pointsBlock')).toBeHidden();const tops=await page.locator('#sideTabs button:visible').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().top));expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(1);}
 else{await expect(page.locator('#mapTrackDock .mleg')).toBeVisible();const card=await panel.boundingBox(),tools=await page.locator('.map-tools').boundingBox();expect(card.x+card.width).toBeCloseTo(tools.x+tools.width,0);expect(card.y).toBeGreaterThanOrEqual(tools.y+tools.height+8);}
 const gps=page.locator('.leaflet-overlay-pane path[stroke="#16a34a"],.leaflet-overlay-pane path[stroke="#a7f3d0"]');
 await expect(gps).toHaveCount(2);await panel.locator('[data-fl=track]').uncheck();await expect(gps).toHaveCount(0);await panel.locator('[data-fl=track]').check();await expect(gps).toHaveCount(2);
 const endDate=await panel.locator('#tfBDate').inputValue();await panel.locator('#tfBDate').fill(await panel.locator('#tfADate').inputValue());await panel.locator('#tfB').fill('09:00');await panel.locator('#tfB').blur();await expect(gps).toHaveCount(1);
 await panel.locator('#tfAll').click();await expect(panel.locator('#tfBDate')).toHaveValue(endDate);await expect(gps).toHaveCount(2);
 await expect(panel.locator('#tfDuration')).toContainText('сут.');
 expect(await panel.locator('.mleg-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await expect(panel.locator('.mleg-clear')).toBeInViewport();await capture(page,info,'map-track-parameters',errors);
 await panel.locator('.mleg-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await expect(panel.locator('[data-fl=stay]')).toBeInViewport();await capture(page,info,'map-track-layers',errors);
});
test('map track: resizing and closing preserve controls, and clearing leaves a valid map tab',async({page},info)=>{
 const errors=await openTrackPanel(page,info),panel=page.locator('.mleg-body');
 await panel.locator('[data-fl=line]').uncheck();await panel.locator('#tfA').fill('07:00');await panel.locator('#tfA').blur();
 const width=page.viewportSize().width>960?390:1440;await page.setViewportSize({width,height:600});
 await expect(page.locator('.mleg')).toHaveCount(1);await expect(panel).toBeVisible();await expect(panel.locator('[data-fl=line]')).not.toBeChecked();await expect(panel.locator('#tfA')).toHaveValue('07:00');
 await expect(panel.locator('.mleg-clear')).toBeInViewport();const box=await panel.boundingBox(),bottom=width<=760?(await page.locator('.rail').boundingBox()).y:600;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(bottom+1);
 await panel.locator('#tfA').focus();await page.keyboard.press('Escape');await expect(panel).toBeHidden();
 if(width<=960){await expect(page.locator('#sideTabs button.on')).not.toHaveAttribute('data-sb','track');await page.locator('[data-sb=track]').click();}
 else await page.locator('.mleg-details>summary').click();
 await expect(panel.locator('[data-fl=line]')).not.toBeChecked();await expect(panel.locator('#tfA')).toHaveValue('07:00');
 await panel.locator('.mleg-clear').click();await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmNo').click();await expect(panel).toBeVisible();await expect(panel.locator('[data-fl=line]')).not.toBeChecked();
 await panel.locator('.mleg-clear').click();await page.locator('#confirmYes').click();await expect(page.locator('.mleg')).toHaveCount(0);await expect(page.locator('[data-sb=track]')).toBeHidden();await expect(page.locator('#sideTabs button.on')).not.toHaveAttribute('data-sb','track');
 await capture(page,info,'map-track-cleared',errors);
});
