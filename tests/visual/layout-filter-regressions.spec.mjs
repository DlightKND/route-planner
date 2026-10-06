import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
async function open(page,info,route){
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme});
 await page.goto('/#/'+route);await expect(page.locator('.view.active')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.evaluate(()=>document.fonts.ready);
}
test('dashboard hides redundant desktop switch and dates fit',async({page},info)=>{
 await open(page,info,'dash');await expect(page.locator('#attnBody .vg-feed')).toBeVisible();
 if(page.viewportSize().width>1180)await expect(page.locator('#dashSeg')).toBeHidden();else await expect(page.locator('#dashSeg')).toBeVisible();
 for(const input of await page.locator('.view-dash .rangebar input:visible').all()){
  const sizing=await input.evaluate(el=>{const s=getComputedStyle(el),c=document.createElement('canvas').getContext('2d');c.font=s.font;return {available:el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),required:c.measureText('30.12.2026').width+28,font:parseFloat(s.fontSize)};});
  expect(sizing.font).toBeLessThanOrEqual(14);expect(sizing.available).toBeGreaterThanOrEqual(sizing.required);
 }
 expect(await page.locator('.view-dash .pane').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:'test-results/layout-fixes/'+info.project.name+'-dashboard.png'});
});
test('notifications align with the common pane edges',async({page},info)=>{
 await open(page,info,'notifications');await expect(page.locator('.notice-header')).toBeVisible();
 const edges=await page.locator('#noticeHost').evaluate(el=>{const p=el.parentElement,s=getComputedStyle(p),r=el.getBoundingClientRect(),pr=p.getBoundingClientRect();return {left:r.left-pr.left-parseFloat(s.paddingLeft),right:pr.right-r.right-parseFloat(s.paddingRight)};});
 expect(Math.abs(edges.left)).toBeLessThanOrEqual(1);expect(Math.abs(edges.right)).toBeLessThanOrEqual(1);
 await page.screenshot({path:'test-results/layout-fixes/'+info.project.name+'-notifications.png'});
});
test('dispatcher filters preserve kanban and explicitly selected list',async({page},info)=>{
 await open(page,info,'planner/jobs');await expect(page.locator('#jobList .kcard').first()).toBeVisible();
 await expect(page.locator('#jobList')).toHaveClass('kanban');
 await page.locator('[data-js=done]').click();await expect(page.locator('#jobList')).toHaveClass('kanban');
 await page.locator('.planner-filter-menu:visible summary').click();await page.locator('#jobLayout').selectOption('list');await expect(page.locator('#jobList')).toHaveClass('klist');
 await page.keyboard.press('Escape');await page.locator('[data-js=cancelled]').click();await expect(page.locator('#jobList')).toHaveClass('klist');
 await page.goto('/#/planner/trips');await expect(page.locator('#tripList .kcard').first()).toBeVisible();await expect(page.locator('#tripList')).toHaveClass('kanban');
 await page.locator('[data-ts=done]').click();await expect(page.locator('#tripList')).toHaveClass('kanban');
 await page.goto('/#/planner/orders');await expect(page.locator('#orderList .kcard').first()).toBeVisible();await expect(page.locator('#orderList')).toHaveClass('kanban');
 await page.locator('.order-board-options summary').click();await page.locator('#orderClosed').check();await expect(page.locator('#orderList')).toHaveClass('kanban');
 await page.locator('#orderViewMode').selectOption('list');await expect(page.locator('#orderList')).toHaveClass('klist');
 await page.locator('#orderClosed').uncheck();await expect(page.locator('#orderList')).toHaveClass('klist');
});
