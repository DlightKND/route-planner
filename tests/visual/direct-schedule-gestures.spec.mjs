import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
const id='t'+fixtureIDs.trip;
async function open(page,info,options={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-06T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role:'admin',theme:info.project.metadata.theme,scheduleJourney:true,...options});
 await page.goto('/#/dash');await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 const week=page.locator('.vg-block[data-gb="'+id+'"]').first().locator('xpath=ancestor::*[@data-gtbox]');
 await week.locator('[data-gday="2026-10-05"]').click();await expect(week.locator('.vg-day-grid')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);return {week,errors};
}
async function dragToDay(page,piece,dir,{touch=false,cancel=false}={}){
 await piece.scrollIntoViewIfNeeded();const r=await piece.boundingBox(),x=r.x+Math.min(12,r.width/2),y=r.y+Math.min(12,r.height/2);
 const session=touch?await page.context().newCDPSession(page):null;
 const send=async(type,x,y)=>{if(session)await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});};
 if(session){await send('touchStart',x,y);await send('touchMove',x,y+6);}else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+6);}
 const target=page.locator('[data-transfer-portal].vg-day-transfer.'+(dir>0?'next':'previous'));await expect(target).toBeVisible();const t=await target.boundingBox();
 if(session)await send('touchMove',t.x+t.width/2,t.y+t.height/2);else await page.mouse.move(t.x+t.width/2,t.y+t.height/2);
 await expect(target).toHaveClass(/active/);
 if(cancel){if(session)await send('touchCancel');else{await page.keyboard.press('Escape');await page.mouse.up();}}
 else if(session)await send('touchEnd');else await page.mouse.up();
 if(session)await session.detach();
}
test('dragging a day piece to neighbouring days expands trip dates and is reversible',async({page},info)=>{
 const {errors}=await open(page,info);const piece=()=>page.locator('.vg-piece[data-gb="'+id+'"][data-piece-at="0"]').first();
 await dragToDay(page,piece(),1,{cancel:true});expect(await page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(0);
 await dragToDay(page,piece(),1,{touch:!!info.project.use.hasTouch});
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(1);await expect(piece()).toHaveAttribute('data-piece-iso','2026-10-06');
 await dragToDay(page,piece(),1);await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(2);
 await expect(piece()).toHaveAttribute('data-piece-iso','2026-10-07');
 const saved=await page.evaluate(()=>window.__visualQA.scheduleWrites[1].record);expect(saved.date_to).toBe('2026-10-07');expect(saved.day_plan.start).toEqual({d:'2026-10-07',t:7});
 await dragToDay(page,piece(),-1);await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(3);await expect(piece()).toHaveAttribute('data-piece-iso','2026-10-06');
 await page.locator('#undoBtn').click();await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(4);await expect(piece()).toHaveAttribute('data-piece-iso','2026-10-07');
 const restored=await page.evaluate(()=>window.__visualQA.scheduleWrites[3].record);expect(restored.day_plan.start.d).toBe('2026-10-07');
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('time details show the actual continuation when an old cut falls outside the work window',async({page},info)=>{
 const {week,errors}=await open(page,info,{lateScheduleCut:true});const road=week.locator('.vg-piece .road').first().locator('..');await road.focus();await page.keyboard.press('Enter');
 const panel=page.locator('.gpop');await panel.locator('[data-pop-more]').click();await panel.locator('.gp-layout summary').click();
 await expect(panel.locator('.gp-r').nth(1)).toContainText('06.10 · 07:00');await expect(panel.locator('.gp-r').nth(1)).not.toContainText('18:00');expect(errors).toEqual([]);
});
test('short fragments stay inside their actual height and road has one full surface',async({page},info)=>{
 const {week,errors}=await open(page,info,{tinySchedulePiece:true});const pieces=week.locator('.vg-piece[data-gb="'+id+'"]');
 const bounds=await pieces.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),road=el.querySelector('.road')?.getBoundingClientRect();return {h:r.height,from:+el.dataset.pieceFrom,to:+el.dataset.pieceTo,top:r.top,bottom:r.bottom,road:road?{top:road.top,bottom:road.bottom}:null};}));
 expect(bounds.some(b=>b.h<12)).toBe(true);
 for(const b of bounds){expect(b.h).toBeCloseTo(Math.max(2,(b.to-b.from)*20),0);if(b.road){expect(b.road.top).toBeGreaterThanOrEqual(b.top);expect(b.road.bottom).toBeLessThanOrEqual(b.bottom);}}
 for(let i=1;i<bounds.length;i++)expect(bounds[i].top).toBeGreaterThanOrEqual(bounds[i-1].bottom-2);
 mkdirSync('test-results/direct-gestures',{recursive:true});await week.screenshot({path:'test-results/direct-gestures/'+info.project.name+'-surfaces.png'});expect(errors).toEqual([]);
});
test('a split part snaps back with touch or mouse and Escape preserves the cut',async({page},info)=>{
 const {week,errors}=await open(page,info);const parts=()=>week.locator('.vg-piece[data-gb="'+id+'"]').filter({hasNot:page.locator('.road')});
 await parts().first().locator('[data-gdivide]').click();await week.locator('[data-cut-ok]').click();
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(1);await expect(parts()).toHaveCount(2);
 let tail=parts().last(),r=await tail.boundingBox();await page.mouse.move(r.x+10,r.y+3);await page.mouse.down();await page.mouse.move(r.x+10,r.y-7);
 await expect(page.locator('.vg-drop-note')).toHaveText('Скрепить участки');await expect(week.locator('.vg-piece.joining')).toHaveCount(1);
 await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(1);await expect(parts()).toHaveCount(2);
 tail=parts().last();r=await tail.boundingBox();
 if(info.project.use.hasTouch){const touch=await page.context().newCDPSession(page);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+10,y:r.y+3}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+10,y:r.y-7}]});await expect(page.locator('.vg-drop-note')).toHaveText('Скрепить участки');await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();}
 else{await page.mouse.move(r.x+10,r.y+3);await page.mouse.down();await page.mouse.move(r.x+10,r.y-7);await page.mouse.up();}
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(2);await expect(parts()).toHaveCount(1);
 expect(await page.evaluate(()=>window.__visualQA.scheduleWrites[1].record.day_plan.cuts)).toEqual([]);
 expect(await parts().evaluateAll(els=>els.reduce((n,e)=>n+Number(e.dataset.pieceTo)-Number(e.dataset.pieceFrom),0))).toBe(6);
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('trip panel uses one primary row and keeps secondary actions and time behind more',async({page},info)=>{
 const {week,errors}=await open(page,info);await week.locator('.vg-piece .road').first().locator('..').focus();await page.keyboard.press('Enter');
 const panel=page.locator('.gpop');await expect(panel.locator('[data-pop-action]')).toBeVisible();await expect(panel.locator('.gp-secondary')).toBeHidden();
 const r=await panel.locator('.gp-trip-tools').evaluate(el=>[...el.children].map(x=>{const b=x.getBoundingClientRect();return {top:b.top,bottom:b.bottom};}));expect(r[0].top).toBeCloseTo(r[1].top);expect(r[0].bottom).toBeCloseTo(r[1].bottom);
 await expect(panel).toHaveCSS('width',/\d/);expect((await panel.boundingBox()).height).toBeLessThan(170);
 await panel.locator('[data-pop-more]').click();await expect(panel.locator('[data-pop-resched]')).toBeVisible();await panel.locator('.gp-layout summary').click();await expect(panel.locator('.gp-days')).toContainText('Участок 1');
 await page.keyboard.press('Escape');await expect(panel).toBeVisible();await expect(panel.locator('.gp-secondary')).toBeHidden();await expect(panel.locator('[data-pop-more]')).toBeFocused();
 mkdirSync('test-results/direct-gestures',{recursive:true});await panel.screenshot({path:'test-results/direct-gestures/'+info.project.name+'-panel.png'});
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);expect(errors).toEqual([]);
});

