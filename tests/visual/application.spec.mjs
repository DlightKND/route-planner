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
  {name:'request',route:'job/'+fixtureIDs.job,view:'job',ready:'#jobTitle'},
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
const forRole = (scene,role) => role==='admin' ? scene.admin : role==='logist' ? !scene.admin : ['dashboard-graph','request','task','task-active','trip'].includes(scene.name);
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
  expect(await page.evaluate(()=>window.__visualQA.queryErrors),'Task projections match the database schema').toEqual([]);
  expect(measurements.documentWidth,'No document horizontal overflow').toBeLessThanOrEqual(measurements.viewport+1);
  expect(measurements.bodyWidth,'No body horizontal overflow').toBeLessThanOrEqual(measurements.viewport+1);
  if(measurements.paneWidth)expect(measurements.paneScrollWidth,'Only local schedule/table/kanban regions may scroll horizontally').toBeLessThanOrEqual(measurements.paneWidth+1);
  expect(measurements.theme).toBe(testInfo.project.metadata.theme);
  for(const nav of await active.locator('.entity-tabs:visible').all()){
    expect(await nav.evaluate(el=>getComputedStyle(el).flexWrap),'Entity tabs remain one locally scrollable row').toBe('nowrap');
    const touch=await page.evaluate(()=>matchMedia('(pointer:coarse)').matches);
    for(const tab of await nav.getByRole('tab').all())expect((await tab.boundingBox()).height,'Tab touch target').toBeGreaterThanOrEqual(touch?44:40);
  }
  const controls=await active.evaluate(root=>{
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const fields='input:not([type]),input[type=text],input[type=date],input[type=number],input[type=search],input[type=email],input[type=tel],select,textarea';
    return [...root.querySelectorAll(fields+',button.btn,.entity-tabs button')].filter(visible).filter(el=>!el.closest('.leaflet-control,.vg-grid,.gt-grid')).map(el=>{
      const s=getComputedStyle(el);return {label:el.id||el.getAttribute('aria-label')||el.textContent.trim().slice(0,50)||el.tagName,field:el.matches(fields),btn:el.matches('button.btn'),radius:parseFloat(s.borderTopLeftRadius),font:s.fontFamily,transform:s.textTransform,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),before:getComputedStyle(el,'::before').content};
    });
  });
  for(const control of controls){
    expect(control.radius,`${control.label}: rounded control`).toBeGreaterThanOrEqual(8);
    expect(control.font,`${control.label}: shared Sans font`).toMatch(/IBM Plex Sans/i);
    expect(control.transform,`${control.label}: sentence case`).toBe('none');
    if(control.field)expect(Math.min(...control.padding),`${control.label}: readable inner padding`).toBeGreaterThanOrEqual(8);
    else if(control.btn)expect(control.before,`${control.label}: no animated gradient pseudo-element`).toBe('none');
  }
  for(const field of await active.locator(':is(.entity-activity-form,.responsibility-form) label>:is(input,select,textarea):visible').all()){
    expect(await field.evaluate(el=>parseFloat(getComputedStyle(el).marginTop)),'Comment and responsibility fields have a full label gap').toBeGreaterThanOrEqual(8);
  }
  const reasonGap=await active.evaluate(root=>{
    const reason=root.querySelector('#tpChangeReasonGroup'),notes=root.querySelector('#tpNotes');
    if(!reason||!notes||!reason.getClientRects().length||!notes.getClientRects().length)return null;
    return {gap:reason.getBoundingClientRect().top-notes.getBoundingClientRect().bottom,minimum:16};
  });
  if(reasonGap)expect(reasonGap.gap,'Plan change reason is grouped inside its card with a full field gap').toBeGreaterThanOrEqual(reasonGap.minimum-0.5);
  const sectionGaps=await active.evaluate(root=>[...root.querySelectorAll(':is(.entity-tab-panel,[data-entity-panel])>:is(.trip-grid,.order-grid)')].flatMap(grid=>{
    const next=grid.nextElementSibling;
    if(!next?.matches('.card')||!grid.getClientRects().length||!next.getClientRects().length)return [];
    return [{id:next.id,gap:next.getBoundingClientRect().top-grid.getBoundingClientRect().bottom,minimum:innerWidth<=760?16:24}];
  }));
  for(const item of sectionGaps)expect(item.gap,`${item.id}: full gap after the form grid`).toBeGreaterThanOrEqual(item.minimum-0.5);
  const historyGap=await active.evaluate(root=>{const log=root.querySelector('#tpHistoryLog'),card=root.querySelector('#tripResponsibilitySection');return log?.getClientRects().length&&card?.getClientRects().length?card.getBoundingClientRect().top-log.getBoundingClientRect().bottom:null;});
  if(historyGap!==null)expect(historyGap,'Trip history is separated from its responsibility card').toBeGreaterThanOrEqual((testInfo.project.use.viewport.width<=760?16:24)-0.5);

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
async function visibleTarget(locator) {
  await expect(locator).toBeInViewport({ratio:1});
  await expect.poll(()=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),x=Math.min(8,r.width/4),y=Math.min(8,r.height/4);return [[r.left+r.width/2,r.top+r.height/2],[r.left+x,r.top+y],[r.right-x,r.top+y],[r.left+x,r.bottom-y],[r.right-x,r.bottom-y]].every(([px,py])=>el.contains(document.elementFromPoint(px,py)));}),{message:'Revealed target must not sit behind sticky UI'}).toBe(true);
}
async function reveal(locator) {
  await locator.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  await visibleTarget(locator);
}
async function checkedPane(page,active,panel,audit,testInfo) {
  await expect(panel).toBeVisible();
  const minimum=await page.evaluate(()=>innerWidth<=760?16:24);
  await expect.poll(()=>panel.evaluate(el=>{const toolbar=el.closest('.view').querySelector('.entity-toolbar');return el.getBoundingClientRect().top-toolbar.getBoundingClientRect().bottom;}),{message:'Active panel starts below sticky toolbar with the shared card gap'}).toBeGreaterThanOrEqual(minimum-0.5);
  await integrity(page,active,audit,testInfo);
}
for(const role of ['logist','engineer','admin'])for(const source of scenes.filter(scene=>forRole(scene,role))) {
  const scene=role==='engineer'&&source.name==='dashboard-graph'?{...source,route:'planner/mine',view:'planner',ready:'#plMine .vg-feed'}:source;
  test(`${role} ${scene.name}`,async({page,context},testInfo)=>{
    const {active,audit}=await openScene(page,context,testInfo,role,scene);
    if(scene.name==='request')for(const action of await active.locator('.th-acts .btn:visible').all())await visibleTarget(action);
    if(scene.name==='catalog')await expect(active.locator('#catList')).toContainText('Диагностика гидросистемы');
    if(scene.view==='catalog'){
      const tab=active.locator('.subtab.active:visible');
      await expect(tab).toHaveCount(1);
      const style=await tab.evaluate(el=>{const s=getComputedStyle(el);return {radius:s.borderBottomLeftRadius,border:s.borderBottomStyle,width:parseFloat(s.borderBottomWidth)};});
      expect(style.radius,'Catalog underline has square corners').toBe('0px');
      expect(style.border).toBe('solid');
      expect(style.width).toBeGreaterThanOrEqual(2);
    }
    if(scene.name==='map'){
      const checkCards=async selector=>{
        const cards=active.locator(selector);
        await expect(cards.first()).toBeVisible();
        for(const card of await cards.all()){
          const style=await card.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth].map(parseFloat),left:parseFloat(s.borderLeftWidth)};});
          expect(style.background,'Map cards have a visible surface').not.toBe('rgba(0, 0, 0, 0)');
          expect(Math.min(...style.borders),'Map cards have a complete frame').toBeGreaterThanOrEqual(1);
          expect(style.left,'Status/client color retains its left edge').toBe(3);
        }
      };
      await checkCards('#workFeed .wf-row');
      await shot(page,testInfo,'logist-map-work-cards');
      await active.locator('#mapScope [data-ms=all]').click();
      await checkCards('#list .pt');
      await shot(page,testInfo,'logist-map-directory-cards');
      await active.locator('#mapScope [data-ms=work]').click();
    }
    if(scene.statistics){
      await expect(active.locator('[data-dcard=fin] .finance-scope-summary')).toContainText('подтверждено 1 из 2');
      await expect(active.locator('[data-dcard=fin] .summary-total').last()).toContainText('350');
      await expect(active.locator('#dashBody .rangebar')).toHaveCount(1);
      await expect(active.locator('#dashBody .summary-section')).toHaveCount(3);
    }
    if(scene.name==='trip'){
      if(testInfo.project.use.viewport.width>1050){
        const bounds=await active.evaluate(root=>['.wb-plan-card','.wb-route-card'].map(selector=>{const r=root.querySelector(selector).getBoundingClientRect();return {top:r.top,height:r.height,width:r.width};}));
        expect(Math.abs(bounds[0].top-bounds[1].top),'Plan and route share a baseline').toBeLessThan(1);
        expect(Math.abs(bounds[0].height-bounds[1].height),'Plan and route share a height').toBeLessThan(1);
        expect(bounds[1].width/bounds[0].width,'Balanced route/plan widths').toBeLessThan(1.5);
      }
      await visibleTarget(active.locator('#tpFrom'));
      if(role==='engineer'){
        await expect(active.locator('#tpSave')).toBeHidden();
        await expect(active.locator('#tpChangeReasonGroup')).toBeHidden();
      }else{
        await expect(active.locator('#tpSave')).toBeVisible();
        await expect(active.locator('#tpChangeReasonGroup')).toBeVisible();
      }
    }
    if(testInfo.project.use.viewport.width<=390&&scene.name.startsWith('dispatcher')){
      expect(await active.locator('.stickyhead:visible').evaluate(el=>el.getBoundingClientRect().height),'Compact mobile dispatcher header').toBeLessThanOrEqual(190);
      const filter=active.locator('.planner-filter-menu:visible');
      if(await filter.count()){
        await filter.locator('summary').click();await expect(filter.locator('select').first()).toBeVisible();
        await visibleTarget(filter.locator('select').first());
        await shot(page,testInfo,role+'-'+scene.name+'-filters');
        await page.keyboard.press('Escape');
        await expect(filter).not.toHaveAttribute('open','');
        await expect(filter.locator('summary')).toBeFocused();
      }
    }
    if(scene.view==='dash'&&role==='logist'){
      expect(await active.locator('#dashSeg .on').evaluate(el=>getComputedStyle(el).boxShadow),'No crescent in dashboard switch').toBe('none');
    }
    const paths=await shot(page,testInfo,`${role}-${scene.name}`);
    writeFileSync(join(paths,`${role}-${scene.name}.json`),JSON.stringify(await integrity(page,active,audit,testInfo),null,2));
    if(scene.statistics){
      for(const cell of await active.locator('.summary-table td').all()){
        expect(await cell.evaluate(el=>({wrap:getComputedStyle(el).whiteSpace,fits:el.scrollWidth<=el.clientWidth+1})), 'Complete financial numbers stay on one line').toEqual({wrap:'nowrap',fits:true});
      }
      if(!(await active.locator('.load-chart').isVisible()))await active.locator('.summary-load-details>summary').click();
      await reveal(active.locator('.chart-plot'));
      await expect(active.locator('.chart-y-axis')).toContainText('0');
      await shot(page,testInfo,`${role}-${scene.name}-chart`);
      await active.getByText('Данные по дням',{exact:true}).click();
      const header=active.locator('.chart-data thead');
      await reveal(header.locator("th").first());
      await shot(page,testInfo,`${role}-${scene.name}-data`);
    }
    if(scene.name==='request'){
      await expect(active.locator('[data-request-pane]:not([hidden])')).toHaveAttribute('data-request-pane',role==='engineer'?'execution':'overview');
      for(const key of ['estimate','execution','history','overview']){
        await active.locator(`[data-request-tab="${key}"]`).click();
        const panel=active.locator(`[data-request-pane="${key}"]`);
        await expect(panel).toBeVisible();await expect(active.locator('[data-request-pane]:not([hidden])')).toHaveCount(1);
        await checkedPane(page,active,panel,audit,testInfo);
        const heading=panel.locator('h3:visible').first();if(await heading.count())await reveal(heading);
        await shot(page,testInfo,`${role}-request-${key}`);
      }
    }
    if(['task','task-active'].includes(scene.name)){
      const expectedDefault=scene.name==='task'?'scope':'result';
      await expect(active.locator(`[data-entity-panel="${expectedDefault}"]`)).toBeVisible();
      for(const [key,label] of [['travel','Выезды'],['history','История'],['scope','Состав'],['result','Результат']]){
        await active.getByRole('tab',{name:label,exact:true}).click();
        await expect(active.locator(`[data-entity-panel="${key}"]`)).toBeVisible();
        await expect(active.locator('[data-entity-panel]:not([hidden])')).toHaveCount(1);
        await checkedPane(page,active,active.locator(`[data-entity-panel="${key}"]`),audit,testInfo);
        await visibleTarget(active.locator(`[data-entity-panel="${key}"] h3:visible`).first());
        await shot(page,testInfo,`${role}-${scene.name}-${key}`);
      }
      const historyTab=active.getByRole('tab',{name:'История',exact:true});await historyTab.focus();await page.keyboard.press('Home');
      await expect(active.getByRole('tab',{name:'Состав',exact:true})).toBeFocused();
      await checkedPane(page,active,active.locator('#orderPane-scope'),audit,testInfo);
      await page.keyboard.press('ArrowRight');await expect(active.getByRole('tab',{name:'Результат',exact:true})).toBeFocused();
      await checkedPane(page,active,active.locator('#orderPane-result'),audit,testInfo);
      await shot(page,testInfo,`${role}-${scene.name}-tab-focus`);
      await active.getByRole('tab',{name:'Результат',exact:true}).click();
      await reveal(active.locator('#orderExecution > h3'));
      if(scene.name==='task-active')await expect(active.locator('[data-result-qty]').first()).toBeEnabled();
      else await expect(active.locator('[data-result-qty]').first()).toBeDisabled();
      await shot(page,testInfo,`${role}-${scene.name}-result`);
      await active.getByRole('tab',{name:'Состав',exact:true}).click();
      await checkedPane(page,active,active.locator('#orderPane-scope'),audit,testInfo);
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
      await checkedPane(page,active,active.locator('#tpPresencePane'),audit,testInfo);
      await visibleTarget(active.locator('#tpPresenceTitle'));
      await expect(active.locator('.wb-table')).toBeVisible();
      if(role==='engineer'){
        await expect(active.locator('#tpPresence input,#tpPresence select,#tpPresence textarea,#tpPresence button')).toHaveCount(0);
        await expect(active.locator('#wbPresenceSave,#wbDetect,[data-presence-edit]')).toHaveCount(0);
        await expect(active.locator('#tpPresence')).toContainText('Ожидает проверки');
      }else{await expect(active.locator('#wbPresenceSave')).toBeVisible();}

      await shot(page,testInfo,`${role}-trip-presence`);
      await reveal(active.locator('.wb-task-share').first());
      await shot(page,testInfo,`${role}-trip-presence-task-share`);
      await active.locator('#tpTabEconomy').click();
      await checkedPane(page,active,active.locator('#tpEconomyPane'),audit,testInfo);
      await visibleTarget(active.locator('#tpEconomyPane h3:visible').first());
      await shot(page,testInfo,`${role}-trip-economics-tab`);
      await active.locator('#tpTabPlan').click();
      await checkedPane(page,active,active.locator('#tpPlanPane'),audit,testInfo);
      await shot(page,testInfo,`${role}-trip-plan-return`);
      await reveal(active.locator('#tpReviewCosts'));
      await active.locator('#tpReviewCosts').click();
      await expect(active.locator('#tpEconomyPane')).toBeVisible();
      await checkedPane(page,active,active.locator('#tpTripAllocation'),audit,testInfo);
      await visibleTarget(active.locator('#tpTripAllocation h3').first());
      await shot(page,testInfo,`${role}-trip-economics`);
      await active.locator('#tpTabHistory').click();
      await checkedPane(page,active,active.locator('#tpHistoryPane'),audit,testInfo);
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
