export async function revealDispatcherActions(page){
  if(page.viewportSize().width>760)return;
  const menu=page.locator('.view.active .dispatcher-more:visible');
  if(await menu.count()&&!await menu.evaluate(el=>el.open))await menu.locator(':scope>summary').click();
}
export async function clickDispatcherControl(page,selector){
  await revealDispatcherActions(page);await page.locator(selector).click();
}
