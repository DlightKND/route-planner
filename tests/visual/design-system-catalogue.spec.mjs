import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
async function boot(page,info){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/preview-design-system.html?theme='+info.project.metadata.theme);
 await expect(page.locator('h1')).toHaveText('Одна система. Разные задачи.');
 await page.evaluate(()=>document.fonts.ready);return errors;
}
function contrast(a,b){
 const luminance=hex=>{const c=hex.trim().replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
test('catalogue shares tokens, has accessible targets and fits the viewport',async({page},info)=>{
 const errors=await boot(page,info);
 const tokens=await page.evaluate(()=>{const css=getComputedStyle(document.documentElement);return Object.fromEntries(['--ink','--ink-dim','--bg','--panel','--panel-2','--on-accent','--accent','--green','--success-bg','--red','--danger-bg','--danger-ink','--input-line','--focus'].map(k=>[k,css.getPropertyValue(k).trim()]));});
 for(const [fg,bg] of [['--ink','--panel'],['--ink-dim','--panel'],['--ink-dim','--panel-2'],['--on-accent','--accent'],['--green','--success-bg'],['--red','--danger-bg'],['--danger-ink','--red']])expect(contrast(tokens[fg],tokens[bg]),fg+' / '+bg).toBeGreaterThanOrEqual(4.5);
 for(const fg of ['--focus','--input-line'])expect(contrast(tokens[fg],tokens['--panel']),fg).toBeGreaterThanOrEqual(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#reviewForm [data-variant=primary]')).toHaveCount(1);
 expect(await page.locator('h1').evaluate(el=>getComputedStyle(el).fontSize)).toBe(page.viewportSize().width<=760?'23px':'28px');
 expect(await page.locator('h2').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('18px');
 for(const b of await page.locator('.ds-button:visible,.ds-chip:visible').all()){const box=await b.boundingBox();expect(box.height).toBeGreaterThanOrEqual(info.project.use.hasTouch?44:36);expect(box.width).toBeGreaterThanOrEqual(44);}
 await page.locator('#themeToggle').focus();await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('data-theme',info.project.metadata.theme==='light'?'dark':'light');await page.keyboard.press('Enter');
 await expect(page.locator('.ds-badge').first()).not.toHaveAttribute('tabindex');
 mkdirSync('test-results/design-system/'+info.project.name,{recursive:true});await page.screenshot({path:'test-results/design-system/'+info.project.name+'/catalogue.png',fullPage:true});expect(errors).toEqual([]);
});
test('review distinguishes empty and zero, prevents duplicates and preserves a failed draft',async({page},info)=>{
 await boot(page,info);const minutes=page.locator('#minutes'),reason=page.locator('#reason'),save=page.locator('#saveReview');
 await minutes.fill('');await save.click();await expect(minutes).toHaveAttribute('aria-invalid','true');await expect(minutes).toBeFocused();
 await minutes.fill('0');await save.click();await expect(reason).toHaveAttribute('aria-invalid','true');
 await reason.fill('Куратор подтвердил нулевое время');await page.locator('#simulateFailure').check();await save.click();await expect(save).toHaveAttribute('aria-busy','true');await save.press('Enter');
 await expect(page.locator('#saveFeedback')).toContainText('Не удалось сохранить');await expect(minutes).toHaveValue('0');await expect(reason).toHaveValue('Куратор подтвердил нулевое время');await expect(page.locator('#accepted')).toHaveText('не сохранено');
 await page.locator('#simulateFailure').uncheck();await save.click();await expect(page.locator('#accepted')).toHaveText('0 мин');await expect(save).not.toHaveAttribute('aria-busy');
});
test('selection and destructive dialog support keyboard and focus return',async({page},info)=>{
 await boot(page,info);const chip=page.locator('[data-filter=review]');await chip.focus();await page.keyboard.press('Space');await expect(chip).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-filter=all]')).toHaveAttribute('aria-pressed','false');
 const toggle=page.locator('#reminders');await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-checked','true');
 const trigger=page.locator('#openDelete');await trigger.click();await expect(page.locator('#cancelDelete')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#deleteDialog')).not.toBeVisible();await expect(trigger).toBeFocused();
});
