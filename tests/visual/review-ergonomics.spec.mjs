import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

async function open(page,info,route,options={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(url.hostname.endsWith('tile.openstreetmap.org')||url.hostname==='api.maptiler.com')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e6e2d6"/><path d="M0 90 L256 180 M70 0 L180 256" stroke="#fff" stroke-width="12"/><path d="M0 90 L256 180 M70 0 L180 256" stroke="#cdbb88" stroke-width="2"/></svg>'});
    return url.origin==='http://127.0.0.1:4173'?r.continue():r.abort();
  });
  // Advance time normally so Leaflet's Date-based tile fade can finish.
  await page.clock.install({time:new Date('2026-10-05T17:00:00Z')});
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,...options});
  await page.goto('/#/'+route);
  if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
  await page.evaluate(()=>document.fonts.ready);
  return errors;
}
async function shot(page,info,name){
  mkdirSync('test-results/review-flows/'+info.project.name,{recursive:true});
  const tile=page.locator('.leaflet-tile-loaded').filter({visible:true}).first();if(await tile.count())await expect.poll(()=>tile.evaluate(el=>Number(getComputedStyle(el).opacity))).toBeGreaterThanOrEqual(.99);
  await page.screenshot({path:'test-results/review-flows/'+info.project.name+'/'+name+'.png',animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
}
async function clean(page,errors){
  expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
}

test('presence review keeps one map and crew control and makes the complete form reachable',async({page},info)=>{
  const errors=await open(page,info,'trip/'+fixtureIDs.trip),mobile=page.viewportSize().width<=760;
  await page.locator('[data-trip-tab=presence]').click();
  if(mobile){
    const controls=await page.locator('[data-review-mode]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
    expect(Math.max(...controls)-Math.min(...controls)).toBeLessThan(1);
    const value=page.locator('#tpPresence>.wb-metrics b').first();expect((await value.boundingBox()).height).toBeLessThan(26);
  }
  await expect(page.locator('.presence-stop .leaflet-tile-loaded').first()).toBeVisible();await shot(page,info,'presence-list');
  await page.locator('[data-review-stop]').first().click();
  if(mobile){await expect(page.locator('.presence-review-back')).toBeInViewport();await expect(page.locator('#tpPresence>.wb-metrics')).toBeHidden();}
  await expect(page.locator('.presence-review-map .leaflet-container')).toHaveCount(1);await expect(page.locator('.presence-review-map .leaflet-tile-loaded').first()).toBeVisible();
  const zoomIn=await page.locator('.presence-review-map .leaflet-control-zoom-in').boundingBox(),zoomOut=await page.locator('.presence-review-map .leaflet-control-zoom-out').boundingBox();expect(Math.abs(zoomIn.x-zoomOut.x)).toBeLessThan(1);expect(zoomOut.y).toBeGreaterThanOrEqual(zoomIn.y+zoomIn.height-1);
  await expect(page.locator('.presence-review-fields .presence-location')).toHaveCount(0);
  await expect(page.locator('.presence-review-fields .engineer-picker')).toHaveCount(0);
  await shot(page,info,'presence-detail');
  await page.locator('[data-presence-kind=road]').click();
  await expect(page.locator('#wbPresenceSave')).toBeEnabled();
  await expect(page.locator('[data-presence-id]:visible [data-presence=job_id]')).toBeHidden();
  await page.locator('#wbPresenceSave').scrollIntoViewIfNeeded();await shot(page,info,'presence-en-route');
  if(mobile)await page.locator('.presence-review-back').click();
  await page.locator('[data-review-mode=done]').click();if(mobile)await page.locator('[data-review-stop]').first().click();
  await page.locator('[data-review-edit]').click();
  const share=page.locator('[data-presence-id]:visible [data-task-allocation-share]').first();
  await share.scrollIntoViewIfNeeded();await expect(share).toHaveValue('100');expect((await share.boundingBox()).width).toBeGreaterThanOrEqual(76);
  await shot(page,info,'presence-team-and-share');
  const last=page.locator('.presence-review-buttons button:visible').last();await last.scrollIntoViewIfNeeded();
  const floor=mobile?await page.locator('.rail').evaluate(el=>el.getBoundingClientRect().top):page.viewportSize().height;
  for(const b of await page.locator('.presence-review-buttons button:visible').all()){
    const box=await b.boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(floor+1);
  }
  await shot(page,info,'presence-save-actions');await clean(page,errors);
});

test('presence reader uses the same mobile navigation without mutation controls',async({page},info)=>{
  const errors=await open(page,info,'trip/'+fixtureIDs.trip,{role:'engineer'});
  await page.locator('[data-trip-tab=presence]').click();await page.locator('[data-review-stop]').first().click();
  await expect(page.locator('#tpPresence [data-presence],#wbPresenceSave,[data-review-edit]')).toHaveCount(0);
  await expect(page.locator('.presence-kind')).toBeHidden();await expect(page.locator('.presence-review-map .leaflet-container')).toHaveCount(1);
  if(page.viewportSize().width<=760)await expect(page.locator('.presence-review-back')).toBeInViewport();
  await shot(page,info,'presence-reader');await clean(page,errors);
});

test('GPS list detail and resolution form preserve context on mobile and desktop',async({page},info)=>{
  const errors=await open(page,info,'planner/tracking',{unassignedJourney:true,unassignedCount:14,preserveRanges:true}),mobile=page.viewportSize().width<=760;
  await expect(page.locator('.unassigned-card')).toHaveCount(14);await shot(page,info,'gps-list');
  const last=page.locator('[data-ut-details]').last();await last.scrollIntoViewIfNeeded();await last.click();
  if(mobile){await expect(page.locator('[data-ut-back]')).toBeInViewport();await expect(page.locator('#tripJournalPeriod')).toBeHidden();}
  await expect(page.locator('.gps-journal-detail .leaflet-container')).toBeVisible();await expect(page.locator('.gps-journal-detail .leaflet-tile-loaded').first()).toBeVisible();await shot(page,info,'gps-detail');
  await page.getByRole('button',{name:'Создать документы',exact:true}).click();
  await expect(page.locator('#promptOverlay [data-pf=client]')).toBeInViewport();
  await expect(page.locator('#promptOverlay #promptYes')).toBeInViewport();await shot(page,info,'gps-resolution-start');
  await page.locator('[data-pf=title]').fill('Черновик визуальной проверки');
  await page.locator('[data-gps-choice=charge]').click();await expect(page.locator('[data-pf=km]')).toBeVisible();await shot(page,info,'gps-charge');
  await page.locator('[data-gps-choice=chain]').click();await expect(page.locator('[data-pf=title]')).toHaveValue('Черновик визуальной проверки');
  await page.locator('#promptNo').click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();
  if(mobile){await page.locator('[data-ut-back]').click();await expect(last).toBeInViewport();await expect(last).toBeFocused();}
  await shot(page,info,'gps-return-to-list');await clean(page,errors);
});
