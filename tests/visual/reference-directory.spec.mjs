import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

async function open(page,info,section){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,mapWork:true,directoryJourney:true});
  await page.goto('/#/catalog');
  await expect(page.locator('#todayLater')).toBeVisible();await page.locator('#todayLater').click();
  await expect(page.locator('.view-catalog.active')).toBeVisible();
  if(section)await page.locator('.catalog-main-nav [data-csub='+section+']').click();
  return errors;
}

test('Справочник opens on customers; a customer card shows its points and equipment and saves edits',async({page},info)=>{
  const errors=await open(page,info);
  await expect(page.locator('.catalog-main-nav [data-csub]')).toHaveText(['Клиенты','Точки','Техника','Модели','Работы','Материалы и цены']);
  await expect(page.locator('#catalogTitle')).toHaveText('Клиенты');
  const rows=page.locator('#custList tbody .catalog-record');await expect(rows).toHaveCount(3);
  await page.locator('#custSearch').fill('агро');await expect(rows).toHaveCount(1);await page.locator('#custSearch').fill('');
  await page.locator('[data-cust-open="customer-c"]').first().click();
  const dialog=page.locator('#custOverlay');await expect(dialog).toBeVisible();
  await expect(dialog.locator('#custName')).toHaveValue('ТОВ «Агро-Схід»');
  await expect(dialog.locator('#custPoints .ref-link')).toHaveCount(1);await expect(dialog.locator('#custPoints')).toContainText('3 ед. техники');
  await expect(dialog.locator('#custEquipment .ref-link')).toHaveCount(3);
  await dialog.locator('#custTax').fill('40011122');await dialog.locator('#custSave').click();
  await expect(dialog).toBeHidden();
  const writes=await page.evaluate(()=>window.__visualQA.directoryWrites);
  expect(writes.at(-1)).toMatchObject({table:'customers',method:'update',values:{tax_id:'40011122',name:'ТОВ «Агро-Схід»'}});
  // A customer with points is not deleted.
  await page.locator('[data-cust-open="customer-c"]').first().click();await dialog.locator('#custDelete').click();
  await expect(page.locator('#toast')).toContainText('Удалить нельзя');
  expect(errors).toEqual([]);
});

test('a new customer takes a point from another customer and gives it back',async({page},info)=>{
  const errors=await open(page,info);
  await page.locator('#custAdd').click();
  const dialog=page.locator('#custOverlay');await expect(dialog).toBeVisible();await expect(dialog.locator('#custName')).toBeFocused();
  await expect(dialog.locator('#custLinks')).toBeHidden();
  await dialog.locator('#custName').fill('Холдинг «Колос»');await dialog.locator('#custSave').click();
  await expect(dialog.locator('#custLinks')).toBeVisible();await expect(dialog.locator('#custTitle')).toHaveText('Холдинг «Колос»');
  await dialog.locator('#custAttachPoint').selectOption('client-b');await dialog.locator('#custAttachBtn').click();
  await expect(dialog.locator('#custPoints .ref-link')).toHaveCount(1);await expect(dialog.locator('#custPoints')).toContainText('ФГ «Колос»');
  let writes=await page.evaluate(()=>window.__visualQA.directoryWrites);
  expect(writes.at(-1)).toMatchObject({table:'clients',method:'update',values:{customer_id:expect.stringMatching(/^customer-/)}});
  await dialog.locator('[data-cust-unlink="client-b"]').click();
  await expect(dialog.locator('#custPoints .ref-link')).toHaveCount(0);
  writes=await page.evaluate(()=>window.__visualQA.directoryWrites);expect(writes.at(-1)).toMatchObject({table:'clients',values:{customer_id:null}});
  await dialog.locator('#custCancel').click();
  await expect(page.locator('#custList tbody .catalog-record')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('points list each point with its customer and equipment count',async({page},info)=>{
  const errors=await open(page,info,'points');
  await expect(page.locator('#catalogTitle')).toHaveText('Точки');
  const rows=page.locator('#pointList tbody .catalog-record');await expect(rows).toHaveCount(3);
  await page.locator('#pointSearch').fill('агро');await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('ТОВ «Агро-Схід»');await expect(rows.first()).toContainText('3');
  await rows.first().locator('[data-point-customer]').click();
  await expect(page.locator('#custOverlay')).toBeVisible();await expect(page.locator('#custName')).toHaveValue('ТОВ «Агро-Схід»');
  expect(errors).toEqual([]);
});

test('equipment card shows facts and a service history of requests, tasks and readings',async({page},info)=>{
  const errors=await open(page,info,'equipment');
  await expect(page.locator('#catalogTitle')).toHaveText('Техника');
  const rows=page.locator('#eqRefList tbody .catalog-record');await expect(rows).toHaveCount(4);
  await page.locator('[data-eqref-open="equipment-a"]').first().click();
  const card=page.locator('#eqCardOverlay');await expect(card).toBeVisible();
  await expect(card.locator('#eqCardFacts')).toContainText('Коммунальное предприятие');
  const history=card.locator('.eq-history-item');await expect(history.first()).toBeVisible();
  await expect(card.locator('#eqCardHistory')).toContainText('Заявка №');
  await expect(card.locator('#eqCardHistory')).toContainText('Работы');
  await card.locator('#eqCardClose').click();
  await page.locator('[data-eqref-open="eq-soon"]').first().click();
  await expect(card.locator('#eqCardHistory')).toContainText('Замер моточасов: 4700');
  await expect(card.locator('.eq-history-item').first()).toContainText('20.09.2026');
  expect(errors).toEqual([]);
});

test('the point dialog on the map shows and changes the customer',async({page},info)=>{
  const errors=await open(page,info);
  await page.evaluate(async()=>{location.hash='#/map';});await expect(page.locator('.view-map.active')).toBeVisible();
  await page.evaluate(()=>window.editClient('client-c'));
  const dialog=page.locator('#editOverlay');await expect(dialog).toBeVisible();
  await expect(dialog.locator('#eCustomer')).toHaveValue('customer-c');
  await expect(dialog.locator('#eCustomer option')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('the request shows the customer of its point, and the point list names it',async({page},info)=>{
  const errors=await open(page,info);
  await page.goto('/#/job/'+fixtureIDs.job);
  const facts=page.locator('#requestContext .request-context-data');
  await expect(facts).toContainText('Клиент');await expect(facts.locator('div').first()).toHaveText(/Клиент\s*Коммунальное предприятие$/);
  await expect(facts.locator('div').nth(1)).toContainText('Точка');
  await page.locator('#requestEditContext').click();
  await expect(page.locator('#jbCustomer')).toHaveText('Клиент: Коммунальное предприятие');
  // Same name as the point — the option does not repeat it.
  await expect(page.locator('#jbClient option[value="client-c"]')).toHaveText('ТОВ «Агро-Схід»');
  expect(errors).toEqual([]);
});
