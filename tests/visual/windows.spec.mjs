import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import config from '../../vite.config.js';
import {installMockBackend} from './mock-backend.mjs';

// QA-only entry points exercise the production functions; never shipped.
const hooks=`
window.__windowTests={openJob,openTrip,openEquip:window.openEquip,editClient:window.editClient,switchTab,ensureRefs,
 prompt:()=>{window.__promptResult='pending';promptDialog('Записать замер',[{key:'km',label:'Пробег, км',type:'number',inputmode:'decimal',min:0,required:true},{key:'date',label:'Дата',type:'date'}],{okText:'Записать показание'}).then(v=>window.__promptResult=v);},
 sign:()=>{window.__signResult='pending';askSignature('Заказчик').then(v=>window.__signResult=v===SIGNATURE_CANCELLED?'cancelled':v===null?'unsigned':'signed');},
 mapClient:async()=>{await switchTab('map');map.invalidateSize({animate:false});map.setView([49.99,36.23],12,{animate:false});markerById['client-a'].openPopup();}
};`;
const bundle=buildSync({stdin:{contents:readFileSync('src/app.js','utf8')+hooks,resolveDir:resolve('src'),sourcefile:'app.js'},bundle:true,format:'esm',write:false,loader:{'.css':'empty'},define:{...config.define,'import.meta.env':'{}'}}).outputFiles[0].text;
const trip='30000000-0000-4000-8000-000000000001',job='10000000-0000-4000-8000-000000000001';
const errors=new WeakMap();
test.beforeEach(async({page},info)=>{
 const failures=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:4173')return route.abort();if(/^\/assets\/index-.*\.js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:bundle});return route.continue();});
 await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
 await page.addInitScript(installMockBackend,{role:'admin',theme:info.project.metadata.theme});
 await page.goto('/#/dash');await expect(page.locator('#appRoot')).toBeVisible();
 if(await page.locator('#todayLater').isVisible())await page.locator('#todayLater').click();
 await expect(page.locator('.overlay.on')).toHaveCount(0);
 await page.waitForFunction(()=>!!window.__windowTests);await page.evaluate(()=>window.__windowTests.ensureRefs());
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);expect(await page.evaluate(()=>window.__visualQA.blockedWrites)).toEqual([]);});
const open=async(page,name,...args)=>page.evaluate(async({name,args})=>{await window.__windowTests[name](...args);},{name,args});

test('dirty modal preserves input on cancelled discard and contains nested keyboard focus',async({page})=>{
 await open(page,'editClient','client-a');const parent=page.locator('#editOverlay');await expect(parent).toBeVisible();
 await page.locator('#eName').fill('Несохранённое название');await page.keyboard.press('Escape');
 const confirm=page.locator('#confirmOverlay');await expect(confirm).toBeVisible();
 await expect(page.locator('#confirmNo')).toBeFocused();
 await page.locator('#confirmYes').focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 expect(await confirm.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(confirm).toBeHidden();await expect(parent).toBeVisible();await expect(page.locator('#eName')).toHaveValue('Несохранённое название');
 await page.locator('#eCancel').click();await expect(confirm).toBeVisible();await page.locator('#confirmYes').click();await expect(parent).toBeHidden();
 await open(page,'editClient','client-a');await expect(page.locator('#eName')).not.toHaveValue('Несохранённое название');
});

test('signature cancel aborts closing, while unsigned completion is a separate result',async({page})=>{
 await open(page,'openJob',job);await open(page,'sign');await expect(page.locator('#signOverlay')).toBeVisible();
 await page.locator('#signCancel').click();await expect.poll(()=>page.evaluate(()=>window.__signResult)).toBe('cancelled');
 await open(page,'sign');await page.locator('#signSkip').click();await expect.poll(()=>page.evaluate(()=>window.__signResult)).toBe('unsigned');
 await open(page,'sign');await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>window.__signResult)).toBe('cancelled');
});

