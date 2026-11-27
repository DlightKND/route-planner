import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

async function open(page,info,route,extra={}){
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,financeJourney:true,...extra});
  await page.goto('/#/'+route);
  await expect(page.locator('#todayLater')).toBeVisible();await page.locator('#todayLater').click();
  await expect(page.locator('.view.active')).toBeVisible();
}
test('opens a draft from its task and creates the trip only on the first save',async({page},info)=>{
  await open(page,info,'order/'+fixtureIDs.order);await page.locator('#orderTab-travel').click();
  await page.locator('#orderTripAdd').click();await expect(page.locator('.view-trip.active')).toBeVisible();
  await expect(page.locator('#tpChangeReasonGroup')).toBeHidden();
  expect(await page.evaluate(()=>window.__visualQA.reads)).not.toContain('rpc:service_order_trip');
  expect(await page.evaluate(()=>window.__visualQA.financeWrites)).toEqual([]);
  await page.locator('#tpNotes').fill('Первое заполнение');
  await page.locator('#tpSave').click();await expect(page.locator('#tpTabOverview')).toHaveAttribute('aria-selected','true');
  const writes=await page.evaluate(()=>window.__visualQA.financeWrites);
  expect(writes.at(-1)).toMatchObject({name:'trip_plan_save_tasks',args:{p_trip:null,p_order_ids:[fixtureIDs.order],p_reason:'Создание выезда',p_plan:{notes:'Первое заполнение'}}});
  await page.locator('#tripEditData').click();await expect(page.locator('#tpChangeReasonGroup')).toBeVisible();
  await expect(page.locator('#tpNotes')).toHaveValue('Первое заполнение');
  const editor=page.getByRole('dialog',{name:'Изменить выезд'});await expect(editor.locator('#tpNotes')).toBeVisible();
  await editor.locator('#tpNotes').fill('Изменение после первого сохранения');await editor.locator('[data-entity-save]').click();await expect(editor.getByRole('alert')).toContainText('причину');
  expect(await page.evaluate(()=>window.__visualQA.financeWrites.length)).toBe(writes.length);
  await editor.locator('#tpChangeReason').fill('Уточнили заметку');await editor.locator('[data-entity-save]').click();await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>window.__visualQA.financeWrites.at(-1))).toMatchObject({name:'trip_plan_save_tasks',args:{p_reason:'Уточнили заметку',p_plan:{notes:'Изменение после первого сохранения'}}});
  await expect(page.locator('#tpNotes')).toHaveValue('Изменение после первого сохранения');
});

test('a planned trip offers route editing on its overview and opens the map editor',async({page},info)=>{
  await open(page,info,'trip/'+fixtureIDs.trip);
  const edit=page.locator('#tpEditRoute');await expect(edit).toBeVisible();await expect(edit).toHaveText('Редактировать маршрут');
  await edit.click();await expect(page).toHaveURL(/#\/trip\/[^/]+\/map\/edit$/);
});
