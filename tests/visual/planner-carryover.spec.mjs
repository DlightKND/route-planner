import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
const engineer='00000000-0000-4000-8000-000000000002',date='2026-10-05';
async function boot(page,info){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.install({time:new Date('2026-10-05T10:00Z')});await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,canonicalPlanner:'carryover'});await page.goto('/#/schedule');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.pw-plan')).toHaveCount(2);return errors;
}
const first=page=>page.locator('.pw-plan[data-person="'+engineer+'"]').first();
const writes=page=>page.evaluate(()=>window.__visualQA.plannerWrites);
async function center(page){for(let i=0;i<2;i++){await page.locator('.pw-calendar').evaluate(el=>{const day=el.querySelector('.pw-day');el.scrollTop=day.offsetTop+(12-Number(day.dataset.start))*Number(day.dataset.scale)-Math.max(120,el.clientHeight/2);});await page.waitForTimeout(60);}}
async function select(page){const close=page.locator('[data-pw=context-close]').filter({visible:true});if(await close.count())await close.first().click();await center(page);const hit=page.locator('.pw-plan-hit').first();if(await hit.isVisible())await hit.click();else await first(page).click();await expect(page.locator('[data-pw=part-menu]')).toBeVisible();}
async function drag(page,hours,{cancel=false,expected}={}){
 await select(page);const mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile')),target=mobile?page.locator('[data-pw=drag-grip]'):first(page),box=await target.boundingBox(),scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));
 const x=box.x+box.width/2,y=mobile?box.y+box.height/2:box.y+Math.min(20,box.height/2);let targetX=x;
 if(mobile){const lane=await first(page).evaluate(el=>{const r=el.closest('.pw-lane').getBoundingClientRect();return {left:r.left,right:r.right};}),floating=await page.locator('.pw-floating').boundingBox();targetX=floating.x>lane.left+36?lane.left+24:lane.right-28;}
 const count=(await writes(page)).length;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(targetX,y+hours*scale,{steps:6});
 if(expected){await expect(page.locator('.pw-ghost.invalid')).toHaveCount(0);for(const text of expected)await expect(page.locator('.pw-ghost').filter({hasText:text})).toHaveCount(2);}
 expect((await writes(page)).length).toBe(count);
 if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
 if(cancel){await expect(page.locator('.pw-ghost')).toHaveCount(0);expect((await writes(page)).length).toBe(count);}else{await expect.poll(async()=>(await writes(page)).length).toBe(count+1);await expect(page.locator('.pw-context')).toBeHidden();}
}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.queryErrors)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);}
async function capture(page,info,name){const dir='test-results/planner-carryover/'+info.project.name;mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+name+'.png'});}
function positions(parts){return parts.map(({date,start,end,offset})=>({date,start,end,offset}));}

for(const hideOffHours of [false,true])test(`planner carryover: pointer drag flows 4+1, repeats, returns and cancels (${hideOffHours?'working hours':'full day'})`,async({page},info)=>{
 const errors=await boot(page,info);if(hideOffHours){await page.getByRole('button',{name:'Открыть мультифильтр',exact:true}).filter({visible:true}).first().click();await page.locator('#pw-filter-panel [name=hideOffHours]').check();await page.locator('#pw-filter-panel [type=submit]').click();await expect(page.locator('.pw-day').first()).toHaveAttribute('data-start','7');}await drag(page,1,{expected:['13:00–17:00','07:00–08:00']});await expect(page.locator('.pw-plan')).toHaveCount(4);
 let changes=await writes(page);expect(changes[0].p_changes[0].manual).toBe(true);expect(positions(changes[0].p_changes[0].parts)).toEqual([{date,start:13,end:17,offset:0},{date:'2026-10-06',start:7,end:8,offset:4}]);await capture(page,info,'carried');
 await drag(page,1,{expected:['14:00–17:00','07:00–09:00']});changes=await writes(page);expect(positions(changes[1].p_changes[0].parts)).toEqual([{date,start:14,end:17,offset:0},{date:'2026-10-06',start:7,end:9,offset:3}]);
 await drag(page,-2,{expected:['12:00–17:00']});await expect(page.locator('.pw-plan')).toHaveCount(2);expect(positions((await writes(page))[2].p_changes[0].parts)).toEqual([{date,start:12,end:17,offset:0}]);
 await drag(page,1,{cancel:true,expected:['13:00–17:00','07:00–08:00']});await expect(page.locator('.pw-plan')).toHaveCount(2);await expect(first(page)).toContainText('12:00–17:00');await clean(page,errors);
});

test('planner carryover: move editor previews without writing, cancels, then skips a weekend on apply',async({page},info)=>{
 const errors=await boot(page,info);await select(page);await page.locator('[data-pw=part-menu]').click();await page.locator('[data-pw=edit-move]').click();await page.locator('.pw-editor [name=start]').fill('13:00');await expect(page.locator('.pw-preview-note')).toContainText('06.10 07:00–08:00');expect(await writes(page)).toEqual([]);await page.locator('[data-pw=edit-cancel]').filter({visible:true}).first().click();await expect(page.locator('.pw-plan')).toHaveCount(2);
 await select(page);await page.locator('[data-pw=part-menu]').click();await page.locator('[data-pw=edit-move]').click();await page.locator('.pw-editor [name=date]').fill('2026-10-09');await page.locator('.pw-editor [name=start]').fill('13:00');await expect(page.locator('.pw-preview-note')).toContainText('12.10 07:00–08:00');expect(await writes(page)).toEqual([]);await page.locator('.pw-editor [type=submit]').click();await expect.poll(async()=>(await writes(page)).length).toBe(1);
 expect(positions((await writes(page))[0].p_changes[0].parts)).toEqual([{date:'2026-10-09',start:13,end:17,offset:0},{date:'2026-10-12',start:7,end:8,offset:4}]);await expect(page.locator('.pw-day[data-date="2026-10-12"]')).toHaveCount(1);await expect(page.locator('.pw-plan')).toHaveCount(4);await clean(page,errors);
});

test('planner carryover: keyboard uses the same work calendar and undo restores one five-hour bar',async({page},info)=>{
 const errors=await boot(page,info);await select(page);
 for(let i=0;i<4;i++){await first(page).focus();await first(page).press('Alt+ArrowDown');await expect.poll(async()=>(await writes(page)).length).toBe(i+1);}
 expect(positions((await writes(page))[3].p_changes[0].parts)).toEqual([{date,start:13,end:17,offset:0},{date:'2026-10-06',start:7,end:8,offset:4}]);
 for(let i=0;i<4;i++){await page.locator('[data-pw=undo]').click();await expect.poll(async()=>(await writes(page)).length).toBe(5+i);}
 await expect(page.locator('.pw-plan')).toHaveCount(2);await expect(first(page)).toContainText('12:00–17:00');await expect(page.locator('.pw-fact-mark')).toHaveCount(4);await clean(page,errors);
});
