import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
import {mkdirSync} from 'node:fs';

async function boot(page,info,mode='conflicts'){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.clock.install({time:new Date('2026-10-05T10:00Z')});
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,canonicalPlanner:mode});
  await page.goto('/#/schedule');
  if(await page.locator('#todayLater').isVisible().catch(()=>false))await page.locator('#todayLater').click();
  await expect(page.locator(mode==='progress'?'.pw-calendar':'.pw-plan').first()).toBeVisible();
  return errors;
}
async function shot(page,info,name){const path='test-results/planner-conflicts/'+info.project.name;mkdirSync(path,{recursive:true});await page.screenshot({path:path+'/'+name+'.png',animations:'disabled'});}
async function openOverview(page){const panel=page.locator('.pw-context');if(!await panel.isVisible())await page.locator('[data-pw=overview]').first().click();await expect(panel).toBeVisible();return panel;}

test('planner conflicts: overflow and route-order booking are marked and resolved from the task card',async({page},info)=>{
  const errors=await boot(page,info);
  await expect(page.locator('.pw-plan[data-conflict=overflow]').first()).toContainText('Не помещается в срок · +2 ч');
  const booking=page.locator('.pw-plan[data-booking=true]').first();
  await expect(booking).toHaveAttribute('data-conflict','order');await expect(booking).toContainText('Бронь');
  const panel=await openOverview(page);
  await expect(panel.locator('[data-conflict]')).toHaveCount(2);
  await shot(page,info,'overview');
  await panel.locator('[data-conflict=overflow]').click();
  const card=page.locator('.pw-conflict[data-conflict=overflow]');
  await expect(card).toContainText('не хватает 2 ч рабочего времени');
  await expect(page.locator('.pw-conflict[data-conflict=order]')).toContainText('Изменить порядок в выезде');
  const approve=card.locator('[data-pw=conflict-overtime]');
  await expect(approve).toHaveText('Одобрить сверхурочные · +2 ч на 05.10');
  await expect(card.locator('[data-pw=conflict-deadline]')).toHaveText('Перенести срок на 06.10');
  await approve.scrollIntoViewIfNeeded();await shot(page,info,'task-card');
  await approve.click();await page.locator('#confirmYes').click();
  await expect.poll(()=>page.evaluate(()=>window.__visualQA.staffDayWrites.length)).toBe(2);
  const writes=await page.evaluate(()=>window.__visualQA.staffDayWrites);
  expect(writes.map(w=>[w.date,w.tol_h])).toEqual([['2026-10-05',3],['2026-10-05',3]]);
  expect(errors).toEqual([]);
});

test('planner conflicts: moving the deadline saves the task period and clears the overflow',async({page},info)=>{
  const errors=await boot(page,info);
  const panel=await openOverview(page);
  await panel.locator('[data-conflict=overflow]').click();
  await page.locator('[data-pw=conflict-deadline]').click();await page.locator('#confirmYes').click();
  await expect.poll(()=>page.evaluate(()=>window.__visualQA.deadlineWrites?.length||0)).toBe(1);
  const [write]=await page.evaluate(()=>window.__visualQA.deadlineWrites);
  expect(write).toMatchObject({p_date_from:'2026-10-05',p_date_to:'2026-10-06'});
  await expect(page.locator('.pw-plan[data-conflict=overflow]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__visualQA.plannerWrites.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('planner conflicts: one engineer in two blocks is reported on both blocks and in the overview',async({page},info)=>{
  const errors=await boot(page,info,'resources');
  await expect(page.locator('.pw-plan[data-conflict=busy]')).not.toHaveCount(0);
  const panel=await openOverview(page);
  const rows=panel.locator('[data-conflict=busy]');
  await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('Двойная занятость · Анна Смирнова');
  await expect(panel.locator('[data-conflict=route]')).toHaveCount(1);
  await rows.first().click();
  await expect(page.locator('.pw-conflict[data-conflict=busy]').first()).toContainText('05.10 11:00–13:00 у Анна Смирнова уже стоит задание №101.');
  await shot(page,info,'busy');
  await openOverview(page).catch(()=>{});await page.locator('[data-pw=overview]').first().click().catch(()=>{});
  const route=page.locator('.pw-context [data-conflict=route]');if(!await route.isVisible())await page.locator('[data-pw=overview]').first().click();
  await route.click();await expect(page.locator('.pw-conflict[data-conflict=route] [data-pw=full]')).toHaveText('Пересчитать маршрут в выезде →');
  expect(errors).toEqual([]);
});

test('planner conflicts: overdue plans of past dates are listed in the overview and a stale route is explained',async({page},info)=>{
  const errors=await boot(page,info,'progress');
  const panel=await openOverview(page);
  await expect(panel.locator('[data-overdue=overdue]')).toContainText('План просрочен · работа не начата');
  await expect(panel.locator('[data-overdue=late]')).toContainText('Выезд не начат по плану');
  await shot(page,info,'overdue');
  await page.locator('.pw-calendar').evaluate(()=>{});
  await panel.locator('[data-overdue=late]').click();
  await expect(page.locator('.pw-context')).toContainText('Выезд №');
  expect(errors).toEqual([]);
});
