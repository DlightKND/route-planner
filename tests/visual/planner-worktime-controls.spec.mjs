import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';
import {TRACK_STYLE} from '../../src/core/track-style.js';
const engineer='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',date='2026-10-05';
async function boot(page,info,role='logist',canonicalPlanner=true){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());await page.clock.install({time:new Date('2026-10-05T10:00Z')});await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,canonicalPlanner});await page.goto('/#/schedule');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.pw-plan')).toHaveCount(role==='engineer'?3:6);return errors;
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
 const period=page.locator('[data-pw=period]');if(mobile){await expect(period.locator('.date-text')).toBeHidden();expect((await period.boundingBox()).width).toBe(44);}else{
  await expect(period.locator('.date-text')).toBeVisible();await expect(page.locator('.period-step').first()).toBeVisible();await expect(page.locator('.desktop-scale')).toBeVisible();const slider=page.locator('.desktop-scale [data-pw-scale]'),before=Number(await slider.inputValue()),scale=await page.locator('.pw-day').first().getAttribute('data-scale');await slider.focus();await slider.press('ArrowRight');await expect(slider).toHaveValue(String(before+1));expect(Number(await page.locator('.pw-day').first().getAttribute('data-scale'))).toBeGreaterThan(Number(scale));
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
 await page.mouse.move(x,y);await page.mouse.down();await page.clock.runFor(460);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(1);await page.mouse.move(x,y+scale,{steps:5});await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(1);await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');await expect(boundary(page,'start',other)).toHaveAttribute('aria-valuenow','7');
 expect(await page.evaluate(()=>window.__visualQA.staffDayWrites[0])).toMatchObject({engineer,date,start_h:8,end_h:17,tol_h:1});
 await center(page,18);await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('ArrowDown');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(2);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','18.25');await expect(boundary(page,'tolerance',other)).toHaveAttribute('aria-valuenow','17');
 await center(page,18.25);line=boundary(page,'tolerance');box=await line.boundingBox();scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));x=box.x+box.width/2;y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.clock.runFor(460);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(1);await page.mouse.move(x,y+scale/2,{steps:5});await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(3);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','18.75');await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('Home');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(4);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','17');await boundary(page,'tolerance').focus();await boundary(page,'tolerance').press('ArrowDown');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(5);await expect(boundary(page,'tolerance')).toHaveAttribute('aria-valuenow','17.25');
 await center(page,8);line=boundary(page,'start');box=await line.boundingBox();scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));x=box.x+box.width/2;y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.clock.runFor(460);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(1);await page.mouse.move(x,y+scale,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');expect(await page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(5);
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
   return {date:day.dataset.date,start:day.dataset.start,end:day.dataset.end,closed:day.dataset.closed,height:body.height,zones:[...day.querySelectorAll('.pw-zone')].map(zone=>{const box=zone.getBoundingClientRect();return {top:box.top-body.top,bottom:box.bottom-body.top};}),ticks:[...day.querySelectorAll('.pw-tick')].map(tick=>{const box=tick.getBoundingClientRect();return {top:box.top,bottom:box.bottom};}).sort((a,b)=>a.top-b.top),labels:[...day.querySelectorAll('.calendar-boundary small')].map(label=>{const box=label.getBoundingClientRect();return {top:box.top-body.top,bottom:box.bottom-body.top};}),grid:getComputedStyle(day.querySelector('.pw-lane')).backgroundImage};
  }));
  for(const day of geometry){
   for(let i=1;i<day.ticks.length;i++)expect(day.ticks[i-1].bottom,day.date).toBeLessThanOrEqual(day.ticks[i].top+.5);
   for(const zone of [...day.zones,...day.labels]){expect(zone.top,day.date).toBeGreaterThanOrEqual(-.5);expect(zone.bottom,day.date).toBeLessThanOrEqual(day.height+.5);}
   if(day.date==='2026-10-10'||role==='engineer'&&day.date==='2026-10-11'){expect(day.closed).toBe('true');expect(day.height).toBe(72);expect(day.grid).toBe('none');}
   else if(day.date==='2026-10-11')expect(day).toMatchObject({start:'10',end:'14.5',closed:'false'});
   else expect(day).toMatchObject({start:'7',end:'17',closed:'false'});
  }
  expect(await page.locator('.pw-calendar').evaluate(el=>el.scrollHeight<=el.querySelector('.pw-calendar-inner').getBoundingClientRect().height+el.clientHeight+1)).toBe(true);
 };
 await check();const mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile'));
 if(mobile)await page.locator('[data-pw=scale]').click();const slider=page.locator('[data-pw-scale]:visible').first();
 await slider.focus();await slider.press('End');await check();
 for(let step=0;step<3;step++)await slider.press('PageDown');await check();
 for(let step=0;step<3;step++)await slider.press('PageDown');await check();
 if(mobile)await page.locator('.pw-dialog [data-pw-dialog-close]').first().click();
 await page.locator('.pw-calendar').evaluate(el=>el.scrollTop=0);await capture(page,info,'weekend-'+role);
 expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);await clean(page,errors);
});


