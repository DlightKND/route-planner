import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

// The approved HTML is preserved byte-for-byte, including its embedded fonts.
export const approvedPlannerHTML=gunzipSync(readFileSync(new URL('./fixtures/approved-planner-v13.html.gz',import.meta.url))).toString('utf8');
for(const role of ['manager','engineer'])test('approved v13 reference: '+role,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Test-only null-selection guard; the saved fixture and visual rules are unchanged.
 await page.route('**/approved-planner-reference',route=>route.fulfill({contentType:'text/html',body:approvedPlannerHTML.replace('same&&state.planFactSelected.person','same&&state.planFactSelected?.person')}));
 await page.goto('/approved-planner-reference');
 await page.locator('[data-demo-role]').selectOption(role);
 if(info.project.metadata.theme==='light')await page.locator('.preview-tools [data-action=theme]').click();
 await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('#dlight-prototype .app')).toBeVisible();
 const folder='test-results/approved-planner-reference/'+info.project.name;mkdirSync(folder,{recursive:true});
 for(const mode of ['graph','stats']){
  if(await page.locator('#dlight-prototype .mode-switch [data-action='+mode+']').getAttribute('aria-pressed')!=='true'){if(await page.locator('#dlight-prototype .mobile-title-mode').isVisible())await page.locator('#dlight-prototype .mobile-title-mode').click();else await page.locator('#dlight-prototype .mode-switch [data-action='+mode+']').click();}
  await page.locator('#dlight-prototype .app').screenshot({path:folder+'/'+role+'-'+mode+'.png',animations:'disabled'});
 }
 expect(errors).toEqual([]);
});
