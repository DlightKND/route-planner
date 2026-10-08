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
 const root=page.locator('#mineList');await expect(root.locator('.vg-feed')).toBeVisible();
 await expect(root.locator('.wk-pct,.wk-mini,.loadbars')).toHaveCount(0);await expect(page.locator('#dashBody')).toBeHidden();
 for(const [days,last] of [[7,'2026-10-11'],[14,'2026-10-18'],[30,'2026-11-03']]){
  await root.locator('[data-rlen="'+days+'"]').click();await expect(root.locator('[data-rt]')).toHaveValue(last);await expect(root.locator('.shim')).toHaveCount(0);
 }
 await root.locator('[data-rshift="1"]').click();await expect(root.locator('[data-rf]')).toHaveValue('2026-11-04');
 // A period with no work must still expose controls for navigating back.
 await root.locator('[data-rnow]').click();await expect(root.locator('[data-rf]')).toHaveValue('2026-10-05');
 await root.locator('[data-rt]').fill('2026-10-12');await root.locator('[data-rt]').dispatchEvent('change');await expect(root.locator('[data-rt]')).toHaveValue('2026-10-12');
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(root.locator('[data-rt]')).toHaveValue('2026-10-12');
 await expect(root.locator('.wk-pct,.wk-mini,.loadbars')).toHaveCount(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
 await page.screenshot({path:'test-results/engineer-dashboard/'+info.project.name+'-'+route.replace('/','-')+'.png'});
});
test('manager summary retains team load',async({page},info)=>{
 await open(page,info,'logist','dash');await expect(page.locator('#attnBody .wk-pct').first()).toBeVisible();
});
