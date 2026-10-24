import {expect} from '@playwright/test';
// Measure actual production nodes, including dynamically mounted top-layer controls.
export async function auditApplicationDesign(page,root=page.locator('body')){
 await expect(page.locator('html')).toHaveAttribute('data-ui-system','0.7');
 const failures=await root.evaluate(root=>{
  const errors=[],touch=matchMedia('(pointer:coarse),(max-width:760px)').matches,min=touch?48:40;
  const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[hidden]');};
  for(const el of root.querySelectorAll('button,input:not([type=hidden]),select,textarea,summary,[role=button]')){
   if(!visible(el))continue;
   const kind=el.dataset.ui,name=el.id||el.getAttribute('aria-label')||el.textContent.trim().slice(0,70),s=getComputedStyle(el),r=el.getBoundingClientRect();
   if(!kind){errors.push({name,error:'unmanaged control'});continue;}
   // Duration-bound timeline/map marks are data geometry, not toolbar targets.
   if(['geometry','checkbox','radio','hidden','count'].includes(kind))continue;
   let height=kind==='icon'?(touch?48:44):kind==='chip'?(touch?48:36):kind==='fab'?56:kind==='navigation'?48:kind==='range'?48:min;
   if(kind==='button'&&el.dataset.uiSize==='s'&&!el.parentElement?.querySelector(':scope>[data-ui-variant=primary]'))height=touch?48:36;
   if(r.height+0.6<height)errors.push({name,kind,error:'height',expected:height,actual:r.height});
   const periodCaption=el.matches('[data-summary-dates],.journal-periodbar>details>summary'),family=periodCaption?'IBM Plex Mono':'IBM Plex Sans';
   if(!s.fontFamily.includes(family))errors.push({name,kind,error:'font',expected:family,actual:s.fontFamily});
   if(periodCaption&&s.fontSize!=='13px')errors.push({name,error:'period caption size',actual:s.fontSize});
   if(['button','icon','chip','segment','field','tab'].includes(kind)&&s.boxShadow!=='none')errors.push({name,error:'shadow',actual:s.boxShadow});
   if(kind==='field'&&parseFloat(s.fontSize)!==(touch?16:14))errors.push({name,error:'field text',actual:s.fontSize});
   if(kind==='segment'&&!el.hasAttribute('aria-pressed'))errors.push({name,error:'missing selection state'});
   if(kind==='segment'&&s.borderTopLeftRadius!=='6px')errors.push({name,error:'inset radius',actual:s.borderTopLeftRadius});
  }
  return errors;
 });
 expect(failures,'Every visible production control uses the approved appearance contract').toEqual([]);
}