test('planner fact palette: daily ribbons, legend, details and week cards match the main map',async({page},info)=>{
 const errors=await boot(page,info,'logist','palette');await expect(page.locator('.pw-fact-mark')).toHaveCount(10);
 const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(n=>parseInt(n,16)).join(', ')+')';
 const colors={gps:TRACK_STYLE.measured,stop:TRACK_STYLE.stop,estimated:TRACK_STYLE.road,unknown:TRACK_STYLE.gap};
 for(const [tone,color] of Object.entries(colors)){
  const ribbons=page.locator('.pf-ribbon[data-fact-tone='+tone+']');await expect(ribbons).toHaveCount(tone==='estimated'?4:2);
  for(const ribbon of await ribbons.all()){
   if(tone==='gps'||tone==='stop')await expect(ribbon.locator('.pf-part')).toHaveCSS('background-color',rgb(color));
   else expect(await ribbon.locator('.pf-part').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(rgb(color));
   expect(await ribbon.evaluate(el=>getComputedStyle(el,el.classList.contains('pf-ribbon-first')?'::before':'::after').backgroundColor)).toBe(rgb(color));
  }
 }
 let panel=await filters(page);await panel.locator('[name=showLegend]').check();await apply(page);
 for(const [tone,color] of Object.entries(colors)){
  const key=page.locator('.pf-legend .pf-key-'+tone);
  if(tone==='gps'||tone==='stop')await expect(key).toHaveCSS('background-color',rgb(color));else expect(await key.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(rgb(color));
 }
 await center(page,12);await page.locator('.pw-fact-hit[data-person="'+engineer+'"][data-facts*="planner-stay"]').first().click();
 await expect(page.locator('.pf-sources .pf-key-stop')).toHaveCSS('background-color',rgb(TRACK_STYLE.stop));
 expect(await page.locator('.pf-sources .pf-key-estimated').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(rgb(TRACK_STYLE.road));
 await capture(page,info,'fact-palette');await page.locator('.pf-popover-head [data-pw=selection-clear], [data-pw=context-close]').filter({visible:true}).first().click();
 const mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile'));if(mobile)await page.locator('[data-pw=scale]').click();await page.locator('[data-pw-scale]:visible').first().press('Home');
 await expect(page.locator('.pf-week-fact')).toHaveCount(2);
 for(const [tone,color] of Object.entries(colors))for(const segment of await page.locator('.pw-week-fact-strip [data-fact-tone='+tone+']').all()){if(tone==='gps'||tone==='stop')await expect(segment).toHaveCSS('background-color',rgb(color));else{const image=await segment.evaluate(el=>getComputedStyle(el).backgroundImage);expect(image).toContain('repeating-linear-gradient');expect(image).toContain(rgb(color));}}
 if(mobile)await page.locator('.pw-dialog [data-pw-dialog-close]').first().click();await capture(page,info,'fact-palette-week');
 expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await clean(page,errors);
});

test('planner zoom: plus approaches hours; Ctrl+wheel zooms at the pointer without browser zoom',async({page},info)=>{
 const errors=await boot(page,info),mobile=await page.locator('.pw-root').evaluate(el=>el.classList.contains('pw-mobile'));
 if(await page.locator('.pw-context').isVisible())await page.locator('[data-pw=context-close]').click();
 if(mobile)await page.locator('[data-pw=scale]').click();const slider=page.locator('[data-pw-scale]:visible').first();
 await slider.fill('0');await expect(page.locator('.week-block')).toHaveCount(1);await expect(slider).toHaveAttribute('aria-valuetext','Недели');
 await slider.fill('100');await expect(page.locator('.pw-day')).toHaveCount(2);await expect(slider).toHaveAttribute('aria-valuetext','8 ч');
 await slider.fill('50');const scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));await slider.press('ArrowRight');expect(Number(await page.locator('.pw-day').first().getAttribute('data-scale'))).toBeGreaterThan(scale);
 if(mobile)await page.locator('.pw-zoom [data-pw-dialog-close]').first().click();else{
  const before=Number(await slider.inputValue());await page.locator('[data-pw=zoom-in]').click();await expect(slider).toHaveValue(String(before+7));await page.locator('[data-pw=zoom-out]').click();await expect(slider).toHaveValue(String(before));
  await slider.fill('82');await center(page,12);const cal=page.locator('.pw-calendar'),box=await cal.boundingBox(),x=box.x+150,y=box.y+Math.min(300,box.height-30);await page.mouse.move(x,y);
  const anchor=()=>cal.evaluate((el,y)=>{const day=[...el.querySelectorAll('.pw-day')].find(d=>d.getBoundingClientRect().bottom>y);return {date:day.dataset.date,hour:Number(day.dataset.start)+(y-day.querySelector('.pw-day-body').getBoundingClientRect().top)/Number(day.dataset.scale)};},y);
  const old=await anchor(),browserScale=await page.evaluate(()=>window.visualViewport.scale);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.clock.runFor(80);await page.keyboard.up('Control');await expect(slider).toHaveValue('88');const after=await anchor();expect(after.date).toBe(old.date);expect(after.hour).toBeCloseTo(old.hour,1);expect(await page.evaluate(()=>window.visualViewport.scale)).toBe(browserScale);
  await page.keyboard.down('Control');await page.mouse.wheel(0,120);await page.clock.runFor(80);await page.keyboard.up('Control');await expect(slider).toHaveValue('82');
  await page.mouse.wheel(0,120);await page.clock.runFor(80);await expect(slider).toHaveValue('82');
 }
 await page.reload();await expect(page.locator('.pw-plan')).toHaveCount(6);if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();if(mobile)await page.locator('[data-pw=scale]').click();await expect(page.locator('[data-pw-scale]:visible').first()).toHaveValue(mobile?'51':'82');
 expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);await clean(page,errors);
});


