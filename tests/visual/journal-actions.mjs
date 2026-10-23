// Follow the visible disclosure controls introduced by the compact journal.
export async function openJournalPane(page,pane){
 const button=page.locator('[data-journal-pane="'+pane+'"]');
 if(!await button.isVisible())await page.locator('.journal-trip-menu>summary').click();
 await button.click();
}
export async function openLocation(page){const disclosure=page.locator('.journal-location-preview');if(await disclosure.isVisible()&&!await disclosure.evaluate(e=>e.open))await disclosure.locator('summary').click();}
export async function openChoice(row,key){const caption=row.locator('[data-choice-summary="'+key+'"]');if(await caption.count()&&!await caption.locator('..').evaluate(e=>e.open))await caption.click();}
