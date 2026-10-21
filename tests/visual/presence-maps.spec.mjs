import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
for(const role of ['logist','engineer'])test(role+' sees and opens a presence location without modifying the stay',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T17:00Z'));await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme});await page.goto('/#/trip/'+fixtureIDs.trip);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.locator('#tpReviewPresence').click();await page.locator('[data-review-stop]').first().click();const preview=page.locator('.presence-review-map');await expect(preview.locator('.leaflet-container')).toBeVisible();await expect(preview.locator('.gps-track-point')).toHaveCount(1);
 if(role==='engineer')await expect(page.locator('[data-presence-save],[data-review-edit]')).toHaveCount(0);await info.attach('presence-location-'+role,{body:await page.screenshot(),contentType:'image/png'});
 await page.locator('[data-presence-route]').click();await expect(page.locator('.journal-route-quality')).toBeVisible();await expect(page).toHaveURL(new RegExp('/journal/trip/'+fixtureIDs.trip+'/route$'));
 const state=await page.evaluate(()=>window.__visualQA);expect(state.blockedWrites).toEqual([]);expect(state.reads.filter(n=>['rpc:trip_presence_save_tasks','rpc:trip_track_rebuild_save','rpc:stay_attach'].includes(n))).toEqual([]);expect(errors).toEqual([]);
});
