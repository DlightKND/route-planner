import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
const errors=[];
async function open(page,info,role='admin',unassignedCount=1){
 errors.length=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,unassignedJourney:true,unassignedCount});
 await page.goto('/#/planner/tracking');await expect(page.locator('#unassignedHost .unassigned-card').first()).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
}
async function clean(page){expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);}
test('unassigned queue and GPS preview remain usable at each width',async({page},info)=>{
 await open(page,info);await page.getByRole('button',{name:'Посмотреть трек'}).click();
 await expect(page.locator('.unassigned-preview')).toBeVisible();await expect(page.locator('.unassigned-detail')).toContainText('120');
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
 await expect(page.getByRole('button',{name:'Отменить списание'})).toHaveCount(0);await clean(page);
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
 await page.locator('[data-trip-section=tracking]').click();await expect(page).toHaveURL(/#\/planner\/trips\/tracking$/);await expect(page.locator('#plUnassigned')).toBeVisible();
 await page.reload();if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('#plTrips .subtab[data-sub=trips]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.unassigned-card')).toHaveCount(14);
 await page.screenshot({path:'test-results/surface-fixes/'+info.project.name+'-journal.png'});await clean(page);
});

test('manager orders selected tracks and reviews separate GPS pieces before merging',async({page},info)=>{
 await open(page,info,'admin',3);
 const choices=page.locator('[data-ut-select]');await choices.nth(1).check();await choices.nth(0).check();
 await expect(page.locator('[data-ut-preview]')).toBeDisabled();await expect(page.locator('.unassigned-merge')).toContainText('по времени');
 await page.locator('[data-ut-move="1"][data-step="-1"]').click();await expect(page.locator('[data-ut-preview]')).toBeEnabled();
 await page.locator('[data-ut-preview]').click();await expect(page.locator('[data-ut-merge]')).toBeVisible();
 await expect(page.locator('.unassigned-merge-preview polyline')).toHaveCount(4);
 await page.locator('[data-ut-merge]').click();await expect(page.locator('#promptOverlay')).toContainText('Основание объединения');await page.keyboard.press('Escape');
 await expect(page.locator('[data-ut-merge]')).toBeVisible();
 await page.screenshot({path:'test-results/merge-tracks/'+info.project.name+'.png'});
 await page.locator('[data-ut-clear]').click();await expect(page.locator('.unassigned-merge')).toHaveCount(0);for(const c of await choices.all())await expect(c).not.toBeChecked();
 await clean(page);
});
