import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

// Fast, complete screen captures for composition review. The full functional
// suite remains a separate release gate and keeps its interaction assertions.
const screens=[
 ['dispatcher','planner/orders','logist'],['requests','planner/jobs','logist'],['trips','planner/trips','logist'],
 ['request','job/'+fixtureIDs.job,'logist'],['assignment','order/'+fixtureIDs.activeOrder,'logist'],['trip','trip/'+fixtureIDs.trip,'logist'],
 ['catalog','catalog','logist'],['fleet','settings','admin','fleet'],['people','settings','admin','users'],
 ['notifications','notifications','logist'],['schedule','dash','logist'],['engineer','order/'+fixtureIDs.activeOrder,'engineer']
];
for(const [name,route,role,section] of screens)test('workspace review '+name,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme});
 await page.goto('/#/'+route);await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 if(section)await page.locator('[data-sec="'+section+'"]').click();
 await page.evaluate(()=>document.fonts.ready);await expect(page.locator('.view.active')).toBeVisible();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
 mkdirSync('test-results/workspace-review/'+info.project.name,{recursive:true});
 await page.screenshot({path:'test-results/workspace-review/'+info.project.name+'/'+name+'.png',animations:'disabled',caret:'hide'});
});
