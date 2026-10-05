import { test, expect } from '@playwright/test';
import { installMockBackend, fixtureIDs } from './mock-backend.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const scenes = [
  {name:'dashboard-graph',route:'dash',view:'dash',ready:'#attnBody .vg-feed'},
  {name:'dashboard-statistics',route:'dash',view:'dash',ready:'#dashBody .card[data-dcard=fin]',statistics:true},
  {name:'dispatcher',route:'planner/orders',view:'planner',ready:'#orderList .kcard'},
  {name:'dispatcher-requests',route:'planner/jobs',view:'planner',ready:'#jobList .kcard'},
  {name:'dispatcher-trips',route:'planner/trips',view:'planner',ready:'#tripList .kcard'},
  {name:'request',route:'job/'+fixtureIDs.job,view:'job',ready:'#jobOrders .order-children'},
  {name:'task',route:'order/'+fixtureIDs.order,view:'order',ready:'#orderEditor .order-grid'},
  {name:'task-active',route:'order/'+fixtureIDs.activeOrder,view:'order',ready:'#orderResultSave'},
  {name:'trip',route:'trip/'+fixtureIDs.trip,view:'trip',ready:'#tpReviewSummary'},
  {name:'catalog',route:'catalog',view:'catalog',ready:'#catList .emrow'},
  {name:'catalog-models',route:'catalog',view:'catalog',catalog:'models',ready:'#emList .emrow'},
  {name:'catalog-materials',route:'catalog',view:'catalog',catalog:'materials',ready:'#stockList .stock-row'},
  {name:'map',route:'map',view:'map',ready:'.leaflet-container'},
  {name:'settings',route:'settings',view:'settings',ready:'#stCur',admin:true},
  {name:'settings-fleet',route:'settings',view:'settings',section:'fleet',ready:'#vehList .pt',admin:true},
  {name:'settings-users',route:'settings',view:'settings',section:'users',ready:'#usersList .staff-row',admin:true},
  {name:'settings-appearance',route:'settings',view:'settings',section:'theme',ready:'#dtMode',admin:true},
];
const forRole = (scene,role) => role==='admin' ? scene.admin : role==='logist' ? !scene.admin : ['dashboard-graph','task','task-active','trip'].includes(scene.name);
async function openScene(page,context,testInfo,role,scene) {
  const audit={errors:[],remoteAPIs:[]};
  page.on('pageerror',e=>audit.errors.push(e.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin==='http://127.0.0.1:4173')return route.continue();
    if(url.hostname.includes('supabase')||url.pathname.includes('/rest/v1/')||url.pathname.includes('/auth/v1/'))audit.remoteAPIs.push(url.origin+url.pathname);
    return route.abort();
  });
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role,theme:testInfo.project.metadata.theme});
  await page.goto('/#/'+scene.route);
  const active=page.locator('.view-'+scene.view+'.active');
  await expect(active).toBeVisible();
  const reminder=page.locator('#todayLater');
  if(await reminder.isVisible())await reminder.click();
  await expect(page.locator('.overlay.on')).toHaveCount(0);
  if(scene.catalog)await active.locator('[data-csub='+scene.catalog+']:visible').click();
  if(scene.section)await active.locator('[data-sec='+scene.section+']').click();
  if(scene.statistics&&testInfo.project.use.viewport.width<=1180)await active.locator('[data-dv=cards]').click();
  await expect(active.locator(scene.ready).first()).toBeVisible();
  await expect(active.locator('.shim')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  return {active,audit};
}
async function integrity(page,active,audit,testInfo) {
  const measurements=await page.evaluate(()=>{
    const view=document.querySelector('.view.active'),pane=view.querySelector('.pane');
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,viewWidth:Math.round(view.getBoundingClientRect().width),paneWidth:pane?.clientWidth,paneScrollWidth:pane?.scrollWidth,theme:document.documentElement.dataset.theme,blockedWrites:window.__visualQA.blockedWrites,reads:window.__visualQA.reads};
  });
  expect(audit.remoteAPIs,'No production API traffic').toEqual([]);
  expect(audit.errors,'No runtime errors').toEqual([]);
  expect(measurements.blockedWrites,'No attempted fixture writes').toEqual([]);
  expect(measurements.documentWidth,'No document horizontal overflow').toBeLessThanOrEqual(measurements.viewport+1);
  expect(measurements.bodyWidth,'No body horizontal overflow').toBeLessThanOrEqual(measurements.viewport+1);
  if(measurements.paneWidth)expect(measurements.paneScrollWidth,'Only local schedule/table/kanban regions may scroll horizontally').toBeLessThanOrEqual(measurements.paneWidth+1);
  expect(measurements.theme).toBe(testInfo.project.metadata.theme);
  await expect(page.locator('#authOverlay')).not.toHaveClass(/\bon\b/);
  await expect(active).not.toContainText('Не удалось загрузить');
  return measurements;
}
async function shot(page,testInfo,name) {
  const path=join('test-results','visual-screenshots',testInfo.project.name);
  mkdirSync(path,{recursive:true});
  const file=join(path,name+'.png');
  await page.screenshot({path:file,animations:'disabled',caret:'hide'});
  await testInfo.attach(name,{path:file,contentType:'image/png'});
  return path;
}
async function reveal(locator) {
  await locator.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  await expect(locator).toBeInViewport({ratio:1});
  await expect.poll(()=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),{message:'Revealed target must not sit behind sticky UI'}).toBe(true);
}
for(const role of ['logist','engineer','admin'])for(const source of scenes.filter(scene=>forRole(scene,role))) {
  const scene=role==='engineer'&&source.name==='dashboard-graph'?{...source,route:'planner/mine',view:'planner',ready:'#plMine .vg-feed'}:source;
  test(`${role} ${scene.name}`,async({page,context},testInfo)=>{
    const {active,audit}=await openScene(page,context,testInfo,role,scene);
    if(scene.name==='catalog')await expect(active.locator('#catList')).toContainText('Диагностика гидросистемы');
    if(scene.statistics){
      await expect(active.locator('[data-dcard=fin] .finance-scope-summary')).toContainText('подтверждено 1 из 2');
      await expect(active.locator('[data-dcard=fin] .hero')).toContainText('350');
    }
    if(scene.name==='trip'){
      if(role==='engineer'){
        await expect(active.locator('#tpSave')).toBeHidden();
        await expect(active.locator('#tpChangeReasonGroup')).toBeHidden();
      }else{
        await expect(active.locator('#tpSave')).toBeVisible();
        await expect(active.locator('#tpChangeReasonGroup')).toBeVisible();
      }
    }
    const paths=await shot(page,testInfo,`${role}-${scene.name}`);
    writeFileSync(join(paths,`${role}-${scene.name}.json`),JSON.stringify(await integrity(page,active,audit,testInfo),null,2));
    if(scene.statistics){
      if(!(await active.locator('.load-chart').isVisible()))await active.getByRole('button',{name:'По дням',exact:true}).click();
      await reveal(active.locator('.chart-plot'));
      await expect(active.locator('.chart-y-axis')).toContainText('0');
      await shot(page,testInfo,`${role}-${scene.name}-chart`);
      await active.getByText('Данные по дням',{exact:true}).click();
      const header=active.locator('.chart-data thead');
      await reveal(header.locator("th").first());
      await shot(page,testInfo,`${role}-${scene.name}-data`);
    }
    if(['task','task-active'].includes(scene.name)){
      await active.locator('a[href="#orderExecution"]').click();
      await reveal(active.locator('#orderExecution > h3'));
      if(scene.name==='task-active')await expect(active.locator('[data-result-qty]').first()).toBeEnabled();
      else await expect(active.locator('[data-result-qty]').first()).toBeDisabled();
      await shot(page,testInfo,`${role}-${scene.name}-result`);
      await active.locator('a[href="#orderComposition"]').click();
      await reveal(active.locator('#orderComposition > h3'));
      await shot(page,testInfo,`${role}-${scene.name}-composition`);
      if(role==='logist'&&scene.name==='task'){
        const picker=active.locator('#orderCrew + .engineer-picker');
        await reveal(picker);await picker.click();
        const options=page.locator('.engineer-options');
        await expect(options).toBeVisible();
        await expect(options.locator('input').first()).toBeFocused();
        await expect(options).toBeInViewport({ratio:1});
        await shot(page,testInfo,'logist-task-crew-options');
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toBeInViewport({ratio:1});
        await page.keyboard.press('Escape');
        await expect(options).toHaveCount(0);await expect(picker).toBeFocused();
      }
    }
    if(scene.name==='dashboard-graph'){
      const block=active.locator('.vg-block').first();
      await block.click({position:{x:Math.min(12,(await block.boundingBox()).width/2),y:10}});
      await expect(page.locator('.gpop')).toBeVisible();
      await expect(page.locator('.gpop')).toBeInViewport({ratio:1});
      const close=page.locator('.gpop [data-gclose]');
      await expect(close).toBeInViewport({ratio:1});
      if(testInfo.project.use.viewport.width<=760){
        const boundary=await close.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,rail:document.querySelector('.rail').getBoundingClientRect().top}));
        expect(boundary.bottom,'Event close action stays above bottom navigation').toBeLessThanOrEqual(boundary.rail+1);
      }
      await expect(page.locator('.gpop .gp-h')).toContainText('Коммунальное');
      await shot(page,testInfo,`${role}-schedule-event`);
      await page.locator('.gpop [data-gclose]').click();
    }
    if(scene.name==='trip'){
      await active.locator('#tpReviewPresence').click();
      await expect(active.locator('#tpPlanPane')).toBeVisible();
      await reveal(active.locator('#tpPresenceTitle'));
      await expect(active.locator('.wb-table')).toBeVisible();
      if(role==='engineer'){
        await expect(active.locator('#tpPresence input,#tpPresence select,#tpPresence textarea,#tpPresence button')).toHaveCount(0);
        await expect(active.locator('#wbPresenceSave,#wbDetect,[data-presence-edit]')).toHaveCount(0);
        await expect(active.locator('#tpPresence')).toContainText('Ожидает проверки');
      }else{await expect(active.locator('#wbPresenceSave')).toBeVisible();}

      await shot(page,testInfo,`${role}-trip-presence`);
      await reveal(active.locator('.wb-task-share').first());
      await shot(page,testInfo,`${role}-trip-presence-task-share`);
      await reveal(active.locator('#tpReviewCosts'));
      await active.locator('#tpReviewCosts').click();
      await expect(active.locator('#tpEconomyPane')).toBeVisible();
      await reveal(active.locator('#tpTripAllocation h3').first());
      await shot(page,testInfo,`${role}-trip-economics`);
      await active.locator('#tpTabHistory').click();
      await expect(active.locator('#tpHistoryPane')).toBeVisible();
      await reveal(active.locator('#tpHistoryLog > h3'));
      await expect(active.locator('#tpHistoryLog')).toContainText('Уточнён порядок');
      await shot(page,testInfo,`${role}-trip-history`);
    }
    await integrity(page,active,audit,testInfo);
  });
}
// A halved CSS viewport checks the reflow width equivalent to desktop 200% zoom.
// It does not claim coverage of the browser's native zoom or the on-screen keyboard.
test.describe('reflow equivalence',()=>{
 test.use({deviceScaleFactor:2,isMobile:false,hasTouch:false});
 test('desktop 200 percent reflow',async({page,context},testInfo)=>{
  test.skip(testInfo.project.use.viewport.width<1024,'Desktop reflow equivalence');
  const original=testInfo.project.use.viewport;
  await page.setViewportSize({width:Math.floor(original.width/2),height:Math.floor(original.height/2)});
  const scene=scenes.find(s=>s.name==='dispatcher');
  const {active,audit}=await openScene(page,context,testInfo,'logist',scene);
  await expect(active.locator('#orderSearch')).toBeInViewport({ratio:1});
  await shot(page,testInfo,'logist-reflow-200');
  await integrity(page,active,audit,testInfo);
 });
});
test('keyboard focus in dispatcher',async({page,context},testInfo)=>{
  const scene=scenes.find(s=>s.name==='dispatcher');
  const {active,audit}=await openScene(page,context,testInfo,'logist',scene);
  await active.locator('#orderSearch').focus();
  await page.keyboard.press('Tab');
  const focused=page.locator(':focus');
  await expect(focused).toBeInViewport({ratio:1});
  const style=await focused.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth),bottom:el.getBoundingClientRect().bottom,rail:document.querySelector('.rail').getBoundingClientRect().top}));
  expect(style.outline).not.toBe('none');
  expect(style.width).toBeGreaterThanOrEqual(2);
  if(testInfo.project.use.viewport.width<=760)expect(style.bottom).toBeLessThanOrEqual(style.rail+1);
  await shot(page,testInfo,'logist-keyboard-focus');
  await integrity(page,active,audit,testInfo);
});
