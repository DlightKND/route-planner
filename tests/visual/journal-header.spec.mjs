import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
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
  await auditApplicationDesign(page);await shot(page,info,'02-'+type);if(type==='actions'){await panel.getByRole('button',{name:'О GPS-журнале',exact:true}).click();await expect(panel.locator('.qbody')).toBeVisible();await page.keyboard.press('Escape');await expect(panel.locator('.qbody')).toBeHidden();await expect(panel).toBeVisible();}await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await trigger.click();await expect(panel).toBeVisible();await trigger.click();await expect(panel).toBeHidden();
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

test('journal header stop filters fit long labels and back arrows stay visible at every level',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T17:00Z'));await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,unifiedJournalJourney:true,preserveRanges:true});
 await page.goto('/#/journal/trip/'+fixtureIDs.trip);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.presence-stop')).toHaveCount(5);await page.evaluate(()=>document.fonts.ready);
 const back=page.locator('.journal-trip-head>[data-ut-back]');await expect(back).toBeVisible();await expect(back).toHaveAccessibleName('К журналу');await expect(back).toHaveAttribute('data-ui','icon');await expect(back).toHaveAttribute('data-ui-variant','secondary');await shot(page,info,'06-trip-back');
 const filter=page.locator('.presence-stop-filters>summary');await expect(filter).toHaveAttribute('data-ui','icon');
 const target=info.project.use.hasTouch?48:44;const geometry=await filter.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {w:r.width,h:r.height,border:s.borderTopWidth};});expect(geometry).toEqual({w:target,h:target,border:'1px'});
 await filter.click();const panel=page.locator('.journal-stop-filter-body');await expect(panel).toBeVisible();expect(await panel.evaluate(el=>el.matches(':popover-open'))).toBe(true);
 const bounds=await panel.boundingBox(),anchor=await filter.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(16);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width-16);expect(bounds.y+bounds.height<=anchor.y-8||bounds.y>=anchor.y+anchor.height+8).toBe(true);
 const rows=await panel.locator('[data-review-mode]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const t=range.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,textLeft:t.left,textRight:t.right,scroll:el.scrollWidth,client:el.clientWidth};}));
 for(let i=0;i<rows.length;i++){const row=rows[i];expect(row.scroll).toBeLessThanOrEqual(row.client);expect(row.textLeft).toBeGreaterThanOrEqual(row.left+10);expect(row.textRight).toBeLessThanOrEqual(row.right-10);if(i)expect(row.top).toBeGreaterThanOrEqual(rows[i-1].bottom);}
 await auditApplicationDesign(page);await shot(page,info,'07-stop-filters');
 await panel.locator('[data-review-mode=done]').click();await expect(page.locator('.presence-stop')).toHaveCount(2);await panel.locator('[data-review-mode=pending]').click();await expect(page.locator('.presence-stop')).toHaveCount(3);await panel.locator('[data-review-mode=all]').click();await expect(page.locator('.presence-stop')).toHaveCount(5);
 await panel.getByRole('searchbox').fill('нет такого объекта');await expect(page.locator('.presence-stop')).toHaveCount(0);await panel.getByRole('searchbox').fill('');await expect(page.locator('.presence-stop')).toHaveCount(5);
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(filter).toBeFocused();await filter.click();await expect(panel).toBeVisible();await filter.click();await expect(panel).toBeHidden();
 await page.locator('[data-review-stop="journal-stay-3"]').click();const stopBack=page.locator('.presence-review-back');await expect(stopBack).toHaveAccessibleName('К поездке');await expect(stopBack).toHaveAttribute('data-ui','icon');await shot(page,info,'08-stop-back');await stopBack.click();await back.click();
 const exit=page.locator('.journal-page-head>[data-journal-exit]');await expect(exit).toBeVisible();await expect(exit).toHaveAccessibleName('К выездам');await expect(page.locator('.journal-actions [data-journal-exit]')).toHaveCount(0);await shot(page,info,'09-queue-back');await exit.click();await expect(page.locator('#tripBoard')).toBeVisible();expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});

