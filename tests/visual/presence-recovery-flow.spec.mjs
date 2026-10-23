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
 await page.locator('#tpReviewPresence').click();
 await page.locator('[data-journal-pane=route]').click();await expect(page.locator('.journal-track-preview')).toBeVisible();await expect(page.locator('.journal-route-map path[stroke="#3c7954"]')).toHaveCount(1);expect(orsCalls).toBe(0);await page.locator('[data-route-rebuild]').click();await expect(page.locator('.journal-trip-message')).toContainText('Трек проверен');await page.locator('[data-journal-pane=stops]').click();if(await page.locator('[data-review-stop]').first().isVisible())await page.locator('[data-review-stop]').first().click();await page.locator('[data-presence-kind=visit]').click();const row=page.locator('.journal-trip-stops [data-presence-id]');await expect(row).toHaveCount(1);
 await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('180');expect(await row.locator('[data-presence="minutes_mgr"]').evaluate(e=>e.readOnly)).toBe(true);
 expect(orsCalls).toBe(1);
 const firstSave=await page.evaluate(()=>window.__visualQA.recoveryWrites.find(w=>w.name==='trip_track_rebuild_save').args);
 expect(firstSave.p_fact_source).toBe('track');
 expect(firstSave.p_fact_km).toBe(Math.round(firstSave.p_track.km*10)/10);
 expect(firstSave.p_fact_km).toBeGreaterThan(100);

 await expect(page.locator('.journal-person-total')).toContainText('3 ч');
 const extra=row.locator('[data-recovery-part]');await expect(extra).toHaveValue('0');
 await extra.fill('181');await expect(page.locator('#wbPresenceSave')).toBeDisabled();
 await expect(page.locator('.presence-review-validation')).not.toBeEmpty();
 expect(await page.evaluate(()=>window.__visualQA.recoveryWrites.filter(w=>w.name==='trip_presence_save_tasks').length)).toBe(0);
 await extra.fill('60');await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('240');
 await expect(page.locator('#wbPresenceSave')).toBeEnabled();
 await page.locator('#wbPresenceSave').scrollIntoViewIfNeeded();
 await info.attach('presence-review-workspace',{body:await page.screenshot(),contentType:'image/png'});
 await page.locator('#wbPresenceSave').click();await expect(page.locator('.journal-trip-message')).toContainText('Решение сохранено');await expect(page.locator('.journal-saved-decision')).toContainText('4');
 await page.locator('[data-presence-route]').click();await page.locator('[data-route-rebuild]').click();await expect(page.locator('.journal-trip-message')).toContainText('Трек проверен');await page.locator('[data-journal-pane=stops]').click();if(await page.locator('[data-review-stop]').first().isVisible())await page.locator('[data-review-stop]').first().click();await expect(row.locator('[data-presence="minutes_mgr"]')).toHaveValue('240');await expect(row.locator('[data-presence="status"]')).toHaveValue('approved');
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
 await page.locator('#tpReviewPresence').click();
 if(await page.locator('[data-review-stop]').first().isVisible())await page.locator('[data-review-stop]').first().click();await expect(page.locator('.journal-presence-evidence')).toContainText('3 ч');await expect(page.locator('[data-presence-save],[data-review-edit],[data-presence-edit]')).toHaveCount(0);
 const state=await page.evaluate(()=>window.__visualQA);expect(state.recoveryWrites).toEqual([]);expect(state.blockedWrites).toEqual([]);expect(state.queryErrors).toEqual([]);expect(errors).toEqual([]);
});

test('routing outage preserves the visible reviewed road and performs no save',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const url=r.request().url();if(url.includes('/functions/v1/ors'))return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Routing maintenance'}})});return new URL(url).origin==='http://127.0.0.1:4173'?r.continue():r.abort();});
 await page.clock.setFixedTime(new Date('2026-10-05T17:00Z'));await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,presenceRecoveryJourney:true,unifiedJournalJourney:true});
 await page.goto('/#/journal/trip/'+fixtureIDs.trip+'/route');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();const road=page.locator('.journal-trip-route .journal-route-map path[stroke="#d87619"]');await expect(road).toHaveCount(1);const geometry=await road.getAttribute('d');await page.locator('[data-route-rebuild]').click();await expect(page.locator('.journal-trip-message')).toContainText('Не удалось проверить трек');await expect(road).toHaveAttribute('d',geometry);await expect(page.locator('[data-route-rebuild]')).toBeEnabled();expect(await page.evaluate(()=>window.__visualQA.recoveryWrites)).toEqual([]);expect(errors).toEqual([]);
});

test('journal and trip-card recalculation persist identical reconstructed geometry',async({page},info)=>{
 let calls=0;await page.route('**/*',async route=>{const url=route.request().url();if(url.includes('/functions/v1/ors')){calls++;const {body}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{properties:{summary:{duration:10800,distance:120000}},geometry:{type:'LineString',coordinates:body.coordinates}}]})});}return new URL(url).origin==='http://127.0.0.1:4173'?route.continue():route.abort();});
 await page.clock.setFixedTime(new Date('2026-10-05T17:00Z'));await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,presenceRecoveryJourney:true});await page.goto('/#/journal/trip/'+fixtureIDs.trip+'/route');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.journal-track-preview')).toBeVisible();await page.locator('[data-route-rebuild]').click();await expect(page.locator('.journal-trip-message')).toContainText('Трек проверен');
 const first=await page.evaluate(()=>window.__visualQA.recoveryWrites.find(w=>w.name==='trip_track_rebuild_save').args);expect(first.p_track.roadKm).toBeGreaterThan(0);
 await page.evaluate(id=>location.hash='#/trip/'+id,fixtureIDs.trip);await expect(page.locator('.view-trip.active')).toBeVisible();await page.locator('.wb-route-more>summary').click();await page.locator('#tpKmCalc').click();await page.locator('#confirmYes').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.recoveryWrites.filter(w=>w.name==='trip_track_rebuild_save').length)).toBe(2);
 const second=await page.evaluate(()=>window.__visualQA.recoveryWrites.filter(w=>w.name==='trip_track_rebuild_save').at(-1).args);expect(second.p_track.segments).toEqual(first.p_track.segments);expect(second.p_fact_km).toBe(first.p_fact_km);
 await expect(page.locator('#busyOverlay')).toBeHidden();await page.locator('#tpReviewPresence').click();await page.locator('[data-journal-pane=route]').click();await expect(page.locator('.journal-track-preview')).toHaveCount(0);await expect(page.locator('.journal-trip-route .journal-route-map path[stroke="#d87619"][stroke-dasharray="7 6"]')).toHaveCount(1);expect(calls).toBe(2);await info.attach('journal-rebuilt-orange-road',{body:await page.screenshot(),contentType:'image/png'});
});
