import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

test('manager rebuilds the track, edits only the GPS gap and keeps approval on repeat',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let orsCalls=0;
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).origin==='http://127.0.0.1:4173')return route.continue();
  if(route.request().url()==='https://anqfbljgfimoaziztdxe.supabase.co/functions/v1/ors'){
   orsCalls++;const {body}=route.request().postDataJSON();
   return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{properties:{summary:{duration:10800,distance:120000}},geometry:{type:'LineString',coordinates:body.coordinates}}]})});
  }
  return route.abort();
 });
 await page.clock.setFixedTime(new Date('2026-10-05T17:00:00Z'));
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,presenceRecoveryJourney:true});
 await page.goto('/#/trip/'+fixtureIDs.trip);
 await expect(page.locator('.view-trip.active')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.locator('[data-trip-tab="presence"]').click();
 await expect(page.locator('#wbDetect')).toBeVisible();
 await page.locator('#wbDetect').click();
 const row=page.locator('#tpPresence [data-presence-id]');await expect(row).toHaveCount(1);
 await expect(row).toContainText('180 мин');
 await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('360');
 expect(await row.locator('[data-presence="minutes_mgr"]').evaluate(e=>e.readOnly)).toBe(true);
 expect(orsCalls).toBe(1);
 await row.locator('[data-presence-edit]').click();
 const dialog=page.locator('dialog.presence-editor');await expect(dialog).toBeVisible();
 const extra=dialog.locator('[data-recovery-part]');await expect(extra).toHaveValue('180');
 await extra.fill('0');await expect(dialog.locator('[data-presence="minutes_mgr"]')).toHaveValue('180');
 await extra.fill('181');await dialog.locator('[data-presence-submit]').click();
 await expect(dialog.locator('.presence-error')).not.toBeEmpty();
 expect(await page.evaluate(()=>window.__visualQA.recoveryWrites.filter(w=>w.name==='trip_presence_save_tasks').length)).toBe(0);
 await extra.fill('60');await expect(dialog.locator('[data-presence="minutes_mgr"]')).toHaveValue('240');
 const rect=await dialog.boundingBox(),vp=page.viewportSize();expect(rect.x).toBeGreaterThanOrEqual(-1);expect(rect.x+rect.width).toBeLessThanOrEqual(vp.width+1);expect(rect.y).toBeGreaterThanOrEqual(-1);expect(rect.y+rect.height).toBeLessThanOrEqual(vp.height+1);
 await info.attach('presence-recovery-editor',{body:await page.screenshot(),contentType:'image/png'});
 await dialog.locator('[data-presence-submit]').click();await expect(dialog).toHaveCount(0);
 await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('240');
 await expect(page.locator('.trip-time-metrics')).toContainText('4 ч');
 await expect(page.locator('#busy')).not.toHaveClass(/on/);
 await page.locator('#wbDetect').click();
 await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('240');
 await expect(row.locator('[data-presence="status"]')).toHaveValue('approved');
 await info.attach('presence-recovery-summary',{body:await page.screenshot(),contentType:'image/png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const state=await page.evaluate(()=>window.__visualQA);expect(state.blockedWrites).toEqual([]);expect(state.queryErrors).toEqual([]);expect(errors).toEqual([]);
});

test('engineer sees GPS and proposed presence without review controls',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.continue():route.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T17:00:00Z'));
 await page.addInitScript(installMockBackend,{role:'engineer',theme:info.project.metadata.theme,presenceRecoveryJourney:true});
 await page.goto('/#/trip/'+fixtureIDs.trip);await expect(page.locator('.view-trip.active')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.locator('[data-trip-tab="presence"]').click();
 await expect(page.locator('#tpPresence')).toContainText('По GPS: 180 мин');
 await expect(page.locator('#tpPresence')).toContainText('Предложено после потери навигации: 180 мин');
 await expect(page.locator('#tpPresence input,#tpPresence select,#wbDetect,[data-presence-edit]')).toHaveCount(0);
 const state=await page.evaluate(()=>window.__visualQA);expect(state.recoveryWrites).toEqual([]);expect(state.blockedWrites).toEqual([]);expect(state.queryErrors).toEqual([]);expect(errors).toEqual([]);
});
