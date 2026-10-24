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
 expect(await page.locator('#workflow h2').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('18px');
 for(const b of await page.locator('.ds-button:visible,.ds-chip:visible,.ds-segmented button:visible,nav a:visible').all()){const box=await b.boundingBox();expect(box.height).toBeGreaterThanOrEqual(info.project.use.hasTouch?44:36);expect(box.width).toBeGreaterThanOrEqual(44);}
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
test('nested counters preserve journal semantics when filters change',async({page},info)=>{
 await boot(page,info);const chip=page.locator('[data-filter=review]'),count=chip.locator('.ds-count');
 const neutral=await page.locator('[data-filter=all] .ds-count').evaluate(el=>({own:getComputedStyle(el).backgroundColor,parent:getComputedStyle(el.parentElement).backgroundColor}));expect(neutral.own).not.toBe(neutral.parent);
 await expect(count).toHaveText('3');await expect(chip).not.toContainText('·');await expect(count).not.toHaveAttribute('tabindex');
 const before=await count.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));await chip.click();
 expect(await count.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}))).toEqual(before);
 for(const [tone,fg,bg] of [['danger','--red','--danger-bg'],['warning','--warning','--warning-bg'],['success','--green','--success-bg']]){
  const pair=await page.locator('.ds-count[data-tone='+tone+']:not([data-empty])').first().evaluate((el,keys)=>{const css=getComputedStyle(el);return keys.map(k=>css.getPropertyValue(k).trim());},[fg,bg]);expect(contrast(...pair)).toBeGreaterThanOrEqual(4.5);
 }
 await expect(page.locator('.ds-count[data-empty]')).toHaveText('0');await expect(page.locator('.ds-count[data-state=loading]')).toHaveText('…');await expect(page.locator('.ds-count[data-state=unknown]')).toHaveText('—');
});
test('summary presentation switches the same data with keyboard and keeps neutral selection',async({page},info)=>{
 await boot(page,info);const group=page.getByRole('group',{name:'Представление статистики'}),charts=group.getByRole('button',{name:'Диаграммы'}),tables=group.getByRole('button',{name:'Таблицы'});
 await charts.focus();await page.keyboard.press('ArrowRight');await expect(tables).toBeFocused();await expect(tables).toHaveAttribute('aria-pressed','true');await expect(page.locator('#kitTables')).toBeVisible();await expect(page.locator('#kitCharts')).toBeHidden();await expect(page.locator('#kitTables')).toContainText('56');
 await page.keyboard.press('Home');await expect(charts).toHaveAttribute('aria-pressed','true');await expect(page.locator('#kitCharts')).toBeVisible();
 const colors=await charts.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,primary:getComputedStyle(document.querySelector('#saveReview')).backgroundColor}));expect(colors.bg).not.toBe(colors.primary);
});
test('period selection validates a draft, cancels safely, and crosses months and years',async({page},info)=>{
 await boot(page,info);const bar=page.locator('.ds-period'),open=page.locator('#kitPeriodOpen'),dialog=page.locator('#kitPeriodDialog'),from=page.locator('#kitPeriodFrom'),to=page.locator('#kitPeriodTo'),apply=dialog.getByRole('button',{name:'Применить период'});
 await expect(bar).toHaveAttribute('data-from','2026-10-01');await page.locator('[data-period-shift="1"]').click();await expect(bar).toHaveAttribute('data-to','2026-11-30');
 await open.click();await from.fill('');await apply.click();await expect(from).toHaveAttribute('aria-invalid','true');
 await from.fill('2026-12-31');await to.fill('2026-12-01');await apply.click();await expect(to).toBeFocused();await expect(page.locator('#kitPeriodError')).toContainText('Начало периода позже конца');await expect(bar).toHaveAttribute('data-from','2026-11-01');
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(open).toBeFocused();await open.click();await expect(from).toHaveValue('2026-11-01');
 await from.fill('2027-12-01');await to.fill('2027-12-31');await apply.click();await page.locator('[data-period-shift="1"]').click();await expect(bar).toHaveAttribute('data-from','2028-01-01');await expect(bar).toHaveAttribute('data-to','2028-01-31');
 await open.click();await from.fill('2028-02-01');await to.fill('2028-02-29');await apply.click();await page.locator('[data-period-shift="1"]').click();await expect(bar).toHaveAttribute('data-to','2028-03-31');
 await open.click();await from.fill('2026-10-05');await to.fill('2026-10-08');await apply.click();await expect(page.locator('[data-period-preset][aria-pressed=true]')).toHaveCount(0);await expect(page.locator('#kitPeriodStatus')).toContainText('Произвольный период');
 await page.locator('[data-period-shift="1"]').click();await expect(bar).toHaveAttribute('data-from','2026-10-09');await expect(bar).toHaveAttribute('data-to','2026-10-12');await page.locator('[data-period-today]').click();await expect(bar).toHaveAttribute('data-to','2026-10-27');
 mkdirSync('test-results/design-system/'+info.project.name,{recursive:true});await page.locator('#dates').screenshot({path:'test-results/design-system/'+info.project.name+'/period.png'});
});