test('engineer choices survive opening and repeated opening, and dismiss on external scroll',async({page})=>{
 await open(page,'openTrip',trip);const button=page.locator('#tpEng + .engineer-picker');await button.scrollIntoViewIfNeeded();
 for(let i=0;i<2;i++){
  await button.click();const panel=page.locator('.engineer-options');await expect(panel).toBeVisible();await page.waitForTimeout(150);await expect(panel).toBeVisible();
  expect((await panel.boundingBox()).y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(button).toBeFocused();
 }
 await button.click();await expect(page.locator('.engineer-options')).toBeVisible();await page.waitForTimeout(100);
 await page.locator('.view-trip .pane').evaluate(el=>{el.scrollTop=el.scrollTop>0?0:50;el.dispatchEvent(new Event('scroll'));});await expect(page.locator('.engineer-options')).toHaveCount(0);
});

test('trip navigation waits for discard and keeps the draft after cancellation',async({page})=>{
 await open(page,'openTrip',trip);const field=page.locator('#tpFrom');const original=await field.inputValue();await field.fill('2026-10-09');
 // Two fast route requests must share one pending discard decision.
 await page.evaluate(()=>{window.__windowTests.switchTab('dash');window.__windowTests.switchTab('dash');});
 await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmNo').click();
 await expect(page.locator('.view-trip')).toHaveClass(/active/);await expect(field).toHaveValue('2026-10-09');await expect(page.locator('#confirmOverlay')).toBeHidden();
 await page.evaluate(()=>{window.__windowTests.switchTab('dash');});await page.locator('#confirmYes').click();await expect(page.locator('.view-dash')).toHaveClass(/active/);
 await open(page,'openTrip',trip);await expect(field).toHaveValue(original);
});

test('timeline primary action stays readable and help does not compete with trip actions',async({page})=>{
 const block=page.locator('.vg-block').first();await block.scrollIntoViewIfNeeded();await block.click({position:{x:12,y:10}});
 const panel=page.locator('.gpop');await expect(panel).toBeVisible();const primary=panel.locator('[data-pop-action]');
 expect((await primary.boundingBox()).height).toBeLessThanOrEqual(70);
 expect(await panel.locator('.gp-layout').evaluate(el=>el.open)).toBe(false);
 for(const button of await panel.locator('.gp-trip-tools button').all())expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
});

test('map actions remain touch-sized and hit-testable above the mobile bottom sheet',async({page})=>{
 await open(page,'mapClient');const popup=page.locator('.leaflet-popup').last();await expect(popup).toBeVisible();
 for(const action of await popup.locator('.btn').all()){
  await action.scrollIntoViewIfNeeded();const r=await action.boundingBox();expect(r.height).toBeGreaterThanOrEqual(44);
  expect(await action.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 }
 const r=await popup.boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual(page.viewportSize().height);
 await popup.locator('.leaflet-popup-close-button').click();await expect(popup).toHaveCount(0);
 await page.locator('#layersBtn').click();const layers=page.locator('#layersPop');await expect(layers).toBeVisible();
 expect((await layers.boundingBox()).y+(await layers.boundingBox()).height).toBeLessThanOrEqual(page.viewportSize().height);
 await layers.locator('#ptAlert').scrollIntoViewIfNeeded();await page.keyboard.press('Escape');await expect(layers).toBeHidden();await expect(page.locator('#layersBtn')).toBeFocused();
});

test('equipment starts as a list, and cancelled discard retains the edit form',async({page})=>{
 await open(page,'openEquip','client-a');await expect(page.locator('#eqFormPane')).toBeHidden();await page.locator('#eqAdd').click();
 await expect(page.locator('#eqFormPane')).toBeVisible();await page.locator('#eqModel').fill('Новая техника');await page.keyboard.press('Escape');
 await expect(page.locator('#confirmOverlay')).toBeVisible();await page.locator('#confirmNo').click();await expect(page.locator('#eqModel')).toHaveValue('Новая техника');
 await page.locator('#eqFormCancel').click();await page.locator('#confirmYes').click();await expect(page.locator('#eqFormPane')).toBeHidden();await expect(page.locator('#eqAdd')).toBeVisible();
});

test('destructive buttons meet text contrast in both themes',async({page})=>{
 await page.locator('#profileBtn').evaluate(el=>el.click());const button=page.locator('[data-profile-logout]');await expect(button).toBeVisible();
 const contrast=await button.evaluate(el=>{const s=getComputedStyle(el),l=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=l(s.color),b=l(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
 expect(contrast).toBeGreaterThanOrEqual(4.5);
});


test('optional connection setup can cancel without reconnecting or losing declined edits',async({page})=>{
 await page.locator('#cfgBtn').evaluate(el=>el.click());await expect(page.locator('#cfgOverlay')).toBeVisible();
 await page.locator('#cfgUrl').fill('https://example.test');await page.locator('#cfgCancel').click();await expect(page.locator('#confirmOverlay')).toBeVisible();
 await page.locator('#confirmNo').click();await expect(page.locator('#cfgUrl')).toHaveValue('https://example.test');
 await page.keyboard.press('Escape');await page.locator('#confirmYes').click();await expect(page.locator('#cfgOverlay')).toBeHidden();await expect(page.locator('.view-dash')).toHaveClass(/active/);
});

test('typed application prompt validates numeric input and uses its action label',async({page})=>{
 await open(page,'prompt');const km=page.locator('[data-pf=km]'),date=page.locator('[data-pf=date]');
 await expect(km).toHaveAttribute('type','number');await expect(km).toHaveAttribute('inputmode','decimal');await expect(date).toHaveAttribute('type','date');await expect(page.locator('#promptYes')).toHaveText('Записать показание');
 await km.fill('-1');await page.locator('#promptYes').click();await expect(page.locator('#promptOverlay')).toBeVisible();expect(await page.evaluate(()=>window.__promptResult)).toBe('pending');
 await km.fill('128.5');await date.fill('2026-10-06');await page.locator('#promptYes').click();
 await expect.poll(()=>page.evaluate(()=>window.__promptResult)).toEqual({km:'128.5',date:'2026-10-06'});await expect(page.locator('#promptOverlay')).toBeHidden();
});
