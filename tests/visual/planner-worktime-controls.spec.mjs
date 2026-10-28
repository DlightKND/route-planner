import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
const engineer='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',date='2026-10-05';
async function boot(page,info,role='logist'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.install({time:new Date('2026-10-05T10:00Z')});await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,canonicalPlanner:true});await page.goto('/#/schedule');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.pw-plan')).toHaveCount(role==='engineer'?3:6);return errors;
}
async function filters(page){await page.getByRole('button',{name:'Открыть мультифильтр',exact:true}).filter({visible:true}).first().click();await expect(page.locator('#pw-filter-panel')).toBeVisible();return page.locator('#pw-filter-panel');}
async function apply(page){await page.locator('#pw-filter-panel [type=submit]').click();await expect(page.locator('#pw-filter-panel')).toHaveCount(0);}
async function center(page,hour){for(let i=0;i<2;i++){await page.locator('.pw-calendar').evaluate((el,hour)=>{const day=el.querySelector('.pw-day');el.scrollTop=Math.max(0,day.offsetTop+(hour-Number(day.dataset.start))*Number(day.dataset.scale)-el.clientHeight/2);},hour);await page.waitForTimeout(60);}}
const boundary=(page,kind,person=engineer,day=date)=>page.locator(`.pw-day[data-date="${day}"] .pw-day-boundary[data-person="${person}"][data-boundary="${kind}"]`);
async function capture(page,info,name){const dir='test-results/planner-worktime/'+info.project.name;mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+name+'.png'});}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.queryErrors)).toEqual([]);}

test('planner worktime: desktop keeps dates and interactive zoom on scroll; phone keeps the calendar button',async({page},info)=>{
 const errors=await boot(page,info),mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile'));
 await expect(page.locator('.pf-controls,.calendar-window-legend')).toHaveCount(0);await page.locator('.pw-calendar').evaluate(el=>el.scrollTop=200);await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','true');
 const period=page.locator('[data-pw=period]');if(mobile){await expect(period.locator('.date-text')).toBeHidden();expect((await period.boundingBox()).width).toBe(48);}else{
  await expect(period.locator('.date-text')).toBeVisible();await expect(page.locator('.period-step').first()).toBeVisible();await expect(page.locator('.desktop-scale')).toBeVisible();const slider=page.locator('.desktop-scale [data-pw-scale]'),before=Number(await slider.inputValue()),scale=await page.locator('.pw-day').first().getAttribute('data-scale');await slider.focus();await slider.press('ArrowRight');await expect(slider).toHaveValue(String(before+1));expect(await page.locator('.pw-day').first().getAttribute('data-scale')).not.toBe(scale);
 }
 await capture(page,info,'compact-rail');await clean(page,errors);
});

test('planner worktime: fact and legend are applied from filter drafts, cancelled and remembered',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('.pw-fact-mark')).toHaveCount(4);let panel=await filters(page);await panel.locator('[name=showFact]').uncheck();await panel.locator('[data-pw-dialog-close]').first().click();await expect(page.locator('#confirmYes')).toBeVisible();await page.locator('#confirmYes').click();await expect(page.locator('#pw-filter-panel')).toHaveCount(0);await expect(page.locator('.pw-fact-mark')).toHaveCount(4);
 panel=await filters(page);await expect(panel.locator('[name=showFact]')).toBeChecked();await panel.locator('[name=showFact]').uncheck();await panel.locator('[name=showLegend]').check();await apply(page);await expect(page.locator('.pw-fact-mark')).toHaveCount(0);await expect(page.locator('.pf-controls')).toBeVisible();await page.reload();await expect(page.locator('.pw-plan')).toHaveCount(6);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.pw-fact-mark')).toHaveCount(0);await expect(page.locator('.pf-controls')).toBeVisible();
 panel=await filters(page);await panel.locator('[data-pw=draft-reset]').click();await apply(page);await expect(page.locator('.pw-fact-mark')).toHaveCount(4);await expect(page.locator('.pf-controls')).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);await clean(page,errors);
});

test('planner worktime: manager crops off-hours without losing data or changing working hours',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('.pw-day').first()).toHaveAttribute('data-start','0');const panel=await filters(page);await panel.locator('[name=hideOffHours]').check();await apply(page);await expect(page.locator('.pw-day').first()).toHaveAttribute('data-start','7');await expect(page.locator('.pw-day').first()).toHaveAttribute('data-end','17');await expect(page.locator('.pw-plan')).toHaveCount(6);await expect(page.locator('.pw-fact-mark')).toHaveCount(4);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await capture(page,info,'working-hours');await clean(page,errors);
});

