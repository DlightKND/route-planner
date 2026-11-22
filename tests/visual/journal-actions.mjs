// Follow the visible disclosure controls introduced by the compact journal.
export async function showJournalOverview(page,mode){
 if(page.viewportSize().width<=760)await page.locator('[data-journal-overview-mode="'+mode+'"]').click();
}

export async function openOrphanOverview(page){
 await page.locator('[data-ut-details]').first().click();
 await page.locator('.journal-orphan-overview').waitFor();
}

export async function openJournalPane(page,pane){
 if(pane==='route'){
  const expand=page.locator('.journal-overview-map [data-expand-map]');
  const stopMap=page.locator('.presence-review-map [data-presence-route]');
  await openLocation(page);
  if(await stopMap.isVisible()){await stopMap.click();return;}
  await showJournalOverview(page,'map');
  await expand.click();
  return;
 }
 await page.locator('[data-journal-pane="'+pane+'"]').click();
}
export async function openLocation(page){const disclosure=page.locator('.journal-location-preview');if(await disclosure.isVisible()&&!await disclosure.evaluate(e=>e.open))await disclosure.locator('summary').click();}
export async function openChoice(row,key){const caption=row.locator('[data-choice-summary="'+key+'"]');if(await caption.count()&&!await caption.locator('..').evaluate(e=>e.open))await caption.click();}
