import {test,expect} from '@playwright/test';
import {installMockBackend,fixtureIDs} from './mock-backend.mjs';

// One command = one line: a button never grows a second line, and the commands of one action row
// share one width (the longest label) — side by side when all fit, one per line otherwise.
async function open(page,info,route){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role:'logist',theme:info.project.metadata.theme,maintenancePlanJourney:true,directoryJourney:true});
  await page.goto('/#/'+route);
  await page.waitForFunction(()=>document.documentElement.dataset.uiSystem);
  await page.evaluate(()=>document.getElementById('todayOverlay')?.classList.remove('on'));
  return errors;
}
const ROW_LIKE='.crumb,.catalog-record-link,.action-row,.pw-link-row,.map-task-body,:is(h1,h2,h3,h4,h5)>button';
const measure=(page,selector)=>page.locator(selector).evaluate((row,ROW_LIKE)=>[...row.children].filter(el=>el.matches('[data-ui=button]')&&el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return {text:el.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),min:parseFloat(cs.minHeight),clipped:el.scrollWidth>el.clientWidth+1};}),ROW_LIKE);
const wrapped=page=>page.evaluate(ROW_LIKE=>[...document.querySelectorAll('[data-ui=button],[data-ui=menu],[data-ui=chip]')].filter(el=>el.getClientRects().length&&!el.matches(ROW_LIKE)).map(el=>({text:el.textContent.trim().replace(/\s+/g,' '),h:el.getBoundingClientRect().height,min:parseFloat(getComputedStyle(el).minHeight)})).filter(x=>x.h>x.min+1.5),ROW_LIKE);
function expectStandard(buttons){
  expect(buttons.length).toBeGreaterThan(1);
  for(const b of buttons){expect(b.h,b.text).toBe(Math.round(b.min));expect(b.clipped,b.text).toBe(false);}
  expect(new Set(buttons.map(b=>b.w)).size,JSON.stringify(buttons)).toBe(1);
  const lines=new Set(buttons.map(b=>b.top));expect([1,buttons.length]).toContain(lines.size);
}

test('equipment card commands are one line, one height and one width',async({page},info)=>{
  const errors=await open(page,info,'customer/customer-a/equipment');
  expect(await wrapped(page)).toEqual([]);
  await page.locator('[data-ce-open="equipment-a"]').first().click();
  await expect(page.locator('#eqCardOverlay')).toBeVisible();
  expectStandard(await measure(page,'#eqCardOverlay .modal-actions'));
  expect(await wrapped(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('an editor footer gives cancel and save the same size',async({page},info)=>{
  const errors=await open(page,info,'job/'+fixtureIDs.job);
  await page.locator('#requestEditContext').click();
  const footer='dialog[open] .entity-editor-footer>.row';await expect(page.locator(footer)).toBeVisible();
  expectStandard(await measure(page,footer));
  expect(await wrapped(page)).toEqual([]);
  expect(errors).toEqual([]);
});