test('planner worktime: start and tolerance change only one engineer/day, cancel and survive reload',async({page},info)=>{
 const errors=await boot(page,info);await center(page,7);let line=boundary(page,'start'),box=await line.boundingBox(),scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale')),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+scale,{steps:5});await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(1);await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');await expect(boundary(page,'start',other)).toHaveAttribute('aria-valuenow','7');
 expect(await page.evaluate(()=>window.__visualQA.staffDayWrites[0])).toMatchObject({engineer,date,start_h:8,end_h:17,tol_h:1});
 await center(page,18);await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('ArrowDown');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(2);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','18.25');await expect(boundary(page,'tolerance',other)).toHaveAttribute('aria-valuenow','17');
 await center(page,18.25);line=boundary(page,'tolerance');box=await line.boundingBox();scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));x=box.x+box.width/2;y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+scale/2,{steps:5});await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(3);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','18.75');await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('Home');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(4);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','17');await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('ArrowDown');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(5);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','17.25');
 await center(page,8);line=boundary(page,'start');box=await line.boundingBox();scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));x=box.x+box.width/2;y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+scale,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');expect(await page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(5);
 await page.reload();await expect(page.locator('.pw-plan')).toHaveCount(6);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','17.25');await expect(boundary(page,'start',other)).toHaveAttribute('aria-valuenow','7');await expect(boundary(page,'start',engineer,'2026-10-06')).toHaveAttribute('aria-valuenow','7');expect(await page.evaluate(()=>window.__visualQA.staffDayRows)).toHaveLength(1);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);await capture(page,info,'individual-window');await clean(page,errors);
});

test('planner worktime: engineers keep a personal frame and cannot edit working boundaries',async({page},info)=>{
 const errors=await boot(page,info,'engineer');await expect(page.locator('.pw-day').first()).toHaveAttribute('data-start','7');await expect(page.locator('.pw-day-boundary')).toHaveCount(0);const panel=await filters(page);await expect(panel.locator('[name=showFact]')).toBeVisible();await expect(panel.locator('[name=hideOffHours]')).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await clean(page,errors);
});

for(const role of ['logist','engineer'])test(`planner worktime: ${role} weekend shading stays inside each day at every daily zoom`,async({page},info)=>{
 const errors=await boot(page,info,role);
 await page.evaluate(({other,role})=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith('dlight:planner-view:'));
  localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)),from:'2026-10-09',to:'2026-10-13',hideOffHours:role==='logist',zoom:18,contextOpen:false}));
  localStorage.setItem('qa:planner-staff-days',JSON.stringify([{engineer:other,date:'2026-10-11',start_h:10,end_h:14,tol_h:.5}]));
 },{other,role});
 await page.clock.setFixedTime(new Date('2026-10-10T10:00Z'));await page.reload();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(page.locator('.pw-day')).toHaveCount(5);await expect(page.locator('.pw-now')).toHaveCount(0);
 const check=async()=>{
  const geometry=await page.locator('.pw-day').evaluateAll(days=>days.map(day=>{
   const body=day.querySelector('.pw-day-body').getBoundingClientRect();
   return {date:day.dataset.date,start:day.dataset.start,end:day.dataset.end,closed:day.dataset.closed,height:body.height,zones:[...day.querySelectorAll('.pw-zone')].map(zone=>{const box=zone.getBoundingClientRect();return {top:box.top-body.top,bottom:box.bottom-body.top};}),labels:[...day.querySelectorAll('.calendar-boundary small')].map(label=>{const box=label.getBoundingClientRect();return {top:box.top-body.top,bottom:box.bottom-body.top};}),grid:getComputedStyle(day.querySelector('.pw-lane')).backgroundImage};
  }));
  for(const day of geometry){
   for(const zone of [...day.zones,...day.labels]){expect(zone.top,day.date).toBeGreaterThanOrEqual(-.5);expect(zone.bottom,day.date).toBeLessThanOrEqual(day.height+.5);}
   if(day.date==='2026-10-10'||role==='engineer'&&day.date==='2026-10-11'){expect(day.closed).toBe('true');expect(day.height).toBe(72);expect(day.grid).toBe('none');}
   else if(day.date==='2026-10-11')expect(day).toMatchObject({start:'10',end:'14.5',closed:'false'});
   else expect(day).toMatchObject({start:'7',end:'17',closed:'false'});
  }
  expect(await page.locator('.pw-calendar').evaluate(el=>el.scrollHeight<=el.querySelector('.pw-calendar-inner').getBoundingClientRect().height+el.clientHeight+1)).toBe(true);
 };
 await check();const mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile'));
 if(mobile)await page.locator('[data-pw=scale]').click();const slider=page.locator('[data-pw-scale]:visible').first();
 await slider.focus();await slider.press('Home');await check();
 for(let step=0;step<3;step++)await slider.press('PageUp');await check();
 for(let step=0;step<3;step++)await slider.press('PageUp');await check();
 if(mobile)await page.locator('.pw-dialog [data-pw-dialog-close]').first().click();
 await page.locator('.pw-calendar').evaluate(el=>el.scrollTop=0);await capture(page,info,'weekend-'+role);
 expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);await clean(page,errors);
});
