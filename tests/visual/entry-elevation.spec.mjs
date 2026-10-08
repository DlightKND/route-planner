import {test,expect} from '@playwright/test';
import {installMockBackend} from './mock-backend.mjs';
test('sign-in uses one overlay elevation without a second inner shadow',async({page},info)=>{
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:4173'?r.continue():r.abort());
 await page.addInitScript(installMockBackend,{theme:info.project.metadata.theme,signedOut:true});await page.goto('/');
 const modal=page.locator('#authOverlay .modal');await expect(modal).toBeVisible();
 const shadows=await modal.evaluate(el=>{const r=getComputedStyle(document.documentElement),sample=document.createElement('div');sample.style.boxShadow=r.getPropertyValue('--shadow-lg');document.body.append(sample);const expected=getComputedStyle(sample).boxShadow;sample.remove();return {actual:getComputedStyle(el).boxShadow,expected};});expect(shadows.actual).toBe(shadows.expected);
 await page.screenshot({path:'test-results/elevation-entry/'+info.project.name+'.png'});
});
