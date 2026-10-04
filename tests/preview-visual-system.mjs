// Actual presentation functions and CSS; synthetic records only, no auth or backend.
import {readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
const source=readFileSync('index.html','utf8'),app=readFileSync('src/app.js','utf8');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+['src/trip-workbench.css','src/service-orders.css','src/visual-system.css'].map(p=>readFileSync(p,'utf8')).join('\n');
const themes=app.slice(app.indexOf('const THEMES='),app.indexOf('function applyTheme('));
const metrics=app.slice(app.indexOf('function metricDelta('),app.indexOf('let dashOrder='));
const range=app.slice(app.indexOf('function rangeBar('),app.indexOf('function setRange('));
const script=`import {loadChartHTML} from './src/dashboard-chart.js';import {presenceHTML} from './src/trip-workbench.js';
${themes}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
${metrics}
const dashRanges={load:{from:'2026-10-05',to:'2026-10-18'}},RANGE_META={load:{lengths:[[7,'7 дней'],[14,'14 дней'],[30,'Месяц']]}};${range}
const qp=new URLSearchParams(location.search),mode=qp.get('theme')==='light'?'light':'dark';document.documentElement.dataset.theme=mode;Object.entries(THEMES[mode]).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
const days=Array.from({length:14},(_,i)=>({key:'2026-10-'+String(i+5).padStart(2,'0'),label:String(i+5),v:[8,14,20,7,5,0,3][i%7],f:i<4?i*2:0,known:i<4,cap:i%7<5?16:0,we:i%7>4}));
document.getElementById('stats').innerHTML='<div class="card"><h3>Загрузка отдела</h3>'+rangeBar('load')+'<div class="echips"><span class="scope-label">Команда статистики</span><button class="echip on">Все инженеры</button><button class="echip">Анна Смирнова</button></div>'+loadChartHTML(days)+'</div><div class="card"><h3>Финансы</h3><p class="meta">5–18 октября · выбранная команда · демонстрационные данные</p>'+metricRow({name:'Подтверждённая прибыль',plan:1200000,fact:1105000,unit:'грн',dir:'up',sub:'Принятые расходы и подтверждённые выезды'})+metricRow({name:'Данные без подтверждения',plan:120,fact:null,unit:'ч'})+'</div>';
const jobs=[{id:'j',clients:{name:'Коммунальное предприятие · обслуживание насосной станции и оборудования на удалённом объекте'}}],crew=[{id:'e',role:'engineer',full_name:'Анна Смирнова'}],data={trip:{fact_km:128},jobIds:['j'],removed:[],stays:[{id:'s',job_id:'j',stay_from:'2026-10-05T06:00:00Z',stay_to:'2026-10-05T10:00:00Z',minutes_raw:240,minutes_mgr:240,crew_ids:['e'],crew_source:'snapshot',status:'approved'}]};
document.getElementById('trip').innerHTML='<div class="card"><h3>Выезд · присутствие</h3>'+presenceHTML(data,jobs,crew)+'</div>';
const role=qp.get('role');if(role==='engineer')document.getElementById('stats').hidden=true;
`;
const result=await build({stdin:{contents:script,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'iife',write:false,minify:true});
const body='<header class="pane-head"><h2>DLIGHT · визуальная проверка</h2><p>Синтетические данные · запись отключена</p><a href="?theme=light">Светлая тема</a><a href="?theme=dark">Тёмная тема</a><a href="?role=engineer">Инженер</a><a href="?matrix=1">Размеры экранов</a></header><main class="view view-dash" id="stats"></main><main class="view view-trip" id="trip"></main><p><a href="preview-service-orders.html">Карточки задания и диспетчер</a></p>';
const matrix=`if(new URLSearchParams(location.search).has('matrix')){document.body.innerHTML='<h2>Адаптивность · реальные CSS и компоненты</h2>'+[360,390,768,1024,1440].map(w=>'<section><h3>'+w+' px</h3>'+['light','dark'].map(t=>'<iframe title="'+w+' '+t+'" width="'+w+'" height="844" src="?theme='+t+'"></iframe>').join('')+'</section>').join('');}else{${result.outputFiles[0].text}}`;
writeFileSync('dist/preview-visual-system.html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DLIGHT · визуальная система</title><style>'+styles+'\nbody{display:block;height:auto;overflow:auto;padding:var(--sp-4)}main.view{position:static;display:block}main[hidden]{display:none}#stats,#trip{max-width:100%;margin:auto}iframe{display:block;border:1px solid var(--line);margin-bottom:var(--sp-5)}section{overflow:auto}</style>'+body+'<script>'+matrix+'</script></html>');
console.log('Offline UI preview generated: dist/preview-visual-system.html');
