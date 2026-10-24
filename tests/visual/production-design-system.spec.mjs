import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
import {auditApplicationDesign} from './application-design-audit.mjs';
import {mkdirSync} from 'node:fs';
async function boot(page,info,route='dash',role='logist'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme});
 await page.goto('/#/'+route);await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await page.evaluate(()=>document.fonts.ready);return errors;
}
for(const role of ['logist','engineer','admin'])test('production components cover every accessible section: '+role,async({page},info)=>{
 test.setTimeout(120000);const errors=await boot(page,info,'dash',role);
 const routes=['dash','notifications','job/'+fixtureIDs.job,'order/'+fixtureIDs.activeOrder,'trip/'+fixtureIDs.trip,'settings'];
 if(role!=='engineer')routes.push('planner/jobs','planner/orders','planner/trips','catalog','map');
 const dir='test-results/production-design/'+info.project.name;mkdirSync(dir,{recursive:true});
 const capture=async name=>{
  await expect(page.locator('.view.active .shim')).toHaveCount(0);await test.step(name,()=>auditApplicationDesign(page,page.locator('body'),{soft:true}));
  await page.screenshot({path:dir+'/'+role+'-'+name.replaceAll('/','-')+'.png',animations:'disabled'});
 };
 for(const route of routes){
  await page.goto('/#/'+route);const section=route.split('/')[0],view=section==='dash'&&role==='engineer'?'planner':section;await expect(page.locator('.view-'+view+'.active')).toBeVisible();await capture(route);
  if(route==='settings'&&role==='admin')for(const name of ['tariffs','fleet','users','theme']){
   await page.locator('#settingsNav [data-sec='+name+']').click();await expect(page.locator('.settings-body [data-sec-panel='+name+']').first()).toBeVisible();await capture('settings-'+name);
  }
  if(route==='catalog')for(const name of ['works','models','materials']){
   await page.locator('.catalog-main-nav [data-csub='+name+']').click();await capture('catalog-'+name);
  }
 }
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('production searchable crew picker keeps native selection and measured mini-pill',async({page},info)=>{
 const errors=await boot(page,info,'trip/'+fixtureIDs.trip);const trigger=page.locator('#tpEng + .engineer-picker');await trigger.click();const panel=page.locator('.engineer-options');await expect(panel).toBeVisible();
 await panel.getByRole('searchbox',{name:'Поиск инженеров'}).fill('zz-no-match');await expect(panel.locator('label:visible')).toHaveCount(0);await expect(panel).toContainText('Никого не найдено');await panel.getByRole('searchbox').fill('');await expect(panel.locator('label:visible').first()).toBeVisible();
 await auditApplicationDesign(page,panel);await panel.getByRole('button',{name:'Готово',exact:true}).click();await expect(trigger).toBeFocused();
 const count=trigger.locator('.engineer-picker-count');expect((await count.boundingBox()).height).toBe(22);expect(await count.innerText()).toBe(String(await page.locator('#tpEng').evaluate(el=>el.selectedOptions.length)));expect(errors).toEqual([]);
});
test('production command hover and pressed layers remain distinct without moving the label',async({page},info)=>{
 const errors=await boot(page,info,'planner/orders');const button=page.locator('#orderAdd');await expect(button).toBeVisible();
 const read=()=>button.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,image:s.backgroundImage,text:el.textContent};});
 const base=await read();let hover=null;
 if(!info.project.use.hasTouch){await button.hover();hover=await read();expect(hover.image).not.toBe(base.image);}
 const b=await button.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();const pressed=await read();expect(pressed.image).not.toBe(base.image);if(hover)expect(pressed.image).not.toBe(hover.image);
 expect({width:pressed.width,height:pressed.height,text:pressed.text}).toEqual({width:base.width,height:base.height,text:base.text});await page.mouse.move(0,0);await page.mouse.up();expect(errors).toEqual([]);
});

test('production route keeps point creation secondary and FAB pressed geometry stable',async({page},info)=>{
 const errors=await boot(page,info,'map');await page.locator('#sideTabs [data-sb=route]').click();
 const fab=page.locator('#pointToolsFab .fab-add');await expect(fab).toHaveAttribute('data-ui-variant','secondary');await auditApplicationDesign(page);
 if(await fab.isVisible()){
  const before=await fab.boundingBox();await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();
  expect(await fab.evaluate(el=>getComputedStyle(el).backgroundImage)).not.toBe('none');const pressed=await fab.boundingBox();expect(pressed).toEqual(before);await page.mouse.move(0,0);await page.mouse.up();
 }
 expect(errors).toEqual([]);
});

test('production inline catalogue editor owns the primary command until it closes',async({page},info)=>{
 const errors=await boot(page,info,'catalog');await page.locator('.catalog-main-nav [data-csub=models]').click();
 const create=page.locator('#emShowAdd');await expect(create).toHaveAttribute('data-ui-variant','primary');await create.click();await expect(page.locator('#emForm')).toBeVisible();
 await expect(create).toHaveAttribute('data-ui-variant','secondary');await expect(page.locator('#emSave')).toHaveAttribute('data-ui-variant','primary');await auditApplicationDesign(page);
 await page.locator('#emCancel').click();await expect(page.locator('#emForm')).toBeHidden();await expect(create).toHaveAttribute('data-ui-variant','primary');expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
