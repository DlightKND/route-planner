import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
const trip=fixtureIDs.trip;
async function openGraph(page,info,{role='admin',legacy=false,scheduleJourney=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-06T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,legacyCrewMissing:legacy,scheduleJourney});
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
 expect(await page.locator('.vg-cell').first().evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
 expect(await page.locator('.vg-date').first().evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
 const first=page.locator('.vg-block[data-gb="t'+trip+'"]').first();await expect(first).toHaveClass(/\btrip\b/);
 expect(await first.evaluate(el=>getComputedStyle(el).borderLeftColor)).toBe('rgb(255, 225, 0)');
 await expect(first.locator('.vg-week-road')).not.toHaveCount(0);
 const week=await openDay(page),pieces=week.locator('.vg-piece[data-gb="t'+trip+'"]');
 expect(await week.locator('.vg-hour-label').first().evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
 expect(await week.locator('.vg-hour-line').first().evaluate(el=>getComputedStyle(el).display)).toBe('none');
 await expect(week.locator('[data-winline=start]')).toBeVisible();await expect(week.locator('[data-winline=end]')).toBeVisible();
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
 const errors=await openGraph(page,info);const week=await openDay(page),piece=week.locator('.vg-piece[data-gb="t'+trip+'"]').filter({has:page.locator('.road')}).first();
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
 const from=Number(await work.getAttribute('data-piece-from'));await work.locator('[data-gdivide]').click();const cut=week.locator('.vg-cut');await expect(cut).toBeVisible();
 const input=cut.locator('[role=slider]');expect(Number(await input.getAttribute('aria-valuemin'))).toBeCloseTo(from+.25);
 await expect(input).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
 await expect(cut).toHaveCount(0);await clean(page,errors);
});


test('split saves the selected work part, moving its continuation keeps hours and rejects overlap',async({page},info)=>{
 const errors=await openGraph(page,info,{scheduleJourney:true});let week=await openDay(page);
 let pieces=week.locator('.vg-piece[data-gb="t'+trip+'"]');
 const original=await pieces.evaluateAll(els=>els.map(el=>({from:Number(el.dataset.pieceFrom),to:Number(el.dataset.pieceTo)})));
 const hours=original.reduce((n,p)=>n+p.to-p.from,0);
 const work=pieces.filter({hasNot:page.locator('.road')}).first(),from=Number(await work.getAttribute('data-piece-from')),to=Number(await work.getAttribute('data-piece-to'));
 await work.locator('[data-gdivide]').click();
 const cut=week.locator('.vg-cut'),range=cut.locator('[role=slider]'),split=Math.round((from+to)*2)/4;
 await expect(range).toHaveAttribute('aria-valuenow',String(split));await cut.locator('[data-cut-ok]').click();
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(1);
 const saved=await page.evaluate(()=>window.__visualQA.scheduleWrites[0].record.day_plan);expect(saved.cuts[0].at).toEqual({d:'2026-10-05',t:split});
 await expect(pieces.filter({hasNot:page.locator('.road')})).toHaveCount(2);
 const tail=week.locator('.vg-piece[data-gb="t'+trip+'"][data-piece-from="'+split+'"]');
 const at=await tail.getAttribute('data-piece-at');const box=await tail.boundingBox();
 await page.mouse.move(box.x+8,box.y+3);await page.mouse.down();await page.mouse.move(box.x+8,box.y+13);await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(2);
 let moved=week.locator('.vg-piece[data-gb="t'+trip+'"][data-piece-at="'+at+'"]');await expect(moved).toHaveAttribute('data-piece-from',String(split+.5));
 const total=await pieces.evaluateAll(els=>els.reduce((n,el)=>n+Number(el.dataset.pieceTo)-Number(el.dataset.pieceFrom),0));expect(total).toBeCloseTo(hours);
 const before=await moved.boundingBox();await page.mouse.move(before.x+8,before.y+3);await page.mouse.down();await page.mouse.move(before.x+8,before.y-17);await page.mouse.up();
 await expect(page.locator('#toast')).toContainText('после предыдущей');expect(await page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(2);await expect(moved).toHaveAttribute('data-piece-from',String(split+.5));
 await page.screenshot({path:'test-results/schedule-regressions/'+info.project.name+'-split-saved.png'});
 await moved.locator('[data-gtools]').click();await expect(page.locator('.gpop [data-greset]')).toBeVisible();await page.locator('.gpop .gp-layout summary').click();await expect(page.locator('.gpop [data-cut-del]')).toHaveCount(1);
 await page.locator('.gpop [data-greset]').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(3);expect(await page.evaluate(()=>window.__visualQA.scheduleWrites[2].record.day_plan)).toBeNull();await expect(pieces.filter({hasNot:page.locator('.road')})).toHaveCount(1);await clean(page,errors);
});

test('request cards open their page and the engineer filter survives day/week transitions',async({page},info)=>{
 const errors=await openGraph(page,info);
 const week=page.locator('.vg-block[data-gb="t'+trip+'"]').first().locator('xpath=ancestor::*[@data-gtbox]');
 const picker=week.locator('[data-vgmode]');const selected=await picker.locator('option').nth(1).getAttribute('value');await picker.selectOption(selected);
 const spacing=await week.locator('.vg-tools').evaluate(el=>({height:el.getBoundingClientRect().height,gap:parseFloat(getComputedStyle(el).marginBottom)}));
 await week.locator('[data-gday="2026-10-05"]').click();await expect(picker).toHaveValue(selected);
 await expect(week.locator('.vg-scale')).toHaveCount(0);await expect(week.locator('.gleg')).toHaveText('выездзаявкадорога');
 const daySpacing=await week.locator('.vg-tools').evaluate(el=>({height:el.getBoundingClientRect().height,gap:parseFloat(getComputedStyle(el).marginBottom)}));expect(daySpacing.gap).toBe(spacing.gap);if(page.viewportSize().width>760)expect(daySpacing.height).toBeCloseTo(spacing.height,0);
 await week.locator('[data-gback]').click();await expect(picker).toHaveValue(selected);await expect(week.locator('.vg-scale')).toHaveCount(0);
 const request=week.locator('.vg-block[data-job-id]:not([data-job-id=""])').first();await request.focus();await page.keyboard.press('Enter');await expect(page.locator('.view-job.active')).toBeVisible();await expect(page.locator('.gpop')).toHaveCount(0);
 await page.goto('/#/dash');await expect(page.locator('.vg-block[data-gb="t'+trip+'"]').first()).toBeVisible();const day=await openDay(page);
 const work=day.locator('.vg-piece[data-job-id]:not([data-job-id=""])').first();await work.click({position:{x:10,y:8}});await expect(page.locator('.view-job.active')).toBeVisible();await expect(page.locator('.gpop')).toHaveCount(0);await clean(page,errors);
});
test('split line does not jump on press and tracks a real vertical pointer gesture',async({page},info)=>{
 const errors=await openGraph(page,info),week=await openDay(page),work=week.locator('.vg-piece').filter({hasNot:page.locator('.road')}).first();
 await work.locator('[data-gdivide]').click();const slider=work.locator('[role=slider]'),initial=Number(await slider.getAttribute('aria-valuenow'));await slider.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));const r=await slider.boundingBox();
 await page.mouse.move(r.x+10,r.y+12);await page.mouse.down();await expect(slider).toHaveAttribute('aria-valuenow',String(initial));
 await page.mouse.move(r.x+10,r.y+22);await expect(slider).toHaveAttribute('aria-valuenow',String(initial+.5));await page.mouse.move(r.x+10,r.y+27);await expect(slider).toHaveAttribute('aria-valuenow',String(initial+.75));await page.mouse.up();
 if(info.project.use.hasTouch){
  const touch=await page.context().newCDPSession(page),r=await slider.boundingBox(),value=Number(await slider.getAttribute('aria-valuenow'));
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+10,y:r.y+12}]});await expect(slider).toHaveAttribute('aria-valuenow',String(value));
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+10,y:r.y+2}]});await expect(slider).toHaveAttribute('aria-valuenow',String(value-.5));await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
 }
 await page.keyboard.press('Escape');await expect(work.locator('.vg-cut')).toHaveCount(0);await clean(page,errors);
});
