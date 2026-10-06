import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
const trip=fixtureIDs.trip;
async function openGraph(page,info,{role='admin',legacy=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-06T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,legacyCrewMissing:legacy});
 await page.goto('/#/dash');await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(page.locator('.vg-feed')).toBeVisible();await expect(page.locator('.vg-block[data-gb="t'+trip+'"]').first()).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);return errors;
}
async function openDay(page){
 const week=page.locator('.vg-block[data-gb="t'+trip+'"]').first().locator('xpath=ancestor::*[@data-gtbox]');
 await week.locator('[data-gday="2026-10-05"]').click();
 await expect(week.locator('.vg-day-grid')).toBeVisible();return week;
}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
for(const role of ['admin','engineer'])test(role+' keeps legacy trip edges, road/work and the final full hour',async({page},info)=>{
 const errors=await openGraph(page,info,{role,legacy:true});
 const first=page.locator('.vg-block[data-gb="t'+trip+'"]').first();await expect(first).toHaveClass(/\btrip\b/);
 expect(await first.evaluate(el=>getComputedStyle(el).borderLeftColor)).toBe('rgb(255, 225, 0)');
 await expect(first.locator('.vg-week-road')).not.toHaveCount(0);
 const week=await openDay(page),pieces=week.locator('.vg-piece[data-gb="t'+trip+'"]');
 await expect(pieces.locator('.road')).not.toHaveCount(0);await expect(pieces.filter({hasNot:page.locator('.road')})).not.toHaveCount(0);
 const clock=await week.locator('.vg-hour-label').evaluateAll(labels=>labels.slice(-3).map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent,top:r.top,bottom:r.bottom};}));
 expect(clock.map(x=>x.label)).toEqual(['22:00','23:00','24:00']);expect(clock[1].top-clock[0].top).toBeCloseTo(20,0);expect(clock[2].top-clock[1].top).toBeCloseTo(20,0);
 expect(clock[2].top).toBeGreaterThanOrEqual(clock[1].bottom-1);
 const bounds=await week.locator('.vg-scroll').evaluate(el=>{const r=el.getBoundingClientRect(),end=el.querySelector('.vg-hour-label:last-child').getBoundingClientRect();return {bottom:r.bottom,end:end.bottom};});
 expect(bounds.end).toBeLessThanOrEqual(bounds.bottom);
 const piece=pieces.first();await piece.focus();await page.keyboard.press('Enter');await expect(page.locator('.gpop')).toBeVisible();
 if(role==='engineer'){
   expect(await page.evaluate(()=>window.__visualQA.reads)).toContain('rpc:legacy_personal_schedule_read');
   await expect(page.locator('.gpop')).toContainText('экипаж не указан');await expect(page.locator('.gpop .gp-trip-tools')).toHaveCount(0);
   expect(await piece.evaluate(el=>getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
 }
 await page.keyboard.press('Escape');await expect(piece).toBeFocused();
 mkdirSync('test-results/schedule-regressions',{recursive:true});await week.screenshot({path:'test-results/schedule-regressions/'+info.project.name+'-'+role+'-day.png'});
 await clean(page,errors);
});
test('day load rail fills from its top and dark surfaces match entry colours',async({page},info)=>{
 const errors=await openGraph(page,info);const rail=page.locator('.vg-rail>i').first();await expect(rail).toBeVisible();
 const box=await rail.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return {top:a.top-b.top,bottom:b.bottom-a.bottom};});
 expect(Math.abs(box.top)).toBeLessThanOrEqual(1);
 if(info.project.metadata.theme==='dark'){
   const palette=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return ['--bg','--panel','--panel-2','--ink','--glass-panel'].map(k=>s.getPropertyValue(k).trim());});
   expect(palette).toEqual(['#141414','#1e1e1e','#262626','#eeede8','rgba(30,30,30,0.96)']);
 }
 await clean(page,errors);
});
test('day taps share week context and cancelled drags or window taps never save',async({page},info)=>{
 const errors=await openGraph(page,info);const week=await openDay(page),piece=week.locator('.vg-piece[data-gb="t'+trip+'"]:not(.short)').first();
 await piece.scrollIntoViewIfNeeded();await piece.click({position:{x:12,y:12}});await expect(page.locator('.gpop')).toBeVisible();await expect(page.locator('.view-dash.active')).toBeVisible();await page.keyboard.press('Escape');
 const original=await piece.evaluate(el=>el.style.top),r=await piece.boundingBox();
 await page.mouse.move(r.x+15,r.y+12);await page.mouse.down();await page.mouse.move(r.x+15,r.y+32);await page.keyboard.press('Escape');await page.mouse.up();
 expect(await piece.evaluate(el=>el.style.top)).toBe(original);await expect(page.locator('.gpop')).toHaveCount(0);
 const line=week.locator('[data-winline=start]');await line.scrollIntoViewIfNeeded();await line.click({position:{x:2,y:1}});
 await clean(page,errors);
});
test('split action targets the selected work piece and Escape cancels its preview',async({page},info)=>{
 const errors=await openGraph(page,info),week=await openDay(page);
 const work=week.locator('.vg-piece[data-gb="t'+trip+'"]:not(.short)').filter({hasNot:page.locator('.road')}).first();
 const from=Number(await work.getAttribute('data-piece-from'));await work.focus();await page.keyboard.press('Enter');
 await page.locator('.gpop .gp-layout summary').click();
 await page.locator('.gpop [data-pop-divide]').click();const cut=week.locator('.vg-cut');await expect(cut).toBeVisible();
 const input=cut.locator('input');expect(Number(await input.getAttribute('min'))).toBeCloseTo(from+.25);
 await expect(input).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
 await expect(cut).toHaveCount(0);await clean(page,errors);
});
