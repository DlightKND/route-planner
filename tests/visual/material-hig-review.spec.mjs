import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
async function boot(page,info){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/preview-design-system.html?theme='+info.project.metadata.theme+'#conventions');
 await expect(page.locator('#conventions')).toBeVisible();await page.evaluate(()=>document.fonts.ready);return errors;
}
async function tab(page,id){await page.locator('#gTab-'+id).click();await expect(page.locator('#gPane-'+id)).toBeVisible();}
async function shot(page,info,name){const dir='test-results/material-hig/'+info.project.name;mkdirSync(dir,{recursive:true});await page.locator('#conventions').screenshot({path:dir+'/'+name+'.png'});}
test('review modes, touch targets and all eight examples fit both themes',async({page},info)=>{
 const errors=await boot(page,info);await expect(page.locator('[data-guidance-pane]')).toHaveCount(8);
 await page.locator('#gTouchPreview').check();await expect(page.locator('body')).toHaveAttribute('data-touch-preview','true');
 expect((await page.locator('#gSave').boundingBox()).height).toBeGreaterThanOrEqual(48);
 await page.locator('[data-g-mode=base]').click();await expect(page.locator('body')).toHaveAttribute('data-guidance','base');
 await page.locator('[data-g-mode=proposed]').click();
 for(const id of ['actions','selection','settings','dates','people','slider','feedback','map']){await tab(page,id);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,info,id);}
 await page.locator('#themeToggle').click();await expect(page.locator('html')).toHaveAttribute('data-theme',info.project.metadata.theme==='light'?'dark':'light');expect(errors).toEqual([]);
});
test('action loading holds width, ignores duplicate activation and permits retry',async({page},info)=>{
 await boot(page,info);const save=page.locator('#gSave'),width=(await save.boundingBox()).width;
 await page.locator('#gSaveFailure').check();await save.click();await expect(save).toHaveAttribute('aria-busy','true');expect((await save.boundingBox()).width).toBeCloseTo(width,0);
 await save.press('Enter');await expect(page.locator('#gSaveStatus')).toContainText('Не удалось');await expect(save).not.toHaveAttribute('aria-busy');
 await page.locator('#gSaveFailure').uncheck();await save.click();await expect(page.locator('#gSaveStatus')).toContainText('сохранён');await expect(page.locator('#gCancel')).toBeEnabled();
});
test('connected choices support keyboard, retain count meaning and equal widths',async({page},info)=>{
 await boot(page,info);await tab(page,'selection');const list=page.locator('[data-g-view=list]'),board=page.locator('[data-g-view=board]');
 await list.focus();await page.keyboard.press('ArrowRight');await expect(board).toBeFocused();await expect(board).toHaveAttribute('aria-pressed','true');await expect(page.locator('#gSelectionStatus')).toContainText('Доска');
 expect((await list.boundingBox()).width).toBeCloseTo((await board.boundingBox()).width,0);
 const count=page.locator('[data-g-filter=review] .ds-count'),before=await count.evaluate(el=>getComputedStyle(el).backgroundColor);await page.locator('[data-g-filter=review]').click();expect(await count.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(before);
 await page.locator('[name=gGroupStyle][value=expressive]').check();await expect(page.locator('body')).toHaveAttribute('data-group-style','expressive');expect((await list.boundingBox()).width).toBeCloseTo((await board.boundingBox()).width,0);await shot(page,info,'expressive');
 await board.focus();await page.keyboard.press('Home');await expect(list).toHaveAttribute('aria-pressed','true');
});
test('immediate setting rolls back failure while a decision stays a draft',async({page},info)=>{
 await boot(page,info);await tab(page,'settings');const toggle=page.locator('#gAuto');await page.locator('#gAutoFailure').check();await toggle.click();await expect(toggle).toHaveAttribute('aria-busy','true');await expect(page.locator('#gAutoStatus')).toContainText('прежнее');await expect(toggle).toHaveAttribute('aria-checked','false');
 await page.locator('#gAutoFailure').uncheck();await toggle.click();await expect(page.locator('#gAutoStatus')).toContainText('Включено');await expect(toggle).toHaveAttribute('aria-checked','true');await page.locator('[name=gPresence][value=no]').check();await expect(page.locator('#gPresenceStatus')).toContainText('ещё не сохранено');
});
test('date draft validates, cancels and returns focus without changing the period',async({page},info)=>{
 await boot(page,info);await tab(page,'dates');const open=page.locator('#gDateOpen'),dialog=page.locator('#gDateDialog'),label=await page.locator('#gDateLabel').innerText();await open.click();
 await page.locator('#gFrom').fill('2026-12-31');await page.locator('#gTo').fill('2026-12-01');await dialog.getByRole('button',{name:'Применить период'}).click();await expect(page.locator('#gTo')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#gDateError')).not.toBeEmpty();
 await page.keyboard.press('Escape');await expect(open).toBeFocused();await expect(page.locator('#gDateLabel')).toHaveText(label);await open.click();await page.locator('#gFrom').fill('2027-12-01');await page.locator('#gTo').fill('2027-12-31');await dialog.getByRole('button',{name:'Применить период'}).click();await page.locator('[data-g-shift="1"]').click();await expect(page.locator('#gDateLabel')).toContainText('2028');
 await open.click();const b=await dialog.boundingBox();if(page.viewportSize().width<=760)expect(b.y+b.height).toBeCloseTo(page.viewportSize().height,0);await page.screenshot({path:test.info().outputPath('date-editor.png')});await page.locator('#gDateCancel').click();await expect(open).toBeFocused();
});
test('engineer picker searches, selects stable IDs and removes a named token',async({page},info)=>{
 await boot(page,info);await tab(page,'people');await page.locator('#gPeopleOpen').click();const picker=page.locator('.g-picker');await expect(picker).toBeVisible();expect(await picker.evaluate(el=>el.tagName)).toBe(page.viewportSize().width<=760?'DIALOG':'DIV');
 await page.locator('#gPeopleSearch').fill('несуществующий');await expect(picker.locator('[data-g-people-match]')).toContainText('не найдены');await page.locator('#gPeopleSearch').fill('Иван');await picker.locator('input[value=ivan]').check();await expect(page.locator('#gPeopleCount')).toHaveText('2');
 await page.locator('#gPeopleSearch').fill('');await page.screenshot({path:test.info().outputPath('engineer-picker.png')});await picker.locator('[data-g-done]').click();await expect(page.locator('#gPeopleOpen')).toBeFocused();await page.getByRole('button',{name:'Убрать Анна Смирнова',exact:true}).click();await expect(page.locator('#gPeopleCount')).toHaveText('1');
 await page.locator('#gPeopleOpen').click();await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);await expect(page.locator('#gPeopleOpen')).toBeFocused();
});
test('slider has exact alternatives and rejects invalid values',async({page},info)=>{
 await boot(page,info);await tab(page,'slider');const slider=page.locator('#gDistance'),exact=page.locator('#gDistanceExact');await slider.focus();await page.keyboard.press('End');await expect(exact).toHaveValue('50');await expect(page.locator('#gDistancePlus')).toBeDisabled();await page.keyboard.press('Home');await expect(exact).toHaveValue('0');await expect(page.locator('#gDistanceMinus')).toBeDisabled();
 await exact.fill('51');await page.locator('#gDistanceApply').click();await expect(exact).toBeFocused();await expect(exact).toHaveAttribute('aria-invalid','true');await exact.fill('12');await page.locator('#gDistanceApply').click();await expect(page.locator('#gDistanceStatus')).toContainText('12 км');await expect(slider).toHaveAttribute('aria-valuetext','12 км');
});
test('undo is immediate and irreversible deletion has no default action',async({page},info)=>{
 await boot(page,info);await tab(page,'feedback');await page.locator('#gTrash').click();await expect(page.locator('#gDraftRecord')).toBeHidden();await expect(page.locator('#gUndoBar')).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(0);await page.locator('#gUndo').click();await expect(page.locator('#gDraftRecord')).toBeVisible();await expect(page.locator('#gTrash')).toBeFocused();
 await page.locator('#gPurgeOpen').click();await expect(page.locator('#gPurgeTitle')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#gPurgeDialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#gPurgeOpen')).toBeFocused();await page.locator('#gPurgeOpen').click();await page.locator('#gPurgeConfirm').click();await expect(page.locator('#gPurgeStatus')).toContainText('Демонстрационная запись удалена');
});
test('map FAB clears the bottom control and is hidden when unavailable',async({page},info)=>{
 await boot(page,info);await tab(page,'map');const fab=page.locator('#gFab'),fb=await fab.boundingBox(),bottom=await page.locator('.g-map-bottom').boundingBox();expect(fb.y+fb.height).toBeLessThanOrEqual(bottom.y);expect(fb.width).toBeGreaterThanOrEqual(56);
 await page.locator('#gCanCreate').uncheck();await expect(fab).toBeHidden();await page.locator('#gSheetOpen').click();await expect(page.locator('#gMapSheet')).toBeVisible();await page.screenshot({path:test.info().outputPath('map-sheet.png')});await page.locator('#gSheetClose').click();await expect(page.locator('#gSheetOpen')).toBeFocused();await page.locator('#gCanCreate').check();await fab.click();await expect(page.locator('#gPointDialog')).toBeVisible();await page.locator('#gPointCancel').click();await expect(fab).toBeFocused();
});
