import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

async function open(page,info,route,extra={}){
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,financeJourney:true,...extra});
  await page.goto('/#/'+route);
  await expect(page.locator('#todayLater')).toBeVisible();await page.locator('#todayLater').click();
  await expect(page.locator('.view.active')).toBeVisible();
}
async function estimate(page){
  await page.locator('#jobTabEstimate').click();
  await page.locator('#jbParts').evaluate(el=>el.closest('.foldable')?.classList.remove('folded'));
  await page.locator('#jbWorks').evaluate(el=>el.closest('.foldable')?.classList.remove('folded'));
}
test('creates a request with work and materials in one save without correction prompts',async({page},info)=>{
  await open(page,info,'planner/jobs');await page.locator('#jobAdd').click();await estimate(page);
  await expect(page.locator('#jbPartNew')).toBeVisible();await page.locator('#jbPartNew').click();
  await page.locator('[data-pn="0"]').fill('Новая запчасть');await page.locator('[data-pq="0"]').fill('2');
  await page.locator('#jbCustomAdd').click();await page.locator('[data-wn="0"]').fill('Новая работа');await page.locator('[data-wh="0"]').fill('1.5');
  await page.locator('#jobSave').click();await expect(page.locator('.view-planner.active')).toBeVisible();
  const writes=await page.evaluate(()=>window.__visualQA.financeWrites);
  expect(writes).toHaveLength(1);expect(writes[0].args.p_id).toBeNull();
  expect(writes[0].args.p_works[0]).toMatchObject({title:'Новая работа',hours:1.5});
  expect(writes[0].args.p_parts[0]).toMatchObject({name:'Новая запчасть',qty:2});
  expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('keeps an incomplete material local, then saves its correction alongside unchanged history',async({page},info)=>{
  await open(page,info,'job/'+fixtureIDs.job);await estimate(page);
  const baseline=await page.evaluate(()=>window.__visualQA.financeRows.filter(i=>i.legacy_job_work_id||i.legacy_job_part_id));
  await expect(page.locator('[data-pn="0"]')).toBeDisabled();
  await page.locator('[data-pn="1"]').fill('');await page.locator('#jobSave').click();
  await expect(page.locator('#jobSaveState')).toContainText('название запчасти');
  expect(await page.evaluate(()=>window.__visualQA.financeWrites)).toHaveLength(0);
  await page.reload();await expect(page.locator('#todayLater')).toBeVisible();await page.locator('#todayLater').click();await estimate(page);await expect(page.locator('[data-pn="0"]')).toHaveValue('Историческая запчасть');
  await expect(page.locator('[data-pn="1"]')).toHaveValue('');
  await page.locator('[data-pn="1"]').fill('Исправленная запчасть');await page.locator('[data-pq="1"]').fill('0');await page.locator('#jobSave').click();
  await expect(page.locator('#jobSaveState')).toContainText('количество запчасти');
  expect(await page.evaluate(()=>window.__visualQA.financeWrites)).toHaveLength(0);
  await page.locator('[data-pq="1"]').fill('3');await page.locator('#jobSave').click();
  await expect(page.locator('#jobSaveState')).toHaveText('сохранено');
  const state=await page.evaluate(()=>window.__visualQA);
  expect(state.financeRows.filter(i=>i.legacy_job_work_id||i.legacy_job_part_id)).toEqual(baseline);
  expect(state.financeWrites.at(-1).args.p_parts).toHaveLength(1);
  expect(state.financeWrites.at(-1).args.p_parts[0]).toMatchObject({name:'Исправленная запчасть',qty:3});
  expect(state.blockedWrites).toEqual([]);
});
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

test('confirming a new unfinished work shows its missing field and no historical correction error',async({page},info)=>{
  await open(page,info,'job/'+fixtureIDs.job);await estimate(page);
  await page.locator('#jbCustomAdd').click();await page.locator('[data-wn="1"]').fill('Новая работа');
  await page.locator('#jbWorksOk').click();await expect(page.locator('#toast')).toContainText('Укажи часы');
  await expect(page.locator('#toast')).not.toContainText('Историческую');
  await page.locator('[data-wh="1"]').fill('2');await page.locator('#jbWorksOk').click();
  await expect(page.locator('#jobSaveState')).toHaveText('сохранено');
  const state=await page.evaluate(()=>window.__visualQA);
  expect(state.financeWrites.at(-1).args.p_works).toHaveLength(1);
  expect(state.financeWrites.at(-1).args.p_works[0]).toMatchObject({title:'Новая работа',hours:2});
  expect(state.blockedWrites).toEqual([]);
});
test('picks a request part from the materials catalog by name or SKU and sends the link with the save',async({page},info)=>{
  await open(page,info,'job/'+fixtureIDs.job,{catalogueJourney:true});await estimate(page);
  const before=await page.locator('#jbParts .pt-row').count();
  await page.locator('#jbPartNew').click();
  const name=page.locator('[data-pn="'+before+'"]');
  await expect(name).toBeFocused();await expect(name).toHaveAttribute('aria-expanded','true');
  await name.fill('hlp');
  const option=page.locator('.stock-pick [role=option]');
  await expect(option).toHaveCount(1);await expect(option.first()).toContainText('Масло HLP 46');
  // Archived positions are never offered.
  await name.fill('HF-180');await expect(option).toHaveCount(0);await expect(page.locator('.stock-pick:not([hidden])')).toContainText('строка останется ручной');
  await name.fill('масло');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  const row=page.locator('#jbParts .pt-row').nth(before);
  await expect(row.locator('[data-pn]')).toHaveValue('Масло HLP 46');await expect(row.locator('[data-ps]')).toHaveValue('HLP46');
  await expect(row.locator('[data-pu]')).toHaveValue('л');await expect(row.locator('[data-pp]')).toHaveValue('140');await expect(row.locator('[data-pc]')).toHaveValue('95');
  await expect(row.locator('.pt-linked')).toHaveText('из справочника');await expect(row.locator('[data-pq]')).toBeFocused();
  await row.locator('[data-pq]').fill('3');
  await page.locator('#jobSave').click();
  await expect.poll(()=>page.evaluate(()=>window.__visualQA.financeWrites.length)).toBeGreaterThan(0);
  const writes=await page.evaluate(()=>window.__visualQA.financeWrites),last=writes.at(-1).args.p_parts.find(p=>p.name==='Масло HLP 46');
  expect(last).toMatchObject({stock_catalog_id:'stock-b',sku:'HLP46',unit:'л',qty:3,price:140,cost:95});
  // Rewriting the name by hand turns the row back into a manual one.
  const again=page.locator('#jbParts .pt-row').filter({has:page.locator('.pt-linked')});
  await expect(again).toHaveCount(1);
  await again.locator('[data-pn]').fill('Масло другое');await expect(page.locator('#jbParts .pt-linked')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);
});
test('a planned trip offers route editing on its overview and opens the map editor',async({page},info)=>{
  await open(page,info,'trip/'+fixtureIDs.trip);
  const edit=page.locator('#tpEditRoute');await expect(edit).toBeVisible();await expect(edit).toHaveText('Редактировать маршрут');
  await edit.click();await expect(page).toHaveURL(/#\/trip\/[^/]+\/map\/edit$/);
});
