import {revealDispatcherActions,clickDispatcherControl} from './dispatcher-controls.mjs';
import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
const errors=[];
async function open(page,info,role='admin',unassignedCount=1){
 errors.length=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{
  const url=new URL(r.request().url());
  // Deterministic tile fixture exercises image loading without remote services.
  if(url.hostname.endsWith('tile.openstreetmap.org')||url.hostname==='api.maptiler.com')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5e2d6"/><path d="M20 0 L60 90 35 256 M190 0 L155 110 230 256" fill="none" stroke="#aad2dd" stroke-width="18"/><path d="M0 80 L256 175 M85 0 L175 256" stroke="#fff" stroke-width="8"/><path d="M0 80 L256 175 M85 0 L175 256" stroke="#d2bd83" stroke-width="2"/><text x="10" y="30" font-family="sans-serif" font-size="12" fill="#555">Подложка QA</text></svg>'});
  return url.origin==='http://127.0.0.1:4173'?r.continue():r.abort();
 });
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,unassignedJourney:true,unassignedCount,preserveRanges:true});
 await page.goto('/#/planner/tracking');await expect(page.locator('#unassignedHost .unassigned-card').first()).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
}
async function clean(page){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
test('unassigned queue and GPS preview remain usable at each width',async({page},info)=>{
 await open(page,info);await page.getByRole('button',{name:'Посмотреть трек'}).click();
 await expect(page.locator('.unassigned-map')).toBeVisible();
 await expect(page.locator('.unassigned-map .leaflet-tile-loaded').first()).toBeVisible();
 expect(await page.locator('.unassigned-map .leaflet-tile-loaded').first().evaluate(img=>img.naturalWidth)).toBe(256);
 await expect(page.locator('.unassigned-map .leaflet-control-attribution')).toContainText('OpenStreetMap');
 const before=await page.locator('.unassigned-map .gps-track-line').getAttribute('d');
 await page.locator('.unassigned-map .leaflet-control-zoom-in').click();
 await expect.poll(()=>page.locator('.unassigned-map .gps-track-line').getAttribute('d')).not.toBe(before);
 await expect(page.locator('.unassigned-detail')).toContainText('120');
 const overflow=await page.locator('#unassignedHost').evaluate(el=>el.scrollWidth-el.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
 await expect(page.locator('[data-ut-more]')).not.toBeVisible();
 for(const tab of await page.locator('#plUnassigned .subtab').all())expect(await tab.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
 const buttons=await page.locator('.unassigned-card button:visible').evaluateAll(xs=>xs.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,w:r.width,h:r.height,text:el.textContent};}));
 for(const b of buttons){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(page.viewportSize().width);expect(b.h).toBeGreaterThanOrEqual(36);}
 await page.screenshot({path:'test-results/unassigned-screenshots/'+info.project.name+'.png',fullPage:true});
 await clean(page);
});
test('chain draft collects client and engineer and can cancel without writes',async({page},info)=>{
 await open(page,info);await page.getByRole('button',{name:'Создать цепочку'}).click();
 await expect(page.locator('#promptOverlay')).toBeVisible();await expect(page.locator('#promptOverlay')).toContainText('Клиент заявки');
 await expect(page.locator('#promptOverlay')).toContainText('Инженер');await page.keyboard.press('Escape');
 await expect(page.locator('#promptOverlay')).not.toBeVisible();await expect(page.getByRole('button',{name:'Создать цепочку'})).toBeFocused();await clean(page);
});
test('charge shows the cost basis and requires a separate amount confirmation',async({page},info)=>{
 await open(page,info);await page.getByText('Другие действия',{exact:true}).click();await page.getByRole('button',{name:'Списать инженеру',exact:true}).click();
 await expect(page.locator('#promptTitle')).toContainText('12,5');await page.locator('[data-pf=engineer]').selectOption('00000000-0000-4000-8000-000000000002');
 await page.locator('[data-pf=reason]').fill('Подтверждённая личная поездка');await page.locator('#promptYes').click();
 await expect(page.locator('#confirmOverlay')).toBeVisible();await expect(page.locator('#confirmOverlay')).toContainText('1 500');
 await page.locator('#confirmNo').click();await expect(page.locator('.unassigned-card')).toBeVisible();await clean(page);
});
test('engineer sees own charge without manager resolution controls',async({page},info)=>{
 await open(page,info,'engineer');await expect(page.locator('.unassigned-card')).toContainText('Списание инженеру');
 await expect(page.getByRole('button',{name:'Создать цепочку'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Посмотреть трек'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Отменить списание'})).toHaveCount(0);
 await page.locator('[data-trip-section=board]').click();await expect(page.locator('#tripAdd')).toBeHidden();await expect(page.locator('#tripTrash')).toBeHidden();
 await clean(page);
});

