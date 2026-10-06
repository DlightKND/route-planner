import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
const errors=[];
async function open(page,info,role='admin'){
 errors.length=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.addInitScript(installMockBackend,{role,theme:info.project.metadata.theme,unassignedJourney:true});
 await page.goto('/#/planner/tracking');await expect(page.locator('#unassignedHost .unassigned-card')).toBeVisible();
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
