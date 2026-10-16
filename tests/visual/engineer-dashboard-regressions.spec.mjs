import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
async function open(page,info,role,route){
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,preserveRanges:true});await page.goto('/#/'+route);
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
}
for(const route of ['dash','planner/mine'])test('engineer personal periods work on '+route,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,info,'engineer',route);
 const root=page.locator('#mineList'),period=page.locator('#minePeriod');await expect(root.locator('.vg-feed')).toBeVisible();await expect(period).toBeVisible();
 await expect(root.locator('.rangebar')).toHaveCount(0);await expect(root.locator('.wk-pct,.wk-mini,.loadbars')).toHaveCount(0);await expect(page.locator('#dashBody')).toBeHidden();await expect(page.locator('[data-summary-create]:visible')).toHaveCount(0);
 const otherPeriods=await page.evaluate(()=>{localStorage.setItem('dl_range_summary',JSON.stringify({from:'2026-09-01',to:'2026-09-30'}));return ['dl_range_summary','dl_range_journal'].map(k=>localStorage.getItem(k));});
 for(const [preset,last] of [['week','11.10.2026'],['fortnight','18.10.2026'],['month','03.11.2026']]){
  await period.locator('[data-summary-preset="'+preset+'"]').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — '+last);await expect(root.locator('.shim')).toHaveCount(0);
 }
 await period.locator('[data-summary-shift="1"]').focus();await page.keyboard.press('Enter');await expect(period.locator('[data-summary-dates]')).toContainText('04.11 — 03.12.2026');await expect(period.locator('[data-summary-shift="1"]')).toBeFocused();
 // Even a range without work keeps navigation and custom dates in the header.
 await period.locator('[data-summary-today]').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 03.11.2026');
 await period.locator('[data-summary-dates]').click();await page.locator('[data-pf=to]').fill('2026-10-12');await page.locator('#promptYes').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 12.10.2026');
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 12.10.2026');
 expect(await page.evaluate(()=>['dl_range_summary','dl_range_journal'].map(k=>localStorage.getItem(k)))).toEqual(otherPeriods);
 await page.locator('#mineDone').check();await expect(period.locator('[data-summary-dates]')).toContainText('05.10 — 12.10.2026');await page.locator('#mineDone').uncheck();
 await expect(root.locator('.wk-pct,.wk-mini,.loadbars')).toHaveCount(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
 await page.screenshot({path:'test-results/engineer-dashboard/'+info.project.name+'-'+route.replace('/','-')+'.png'});
});
test('manager summary retains team load',async({page},info)=>{
 await open(page,info,'logist','dash');await expect(page.locator('#attnBody .wk-pct').first()).toBeVisible();
});
