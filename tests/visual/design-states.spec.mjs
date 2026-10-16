import {test,expect} from '@playwright/test';
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
test('design state: presence evidence and decision stay separate',async({page},info)=>{
 const errors=await start(page,info,'trip/'+fixtureIDs.trip);await page.locator('[data-trip-tab=presence]').click();
 await page.locator('#tpPresence [data-presence-edit]').first().click();const dialog=page.locator('dialog.presence-editor');await expect(dialog).toBeVisible();
 await expect(dialog.locator('.presence-evidence-panel')).toBeVisible();await expect(dialog.locator('.presence-decision-panel')).toBeVisible();
 await expect(dialog.locator('[data-presence-id]')).toHaveCount(1);await capture(page,info,'presence-review',errors);
});
test('design state: GPS resolution separates the operation, parameters and saved facts',async({page},info)=>{
 const errors=await start(page,info,'planner/tracking',{role:'admin',unassignedJourney:true});
 await page.getByRole('button',{name:'Создать цепочку',exact:true}).click();const overlay=page.locator('#promptOverlay');
 await expect(overlay.locator('.gps-resolution-workspace')).toBeVisible();await expect(overlay.locator('[data-gps-choice]')).toHaveCount(3);
 await overlay.locator('[data-pf=title]').fill('Черновик названия');await capture(page,info,'gps-resolution',errors);
 await overlay.locator('[data-gps-choice=charge]').click();await expect(overlay.locator('[data-pf=km]')).toBeVisible();await expect(overlay.locator('.gps-resolution-summary')).toContainText('12,5');
 await overlay.locator('[data-gps-choice=chain]').click();await expect(overlay.locator('[data-pf=title]')).toHaveValue('Черновик названия');
 await overlay.locator('#promptNo').click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();await expect(overlay).toBeHidden();expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('design state: request estimate keeps the agreed scope separate from execution',async({page},info)=>{
 const errors=await start(page,info,'job/'+fixtureIDs.job);await page.locator('#jobTabEstimate').click();
 await expect(page.locator('.request-estimate-base')).toBeVisible();await expect(page.locator('#jbWorks')).toBeVisible();await expect(page.locator('#jbParts')).toBeVisible();
 await capture(page,info,'request-estimate',errors);await page.locator('[data-estimate-tasks]').click();await expect(page.locator('#jobOverviewPane')).toBeVisible();
});
test('design state: new assignment keeps editable organization and scope together',async({page},info)=>{
 const errors=await start(page,info,'planner/orders');await page.locator('#orderAdd').click();
 await expect(page.locator('#orderTitle')).toBeVisible();await expect(page.locator('#orderComposition')).toBeVisible();await expect(page.locator('#orderSave')).toBeVisible();
 await capture(page,info,'assignment-create',errors);
});