async function checkMenu(page,details){
 const trigger=details.locator(':scope>summary'),panel=details.locator(':scope>.anchored-context-panel');
 await trigger.click();await expect(panel).toBeVisible();expect(await panel.evaluate(el=>el.matches(':popover-open'))).toBe(true);
 const box=await panel.boundingBox(),size=page.viewportSize(),rail=size.width<=760?(await page.locator('.rail').boundingBox()).height:0;
 expect(box.width).toBeGreaterThanOrEqual(280);expect(box.x).toBeGreaterThanOrEqual(16);expect(box.x+box.width).toBeLessThanOrEqual(size.width-16);expect(box.y).toBeGreaterThanOrEqual(16);expect(box.y+box.height).toBeLessThanOrEqual(size.height-rail-16);
 let bottom=box.y;
 for(const button of await panel.locator(':scope>button:visible').all()){
  await expect(button).toHaveAttribute('data-ui','menu');const r=await button.boundingBox();expect(r.y).toBeGreaterThanOrEqual(bottom);bottom=r.y+r.height;
  expect(await button.evaluate(el=>{const r=el.getBoundingClientRect(),text=document.createRange();text.selectNodeContents(el);const t=text.getBoundingClientRect();return el.scrollWidth<=el.clientWidth&&t.left>=r.left&&t.right<=r.right&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 }
 await auditApplicationDesign(page);return {trigger,panel};
}
test('journal header linked trip sections and stop actions render full vertical menus',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.setFixedTime(new Date('2026-10-05T17:00Z'));await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,unifiedJournalJourney:true,preserveRanges:true});await page.goto('/#/journal/trip/'+fixtureIDs.trip);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.presence-stop')).toHaveCount(5);await page.evaluate(()=>document.fonts.ready);
 const menu=page.locator('.journal-trip-menu');
 for(const pane of ['route','documents','stops']){const {panel}=await checkMenu(page,menu);if(pane==='route')await shot(page,info,'10-trip-sections');await panel.locator('[data-journal-pane='+pane+']').click();await expect(panel).toBeHidden();await expect(page).toHaveURL(new RegExp(pane==='stops'?'/trip/'+fixtureIDs.trip+'$':'/'+pane+'$'));}
 await page.locator('[data-review-stop="journal-stay-3"]').click();const stopMenu=page.locator('.journal-stop-actions'),{trigger,panel}=await checkMenu(page,stopMenu);await shot(page,info,'11-stop-actions');await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await trigger.click();await panel.locator('[data-review-draft]').click();await expect(panel).toBeHidden();await expect(page.locator('.journal-decision-state')).toContainText('Черновик сохранён');
 const colors=await page.locator('.rail .nav-i.active').evaluate(el=>({marker:getComputedStyle(el,'::before').backgroundColor,ink:getComputedStyle(el).color,tab:getComputedStyle(document.querySelector('.subtab.active[data-ui=tab]')).borderBottomColor,focus:document.documentElement.style.getPropertyValue('--focus')}));expect(colors.marker).toBe(colors.tab);if(info.project.metadata.theme==='light')expect(colors.marker).toBe('rgb(48, 43, 37)');else expect(colors.marker).toBe('rgb(255, 225, 0)');
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('journal header GPS source uses the same unclipped section menu',async({page},info)=>{
 const errors=await boot(page,info);await page.locator('[data-ut-details]').first().click();await expect(page.locator('.gps-detail-head')).toBeVisible();const menu=page.locator('.gps-detail-head>.journal-trip-menu');
 for(const pane of ['route','documents','stops']){const {panel}=await checkMenu(page,menu);if(pane==='route')await shot(page,info,'12-source-sections');await panel.locator('[data-orphan-pane='+pane+']').click();await expect(panel).toBeHidden();}
 const {trigger,panel}=await checkMenu(page,menu);await trigger.click();await expect(panel).toBeHidden();await trigger.click();await expect(panel).toBeVisible();await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
