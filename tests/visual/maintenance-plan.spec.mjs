import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';

async function open(page,info,route){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,maintenancePlanJourney:true,directoryJourney:true});
  await page.goto('/#/'+route);
  if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
  return errors;
}

test('the model keeps a maintenance plan of levels with works and materials',async({page},info)=>{
  const errors=await open(page,info,'catalog');
  await page.locator('.catalog-main-nav [data-csub=models]').click();
  const plan=page.locator('#emList [data-emplan="model-a"]').first();await expect(plan).toHaveText('ТО-1 · 250 / ТО-2 · 500 / ТО-3 · 1000 мч');
  await plan.click();
  const dialog=page.getByRole('dialog',{name:/^План ТО/});await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-mp-row]')).toHaveCount(3);
  await expect(dialog.locator('[data-mp-row="0"] .mp-chips')).toContainText('Диагностика гидросистемы');
  await expect(dialog.locator('[data-mp-row="0"] .mp-materials')).toContainText('Уплотнение насоса');
  await dialog.locator('[data-mp-new]').click();await expect(dialog.locator('[data-mp-row]')).toHaveCount(4);
  const fresh=dialog.locator('[data-mp-row="3"]');await expect(fresh.locator('[data-mp=name]')).toHaveValue('ТО-4');await expect(fresh.locator('[data-mp=interval_hours]')).toHaveValue('2000');
  await fresh.locator('[data-mp=interval_hours]').fill('1000');await dialog.locator('[data-entity-save]').click();
  await expect(dialog.locator('[data-mp-error]')).toContainText('уже есть');
  await fresh.locator('[data-mp=interval_hours]').fill('2000');await fresh.locator('[data-mp-work-add]').selectOption({index:1});
  await expect(fresh.locator('.mp-chips li')).toHaveCount(1);
  await dialog.locator('[data-entity-save]').click();await expect(dialog).toBeHidden();
  const writes=await page.evaluate(()=>window.__visualQA.maintenanceWrites);
  expect(writes.find(w=>w.method==='insert').values).toMatchObject({model_id:'model-a',name:'ТО-4',interval_hours:2000,works:[{work_id:'work-a'}]});
  await expect(plan).toContainText('ТО-4 · 2000');
  expect(errors).toEqual([]);
});

test('recording a service with moto hours moves the next service to the following mark',async({page},info)=>{
  const errors=await open(page,info,'customer/customer-a/equipment');
  await expect(page.locator('#customerEquipmentList')).toContainText('просрочено');
  await page.locator('[data-ce-open="equipment-a"]').first().click();
  const card=page.locator('#eqCardOverlay');await expect(card).toBeVisible();
  await expect(card.locator('#eqCardFacts')).toContainText('ТО-1 при 1250 мч');
  await expect(card.locator('#eqCardFacts')).toContainText('ТО-1 · 250 мч, ТО-2 · 500 мч / 12 мес, ТО-3 · 1000 мч / 24 мес');
  await card.locator('#eqCardService').click();
  const prompt=page.locator('#promptOverlay');await expect(prompt).toBeVisible();
  await expect(prompt.locator('[data-pf=level]')).toHaveValue('level-1');
  await prompt.locator('[data-pf=mh]').fill('1262');await prompt.locator('#promptYes').click();
  await expect(page.locator('#toast')).toContainText('следующее ТО-2 при 1500 мч');
  const writes=await page.evaluate(()=>window.__visualQA.serviceWrites);
  expect(writes.at(-1)).toMatchObject({p_equipment:'equipment-a',p_moto_hours:1262,p_level:'level-1',p_date:'2026-10-05'});
  await expect(card.locator('#eqCardFacts')).toContainText('ТО-2 при 1500 мч');
  expect(errors).toEqual([]);
});

test('a service request takes works and materials of the due level',async({page},info)=>{
  const errors=await open(page,info,'customer/customer-a/equipment');
  await page.locator('[data-ce-open="equipment-a"]').first().click();
  await page.locator('#eqCardJob').click();
  await expect(page.locator('.view-job.active')).toBeVisible();await expect(page.locator('#jbEquip')).toHaveValue('equipment-a');
  await expect(page.locator('#toast')).toContainText('Заявка на ТО-1');
  expect(errors).toEqual([]);
});
