import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend} from './mock-backend.mjs';
import {clickDispatcherControl} from './dispatcher-controls.mjs';
import {auditApplicationDesign} from './application-design-audit.mjs';
async function boot(page,info,route='journal'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));await page.addInitScript(installMockBackend,{role:'admin',theme:info.project.metadata.theme,unassignedJourney:true,unassignedCount:3,preserveRanges:true});
 await page.goto('/#/'+route);await expect(page.locator('#appRoot')).toBeVisible();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await page.evaluate(()=>document.fonts.ready);return errors;
}
async function shot(page,info,name){const dir='test-results/journal-header/'+info.project.name;mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});}
test('journal header uses the shared dates, spaced pills and unclipped native panels',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('.unassigned-card')).toHaveCount(3);
 await expect(page.locator('#tripJournalPeriod .summary-period-range')).toBeVisible();await expect(page.locator('#tripJournalPeriod .journal-periodbar')).toHaveCount(0);
 const gap=await page.evaluate(()=>{const head=document.querySelector('.journal-page-head').getBoundingClientRect(),pill=document.querySelector('.unassigned-filter>button').getBoundingClientRect();return pill.top-head.bottom;});expect(gap).toBeGreaterThanOrEqual(15);
 await shot(page,info,'01-queue');
 for(const type of ['actions','filters']){
  const details=page.locator('.journal-'+type),trigger=details.locator(':scope>summary'),panel=details.locator(':scope>.anchored-context-panel');await trigger.click();await expect(panel).toBeVisible();expect(await panel.evaluate(el=>el.matches(':popover-open'))).toBe(true);
  const r=await panel.boundingBox(),size=page.viewportSize();expect(r.x).toBeGreaterThanOrEqual(16);expect(r.x+r.width).toBeLessThanOrEqual(size.width-16);const rail=size.width<=760?(await page.locator('.rail').boundingBox()).height:0;expect(r.y+r.height).toBeLessThanOrEqual(size.height-rail-16);
  for(const button of await panel.locator('button:visible').all()){const b=await button.boundingBox();expect(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);expect(b.x+b.width).toBeLessThanOrEqual(r.x+r.width);}
  await auditApplicationDesign(page);await shot(page,info,'02-'+type);await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await trigger.click();await expect(panel).toBeVisible();await trigger.click();await expect(panel).toBeHidden();
 }
 await page.locator('#tripJournalPeriod [data-summary-dates]').click();await expect(page.locator('#promptOverlay')).toBeVisible();await expect(page.locator('#promptTitle')).toHaveText('Период GPS-журнала');await shot(page,info,'03-dates');await page.locator('#promptNo').click();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('journal header enters its full layout before a delayed data response',async({page},info)=>{
 const errors=await boot(page,info,'planner/trips');await expect(page.locator('#tripList .kcard').first()).toBeVisible();
 await page.evaluate(()=>{const db=window.supabase.createClient(),from=db.from.bind(db);const gate=new Promise(resolve=>window.__releaseJournalRead=resolve);db.from=name=>{const query=from(name);if(name==='unassigned_tracks'){const range=query.range.bind(query);query.range=(...args)=>{window.__journalReadPending=true;const value=range(...args);return gate.then(()=>value);};}return query;};});
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect.poll(()=>page.evaluate(()=>!!window.__journalReadPending)).toBe(true);
 let initial;
 try{await expect(page.locator('.view-planner')).toHaveClass(/journal-open/);await expect(page.locator('.journal-page-head')).toBeVisible();await expect(page.locator('#plTrips>.workspace-dispatcher-head')).toBeHidden();initial=await page.locator('#unassignedHost').boundingBox();await shot(page,info,'04-pending-shell');}
 finally{await page.evaluate(()=>window.__releaseJournalRead?.());}
 await expect(page.locator('.unassigned-card')).toHaveCount(3);const loaded=await page.locator('#unassignedHost').boundingBox();expect(loaded).toEqual(initial);await shot(page,info,'05-loaded-shell');expect(errors).toEqual([]);
});
