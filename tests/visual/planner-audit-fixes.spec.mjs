import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
async function boot(page,info,options={}){
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.clock.install({time:new Date('2026-10-05T10:00Z')});await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,canonicalPlanner:true,...options});
 await page.goto('/#/schedule');if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();await expect(page.locator('.pw-plan')).toHaveCount(6);
 return page.locator('.pw-root').evaluate(e=>e.classList.contains('pw-mobile'));
}
const tool=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true}).first();
test('planner audit: panel geometry, tool states, error fields and Escape preserve the graph',async({page},info)=>{
 const mobile=await boot(page,info),filter=tool(page,'Открыть мультифильтр'),overview=tool(page,'Открыть рабочий обзор');
 if(await overview.getAttribute('aria-expanded')!=='true')await overview.click();await expect(overview).toHaveAttribute('aria-expanded','true');await expect(page.locator('.pw-context')).toHaveAccessibleName('Рабочий обзор');
 const context=page.locator('.pw-context');await expect(context).toHaveCSS('box-shadow','none');await expect(context.locator('#pw-context-title')).toHaveCSS('font-size','18px');
 await filter.click();const panel=page.locator('#pw-filter-panel');await expect(panel).toHaveAccessibleName('Фильтры');
 await expect(overview).toHaveAttribute('aria-expanded','false');await expect(context).toBeHidden();
 await expect(panel).toHaveCSS('box-shadow','none');await expect(panel.locator('.dialog-scroll')).toHaveCSS('padding','16px');
 await expect(panel.locator('[name=profitMin]')).toHaveCSS('font-size',mobile?'16px':'14px');
 await expect(panel.locator('[type=submit]')).toHaveCSS('min-height',mobile?'48px':'40px');
 const style=await filter.evaluate(e=>{const c=getComputedStyle(e);return {color:c.color,background:c.backgroundColor,shadow:c.boxShadow,outline:c.outlineStyle};});
 expect(style.background).not.toBe('rgb(255, 225, 0)');expect(style.shadow).toContain('inset');expect(style.outline).toBe('none');
 await panel.locator('[name=profitMin]').fill('10');await panel.locator('[name=profitMax]').fill('5');await panel.locator('[type=submit]').click();
 await expect(panel.locator('[name=profitMin]')).toHaveAttribute('aria-invalid','true');await expect(panel.locator('[name=profitMin]')).toHaveAttribute('aria-describedby','pw-dialog-error');await expect(panel.locator('[name=profitMin]')).toBeFocused();
 await expect(panel.locator('[type=submit]')).toBeEnabled();await panel.locator('[name=profitMax]').fill('20');await expect(panel.locator('[aria-invalid]')).toHaveCount(0);
 await panel.locator('[name=profitMax]').press('Escape');await page.locator('#confirmYes').click();await expect(panel).toHaveCount(0);await expect(overview).toHaveAttribute('aria-expanded','true');
 if(!mobile){await filter.click();await filter.click();await expect(filter).toHaveAttribute('aria-expanded','true');await page.locator('#pw-filter-panel [data-pw-dialog-close]').first().click();await expect(filter).toHaveAttribute('aria-expanded','false');}
 await expect(page.locator('.pw-plan')).toHaveCount(6);expect(await page.evaluate(()=>window.__visualQA.plannerWrites)).toEqual([]);
});
test('planner audit: busy day form locks every control and recovers a failed save without losing draft',async({page},info)=>{
 const mobile=await boot(page,info,{staffDayDelay:2000,staffDayFailures:1});
 await page.locator('[data-pw=period]').click();await page.locator('.pw-dialog [name=from]').fill('2026-10-10');await page.locator('.pw-dialog [name=to]').fill('2026-10-11');await page.locator('.pw-dialog [type=submit]').click();
 await page.locator('[data-pw=workday-edit]').first().click();const panel=page.locator('.pw-workday-dialog');await panel.locator('[name=dayMode][value=work]').check();await panel.locator('[name=start]').fill('09:00');await panel.locator('[name=end]').fill('14:00');
 await expect(panel.locator('.dialog-foot [data-pw-dialog-close]')).toHaveCSS('min-height',mobile?'48px':'40px');await panel.locator('[type=submit]').click();await expect(panel).toHaveAttribute('aria-busy','true');
 expect(await panel.locator('button,input,select,textarea').evaluateAll(els=>els.every(e=>e.disabled))).toBe(true);await expect(panel.locator('.pw-form-status')).toContainText('Сохраняются рабочие часы');
 await page.clock.runFor(2100);await expect(panel).toHaveAttribute('aria-busy','false');await expect(panel.locator('.pw-form-error')).toContainText('связь прервана');await expect(panel.locator('[name=start]')).toHaveValue('09:00');await expect(panel.locator('[type=submit]')).toBeEnabled();
 await panel.locator('[type=submit]').click();await page.clock.runFor(2100);await expect(panel).toHaveCount(0);expect(await page.evaluate(()=>window.__visualQA.staffDayWrites)).toHaveLength(1);
});