test('planner worktime: quick mouse movement cancels the hold instead of moving or opening a day',async({page},info)=>{
 const errors=await boot(page,info);await center(page,7);const box=await boundary(page,'start').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+60,{steps:3});await page.clock.runFor(600);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);await page.mouse.up();await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','7');await expect(page.locator('.pw-workday-dialog')).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);await clean(page,errors);
});

test('planner worktime: native touch swipes scroll across both day grips; hold then drag shows an active pill and saves only on release',async({page},info)=>{
 test.skip(!info.project.use.hasTouch,'Requires native touch input.');const errors=await boot(page,info),cdp=await page.context().newCDPSession(page),cal=page.locator('.pw-calendar');
 const touch=(type,x=0,y=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[{x,y,id:1}]});
 for(const [kind,hour] of [['start',7],['tolerance',17]]){
  await center(page,hour);const box=await boundary(page,kind).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,before=await cal.evaluate(e=>e.scrollTop);
  await touch('touchStart',x,y);await touch('touchMove',x,y-24);await page.waitForTimeout(30);await touch('touchMove',x,y-72);await page.waitForTimeout(30);await touch('touchMove',x,y-120);await touch('touchEnd');
  await expect.poll(()=>cal.evaluate(e=>e.scrollTop)).toBeGreaterThan(before+30);await expect(boundary(page,kind)).toHaveAttribute('aria-valuenow',String(hour));await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);await expect(page.locator('.pw-workday-dialog')).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toEqual([]);
 }
 for(const [index,kind,hour,delta,result] of [[0,'start',7,1,8],[1,'tolerance',18,.5,18.5]]){
  await center(page,hour);const box=await boundary(page,kind).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale')),before=await cal.evaluate(e=>e.scrollTop);
  await touch('touchStart',x,y);await page.clock.runFor(200);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);await page.clock.runFor(260);await expect(boundary(page,kind)).toHaveClass(/is-dragging/);
  const visual=await boundary(page,kind).evaluate(e=>({line:getComputedStyle(e,'::before').borderTopWidth,hint:getComputedStyle(e.querySelector('small'),'::after').content,above:e.querySelector('small').getBoundingClientRect().bottom<e.getBoundingClientRect().top}));expect(visual.line).toBe('3px');expect(visual.hint).toContain('Перенос');expect(visual.above).toBe(true);await capture(page,info,'held-boundary-'+kind);
  await touch('touchMove',x,y+Math.max(32,scale*delta));await touch('touchMove',x,y+scale*delta);await expect(boundary(page,kind)).toHaveAttribute('aria-valuenow',String(result));expect(await cal.evaluate(e=>e.scrollTop)).toBeCloseTo(before,0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(index);await touch('touchEnd');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(index+1);await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);await expect(boundary(page,kind,other)).toHaveAttribute('aria-valuenow',String(kind==='start'?7:17));
 }
 await center(page,8);const box=await boundary(page,'start').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,scale=Number(await page.locator('.pw-day').first().getAttribute('data-scale'));
 await touch('touchStart',x,y);await page.clock.runFor(460);await touch('touchMove',x,y+scale);await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','9');await touch('touchCancel');await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(2);
 await touch('touchStart',x,y);await page.clock.runFor(460);await expect(boundary(page,'start')).toHaveClass(/is-dragging/);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1},{x:x-40,y:y+20,id:2}]});await expect(page.locator('.pw-day-boundary.is-dragging')).toHaveCount(0);await touch('touchCancel');await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8');
 await touch('touchStart',x,y);await page.clock.runFor(460);await touch('touchMove',x,y+scale/4);await touch('touchEnd');await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(3);await expect(boundary(page,'start')).toHaveAttribute('aria-valuenow','8.25');await center(page,8.25);const tap=await boundary(page,'start').boundingBox();await page.clock.runFor(600);await touch('touchStart',tap.x+tap.width/2,tap.y+tap.height/2);await touch('touchEnd');await expect(page.locator('.pw-workday-dialog')).toHaveCount(1);await page.locator('.pw-workday-dialog [data-pw-dialog-close]').first().click();expect(await page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(3);await clean(page,errors);await cdp.detach();
});