test('GPS journal is nested under trips, has standard card gaps and scrolls to the last record',async({page},info)=>{
 await open(page,info,'admin',14);
 await expect(page.locator('#plTrips')).toBeVisible();await expect(page.locator('#plTrips .subtab[data-sub=trips]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.subtab[data-sub=tracking]')).toHaveCount(0);
 await expect(page.locator('#tripBoard')).toBeHidden();await expect(page.locator('.unassigned-card')).toHaveCount(14);
 const gap=await page.locator('.unassigned-list').evaluate(el=>{const [a,b]=el.children;return b.getBoundingClientRect().top-a.getBoundingClientRect().bottom;});
 expect(gap).toBe(12);
 const scroll=page.viewportSize().width>760?page.locator('#plUnassigned'):page.locator('.view-planner .pane');
 expect(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.locator('.unassigned-card').last()).toBeInViewport();
 await scroll.evaluate(el=>el.scrollTop=0);
 await page.locator('[data-trip-section=board]').click();await expect(page.locator('#tripBoard')).toBeVisible();await expect(page.locator('#plUnassigned')).toBeHidden();
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect(page).toHaveURL(/#\/planner\/trips\/tracking$/);await expect(page.locator('#plUnassigned')).toBeVisible();
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('#plTrips .subtab[data-sub=trips]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.unassigned-card')).toHaveCount(14);
 await page.screenshot({path:'test-results/surface-fixes/'+info.project.name+'-journal.png'});await clean(page);
});

test('manager orders selected tracks and reviews separate GPS pieces before merging',async({page},info)=>{
 await open(page,info,'admin',3);
 const choices=page.locator('[data-ut-select]');await choices.nth(1).check();await choices.nth(0).check();
 await expect(page.locator('[data-ut-preview]')).toBeDisabled();await expect(page.locator('.unassigned-merge')).toContainText('по времени');
 await page.locator('[data-ut-move="1"][data-step="-1"]').click();await expect(page.locator('[data-ut-preview]')).toBeEnabled();
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
 await open(page,info);await page.locator('[data-trip-section=board]').click();
 if(page.viewportSize().width<=760){await expect(page.locator('#tripTrash')).toBeHidden();await expect(page.locator('[data-trip-section=tracking]')).toBeHidden();await expect(page.locator('#tripAdd')).toBeVisible();}
 await revealDispatcherActions(page);
 for(const selector of ['.trip-list-actions .planner-filter-menu>summary','[data-trip-section=tracking]','#tripTrash']){const box=await page.locator(selector).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);expect(box.height).toBeGreaterThanOrEqual(36);}
 await clickDispatcherControl(page,'.trip-list-actions .planner-filter-menu>summary');await expect(page.locator('#tripLayout')).toBeVisible();await page.keyboard.press('Escape');
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect(page.locator('.unassigned-card')).toBeVisible();await expect(page.locator('#tripAdd')).toBeHidden();
 await clickDispatcherControl(page,'#tripTrash');await expect(page.locator('#trashOverlay')).toBeVisible();await page.locator('#trashClose').click();
 await clickDispatcherControl(page,'[data-trip-section=tracking]');await expect(page.locator('#tripAdd')).toBeVisible();
 await page.screenshot({path:'test-results/gps-map-header/'+info.project.name+'-trips.png'});await clean(page);
});


test('journal period filters on the server, navigates months and persists after reload',async({page},info)=>{
 await open(page,info,'admin',3);
 const from=page.locator('#tripJournalPeriod [data-rf]'),to=page.locator('#tripJournalPeriod [data-rt]');
 await expect(from).toBeVisible();await expect(to).toBeVisible();
 const toolbar=await page.locator('#plTrips .dispatcher-toolbar').boundingBox(),actions=await page.locator(page.viewportSize().width<=760?'#plTrips .dispatcher-more>summary':'#plTrips .dispatcher-actions').boundingBox();
 expect(Math.abs(actions.x+actions.width-toolbar.x-toolbar.width)).toBeLessThanOrEqual(1);
 await page.locator('[data-ut-select]').first().check();await expect(page.locator('.unassigned-merge')).toBeVisible();
 await from.fill('2026-10-05');await from.dispatchEvent('change');await to.fill('2026-10-05');await to.dispatchEvent('change');
 await expect(page.locator('.unassigned-card')).toHaveCount(1);await expect(page.locator('.unassigned-merge')).toHaveCount(0);
 await expect(page.locator('.unassigned-period')).toContainText('05.10.2026');
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(from).toHaveValue('2026-10-05');await expect(to).toHaveValue('2026-10-05');await expect(page.locator('.unassigned-card')).toHaveCount(1);
 await page.locator('[data-ut-mode=archive]').click();await expect(page.locator('.unassigned-card')).toHaveCount(0);await expect(from).toHaveValue('2026-10-05');
 await page.locator('[data-ut-mode=pending]').click();await expect(page.locator('.unassigned-card')).toHaveCount(1);
 await page.locator('#tripJournalPeriod [data-rmonth="-1"]').click();await expect(from).toHaveValue('2026-09-01');await expect(to).toHaveValue('2026-09-30');await expect(page.locator('.unassigned-card')).toHaveCount(0);
 await page.locator('#tripJournalPeriod [data-rmonth="1"]').click();await expect(from).toHaveValue('2026-10-01');await expect(to).toHaveValue('2026-10-31');await expect(page.locator('.unassigned-card')).toHaveCount(3);
 for(const input of [from,to])expect(await input.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(130);
 expect(await page.locator('.view-planner .pane').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:'test-results/journal-period/'+info.project.name+'.png'});await clean(page);
});
