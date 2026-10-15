import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
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
 const ready={dispatcher:'#orderList .kcard',requests:'#jobList .kcard',trips:'#tripList .kcard',request:'#requestContext dd',assignment:'#orderRecordResult',engineer:'#orderRecordResult',trip:'#tpReviewSummary button',catalog:'#catList .emrow',fleet:'#vehList .pt',people:'#usersList .staff-row',notifications:'.notice-row',schedule:'.vg-feed'};await expect(page.locator(ready[name]).first()).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);await expect(page.locator('.view.active')).toBeVisible();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
 mkdirSync('test-results/workspace-review/'+info.project.name,{recursive:true});
 await page.screenshot({path:'test-results/workspace-review/'+info.project.name+'/'+name+'.png',animations:'disabled',caret:'hide'});
 const metrics=await page.evaluate(()=>Object.fromEntries(['#orderList','.workspace-board-heading','#orderRecordResult','.entity-header-actions','.view.active .workspace-masthead','.view.active .workspace-main'].map(s=>{const e=document.querySelector(s);if(!e)return [s,null];const r=e.getBoundingClientRect(),c=getComputedStyle(e);return [s,{x:r.x,y:r.y,w:r.width,h:r.height,display:c.display,visibility:c.visibility,text:e.textContent.slice(0,180)}];})));writeFileSync('test-results/workspace-review/'+info.project.name+'/'+name+'.json',JSON.stringify(metrics));
});
