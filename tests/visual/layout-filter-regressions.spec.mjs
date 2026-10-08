import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
async function open(page,info,route,unassignedJourney=false){
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,unassignedJourney});
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

test('list spacing matches the journal and dispatcher trash controls are reachable',async({page},info)=>{
 await open(page,info,'planner/jobs',true);
 await page.locator('#jobTrash').click();await expect(page.locator('#trashOverlay')).toBeVisible();await expect(page.locator('#trashTitle')).toHaveText('Корзина заявок');await page.locator('#trashClose').click();
 await page.locator('.planner-filter-menu:visible summary').click();await page.locator('#jobLayout').selectOption('list');
 const listGap=await page.locator('#jobList').evaluate(el=>parseFloat(getComputedStyle(el).gap));expect(listGap).toBe(12);
 await page.goto('/#/planner/orders');await page.locator('.order-board-options summary').click();await expect(page.locator('#orderViewMode')).toBeVisible();await page.locator('#orderViewMode').selectOption('list');await expect(page.locator('#orderList')).toHaveClass('klist');
 await page.locator('#orderTrash').click();await expect(page.locator('#trashOverlay')).toBeVisible();await expect(page.locator('#trashTabs')).toContainText('Выезды');await page.locator('#trashClose').click();
 await page.goto('/#/planner/trips/tracking');await expect(page.locator('.unassigned-list')).toBeVisible();
 expect(await page.locator('.unassigned-list').evaluate(el=>parseFloat(getComputedStyle(el).gap))).toBe(listGap);
 await page.locator('#tripTrash').click();await expect(page.locator('#trashTitle')).toHaveText('Корзина выездов');await page.locator('#trashClose').click();
 expect(await page.locator('.view-planner .pane').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:'test-results/list-consistency/'+info.project.name+'.png'});
});


test('dispatcher search geometry matches across requests, tasks and trips',async({page},info)=>{
 await open(page,info,'planner/jobs');
 const dimensions=[];
 for(const [route,id] of [['jobs','jobSearch'],['orders','orderSearch'],['trips','tripSearch']]){
  await page.goto('/#/planner/'+route);await expect(page.locator('#'+id)).toBeVisible();
  const toolbar=page.locator('#'+id).locator('xpath=ancestor::*[contains(@class,"dispatcher-toolbar")]');
  const box=await page.locator('#'+id).boundingBox();dimensions.push(box);
  const parent=await toolbar.boundingBox();expect(Math.abs(box.x-parent.x)).toBeLessThanOrEqual(1);
  const controls=await toolbar.locator('.dispatcher-actions').boundingBox();expect(controls.x).toBeGreaterThanOrEqual(box.x);
  expect(await toolbar.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:'test-results/search-alignment/'+info.project.name+'-'+route+'.png'});
 }
 for(const box of dimensions.slice(1)){expect(Math.abs(box.x-dimensions[0].x)).toBeLessThanOrEqual(1);expect(Math.abs(box.y-dimensions[0].y)).toBeLessThanOrEqual(1);expect(Math.abs(box.width-dimensions[0].width)).toBeLessThanOrEqual(1);expect(Math.abs(box.height-dimensions[0].height)).toBeLessThanOrEqual(1);}
 if(page.viewportSize().width>760)expect(dimensions[0].width).toBe(420);
});


test('dispatcher actions keep stable mobile slots and task status chips control both views',async({page},info)=>{
 await open(page,info,'planner/jobs',true);
 const layouts=[];
 for(const [route,prefix] of [['jobs','job'],['orders','order'],['trips','trip']]){
  await page.goto('/#/planner/'+route);
  const actions=page.locator('#'+prefix+'Search').locator('xpath=ancestor::*[contains(@class,"dispatcher-toolbar")]').locator('.dispatcher-actions');
  await expect(actions).toBeVisible();
  if(page.viewportSize().width<=760){const empty=page.locator('#'+prefix+'List .kcol').filter({has:page.locator('.kempty')}).first();if(await empty.count())expect((await empty.boundingBox()).height).toBeLessThan(150);}
  const boxes=await Promise.all([actions.locator('summary'),page.locator('#'+prefix+'Trash'),page.locator('#'+prefix+'Add')].map(el=>el.boundingBox()));
  for(const b of boxes){expect(b.height).toBeGreaterThanOrEqual(page.viewportSize().width<=760?44:36);expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(page.viewportSize().width);expect(Math.abs(b.y+b.height/2-boxes[0].y-boxes[0].height/2)).toBeLessThanOrEqual(1);}
  if(page.viewportSize().width<=760){layouts.push(boxes);for(let i=1;i<boxes.length;i++)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x+boxes[i-1].width);}
  await actions.locator('summary').click();await expect(actions.locator('.planner-filter-panel')).toBeVisible();
  const panel=await actions.locator('.planner-filter-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.keyboard.press('Escape');
  await page.screenshot({path:'test-results/mobile-dispatcher/'+info.project.name+'-'+route+'.png'});
 }
 for(const row of layouts.slice(1))for(let i=0;i<row.length;i++){expect(row[i].x).toBeCloseTo(layouts[0][i].x,0);expect(row[i].width).toBeCloseTo(layouts[0][i].width,0);expect(row[i].y).toBeCloseTo(layouts[0][i].y,0);}
 const tripTrash=await page.locator('#tripTrash').boundingBox();await page.locator('[data-trip-section=tracking]').click();await expect(page.locator('.unassigned-list')).toBeVisible();
 if(page.viewportSize().width<=760)expect((await page.locator('#tripTrash').boundingBox()).x).toBeCloseTo(tripTrash.x,0);
 await expect(page.locator('#tripJournalRefresh')).toBeVisible();await page.locator('#tripJournalRefresh').click();await expect(page.locator('.unassigned-card')).toBeVisible();
 await page.screenshot({path:'test-results/mobile-dispatcher/'+info.project.name+'-journal.png'});
 await page.goto('/#/planner/orders');await expect(page.locator('#orderStatusChips [data-os]')).toHaveCount(7);
 await page.locator('[data-os=assigned]').click();await expect(page.locator('#orderList [data-kst=assigned]')).toHaveCount(0);await expect(page.locator('[data-os=assigned]')).toHaveAttribute('aria-pressed','false');
 await page.locator('[data-os=completed]').click();await expect(page.locator('#orderList [data-kst=completed]')).toHaveCount(1);
 await page.locator('.order-board-options summary').click();await page.locator('#orderViewMode').selectOption('list');await page.keyboard.press('Escape');
 await expect(page.locator('#orderList')).toHaveClass('klist');
 for(const status of ['draft','in_progress','paused','review','completed'])await page.locator('[data-os='+status+']').click();
 await expect(page.locator('#orderList .kcard')).toHaveCount(0);await expect(page.locator('#orderList')).toContainText('По выбранным условиям');
 expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
