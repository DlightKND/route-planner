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

test('Справочник lists customers; the customer page has points, equipment, jobs and saves requisites',async({page},info)=>{
  const errors=await open(page,info);
  await expect(page.locator('.catalog-main-nav [data-csub]')).toHaveText(['Клиенты','Модели','Работы','Материалы и цены']);
  await expect(page.locator('#catalogTitle')).toHaveText('Клиенты');
  const rows=page.locator('#custList tbody .catalog-record');await expect(rows).toHaveCount(3);
  await page.locator('#custSearch').fill('агро');await expect(rows).toHaveCount(1);
  await page.locator('#custSearch').fill('4471');await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('найдено в технике: Grundfos CR 32 · № 4471-22');
  await page.locator('#custSearch').fill('');
  await page.locator('[data-cust-open="customer-c"]').first().click();
  await expect(page).toHaveURL(/#\/customer\/customer-c$/);await expect(page.locator('.view-customer.active')).toBeVisible();
  await expect(page.locator('#customerTitle')).toHaveText('ТОВ «Агро-Схід»');
  await expect(page.locator('#customerTab-points .tab-count')).toHaveText('1');await expect(page.locator('#customerTab-equipment .tab-count')).toHaveText('3');
  await expect(page.locator('#customerPane-overview .customer-stat').first()).toContainText('Заявки');
  await page.locator('#customerTab-equipment').click();await expect(page).toHaveURL(/#\/customer\/customer-c\/equipment$/);
  await expect(page.locator('#customerEquipmentList tbody .catalog-record')).toHaveCount(3);
  await expect(page.locator('#customerEquipmentList')).toContainText('Grundfos CR 32');
  await page.locator('#customerTab-details').click();
  const form=page.locator('#customerForm');await expect(form.locator('[name=name]')).toHaveValue('ТОВ «Агро-Схід»');
  await expect(page.locator('#customerFormSave')).toBeDisabled();
  await form.locator('[name=tax_id]').fill('40011122');await expect(page.locator('#customerFormSave')).toBeEnabled();
  await page.locator('#customerFormSave').click();await expect(page.locator('#customerFormState')).toHaveText('Сохранено');
  const writes=await page.evaluate(()=>window.__visualQA.directoryWrites);
  expect(writes.at(-1)).toMatchObject({table:'customers',method:'update',values:{tax_id:'40011122',name:'ТОВ «Агро-Схід»'}});
  await expect(page.locator('.view-customer .workflow-head-facts')).toContainText('40011122');
  // A customer with points is not deleted.
  await page.locator('#customerMore').click();await page.getByRole('dialog',{name:'Другие действия'}).getByRole('button',{name:'Удалить клиента'}).click();
  await expect(page.locator('#toast')).toContainText('Удалить нельзя');
  // Unsaved requisites ask before leaving.
  await form.locator('[name=notes]').fill('Договор №7');await page.locator('#customerBack').click();
  await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmNo').click();
  await expect(page.locator('.view-customer.active')).toBeVisible();await expect(form.locator('[name=notes]')).toHaveValue('Договор №7');
  expect(errors).toEqual([]);
});

test('a new customer opens its page, takes a point from another customer and gives it back',async({page},info)=>{
  const errors=await open(page,info);
  await page.locator('#custAdd').click();
  const dialog=page.locator('#custOverlay');await expect(dialog).toBeVisible();await expect(dialog.locator('#custName')).toBeFocused();
  await dialog.locator('#custName').fill('Холдинг «Колос»');await dialog.locator('#custSave').click();
  await expect(dialog).toBeHidden();await expect(page.locator('#customerTitle')).toHaveText('Холдинг «Колос»');
  await page.locator('#customerTab-points').click();
  await page.locator('#customerAttachPoint').selectOption('client-b');await page.locator('#customerAttach').click();
  await expect(page.locator('#customerPointList tbody .catalog-record')).toHaveCount(1);await expect(page.locator('#customerPointList')).toContainText('ФГ «Колос»');
  let writes=await page.evaluate(()=>window.__visualQA.directoryWrites);
  expect(writes.at(-1)).toMatchObject({table:'clients',method:'update',values:{customer_id:expect.stringMatching(/^customer-/)}});
  await page.locator('#customerPointList .catalog-row-actions>summary').first().click();
  await page.locator('#customerPointList [data-cp-unlink="client-b"]').click();
  await expect(page.locator('#customerPointList tbody .catalog-record')).toHaveCount(0);
  writes=await page.evaluate(()=>window.__visualQA.directoryWrites);expect(writes.at(-1)).toMatchObject({table:'clients',values:{customer_id:null}});
  // The freed point is listed under «Точки без клиента».
  await page.locator('#customerBack').click();await expect(page.locator('.view-catalog.active')).toBeVisible();
  await expect(page.locator('#custList tbody .catalog-record')).toHaveCount(5);
  await page.locator('[data-cust-open="none"]').first().click();
  await expect(page.locator('#customerTitle')).toHaveText('Точки без клиента');await expect(page.locator('#customerTab-details')).toHaveCount(0);
  await page.locator('#customerTab-points').click();await expect(page.locator('#customerPointList')).toContainText('ФГ «Колос»');
  expect(errors).toEqual([]);
});

test('equipment card on the customer page shows the next service and a history of requests, tasks and readings',async({page},info)=>{
  const errors=await open(page,info);
  await page.goto('/#/customer/customer-a/equipment');await expect(page.locator('.view-customer.active')).toBeVisible();
  await page.locator('[data-ce-open="equipment-a"]').first().click();
  const card=page.locator('#eqCardOverlay');await expect(card).toBeVisible();
  await expect(card.locator('#eqCardFacts')).toContainText('Коммунальное предприятие');await expect(card.locator('#eqCardFacts')).toContainText('Следующее ТО');
  const history=card.locator('.eq-history-item');await expect(history.first()).toBeVisible();
  await expect(card.locator('#eqCardHistory')).toContainText('Заявка №');
  await expect(card.locator('#eqCardHistory')).toContainText('Работы');
  await card.locator('#eqCardClose').click();
  await page.goto('/#/customer/customer-c/equipment');await expect(page.locator('#customerTitle')).toHaveText('ТОВ «Агро-Схід»');
  await page.locator('[data-ce-open="eq-soon"]').first().click();
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