for(const role of ['admin','engineer'])test(role+' renders a minute work tail as an edge marker before the full return road',async({page},info)=>{
 const {week,errors}=await open(page,info,{role,roadSliverJourney:true});
 const tail=week.locator('.vg-piece[data-gb="'+id+'"][data-piece-at="8.25"]');
 await expect(tail).toHaveAttribute('data-piece-from','15.75');await expect(tail).toHaveAttribute('data-piece-to','15.776');
 const road=week.locator('.vg-piece[data-gb="'+id+'"][data-piece-at="8.276"]');
 await expect(road).toHaveAttribute('data-piece-to','19');
 const marker=await tail.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {w:r.width,h:r.height,shadow:s.boxShadow,outline:s.outlineStyle,background:s.backgroundColor,left:s.borderLeftColor,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};});
 expect(marker.h).toBe(2);expect(marker.borders).toEqual(['0px','0px','0px','3px']);
 expect(marker.shadow).toBe('none');expect(marker.outline).toBe('none');expect(marker.background).toBe('rgba(0, 0, 0, 0)');expect(marker.left).toBe('rgb(255, 225, 0)');
 const surface=await road.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('.road').getBoundingClientRect();return {h:r.height,roadH:s.height,w:r.width};});
 expect(surface.h).toBeCloseTo(3.224*20,0);expect(surface.roadH).toBeCloseTo(surface.h-2,0);expect(surface.w).toBeGreaterThan(80);expect(marker.w).toBeCloseTo(surface.w);
 mkdirSync('test-results/road-sliver',{recursive:true});await week.screenshot({path:'test-results/road-sliver/'+info.project.name+'-'+role+'.png'});
 await page.keyboard.press('Tab');await tail.focus();await expect(tail).toBeFocused();expect(await tail.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 await page.keyboard.press('Enter');await expect(page.locator('.view-job.active')).toBeVisible();
 expect(await page.evaluate(()=>window.__visualQA.scheduleWrites.length)).toBe(0);
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
