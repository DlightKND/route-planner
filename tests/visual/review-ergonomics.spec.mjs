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

for(const role of ['logist','engineer'])test(role+' uses the canonical stop screen and keeps the footer above the real navigation rail',async({page},info)=>{
 const errors=await open(page,info,'journal/trip/'+fixtureIDs.trip,{role,unifiedJournalJourney:true});await page.locator('[data-review-stop="journal-stay-3"]').click();
 await expect(page.locator('.presence-review-map [data-presence-route]')).toBeVisible();await shot(page,info,'presence-detail-'+role);
 if(role==='engineer')await expect(page.locator('[data-presence-save],[data-review-edit]')).toHaveCount(0);
 else{const scroll=page.locator('.presence-review-scroll');await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);if(page.viewportSize().width<=760){const floor=await page.locator('#nav.rail').evaluate(e=>e.getBoundingClientRect().top);for(const b of await page.locator('.presence-review-buttons>button:visible').all()){const bounds=await b.boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(floor+1);}}await shot(page,info,'presence-footer');}
 expect(await page.locator('.presence-review-detail').evaluate(e=>e.clientHeight)).toBeGreaterThan(300);await clean(page,errors);
});

test('GPS list detail and resolution form preserve context on mobile and desktop',async({page},info)=>{
  const errors=await open(page,info,'planner/tracking',{unassignedJourney:true,unassignedCount:14,preserveRanges:true}),mobile=page.viewportSize().width<=1100;
  await expect(page.locator('.unassigned-card')).toHaveCount(14);await shot(page,info,'gps-list');
  const last=page.locator('[data-ut-details]').last();await last.scrollIntoViewIfNeeded();await last.click();
  if(mobile){await expect(page.locator('[data-ut-back]')).toBeInViewport();if(page.viewportSize().width<=760)await expect(page.locator('#tripJournalPeriod')).toBeHidden();}
  await expect(page.locator('.journal-orphan-overview .leaflet-container')).toBeVisible();await expect(page.locator('.journal-orphan-overview .leaflet-tile-loaded').first()).toBeVisible();await shot(page,info,'gps-detail');
  if(await page.locator('[data-orphan-documents]').isVisible())await page.locator('[data-orphan-documents]').click();await page.getByRole('button',{name:'Создать документы',exact:true}).click();
  await expect(page.locator('#promptOverlay [data-pf=client]')).toBeInViewport();
  await expect(page.locator('#promptOverlay #promptYes')).toBeInViewport();await shot(page,info,'gps-resolution-start');
  await page.locator('[data-pf=title]').fill('Черновик визуальной проверки');
  await page.locator('[data-gps-choice=charge]').click();await expect(page.locator('[data-pf=km]')).toBeVisible();await shot(page,info,'gps-charge');
  await page.locator('[data-gps-choice=chain]').click();await expect(page.locator('[data-pf=title]')).toHaveValue('Черновик визуальной проверки');
  await page.locator('#promptNo').click();if(await page.locator('#confirmOverlay').isVisible())await page.locator('#confirmYes').click();
  if(mobile){await page.locator('[data-ut-back]').click();await expect(last).toBeInViewport();await expect(last).toBeFocused();}
  await shot(page,info,'gps-return-to-list');await clean(page,errors);
});
