// Layout review using the actual card markup, styles and presence renderer.
// Synthetic data only; no authentication, network requests or production writes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { presenceHTML, historyHTML, removedHTML } from '../src/trip-workbench.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+readFileSync(new URL('../src/trip-workbench.css',import.meta.url),'utf8');
const card=source.slice(source.indexOf('<div class="view view-trip">'),source.indexOf('<div class="view view-catalog">'));
const out=process.argv[2];if(!out)throw new Error('Pass output directory');mkdirSync(out,{recursive:true});
const profiles=[{id:'e1',role:'engineer',full_name:'Инженер 1'},{id:'e2',role:'engineer',full_name:'Инженер 2'}];
const jobs=[{id:'a',clients:{name:'Объект А'}},{id:'b',clients:{name:'Объект Б'}},{id:'c',clients:{name:'Объект В'}}];
const data={trip:{id:'demo',status:'in_progress',fact_km:120,workbench_revision:4,plan_baseline:{source:'before_execution'}},jobIds:['a','c'],
  stays:[{id:'s1',job_id:'a',stay_from:'2026-09-21T06:10:00Z',stay_to:'2026-09-21T08:40:00Z',minutes_raw:150,minutes_mgr:150,status:'approved',crew_ids:['e1','e2'],crew_source:'manager'},
    {id:'s2',job_id:null,stay_from:'2026-09-21T09:00:00Z',stay_to:'2026-09-21T09:15:00Z',minutes_raw:15,status:'detected',crew_ids:['e1','e2'],crew_source:'snapshot'}],
  removed:[{job_id:'b',removed_at:'2026-09-21T09:05:00Z',snapshot:{client_name:'Объект Б'}}],
  history:[{revision:3,recorded_at:'2026-09-21T09:05:00Z',reason:'Объект Б перенесён. Едем сразу на В.',snapshot:{date_from:'2026-09-21',job_ids:['a','b','c'],econ_snapshot:{km:240},route_stops:[{name:'Депо'},{name:'Объект А'},{name:'Объект Б'},{name:'Объект В'},{name:'Депо'}]}}]};
const browser=await chromium.launch({headless:true,executablePath:process.env.TRIP_PREVIEW_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
await page.route('**/*',route=>route.abort());
await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточка выезда — ревью</title><style>${styles}\nhtml,body{height:auto!important;display:block!important;overflow:visible!important}.view-trip{display:block;position:relative;height:auto!important;max-height:none;overflow:visible;flex:none}.view-trip .pane{height:auto!important;overflow:visible!important;max-height:none;max-width:1440px;margin:auto;padding:24px}.preview-note{padding:12px 24px;background:#e6f1ff;color:#183352;font:14px system-ui}</style><body><div class="preview-note">Предпросмотр PR · условные данные · вкладки переключаются · сохранение и GPS не подключены</div>${card}</body></html>`);
await page.evaluate(({data,jobs,profiles,presence,history,removed})=>{
  const $=id=>document.getElementById(id);
  $('tripTitle').textContent='Выезд · Объект А, Объект В';$('tripCrumb').textContent='21 сентября';
  $('tripSub').textContent='Сервисный автомобиль · 2 инженера · в работе';
  $('tripHeadEcon').innerHTML='<div class="te-k">Исходный план</div><div class="te-v">240 км</div><div class="te-s">11 нормочасов</div>';
  $('tpReviewState').textContent='В работе · версия 4 · одна стоянка требует проверки';
  $('tpPresence').innerHTML=presence;$('tpHistoryPane').innerHTML=history;$('tpRemovedJobs').innerHTML=removed;
  $('tpFrom').value='2026-09-21';$('tpTo').value='2026-09-21';$('tpVeh').innerHTML='<option>Сервисный автомобиль</option>';
  $('tpEng').innerHTML=profiles.map(p=>`<option selected>${p.full_name}</option>`).join('');$('tpStatus').value='in_progress';$('tpStatus').disabled=true;
  $('tpJobsCnt').textContent='2';$('tpJobs').innerHTML=jobs.filter(j=>j.id!=='b').map(j=>`<div class="eqitem"><label><input type="checkbox" checked style="width:auto"> ${j.clients.name}</label><span class="hint">${j.id==='a'?'Посещён · 5 чел.-ч':'Следующий объект'}</span></div>`).join('');
  $('tpRouteStops').innerHTML='<div class="eqitem">Депо → Объект А → Объект В → Депо</div>';
  $('tpRouteKm').textContent='Маршрут изменён';$('tpFactBox').innerHTML='<b>Пройдено: 120 км</b><p class="hint">Накопленный трек сохранён</p>';
  $('tpRemainingInfo').textContent='Осталось 85 км · расчёт от текущего положения';
  $('tpEcon').textContent='Норматив: 11 нормочасов · проверенное присутствие: 5 чел.-ч · ещё 1 стоянка требует проверки';
  $('tpEconBody').innerHTML='<p>Доход — по согласованным нормочасам и дороге.</p><p>Затраты труда — по человеко-часам присутствия.</p><p class="hint">В этой демонстрации денежные суммы не рассчитаны.</p>';
},{data,jobs,profiles,presence:presenceHTML(data,jobs,profiles),history:historyHTML(data),removed:removedHTML(data,jobs)});
const tabs=`document.querySelectorAll('[data-trip-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-trip-pane]').forEach(p=>p.hidden=p.dataset.tripPane!==b.dataset.tripTab);document.querySelectorAll('[data-trip-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));});document.querySelectorAll('button:not([data-trip-tab])').forEach(b=>{b.disabled=true;b.title='Предпросмотр: действие не подключено';});`;
await page.addScriptTag({content:tabs});
writeFileSync(out+'/trip-workbench-preview.html',await page.content());
await page.screenshot({path:out+'/trip-workbench-desktop.png',fullPage:true});
await page.getByRole('tab',{name:'История',exact:true}).click();
if(!await page.locator('#tpHistoryPane').isVisible()||await page.locator('#tpPlanPane').isVisible())throw new Error('Tab visibility failure');
await page.getByRole('tab',{name:'План и факт',exact:true}).click();
await page.setViewportSize({width:390,height:844});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
if(overflow)throw new Error('Mobile document overflows horizontally');
await page.screenshot({path:out+'/trip-workbench-mobile.png',fullPage:true});
console.log(JSON.stringify({desktop:'1440px',mobile:'390px',tabs:'passed',horizontalOverflow:false,output:out}));
await browser.close();
