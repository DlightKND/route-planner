import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

// The same real UI journey runs in the selected phone/desktop light/dark projects.
// Only the opt-in synthetic backend can mutate; every external request is blocked.
async function open(page,info,role){
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.continue():route.abort());
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,entityAudit:true,entityJourney:true});
  await page.goto('/#/order/'+fixtureIDs.activeOrder);
  await expect(page.locator('.view-order.active')).toBeVisible();
  if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
  await expect(page.locator('.overlay.on')).toHaveCount(0);
  await expect(page.locator('#orderRecordResult')).toBeVisible();
  await page.locator('#orderTab-history').click();
  await expect(page.locator('#orderActivity .entity-activity-feed .is-comment')).toHaveCount(3);
  await page.evaluate(()=>document.fonts.ready);
  return failures;
}
async function picture(page,info,name){
  await info.attach(name,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});
}
async function nativeDialogFits(page,dialog){
  expect(await dialog.evaluate(node=>node.tagName==='DIALOG'&&node.open)).toBe(true);
  const rect=await dialog.boundingBox(),viewport=page.viewportSize();
  expect(rect.x).toBeGreaterThanOrEqual(-1);expect(rect.y).toBeGreaterThanOrEqual(-1);
  expect(rect.x+rect.width).toBeLessThanOrEqual(viewport.width+1);
  expect(rect.y+rect.height).toBeLessThanOrEqual(viewport.height+1);
}

