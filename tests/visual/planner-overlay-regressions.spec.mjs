import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';

async function boot(page,info){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.install({time:new Date('2026-10-05T10:00Z')});
 await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,canonicalPlanner:true});
 await page.goto('/#/schedule');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(page.locator('.pw-plan')).toHaveCount(6);return errors;
}
async function capture(page,info,name){const dir='test-results/planner-overlays/'+info.project.name;mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+name+'.png'});}
async function mobile(page){return page.locator('.pw-root').evaluate(e=>e.classList.contains('pw-mobile'));}
async function selectWork(page){
 await page.locator('.pw-calendar').evaluate(el=>{const day=el.querySelector('.pw-day');el.scrollTop=day.offsetTop+(8-Number(day.dataset.start))*Number(day.dataset.scale)-110;});
 if(await mobile(page)){
  await page.locator('.pw-plan-hit').evaluateAll(els=>{const hit=els.find(e=>JSON.parse(e.dataset.rows).some(r=>r.part==='work-first'));hit.dataset.qaWork='true';});
  await page.locator('[data-qa-work]').first().click();
  const choice=page.locator('.pw-dialog [data-pw=choose-part][data-part=work-first]').first();if(await choice.isVisible())await choice.click();
 }else await page.locator('.pw-plan[data-part=work-first]').first().click();
}

test('planner overlays: filters remain above day and week decorations with accessible header and footer',async({page},info)=>{
 const errors=await boot(page,info);
 await page.locator('.pw-calendar').evaluate(el=>el.scrollTop=200);
 await page.getByRole('button',{name:'Открыть мультифильтр',exact:true}).filter({visible:true}).first().click();
 const panel=page.locator('#pw-filter-panel');await expect(panel).toBeVisible();
 const geometry=await panel.evaluate(panel=>{const p=panel.getBoundingClientRect(),head=panel.querySelector('header').getBoundingClientRect(),foot=panel.querySelector('[type=submit]').getBoundingClientRect(),close=panel.querySelector('[data-pw-dialog-close]'),r=close.getBoundingClientRect();return {top:p.top,bottom:p.bottom,headTop:head.top,headBottom:head.bottom,submitTop:foot.top,submitBottom:foot.bottom,closeReachable:close.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),calendarLayer:getComputedStyle(document.querySelector('.pw-calendar')).zIndex};});
 expect(geometry.headTop).toBeGreaterThanOrEqual(geometry.top);expect(geometry.headBottom).toBeLessThanOrEqual(geometry.bottom);expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.bottom);expect(geometry.submitTop).toBeGreaterThanOrEqual(geometry.top);expect(geometry.closeReachable).toBe(true);expect(geometry.calendarLayer).toBe('0');
 await capture(page,info,'filters-over-days');await panel.locator('[data-pw-dialog-close]').first().click();
 await page.locator('.pw-calendar').evaluate(el=>el.scrollTop=0);await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','false');
 if(await mobile(page))await page.locator('[data-pw=scale]:visible').click();
 await page.locator('[data-pw-scale]:visible').first().fill('100');
 if(await page.locator('.pw-dialog').isVisible())await page.locator('.pw-dialog [data-pw-dialog-close]').first().click();
 await expect(page.locator('.week-block')).toHaveCount(1);
 await page.getByRole('button',{name:'Открыть мультифильтр',exact:true}).filter({visible:true}).first().click();await capture(page,info,'filters-over-weeks');expect(errors).toEqual([]);
});

