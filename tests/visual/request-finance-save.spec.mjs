import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

async function open(page,info,route){
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,financeJourney:true});
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
test('fills a trip created from its task without asking for an edit reason on the first save',async({page},info)=>{
  await open(page,info,'order/'+fixtureIDs.order);await page.locator('#orderTab-travel').click();
  await page.locator('#orderTripAdd').click();await expect(page.locator('.view-trip.active')).toBeVisible();
  await expect(page.locator('#tpChangeReasonGroup')).toBeHidden();await page.locator('#tpNotes').fill('Первое заполнение');
  await page.locator('#tpSave').click();await expect(page.locator('#tpChangeReasonGroup')).toBeVisible();
  const writes=await page.evaluate(()=>window.__visualQA.financeWrites);
  expect(writes.at(-1)).toMatchObject({name:'trip_plan_save_tasks',args:{p_reason:'Первоначальное заполнение нового выезда',p_plan:{notes:'Первое заполнение'}}});
  await page.locator('#tpSave').click();await expect(page.locator('#tripErr')).toContainText('причину');
  expect(await page.evaluate(()=>window.__visualQA.financeWrites.length)).toBe(writes.length);
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