for(const role of ['admin','logist','engineer'])test(`${role}: cumulative result, independent drafts, filtered feed, comment and contextual actions`,async({page},info)=>{
  const failures=await open(page,info,role),activity=page.locator('#orderActivity');
  const draft='Остановка оборудования согласована на утро. Проверить доступ перед началом работ.';
  const note='Проверены насос и соединения; осталось заменить уплотнение.';
  const composer=()=>page.locator('#orderActivity textarea[name="body"]');

  // A comment has its own draft and must not dirty the task's operational form.
  await composer().fill(draft);
  await expect(page.locator('#orderSaveState')).toHaveText('Сохранено');
  await page.locator('#orderTab-scope').click();
  await page.locator('#orderTab-history').click();
  await expect(composer()).toHaveValue(draft);
  await activity.locator('[data-activity-filter="event"]').click();
  await expect(activity.locator('.entity-activity-feed .is-comment')).toHaveCount(0);
  await expect(activity.locator('.entity-activity-feed .is-event').first()).toBeVisible();
  await activity.locator('[data-activity-filter="all"]').click();
  expect(await page.evaluate(()=>window.__visualQA.entityWrites)).toEqual([]);

  // Enter totals, then close the modal and change sections before reopening it.
  await page.locator('#orderRecordResult').click();
  const result=page.locator('dialog.entity-result-dialog');await expect(result).toBeVisible();
  await nativeDialogFits(page,result);
  const work=result.locator('[data-result-item="task-active-item"]');
  await expect(work).toContainText('Выполнено всего');
  await expect(work).toContainText('ранее 2');await expect(work).toContainText('осталось 4');
  await expect(work.locator('[data-result-qty]')).toHaveValue('2');
  await work.locator('[data-result-qty]').fill('3');
  await page.locator('#orderResultNote').fill(note);
  await page.locator('#orderResultDate').fill('2026-10-05');
  await expect(page.locator('#orderResultDraftState')).toContainText('Черновик сохранён');
  await result.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('#confirmOverlay')).toBeVisible();
  await expect(page.locator('#confirmMsg')).toContainText('останется в черновике');
  await page.locator('#confirmYes').click();await expect(result).toHaveCount(0);
  await page.locator('#orderTab-scope').click();await page.locator('#orderTab-history').click();
  await expect(composer()).toHaveValue(draft);
  await page.locator('#orderRecordResult').click();await expect(result).toBeVisible();
  await expect(result.locator('[data-result-item="task-active-item"] [data-result-qty]')).toHaveValue('3');
  await expect(page.locator('#orderResultNote')).toHaveValue(note);
  await picture(page,info,role+'-result-modal');
  await page.locator('#orderResultSave').click();await expect(result).toHaveCount(0);

  // Saving produces a typed event with a cumulative snapshot, never a text comment.
  await page.locator('#orderTab-history').click();
  await page.locator('#orderActivity [data-activity-filter="result"]').click();
  const resultEntry=page.locator('#orderActivity .entity-activity-feed .is-result').filter({hasText:note});
  await expect(resultEntry).toHaveCount(1);await expect(resultEntry).toContainText('3 / 6 ч');
  await expect(resultEntry).toContainText('Выполнено 05.10.2026');
  await expect(page.locator('#orderActivity .entity-activity-feed .is-comment')).toHaveCount(0);
  await expect(page.locator('#orderActivity .entity-activity-feed .is-event')).toHaveCount(0);
  await expect(composer()).toHaveValue(draft);await expect(page.locator('#orderSaveState')).toHaveText('Сохранено');
  const afterResult=await page.evaluate(()=>window.__visualQA);
  const saved=afterResult.entityWrites.filter(w=>w.name==='service_order_record_result');
  expect(saved).toHaveLength(1);expect(saved[0].args.p_id).toBe(fixtureIDs.activeOrder);
  expect(saved[0].args.p_expected).toBe(0);expect(saved[0].args.p_note).toBe(note);
  expect(saved[0].args.p_items.find(i=>i.id==='task-active-item').done_qty).toBe(3);
  expect(saved[0].args.p_operation_id).toMatch(/^[0-9a-f-]{36}$/i);
  const event=afterResult.entityResults.find(e=>e.snapshot.note===note);
  expect(event.snapshot.items[0]).not.toHaveProperty('financial_revenue_snapshot');
  expect(event.snapshot.items[0]).not.toHaveProperty('unit_cost_snapshot');
  await picture(page,info,role+'-saved-result-feed');

  // Posting and pinning are independent from result saving and preserve authorship.
  await page.locator('#orderActivity [data-activity-filter="all"]').click();
  await page.locator('#orderActivity form button[type="submit"]').click();
  await expect(page.locator('#orderActivity form [role="status"]')).toHaveText('Комментарий добавлен.');
  await expect(composer()).toHaveValue('');
  const comment=page.locator('#orderActivity .entity-activity-feed .is-comment').filter({hasText:draft});
  await expect(comment).toHaveCount(1);
  await expect(comment.locator('header')).toContainText(role==='engineer'?'Анна Смирнова':'Демо · диспетчер');
  await expect(page.locator('#orderSaveState')).toHaveText('Сохранено');
  if(role==='engineer'){
    await expect(page.locator('#orderActivity [data-pin]')).toHaveCount(0);
  }else{
    const pin=comment.locator('[data-pin]'),header=comment.locator('header');
    const pinBox=await pin.boundingBox(),headerBox=await header.boundingBox();
    expect(pinBox.width).toBeGreaterThanOrEqual(44);expect(pinBox.height).toBeGreaterThanOrEqual(44);
    expect(pinBox.y).toBeLessThanOrEqual(headerBox.y+1);
    expect(pinBox.x+pinBox.width).toBeGreaterThanOrEqual(headerBox.x+headerBox.width-1);
    await comment.locator('[data-pin]').click();
    await expect(page.locator('dialog.entity-actions-menu')).toBeVisible();
    await page.locator('dialog.entity-actions-menu').getByRole('button',{name:'Закрепить комментарий',exact:true}).click();
    const pins=page.locator('#orderActivity .activity-pins');
    await expect(pins).toBeVisible();await expect(pins.locator('summary')).toHaveText('Закреплено · 1');
    await pins.locator('summary').click();await expect(pins).toContainText(draft);
    expect(await page.evaluate(()=>window.__visualQA.entityWrites.filter(w=>w.name==='entity_activity_pin'))).toHaveLength(1);
  }

  // Minor deadline controls live behind the contextual menu in a real modal.
  await page.locator('#orderMore').click();
  await page.locator('dialog.entity-actions-menu').getByRole('button',{name:'Изменение срока',exact:true}).click();
  const deadline=page.getByRole('dialog',{name:'Изменение срока',exact:true});
  await expect(deadline).toBeVisible();await nativeDialogFits(page,deadline);
  await expect(deadline.locator('#orderDeadlinePanel')).toBeVisible();
  if(role==='engineer')await expect(deadline.locator('#orderDeadlineDate')).toBeVisible();
  await picture(page,info,role+'-deadline-modal');
  await deadline.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(deadline).toHaveCount(0);

  const state=await page.evaluate(()=>window.__visualQA);
  expect(state.entityWrites.filter(w=>w.table==='service_order_comments'&&w.action==='insert')).toHaveLength(1);
  expect(state.blockedWrites).toEqual([]);expect(state.queryErrors).toEqual([]);expect(failures).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
});
