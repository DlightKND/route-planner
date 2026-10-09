import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';
async function open(page,info,{role='engineer',journey='engineer',route='planner/mine'}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.setFixedTime(new Date('2026-10-06T07:00:00Z'));await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,approvalJourney:journey,scheduleJourney:true});await page.goto('/#/'+route);await expect(page.locator('#appRoot')).toBeVisible();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();return errors;
}
async function day(page){const box=page.locator('.vg-block[data-gb="t'+fixtureIDs.trip+'"]').first().locator('xpath=ancestor::*[@data-gtbox]');await box.locator('[data-gday="2026-10-05"]').click();await expect(box.locator('.vg-day-grid')).toBeVisible();return box;}
async function dragLine(page,box,kind,delta){const line=box.locator('[data-winline="'+kind+'"]').first();await expect(line).toBeEnabled();await line.scrollIntoViewIfNeeded();const b=await line.boundingBox();await page.mouse.move(b.x+3,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+3,b.y+b.height/2+delta,{steps:8});await page.mouse.up();}
async function clean(page,errors){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}

test('engineer cannot create tasks and mobile search uses the available action slots',async({page},info)=>{
 const errors=await open(page,info,{route:'planner/orders'});await expect(page.locator('#orderList .kcard').first()).toBeVisible();await expect(page.locator('#orderAdd')).toBeHidden();
 await page.locator('#orderList [data-order-open]').first().click();await expect(page.locator('#orderEditor')).toBeVisible();await expect(page.locator('#orderExtra')).toHaveCount(0);await expect(page.locator('#orderCarry')).toHaveCount(0);
 await page.goto('/#/planner/orders');if(page.viewportSize().width<=760){const [search,dots]=await Promise.all([page.locator('#orderSearch').boundingBox(),page.locator('#plOrders .dispatcher-more>summary').boundingBox()]);expect(Math.abs(search.y-dots.y)).toBeLessThanOrEqual(1);expect(dots.x).toBeGreaterThanOrEqual(search.x+search.width);}
 await clean(page,errors);
});

test('engineer expands start immediately and later start waits for manager approval',async({page},info)=>{
 const errors=await open(page,info),box=await day(page);await dragLine(page,box,'start',-10);
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(1);await expect(box.locator('[data-winline=start]').first()).toContainText('06:30');await expect(box.locator('[data-winline=end]').first()).toContainText('16:00');
 await dragLine(page,box,'start',10);await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(2);await expect(box.locator('[data-winline=start]').first()).toContainText('06:30');await expect(box.locator('.vg-request')).toContainText('06:30 → 07:00');await expect(box.locator('[data-approval-action=approve]')).toHaveCount(0);
 await page.goto('/#/planner/approvals');await expect(page.locator('#approvalHost')).toContainText('Начало дня: 06:30 → 07:00');await page.locator('#approvalHost [data-approval-action=cancel]').click();await expect(page.locator('#approvalHost')).toContainText('Согласований на рассмотрении нет');
 await page.screenshot({path:'test-results/approvals/'+info.project.name+'-engineer-cancel.png'});await clean(page,errors);
});

test('engineer can split own day without applying the plan before approval',async({page},info)=>{
 const errors=await open(page,info),box=await day(page),piece=box.locator('.vg-piece[data-gb="t'+fixtureIDs.trip+'"]').filter({hasNot:page.locator('.road')}).first();
 await piece.locator('[data-gdivide]').click();await piece.locator('.vg-cut-handle').focus();await page.keyboard.press('ArrowDown');await piece.locator('[data-cut-ok]').click();
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(1);expect(await page.evaluate(()=>window.__visualQA.scheduleWrites)).toEqual([]);await expect(box.locator('.vg-request')).toContainText('после');await expect(box.locator('.vg-piece[data-gb="t'+fixtureIDs.trip+'"]').filter({hasNot:page.locator('.road')})).toHaveCount(1);
 await page.goto('/#/planner/approvals');await expect(page.locator('#approvalHost')).toContainText('Разделение блока');await expect(page.locator('[data-approval-action=approve]')).toHaveCount(0);await page.screenshot({path:'test-results/approvals/'+info.project.name+'-split-pending.png'});await clean(page,errors);
});
for(const action of ['approve','reject','delegate'])test('manager '+action+' shows state and prevents a second decision after escalation',async({page},info)=>{
 const errors=await open(page,info,{role:'logist',journey:true,route:'planner/approvals'});await expect(page.locator('#approvalHost')).toContainText('07:00 → 08:00');await page.locator('[data-approval-action='+action+']').click();
 if(action!=='approve'){await expect(page.locator('#promptOverlay')).toBeVisible();await page.locator('#promptFields textarea').fill('Проверка на следующем уровне');await page.locator('#promptYes').click();}
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(1);
 if(action==='delegate'){await expect(page.locator('#approvalHost')).toContainText('Иван Коваленко');await expect(page.locator('[data-approval-action=approve]')).toHaveCount(0);await page.locator('.approval-card details').first().locator('summary').click();await expect(page.locator('#approvalHost')).toContainText('передал выше');}
 else{await expect(page.locator('.approval-closed')).toContainText('Рассмотренные');await page.locator('.approval-closed>summary').click();await expect(page.locator('.approval-card')).toContainText(action==='approve'?'Согласовано':'Отклонено');}
 expect(await page.locator('#approvalHost').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:'test-results/approvals/'+info.project.name+'-manager-'+action+'.png'});await clean(page,errors);
});


test('engineer increases tolerance immediately and decrease requires approval',async({page},info)=>{
 const errors=await open(page,info),box=await day(page);await dragLine(page,box,'tol',10);await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(1);await expect(box.locator('[data-winline=tol]').first()).toContainText('17:30');
 await dragLine(page,box,'tol',-10);await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(2);await expect(box.locator('[data-winline=tol]').first()).toContainText('17:30');await expect(box.locator('.vg-request')).toContainText('Допуск: 01:30 → 01:00');await clean(page,errors);
});

test('touch gesture changes the engineer start line without jumping on contact',async({page},info)=>{
 test.skip(!info.project.use.hasTouch,'Touch viewport required');const errors=await open(page,info),box=await day(page),line=box.locator('[data-winline=start]').first();await line.scrollIntoViewIfNeeded();const b=await line.boundingBox(),x=b.x+3,y=b.y+b.height/2,cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});expect(await page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(0);
 for(let d=2;d<=10;d+=2)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-d}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 await expect.poll(()=>page.evaluate(()=>window.__visualQA.approvalWrites.length)).toBe(1);await expect(box.locator('[data-winline=start]').first()).toContainText('06:30');await clean(page,errors);
});
