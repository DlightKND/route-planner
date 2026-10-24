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
 for(const route of routes){await page.goto('/#/'+route);const section=route.split('/')[0],view=section==='dash'&&role==='engineer'?'planner':section;await expect(page.locator('.view-'+view+'.active')).toBeVisible();await expect(page.locator('.view.active .shim')).toHaveCount(0);await auditApplicationDesign(page);await page.screenshot({path:dir+'/'+role+'-'+route.replaceAll('/','-')+'.png',animations:'disabled'});}
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
