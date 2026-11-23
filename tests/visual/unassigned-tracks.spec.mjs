import {openOrphanOverview} from './journal-actions.mjs';
import {revealDispatcherActions,clickDispatcherControl} from './dispatcher-controls.mjs';
import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
const errors=[];
async function open(page,info,role='admin',unassignedCount=1,unassignedJourney=true){
 errors.length=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{
  const url=new URL(r.request().url());
  // Deterministic tile fixture exercises image loading without remote services.
  if(url.hostname.endsWith('tile.openstreetmap.org')||url.hostname==='api.maptiler.com')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5e2d6"/><path d="M20 0 L60 90 35 256 M190 0 L155 110 230 256" fill="none" stroke="#aad2dd" stroke-width="18"/><path d="M0 80 L256 175 M85 0 L175 256" stroke="#fff" stroke-width="8"/><path d="M0 80 L256 175 M85 0 L175 256" stroke="#d2bd83" stroke-width="2"/><text x="10" y="30" font-family="sans-serif" font-size="12" fill="#555">Подложка QA</text></svg>'});
  return url.origin==='http://127.0.0.1:4173'?r.continue():r.abort();
 });
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,unassignedJourney,unassignedCount,preserveRanges:true});
 await page.goto('/#/planner/tracking');await expect(page.locator('#unassignedHost [data-ut-card]').first()).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
}
async function clean(page){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
test('GPS register and GPS preview remain usable at each width',async({page},info)=>{
 await open(page,info);
 await expect(page.getByRole('table',{name:'GPS-записи'})).toBeVisible();
 await expect(page.locator('.gps-journal-detail')).toBeHidden();
 const openButton=page.locator('[data-ut-details]').first(),button=await openButton.boundingBox();
 expect(button.x).toBeGreaterThanOrEqual(0);expect(button.x+button.width).toBeLessThanOrEqual(page.viewportSize().width);expect(button.height).toBeGreaterThanOrEqual(36);
 await openButton.click();
 await expect(page.getByRole('table',{name:'GPS-записи'})).toBeHidden();
 await expect(page.locator('.gps-journal-detail .unassigned-map')).toBeVisible();
 await expect(page.locator('.gps-journal-detail .unassigned-map .leaflet-tile-loaded').first()).toBeVisible();
 expect(await page.locator('.gps-journal-detail .unassigned-map .leaflet-tile-loaded').first().evaluate(img=>img.naturalWidth)).toBe(256);
 await expect(page.locator('.gps-journal-detail .unassigned-map .leaflet-control-attribution')).toContainText('OpenStreetMap');
 const before=await page.locator('.gps-journal-detail .unassigned-map .gps-track-line').getAttribute('d');
 await page.locator('.gps-journal-detail .unassigned-map .leaflet-control-zoom-in').click();
 await expect.poll(()=>page.locator('.gps-journal-detail .unassigned-map .gps-track-line').getAttribute('d')).not.toBe(before);
 await expect(page.locator('.gps-journal-detail')).toContainText('120');
 const overflow=await page.locator('#unassignedHost').evaluate(el=>el.scrollWidth-el.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
 await expect(page.locator('[data-ut-more]')).not.toBeVisible();
 for(const tab of await page.locator('#plUnassigned .subtab').all())expect(await tab.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
 await page.screenshot({path:'test-results/unassigned-screenshots/'+info.project.name+'.png',fullPage:true});
 await clean(page);
});
test('creates the GPS trip draft without collecting new request details or writing data',async({page},info)=>{
 await open(page,info);await openOrphanOverview(page);
 await page.getByRole('button',{name:'Создать выезд',exact:true}).click();
 const overlay=page.locator('#promptOverlay');
 await expect(overlay).toBeVisible();
 await expect(overlay.locator('[data-pf=client],[data-pf=title]')).toHaveCount(0);
 await overlay.locator('[data-pf=reason]').fill('Выезд по проверенной GPS-записи');
 await overlay.locator('#promptYes').click();
 await expect(page.locator('.view-trip.active')).toBeVisible();
 await expect(page.locator('#tpVeh')).toBeDisabled();
 await expect(page.locator('#tpTaskPicker')).toBeVisible();
 await page.locator('#tripCancel').click();
 await expect(page.locator('.journal-orphan-overview')).toBeVisible();
 await clean(page);
});
test('restores unlinked stop choices and carries the decision into the linked visit review',async({page},info)=>{
 await open(page,info,'admin',1,'stop-draft');await openOrphanOverview(page);
 const stops=page.locator('.journal-link-required'),choice=stops.getByLabel('Решение'),note=stops.getByLabel('Комментарий');
 await choice.selectOption('include');await note.fill('Объект сверили с инженером');
 await expect(stops.locator('[data-source-total]')).toHaveText('Выбрано: 1 · 12 мин');
 await stops.getByRole('button',{name:'Сохранить выбор'}).click();
 await expect(stops.getByRole('status')).toContainText('Выбор сохранён');
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(choice).toHaveValue('include');await expect(note).toHaveValue('Объект сверили с инженером');
 await page.getByRole('button',{name:'Связать с выездом',exact:true}).click();
 await page.locator('[data-pf=trip]').selectOption({index:1});
 await page.locator('[data-pf=reason]').fill('Поездку проверили');
 await page.locator('#promptYes').click();
 const transferred=page.locator('.journal-source-choices').filter({has:page.getByRole('heading',{name:'Выбор до привязки GPS',exact:true})});
 await expect(transferred).toContainText('Объект сверили с инженером');
 await transferred.getByRole('button',{name:'Проверить стоянку'}).click();
 await expect(page.locator('.journal-review-note')).toHaveValue('Объект сверили с инженером');
 await expect(page.locator('[data-presence-kind=visit]')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>window.__visualQA.reads.some(name=>name==='rpc:trip_presence_save_tasks'))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 await clean(page);
});
test('prepares a manual visit before linking and confirms it in the trip',async({page},info)=>{
 await open(page,info,'admin',1,'stop-draft');await openOrphanOverview(page);
 const manual=page.locator('.journal-manual-drafts');
 await manual.getByRole('button',{name:'Добавить посещение без GPS'}).click();
 const prompt=page.locator('#promptOverlay');
 await prompt.locator('[data-pf=from]').fill('2026-10-04T10:30');
 await prompt.locator('[data-pf=to]').fill('2026-10-04T11:00');
 await prompt.locator('[data-pf=reason]').fill('По журналу заказчика');
 await prompt.locator('[data-pf=job]').selectOption({index:1});
 await prompt.locator('.engineer-picker').click();
 await page.locator('.engineer-options input[type=checkbox]').first().check();
 await page.locator('.engineer-options').getByRole('button',{name:'Готово'}).click();
 await expect(prompt.locator('[data-pf=crew]')).toHaveValues(['00000000-0000-4000-8000-000000000002']);
 await page.locator('#promptYes').click();
 await expect(manual).toContainText('По журналу заказчика');
 await page.reload();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(manual).toContainText('По журналу заказчика');
 await manual.getByRole('button',{name:'Изменить',exact:true}).click();
 await expect(prompt.locator('[data-pf=from]')).toHaveValue('2026-10-04T10:30');
 await page.locator('#promptNo').click();
 await page.getByRole('button',{name:'Связать с выездом',exact:true}).click();
 await prompt.locator('[data-pf=trip]').selectOption({index:1});
 await prompt.locator('[data-pf=reason]').fill('Поездку проверили');
 await page.locator('#promptYes').click();
 await expect(manual).toContainText('Ручные посещения до привязки GPS');
 expect(await page.evaluate(()=>window.__visualQA.reads.includes('rpc:gps_manual_visit_draft_confirm'))).toBe(false);
 await manual.getByRole('button',{name:'Проверить посещение'}).click();
 await expect(prompt.locator('[data-pf=crew]')).toHaveValues(['00000000-0000-4000-8000-000000000002']);
 await page.locator('#promptYes').click();
 await expect(page.locator('.journal-trip-message')).toContainText('Ручное посещение подтверждено.');
 await expect(manual).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 await clean(page);
});
test('links extra GPS evidence to a completed trip as a separate journal record',async({page},info)=>{
 await open(page,info,'admin',1,'supplement');await openOrphanOverview(page);
 await page.getByRole('button',{name:'Связать с выездом',exact:true}).click();
 const prompt=page.locator('#promptOverlay'),trips=prompt.locator('[data-pf=trip]');
 await expect(trips.locator('option').last()).toContainText('завершён · дополнительная запись');
 await trips.selectOption({index:1});
 await expect(prompt.locator('.gps-resolution-summary')).toContainText('Пробег, статус и принятые часы выезда сохранятся.');
 await prompt.locator('[data-pf=reason]').fill('Сверка истории поездки');
 await page.locator('#promptYes').click();
 await expect(page.locator('.gps-supplement-note')).toBeVisible();
 await page.getByRole('button',{name:'К GPS-журналу выезда'}).click();
 await expect(page.locator('.journal-trip-head')).toBeVisible();
 await page.locator('[data-journal-pane=documents]').click();
 const supplement=page.locator('.journal-trip-documents').getByRole('link',{name:/Запись №/});
 await expect(supplement).toBeVisible();await supplement.click();
 await expect(page.locator('.gps-supplement-note')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 await clean(page);
});
test('previews and confirms supplemental GPS accounting while keeping an odometer reading',async({page},info)=>{
 await open(page,info,'admin',1,'supplement-accounting');await openOrphanOverview(page);
 await page.getByRole('button',{name:'Связать с выездом',exact:true}).click();
 const prompt=page.locator('#promptOverlay');
 await prompt.locator('[data-pf=trip]').selectOption({index:1});
 await prompt.locator('[data-pf=reason]').fill('Уточнение данных поездки');
 await page.locator('#promptYes').click();
 const apply=page.getByRole('button',{name:'Проверить и учесть GPS'});
 await apply.click();
 const preview=page.locator('#confirmOverlay');
 await expect(preview).toContainText('Добавится GPS-точек: 2');
 await expect(preview).toContainText('Показание одометра останется фактом');
 await expect(preview).toContainText('Точек за пределами выезда в архиве: 1');
 await page.locator('#confirmNo').click();
 expect(await page.evaluate(()=>window.__visualQA.supplementWrites)).toEqual([]);
 await apply.click();
 await page.locator('#confirmYes').click();
 await expect(page.locator('.journal-trip-route')).toBeVisible();
 expect(await page.evaluate(()=>window.__visualQA.supplementWrites.length)).toBe(1);
 await page.locator('[data-journal-pane=documents]').click();
 await page.locator('.journal-trip-documents').getByRole('link',{name:/Запись №/}).click();
 await expect(page.locator('.gps-supplement-note')).toContainText('Запись учтена в основном треке');
 await expect(apply).toHaveCount(0);
 await clean(page);
});
test('prepares a road cut before GPS linking and applies it with the trip road editor',async({page},info)=>{
 await open(page,info,'admin',1,'road-draft');await openOrphanOverview(page);
 await page.getByRole('button',{name:'Дорога',exact:true}).click();
 const road=page.locator('.journal-road-sections'),split=page.getByRole('form',{name:'Разделение участка'});
 await expect(road.getByRole('table',{name:'Участки дороги'})).toBeVisible();
 await expect(road).toContainText('Пробег неизвестен');
 await road.locator('[data-road-expand]').first().click();
 await road.getByRole('button',{name:'Разделить участок'}).click();
 const cut=Date.parse('2026-10-04T08:00:00Z')/1000;
 await split.getByRole('slider').fill(String(cut/60));
 await split.getByRole('button',{name:'Сохранить разделение'}).click();
 await expect(road.locator('[data-road-row]')).toHaveCount(2);
 await page.reload();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(road.locator('[data-road-row]')).toHaveCount(2);
 await page.getByRole('button',{name:'Обзор',exact:true}).click();
 await page.getByRole('button',{name:'Связать с выездом',exact:true}).click();
 const prompt=page.locator('#promptOverlay');
 await prompt.locator('[data-pf=trip]').selectOption({index:1});
 await prompt.locator('[data-pf=reason]').fill('Поездка и дорога проверены');
 await page.locator('#promptYes').click();
 await page.locator('[data-journal-pane=documents]').click();
 await page.getByRole('button',{name:'Проверить разделение'}).click();
 await expect(split.getByRole('slider')).toHaveValue(String(cut/60));
 expect(await page.evaluate(()=>window.__visualQA.roadWrites)).toEqual([]);
 await split.getByRole('button',{name:'Разделить',exact:true}).click();
 await expect(road.locator('[data-road-row]')).toHaveCount(2);
 expect(await page.evaluate(()=>window.__visualQA.roadWrites.map(write=>write.p_value))).toEqual([cut]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 await clean(page);
});
test('charge shows the cost basis and requires a separate amount confirmation',async({page},info)=>{
 await open(page,info);await openOrphanOverview(page);await page.getByRole('button',{name:'Записать списание инженеру',exact:true}).click();
 await expect(page.locator('.gps-resolution-summary')).toContainText('12,5');await page.locator('[data-pf=engineer]').selectOption('00000000-0000-4000-8000-000000000002');
 await page.locator('[data-pf=reason]').fill('Подтверждённая личная поездка');await page.locator('#promptYes').click();
 await expect(page.locator('#confirmOverlay')).toBeVisible();await expect(page.locator('#confirmOverlay')).toContainText('1 500');
 await page.locator('#confirmNo').click();await page.locator('[data-ut-back]').click();await expect(page.locator('[data-ut-card]')).toBeVisible();await clean(page);
});
test('engineer sees own charge without manager resolution controls',async({page},info)=>{
 await open(page,info,'engineer');await expect(page.locator('[data-ut-card]')).toContainText('Списание инженеру');
 await expect(page.getByRole('button',{name:'Создать выезд',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Посмотреть трек'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Отменить списание'})).toHaveCount(0);
 await page.locator('[data-journal-exit]').click();await expect(page.locator('#tripAdd')).toBeHidden();await expect(page.locator('#tripTrash')).toBeHidden();
 await clean(page);
});

test('GPS journal is a dispatcher section, uses the full register and scrolls to the last record',async({page},info)=>{
 await open(page,info,'admin',14);
 await expect(page.locator('#plTrips')).toBeVisible();await expect(page.locator('#plTrips .subtab[data-sub=tracking]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#plTrips .subtab[data-sub=tracking]')).toBeVisible();
 await expect(page.locator('#tripBoard')).toBeHidden();await expect(page.locator('[data-ut-card]')).toHaveCount(14);
 await expect(page.getByRole('table',{name:'GPS-записи'})).toBeVisible();
 await expect(page.locator('.gps-journal-detail')).toBeHidden();
 const scroll=page.locator('.gps-journal-sidebar');
 expect(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.locator('[data-ut-card]').last()).toBeInViewport();
 await scroll.evaluate(el=>el.scrollTop=0);
 await page.locator('[data-journal-exit]').click();await expect(page.locator('#tripBoard')).toBeVisible();await expect(page.locator('#plUnassigned')).toBeHidden();
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect(page).toHaveURL(/#\/journal$/);await expect(page.locator('#plUnassigned')).toBeVisible();
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('#plTrips .subtab[data-sub=tracking]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-ut-card]')).toHaveCount(14);
 await page.screenshot({path:'test-results/surface-fixes/'+info.project.name+'-journal.png'});await clean(page);
});

test('manager orders selected tracks and reviews separate GPS pieces before merging',async({page},info)=>{
 await open(page,info,'admin',3);
 await page.locator('.journal-actions>summary').click();await page.locator('[data-ut-choose]').click();const choices=page.locator('[data-ut-select]');await choices.nth(1).check();await choices.nth(0).check();
 await expect(page.locator('[data-ut-preview]')).toBeEnabled();
 await page.locator('[data-ut-preview]').click();await expect(page.locator('[data-ut-merge]')).toBeVisible();
 await expect(page.locator('.unassigned-merge-preview .gps-track-line')).toHaveCount(2);
 await expect(page.locator('.unassigned-merge-preview .gps-track-point')).toHaveCount(2);
 await expect(page.locator('.unassigned-merge-preview .leaflet-tile-loaded').first()).toBeVisible();
 await page.locator('[data-ut-merge]').click();await expect(page.locator('#promptOverlay')).toContainText('Основание объединения');await page.keyboard.press('Escape');
 await expect(page.locator('[data-ut-merge]')).toBeVisible();
 await page.screenshot({path:'test-results/merge-tracks/'+info.project.name+'.png'});
 await page.locator('[data-ut-clear]').click();await expect(page.locator('.unassigned-merge')).toHaveCount(0);for(const c of await choices.all())await expect(c).not.toBeChecked();
 await clean(page);
});


test('trips actions keep aligned slots and a reachable journal switch',async({page},info)=>{
 await open(page,info);await page.locator('[data-journal-exit]').click();
 if(page.viewportSize().width<=760){await expect(page.locator('#tripTrash')).toBeHidden();await expect(page.locator('[data-trip-section=tracking]')).toBeHidden();await expect(page.locator('#tripAdd')).toBeVisible();}
 await revealDispatcherActions(page);
 for(const selector of ['.trip-list-actions .planner-filter-menu>summary','[data-trip-section=tracking]','#tripTrash']){const box=await page.locator(selector).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);expect(box.height).toBeGreaterThanOrEqual(36);}
 await clickDispatcherControl(page,'.trip-list-actions .planner-filter-menu>summary');await expect(page.locator('#tripLayout')).toBeVisible();await page.keyboard.press('Escape');
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect(page.locator('[data-ut-card]')).toBeVisible();await expect(page.locator('#tripAdd')).toBeHidden();
 await page.locator('[data-journal-exit]').click();await clickDispatcherControl(page,'#tripTrash');await expect(page.locator('#trashOverlay')).toBeVisible();await page.locator('#trashClose').click();
 await expect(page.locator('#tripAdd')).toBeVisible();
 await page.screenshot({path:'test-results/gps-map-header/'+info.project.name+'-trips.png'});await clean(page);
});


test('journal period filters on the server, navigates months and persists after reload',async({page},info)=>{
 await open(page,info,'admin',3);const dates=page.locator('#tripJournalPeriod [data-summary-dates]');
 const pick=async(from,to)=>{await dates.click();await expect(page.locator('#promptOverlay')).toBeVisible();await page.locator('[data-pf=from]').fill(from);await page.locator('[data-pf=to]').fill(to);await page.locator('#promptYes').click();await expect(page.locator('#promptOverlay')).toBeHidden();};
 const toolbar=await page.locator('.journal-page-head').boundingBox(),actions=await page.locator('.journal-actions>summary').boundingBox();expect(actions.x).toBeGreaterThanOrEqual(toolbar.x);expect(actions.x+actions.width).toBeLessThanOrEqual(toolbar.x+toolbar.width+1);
 await page.locator('.journal-actions>summary').click();await page.locator('[data-ut-choose]').click();await page.locator('[data-ut-select]').first().check();await expect(page.locator('.unassigned-merge')).toBeVisible();
 await pick('2026-10-05','2026-10-05');await expect(page.locator('[data-ut-card]')).toHaveCount(1);await expect(page.locator('.unassigned-merge')).toHaveCount(0);await expect(page.locator('[data-ut-card] [data-label="Период"]')).toContainText('5 окт');
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(dates).toContainText('05.10 — 05.10.2026');await expect(page.locator('[data-ut-card]')).toHaveCount(1);
 await page.locator('.journal-filters>summary').click();await page.locator('[data-ut-mode=archive]').click();await expect(page.locator('[data-ut-card]')).toHaveCount(0);await expect(dates).toContainText('05.10 — 05.10.2026');
 await page.locator('[data-ut-mode=pending]').click();await expect(page.locator('[data-ut-card]')).toHaveCount(1);await pick('2026-10-01','2026-10-31');await expect(page.locator('[data-ut-card]')).toHaveCount(3);
 await page.locator('#tripJournalPeriod [data-summary-shift="-1"]').click();await expect(dates).toContainText('01.09 — 30.09.2026');await expect(page.locator('[data-ut-card]')).toHaveCount(0);
 await page.locator('#tripJournalPeriod [data-summary-shift="1"]').click();await expect(dates).toContainText('01.10 — 31.10.2026');await expect(page.locator('[data-ut-card]')).toHaveCount(3);
 expect(await page.locator('.view-planner .pane').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:'test-results/journal-period/'+info.project.name+'.png'});await clean(page);
});
