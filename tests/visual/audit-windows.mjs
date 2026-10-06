// Read-only UI audit. Run after npm run build; starts its own local QA server.
// Render the unchanged app source with test-only hooks; all backend writes and
// remote requests stay blocked. Hooks are never included in production builds.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import config from '../../vite.config.js';
import { installMockBackend } from './mock-backend.mjs';

const out=resolve('test-results/window-audit');mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,['tests/visual/server.mjs'],{stdio:['ignore','pipe','inherit']});
process.once('exit',()=>server.kill());
process.once('uncaughtException',error=>{console.error(error);server.kill();process.exit(1);});
process.once('unhandledRejection',error=>{console.error(error);server.kill();process.exit(1);});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('QA server exited: '+code)));});
const hooks=`
window.__windowAudit={confirmDialog,promptDialog,openVersion,askSignature,openReschedModal,openFixModal,openStaysModal,checkTodayTrip,openBasePicker,openPush,openPointModal,openTrash,editClient:window.editClient,openEquip:window.openEquip,openCw,openStockItem,openPresenceEditor,openTrip,openJob,openStayBindingMap,showTripOnMap,showTripFact,switchTab,settingsNav,ensureRefs,showCtxMenu,profileResetForm,segPopup,tripStopPopup,stayBindingPopup,
 today:()=>{todayShown=false;return checkTodayTrip();},
 settleMap:async()=>{switchTab('map');await new Promise(r=>setTimeout(r,250));map.invalidateSize({animate:false});map.setView([49.99,36.23],12,{animate:false});await new Promise(r=>setTimeout(r,150));},
 clientPopup:async()=>{await window.__windowAudit.settleMap();markerById['client-a'].openPopup();},
 eqPopup:async()=>{await window.__windowAudit.settleMap();revealedClient='client-a';renderEqMarkers();eqMarkers.getLayers().find(x=>x.getPopup())?.openPopup();},
 leaflet:async html=>{await window.__windowAudit.settleMap();L.popup({maxWidth:320}).setLatLng([49.99,36.23]).setContent(html).openOn(map);},
 vehicle:()=>{vehState=[{vehicle_id:'vehicle-a',ts:new Date().toISOString(),lat:49.99,lng:36.23,speed:0,depot_state:'outside',last_move_at:'2026-10-05T06:00:00Z',odometer:50232}];showVehModal('vehicle-a');},
 depotPopup:async()=>{await window.__windowAudit.settleMap();const c={...clients[0],id:'audit-depot',name:'Депо · демонстрационная база',is_base:true};clients.push(c);renderMarkers();markerById[c.id].openPopup();clients.pop();},
 largeTeam:async()=>{await switchTab('dash');const person=profilesList.find(p=>p.role==='engineer');for(let i=0;i<6;i++)profilesList.push({...person,id:'audit-engineer-'+i,full_name:'Инженер команды '+(i+1)});await renderDashboard();document.querySelector('#dashSeg [data-dv=cards]')?.click();},
 orgProfile:()=>document.getElementById('profileBtn').click(),
 closeAll:()=>{document.querySelectorAll('.overlay.on,.sheet.on,.sheet-back.on,.map-pop.on,.ctxmenu.on').forEach(x=>x.classList.remove('on'));document.querySelectorAll('dialog').forEach(x=>x.close());document.querySelectorAll('.gpop').forEach(x=>x.remove());document.querySelectorAll('.planner-filter-menu').forEach(x=>x.open=false);document.getElementById('phView').hidden=true;map.closePopup();document.body.click();},
};`;
const bundle=await build({stdin:{contents:readFileSync('src/app.js','utf8')+hooks,resolveDir:resolve('src'),sourcefile:'app.js'},bundle:true,format:'esm',write:false,loader:{'.css':'empty'},define:{...config.define,'import.meta.env':'{}'}});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const trip='30000000-0000-4000-8000-000000000001',past='30000000-0000-4000-8000-000000000002',job='10000000-0000-4000-8000-000000000001';
const call=(name,...args)=>({name,args});
const cases=[
 {id:'verOverlay',open:call('openVersion')},
 {id:'signOverlay',before:call('openJob',job),open:call('askSignature','Коммунальное предприятие · обслуживание насосной станции на удалённом объекте')},
 {id:'reschedOverlay',role:'engineer',open:call('openReschedModal',trip)},
 {id:'fixOverlay',role:'engineer',before:call('openJob',job),open:call('openFixModal','work',{id:'request-work'})},
 {id:'staysOverlay',role:'engineer',open:call('openStaysModal',past)},
 {id:'todayOverlay',role:'engineer',open:call('today')},
 {id:'vehOverlay',open:call('vehicle')},
 {id:'baseOverlay',open:call('openBasePicker','start')},
 {id:'baseOverlay-end',selector:'#baseOverlay',open:call('openBasePicker','end')},
 {id:'linkOverlay',template:true,fill:()=>{document.querySelector('#linkText').textContent='У клиента «Коммунальное предприятие · обслуживание насосной станции на удалённом объекте» нет открытых заявок. Создать заявку как основание выезда?';document.querySelector('#linkOverlay').classList.add('on');}},
 {id:'confirmOverlay',open:call('confirmDialog','Удалить точку вместе с её техникой и заявками? Их можно вернуть кнопкой «Отменить».',{danger:true,okText:'Удалить'})},
 {id:'promptOverlay-number',selector:'#promptOverlay',open:call('promptDialog','Пробег по одометру машины',[{key:'km',label:'Показание одометра, км',value:'50232'},{key:'note',label:'Комментарий (необязательно)'}])},
 {id:'promptOverlay-reason',selector:'#promptOverlay',open:call('promptDialog','Аннулировать финансовую строку',[{key:'reason',label:'Причина (обязательно)',type:'textarea'}])},
 {id:'promptOverlay-select',selector:'#promptOverlay',open:call('promptDialog','Связать исправленную строку',[{key:'replacement',label:'Новая строка того же типа',type:'select',options:[{value:'a',label:'Диагностика гидросистемы и замена уплотнений на удалённом объекте'}]}])},
 {id:'pushOverlay',open:call('openPush')},
 {id:'cfgOverlay',click:'#cfgBtn'},
 {id:'authOverlay',template:true,fill:()=>document.querySelector('#authOverlay').classList.add('on')},
 {id:'profOverlay',before:call('switchTab','settings'),open:call('profileResetForm'),click:'#profCreate'},
 {id:'pointOverlay',open:call('openPointModal')},
 {id:'trashOverlay',open:call('openTrash','jobs')},
 {id:'editOverlay',open:call('editClient','client-a')},
 {id:'eqOverlay',open:call('openEquip','client-a')},
 {id:'catOverlay',open:call('openCw','work-a')},
 {id:'catOverlay-models',selector:'#catOverlay',open:call('openCw','work-a'),afterClick:'[data-cs=models]'},
 {id:'stockOverlay',open:call('openStockItem','stock-a')},
 {id:'account-profile',selector:'dialog.account-profile',open:call('orgProfile')},
 {id:'presence-editor',selector:'dialog.presence-editor',before:call('openTrip',trip),open:call('openPresenceEditor',trip,'stay-a')},
 {id:'moreSheet',mobileOnly:true,click:'#moreBtn'},
 {id:'layersPop',before:call('switchTab','map'),click:'#layersBtn'},
 {id:'factLegend',selector:'.mleg',before:call('openStayBindingMap',past)},
 {id:'ctxMenu',before:call('switchTab','map'),open:call('showCtxMenu',{latlng:{lat:49.99,lng:36.23},originalEvent:{clientX:340,clientY:460}})},
 {id:'engineer-options',selector:'.engineer-options',before:call('openTrip',trip),click:'#tpEng + .engineer-picker',pointerClick:true},
 {id:'planner-filter-jobs',selector:'#plJobs .planner-filter-panel',before:call('switchTab','planner','jobs'),click:'#plJobs .planner-filter-menu > summary'},
 {id:'planner-filter-trips',selector:'#plTrips .planner-filter-panel',before:call('switchTab','planner','trips'),click:'#plTrips .planner-filter-menu > summary'},
 {id:'gpop',selector:'.gpop',role:'logist',before:call('switchTab','dash'),click:'.vg-block',pointerClick:true},
 {id:'hint',selector:'.q.on .qbody',open:call('openPush'),click:'#pushOverlay .qm'},
 {id:'phView',before:call('openJob',job),template:true,fill:()=>{const p=document.querySelector('#phView');p.hidden=false;document.querySelector('#phViewImg').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#627b86"/><text x="40" y="100" fill="white" font-size="40">Демонстрационный снимок</text></svg>');}},
 {id:'map-client',selector:'.leaflet-popup',open:call('clientPopup')},
 {id:'map-depot',selector:'.leaflet-popup',open:call('depotPopup')},
 {id:'map-equipment',selector:'.leaflet-popup',before:call('switchTab','map'),open:call('eqPopup')},
 {id:'map-trip-stop',selector:'.leaflet-popup',before:call('showTripOnMap',trip),html:call('tripStopPopup',{name:'Удалённый объект · насосная станция',clientId:'client-a',lat:49.99,lng:36.23},0)},
 {id:'map-stay',selector:'.leaflet-popup',before:call('openStayBindingMap',past),html:call('stayBindingPopup',{id:'stay-past',status:'approved',stay_from:'2026-09-30T06:00:00Z',stay_to:'2026-09-30T10:00:00Z',minutes_raw:240,job_id:job},0)},
 {id:'map-segment',selector:'.leaflet-popup',html:call('segPopup',{km:128,fromTs:'2026-09-30T03:00:00Z',toTs:'2026-09-30T05:00:00Z',ms:7200000,kind:'track'},'достроено по дорогам')},
 {id:'map-avoid',selector:'.leaflet-popup',template:true,htmlText:'<b>Объезд 1</b><br>радиус 150 м'},
 {id:'map-position',selector:'.leaflet-popup',template:true,htmlText:'<b>Текущая позиция</b><br>ещё не записана в историю выезда'},
 {id:'factLegend-open',selector:'.mleg-body',before:call('openStayBindingMap',past),click:'.mleg-details > summary'},
 {id:'engineer-scope-large',selector:'.engineer-pop',template:true,before:call('largeTeam'),click:'.summary-team > summary',afterClick:'[data-epop]'},
 {id:'map-point-diagnostics',selector:'.leaflet-popup',template:true,htmlText:'<b>09:30</b><br>отброшено: неверная скорость'},
];
const dimensions=[{name:'mobile-360',width:360,height:800,touch:true},{name:'mobile-390',width:390,height:844,touch:true},{name:'mobile-short',width:390,height:500,touch:true},{name:'mobile-landscape',width:720,height:390,touch:true},{name:'tablet-768',width:768,height:1024,touch:true},{name:'desktop-1024',width:1024,height:768,touch:false},{name:'desktop-1440',width:1440,height:900,touch:false}];
const results=[];
const runCases=process.env.WINDOW_AUDIT_CASES?cases.filter(c=>process.env.WINDOW_AUDIT_CASES.split(',').includes(c.id)):cases;
const invoke=async(page,method,wait=true)=>{
 if(!method)return;
 if(wait)await page.evaluate(async ({name,args})=>{await window.__windowAudit[name](...args);},method);
 else await page.evaluate(({name,args})=>{window.__windowAudit[name](...args);},method);
};
function inspect(root){
 const bounds=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
 const shown=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const dialog=root.matches('.overlay')?root.querySelector('.modal'):root;
 const s=getComputedStyle(dialog),r=bounds(dialog);
 const controls=[...dialog.querySelectorAll('button,input:not([type=hidden]),select,textarea,a,summary')].filter(shown).map(el=>{const css=getComputedStyle(el),b=bounds(el),x=b.x+b.w/2,y=b.y+b.h/2;return {id:el.id||el.dataset.pf||'',label:(el.textContent.trim()||el.getAttribute('aria-label')||el.type).slice(0,90),tag:el.tagName,type:el.type,r:b,radius:css.borderRadius,font:css.fontFamily,fontSize:css.fontSize,padding:css.padding,color:css.color,background:css.backgroundColor,case:css.textTransform,ellipsis:css.textOverflow,disabled:el.disabled,covered:x>=0&&x<innerWidth&&y>=Math.max(0,r.y)&&y<=Math.min(innerHeight,r.bottom)&&!el.contains(document.elementFromPoint(x,y))};});
 const overflow=[];
 for(const b of dialog.querySelectorAll('button,a')){if(!shown(b))continue;const rb=b.getBoundingClientRect();const walker=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const t of range.getClientRects())if(t.width>0&&(t.left<rb.left-1||t.right>rb.right+1||t.top<rb.top-1||t.bottom>rb.bottom+1))overflow.push(b.id||b.textContent.trim());}}
 const labels=[...dialog.querySelectorAll('label')].filter(shown).map(el=>({text:el.textContent.trim().slice(0,70),case:getComputedStyle(el).textTransform,font:getComputedStyle(el).fontFamily,linked:!!(el.control||el.htmlFor)}));
 const scrolls=[dialog,...dialog.querySelectorAll('*')].filter(el=>shown(el)&&el.scrollHeight>el.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(el).overflowY)).map(el=>({id:el.id||el.className,h:el.clientHeight,scrollHeight:el.scrollHeight}));
 const touchSmall=controls.filter(c=>!['checkbox','radio','color'].includes(c.type)&&((c.tag==='BUTTON'||c.tag==='A'||c.tag==='SUMMARY')&&c.r.h<43.9));
 return {viewport:{width:innerWidth,height:innerHeight},title:dialog.querySelector('h2,h3,h4')?.textContent.trim(),r,radius:s.borderRadius,padding:s.padding,font:s.fontFamily,scrollWidth:dialog.scrollWidth,clientWidth:dialog.clientWidth,labels,controls,touchSmall,overflow:[...new Set(overflow)],scrolls,focusIn:dialog.contains(document.activeElement),role:root.getAttribute('role')||dialog.getAttribute('role'),ariaModal:root.getAttribute('aria-modal'),name:root.getAttribute('aria-labelledby')||dialog.getAttribute('aria-label'),bodyText:dialog.textContent.trim().slice(0,2000)};
}
for(const d of dimensions)for(const theme of ['light','dark']){
 if(process.env.WINDOW_AUDIT_PROJECTS&&!process.env.WINDOW_AUDIT_PROJECTS.split(',').includes(d.name+'-'+theme))continue;
 const folder=join(out,d.name+'-'+theme);mkdirSync(folder,{recursive:true});
 const pages=new Map();
 async function getPage(role){
  if(pages.has(role))return pages.get(role);
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:d.width,height:d.height},isMobile:d.touch,hasTouch:d.touch,locale:'ru-RU',timezoneId:'Europe/Kyiv',reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],remote=[];page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://127.0.0.1:4173'){remote.push(url.hostname);return route.abort();}
   if(/^\/assets\/index-.*\.js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
   return route.continue();
  });
  await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
  await page.addInitScript(installMockBackend,{role,theme});
  await page.addInitScript(()=>{window.__pickerTrace=[];document.addEventListener('scroll',e=>{if(document.querySelector('.engineer-options'))window.__pickerTrace.push({event:'scroll',target:e.target.id||e.target.className||e.target.nodeName});},true);document.addEventListener('toggle',e=>{if(e.target.matches?.('.engineer-options'))window.__pickerTrace.push({event:'toggle',state:e.newState});},true);});
  await page.goto('/#/dash');
  try{await page.locator('#appRoot').waitFor({state:'visible'});}catch(e){console.error(JSON.stringify({errors,html:await page.locator('.overlay.on').allTextContents()}));throw e;}
  await page.waitForFunction(()=>!!window.__windowAudit);await page.evaluate(()=>document.fonts.ready);
  await invoke(page,call('ensureRefs'));await invoke(page,call('closeAll'));
  const data={page,context,errors,remote};pages.set(role,data);return data;
 }
 for(const c of runCases){
  if(c.mobileOnly&&d.width>760)continue;
  rmSync(join(folder,c.id+'.png'),{force:true});rmSync(join(folder,c.id+'-bottom.png'),{force:true});
  const {page,errors,remote}=await getPage(c.role||'admin');
  const entry={case:c.id,project:d.name+'-'+theme,role:c.role||'admin',template:!!c.template};
  try{
   await invoke(page,call('closeAll'));await invoke(page,c.before);
   if(c.open)await invoke(page,c.open,!['confirmDialog','promptDialog','askSignature'].includes(c.open.name));
   if(c.fill)await page.evaluate(c.fill);
   if(c.click){if(c.pointerClick){await page.locator(c.click).first().scrollIntoViewIfNeeded();await page.waitForTimeout(150);await page.locator(c.click).first().click({position:{x:12,y:10}});}else await page.locator(c.click).first().evaluate(el=>el.click());}
   if(c.afterClick)await page.locator(c.afterClick).click();
   if(c.html){const html=await page.evaluate(({name,args})=>window.__windowAudit[name](...args),c.html);await invoke(page,call('leaflet',html));}
   if(c.htmlText)await invoke(page,call('leaflet',c.htmlText));
   const root=c.selector==='.leaflet-popup'?page.locator(c.selector).last():page.locator(c.selector||'#'+c.id).first();await root.waitFor({state:'visible',timeout:4000});
   if(c.selector==='.leaflet-popup')await page.waitForTimeout(400);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   entry.measure=await root.evaluate(inspect);
   if(c.id==='gpop'&&d.width<=760)entry.navigationOverlap=await root.evaluate(el=>el.getBoundingClientRect().bottom>document.querySelector('.rail').getBoundingClientRect().top+1);
   await page.screenshot({path:join(folder,c.id+'.png'),animations:'disabled',caret:'hide'});
   // End of scroll: are final actions reachable without moving the backdrop?
   await root.evaluate(el=>{const modal=el.matches('.overlay')?el.querySelector('.modal'):el;modal.scrollTop=modal.scrollHeight;});
   entry.bottom=await root.evaluate(el=>{const m=el.matches('.overlay')?el.querySelector('.modal'):el;const b=[...m.querySelectorAll('button')].filter(x=>x.getClientRects().length).at(-1);if(!b)return null;const r=b.getBoundingClientRect();return {label:b.textContent.trim(),y:r.y,bottom:r.bottom,inViewport:r.y>=0&&r.bottom<=innerHeight};});
   if(entry.measure.scrolls.length)await page.screenshot({path:join(folder,c.id+'-bottom.png'),animations:'disabled',caret:'hide'});
   if(c.id==='presence-editor'||c.id==='account-profile'||(c.selector!=='.leaflet-popup'&&c.id.endsWith('Overlay'))){
    await root.evaluate(el=>{const last=[...el.querySelectorAll('button,input:not([type=hidden]),textarea,select,a,summary')].filter(x=>x.getClientRects().length&&!x.disabled).at(-1);last?.focus();});
    entry.tabFocusPath=[];
    for(let i=0;i<2;i++){await page.keyboard.press('Tab');entry.tabFocusPath.push(await root.evaluate(el=>({tag:document.activeElement.tagName,id:document.activeElement.id,inside:el.contains(document.activeElement)})));}
    entry.tabStayedInside=entry.tabFocusPath.every(x=>x.inside||x.tag==='BODY');
   }
   // Real keyboard close behaviour, without accepting or saving any action.
   await page.keyboard.press('Escape');entry.escapeStillVisible=await root.evaluate(el=>{if(el.matches('.overlay,.sheet,.map-pop,.ctxmenu'))return el.classList.contains('on');if(el.closest('.q'))return el.closest('.q').classList.contains('on');if(el.closest('.planner-filter-menu'))return el.closest('.planner-filter-menu').open;return el.getClientRects().length>0;}).catch(()=>false);
   entry.focusAfter=await page.evaluate(()=>document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName);
  }catch(e){entry.error=e.message.slice(0,500);entry.toast=await page.locator('#toast').textContent();entry.pickerTrace=await page.evaluate(()=>window.__pickerTrace);}
  entry.runtimeErrors=[...errors];entry.remoteBlocked=[...new Set(remote)];
  entry.writes=await page.evaluate(()=>window.__visualQA.blockedWrites);
  results.push(entry);
  writeFileSync(join(out,'measurements.json'),JSON.stringify(results,null,2));
 }
 for(const data of pages.values())await data.context.close();
 writeFileSync(join(out,'measurements.json'),JSON.stringify(results,null,2));
 console.log(d.name+'-'+theme+': '+results.filter(r=>r.project===d.name+'-'+theme&&!r.error).length+' rendered');
}
await browser.close();
server.kill();
const summary=cases.map(c=>{const rows=results.filter(r=>r.case===c.id),rendered=rows.filter(r=>r.measure);return {id:c.id,rendered:rendered.length,errors:rows.filter(r=>r.error).map(r=>({project:r.project,error:r.error})),overflow:rendered.filter(r=>r.measure.overflow.length||r.measure.scrollWidth>r.measure.clientWidth+2).map(r=>r.project),smallTouch:rendered.filter(r=>r.project.startsWith('mobile')&&r.measure.touchSmall.length).map(r=>({project:r.project,controls:r.measure.touchSmall.map(c=>c.id||c.label)})),outside:rendered.filter(r=>r.measure.r.x<0||r.measure.r.right>r.measure.viewport.width+1||r.measure.r.y<0||r.measure.r.bottom>r.measure.viewport.height+1).map(r=>r.project),escapeStays:rendered.filter(r=>r.escapeStillVisible).map(r=>r.project)};});
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({cases:cases.length,states:results.length,rendered:results.filter(r=>r.measure).length,errors:results.filter(r=>r.error).length,writes:results.flatMap(r=>r.writes).length}));