test('planner overlays: selecting a bar opens details and the selection pill; action menu stays inside its panel',async({page},info)=>{
 const errors=await boot(page,info);await selectWork(page);
 await expect(page.locator('.pw-context')).toBeVisible();await expect(page.locator('.pw-context .entity-title-row')).toContainText('Задание №101');await expect(page.locator('.focusbar')).toBeVisible();await expect(page.locator('.focus-name')).toHaveText('Задание №101');
 await page.locator('[data-pw=part-menu]').click();const tool=page.locator('.pw-floating'),menu=page.locator('.schedule-floating-menu');await expect(menu).toBeVisible();
 const rect=await tool.boundingBox(),header=await page.locator('.schedule-floating-main').boundingBox(),body=await menu.boundingBox(),button=await page.locator('[data-pw=part-menu]').boundingBox();expect(button.width).toBe(44);expect(button.height).toBe(44);expect(body.x).toBeGreaterThanOrEqual(rect.x);expect(body.x+body.width).toBeLessThanOrEqual(rect.x+rect.width+1);expect(body.y).toBeGreaterThanOrEqual(header.y+header.height-1);
 expect(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await capture(page,info,'selection-menu');
 await page.locator('[data-pw=part-menu]').click();await page.locator('[data-pw=context-close]').click();await page.locator('[data-pw=focus-details]').click();await expect(page.locator('.pw-context')).toBeVisible();await page.locator('[data-pw=selection-clear]').click();await expect(page.locator('.focusbar')).toBeHidden();
 await selectWork(page);await page.locator('[data-pw=focus-picker]').click();await expect(page.locator('.pw-dialog')).toHaveCount(0);await expect(page.locator('.pw-context .entity-tabs')).toBeVisible();await page.locator('.pw-context [data-pw=index][data-kind=request]').click();await page.locator('.pw-context [data-pw=entity][data-kind=request]').first().click();await expect(page.locator('.focus-name')).toHaveText(/^Заявка №/);await expect(page.locator('.pw-context .entity-title-row')).toContainText('Заявка');await page.locator('.pw-context [data-kind=trip]').first().click();await expect(page.locator('.focus-name')).toHaveText(/^Выезд №/);await expect(page.locator('.pw-context .entity-title-row')).toContainText('Выезд');expect(errors).toEqual([]);
});

test('planner overlays: phone rail becomes one row and each engineer fills the calendar width',async({page},info)=>{
 const errors=await boot(page,info);test.skip(!await mobile(page),'Phone layout');
 const calendar=page.locator('.pw-calendar'),rail=page.locator('.pw-rail'),before=await rail.boundingBox();
 const widths=await calendar.evaluate(el=>({available:el.clientWidth,lane:el.querySelector('.pw-crew').getBoundingClientRect().width,gutter:el.querySelector('.pw-time-head').getBoundingClientRect().width,total:el.scrollWidth}));expect(widths.lane+widths.gutter).toBeCloseTo(widths.available,0);expect(widths.total).toBeGreaterThan(widths.available);
 await calendar.evaluate(el=>el.scrollTop=200);await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','true');expect((await rail.boundingBox()).height).toBeLessThanOrEqual(64);expect((await rail.boundingBox()).height).toBeLessThan(before.height-40);await expect(page.locator('[data-pw=period]:visible')).toBeVisible();await expect(page.locator('.mobile-top-actions [data-pw=filters]')).toBeVisible();await capture(page,info,'phone-collapsed');
 await calendar.evaluate(el=>el.scrollLeft=el.scrollWidth);await expect(page.locator('.pw-crew').last()).toBeInViewport();await calendar.evaluate(el=>el.scrollTop=0);await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','false');expect((await rail.boundingBox()).height).toBeCloseTo(before.height,0);
 await page.getByRole('button',{name:'Открыть мультифильтр',exact:true}).filter({visible:true}).first().click();await page.locator('#pw-filter-panel details').filter({has:page.locator('[name=person]')}).locator('summary').click();await page.locator('#pw-filter-panel [name=person]').last().uncheck();await page.locator('#pw-filter-panel [type=submit]').click();
 expect(await calendar.evaluate(el=>el.querySelector('.pw-crew').getBoundingClientRect().width+el.querySelector('.pw-time-head').getBoundingClientRect().width)).toBeCloseTo(await calendar.evaluate(el=>el.clientWidth),0);await capture(page,info,'phone-single-engineer');
 await page.setViewportSize({width:page.viewportSize().width+40,height:page.viewportSize().height});await expect.poll(()=>calendar.evaluate(el=>el.querySelector('.pw-crew').getBoundingClientRect().width+el.querySelector('.pw-time-head').getBoundingClientRect().width-el.clientWidth)).toBe(0);expect(errors).toEqual([]);
});

test('planner overlays: compact rail folds the period into a working calendar icon in graph and statistics',async({page},info)=>{
 const errors=await boot(page,info),isMobile=await mobile(page),period=page.locator('[data-pw=period]');
 const title=await period.getAttribute('title');expect(title).toContain('05.10 — 06.10.2026');
 for(const mode of ['graph','stats']){
  if(mode==='stats')await page.locator(isMobile?'.pw-mobile-mode':'#pw-tab-stats').click();
  const scroller=page.locator(mode==='graph'?'.pw-calendar':'.pw-statistics');
  await expect(period.locator('.date-text')).toBeVisible();await scroller.evaluate(el=>el.scrollTop=200);
  await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','true');
  await expect(period.locator('.date-text')).toBeHidden();await expect(period.locator('.di')).toBeVisible();
  const rect=await period.boundingBox();expect(rect.width).toBe(isMobile?48:44);expect(rect.height).toBe(rect.width);
  expect((await page.locator('.pw-period').boundingBox()).width).toBe(rect.width);
  await expect(period).toHaveAttribute('title',title);await capture(page,info,'compact-calendar-'+mode);
  await period.click();await expect(page.locator('.pw-dialog [name=from]')).toHaveValue('2026-10-05');await expect(page.locator('.pw-dialog [name=to]')).toHaveValue('2026-10-06');
  await page.locator('.pw-dialog [data-pw-dialog-close]').first().click();await scroller.evaluate(el=>el.scrollTop=0);
  await expect(page.locator('.pw-root')).toHaveAttribute('data-collapsed','false');await expect(period.locator('.date-text')).toBeVisible();
  expect((await period.boundingBox()).width).toBeGreaterThan(rect.width);
 }
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);
});
