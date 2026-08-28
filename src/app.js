// Приложение DLIGHT. Пока это цельный перенос боевого index.html в сборку:
// код тот же, но теперь это модуль: ядро подключается импортом.
// Обработчики вешаются из JS (.onclick=), инлайновых onclick в разметке нет,
// поэтому мост на window не нужен. Дальше извлекаем по модулю, см. MODULES.md.

import * as core from './core/index.js';

// ── Аварийный перехватчик ────────────────────────────────────────────────────
// Если что-то падает при старте, модуль обрывается и остаётся серый экран
// без объяснений. Этот обработчик ловит такие падения и показывает причину
// прямо на странице (и в консоли), чтобы не гадать вслепую.
window.addEventListener('error', (ev) => {
  const box = document.getElementById('bootErr') || (() => {
    const d = document.createElement('div');
    d.id = 'bootErr';
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;'
      + 'background:#b00020;color:#fff;font:13px/1.4 monospace;padding: var(--sp-3) var(--sp-4);'
      + 'white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    document.body && document.body.appendChild(d);
    return d;
  })();
  if (box) box.textContent = 'Ошибка запуска: ' + (ev.message || ev.error)
    + (ev.filename ? '\n' + ev.filename + ':' + ev.lineno + ':' + ev.colno : '');
  console.error('[boot]', ev.error || ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[boot promise]', ev.reason);
});

const { money, hhmm, businessDays, colNum, colLetter, cellRC, jobRoadPayer, rateFrom, dedupeStops, tspOrder,
        econCompute, roadByPayer, jobPoint,
        vehAgeMin, vehAgeText, vehClass, vehTitle, vehBearing, vehLabel,
        jobUrgency, isCold, needsEngineer, attentionBuckets, urgencyRank,
        simplifyLine, kmBetween, todayISO, monthKey } = core;


const $=id=>document.getElementById(id);


// ── Ленивая загрузка тяжёлых библиотек ──────────────────────────────────────
// turf (~500 КБ) и exceljs (~900 КБ) висели тегами <script> в index.html и
// выполнялись ДО первой строки app.js — то есть приложение не начинало
// работать, пока не приедут оба. При этом turf нужен только для маршрутов
// и экономики, а exceljs — только для выгрузки акта по шаблону xlsx.
// Инженеру в поле со слабой связью это полтора мегабайта ожидания ни за что.
//
// Хэши integrity перенесены из index.html дословно: проверка целостности
// осталась ровно та же, изменился только момент загрузки.
const LIBS={
  turf:{ src:'https://unpkg.com/@turf/turf@6.5.0/turf.min.js',
         integrity:'sha384-82q0nm29xZzIo5BMtDYnh2/NxeO6FoaK1S/0nF84w3cEsqbBfun3JdMyDVYWfVY5',
         global:'turf', label:'библиотеку геометрии (turf)' },
  excel:{ src:'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js',
          integrity:'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz',
          global:'ExcelJS', label:'библиотеку Excel (exceljs)' }
};
const _libP={};
function loadLib(key){
  const c=LIBS[key];
  if(window[c.global]) return Promise.resolve(window[c.global]);
  if(_libP[key]) return _libP[key];
  _libP[key]=new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=c.src; el.integrity=c.integrity;
    el.crossOrigin='anonymous'; el.referrerPolicy='no-referrer';
    el.onload=()=>{ if(window[c.global]) resolve(window[c.global]);
      else { _libP[key]=null; reject(new Error(c.label+': файл получен, но объект не появился')); } };
    // Обнуляем обещание, чтобы следующая попытка началась заново, а не
    // получила навсегда отвергнутое. Иначе один провал сети выключал бы
    // маршрутизацию до перезагрузки страницы.
    el.onerror=()=>{ _libP[key]=null; reject(new Error('Не удалось загрузить '+c.label+'. Проверь соединение и повтори.')); };
    document.head.appendChild(el);
  });
  return _libP[key];
}
const ensureTurf=()=>loadLib('turf');
const ensureExcel=()=>loadLib('excel');
// Прогрев: не блокирует запуск, но к моменту, когда человек дойдёт до карты,
// turf обычно уже на месте. Места, где от него зависит ПРАВИЛЬНОСТЬ цифр,
// всё равно ждут его явно через await — на прогрев там не полагаемся.
ensureTurf().catch(()=>{});
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// ── Подключение к проекту ───────────────────────────────────────────────────
// Значения встроены в сборку. anon-ключ публичен по назначению: он уходит
// в браузер каждому, кто открывает страницу, и защищён не секретностью,
// а политиками RLS. Прежняя схема заставляла каждого сотрудника вводить
// URL и ключ руками, а очистка данных браузера обнуляла настройку —
// человек оставался перед пустым диалогом вместо приложения.
//
// ⚠ ВСТАВЬТЕ КЛЮЧ В СТРОКУ НИЖЕ:
//    Dashboard → Project Settings → API Keys → Publishable (или Legacy anon)
const SB_URL_BUILTIN='https://anqfbljgfimoaziztdxe.supabase.co';
const SB_KEY_BUILTIN='sb_publishable_bKDfkSk7f2uUnV80ei_3qA_5AfJCa7B';

const LS_URL='dl_sb_url', LS_KEY='dl_sb_key';
const UA_BOUNDS=[[44.0,22.0],[52.4,40.3]];

let sb=null, session=null, role=null, profile=null;
let clients=[], eqByClient={}, catalog=[];
let pendingLatLng=null, addModeOn=false, editId=null;
let eqClientId=null, eqEditId=null, cwEditId=null;
let eqModels=[], emEditId=null;
let theme={mode:'dark',accent:'#ffe100'};

// ---------- theme ----------
const THEMES={
  dark:{
    '--bg':'#101114', '--panel':'#1a1c20', '--panel-2':'#24262b', '--line':'#33373e',
    '--ink':'#e7e9ee', '--ink-dim':'#9aa1ad', '--ink-faint':'#6b7280', 
    '--accent':'#ffe100', '--accent-ink':'#ffe100', '--on-accent':'#141414', '--edge':'rgba(0,0,0,0)',
    '--accent-line':'#ffe100',
    '--shadow-sm':'0 4px 12px rgba(0,0,0,0.2)', '--shadow-md':'0 8px 22px rgba(0,0,0,0.35)', '--shadow-lg':'0 12px 32px rgba(0,0,0,0.5)'
  },
  light:{
    // Светлая тема была вдвое площе тёмной: bg → panel-2 давали контраст
    // 1.03 при 1.25 в тёмной, panel → panel-2 — 1.05 при 1.13. Три уровня
    // поверхностей лежали в пределах 4% друг от друга, слои не читались,
    // и всё сливалось в одну заливку. Шаги подобраны по контрастам тёмной
    // темы, а нейтраль уведена из синевы в тёплую: холодный серый спорил
    // с фирменным жёлтым.
    '--bg':'#e7e6e1', '--panel':'#ffffff', '--panel-2':'#f2f1ee', '--line':'#ddd9d2',
    '--ink':'#1c1b19', '--ink-dim':'#605f5a', '--ink-faint':'#8a8986', 
    '--accent':'#ffe100', '--accent-ink':'#1a1d22', '--on-accent':'#141414', '--edge':'rgba(0,0,0,0)', // бренд-жёлтый для заливок/границ, тёмный текст-акцент для читаемости
    // Линии и указатели: #ffe100 на белом даёт 1.31:1 и почти не виден.
    '--accent-line':'#b39400',
    '--shadow-sm':'0 2px 8px rgba(0,0,0,0.06)', '--shadow-md':'0 5px 16px rgba(0,0,0,0.08)', '--shadow-lg':'0 10px 30px rgba(0,0,0,0.1)'
  }
};
function applyTheme(t){ theme=Object.assign({mode:'dark'},t||{});
  const pal=THEMES[theme.mode]||THEMES.dark, r=document.documentElement.style;
  for(const k in pal) r.setProperty(k,pal[k]);
  theme.accent=pal['--accent']||'#ffe100';
  $('modeDark').classList.toggle('on',theme.mode==='dark'); $('modeLight').classList.toggle('on',theme.mode==='light');
  setBaseLayer(theme.mode==='dark'?'dark':'light'); }
async function saveTheme(){ if(!sb||!session) return; try{ await sb.from('profiles').update({theme}).eq('id',session.user.id); }catch(e){} }
let toastT=null; function showToast(msg){ const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.remove('err','warn'); t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),2500); }
function notify(msg,kind){ const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.remove('err','warn'); if(kind==='err'||kind==='warn') t.classList.add(kind); t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>{ t.classList.remove('on','err','warn'); }, kind==='err'?4200:2800); }
let undoT=null, undoFn=null;
function undoToast(msg,fn){ undoFn=fn; const t=$('undoToast'); if(!t){ showToast(msg); return; } $('undoMsg').textContent=msg; t.classList.add('on'); clearTimeout(undoT); undoT=setTimeout(()=>{ t.classList.remove('on'); undoFn=null; },9000); }
if($('undoBtn')) $('undoBtn').onclick=async ()=>{ const f=undoFn; undoFn=null; $('undoToast').classList.remove('on'); clearTimeout(undoT); if(!f) return; try{ await f(); }catch(e){ notify('Не удалось отменить: '+(e.message||e),'err'); } };
// модальные confirm/prompt (замена нативных диалогов)
let _cdRes=null;
function confirmDialog(msg,opts){ opts=opts||{}; return new Promise(res=>{ _cdRes=res; $('confirmTitle').textContent=opts.title||'Подтверждение'; $('confirmMsg').textContent=msg||''; const y=$('confirmYes'); y.textContent=opts.okText||'Подтвердить'; y.classList.toggle('red',!!opts.danger); y.classList.toggle('amber',!opts.danger); $('confirmNo').textContent=opts.cancelText||'Отмена'; $('confirmOverlay').classList.add('on'); setTimeout(()=>{ try{ y.focus(); }catch(e){} },30); }); }
function _cdDone(v){ $('confirmOverlay').classList.remove('on'); const r=_cdRes; _cdRes=null; if(r) r(v); }
$('confirmYes').onclick=()=>_cdDone(true); $('confirmNo').onclick=()=>_cdDone(false);
$('confirmOverlay').addEventListener('click',e=>{ if(e.target===$('confirmOverlay')) _cdDone(false); });
let _pdRes=null;
function promptDialog(title,fields){ fields=fields||[]; return new Promise(res=>{ _pdRes=res; $('promptTitle').textContent=title||'Ввод'; $('promptFields').innerHTML=fields.map((f,i)=>'<label'+(i?' style="margin-top: var(--sp-3)"':'')+'>'+esc(f.label||'')+'</label>'+(f.type==='textarea'?('<textarea data-pf="'+esc(f.key)+'">'+esc(f.value||'')+'</textarea>'):('<input type="text" data-pf="'+esc(f.key)+'" value="'+esc(f.value||'')+'">'))).join(''); $('promptOverlay').classList.add('on'); setTimeout(()=>{ const el=$('promptFields').querySelector('[data-pf]'); if(el){ try{ el.focus(); if(el.select) el.select(); }catch(e){} } },30); }); }
function _pdDone(ok){ const ov=$('promptOverlay'); let out=null; if(ok){ out={}; ov.querySelectorAll('[data-pf]').forEach(el=>{ out[el.dataset.pf]=el.value; }); } ov.classList.remove('on'); const r=_pdRes; _pdRes=null; if(r) r(out); }
$('promptYes').onclick=()=>_pdDone(true); $('promptNo').onclick=()=>_pdDone(false);
$('promptOverlay').addEventListener('click',e=>{ if(e.target===$('promptOverlay')) _pdDone(false); });
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; if($('confirmOverlay').classList.contains('on')) _cdDone(false); if($('promptOverlay').classList.contains('on')) _pdDone(false); });
window.gotoSettings=()=>{ try{ switchTab('settings'); }catch(e){} };
function orsKeyMissing(){ return !(appSettings.ors_proxy||'').trim(); }
function orsMissing(el){ if(el) el.innerHTML='Маршрутизация не настроена. <span class="lnk" onclick="gotoSettings()">Указать ключ ORS или адрес прокси в настройках</span>'; }
$('themeBtn').onclick=e=>{ e.stopPropagation(); $('themePop').classList.toggle('on'); };
document.addEventListener('click',e=>{ const p=$('themePop'); if(p.classList.contains('on') && !p.contains(e.target) && e.target!==$('themeBtn')) p.classList.remove('on'); });
$('modeDark').onclick=()=>{ theme.mode='dark'; applyTheme(theme); saveTheme(); if(typeof render==='function'&&clients&&clients.length) render(); if(typeof drawStops==='function') drawStops(); $('themePop').classList.remove('on'); };
$('modeLight').onclick=()=>{ theme.mode='light'; applyTheme(theme); saveTheme(); if(typeof render==='function'&&clients&&clients.length) render(); if(typeof drawStops==='function') drawStops(); $('themePop').classList.remove('on'); };
// закрытие модалок по фону и Esc
['baseOverlay','linkOverlay','editOverlay','eqOverlay','catOverlay'].forEach(id=>{ const o=$(id); if(o) o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('on'); }); });
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; ['baseOverlay','linkOverlay','editOverlay','eqOverlay','catOverlay'].forEach(id=>{ const o=$(id); if(o&&o.classList.contains('on')) o.classList.remove('on'); }); const tp=$('themePop'); if(tp) tp.classList.remove('on'); });

// ---------- logo ----------
(function(){ const lg=$('logoImg'); lg.onload=()=>{lg.style.display='block';$('wordmark').style.display='none';}; lg.onerror=()=>{lg.style.display='none';$('wordmark').style.display='';}; lg.src='./logo.png'; })();

// ---------- map ----------
const map=L.map('map',{zoomControl:true});
const baseLayers={
  light:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}),
  dark:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'dark-tiles',attribution:'© OpenStreetMap'})
};
let currentBase=null;
function setBaseLayer(kind){ const next=baseLayers[kind]||baseLayers.light; if(currentBase===next) return; if(currentBase) map.removeLayer(currentBase); map.addLayer(next); currentBase=next; if(next.bringToBack) next.bringToBack(); }
setBaseLayer('dark');
map.setView([48.4,31.2],6);
function fitUkraine(){ map.fitBounds(UA_BOUNDS); }
let markers=L.layerGroup().addTo(map), eqMarkers=L.layerGroup().addTo(map), tripLayer=L.layerGroup().addTo(map), routeLayer=L.layerGroup().addTo(map), bufferLayer=L.layerGroup().addTo(map), pendingMarker=null, revealedClient=null, wpModeOn=false, markerById={};
let clientStats={}, profitMode=false, avoidModeOn=false, avoidLayer=L.layerGroup().addTo(map);
// Живые заявки для ленты на карте (см. loadClientStats).
let jobsLite=[];
// Что карта показывает по умолчанию.
//
// 'work' — только то, с чем сейчас идёт работа: точки с живыми заявками,
//          все депо и машины. Остальной справочник скрыт.
// 'all'  — весь справочник, как было раньше.
//
// Смысл в том, что во вторник утром диспетчер смотрит не на адресную книгу,
// а на то, что движется и что горит. Из 24 точек в работе обычно единицы,
// и остальные два десятка только мешают их найти.
//
// Фильтр по ЖИВЫМ заявкам, а не по числу дней до срока: сроки у заявок
// разной длины, и порог в днях легко даёт пустую карту.
let mapScope='work';
let vehLayer=L.layerGroup().addTo(map), vehShow=true, vehState=[], vehMk={}, vehTick=null, vehVisWired=false, vehModalId=null;
// Кнопка «Сохранить» в карточке точки не должна нажиматься, пока сохранять
// нечего. Состояние и так известно — подсказка «Место не задано» выводится
// рядом, — просто кнопка о нём не знала и отвечала ошибкой уже после нажатия.
function updatePointSaveState(){
  const b=$('saveBtn'); if(!b) return;
  const hasName=!!($('fName')&&$('fName').value.trim());
  const hasPlace=!!pendingLatLng||!!editId;
  b.disabled=!(hasName&&hasPlace);
}

function updatePointCoords(){ const el=$('pointCoords'); if(!el) return; if(pendingLatLng){ el.innerHTML='<span class="ok">📍 координаты заданы: '+(+pendingLatLng.lat).toFixed(5)+', '+(+pendingLatLng.lng).toFixed(5)+'</span>'; } else { el.textContent='Место не задано — «Указать на карте» или найдите по адресу.'; } updatePointSaveState(); }
if($('fName')) $('fName').oninput=updatePointSaveState;
function openPointModal(){ updatePointCoords(); updatePointSaveState(); $('pointOverlay').classList.add('on'); setTimeout(()=>{ try{ $('fName').focus(); }catch(e){} },40); }
map.on('click',e=>{ if(avoidModeOn){ addAvoidZone(e.latlng); return; } if(addModeOn){ pendingLatLng=e.latlng; toggleAdd(false); flashPending(); openPointModal(); return; } if(wpModeOn){ rStops.push({type:'wp',name:'точка '+(rStops.length+1),lat:e.latlng.lat,lng:e.latlng.lng}); renderRoutePanel(); resetBuilt(); } });
function flashPending(){ if(pendingMarker) map.removeLayer(pendingMarker); if(!pendingLatLng) return; pendingMarker=L.circleMarker(pendingLatLng,{radius:9,color:ringColor(),fillColor:theme.accent,fillOpacity:.6,weight:2.5}).addTo(map); }
function hlMarker(id,on){ const m=markerById[id]; if(!m||!m.getElement) return; const el=m.getElement(); if(!el) return; const b=el.querySelector('.cbub'); if(b) b.classList.toggle('hl',on); }
function hlCard(id,on){ const c=document.querySelector('#list .pt[data-cid="'+id+'"]'); if(c) c.classList.toggle('hl',on); }
let ctxLatLng=null;
function showCtxMenu(e){ ctxLatLng=e.latlng; const m=$('ctxMenu'); let h='';
  if(canWrite()){ h+='<button data-cx="add">📍 Добавить точку здесь</button><button data-cx="wp">↳ В маршрут: промежуточная</button><button data-cx="start">▶ Сделать стартом маршрута</button><button data-cx="avoid">🚫 Объезд здесь (плохая дорога)</button>'; }
  h+='<button data-cx="copy">⧉ Копировать координаты</button>'; m.innerHTML=h;
  const x=e.originalEvent.clientX, y=e.originalEvent.clientY; m.style.left=Math.min(x,window.innerWidth-230)+'px'; m.style.top=Math.min(y,window.innerHeight-180)+'px'; m.classList.add('on');
  m.querySelectorAll('[data-cx]').forEach(b=>b.onclick=()=>{ ctxAction(b.dataset.cx); m.classList.remove('on'); }); }
function ctxAction(a){ if(!ctxLatLng) return; const ll=ctxLatLng;
  if(a==='add'){ if(addModeOn) toggleAdd(false); $('fName').value=''; $('fDesc').value=''; $('formErr').textContent=''; pendingLatLng={lat:ll.lat,lng:ll.lng}; flashPending(); openPointModal(); }
  else if(a==='avoid'){ addAvoidZone(ll); }
  else if(a==='wp'){ rStops.push({type:'wp',name:'точка '+(rStops.length+1),lat:ll.lat,lng:ll.lng}); const b=$('routeBlock'); if(b) b.classList.remove('collapsed'); renderRoutePanel(); resetBuilt(); }
  else if(a==='start'){ rStart={name:'Старт',lat:ll.lat,lng:ll.lng}; const b=$('routeBlock'); if(b) b.classList.remove('collapsed'); renderRoutePanel(); resetBuilt(); }
  else if(a==='copy'){ const t=ll.lat.toFixed(6)+', '+ll.lng.toFixed(6); try{ navigator.clipboard.writeText(t); }catch(e){} showToast('Координаты: '+t); } }
map.on('contextmenu',e=>{ if(e.originalEvent) e.originalEvent.preventDefault(); showCtxMenu(e); });
map.on('click',()=>$('ctxMenu').classList.remove('on'));
document.addEventListener('click',e=>{ const m=$('ctxMenu'); if(m.classList.contains('on') && !m.contains(e.target)) m.classList.remove('on'); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ const m=$('ctxMenu'); if(m) m.classList.remove('on'); } });
function canWrite(){ return role==='admin'||role==='logist'; }

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
document.querySelectorAll('.block.collapsible > h2.ch').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('collapsed'));
if($('sideHandle')) $('sideHandle').onclick=()=>{ const sd=document.querySelector('.side'); if(sd) sd.classList.toggle('sheet-collapsed'); setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} },220); };
function tabAllowed(name){ if(name==='catalog'||name==='dash') return canWrite(); if(name==='settings') return role==='admin'; return true; }
// Пункт «Мой день» нужен инженеру; менеджеру он дублирует сводку.
function navAllowed(el){
  if(!tabAllowed(el.dataset.tab)) return false;
  if(el.dataset.sub==='mine' && canWrite()) return false;
  return true;
}
function applyTabs(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('hidden',!tabAllowed(t.dataset.tab)));
  document.querySelectorAll('.nav-i[data-tab]').forEach(t=>t.classList.toggle('hidden',!navAllowed(t)));
}
// В рельсе «Мой день», «Заявки» и «Выезды» — пункты первого уровня,
// но ведут все три в один и тот же view-planner. Поэтому у них есть
// data-sub, и подсветка идёт по паре (tab, sub), а не по одному tab.
function switchTab(name, sub){ if(!tabAllowed(name)) return;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.nav-i[data-tab]').forEach(t=>{
    const hit = t.dataset.tab===name && (!t.dataset.sub || t.dataset.sub===(sub||plannerCur));
    t.classList.toggle('active',hit);
  });
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelector('.view-'+name).classList.add('active');
  // У страницы выезда нет своего пункта в рельсе: она — вложенный экран
  // «Выездов», и подсветка должна остаться на них, иначе непонятно, где ты.
  if(name==='trip') document.querySelectorAll('.nav-i[data-sub="trips"]').forEach(t=>t.classList.add('active'));
  if(name==='job') document.querySelectorAll('.nav-i[data-sub="jobs"]').forEach(t=>t.classList.add('active'));
  if(name==='map'){ setTimeout(()=>map.invalidateSize(),60); }
  if(name==='catalog') catSub(catCur);
  if(name==='planner') plannerSub(sub||plannerCur);
  if(name==='dash') renderDashboard(); if(name==='settings') renderSettings(); }
document.querySelectorAll('.nav-i[data-tab]').forEach(el=>{
  el.onclick=()=>switchTab(el.dataset.tab, el.dataset.sub||null);
});
let catCur='works';
function catSub(name){ catCur=name; document.querySelectorAll('.view-catalog .subtab').forEach(t=>t.classList.toggle('active',t.dataset.csub===name)); $('catWorks').style.display=name==='works'?'':'none'; $('catModels').style.display=name==='models'?'':'none'; if(name==='works') renderCatalog(); else renderEqModels(); }
document.querySelectorAll('.view-catalog .subtab').forEach(t=>t.onclick=()=>catSub(t.dataset.csub));
let plannerCur='jobs';
let tripsView='kanban';
function renderTripsView(){ const kb=(tripsView==='kanban'); if($('tripsKanban')) $('tripsKanban').style.display=kb?'':'none'; if($('tripsGantt')) $('tripsGantt').style.display=kb?'none':''; if(kb) renderTrips(); else renderGantt(); }
function setTripsView(v){ tripsView=v; document.querySelectorAll('#tripsView [data-tv]').forEach(b=>b.classList.toggle('on',b.dataset.tv===v)); renderTripsView(); }
function plannerSub(name){ plannerCur=name;
  document.querySelectorAll('.nav-i[data-sub]').forEach(t=>
    t.classList.toggle('active', t.dataset.tab==='planner' && t.dataset.sub===name)); document.querySelectorAll('.view-planner .subtab').forEach(t=>t.classList.toggle('active',t.dataset.sub===name)); if($('plMine')) $('plMine').style.display=name==='mine'?'':'none'; $('plJobs').style.display=name==='jobs'?'':'none'; $('plTrips').style.display=name==='trips'?'':'none'; if(name==='mine') renderMine(); else if(name==='jobs') renderJobs(); else renderTripsView(); }
document.querySelectorAll('#tripsView [data-tv]').forEach(b=>b.onclick=()=>setTripsView(b.dataset.tv));
// Подсказки по «?». Делегирование, а не обработчик на каждую: часть кружков
// приезжает из JS вместе с перерисовкой, и вешать их поштучно значило бы
// терять обработчик при каждом рендере.
document.addEventListener('click',e=>{
  const btn=e.target.closest('.qm');
  const open=document.querySelector('.q.on');
  if(open && (!btn || open!==btn.parentElement)) open.classList.remove('on','flip');
  if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const q=btn.parentElement; const on=!q.classList.contains('on');
  q.classList.toggle('on',on);
  if(on){
    // Ближе к правому краю окно уезжает за экран — разворачиваем влево.
    const body=q.querySelector('.qbody');
    q.classList.remove('flip');
    if(body && body.getBoundingClientRect().right>window.innerWidth-8) q.classList.add('flip');
  }
});
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return;
  const o=document.querySelector('.q.on'); if(o) o.classList.remove('on','flip'); });
// Тень под закреплённой шапкой появляется только когда под неё что-то уехало.
// Постоянная линия на нетронутом списке — это шум, которого нечем объяснить.
(function(){
  const panes=document.querySelectorAll('.pane.scrollp');
  const sync=pane=>pane.querySelectorAll('.stickyhead').forEach(h=>h.classList.toggle('stuck',pane.scrollTop>2));
  panes.forEach(pane=>pane.addEventListener('scroll',()=>sync(pane),{passive:true}));
})();
document.querySelectorAll('.view-planner .subtab').forEach(t=>t.onclick=()=>plannerSub(t.dataset.sub));

// ---------- connection ----------
function cfgOverride(){ try{ return {url:localStorage.getItem(LS_URL),key:localStorage.getItem(LS_KEY)}; }catch(e){ return {}; } }
// localStorage перекрывает встроенное — это отладочный режим для второго
// проекта или стенда. Обычный пользователь ничего не вводит.
function loadCfg(){ const o=cfgOverride();
  return {url:o.url||SB_URL_BUILTIN||'', key:o.key||SB_KEY_BUILTIN||'', override:!!(o.url&&o.key)}; }
$('cfgBtn').onclick=()=>{ const o=cfgOverride();
  $('cfgUrl').value=o.url||''; $('cfgKey').value=o.key||'';
  $('cfgErr').textContent=SB_KEY_BUILTIN?'Пусто = встроенные значения сборки.':'';
  $('cfgOverlay').classList.add('on'); };

// Кнопка подключения нужна, только если сборка без встроенного ключа либо
// кто-то уже поставил переопределение и захочет его снять. Принудительно
// открыть — адресом со ?cfg=1.
(function(){ const need=(!SB_KEY_BUILTIN)||cfgOverride().url||/[?&]cfg=1/.test(location.search);
  if(!need && $('cfgBtn')) $('cfgBtn').style.display='none'; })();
$('cfgSave').onclick=()=>{ const url=$('cfgUrl').value.trim(), key=$('cfgKey').value.trim();
  // Оба поля пустые при наличии встроенных значений — снять переопределение.
  if(!url&&!key&&SB_KEY_BUILTIN){ try{ localStorage.removeItem(LS_URL); localStorage.removeItem(LS_KEY); }catch(e){} location.reload(); return; }
  if(!url||!key){ $('cfgErr').textContent=SB_KEY_BUILTIN?'Заполни оба поля или очисти оба, чтобы вернуться к встроенным.':'Заполни оба поля.'; return; } try{ localStorage.setItem(LS_URL,url); localStorage.setItem(LS_KEY,key); }catch(e){} location.reload(); };

// ---------- auth ----------
$('authBtn').onclick=doAuth; $('auPass').addEventListener('keydown',e=>{ if(e.key==='Enter') doAuth(); });
async function doAuth(){ const email=$('auEmail').value.trim(), password=$('auPass').value; if(!email||!password){ $('authErr').textContent='Введи email и пароль.'; return; } $('authErr').textContent='…';
  try{ const res=await sb.auth.signInWithPassword({email,password}); if(res.error) throw res.error;
    await onSignedIn();
  }catch(err){ $('authErr').textContent='Ошибка: '+(err.message||err); } }
// Наш собственный выход не должен считаться потерей сессии.
let authLeaving=false;
$('logoutBtn').onclick=async ()=>{ authLeaving=true; await sb.auth.signOut(); location.reload(); };

// Истечение сессии раньше выглядело как случайно опустевшие экраны: запросы
// начинали возвращать ошибки RLS, а те глотались пустыми catch. Теперь
// приложение узнаёт об этом и говорит прямо.
//
// TOKEN_REFRESHED важен отдельно: orsPost берёт access_token из глобального
// session, и после обновления токена там оставался бы просроченный.
// Вызывается из boot() ПОСЛЕ createClient: на верхнем уровне sb ещё null,
// и обращение к нему роняло весь скрипт — карта не успевала создаться.
function watchAuth(){
  if(!sb) return;
  sb.auth.onAuthStateChange((event,s)=>{
    if(authLeaving) return;
    if(event==='SIGNED_OUT'){ location.reload(); return; }
    if(event==='TOKEN_REFRESHED' && s) session=s;
  });
}

// Тихо проглоченная ошибка загрузки выглядит как «данных нет», и человек ищет
// несуществующую проблему в данных вместо реальной — в сети или в правах.
function loadFail(what,e){ console.error('load failed:',what,e); notify('Не удалось загрузить: '+what,'err'); }

async function onSignedIn(){ const { data:{ session:s } }=await sb.auth.getSession(); session=s; if(!session){ $('authOverlay').classList.add('on'); return; }
  const { data:p, error }=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error){ $('authErr').textContent='Профиль не найден: '+error.message; $('authOverlay').classList.add('on'); return; }
  // Учётка есть, но админ ещё не выдал допуск (profiles.active = false).
  // Без этой проверки человек попадал бы внутрь с пустыми списками:
  // читающие политики его не пускают, а ошибки RLS глотаются молча.
  // Строгое === false: если колонки почему-то нет, значение undefined
  // и проверка не мешает.
  if(p.active===false){ authLeaving=true; await sb.auth.signOut(); authLeaving=false; session=null; profile=null; role=null;
    $('authErr').textContent='Доступ ещё не выдан. Попроси администратора активировать учётную запись.';
    $('authOverlay').classList.add('on'); return; }
  profile=p; role=p.role; await loadSettings();
  if(p.theme && p.theme.mode) theme=p.theme; else if(appSettings.default_theme && appSettings.default_theme.mode) theme=appSettings.default_theme;
  applyTheme(theme);
  $('authOverlay').classList.remove('on');
  // В рельсе 76 px: полный адрес не влезает, показываем имя до @ и роль.
  const em=String(session.user.email||''); const short=em.split('@')[0];
  $('whoLabel').innerHTML=esc(short)+'<b>'+esc(role)+'</b>';
  $('whoLabel').title=em+' · '+role;
  $('logoutBtn').style.display=''; $('appRoot').style.display='block'; document.querySelector('.view-map').classList.add('active');
  if($('pointTools')) $('pointTools').style.display=canWrite()?'':'none'; $('routeBlock').style.display=canWrite()?'':'none'; if($('profitTools')) $('profitTools').style.display=canWrite()?'':'none'; if($('jobAdd')) $('jobAdd').style.display=canWrite()?'':'none'; if($('jobEngFilter')) $('jobEngFilter').style.display=canWrite()?'':'none'; if($('tripAdd')) $('tripAdd').style.display=canWrite()?'':'none'; applyTabs(); if(role==='engineer'){ plannerCur='mine'; switchTab('planner'); }
  setTimeout(()=>{ map.invalidateSize(); fitUkraine(); },80);
  await loadAll(); await loadPlaces(); await loadVehicles(); await loadEqModels();
  await loadVehState(); subscribeVeh(); await loadFactHours(); await loadRescheds();
  checkTodayTrip(); initPush(); }

// ---------- data load ----------
async function loadAll(){ $('dataStatus').textContent='Загрузка…';
  const [cRes,eRes]=await Promise.all([ sb.from('clients').select('*').is('deleted_at',null).order('created_at'), sb.from('equipment').select('*').is('deleted_at',null).order('created_at') ]);
  if(cRes.error){ $('dataStatus').innerHTML='<span class="err">'+esc(cRes.error.message)+'</span>'; return; }
  clients=cRes.data||[]; eqByClient={}; (eRes.data||[]).forEach(e=>{ (eqByClient[e.client_id]=eqByClient[e.client_id]||[]).push(e); });
  $('dataStatus').innerHTML='<span class="ok">На карте: '+clients.length+'</span>';
  await loadReadings(); await loadClientStats();
  render(); if(clients.length) map.fitBounds(clients.map(c=>[c.lat,c.lng]),{padding:[40,40]}); else fitUkraine(); }
async function refreshStats(){ if(!canWrite()) return; await loadClientStats(); renderMarkers(); }
async function loadClientStats(){ clientStats={}; if(!canWrite()) return;
  // due_date и created_at добавлены к тому же запросу: по ним считается
  // срочность клиента для раскраски точек на карте. Отдельного похода
  // в базу это не стоит, а карта из справочника координат превращается
  // в картину дня.
  try{ const {data,error}=await sb.from('jobs').select('id,client_id,status,due_date,created_at,clients(name),equipment(model),job_works(hours,billable,revenue,tariff_profile)').is('deleted_at',null);
    if(error) throw error;
    const ch=+((appSettings.costs&&appSettings.costs.hour))||0;
    const now=new Date();
    // Сырые живые заявки складываем отдельно: из них строится лента «в работе»
    // на карте. Отдельного запроса это не стоит — данные уже пришли.
    jobsLite=(data||[]).filter(j=>j.status!=='done'&&j.status!=='cancelled');
    (data||[]).forEach(j=>{ if(!j.client_id) return; const s=clientStats[j.client_id]||(clientStats[j.client_id]={rev:0,hours:0,warrH:0,cost:0,jobs:0,done:0,urg:null,open:0});
      s.jobs++; if(j.status==='done') s.done++;
      // Острота — по самой горящей ЖИВОЙ заявке клиента. Закрытые
      // и отменённые на цвет точки не влияют: работа по ним кончилась.
      if(j.status!=='done'&&j.status!=='cancelled'){
        s.open++;
        const lvl=jobUrgency(j,now).level;
        if(s.urg==null||urgencyRank(lvl)<urgencyRank(s.urg)) s.urg=lvl;
      }
      (j.job_works||[]).forEach(w=>{ const h=+w.hours||0; s.hours+=h; s.cost+=h*ch; if(w.billable===false) s.warrH+=h; s.rev+=(+w.revenue||0); }); });   // выручка и с гарантийных: тариф свой, но счёт есть всегда
    Object.values(clientStats).forEach(s=>{ s.profit=s.rev-s.cost; s.warrShare=s.hours>0?Math.round(s.warrH/s.hours*100):0; });
  }catch(e){ clientStats={}; loadFail('статистику по клиентам',e); } }

// Тревоги по клиентам — один расчёт на загрузку данных, а не на каждую
// отрисовку. eqAlert() внутри идёт через eqService и eqRate по показаниям
// всей техники клиента, так что считать его в обработчике ввода нельзя.
let alertCount={};
function recomputeAlerts(){
  alertCount={};
  clients.forEach(c=>{ alertCount[c.id]=(eqByClient[c.id]||[]).filter(e=>eqAlert(e).any).length; });
  const total=Object.values(alertCount).filter(x=>x>0).length;
  const el=$('alertCnt'); if(el) el.textContent=total?('· '+total):'';
}
function alertOnly(){ return !!($('ptAlert')&&$('ptAlert').checked); }

function render(){
  $('cliCount').textContent=(mapScope==='work'
    ? String(clients.filter(x=>x.is_base||((clientStats[x.id]||{}).open>0)).length)
    : String(clients.length)); places=clients.filter(c=>c.is_base); recomputeAlerts(); renderColorLegend(); renderMarkers(); renderAvoidZones(); renderSide(); }
// Раскраска точек — ОДИН выбор из трёх, а не набор независимых флажков.
//
// Раньше цвет по умолчанию брался из поля клиента color, то есть означал
// то, что когда-то выбрал человек в форме. Самый заметный визуальный канал
// на главном экране тратился на произвольную пометку, а состояния, нужные
// диспетчеру, не кодировались никак.
//
// Теперь по умолчанию цвет = срочность. Прибыльность и «свой цвет»
// остаются как отдельные взгляды на те же точки.
let colorMode='urgency';
const URG_COL={overdue:'#dc2626',acute:'#f59e0b',calm:'#16a34a',cold:'#0ea5e9'};
const URG_TXT={overdue:'просрочено',acute:'горит',calm:'спокойно',cold:'без срока'};
function markerColor(c){
  if(c.is_base) return c.color||'#27d3c4';
  if(colorMode==='own') return c.color||'#9aa1ad';
  if(colorMode==='profit'){
    const s=clientStats[c.id]; if(!s) return '#6b7280';
    return profitColorOf(s.profit);
  }
  const s=clientStats[c.id];
  if(!s||!s.open) return '#94a3b8';            // живых заявок нет — серый
  return URG_COL[s.urg]||'#94a3b8';
}
function renderColorLegend(){
  const el=$('profitLegend'); if(!el) return;
  const dot=(c,t)=>'<span><i style="background:'+c+'"></i>'+t+'</span>';
  if(colorMode==='profit'){
    el.innerHTML=[dot('#16a34a','высокая'),dot('#84cc16','средняя'),
      dot('#eab308','низкая'),dot('#6b7280','нет прибыли')].join('');
  } else if(colorMode==='urgency'){
    el.innerHTML=[dot(URG_COL.overdue,URG_TXT.overdue),dot(URG_COL.acute,URG_TXT.acute),
      dot(URG_COL.calm,URG_TXT.calm),dot(URG_COL.cold,URG_TXT.cold),
      dot('#94a3b8','нет заявок')].join('');
  } else {
    el.innerHTML='Цвет задаётся в карточке точки.';
  }
  el.style.display='';
}
document.querySelectorAll('#colorMode button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#colorMode button').forEach(x=>x.classList.toggle('on',x===b));
  colorMode=b.dataset.cm; profitMode=(colorMode==='profit');
  renderColorLegend(); renderMarkers(); });
// Шкала прибыльности вынесена из renderMarkers: ею пользуется markerColor(),
// а он вызывается и до отрисовки — например, из списка точек.
let _maxProfit=0;
function profitColorOf(p){ if(!(p>0)) return '#6b7280';
  const r=_maxProfit>0?(p/_maxProfit):0; return r>=0.6?'#16a34a':(r>=0.3?'#84cc16':'#eab308'); }

function renderMarkers(){ markers.clearLayers(); eqMarkers.clearLayers(); revealedClient=null; markerById={};
  _maxProfit=0; Object.values(clientStats).forEach(s=>{ if(s.profit>_maxProfit) _maxProfit=s.profit; });
  const ab='cursor:pointer;font-family:var(--mono);font-size: var(--fs-1);border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);border-radius: var(--r-pill);padding: var(--sp-2) var(--sp-3)';
  const lb='cursor:pointer;font-family:var(--mono);font-size: var(--fs-1);border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius: var(--r-pill);padding: var(--sp-2) var(--sp-3)';
  // Фильтр «требующие внимания» гасит остальные точки НА КАРТЕ. Раньше он
  // менял только список — а список это та половина экрана, на которую
  // не смотришь, работая с картой, и флажок казался мёртвым.
  // Депо не гасим никогда: без них не построить маршрут.
  const dimOthers=alertOnly();
  // В режиме «в работе» точки без живых заявок на карту не попадают вовсе.
  // Не приглушаются — именно скрываются: смысл режима в том, чтобы на карте
  // осталось только то, чем занимаются. Депо остаются всегда, без них
  // не построить маршрут.
  const inWork=c=>c.is_base||((clientStats[c.id]||{}).open>0);
  clients.forEach(c=>{ if(mapScope==='work'&&!inWork(c)) return;
    const col=markerColor(c);
    const dim=dimOthers && !c.is_base && !(alertCount[c.id]>0);
    if(c.is_base){
      const icon=L.divIcon({className:'',html:'<div class="cbub" style="background:'+col+';width:30px;height:30px;border:2.5px solid '+ringColor()+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></div>',iconSize:[30,30],iconAnchor:[15,15]});
      const m=L.marker([c.lat,c.lng],{icon});
      let html='<strong style="font-size: var(--fs-4)">'+esc(c.name)+'</strong> <span style="color:var(--ink-dim)">· депо</span>'; if(c.description) html+='<br>'+esc(c.description);
      if(canWrite()){ html+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3)"><button onclick="addBaseStart(\''+c.id+'\')" style="'+ab+'">▶ старт</button><button onclick="addBaseStop(\''+c.id+'\')" style="'+lb+'">⏹ финиш</button><button onclick="editClient(\''+c.id+'\')" style="'+lb+'">ред.</button></span>'; }
      m.bindPopup(html); markerById[c.id]=m; m.on('mouseover',()=>hlCard(c.id,true)).on('mouseout',()=>hlCard(c.id,false)); markers.addLayer(m); return;
    }
    const list=eqByClient[c.id]||[]; const count=list.length; const withCoords=list.filter(e=>e.lat!=null&&e.lng!=null).length; const d=Math.min(46,20+count*4);
    const dcol=col;
    const icon=L.divIcon({className:'',html:'<div class="cbub" style="background:'+dcol+';border:2.5px solid '+ringColor()+'">'+(count||'')+'</div>',iconSize:[d,d],iconAnchor:[d/2,d/2]});
    const m=L.marker([c.lat,c.lng],{icon});
    let html='<strong style="font-size: var(--fs-4)">'+esc(c.name)+'</strong>'; if(c.description) html+='<br>'+esc(c.description);
    html+='<br><span style="color:var(--ink-dim)">техники: '+count+(withCoords?(' · своих точек: '+withCoords):'')+'</span>';
    // Что означает цвет этой точки — прямо в попапе, чтобы не сверяться
    // с легендой в меню слоёв.
    const us=clientStats[c.id];
    if(colorMode==='urgency'&&us&&us.open){
      html+='<br><span style="color:'+(URG_COL[us.urg]||'#94a3b8')+';font-size: var(--fs-2)">● '
        +esc(URG_TXT[us.urg]||'')+' · живых заявок '+us.open+'</span>';
    }
    const s=clientStats[c.id]; if(s){ const cur=appSettings.currency||'грн'; html+='<br><span style="display:block;margin-top: var(--sp-2);font-size: var(--fs-2);color:var(--ink-dim);line-height:1.6">выручка <b style="color:var(--ink)">'+Math.round(s.rev)+' '+esc(cur)+'</b> · прибыль <b style="color:'+(s.profit>=0?'var(--green)':'var(--red)')+'">'+Math.round(s.profit)+'</b><br>гарантия '+s.warrShare+'% · заявок '+s.jobs+(s.done?(' · закрыто '+s.done):'')+'</span>'; }
    html+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3)"><button onclick="openEquip(\''+c.id+'\')" style="'+lb+'">техника</button>';
    if(canWrite()){ html+='<button onclick="addClientToRoute(\''+c.id+'\')" style="'+ab+'">+ маршрут</button><button onclick="newJobForClient(\''+c.id+'\')" style="'+lb+'">+ заявка</button><button onclick="editClient(\''+c.id+'\')" style="'+lb+'">ред.</button>'; }
    html+='</span>'; m.bindPopup(html);
    m.on('click',()=>{ revealedClient=(revealedClient===c.id)?null:c.id; renderEqMarkers(); });
    if(dim) m.setOpacity(.25);
    markerById[c.id]=m; m.on('mouseover',()=>hlCard(c.id,true)).on('mouseout',()=>hlCard(c.id,false)); markers.addLayer(m); }); }

let readingsByEq={};
async function loadReadings(){ readingsByEq={}; try{ const {data,error}=await sb.from('equipment_readings').select('*').order('taken_on');
  if(error) throw error;
  (data||[]).forEach(r=>{ (readingsByEq[r.equipment_id]=readingsByEq[r.equipment_id]||[]).push(r); }); }catch(e){ readingsByEq={}; loadFail('показания моточасов',e); } }

function eqRate(e){ const own=rateFrom(readingsByEq[e.id]); if(own>0) return {rate:own,src:'unit'};
  let sum=0,n=0; (eqByClient[e.client_id]||[]).forEach(x=>{ const r=rateFrom(readingsByEq[x.id]); if(r>0){ sum+=r; n++; } });
  if(n) return {rate:sum/n,src:'client'}; return {rate:0,src:'none'}; }
function eqService(e){ const m=e.model_id?eqModels.find(x=>x.id==e.model_id):null; const sih=m?(+m.service_interval_hours||0):0; if(sih<=0) return null;
  const rs=readingsByEq[e.id]||[]; const last=rs.length?rs[rs.length-1]:null; const rr=eqRate(e); const today=todayISO();
  if(!last||rr.rate<=0){ const sh=+appSettings.shift_hours||0; const anchor=e.last_service||e.installed_on||null; if(!anchor||sh<=0) return null;
    const since=businessDays(anchor,today)*sh; return {since,interval:sih,rate:0,src:'estimate',daysLeft:null}; }
  const lastSvc=[...rs].reverse().find(r=>r.kind==='service');
  const daysSince=Math.max(0,(Date.now()-new Date(last.taken_on+'T00:00:00').getTime())/86400000);
  const nowMh=(+last.moto_hours)+rr.rate*daysSince;
  const baseMh=lastSvc?(+lastSvc.moto_hours):(+rs[0].moto_hours);
  const since=Math.max(0,nowMh-baseMh); const daysLeft=Math.round((sih-since)/rr.rate);
  return {since,interval:sih,rate:rr.rate,src:rr.src,daysLeft,nowMh}; }
function eqAlert(e){ const r={contact:false,service:false,any:false,reasons:[]};
  const cp=+appSettings.contact_period_days||0; if(cp>0){ const ref=e.last_visit||e.installed_on||null; if(ref){ const days=Math.floor((Date.now()-new Date(ref).getTime())/86400000); if(days>cp){ r.contact=true; r.reasons.push('Контакт '+days+' дн назад (норма '+cp+')'); } } }
  const sv=eqService(e);
  if(sv&&sv.since>=sv.interval){ r.service=true;
    r.reasons.push(sv.rate>0 ? ('Наработка ~'+Math.round(sv.since)+' мч при интервале '+Math.round(sv.interval)+' (темп '+sv.rate.toFixed(1)+' мч/сут'+(sv.src==='client'?', по клиенту':'')+')')
                             : ('Наработка ~'+Math.round(sv.since)+' моточасов (ТО каждые '+Math.round(sv.interval)+', грубая оценка)')); }
  else if(sv&&sv.rate>0&&sv.daysLeft!=null&&sv.daysLeft<=14){ r.service=true; r.reasons.push('ТО через ~'+sv.daysLeft+' дн (темп '+sv.rate.toFixed(1)+' мч/сут)'); }
  r.any=r.contact||r.service; return r; }
function renderEqMarkers(){ eqMarkers.clearLayers(); if(!revealedClient) return; const c=clients.find(x=>x.id===revealedClient); if(!c) return; const col=c.color||'#9aa1ad';
  (eqByClient[c.id]||[]).forEach(e=>{ if(e.lat==null||e.lng==null) return;
    L.polyline([[c.lat,c.lng],[e.lat,e.lng]],{color:col,weight:1.5,opacity:.5,dashArray:'4 5'}).addTo(eqMarkers);
    const m=L.circleMarker([e.lat,e.lng],{radius:6,color:ringColor(),fillColor:col,fillOpacity:.9,weight:2.5,opacity:1});
    const al=eqAlert(e);
    let eh='<strong>'+esc(e.model)+'</strong><br><span style="color:var(--ink-dim)">'+esc(c.name)+(e.kind?' · '+esc(e.kind):'')+'</span>';
    eh+='<br><span style="color:var(--ink-faint);font-size: var(--fs-2)">'+(e.last_visit?('визит '+esc(e.last_visit)):'визитов нет')+(e.last_service?(' · ТО '+esc(e.last_service)):'')+'</span>';
    if(al.any) eh+='<br><span style="color:var(--red);font-size: var(--fs-2)">⚠ '+esc(al.reasons.join('; '))+'</span>';
    if(canWrite()) eh+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3)"><button onclick="addEquipToRoute(\''+c.id+'\',\''+e.id+'\')" style="cursor:pointer;font-family:var(--mono);font-size: var(--fs-1);border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);border-radius: var(--r-pill);padding: var(--sp-2) var(--sp-3)">+ маршрут</button><button onclick="newJobForEquip(\''+c.id+'\',\''+e.id+'\')" style="cursor:pointer;font-family:var(--mono);font-size: var(--fs-1);border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius: var(--r-pill);padding: var(--sp-2) var(--sp-3)">+ заявка</button></span>';
    m.bindPopup(eh); eqMarkers.addLayer(m);
    if(al.any){ const ab=L.divIcon({className:'',html:'<div class="eq-alert">'+(al.service?'🔧':'📞')+'</div>',iconSize:[22,22],iconAnchor:[-4,28]}); L.marker([e.lat,e.lng],{icon:ab,interactive:false,zIndexOffset:1200}).addTo(eqMarkers); } }); }
let pointFilter='all';
// Панель слева показывает разное в зависимости от режима карты:
// в «работе» — что происходит сегодня, в «справочнике» — список точек.
// Список живёт в коробке ограниченной высоты: восемьдесят точек утаскивали
// «Маршрут» и «Сохранить как выезд» за нижний край плавающей карточки.
if($('listHead')) $('listHead').onclick=()=>{
  const h=$('listHead'), b=$('pointsBox');
  const folded=!h.classList.contains('folded');
  h.classList.toggle('folded',folded); b.classList.toggle('folded',folded);
  $('listHeadT').textContent=folded?'показать список':'свернуть список';
};
function renderSide(){
  const work=(mapScope==='work');
  const t=$('sideTools'); if(t) t.style.display=work?'none':'';
  const f=$('workFeed');  if(f) f.style.display=work?'':'none';
  const l=$('list');      if(l) l.style.display=work?'none':'';
  if(work) renderWorkFeed(); else renderList();
}

// Лента «в работе»: машины в пути, затем заявки по остроте.
// Порядок и разбиение считает attentionBuckets из ядра — та же функция,
// что и на сводке, так что ленты не разъедутся между экранами.
function renderWorkFeed(){
  const box=$('workFeed'); if(!box) return;
  let h='';

  const moving=(vehState||[]).filter(r=>r&&r.lat!=null);
  if(moving.length){
    h+='<div class="wf-h">В пути сейчас</div>';
    moving.forEach(r=>{
      const v=(vehicles||[]).find(x=>x.id===r.vehicle_id);
      const cls=vehClass(r), age=vehAgeMin(r);
      const col=cls==='moving'?'var(--green)':cls==='idle'?'#f59e0b':'var(--ink-faint)';
      h+='<div class="wf-row" data-vfly="'+esc(r.vehicle_id)+'">'
        +'<div style="flex:1"><div class="wf-t">'+esc(v?vehLabel(v):'машина')+'</div>'
        +'<div class="wf-s">'+esc(vehTitle(r))+'</div></div>'
        +'<span class="pill" style="color:'+col+';border-color:'+col+'">'+(age>VEH_STALE_MIN?'молчит':'на связи')+'</span></div>';
    });
  }

  const buckets=attentionBuckets(jobsLite,new Date());
  const dated=buckets.dated;
  if(dated.length){
    h+='<div class="wf-h">Требует внимания <span class="cnt">'+dated.length+'</span></div>';
    dated.slice(0,12).forEach(({job,u})=>{
      const col=urgHue(u);
      const badge=u.level==='overdue'?('−'+(-u.left)+' дн'):(u.left+' дн');
      // Подпись «без техники» стояла на пяти строках из семи — это отсутствие
      // сведений на месте, где могут быть дата и часы. Модель показываем,
      // когда она есть, и всегда — срок с трудоёмкостью.
      const hrs=(job.job_works||[]).reduce((a,w)=>a+(+w.hours||0),0);
      const sub=[dayLabel(job.due_date)];
      const mdl=(job.equipment&&job.equipment.model)||''; if(mdl) sub.push(mdl);
      if(hrs) sub.push(hrs.toFixed(hrs%1?1:0)+' ч');
      h+='<div class="wf-row" data-jfly="'+esc(job.client_id)+'" data-jid="'+esc(job.id)+'" style="border-left-color:'+col+'">'
        +'<div style="flex:1;min-width:0"><div class="wf-t">'+esc((job.clients&&job.clients.name)||'—')+'</div>'
        +'<div class="wf-s">'+esc(sub.join(' · '))+'</div></div>'
        +'<span class="pill" style="color:'+col+';border-color:'+col+'">'+esc(badge)+'</span></div>';
    });
  }
  if(buckets.cold.length){
    h+='<div class="wf-h" style="margin-top: var(--sp-5)">Без срока <span class="cnt">'+buckets.cold.length+'</span></div>';
    buckets.cold.slice(0,6).forEach(j=>{
      h+='<div class="wf-row" data-jfly="'+esc(j.client_id)+'" data-jid="'+esc(j.id)+'">'
        +'<div style="flex:1"><div class="wf-t">'+esc((j.clients&&j.clients.name)||'—')+'</div>'
        +'<div class="wf-s">'+esc((j.equipment&&j.equipment.model)||'без техники')+'</div></div></div>';
    });
  }

  if(!h) h='<div class="kempty">Живых заявок и машин в пути нет.<br>Переключись на «весь справочник», чтобы увидеть все точки.</div>';
  box.innerHTML=h;

  const fly=id=>{ const c=clients.find(x=>x.id==id); if(c){ map.flyTo([c.lat,c.lng],11); } };
  box.querySelectorAll('[data-jfly]').forEach(el=>el.onclick=()=>fly(el.dataset.jfly));
  box.querySelectorAll('[data-vfly]').forEach(el=>el.onclick=()=>{
    const r=(vehState||[]).find(x=>x.vehicle_id===el.dataset.vfly);
    if(r) map.flyTo([r.lat,r.lng],11); });
}

function renderList(){ const q=$('search').value.trim().toLowerCase(), box=$('list');
  const onlyAlert=alertOnly();
  const alerts=alertCount;

  // Самый давний визит по технике клиента: нет визита — «никогда»,
  // такие точки идут первыми.
  const oldestVisit={};
  clients.forEach(c=>{
    let ov=null;
    (eqByClient[c.id]||[]).forEach(e=>{ const v=e.last_visit||null;
      if(!v){ ov=''; return; }
      if(ov===null||(ov!==''&&v<ov)) ov=v; });
    oldestVisit[c.id]=(ov===null?'':ov);
  });

  const res=clients.filter(c=>{ if(pointFilter==='client'&&c.is_base) return false; if(pointFilter==='base'&&!c.is_base) return false; if(onlyAlert && !alerts[c.id]) return false; return !q||c.name.toLowerCase().includes(q); });

  // Порядок по делу, а не по времени заведения: сперва то, где что-то
  // требует внимания, потом давно не навещённые, потом по алфавиту.
  res.sort((x,y)=>{
    const d=(alerts[y.id]||0)-(alerts[x.id]||0); if(d) return d;
    const vx=oldestVisit[x.id], vy=oldestVisit[y.id];
    if(vx!==vy) return vx<vy?-1:1;               // пустая строка = никогда, идёт первой
    return x.name.localeCompare(y.name,'uk');
  });

  box.innerHTML=res.length?'':'<div class="kempty">'
    +(clients.length?'По запросу ничего не нашлось.':'Точек пока нет. Создай первую кнопкой выше.')+'</div>';
  res.slice(0,80).forEach(c=>{ const eqn=(eqByClient[c.id]||[]).length; const aln=alerts[c.id]||0; const d=document.createElement('div'); d.className='pt'; d.dataset.cid=c.id; d.onmouseenter=()=>hlMarker(c.id,true); d.onmouseleave=()=>hlMarker(c.id,false);
    // Три чипа в строке имени отбирали у него половину ширины, и длинное
    // украинское название ломалось на слоги. Имя теперь занимает строку
    // целиком, а «клиент / техники N / ⚠ N» сведены в одну строку меты:
    // тип точки и без того сказан цветом маркера.
    const tip=esc(c.name)+(c.description?(' · '+esc(String(c.description).replace(/\s+/g,' ').trim())):'')+' · '+(+c.lat).toFixed(5)+', '+(+c.lng).toFixed(5);
    const meta=[];
    meta.push(c.is_base?'депо':(eqn?(eqn+' '+plural(eqn,'единица','единицы','единиц')+' техники'):'без техники'));
    if(aln>0) meta.push(aln+' '+plural(aln,'заявка','заявки','заявок'));
    // Описание шло отдельной строкой и добавляло карточке третий этаж —
    // высоты разъезжались, и ровные промежутки читались как рваные.
    // Уходит в ту же строку меты, в одну строку с многоточием.
    if(c.description) meta.push(String(c.description).replace(/\s+/g,' ').trim());
    // Действия показываются только у выбранной точки: четыре кнопки под
    // каждой из восьмидесяти строк — это и есть та самая «духота».
    d.innerHTML='<div class="nm" title="'+tip+'"><span class="dot" style="background:'+esc(c.color||'#9aa1ad')+'"></span><span class="nm-t">'+esc(c.name)+'</span></div>'+
      '<div class="meta">'+esc(meta.join(' · '))+'</div>'+
      '<div class="acts">'+(canWrite()?'<button class="btn sm amber" data-rt="'+c.id+'">+ маршрут</button>':'')+(c.is_base?'':'<button class="btn sm" data-eq="'+c.id+'">техника</button>')+
      (canWrite()?'<button class="btn sm ghost" data-edit="'+c.id+'">ред.</button><button class="btn sm ghost" data-del="'+c.id+'" title="Удалить точку">×</button>':'')+'</div>';
    // Клик по карточке = выбрать её и показать на карте. Раньше «показать»
    // висело на самом имени и требовало отдельного объяснения подсказкой.
    d.onclick=(e)=>{ if(e.target.closest('button')) return;
      box.querySelectorAll('.pt.sel').forEach(x=>x.classList.remove('sel'));
      d.classList.add('sel');
      switchTab('map'); map.flyTo([c.lat,c.lng],14); };
    box.appendChild(d); });
  box.querySelectorAll('[data-rt]').forEach(b=>b.onclick=()=>{ const c=clients.find(x=>x.id==b.dataset.rt); if(!c) return; if(c.is_base) addBaseStop(c.id); else addClientToRoute(c.id); });
  box.querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>openEquip(b.dataset.eq));
  box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editClient(b.dataset.edit));
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delClient(b.dataset.del)); }
document.querySelectorAll('#mapScope button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#mapScope button').forEach(x=>x.classList.toggle('on',x===b));
  mapScope=b.dataset.ms;
  const t=$('sideTitle'); if(t) t.textContent=(mapScope==='work'?'В работе':'Точки');
  const c=$('cliCount');
  if(c) c.textContent=(mapScope==='work'
    ? String(clients.filter(x=>x.is_base||((clientStats[x.id]||{}).open>0)).length)
    : String(clients.length));
  renderMarkers(); renderSide();
});
document.querySelectorAll('#typeFilter button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('#typeFilter button').forEach(x=>x.classList.toggle('on',x===b)); pointFilter=b.dataset.tf; renderList(); });
if($('ptAlert')) $('ptAlert').onchange=()=>{ renderMarkers(); renderSide(); };
$('search').oninput=renderList;

// ---------- client add/edit ----------
$('addMode').onclick=()=>{ $('pointOverlay').classList.remove('on'); toggleAdd(true); };
if($('pointCreate')) $('pointCreate').onclick=()=>{ resetForm(); openPointModal(); };
function toggleAdd(on){ addModeOn=on; $('addMode').classList.toggle('active',on); $('modeTag').classList.toggle('on',on); $('addHint').style.display=on?'block':'none'; map.getContainer().style.cursor=on?'crosshair':''; }
function avoidBtnStyle(){ return 'cursor:pointer;font-family:var(--mono);font-size: var(--fs-1);border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius: var(--r-pill);padding: var(--sp-2) var(--sp-3)'; }
function renderAvoidZones(){ if(!avoidLayer) return; avoidLayer.clearLayers(); (appSettings.avoid_zones||[]).forEach(z=>{ const circ=L.circle([z.lat,z.lng],{radius:z.r||150,color:'#ef4444',fillColor:'#ef4444',fillOpacity:.12,weight:2,dashArray:'5 5'}); const bs=avoidBtnStyle(); let html='<strong>🚫 Объезд</strong> <span style="color:var(--ink-dim)">· '+(z.r||150)+' м</span>'; if(canWrite()) html+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3)"><button onclick="avoidRadius(\''+z.id+'\',-50)" style="'+bs+'">– радиус</button><button onclick="avoidRadius(\''+z.id+'\',50)" style="'+bs+'">+ радиус</button><button onclick="avoidDel(\''+z.id+'\')" style="'+bs+'">удалить</button></span>'; circ.bindPopup(html); avoidLayer.addLayer(circ); }); }
async function saveAvoidZones(){ try{ const {error}=await sb.from('settings').update({avoid_zones:appSettings.avoid_zones||[]}).eq('id',true); if(error) notify('Не удалось сохранить объезды: '+error.message,'err'); }catch(e){ notify('Не удалось сохранить объезды','err'); } }
function addAvoidZone(ll){ if(!canWrite()) return; appSettings.avoid_zones=appSettings.avoid_zones||[]; appSettings.avoid_zones.push({id:'az'+Date.now().toString(36),lat:ll.lat,lng:ll.lng,r:150}); saveAvoidZones(); renderAvoidZones(); if(avoidAreaKm2()>180) notify('Объездов много (суммарно ~'+avoidAreaKm2().toFixed(0)+' км²). Сервер ORS может отклонить запрос — уменьши радиусы.','warn'); else showToast('Объезд добавлен'); }
window.avoidRadius=function(id,delta){ if(!canWrite()) return; const z=(appSettings.avoid_zones||[]).find(x=>x.id===id); if(!z) return; z.r=Math.max(50,Math.min(3000,(z.r||150)+delta)); saveAvoidZones(); renderAvoidZones(); };
window.avoidDel=function(id){ if(!canWrite()) return; appSettings.avoid_zones=(appSettings.avoid_zones||[]).filter(x=>x.id!==id); saveAvoidZones(); renderAvoidZones(); map.closePopup(); };
function avoidPolygons(){ const zs=appSettings.avoid_zones||[]; if(!zs.length||typeof turf==='undefined') return null; const coords=[]; zs.forEach(z=>{ try{ const c=turf.circle([z.lng,z.lat],(z.r||150)/1000,{units:'kilometers',steps:20}); if(c&&c.geometry) coords.push(c.geometry.coordinates); }catch(e){} }); return coords.length?{type:'MultiPolygon',coordinates:coords}:null; }
function toggleAvoid(on){ avoidModeOn=on; const b=$('avoidMode'); if(b) b.checked=on; const h=$('avoidHint'); if(h) h.style.display=on?'block':'none'; if(on&&addModeOn) toggleAdd(false); if(on&&wpModeOn){ wpModeOn=false; const w=$('rWpMode'); if(w) w.classList.remove('active'); } map.getContainer().style.cursor=on?'crosshair':''; }
// Объезды переехали в меню слоёв и стали флажком: это режим карты,
// а не однократное действие, и флажок честнее кнопки.
if($('avoidMode')) $('avoidMode').onchange=()=>toggleAvoid($('avoidMode').checked);
if($('layersBtn')) $('layersBtn').onclick=(e)=>{ e.stopPropagation();
  const p=$('layersPop'); if(!p) return; const on=p.classList.toggle('on');
  $('layersBtn').classList.toggle('on',on); };
// Клик мимо закрывает меню. По самому меню — нет, иначе флажок внутри
// закрывал бы его при каждом переключении.
document.addEventListener('click',(e)=>{ const p=$('layersPop'); if(!p||!p.classList.contains('on')) return;
  if(p.contains(e.target)||e.target===$('layersBtn')) return;
  p.classList.remove('on'); const b=$('layersBtn'); if(b) b.classList.remove('on'); });
$('cancelBtn').onclick=()=>{ resetForm(); toggleAdd(false); $('pointOverlay').classList.remove('on'); };
function resetForm(){ $('fName').value='';$('fDesc').value='';$('fColor').value='#9aa1ad';$('fBase').checked=false;$('geoQuery').value='';$('geoResults').innerHTML='';$('formErr').textContent=''; pendingLatLng=null; if(pendingMarker){map.removeLayer(pendingMarker);pendingMarker=null;} }
$('saveBtn').onclick=async ()=>{ const name=$('fName').value.trim(); if(!name){ $('formErr').textContent='Введи название.'; return; } if(!pendingLatLng){ $('formErr').textContent='Задай точку на карте или по адресу.'; return; }
  $('saveBtn').disabled=true; const { error }=await sb.from('clients').insert({name,description:$('fDesc').value.trim(),color:$('fColor').value,lat:pendingLatLng.lat,lng:pendingLatLng.lng,is_base:$('fBase').checked}); $('saveBtn').disabled=false;
  if(error){ $('formErr').textContent='Ошибка: '+error.message; return; } const wasBase=$('fBase').checked; resetForm(); $('pointOverlay').classList.remove('on'); await loadAll(); showToast(wasBase?'Депо сохранено':'Точка сохранена'); };
window.editClient=function(id){ const c=clients.find(x=>x.id==id); if(!c||!canWrite()) return; editId=id; map.closePopup();
  $('eName').value=c.name; $('eDesc').value=c.description||''; $('eColor').value=c.color||'#9aa1ad'; $('eBase').checked=!!c.is_base; $('eLat').value=c.lat; $('eLng').value=c.lng; $('eProfile').innerHTML='<option value="">— не задан (по умолчанию платный) —</option>'+(appSettings.tariff_profiles||[]).map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join(''); $('eProfile').value=c.default_profile||''; $('eSigner').value=c.signer||''; $('editOverlay').classList.add('on'); };
$('eCancel').onclick=()=>$('editOverlay').classList.remove('on');
$('eSave').onclick=async ()=>{ const { error }=await sb.from('clients').update({name:$('eName').value.trim(),description:$('eDesc').value.trim(),color:$('eColor').value,is_base:$('eBase').checked,default_profile:($('eProfile').value||null),signer:($('eSigner').value.trim()||null),lat:parseFloat($('eLat').value),lng:parseFloat($('eLng').value)}).eq('id',editId);
  if(error){ notify('Ошибка: '+error.message,'err'); return; } $('editOverlay').classList.remove('on'); await loadAll(); showToast('Изменения сохранены'); };
async function delClient(id){ if(!await confirmDialog('Удалить точку вместе с её техникой и заявками? Их можно вернуть кнопкой «Отменить».',{danger:true,okText:'Удалить'})) return;
  const { data, error }=await sb.rpc('soft_delete_client',{p_id:id}); if(error){ notify('Ошибка: '+error.message,'err'); return; }
  await loadAll();
  undoToast('Точка удалена (с техникой и заявками)', async ()=>{ const {error:e2}=await sb.rpc('restore_deleted',{p_ts:data}); if(e2){ notify(e2.message,'err'); return; } await loadAll(); showToast('Восстановлено'); }); }

// ---------- equipment ----------
window.openEquip=function(clientId){ eqClientId=clientId; eqEditId=null; const c=clients.find(x=>x.id==clientId); map.closePopup();
  $('eqTitle').textContent='Техника · '+(c?c.name:''); populateEqModelSelect(); clearEqForm(); renderEqList(); $('eqOverlay').classList.add('on'); };
$('eqClose').onclick=()=>$('eqOverlay').classList.remove('on');
function fmtDate(d){ return d?d:''; }
function warrantyBadge(e){ if(!e.factory_warranty_until) return ''; const today=todayISO();
  return e.factory_warranty_until>=today?'<span class="pill good">гар. до '+esc(e.factory_warranty_until)+'</span>':'<span class="pill warn">гар. истекла '+esc(e.factory_warranty_until)+'</span>'; }
function mhLine(e){ const rs=readingsByEq[e.id]||[]; const sv=eqService(e);
  if(!rs.length&&!sv) return '<div class="m" style="color:var(--ink-faint)">моточасы не заведены — «+ замер»</div>';
  const bits=[]; const last=rs.length?rs[rs.length-1]:null;
  if(last) bits.push('счётчик '+Math.round(+last.moto_hours)+' мч ('+last.taken_on+')');
  if(sv&&sv.rate>0){ bits.push('темп '+sv.rate.toFixed(1)+' мч/сут'+(sv.src==='client'?' (по клиенту)':''));
    if(sv.daysLeft!=null){ const late=sv.daysLeft<=0; bits.push('<span style="color:'+(late?'var(--red)':(sv.daysLeft<=14?'var(--accent-ink)':'inherit'))+'">'+(late?('ТО просрочено на ~'+Math.abs(sv.daysLeft)+' дн'):('до ТО ~'+sv.daysLeft+' дн'))+'</span>'); } }
  else if(sv) bits.push('темп не измерен (нужно 2 замера) — грубая оценка');
  else if(rs.length<2) bits.push('нужен ещё замер для темпа');
  return '<div class="m">'+bits.join(' · ')+'</div>'; }
async function addReading(eqId,kind){ const e=(eqByClient[eqClientId]||[]).find(x=>x.id===eqId); if(!e) return;
  const rs=readingsByEq[eqId]||[]; const last=rs.length?rs[rs.length-1]:null;
  const r=await promptDialog(kind==='service'?'Плановое ТО — показания счётчика':'Замер моточасов',[
    {key:'mh',label:'Моточасы по счётчику'+(last?(' (прошлый замер: '+Math.round(+last.moto_hours)+' мч от '+last.taken_on+')'):''),value:''},
    {key:'d',label:'Дата',value:todayISO()}]);
  if(!r) return; const mh=parseFloat(String(r.mh).replace(',','.')); if(isNaN(mh)||mh<0){ notify('Введи моточасы числом.','err'); return; }
  if(last&&mh<(+last.moto_hours)&&!(await confirmDialog('Показание '+Math.round(mh)+' мч меньше прошлого ('+Math.round(+last.moto_hours)+' мч). Счётчик меняли или это опечатка?',{okText:'Всё верно'}))) return;
  const rec={equipment_id:eqId,taken_on:(r.d||todayISO()),moto_hours:mh,kind:kind};
  const {error}=await sb.from('equipment_readings').upsert(rec,{onConflict:'equipment_id,taken_on'});
  if(error){ notify('Ошибка: '+error.message,'err'); return; }
  if(kind==='service'){ await sb.from('equipment').update({last_service:rec.taken_on,last_visit:rec.taken_on}).eq('id',eqId); }
  await loadReadings(); await reloadEquip(); const sv=eqService(e);
  showToast(kind==='service'?('ТО отмечено'+(sv&&sv.daysLeft!=null?(' · следующее через ~'+sv.daysLeft+' дн'):'')):'Замер записан'); }
function renderEqList(){ const box=$('eqList'); const list=eqByClient[eqClientId]||[];
  box.innerHTML=list.length?'':'<div class="hint">Техники пока нет.</div>';
  list.forEach(e=>{ const d=document.createElement('div'); d.className='eqitem';
    d.innerHTML='<div class="t">'+esc(e.model)+' '+warrantyBadge(e)+'</div><div class="m">'+[e.kind,e.serial?'S/N '+esc(e.serial):'',e.installed_on?'уст. '+esc(e.installed_on):''].filter(Boolean).join(' · ')+'</div>'+
      (e.notes?'<div class="m">'+esc(e.notes)+'</div>':'')+
      mhLine(e)+
      '<div class="acts" style="margin-top: var(--sp-3);display:flex;gap: var(--sp-3);flex-wrap:wrap"><button class="btn sm" data-mhr="'+e.id+'">+ замер</button><button class="btn sm amber" data-mhs="'+e.id+'">✔ плановое ТО</button>'+
      (canWrite()?'<button class="btn sm" data-eqedit="'+e.id+'">ред.</button><button class="btn sm ghost" data-eqdel="'+e.id+'" title="Удалить">×</button>':'')+'</div>';
    box.appendChild(d); });
  box.querySelectorAll('[data-mhr]').forEach(b=>b.onclick=()=>addReading(b.dataset.mhr,'reading'));
  box.querySelectorAll('[data-mhs]').forEach(b=>b.onclick=()=>addReading(b.dataset.mhs,'service'));
  box.querySelectorAll('[data-eqedit]').forEach(b=>b.onclick=()=>startEqEdit(b.dataset.eqedit));
  box.querySelectorAll('[data-eqdel]').forEach(b=>b.onclick=()=>delEq(b.dataset.eqdel)); }
function clearEqForm(){ eqEditId=null; $('eqModel').value='';$('eqKind').value='';$('eqSerial').value='';$('eqInstalled').value='';$('eqWarranty').value='';$('eqNotes').value='';$('eqLat').value='';$('eqLng').value='';$('eqGeo').value='';$('eqGeoRes').innerHTML='';$('eqErr').textContent=''; if($('eqModelId')) $('eqModelId').value=''; $('eqFormTitle').textContent='Добавить технику'; $('eqFormCancel').style.display='none'; }
function startEqEdit(id){ const e=(eqByClient[eqClientId]||[]).find(x=>x.id==id); if(!e) return; eqEditId=id;
  $('eqModel').value=e.model||'';$('eqKind').value=e.kind||'';$('eqSerial').value=e.serial||'';$('eqInstalled').value=e.installed_on||'';$('eqWarranty').value=e.factory_warranty_until||'';$('eqNotes').value=e.notes||'';$('eqLat').value=e.lat!=null?e.lat:'';$('eqLng').value=e.lng!=null?e.lng:'';$('eqGeo').value='';$('eqGeoRes').innerHTML=''; if($('eqModelId')) $('eqModelId').value=e.model_id||'';
  $('eqFormTitle').textContent='Правка техники'; $('eqFormCancel').style.display=''; }
$('eqFormCancel').onclick=clearEqForm; if($('eqModelId')) $('eqModelId').onchange=applyEqModel;
$('eqGeoBtn').onclick=async ()=>{ const q=$('eqGeo').value.trim(); const box=$('eqGeoRes'); if(!q){ box.innerHTML=''; return; } box.innerHTML='<div class="hint">Ищу…</div>';
  try{ const data=await geoSearch(q,5); if(!data.length){ box.innerHTML='<div class="hint">Не найдено.</div>'; return; } box.innerHTML='';
    data.forEach(it=>{ const d=document.createElement('div'); d.className='pt'; d.style.cursor='pointer'; d.innerHTML='<div class="nm" style="font-size: var(--fs-3);font-weight:500">'+esc(it.display_name)+'</div>';
      d.onclick=()=>{ $('eqLat').value=(+it.lat).toFixed(6); $('eqLng').value=(+it.lon).toFixed(6); box.innerHTML='<div class="hint ok">Координаты заданы.</div>'; }; box.appendChild(d); }); }catch(e){ box.innerHTML='<div class="err">'+esc(e.message||'Ошибка геокодера.')+'</div>'; } };
$('eqSave').onclick=async ()=>{ const model=$('eqModel').value.trim(); if(!model){ $('eqErr').textContent='Введи модель.'; return; }
  const rec={client_id:eqClientId,model,kind:$('eqKind').value.trim(),serial:$('eqSerial').value.trim(),installed_on:$('eqInstalled').value||null,factory_warranty_until:$('eqWarranty').value||null,notes:$('eqNotes').value.trim(),model_id:$('eqModelId').value||null,lat:parseFloat($('eqLat').value)||null,lng:parseFloat($('eqLng').value)||null};
  $('eqSave').disabled=true; let error; if(eqEditId){ ({error}=await sb.from('equipment').update(rec).eq('id',eqEditId)); } else { ({error}=await sb.from('equipment').insert(rec)); } $('eqSave').disabled=false;
  if(error){ $('eqErr').textContent='Ошибка: '+error.message; return; } await reloadEquip(); clearEqForm(); };
async function delEq(id){ if(!await confirmDialog('Удалить технику?',{danger:true,okText:'Удалить'})) return; const { error }=await sb.from('equipment').update({deleted_at:new Date().toISOString()}).eq('id',id); if(error){ notify('Ошибка: '+error.message,'err'); return; } await reloadEquip();
  undoToast('Техника удалена', async ()=>{ const {error:e2}=await sb.from('equipment').update({deleted_at:null}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await reloadEquip(); showToast('Восстановлено'); }); }
async function reloadEquip(){ const { data }=await sb.from('equipment').select('*').is('deleted_at',null).order('created_at'); eqByClient={}; (data||[]).forEach(e=>{ (eqByClient[e.client_id]=eqByClient[e.client_id]||[]).push(e); }); await loadReadings(); renderEqList(); render(); }

async function loadEqModels(){ try{ const {data}=await sb.from('equipment_models').select('*').order('manufacturer'); eqModels=data||[]; populateEqModelSelect(); }catch(e){ loadFail('модели техники',e); } }
function emLabel(m){ return ((m.manufacturer?m.manufacturer+' ':'')+m.model).trim(); }
function populateEqModelSelect(){ const sel=$('eqModelId'); if(!sel) return; const cur=sel.value; sel.innerHTML='<option value="">— без модели из каталога —</option>'+eqModels.map(m=>'<option value="'+m.id+'">'+esc(emLabel(m))+'</option>').join(''); sel.value=cur; }
function renderEqModels(){ const box=$('emList'); if(!box) return; const q=$('emSearch')?$('emSearch').value.trim().toLowerCase():'';
  const manus=[...new Set(eqModels.map(m=>m.manufacturer).filter(Boolean))].sort();
  const kinds=[...new Set(eqModels.map(m=>m.kind).filter(Boolean))].sort();
  if($('emManuList')) $('emManuList').innerHTML=manus.map(x=>'<option value="'+esc(x)+'">').join('');
  if($('emKindList')) $('emKindList').innerHTML=kinds.map(x=>'<option value="'+esc(x)+'">').join('');
  const list=eqModels.filter(m=>!q||emLabel(m).toLowerCase().includes(q)||(m.kind||'').toLowerCase().includes(q));
  if(!list.length){
    box.innerHTML=eqModels.length
      ? '<div class="kempty">По запросу ничего не нашлось.</div>'
      : '<div class="kempty">Моделей нет.<br>Модель задаёт срок гарантии и интервал ТО — по ним техника попадает в «требующие внимания».<br><br>Начни с кнопки «+ Модель».</div>';
    return; }
  const tree={}; list.forEach(m=>{ const mn=m.manufacturer||'Без производителя'; const kn=m.kind||'Без типа'; tree[mn]=tree[mn]||{}; tree[mn][kn]=tree[mn][kn]||[]; tree[mn][kn].push(m); });
  let h=''; Object.keys(tree).sort().forEach(mn=>{ h+='<div class="emtree-manu"><div class="emtree-h" data-emg="'+esc(mn)+'">▾ '+esc(mn)+'</div><div class="emtree-body">';
    Object.keys(tree[mn]).sort().forEach(kn=>{ h+='<div class="emtree-kind"><div class="emtree-kh">'+esc(kn)+'</div>';
      tree[mn][kn].sort((a,b)=>(a.model||'').localeCompare(b.model||'')).forEach(m=>{ h+='<div class="emrow"><span class="emname">'+esc(m.model)+'</span><span class="emmeta">'+(m.warranty_months?(m.warranty_months+' мес'):'—')+((+m.service_interval_hours>0)?(' · '+Math.round(m.service_interval_hours)+' мч'):'')+'</span><button class="btn sm" data-emedit="'+m.id+'">ред.</button><button class="btn sm ghost" data-emdel="'+m.id+'" title="Удалить">×</button></div>'; });
      h+='</div>'; });
    h+='</div></div>'; });
  box.innerHTML=h;
  box.querySelectorAll('[data-emg]').forEach(hd=>hd.onclick=()=>{ const b=hd.nextElementSibling; const open=b.style.display!=='none'; b.style.display=open?'none':''; hd.textContent=(open?'▸ ':'▾ ')+hd.dataset.emg; });
  box.querySelectorAll('[data-emedit]').forEach(b=>b.onclick=()=>editEqModel(b.dataset.emedit));
  box.querySelectorAll('[data-emdel]').forEach(b=>b.onclick=()=>delEqModel(b.dataset.emdel)); }
function emReset(){ emEditId=null; $('emManu').value='';$('emKind').value='';$('emModel').value='';$('emWarr').value='';$('emInt').value='';$('emNotes').value='';$('emErr').textContent=''; $('emFormTitle').textContent='Добавить модель'; }
$('emShowAdd').onclick=()=>{ emReset(); $('emForm').style.display=''; $('emManu').focus(); };
$('emSave').onclick=async ()=>{ const model=$('emModel').value.trim(); if(!model){ $('emErr').textContent='Введи модель.'; return; } const rec={manufacturer:$('emManu').value.trim(),kind:$('emKind').value.trim(),model,warranty_months:parseInt($('emWarr').value)||0,service_interval_hours:+$('emInt').value||0,notes:$('emNotes').value.trim()};
  let error; if(emEditId){ ({error}=await sb.from('equipment_models').update(rec).eq('id',emEditId)); } else { ({error}=await sb.from('equipment_models').insert(rec)); }
  if(error){ $('emErr').textContent=error.message; return; } emReset(); $('emForm').style.display='none'; await loadEqModels(); renderEqModels(); showToast('Модель сохранена'); };
$('emCancel').onclick=()=>{ emReset(); $('emForm').style.display='none'; }; if($('emSearch')) $('emSearch').oninput=renderEqModels;
function editEqModel(id){ const m=eqModels.find(x=>x.id==id); if(!m) return; emEditId=id; $('emManu').value=m.manufacturer||'';$('emKind').value=m.kind||'';$('emModel').value=m.model||'';$('emWarr').value=m.warranty_months||'';$('emInt').value=m.service_interval_hours||'';$('emNotes').value=m.notes||''; $('emFormTitle').textContent='Правка модели'; $('emForm').style.display=''; }
async function delEqModel(id){ if(!await confirmDialog('Удалить модель из каталога?',{danger:true,okText:'Удалить'})) return; const {error}=await sb.from('equipment_models').delete().eq('id',id); if(error){ notify(error.message,'err'); return; } await loadEqModels(); renderEqModels(); }
function applyEqModel(){ const m=eqModels.find(x=>x.id==$('eqModelId').value); if(!m) return; if(!$('eqModel').value.trim()) $('eqModel').value=emLabel(m); const inst=$('eqInstalled').value; if(inst && (+m.warranty_months>0) && !$('eqWarranty').value){ const d=new Date(inst); d.setMonth(d.getMonth()+(+m.warranty_months)); if(!isNaN(d)) $('eqWarranty').value=d.toISOString().slice(0,10); } }
// ---------- catalog ----------
function parseMaterials(txt){ return txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const [name,qty,unit]=l.split(';').map(s=>(s||'').trim()); return {name:name||'',qty:parseFloat(qty)||0,unit:unit||''}; }); }
function fmtMaterials(arr){ return (arr||[]).map(m=>[m.name,m.qty,m.unit].join(';')).join('\n'); }
function parseManuals(txt){ return txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const [name,url]=l.split('|').map(s=>(s||'').trim()); return {name:name||url||'',url:url||name||''}; }); }
function fmtManuals(arr){ return (arr||[]).map(m=>[m.name,m.url].join('|')).join('\n'); }
async function loadCatalog(){ const { data, error }=await sb.from('work_catalog').select('*').order('name'); if(!error) catalog=data||[]; }
$('catSearch').oninput=renderCatalog; if($('catFilter')) $('catFilter').onchange=renderCatalog;
let cwScope='all', cwModelSel=new Set();
function workModelNames(w){ return ((w&&w.model_ids)||[]).map(id=>{ const m=eqModels.find(x=>x.id===id); return m?emLabel(m):null; }).filter(Boolean); }
function setCwScope(s){ cwScope=s; document.querySelectorAll('#cwScope [data-cs]').forEach(b=>b.classList.toggle('on',b.dataset.cs===s)); $('cwKindsBox').style.display=(s==='kinds')?'':'none'; $('cwModelsBox').style.display=(s==='models')?'':'none'; if(s==='models') renderCwModelsTree(); }
function renderCwModelsTree(){ const box=$('cwModelsTree'); if(!box) return; if(!eqModels.length){ box.innerHTML='<div class="hint">Сначала заведи модели в каталоге моделей.</div>'; return; }
  const tree={}; eqModels.forEach(m=>{ const mn=m.manufacturer||'Без производителя'; const kn=m.kind||'Без типа'; tree[mn]=tree[mn]||{}; tree[mn][kn]=tree[mn][kn]||[]; tree[mn][kn].push(m); });
  let h=''; Object.keys(tree).sort().forEach(mn=>{ h+='<div style="font-weight:600;font-size: var(--fs-3);margin-top: var(--sp-3)">'+esc(mn)+'</div>'; Object.keys(tree[mn]).sort().forEach(kn=>{ h+='<div style="font-family:var(--mono);font-size: var(--fs-1);letter-spacing:.5px;text-transform:uppercase;color:var(--ink-faint);margin: var(--sp-2) 0 var(--sp-1) var(--sp-3)">'+esc(kn)+'</div>'; tree[mn][kn].forEach(m=>{ h+='<label style="display:flex;align-items:center;gap: var(--sp-3);cursor:pointer;font-size: var(--fs-3);padding: var(--sp-1) 0 var(--sp-1) var(--sp-5)"><input type="checkbox" data-cwm="'+m.id+'" '+(cwModelSel.has(m.id)?'checked':'')+' style="width:auto">'+esc(m.model)+'</label>'; }); }); });
  box.innerHTML=h; box.querySelectorAll('[data-cwm]').forEach(c=>c.onchange=()=>{ if(c.checked) cwModelSel.add(c.dataset.cwm); else cwModelSel.delete(c.dataset.cwm); }); }
document.querySelectorAll('#cwScope [data-cs]').forEach(b=>b.onclick=()=>setCwScope(b.dataset.cs));
function catGrp(title,inner){ return '<div class="emtree-manu"><div class="emtree-h" data-emg="'+esc(title)+'">▾ '+esc(title)+'</div><div class="emtree-body">'+inner+'</div></div>'; }
function workRow(w){ const estR=((+w.norm_hours||0)*((appSettings.tariffs&&appSettings.tariffs.hour)||0)); return '<div class="emrow"><span class="emname">'+esc(w.name)+' · '+(+w.norm_hours||0)+'ч'+(w.warranty_eligible?'':' · платно')+'</span><span class="emmeta">'+(w.price?('оверр. '+(+w.price)):('≈'+estR.toFixed(0)))+'</span><button class="btn sm" data-cwedit="'+w.id+'">ред.</button><button class="btn sm ghost" data-cwdel="'+w.id+'" title="Удалить">×</button></div>'; }
async function renderCatalog(){ if(!catalog.length) await loadCatalog(); if(!eqModels.length) await loadEqModels(); const q=$('catSearch').value.trim().toLowerCase(); const fil=$('catFilter')?$('catFilter').value:''; const box=$('catList');
  const res=catalog.filter(w=>{ const mn=workModelNames(w); const hay=(w.name+' '+((w.applicable_kinds||[]).join(' '))+' '+mn.join(' ')).toLowerCase(); if(q&&!hay.includes(q)) return false; if(fil==='warranty'&&!w.warranty_eligible) return false; if(fil==='paid'&&w.warranty_eligible) return false; if(fil==='maint'&&!w.is_maintenance) return false; return true; });
  if(!res.length){
    // Пустое состояние объясняет, зачем раздел нужен, а не просто сообщает
    // об отсутствии строк. Нормированная работа — это то, из чего потом
    // собирается заявка и считается выручка.
    box.innerHTML=catalog.length
      ? '<div class="kempty">По запросу ничего не нашлось.<br>Измени фильтр или строку поиска.</div>'
      : '<div class="kempty">Каталог пуст.<br>Нормированная работа задаёт часы и цену — из них собирается заявка и считается выручка.<br><br>Начни с кнопки «+ Работа» вверху.</div>';
    return; }
  const general=res.filter(w=>!(w.model_ids&&w.model_ids.length)&&!(w.applicable_kinds&&w.applicable_kinds.length));
  const byKind=res.filter(w=>!(w.model_ids&&w.model_ids.length)&&(w.applicable_kinds&&w.applicable_kinds.length));
  const byModel=res.filter(w=>w.model_ids&&w.model_ids.length);
  let h='';
  if(general.length) h+=catGrp('Общий набор ('+general.length+')', general.map(workRow).join(''));
  if(byKind.length){ const kinds={}; byKind.forEach(w=>(w.applicable_kinds||[]).forEach(k=>{ (kinds[k]=kinds[k]||[]).push(w); })); let inner=''; Object.keys(kinds).sort().forEach(k=>{ inner+='<div class="emtree-kind"><div class="emtree-kh">'+esc(k)+'</div>'+kinds[k].map(workRow).join('')+'</div>'; }); h+=catGrp('По типам', inner); }
  if(byModel.length){ const tree={}; byModel.forEach(w=>(w.model_ids||[]).forEach(id=>{ const m=eqModels.find(x=>x.id===id); if(!m) return; const mn=m.manufacturer||'Без производителя', kn=m.kind||'Без типа', ml=m.model||'—'; tree[mn]=tree[mn]||{}; tree[mn][kn]=tree[mn][kn]||{}; (tree[mn][kn][ml]=tree[mn][kn][ml]||[]).push(w); }));
    let inner=''; Object.keys(tree).sort().forEach(mn=>{ inner+='<div style="font-weight:600;font-size: var(--fs-3);margin-top: var(--sp-3)">'+esc(mn)+'</div>'; Object.keys(tree[mn]).sort().forEach(kn=>{ inner+='<div class="emtree-kh">'+esc(kn)+'</div>'; Object.keys(tree[mn][kn]).sort().forEach(ml=>{ inner+='<div style="font-size: var(--fs-2);color:var(--ink-dim);margin: var(--sp-1) 0 var(--sp-1) var(--sp-3)">'+esc(ml)+'</div>'+tree[mn][kn][ml].map(workRow).join(''); }); }); }); h+=catGrp('По моделям', inner); }
  box.innerHTML=h;
  box.querySelectorAll('[data-emg]').forEach(hd=>hd.onclick=()=>{ const b=hd.nextElementSibling; const open=b.style.display!=='none'; b.style.display=open?'none':''; hd.textContent=(open?'▸ ':'▾ ')+hd.dataset.emg; });
  box.querySelectorAll('[data-cwedit]').forEach(b=>b.onclick=()=>openCw(b.dataset.cwedit));
  box.querySelectorAll('[data-cwdel]').forEach(b=>b.onclick=()=>delCw(b.dataset.cwdel)); }
$('catAdd').onclick=()=>openCw(null);
function openCw(id){ cwEditId=id; const w=id?catalog.find(x=>x.id==id):null;
  $('catFormTitle').textContent=id?'Правка работы':'Новая работа';
  $('cwName').value=w?w.name:''; $('cwHours').value=w?w.norm_hours:''; $('cwPrice').value=w?w.price:''; $('cwWarranty').checked=w?!!w.warranty_eligible:true; $('cwMaint').checked=w?!!w.is_maintenance:false;
  $('cwKinds').value=w&&w.applicable_kinds?w.applicable_kinds.join(', '):''; $('cwMaterials').value=w?fmtMaterials(w.materials):''; $('cwProc').value=w?w.procedure||'':''; $('cwManuals').value=w?fmtManuals(w.manuals):''; $('cwErr').textContent='';
  cwModelSel=new Set((w&&w.model_ids)?w.model_ids:[]); setCwScope((w&&w.model_ids&&w.model_ids.length)?'models':((w&&w.applicable_kinds&&w.applicable_kinds.length)?'kinds':'all'));
  $('catOverlay').classList.add('on'); }
$('cwCancel').onclick=()=>$('catOverlay').classList.remove('on');
$('cwSave').onclick=async ()=>{ const name=$('cwName').value.trim(); if(!name){ $('cwErr').textContent='Введи название.'; return; }
  const rec={name,norm_hours:parseFloat($('cwHours').value)||0,price:parseFloat($('cwPrice').value)||0,warranty_eligible:$('cwWarranty').checked,is_maintenance:$('cwMaint').checked,
    applicable_kinds:(cwScope==='kinds'?$('cwKinds').value.split(',').map(s=>s.trim()).filter(Boolean):[]),model_ids:(cwScope==='models'?[...cwModelSel]:[]),materials:parseMaterials($('cwMaterials').value),procedure:$('cwProc').value.trim(),manuals:parseManuals($('cwManuals').value)};
  $('cwSave').disabled=true; let error; if(cwEditId){ ({error}=await sb.from('work_catalog').update(rec).eq('id',cwEditId)); } else { ({error}=await sb.from('work_catalog').insert(rec)); } $('cwSave').disabled=false;
  if(error){ $('cwErr').textContent='Ошибка: '+error.message; return; } $('catOverlay').classList.remove('on'); catalog=[]; await renderCatalog(); };
async function delCw(id){ if(!await confirmDialog('Удалить работу из каталога?',{danger:true,okText:'Удалить'})) return; const { error }=await sb.from('work_catalog').delete().eq('id',id); if(error){ notify('Ошибка: '+error.message,'err'); return; } catalog=[]; await renderCatalog(); }

// ---------- geocode ----------
// Nominatim просит не чаще одного запроса в секунду и не любит очередей.
// Четыре места в приложении ходили туда каждое само по себе, без пауз и
// без проверки r.ok: при отказе r.json() падал, и любая причина — от опечатки
// до бана по IP — выглядела одинаковым «Ошибка геокодера».
//
// Здесь одна очередь на всё приложение: запросы идут по одному, с паузой,
// и отказы получают внятный текст.
const NOMINATIM_GAP_MS = 1100;
let _geoChain = Promise.resolve(), _geoLast = 0;
function geoSearch(q, limit){
  const run = async () => {
    const wait = NOMINATIM_GAP_MS - (Date.now() - _geoLast);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _geoLast = Date.now();
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' + (limit || 5)
      + '&accept-language=uk,ru,en&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.status === 429) throw new Error('Геокодер временно ограничил доступ (слишком часто). Подожди минуту.');
    if (!r.ok) throw new Error('Геокодер ответил ошибкой ' + r.status + '.');
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  };
  // Цепочка, а не параллель: две подсказки одновременно — уже нарушение.
  _geoChain = _geoChain.then(run, run);
  return _geoChain;
}
$('geoBtn').onclick=geocode; $('geoQuery').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); geocode(); } });
async function geocode(){ const q=$('geoQuery').value.trim(); const box=$('geoResults'); if(!q){ box.innerHTML=''; return; } box.innerHTML='<div class="hint">Ищу…</div>';
  try{ const data=await geoSearch(q,6);
    if(!data.length){ box.innerHTML='<div class="hint">Ничего не найдено.</div>'; return; } box.innerHTML='';
    data.forEach(it=>{ const d=document.createElement('div'); d.className='pt'; d.style.cursor='pointer'; d.innerHTML='<div class="nm" style="font-size: var(--fs-3);font-weight:500">'+esc(it.display_name)+'</div>';
      d.onclick=()=>{ pendingLatLng={lat:parseFloat(it.lat),lng:parseFloat(it.lon)}; flashPending(); map.flyTo([pendingLatLng.lat,pendingLatLng.lng],14); if(!$('fName').value.trim()) $('fName').value=it.display_name.split(',')[0]; box.innerHTML=''; updatePointCoords(); $('fName').focus(); }; box.appendChild(d); });
  }catch(err){ box.innerHTML='<div class="err">'+esc(err.message||'Ошибка геокодера.')+'</div>'; } }

// ---------- jobs ----------
let jobs=[], profilesList=[], curWorks=[], jobEditId=null;
async function ensureRefs(){ if(!catalog.length) await loadCatalog(); if(!profilesList.length){ const {data}=await sb.from('profiles').select('id,full_name,role'); profilesList=data||[]; } }
const ST={open:'открыта',planned:'запланирована',in_progress:'в работе',done:'закрыта',cancelled:'отменена'};
const JOB_STATUS_ORDER=['open','planned','in_progress','done','cancelled'];
let jobVisible={open:true,planned:true,in_progress:true,done:false,cancelled:false};
function renderJobChips(){ const box=$('jobStatusChips'); if(!box) return; box.innerHTML=JOB_STATUS_ORDER.map(s=>'<span class="chip'+(jobVisible[s]?' on':'')+'" data-js="'+s+'">'+esc(ST[s])+'</span>').join('');
  box.querySelectorAll('[data-js]').forEach(c=>c.onclick=()=>{ jobVisible[c.dataset.js]=!jobVisible[c.dataset.js]; renderJobChips(); renderJobs(); }); }
function jobCard(j){ const w=j.job_works||[]; const hours=w.reduce((a,x)=>a+(+x.hours||0),0); const rev=w.reduce((a,x)=>a+(+x.revenue||0),0);   // и платные, и гарантийные
  const warr=w.some(x=>!x.billable), paid=w.some(x=>x.billable); const eng=profilesList.find(p=>p.id===j.assigned_engineer);
  const head='<h4>'+esc(j.clients?j.clients.name:'—')+'</h4>'+(j.equipment?'<div class="meta">'+esc(j.equipment.model||'')+'</div>':'');
  const tags=(warr?'<span class="pill warn">гар.</span>':'')+(paid?'<span class="pill good">платно</span>':'');
  const meta='<div class="meta">'+(j.scheduled_date?'визит '+esc(j.scheduled_date)+' · ':'')+(j.due_date?'SLA '+esc(j.due_date)+' · ':'')+w.length+' раб · '+hours.toFixed(1)+' ч'+(rev?' · выручка '+rev:'')+(eng?' · '+esc(eng.full_name||'инж.'):'')+'</div>';
  const mv=canWrite()?('<select class="kmove" data-jstat="'+j.id+'" title="Сменить статус">'+JOB_STATUS_ORDER.map(s=>'<option value="'+s+'"'+(s===j.status?' selected':'')+'>'+esc(ST[s])+'</option>').join('')+'</select>'):'';
  const eb=(j.assigned_engineer===session.user.id&&(j.status==='open'||j.status==='planned'))?'<button class="btn sm amber" data-jst="'+j.id+'|in_progress">В работу</button>':'';
  const eb2=(j.assigned_engineer===session.user.id&&j.status==='in_progress')?'<button class="btn sm amber" data-jst="'+j.id+'|done">Завершить</button>':'';
  const acts='<div class="acts">'+mv+eb+eb2+'<button class="btn sm" data-jedit="'+j.id+'">открыть</button>'+((canWrite()&&j.status==='done')?'<button class="btn sm" data-jact="'+j.id+'" title="Акт">📄</button>':'')+(canWrite()?'<button class="btn sm ghost" data-jdel="'+j.id+'" title="Удалить заявку">×</button>':'')+'</div>';
  return '<div class="kcard" data-kid="'+j.id+'">'+head+(tags?'<div style="margin: var(--sp-1) 0">'+tags+'</div>':'')+meta+acts+'</div>'; }
function wireJobCards(box){
  box.querySelectorAll('[data-jedit]').forEach(b=>b.onclick=()=>openJob(b.dataset.jedit));
  box.querySelectorAll('[data-jst]').forEach(b=>b.onclick=()=>{ const a=b.dataset.jst.split('|'); jobSetStatus(a[0],a[1]); });
  box.querySelectorAll('[data-jdel]').forEach(b=>b.onclick=()=>delJob(b.dataset.jdel));
  box.querySelectorAll('[data-jact]').forEach(b=>b.onclick=()=>openAct(b.dataset.jact));
  box.querySelectorAll('[data-jstat]').forEach(sel=>sel.onchange=()=>jobSetStatus(sel.dataset.jstat, sel.value)); }
async function renderJobs(){ await ensureRefs(); renderJobChips();
  const { data, error }=await sb.from('jobs').select('*, clients(name), equipment(model,kind), job_works(*)').is('deleted_at',null).order('created_at',{ascending:false});
  const box=$('jobList'); if(error){ box.className=''; box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  jobs=data||[]; const q=$('jobSearch').value.trim().toLowerCase();
  if($('jobEngFilter') && $('jobEngFilter').dataset.filled!=='1'){ $('jobEngFilter').innerHTML='<option value="">все инженеры</option>'+profilesList.filter(p=>p.role==='engineer').map(p=>'<option value="'+p.id+'">'+esc(p.full_name||'инженер')+'</option>').join(''); $('jobEngFilter').dataset.filled='1'; }
  const ef=$('jobEngFilter')?$('jobEngFilter').value:'';
  const baseJobs=(role==='engineer')?jobs.filter(j=>j.assigned_engineer===session.user.id):jobs;
  const match=j=>(!ef||j.assigned_engineer===ef)&&(!q||((j.clients&&j.clients.name)||'').toLowerCase().includes(q));
  const cols=JOB_STATUS_ORDER.filter(s=>jobVisible[s]);
  if(!cols.length){ box.className=''; box.innerHTML='<div class="hint">Выберите хотя бы один статус выше.</div>'; return; }
  const pool=baseJobs.filter(match);
  if(!pool.length){ box.className=''; box.innerHTML='<div class="hint">Заявок нет. Создай первую.</div>'; return; }
  box.className='kanban';
  box.innerHTML=cols.map(s=>{ const items=pool.filter(j=>j.status===s);
    // Тире — это не пустое состояние, это отсутствие ответа. Строка о том,
    // что здесь появится, полезнее: она объясняет колонку, а не молчит.
    const EMPTY={open:'Новые заявки появятся здесь',planned:'Ничего не запланировано',
      in_progress:'Никто не в работе',done:'Закрытых пока нет',cancelled:'Отменённых нет'};
    const cards=items.map(j=>jobCard(j)).join('')
      ||'<div class="kempty">'+esc(EMPTY[s]||'Пусто')+'</div>';
    return '<div class="kcol" data-kst="'+s+'"><div class="kcol-h"><span>'+esc(ST[s])+'</span><span class="cnt">'+items.length+'</span></div><div class="kcol-b">'+cards+'</div></div>'; }).join('');
  wireJobCards(box); wireKanbanDrag(box,dropJob); }
$('jobSearch').oninput=renderJobs; if($('jobEngFilter')) $('jobEngFilter').onchange=renderJobs; if($('mineDone')) $('mineDone').onchange=renderMine; $('jobAdd').onclick=()=>{ if(canWrite()) openJob(null); };
// ── Лента внимания ──────────────────────────────────────────────────────────
// Плоский список одинаковых строк не выглядит отсортированным: цвет полоски
// у всех один, а приоритет закодирован числом, которое надо читать и
// сравнивать глазами. Здесь заявки лежат на одной шкале времени, и место
// на ней — само по себе ответ. Узел ленты — ДАТА, а не заявка: три точки
// на 18 сентября это один выезд на два дня, а не три отдельных дела.

// Цвет по остроте. Уровни ядра сохраняем как есть — просрочено всегда
// красное, острое всегда янтарное; плавно остывает только «спокойное»,
// внутри своего диапазона.
function mixHex(a,b,t){
  const p=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const A=p(a),B=p(b); t=Math.max(0,Math.min(1,t));
  return '#'+[0,1,2].map(i=>Math.round(A[i]+(B[i]-A[i])*t).toString(16).padStart(2,'0')).join('');
}
const URG_RAMP=[[0,'#e8871e'],[10,'#c8a80f'],[18,'#16a34a'],[35,'#4c9a7a'],[60,'#94a3b8']];
function rampColor(days){
  const d=Math.max(0,+days||0);
  for(let i=0;i<URG_RAMP.length-1;i++){
    const [d0,c0]=URG_RAMP[i], [d1,c1]=URG_RAMP[i+1];
    if(d<=d1) return mixHex(c0,c1,(d-d0)/(d1-d0));
  }
  return URG_RAMP[URG_RAMP.length-1][1];
}
function urgHue(u){
  if(u.level==='overdue') return '#dc2626';
  if(u.level==='acute')   return '#f59e0b';
  return rampColor(u.left);
}
const WD_RU=['вс','пн','вт','ср','чт','пт','сб'];
function dayLabel(iso){
  const d=new Date(String(iso)+'T00:00:00'); if(isNaN(d)) return String(iso||'');
  return WD_RU[d.getDay()]+' '+String(d.getDate()).padStart(2,'0')+' '+MON_RU[d.getMonth()];
}
function shortDate(iso){
  const d=new Date(String(iso)+'T00:00:00'); if(isNaN(d)) return String(iso||'');
  return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0');
}

async function renderAttention(){
  const box=$('attnBody'); if(!box) return;
  box.innerHTML='<div class="hint">Считаю…</div>';
  try{
    await ensureRefs();
    // Заявки со сроком, клиентом, техникой и работами — всё, что нужно ленте.
    const { data, error }=await sb.from('jobs')
      .select('id,status,due_date,created_at,assigned_engineer,at_depot, clients(name), equipment(model), job_works(hours,billable)')
      .is('deleted_at',null);
    if(error) throw error;
    let list=data||[];

    // Инженер видит только свои заявки — как в канбане (см. renderJobs).
    if(role==='engineer') list=list.filter(j=>j.assigned_engineer===session.user.id);

    const { dated, cold }=attentionBuckets(list, new Date());

    // Поле называется full_name — так его читают все остальные восемь мест
    // в файле. Здесь стояли p.name и p.email, которых в выборке нет вовсе,
    // поэтому имя инженера не показывалось никогда, а разделитель ' · '
    // оставался висеть в конце строки.
    const engName=id=>{ const p=(profilesList||[]).find(x=>x.id===id); return p?(p.full_name||''):''; };
    const hours=j=>(j.job_works||[]).reduce((a,w)=>a+(+w.hours||0),0);
    const shift=(+appSettings.shift_hours)||8;

    if(!dated.length && !cold.length){
      box.innerHTML='<div class="aempty">На сегодня заявок нет.</div>';
      return;
    }

    // ── Группировка по дате срока ────────────────────────────────────────
    const gmap=new Map();
    dated.forEach(({job,u})=>{
      const k=String(job.due_date);
      if(!gmap.has(k)) gmap.set(k,{date:k,left:u.left,u:u,jobs:[],h:0});
      const g=gmap.get(k); g.jobs.push(job); g.h+=hours(job);
      // У группы берём самый острый уровень: если хоть одна заявка горит,
      // горит вся дата.
      if(urgencyRank(u.level)<urgencyRank(g.u.level)) g.u=u;
    });
    const groups=[...gmap.values()].sort((a,b)=>a.left-b.left);

    // ── Лента: градиент по остроте групп сверху вниз ─────────────────────
    // Остановки ставим в процентах, а не в пикселях: высота карточек
    // заранее неизвестна, а долю каждой группы мы знаем всегда.
    const N=groups.length;
    const stops=[];
    stops.push(urgHue(groups[0].u)+' 0%');
    groups.forEach((g,i)=>stops.push(urgHue(g.u)+' '+((i+0.5)/N*100).toFixed(1)+'%'));
    stops.push(urgHue(groups[N-1].u)+' 100%');

    let h='<div class="afeed">'
      +'<div class="afeed-line" style="background:linear-gradient(180deg,'+stops.join(',')+')"></div>';

    // ── Сегодня ──────────────────────────────────────────────────────────
    // Такая же карточка, как у групп, а не голая строка над ними. Иначе
    // первая карточка ленты начиналась на 34 px ниже первой карточки правой
    // колонки, и две колонки дашборда стояли вразнобой.
    const over=groups.filter(g=>g.left<0);
    const overN=over.reduce((a,g)=>a+g.jobs.length,0);
    const overH=over.reduce((a,g)=>a+g.h,0);
    h+='<div class="agrp">'
      +'<div class="a-ax"><b style="color:var(--red)">'+shortDate(todayISO())+'</b><i>сегодня</i></div>'
      +'<span class="a-dot" style="width:20px;height:20px;left:-31px;top:10px;background:#dc2626;box-shadow:0 0 0 1px #dc2626"></span>'
      +'<span class="a-stem" style="left:-11px;width:11px"></span>'
      +'<div class="agrp-card" style="border-left-color:#dc2626">'
      +'<div class="agrp-h agrp-h-solo" style="background:color-mix(in srgb,#dc2626 '+(overN?'12':'7')+'%,var(--panel))">'
        +'<span class="agrp-n">Сегодня</span>'
        +'<span class="agrp-hint" style="flex:1">'+(overN
            ? '<b style="color:var(--red)">просрочено '+overN+' '+plural(overN,'заявка','заявки','заявок')
              +' · '+overH.toFixed(overH%1?1:0)+' ч</b>'
            : 'просроченного нет')+'</span>'
      +'</div></div></div>';

    // ── Группы ───────────────────────────────────────────────────────────
    let prevLeft=0;
    groups.forEach(g=>{
      // Разрыв шкалы: пустые недели схлопываем в подпись, иначе ближние
      // сроки слиплись бы в верхней трети, а дальний уехал бы в одиночестве.
      // Пустые недели считаем только вперёд: окно между просроченной
      // заявкой и следующим сроком частью лежит в прошлом, и писать
      // «три недели без сроков» про уже прошедшие дни — неправда.
      const gapW=Math.floor((g.left-Math.max(0,prevLeft))/7);
      if(gapW>=3) h+='<div class="a-break"><span>'+gapW+' '+plural(gapW,'неделя','недели','недель')+' без сроков</span></div>';
      prevLeft=g.left;

      const col=urgHue(g.u);
      const n=g.jobs.length;
      const dia=Math.round(13+Math.min(1,g.h/24)*11);
      const engs=[...new Set(g.jobs.map(j=>j.assigned_engineer).filter(Boolean))];
      const engTxt=!engs.length ? '<span class="a-noeng">без инженера</span>'
        : (engs.length===1 ? esc(engName(engs[0])||'—') : engs.length+' инженера');
      const shifts=g.h/shift;
      const load=g.h>shift
        ? esc(g.h.toFixed(g.h%1?1:0))+' ч · '+Math.ceil(shifts)+' '+plural(Math.ceil(shifts),'смена','смены','смен')
        : esc(g.h.toFixed(g.h%1?1:0))+' ч';
      const leftTxt=g.left<0?('−'+(-g.left)+' дн'):(g.left+' дн');

      h+='<div class="agrp">'
        +'<div class="a-ax"><b>'+shortDate(g.date)+'</b><i>'+leftTxt+'</i></div>'
        +'<span class="a-dot" style="width:'+dia+'px;height:'+dia+'px;left:'+(-21-dia/2)+'px;top:'+(20-dia/2)+'px;'
          +'background:'+col+';box-shadow:0 0 0 1px '+col+'">'+(n>1?n:'')+'</span>'
        +'<span class="a-stem" style="left:'+(-21+dia/2)+'px;width:'+(21-dia/2)+'px"></span>'
        +'<div class="agrp-card" style="border-left-color:'+col+'">'
        +'<div class="agrp-h" style="background:color-mix(in srgb,'+col+' 9%,var(--panel))">'
          +'<span class="agrp-n">'+dayLabel(g.date)+'</span>'
          +'<span class="agrp-track"><i style="width:'+Math.min(100,g.h/(shift*5)*100).toFixed(0)+'%;background:'+col+'"></i></span>'
          +'<span class="agrp-hint">'+load+(n>1?(' · '+n+' '+plural(n,'точка','точки','точек')):'')+'</span>'
          +'<span class="agrp-eng">'+engTxt+'</span>'
        +'</div>';
      g.jobs.forEach(j=>{
        const mdl=(j.equipment&&j.equipment.model)||'';
        h+='<div class="arow2" data-ajob="'+j.id+'">'
          +'<div class="a-main"><div class="a-name">'+esc((j.clients&&j.clients.name)||'—')+'</div>'
          +(mdl?('<div class="a-sub">'+esc(mdl)+'</div>'):'')+'</div>'
          +'<span class="a-h">'+esc(hours(j).toFixed(hours(j)%1?1:0))+' ч</span></div>';
      });
      h+='</div></div>';
    });
    h+='</div>';

    // ── Холодные ─────────────────────────────────────────────────────────
    if(cold.length){
      let ch='';
      cold.forEach(j=>{
        ch+='<div class="arow gray" data-ajob="'+j.id+'"><span class="astripe"></span>'
          +'<div class="amain"><div class="aname">'+esc((j.clients&&j.clients.name)||'—')+'</div>'
          +'<div class="asub">'+esc((j.equipment&&j.equipment.model)||'')+'</div></div>'
          +'<span class="abadge gray">без срока</span></div>';
      });
      h+='<details class="acold"><summary><span class="achev">▸</span>'
        +'Холодные потребности <span class="acount">'+cold.length+'</span></summary>'
        +'<div>'+ch+'</div></details>';
    }

    box.innerHTML=h;
    box.querySelectorAll('[data-ajob]').forEach(el=>el.onclick=()=>openJob(el.dataset.ajob));
  }catch(e){ box.innerHTML='<div class="err">'+esc(e.message||e)+'</div>'; }
}

// ── Загрузка инженеров ──────────────────────────────────────────────────────
// Горизонт обязателен. Без него «загрузка» — это сумма всех часов до конца
// года: число большое, красивое и ни на что не влияющее. Две рабочие недели
// вперёд — это тот срок, на который ещё можно что-то переставить.
// Ёмкость считаем сменой из настроек: 8 ч × 10 рабочих дней.
//
// Часы работ — это не весь день инженера. При наших плечах дорога нередко
// длиннее самой работы: выезд на 21 ч работ легко несёт 20 ч за рулём,
// и загрузка «26 %» по одним нормочасам — это неправда. Дорогу берём
// из driveH снимка выезда: она посчитана роутером по настоящим дорогам,
// выдумывать её не нужно. У заявок, ещё не собранных в выезд, маршрута
// нет физически — их дорога в счёт не идёт, и об этом сказано в подписи.
const LOAD_DAYS=14;
// Глубина графика выручки. Полгода было прибито гвоздём; на молодой базе
// это пять пустых столбиков, на зрелой — слишком короткая память.
let revMonths=6;
const REV_PERIODS=[[6,'6 мес'],[12,'год'],[24,'2 года']];
function engineerLoadCard(jobs, trips){
  if(!canWrite()) return '';
  const shift=(+appSettings.shift_hours)||8;
  const cap=shift*10;
  const tIso=todayISO();
  const hz=new Date(); hz.setDate(hz.getDate()+LOAD_DAYS); const hIso=todayISO(hz);
  const hours=j=>(j.job_works||[]).reduce((a,w)=>a+(+w.hours||0),0);
  const alive=j=>['open','planned','in_progress'].includes(j.status);

  const rows=new Map();   // id инженера → {w, d, n}
  const row=k=>{ let r=rows.get(k); if(!r){ r={w:0,d:0,n:0}; rows.set(k,r); } return r; };
  let later=0, nodue=0, planned=0;

  (jobs||[]).filter(alive).forEach(j=>{
    const h=hours(j); if(!h) return;
    if(!j.due_date){ nodue+=h; return; }
    if(String(j.due_date)>hIso){ later+=h; return; }
    row(j.assigned_engineer||'__none').w+=h; row(j.assigned_engineer||'__none').n++;
  });

  // Дорога — по выездам, которые задевают горизонт и ещё не закрыты.
  (trips||[]).forEach(t=>{
    if(t.status==='done'||t.status==='cancelled') return;
    const from=t.date_from||null; if(!from) return;
    const to=t.date_to||from;
    if(to<tIso || from>hIso) return;             // выезд не пересекает горизонт
    const d=+((t.econ_snapshot||{}).driveH)||0; if(!d) return;
    row(t.lead_engineer||'__none').d+=d;
    planned+=d;
  });

  const name=id=>{ const p=(profilesList||[]).find(x=>x.id===id); return p?(p.full_name||p.role||'без имени'):'—'; };
  const list=[...rows.entries()]
    .map(([id,r])=>({id,w:r.w,d:r.d,n:r.n,t:r.w+r.d,name:id==='__none'?'Без инженера':name(id)}))
    .filter(r=>r.t>0)
    .sort((a,b)=>b.t-a.t);

  const num=v=>v.toFixed(v%1?1:0);
  let body='';
  if(!list.length){
    body='<div class="hint">На ближайшие две недели работ не поставлено.</div>';
  } else {
    list.forEach(r=>{
      const pct=r.t/cap*100;
      const col=pct>100?'var(--red)':pct>70?'#f59e0b':'var(--green)';
      const none=(r.id==='__none');
      const wPct=Math.min(100,r.w/cap*100), dPct=Math.min(100-wPct,r.d/cap*100);
      const parts=[num(r.w)+' ч работ'];
      if(r.d) parts.push(num(r.d)+' ч дороги');
      parts.push(r.n+' '+plural(r.n,'заявка','заявки','заявок'));
      body+='<div class="elrow'+(none?' none':'')+'">'
        +'<div class="el-n">'+esc(r.name)+'</div>'
        +'<div class="el-v" style="color:'+col+'">'+num(r.t)+' / '+cap+' ч · '+Math.round(pct)+'%</div>'
        +'<div class="el-t"><i style="width:'+wPct.toFixed(0)+'%;background:'+col+'"></i>'
          +(r.d?('<i class="el-drive" style="width:'+dPct.toFixed(0)+'%;background:'+col+'"></i>'):'')+'</div>'
        +'<div class="el-s">'+esc(parts.join(' · '))+'</div>'
        +'</div>';
    });
  }
  const tail=[];
  if(later) tail.push('дальше по срокам '+num(later)+' ч');
  if(nodue) tail.push('без срока '+num(nodue)+' ч');
  tail.push(planned
    ? 'дорога — по спланированным выездам'
    : 'дорога не в счёт: выездов на этот срок ещё нет');

  return '<div class="card elcard"><h3>Загрузка инженеров <span class="el-hz">две недели вперёд</span></h3>'
    +body
    +'<div class="el-tail">'+esc(tail.join(' · '))+'</div>'
    +'</div>';
}

async function renderDashboard(){ const box=$('dashBody'); if(!box) return;
  renderAttention();
  // Ролевая раскладка. Инженер видит только «Мой день» — ленту на всю ширину,
  // без денег и без правой колонки. Менеджер и админ — двухколоночно.
  const grid=document.querySelector('.dash-grid');
  const attnCaps=document.querySelector('.dash-attn .acaps');
  if(role==='engineer'){
    if(grid) grid.classList.add('one-col');
    if(box) box.style.display='none';
    if(attnCaps) attnCaps.textContent='Мой день';
    return;   // правую колонку инженеру не строим вовсе
  }
  // Через класс, а не инлайном: инлайновый grid-template-columns перебивал
  // медиазапрос, и на телефоне сводка оставалась в две колонки по 190 px.
  if(grid) grid.classList.remove('one-col');
  if(box) box.style.display='';
  if(attnCaps) attnCaps.textContent='Требует внимания';
  box.innerHTML='<div class="hint">Считаю…</div>';
  try{
    const cl=clients.filter(c=>!c.is_base).length, dp=clients.filter(c=>c.is_base).length;
    await ensureRefs();
    const {data:js}=await sb.from('jobs').select('status,at_depot,due_date,assigned_engineer, job_works(hours,billable,revenue)').is('deleted_at',null); const jb=js||[];
    const byst={open:0,planned:0,in_progress:0,done:0,cancelled:0}; let wh=0,totH=0;
    jb.forEach(j=>{ byst[j.status]=(byst[j.status]||0)+1; (j.job_works||[]).forEach(w=>{ const h=+w.hours||0; totH+=h; if(!w.billable) wh+=h; }); });
    const {data:tr}=await sb.from('trips').select('econ_snapshot,date_from,date_to,lead_engineer,status').is('deleted_at',null); const trips=tr||[];
    // ВЫРУЧКА — только по состоявшемуся.
    //
    // Здесь суммировались снимки ВСЕХ выездов подряд, включая запланированные
    // на будущее. В «выручке за месяц» и «за всё время» лежали деньги,
    // которых ещё нет: выезд на 18 сентября уже увеличивал август. Отчётность
    // так не считают — и никакая цифра, посчитанная так, не годится
    // для решений.
    //
    // Состоявшийся выезд — это finished (машина вернулась, ждёт менеджера)
    // и done (принят). planned/assigned — будущее, in_progress — ещё идёт,
    // cancelled — не было вовсе. Запланированное считаем отдельно и называем
    // планом, а не выручкой.
    const TRIP_EARNED=t=>t.status==='finished'||t.status==='done';
    const TRIP_AHEAD=t=>t.status==='planned'||t.status==='assigned'||t.status==='in_progress';
    let rev=0,cost=0,profit=0,planRev=0,planN=0;
    trips.forEach(t=>{ const e=t.econ_snapshot||{};
      if(TRIP_EARNED(t)){ rev+=+e.revenue||0; cost+=+e.cost||0; profit+=+e.profit||0; }
      else if(TRIP_AHEAD(t)){ planRev+=+e.revenue||0; planN++; } });
    // Депо-заявки в выезды не попадают (сервер это запрещает триггером),
    // поэтому в снимках выездов их денег нет вовсе — без этого куска целый
    // класс работ давал бы в аналитике ноль. Тихо: плитки показывали бы
    // цифры, просто неполные.
    // Дороги и суточных у депо нет физически, себестоимость — только труд,
    // и только по норме: трекера в цеху нет, факт брать неоткуда.
    const ch=(appSettings.costs&&+appSettings.costs.hour)||0;
    // Та же оговорка, что и по выездам: считаем только ЗАКРЫТЫЕ депо-заявки.
    // Открытая заявка в цеху — это ещё не выручка.
    let dRev=0,dCost=0;
    jb.filter(j=>j.at_depot&&j.status==='done').forEach(j=>{ (j.job_works||[]).forEach(w=>{ dRev+=+w.revenue||0; dCost+=(+w.hours||0)*ch; }); });
    rev+=dRev; cost+=dCost; profit+=(dRev-dCost);
    const margin=rev>0?(profit/rev*100):0, warrShare=totH?Math.round(wh/totH*100):0, cur=appSettings.currency||'';
    const overdue=vehicles.filter(v=>{ const iv=+v.service_interval||0; return iv>0 && ((+v.odometer||0)-(+v.last_service||0))>=iv; }).length;
    const pc=profit>=0?'var(--green)':'var(--red)';
    const tile=(l,v,sub,col,nav)=>'<div class="stat'+(nav?' nav':'')+'"'+(nav?(' data-nav="'+nav+'"'):'')+'><div class="stat-v"'+(col?(' style="color:'+col+'"'):'')+'>'+v+'</div><div class="stat-l">'+esc(l)+'</div>'+(sub?'<div class="stat-s">'+esc(sub)+'</div>':'')+(nav?'<div class="stat-go">Открыть →</div>':'')+'</div>';
    // Крупным кеглем — то, что меняется и требует решения.
    //
    // Раньше здесь без всякой подписи стояла сумма выручки ЗА ВСЁ ВРЕМЯ.
    // Такое число только растёт и не говорит ни о хорошем месяце, ни о
    // плохом; вдобавок график под ним показывал шесть месяцев, то есть
    // в одной карточке жили два разных периода и ни один не был назван.
    // Теперь наверху текущий месяц с прошлым для сравнения, а накопленное
    // за всё время ушло вниз отдельной строкой.
    const MON=['январь','февраль','март','апрель','май','июнь','июль',
               'август','сентябрь','октябрь','ноябрь','декабрь'];
    const now2=new Date();
    const kNow=monthKey(now2);
    const kPrev=monthKey(new Date(now2.getFullYear(), now2.getMonth()-1, 1));
    let mRev=0, mProfit=0, pRev=0;
    trips.filter(TRIP_EARNED).forEach(t=>{ if(!t.date_from) return;
      const k=String(t.date_from).slice(0,7); const e=t.econ_snapshot||{};
      if(k===kNow){ mRev+=+e.revenue||0; mProfit+=+e.profit||0; }
      else if(k===kPrev){ pRev+=+e.revenue||0; } });
    // Депо-заявки не привязаны к выезду и не имеют даты выезда — они входят
    // только в накопленный итог, и приписывать их текущему месяцу было бы
    // враньём.
    const mMargin=mRev>0?(mProfit/mRev*100):0;
    const mpc=mProfit>=0?'var(--green)':'var(--red)';
    const delta=pRev>0?Math.round((mRev-pRev)/pRev*100):null;
    const deltaTxt=delta==null?'нет данных за прошлый месяц'
      :((delta>=0?'+':'')+delta+'% к '+MON[(now2.getMonth()+11)%12]);

    const moneyCard = canWrite()
      ? '<div class="card money-card">'
        +'<div class="mc-per">Выручка · '+MON[now2.getMonth()]+' '+now2.getFullYear()+' <span class="mc-note">по состоявшимся выездам</span></div>'
        +'<div class="mc-big">'+Math.round(mRev).toLocaleString('ru-RU')+' <span class="mc-cur">'+cur+'</span></div>'
        +'<div class="mc-delta'+(delta!=null&&delta<0?' down':'')+'">'+esc(deltaTxt)+'</div>'
        +'<div class="mc-row"><span class="mc-k">Прибыль за месяц</span><span class="mc-v" style="color:'+mpc+'">'+Math.round(mProfit).toLocaleString('ru-RU')+' '+cur+'</span></div>'
        +'<div class="mc-row"><span class="mc-k">Маржа за месяц</span><span class="mc-v">'+mMargin.toFixed(0)+'%</span></div>'
        +'<div class="mc-row mc-all"><span class="mc-k">Всего за всё время</span><span class="mc-v">'+Math.round(rev).toLocaleString('ru-RU')+' '+cur+'</span></div>'
        +'<div class="mc-row"><span class="mc-k">Прибыль за всё время</span><span class="mc-v" style="color:'+pc+'">'+Math.round(profit).toLocaleString('ru-RU')+' '+cur+'</span></div>'
        +'<div class="mc-row"><span class="mc-k">Доля гарантии</span><span class="mc-v">'+warrShare+'%</span></div>'
        // Запланированное отделено от заработанного и названо планом.
        // Раньше эти деньги молча лежали в выручке, хотя выезда ещё не было.
        +(planN?('<div class="mc-row mc-plan"><span class="mc-k">В плане · '+planN+' '
            +plural(planN,'выезд','выезда','выездов')+'</span><span class="mc-v">'
            +Math.round(planRev).toLocaleString('ru-RU')+' '+cur+'</span></div>'):'')
        +'</div>'
      : '';

    // Четыре плитки-перехода («Точки», «Заявки в работе», «Выезды», «Машины»)
    // убраны. Числа в них почти не менялись, а решения не требовали ни одно:
    // переход в раздел уже есть в рельсе слева, и он на два клика короче.
    // Освободившееся место занимает загрузка инженеров — она меняется каждый
    // день и прямо говорит, кому уже некуда ставить.
    let h=moneyCard;
    // Заявки по статусам — компактная стек-полоса + легенда (как в мокапе),
    // вместо списка с нулями. Открыта — синий, в работе — янтарь,
    // готова — зелёный, отменена — серый.
    // Полоса показывает только ЖИВЫЕ статусы. Закрытые и отменённые копятся
    // без конца: через год они займут почти всю ширину, и три активных
    // сегмента станут неразличимой полоской у края. Сколько всего закрыто —
    // отдельной строкой под полосой, где это число никому не мешает.
    const stClosed=(byst.done||0)+(byst.cancelled||0);
    const stTotal=Math.max(1,(byst.open||0)+(byst.planned||0)+(byst.in_progress||0));
    const seg=[
      ['open','Открыта','var(--cyan)',byst.open||0],
      ['planned','Запланирована','#5b9bd5',byst.planned||0],
      ['in_progress','В работе','#f5b23d',byst.in_progress||0],
    ].filter(x=>x[3]>0);
    let bar='', leg='';
    seg.forEach(([k,lbl,col,n])=>{
      bar+='<i style="width:'+(n/stTotal*100)+'%;background:'+col+'"></i>';
      leg+='<span><i class="ldot" style="background:'+col+'"></i>'+lbl+' '+n+'</span>';
    });
    const statusCard='<div class="card statuscard"><h3>Заявки в работе</h3>'
      +'<div class="statbar">'+(bar||'<i style="width:100%;background:var(--line)"></i>')+'</div>'
      +'<div class="statleg">'+(leg||'<span class="dim">Активных заявок нет</span>')+'</div>'
      +(stClosed?('<div class="stat-closed">закрыто и отменено за всё время: '+stClosed+'</div>'):'')
      +'</div>';
    // Глубина графика выбирается, а не прибита к шести месяцам.
    const months=[]; const now=new Date();
    for(let i=revMonths-1;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push({key:monthKey(d),rev:0,profit:0}); }
    // Тот же принцип, что и в итогах: в график идут только состоявшиеся
    // выезды. Иначе столбик будущего месяца стоял бы наравне с прошедшими.
    trips.filter(TRIP_EARNED).forEach(t=>{ if(!t.date_from) return; const m=months.find(x=>x.key===String(t.date_from).slice(0,7)); if(m){ const e=t.econ_snapshot||{}; m.rev+=+e.revenue||0; m.profit+=+e.profit||0; } });
    const filled=months.filter(m=>m.rev>0).length;
    let chartCard='';
    if(canWrite()){
      const maxRev=Math.max(1,...months.map(m=>m.rev));
      const short=v=>v>=1000?Math.round(v/1000)+'к':String(Math.round(v));
      chartCard='<div class="card"><h3 class="cardhead">Выручка по месяцам'
        +'<span class="seg revseg" id="revPeriod">'
        +REV_PERIODS.map(([n,l])=>'<button'+(n===revMonths?' class="on"':'')+' data-rm="'+n+'">'+l+'</button>').join('')
        +'</span></h3>';
      // Один заполненный месяц — это не тренд, а столбик среди пустых мест.
      // «Этот месяц против прошлого» уже сказано крупным числом выше;
      // здесь честнее предложить расширить окно, чем рисовать пустоту.
      if(filled>=2){
        chartCard+='<div class="revbars">';
        months.forEach(m=>{ const hR=m.rev>0?Math.max(4,Math.round(m.rev/maxRev*100)):0;
          chartCard+='<div class="revbar" title="'+m.key+': '+Math.round(m.rev).toLocaleString('ru-RU')+' '+esc(cur)+'">'
            +'<div class="rb-v">'+(m.rev>0?short(m.rev):'')+'</div>'
            +'<div class="rb-c"><div class="rb-f" style="height:'+hR+'%"></div></div>'
            +'<div class="rb-l">'+m.key.slice(5)+'</div></div>'; });
        chartCard+='</div>';
      } else {
        chartCard+='<div class="hint">'+(filled
          ? 'За выбранный период выручка есть только в одном месяце — сравнивать не с чем.'
          : 'За выбранный период выручки нет ни в одном месяце.')
          +' Возьмите период шире.</div>';
      }
      chartCard+='</div>';
    }

    // Порядок правой колонки: деньги, их динамика, кем это делается,
    // и только потом состояние очереди.
    h += chartCard + engineerLoadCard(jb, trips) + statusCard;
    box.innerHTML=h;
    box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ revMonths=+b.dataset.rm; renderDashboard(); });
    box.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>dashNav(el.dataset.nav));
  }catch(e){ box.innerHTML='<div class="err">'+esc(e.message||e)+'</div>'; } }
function dashNav(k){ if(k==='points'){ switchTab('map'); return; } if(k==='trips'){ switchTab('planner'); plannerSub('trips'); return; } if(k==='vehicles'){ switchTab('settings'); return; } switchTab('planner'); plannerSub('jobs'); if(k==='jobs-done'){ jobVisible={open:false,planned:false,in_progress:false,done:true,cancelled:false}; } else { jobVisible={open:true,planned:true,in_progress:true,done:false,cancelled:false}; } renderJobs(); }
// ---------- Мой день ----------
// Инженер живёт выездами, а не заявками: выезд — это его день, машина,
// маршрут и точки. Заявки показываем ВНУТРИ выезда, а не вместо него.
// Заявки без выезда всё же выводим отдельным блоком — иначе назначенная,
// но ещё не спланированная работа просто исчезла бы с глаз.

function tripDayLabel(t){
  const today=todayISO();
  if(t.date_from===today) return '<span class="pill" style="border-color:var(--accent);color:var(--accent-ink)">сегодня</span>';
  if(t.date_from<today && (t.date_to||t.date_from)>=today) return '<span class="pill" style="border-color:var(--accent);color:var(--accent-ink)">идёт</span>';
  if(t.date_from<today) return '<span class="pill" style="border-color:var(--red);color:var(--red)">просрочен</span>';
  return '';
}

function tripActs(t){
  let a='';
  if(t.status==='planned'||t.status==='assigned'){
    a+='<button class="btn sm amber" data-tstart="'+t.id+'">▶ Начать выезд</button>';
    if(!reschedByTrip[t.id]) a+='<button class="btn sm" data-tresched="'+t.id+'">📅 Перенести</button>';
  }
  if(t.status==='in_progress') a+='<button class="btn sm amber" data-tfin="'+t.id+'">■ Завершить</button>';
  if(t.status==='finished' && canWrite()) a+='<button class="btn sm amber" data-tconf="'+t.id+'">✓ Подтвердить</button>';
  if(t.status==='finished' && !canWrite()) a+='<span class="pill">ждёт менеджера</span>';
  if(t.status==='finished'||t.status==='done') a+='<button class="btn sm" data-tstay="'+t.id+'">⏱ Стоянки</button>';
  if(canWrite()) a+='<button class="btn sm" data-topen="'+t.id+'">открыть</button>';
  a+='<button class="btn sm ghost" data-tmap="'+t.id+'">на карте</button>';
  return a;
}

async function renderMine(){
  const box=$('mineList'); if(!box) return;
  box.innerHTML='<div class="hint">Загрузка…</div>';
  const showDone=$('mineDone')&&$('mineDone').checked;
  const mgr=canWrite();

  // Менеджеру — все выезды, инженеру — только свои. Фильтр на сервере,
  // а не в браузере: RLS инженеру чужие всё равно не отдаст.
  let q=sb.from('trips').select('*, vehicles(name,plate)').is('deleted_at',null);
  if(!mgr) q=q.eq('lead_engineer',session.user.id);
  const { data, error }=await q.order('date_from',{ascending:true});
  if(error){ box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }

  let list=data||[];
  if(!showDone) list=list.filter(t=>t.status!=='done'&&t.status!=='cancelled');
  const ord={in_progress:0,finished:1,assigned:2,planned:3,done:4,cancelled:5};
  list.sort((a,b)=>((ord[a.status]??9)-(ord[b.status]??9))||(((a.date_from||'9999')<(b.date_from||'9999'))?-1:1));

  list.forEach(t=>{ tripCache[t.id]=t; });
  const byTrip=await mineTripJobs(list.map(t=>t.id));
  await loadRescheds();

  box.innerHTML='';
  if(!list.length) box.innerHTML='<div class="hint">Выездов нет.</div>';

  list.forEach(t=>{
    const d=document.createElement('div'); d.className='card';
    const jl=byTrip[t.id]||[];
    const veh=t.vehicles?(t.vehicles.name+(t.vehicles.plate?(' · '+t.vehicles.plate):'')):(t.vehicle_label||'машина не назначена');
    const dates=esc(t.date_from||'—')+((t.date_to&&t.date_to!==t.date_from)?(' — '+esc(t.date_to)):'');

    let h='<h3>Выезд '+dates+' <span class="pill">'+esc(ST_TRIP[t.status]||t.status)+'</span> '+tripDayLabel(t)+'</h3>';
    h+='<div class="meta">'+esc(veh)+' · точек: '+jl.length+(t.fact_km?(' · факт '+Math.round(t.fact_km)+' км'):'')+(factHByTrip[t.id]?(' · '+factHByTrip[t.id].toFixed(1)+' ч на точках'):'')+'</div>';

    if(jl.length){
      // Кликабельны: инженеру из «Моего дня» надо открыть заявку и внести
      // работы — иначе он видит список точек и ничего не может с ним сделать.
      h+='<div style="margin-top: var(--sp-3)">'+jl.map(j=>
        '<div class="ds" data-mopen="'+j.id+'" style="display:flex;justify-content:space-between;gap: var(--sp-3);cursor:pointer">'+
        '<span>'+esc(j.clients?j.clients.name:'—')+(j.equipment?(' · '+esc(j.equipment.model)):'')+'</span>'+
        '<span style="color:var(--ink-dim)">'+esc(ST[j.status]||j.status)+' ›</span></div>').join('')+'</div>';
    } else {
      h+='<div class="hint" style="margin-top: var(--sp-3)">Заявок к выезду не привязано.</div>';
    }
    if(t.notes) h+='<div class="ds">'+esc(t.notes)+'</div>';
    h+=reschedBanner(t);
    h+='<div class="acts">'+tripActs(t)+'</div>';
    d.innerHTML=h; box.appendChild(d);
  });

  // Заявки, назначенные лично, но не попавшие ни в один выезд.
  if(!mgr){
    const { data:orphans }=await sb.from('jobs').select('*, at_depot, depot_id, clients(name,lat,lng), equipment(model)')
      .is('deleted_at',null).eq('assigned_engineer',session.user.id)
      .not('status','in','("done","cancelled")');
    const inTrip=new Set(); Object.values(byTrip).forEach(a=>a.forEach(j=>inTrip.add(j.id)));

    // Депо — ОТДЕЛЬНЫМ блоком. В «без выезда» их нельзя: там написано
    // «не привязаны ни к одному выезду», и депо-заявка висела бы там
    // вечно, выглядя как ошибка планирования. Она и не должна быть в выезде.
    const dep=(orphans||[]).filter(j=>j.at_depot);
    if(dep.length){
      const w=document.createElement('div'); w.className='card';
      w.innerHTML='<h3>🔧 В депо <span class="pill">'+dep.length+'</span></h3>'+
        '<div class="meta">Технику привозит клиент. Выезд не нужен.</div>'+
        dep.map(j=>{ const d=clients.find(c=>c.id==j.depot_id);
          return '<div class="ds" data-mopen="'+j.id+'" style="display:flex;justify-content:space-between;gap: var(--sp-3);cursor:pointer">'+
          '<span>'+esc(j.clients?j.clients.name:'—')+(j.equipment?(' · '+esc(j.equipment.model)):'')+
          (d?(' <span class="pill">'+esc(d.name)+'</span>'):'')+'</span>'+
          '<span style="color:var(--ink-dim)">'+esc(ST[j.status]||j.status)+' ›</span></div>'; }).join('');
      box.appendChild(w);
    }

    const loose=(orphans||[]).filter(j=>!inTrip.has(j.id) && !j.at_depot);
    if(loose.length){
      const w=document.createElement('div'); w.className='card';
      w.innerHTML='<h3>Заявки без выезда <span class="pill">'+loose.length+'</span></h3>'+
        '<div class="meta">Назначены на тебя, но не привязаны ни к одному выезду.</div>'+
        loose.map(j=>'<div class="ds" style="display:flex;justify-content:space-between;gap: var(--sp-3)">'+
          '<span>'+esc(j.clients?j.clients.name:'—')+(j.scheduled_date?(' · '+esc(j.scheduled_date)):'')+'</span>'+
          '<span><button class="btn sm ghost" data-mopen="'+j.id+'">открыть</button></span></div>').join('');
      box.appendChild(w);
    }
  }

  box.querySelectorAll('[data-tstart]').forEach(b=>b.onclick=()=>tripAction(b.dataset.tstart,'start'));
  box.querySelectorAll('[data-tfin]').forEach(b=>b.onclick=()=>tripAction(b.dataset.tfin,'finish'));
  box.querySelectorAll('[data-tconf]').forEach(b=>b.onclick=()=>tripAction(b.dataset.tconf,'confirm'));
  box.querySelectorAll('[data-topen]').forEach(b=>b.onclick=()=>openTrip(b.dataset.topen));
  box.querySelectorAll('[data-mopen]').forEach(b=>b.onclick=()=>openJob(b.dataset.mopen));
  box.querySelectorAll('[data-tmap]').forEach(b=>b.onclick=()=>showTripOnMap(b.dataset.tmap));
  box.querySelectorAll('[data-tstay]').forEach(b=>b.onclick=()=>openStaysModal(b.dataset.tstay));
  box.querySelectorAll('[data-tresched]').forEach(b=>b.onclick=()=>openReschedModal(b.dataset.tresched));
  box.querySelectorAll('[data-rok]').forEach(b=>b.onclick=()=>reschedDecide(b.dataset.rok,true));
  box.querySelectorAll('[data-rno]').forEach(b=>b.onclick=()=>reschedDecide(b.dataset.rno,false));
  box.querySelectorAll('[data-rcancel]').forEach(b=>b.onclick=()=>reschedCancel(b.dataset.rcancel));
}

async function mineTripJobs(ids){
  const out={}; if(!ids.length) return out;
  const { data }=await sb.from('trip_jobs')
    .select('trip_id, ord, jobs(id,status,client_id,equipment_id,clients(name,lat,lng),equipment(model))')
    .in('trip_id',ids).order('ord');
  (data||[]).forEach(r=>{ if(!r.jobs) return; (out[r.trip_id]=out[r.trip_id]||[]).push(r.jobs); });
  return out;
}

async function jobSetStatus(id,st){ const {error}=await sb.from('jobs').update({status:st}).eq('id',id); if(error){ notify('Ошибка: '+error.message,'err'); return; } if(st==='done'){ try{ await sb.rpc('register_equipment_visit',{p_job:id}); await reloadEquip(); }catch(e){ notify('Заявка закрыта, но визит по технике не отметился: '+(e.message||e),'err'); } } showToast('Статус: '+(ST[st]||st)); renderJobs(); }
function populateEquip(){ const list=eqByClient[$('jbClient').value]||[]; $('jbEquip').innerHTML='<option value="">— без привязки —</option>'+list.map(e=>'<option value="'+e.id+'">'+esc(e.model+(e.serial?' · '+e.serial:''))+'</option>').join(''); }
$('jbClient').onchange=()=>{ populateEquip(); jobHead(); };
['jbEquip','jbStatus','jbEng','jbDue'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('change',jobHead); });
async function openJob(id,presetClient,presetEquip){ await ensureRefs(); jobEditId=id; const j=id?jobs.find(x=>x.id==id):null;
  $('jbClient').innerHTML=clients.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
  $('jbEng').innerHTML='<option value="">— не назначен —</option>'+profilesList.map(p=>'<option value="'+p.id+'">'+esc((p.full_name||'без имени')+' ('+p.role+')')+'</option>').join('');
  $('jbWorkPick').innerHTML='<option value="">— выбрать работу —</option>'+catalog.map(w=>'<option value="'+w.id+'">'+esc(w.name)+'</option>').join('');
  $('jobTitle').textContent=id?'Заявка':'Новая заявка';
  $('jbClient').value=j?j.client_id:(presetClient||(clients[0]?clients[0].id:'')); populateEquip();
  $('jbStatus').value=j?j.status:'open'; $('jbEng').value=j&&j.assigned_engineer?j.assigned_engineer:''; $('jbDate').value=j?(j.scheduled_date||''):''; $('jbWindow').value=j?(j.time_window||''):''; $('jbDue').value=j?(j.due_date||''):''; $('jbNotes').value=j?(j.notes||''):''; if($('jbWarrDays')) $('jbWarrDays').value=(appSettings.repair_warranty_days==null?90:appSettings.repair_warranty_days);
  if(presetEquip) $('jbEquip').value=presetEquip; else if(j) $('jbEquip').value=j.equipment_id||'';
  jobAtDepot=!!(j&&j.at_depot);
  const dl=depotList();
  $('jbDepotSel').innerHTML=dl.length?dl.map(d=>'<option value="'+d.id+'">'+esc(d.name)+'</option>').join('')
    :'<option value="">— депо не заведено —</option>';
  if(j&&j.depot_id) $('jbDepotSel').value=j.depot_id; else if(dl.length) $('jbDepotSel').value=dl[0].id;
  renderDepotUi();
  curWorks=(j&&j.job_works?j.job_works:[]).map(w=>{ const cw=w.work_id?catalog.find(c=>c.id===w.work_id):null; return {work_id:w.work_id||null,name:cw?cw.name:(w.title||'(работа)'),hours:+w.hours||0,override:(w.revenue_override!=null?String(w.revenue_override):''),billable:w.billable!==false,reasons:[],billable_reason:w.billable_reason||'',profile:w.tariff_profile||null,custom:!w.work_id}; });
  renderJobWorks();
  const ro=!canWrite() && !(j&&j.assigned_engineer===session.user.id);
  ['jbClient','jbEquip','jbEng','jbDate','jbWindow','jbDue','jbNotes','jbWorkPick','jbWorkAdd','jbCustomAdd','jobSave'].forEach(x=>{ if($(x)) $(x).disabled=ro; });
  $('jobErr').textContent=''; jobHead();
  // Куда вернёт хлебная крошка. Заявку открывают из пяти мест — со сводки,
  // с карты, из канбана, из выезда, — и возвращать всегда в канбан значит
  // выкидывать человека из того места, где он работал.
  const cur=document.querySelector('.view.active');
  jobBack=(cur&&cur.className.match(/view-(\w+)/)||[])[1]||'planner';
  if(jobBack==='job') jobBack='planner';
  jobBackSub=(jobBack==='planner')?plannerCur:null;
  switchTab('job');
  const pane=document.querySelector('.view-job .pane'); if(pane) pane.scrollTop=0; }
let jobBack='planner', jobBackSub='jobs';
// Шапка страницы заявки: кто, что за техника, сколько это стоит и когда срок.
function jobHead(){
  const cl=clients.find(c=>c.id==$('jbClient').value);
  const eqName=(()=>{ const sel=$('jbEquip'); return (sel&&sel.selectedIndex>0)?sel.options[sel.selectedIndex].text:''; })();
  const nm=cl?cl.name:'Новая заявка';
  $('jobTitle').textContent=jobEditId?nm:('Новая заявка' + (cl?(' · '+nm):''));
  $('jobCrumb').textContent=jobEditId?nm:'Новая заявка';
  const parts=[];
  if(eqName) parts.push(esc(eqName)); else parts.push('без техники');
  const st=$('jbStatus'); if(st) parts.push(esc(st.options[st.selectedIndex].text));
  const en=$('jbEng'); if(en&&en.selectedIndex>0) parts.push(esc(en.options[en.selectedIndex].text));
  const due=$('jbDue').value;
  if(due){
    const u=jobUrgency({due_date:due,created_at:null},new Date());
    const col=urgHue(u);
    parts.push('<span style="color:'+col+'">срок '+esc(tripPeriod(due,null))
      +(u.left<0?(' · просрочено '+(-u.left)+' дн'):(' · '+u.left+' дн'))+'</span>');
  }
  $('jobSub').innerHTML=parts.join(' · ');
  const hrs=curWorks.reduce((a,w)=>a+(+w.hours||0),0);
  const rev=curWorks.reduce((a,w)=>a+(+workRevenue(w)||0),0);
  const cur=appSettings.currency||'';
  $('jobHeadEcon').innerHTML='<div class="te-k">Выручка</div>'
    +'<div class="te-v">'+Math.round(rev).toLocaleString('ru-RU')+' '+cur+'</div>'
    +'<div class="te-s">'+hrs.toFixed(hrs%1?1:0)+' ч · '+curWorks.length+' '+plural(curWorks.length,'работа','работы','работ')+'</div>';
}
if($('jbDepot')) $('jbDepot').onchange=()=>{
  if($('jbDepot').checked && !depotList().length){
    $('jbDepot').checked=false;
    notify('Депо не заведено. Карта → Справочник → создай точку и отметь её как депо.','err');
    return;
  }
  jobAtDepot=$('jbDepot').checked;
  renderDepotUi();
  // Ставка сменилась — показываем это сразу, а не после сохранения.
  renderJobWorks();
};

window.newJobForClient=function(cid){ if(!canWrite()) return; map.closePopup(); openJob(null,cid); };
window.newJobForEquip=function(cid,eid){ if(!canWrite()) return; map.closePopup(); openJob(null,cid,eid); };
// Место выполнения открытой заявки. Читается workRevenue() при пересчёте
// строк работ. false для новой заявки — по умолчанию всё на выезде.
let jobAtDepot=false;
function depotList(){ return clients.filter(c=>c.is_base); }
function renderDepotUi(){
  const on=!!jobAtDepot;
  if($('jbDepot')) $('jbDepot').checked=on;
  if($('jbDepotWrap')) $('jbDepotWrap').style.display=on?'':'none';
  if($('jbDepotHint')) $('jbDepotHint').style.display=on?'inline-flex':'none';
}
function defaultProfileId(billable){ const list=appSettings.tariff_profiles||[];
  if(billable){ const cid=$('jbClient')?$('jbClient').value:''; const cl=cid?clients.find(c=>c.id==cid):null; if(cl&&cl.default_profile&&list.some(p=>p.id===cl.default_profile)) return cl.default_profile; const dp=list.find(p=>p.def_paid); return dp?dp.id:''; }
  const dw=list.find(p=>p.def_warranty); return dw?dw.id:''; }
$('jbWorkAdd').onclick=async ()=>{ const wid=$('jbWorkPick').value; if(!wid) return; const cw=catalog.find(c=>c.id===wid); if(!cw) return;
  let sug={billable:true,reasons:[]}; try{ const {data}=await sb.rpc('suggest_warranty',{p_equipment:$('jbEquip').value||null,p_work:wid,p_date:$('jbDate').value||null}); if(data) sug=data; }catch(e){}
  const bill=sug.billable!==false; curWorks.push({work_id:wid,name:cw.name,hours:+cw.norm_hours||0,override:((+cw.price>0)?String(cw.price):''),billable:bill,reasons:sug.reasons||[],billable_reason:'',profile:defaultProfileId(bill),custom:false}); $('jbWorkPick').value=''; renderJobWorks(); };
$('jbCustomAdd').onclick=()=>{ curWorks.push({work_id:null,name:'',hours:0,override:'',billable:true,reasons:[],billable_reason:'',profile:defaultProfileId(true),custom:true}); renderJobWorks(); };
function profileById(id){ return id?((appSettings.tariff_profiles||[]).find(p=>p.id===id)||null):null; }
// Зеркало серверного guard_job_work_money. Разъедутся — инженер увидит одну
// цифру, а в базе ляжет другая: последнее слово всегда за триггером.
// Правишь здесь — правь и там.
function workRevenue(w){ if(w.override!==''&&w.override!=null) return +w.override||0; const p=profileById(w.profile||w.tariff_profile);
  const depot=!!jobAtDepot;
  if(w.billable){
    let r=0;
    if(depot){
      r=p?(+((p.work_depot||{}).rate)||0):0;
      // Фолбэк на ставку выезда, а не на ноль: пустая «депо/ч» не должна
      // означать бесплатную работу — молча и в акте.
      if(r<=0) r=p?(+((p.work_paid||{}).rate)||0):0;
    } else {
      r=p?(+((p.work_paid||{}).rate)||0):0;
    }
    return (+w.hours||0)*(r>0?r:((appSettings.tariffs&&appSettings.tariffs.hour)||0));
  }
  const wr=p?(+((p.work_warr||{}).rate)||0):0; return (+w.hours||0)*wr; }

function renderJobWorks(){ const box=$('jbWorks'); box.innerHTML='';
  curWorks.forEach((w,i)=>{ const d=document.createElement('div'); d.className='eqitem';
    const head=w.custom?('<input type="text" placeholder="название работы" value="'+esc(w.name)+'" data-wn="'+i+'" style="width:100%">'):('<div class="t">'+esc(w.name)+'</div>');
    const rev=workRevenue(w);
    d.innerHTML=head+'<div style="display:flex;gap: var(--sp-3);align-items:center;margin-top: var(--sp-3);flex-wrap:wrap">'+
      '<input type="number" step="0.25" value="'+w.hours+'" data-wh="'+i+'" style="width:74px" title="часы"><span class="hint" style="margin: 0">ч</span>'+
      '<button class="btn sm '+(w.billable?'amber':'ghost')+'" data-wb="'+i+'">'+(w.billable?'платно':'гарантия')+'</button>'+
      '<select data-wp="'+i+'" style="max-width:120px;font-size: var(--fs-2)" title="профиль тарифа (плательщик)"><option value="">— профиль —</option>'+(appSettings.tariff_profiles||[]).map(p=>'<option value="'+p.id+'"'+(w.profile===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'+
      '<input type="number" step="0.01" value="'+esc(w.override)+'" data-wo="'+i+'" placeholder="авто" style="width:84px" title="цена вручную (оверрайд)">'+
      '<span class="hint" style="margin: 0">= '+rev.toFixed(0)+'</span>'+
      '<button class="btn sm ghost" data-wrm="'+i+'" style="margin-left: auto">×</button></div>'+
      ((w.reasons&&w.reasons.length)?'<div class="m" style="margin-top: var(--sp-2)">'+esc(w.reasons.join(' · '))+'</div>':'')+
      (!w.billable?('<input type="text" data-wrsn="'+i+'" value="'+esc(w.billable_reason||'')+'" placeholder="причина гарантийности (необязательно)" style="width:100%;margin-top: var(--sp-2);font-size: var(--fs-3)">'):'');
    box.appendChild(d); });
  box.querySelectorAll('[data-wn]').forEach(inp=>inp.oninput=()=>{ curWorks[inp.dataset.wn].name=inp.value; });
  box.querySelectorAll('[data-wo]').forEach(inp=>inp.oninput=()=>{ curWorks[inp.dataset.wo].override=inp.value; jobTotals(); });
  box.querySelectorAll('[data-wh]').forEach(inp=>inp.oninput=()=>{ curWorks[inp.dataset.wh].hours=parseFloat(inp.value)||0; jobTotals(); });
  box.querySelectorAll('[data-wrsn]').forEach(inp=>inp.oninput=()=>{ curWorks[inp.dataset.wrsn].billable_reason=inp.value; });
  box.querySelectorAll('[data-wp]').forEach(sel=>sel.onchange=()=>{ curWorks[sel.dataset.wp].profile=sel.value; });
  box.querySelectorAll('[data-wb]').forEach(b=>b.onclick=()=>{ const w=curWorks[b.dataset.wb]; w.billable=!w.billable; w.profile=defaultProfileId(w.billable); renderJobWorks(); });
  box.querySelectorAll('[data-wrm]').forEach(b=>b.onclick=()=>{ curWorks.splice(b.dataset.wrm,1); renderJobWorks(); });
  jobTotals(); }
function workCost(w){ return (+w.hours||0)*((appSettings.costs&&appSettings.costs.hour)||0); }
function jobTotals(){ jobHead(); const h=curWorks.reduce((a,w)=>a+(+w.hours||0),0); const r=curWorks.reduce((a,w)=>a+workRevenue(w),0); const c=curWorks.reduce((a,w)=>a+workCost(w),0); $('jbTotals').textContent='Итого: '+h.toFixed(2)+' ч · выручка '+r.toFixed(0)+' · труд '+c.toFixed(0)+' · прибыль '+(r-c).toFixed(0)+' (по профилям строк; дорога/суточные — в выезде)'; }
$('jobCancel').onclick=()=>switchTab(jobBack, jobBackSub);
$('jobSave').onclick=async ()=>{ const client_id=$('jbClient').value; if(!client_id){ $('jobErr').textContent='Выбери клиента.'; return; } if(curWorks.some(w=>w.custom&&!w.name.trim())){ $('jobErr').textContent='У своей работы укажи название.'; return; }
  const rec={client_id,equipment_id:$('jbEquip').value||null,status:$('jbStatus').value,scheduled_date:$('jbDate').value||null,time_window:$('jbWindow').value.trim(),due_date:$('jbDue').value||null,assigned_engineer:$('jbEng').value||null,notes:$('jbNotes').value.trim(),at_depot:!!jobAtDepot,depot_id:(jobAtDepot?($('jbDepotSel').value||null):null)};
  $('jobSave').disabled=true;
  try{ let jobId=jobEditId;
    if(jobEditId){ const {error}=await sb.from('jobs').update(rec).eq('id',jobEditId); if(error) throw error; }
    else { rec.created_by=session.user.id; const {data,error}=await sb.from('jobs').insert(rec).select('id').single(); if(error) throw error; jobId=data.id; }
    await sb.from('job_works').delete().eq('job_id',jobId);
    if(curWorks.length){ const rows=curWorks.map(w=>({job_id:jobId,work_id:w.work_id||null,title:w.name||'',hours:w.hours,billable:w.billable,billable_reason:w.billable_reason||'',tariff_profile:(w.profile||null),revenue:workRevenue(w),revenue_override:((w.override!==''&&w.override!=null)?(+w.override||0):null)})); const {error}=await sb.from('job_works').insert(rows); if(error) throw error; }
    if(canWrite() && rec.status==='done' && rec.equipment_id && curWorks.some(w=>w.billable)){ const days=parseInt($('jbWarrDays').value)||0; if(days>0){ try{ const {data:ex}=await sb.from('repair_warranties').select('id').eq('origin_job_id',jobId).limit(1); if(!ex||!ex.length){ const until=new Date(Date.now()+days*86400000).toISOString().slice(0,10); const covers=curWorks.filter(w=>w.billable).map(w=>w.name).filter(Boolean).join(', ').slice(0,300); const {error:rwErr}=await sb.from('repair_warranties').insert({equipment_id:rec.equipment_id,origin_job_id:jobId,covers,until}); if(!rwErr) showToast('Гарантия на ремонт до '+until); else notify('Гарантия на ремонт не создалась: '+rwErr.message,'err'); } }catch(e2){ notify('Гарантия на ремонт не создалась: '+(e2.message||e2),'err'); } } }
    if(rec.status==='done' && rec.equipment_id){ try{ await sb.rpc('register_equipment_visit',{p_job:jobId}); await reloadEquip(); }catch(e3){ notify('Заявка сохранена, но визит по технике не отметился: '+(e3.message||e3),'err'); } }
    switchTab(jobBack, jobBackSub); await renderJobs(); await refreshStats(); showToast('Заявка сохранена');
  }catch(err){ $('jobErr').textContent='Ошибка: '+(err.message||err); } finally{ $('jobSave').disabled=false; } };
async function delJob(id){ if(!await confirmDialog('Удалить заявку?',{danger:true,okText:'Удалить'})) return; const {error}=await sb.from('jobs').update({deleted_at:new Date().toISOString()}).eq('id',id); if(error){ notify(error.message,'err'); return; } await renderJobs(); await refreshStats();
  undoToast('Заявка удалена', async ()=>{ const {error:e2}=await sb.from('jobs').update({deleted_at:null}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await renderJobs(); showToast('Восстановлено'); }); }

// ---------- trips ----------
let trips=[], tripJobsAll=[], curTripJobs=new Set(), tripEditId=null, tripRouteKeys=new Set();
const ST_TRIP={planned:'план',assigned:'назначен',in_progress:'в работе',finished:'на проверке',done:'завершён',cancelled:'отменён'};
let tripRoute={km:0,driveH:0,geometry:null}, tripRouteStops=[], tripVariants=[], tripVarSel=0, tripStart=null, tripOverrides={revenue:'',cost:'',road:{}};
async function loadTripJobs(){ const {data}=await sb.from('jobs').select('id,status,scheduled_date,equipment_id,at_depot, clients(name,lat,lng), equipment(model,lat,lng), job_works(hours,billable,revenue,tariff_profile)').is('deleted_at',null).or('at_depot.is.null,at_depot.eq.false').order('created_at',{ascending:false}); tripJobsAll=data||[]; }
function tripStops(){ const stops=[]; const seen=new Set(); tripJobsAll.filter(j=>curTripJobs.has(j.id)).forEach(j=>{ const eq=j.equipment; const lat=(eq&&eq.lat!=null)?eq.lat:(j.clients?j.clients.lat:null); const lng=(eq&&eq.lng!=null)?eq.lng:(j.clients?j.clients.lng:null); if(lat==null) return; const nm=(eq&&eq.lat!=null)?((j.clients?j.clients.name:'')+' · '+(eq.model||'')):(j.clients?j.clients.name:''); const key=(+lat).toFixed(5)+','+(+lng).toFixed(5); if(seen.has(key)) return; seen.add(key); stops.push({name:nm,lat,lng}); }); return stops; }
const keyOf=s=>(+s.lat).toFixed(5)+','+(+s.lng).toFixed(5);
function syncRouteStops(){ const jobStops=tripStops(); const desired=new Set(jobStops.map(keyOf));
  tripRouteStops=tripRouteStops.filter(s=>s.type!=='job'||desired.has(keyOf(s)));
  const present=new Set(tripRouteStops.map(keyOf));
  jobStops.forEach(s=>{ if(!present.has(keyOf(s))) tripRouteStops.push({type:'job',name:s.name,lat:s.lat,lng:s.lng}); }); }
function resetTripRoute(){ tripRoute={km:0,driveH:0,geometry:null}; tripVariants=[]; if($('tpVariants')) $('tpVariants').innerHTML=''; if($('tpRouteStatus')) $('tpRouteStatus').textContent='маршрут не построен'; tripEcon(); }
function renderRouteStops(){ const box=$('tpRouteStops'); const hasAny=tripStart||tripRouteStops.length; box.innerHTML=hasAny?'':'<div class="hint">Точек нет. Отметь заявки или добавь промежуточную.</div>';
  let n=0;
  if(tripStart){ n++; const d=document.createElement('div'); d.className='eqitem'; d.style.cssText='display:flex;gap: var(--sp-3);align-items:center'; d.innerHTML='<span class="grow">'+n+'. '+esc(tripStart.name||'старт')+' <span class="pill">старт</span></span>'; box.appendChild(d); }
  tripRouteStops.forEach((s,i)=>{ n++; const d=document.createElement('div'); d.className='eqitem'; d.style.cssText='display:flex;gap: var(--sp-3);align-items:center';
    const tag=s.type==='wp'?' <span class="pill">пром.</span>':(s.type==='place'?' <span class="pill">депо</span>':'');
    d.innerHTML='<span class="grow">'+n+'. '+esc(s.name||'точка')+tag+'</span>'+
      '<button class="btn sm ghost" data-up="'+i+'">↑</button><button class="btn sm ghost" data-down="'+i+'">↓</button>'+(s.type==='wp'?'<button class="btn sm ghost" data-wprm="'+i+'">×</button>':'');
    box.appendChild(d); });
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveStop(+b.dataset.up,-1));
  box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveStop(+b.dataset.down,1));
  box.querySelectorAll('[data-wprm]').forEach(b=>b.onclick=()=>{ tripRouteStops.splice(+b.dataset.wprm,1); resetTripRoute(); renderRouteStops(); }); }
function moveStop(i,dir){ const j=i+dir; if(j<0||j>=tripRouteStops.length) return; const a=tripRouteStops; const t=a[i]; a[i]=a[j]; a[j]=t; resetTripRoute(); renderRouteStops(); }
// Геометрия маршрута перед сохранением прореживается: ORS отдаёт точку каждые
// 20–50 м, и на маршруте в 1700 км это до 2 МБ JSON — такой запрос база
// отклоняет. Для карты подробность не нужна, форма линии сохраняется.
function slimGeometry(g){
  if(!g) return null;
  try{
    const coords=(g.geometry&&g.geometry.coordinates)||g.coordinates;
    if(!Array.isArray(coords)||coords.length<3) return g;
    const before=coords.length;
    const slim=simplifyLine(coords,0.0001);   // ~11 м
    if(slim.length===before) return g;
    console.info('Геометрия маршрута: '+before+' → '+slim.length+' точек');
    if(g.geometry) return {...g,geometry:{...g.geometry,coordinates:slim}};
    return {...g,coordinates:slim};
  }catch(e){ return g; }
}
function routeAll(){ return (tripStart?[{type:'start',name:tripStart.name,lat:tripStart.lat,lng:tripStart.lng}]:[]).concat(tripRouteStops); }
let ganttTrips=[], gDayW=36;
function wireGantt(box){
  box.querySelectorAll('[data-gt]').forEach(bar=>{
    if(!canWrite()){ bar.onclick=()=>showTripOnMap(bar.dataset.gt); return; }
    bar.style.cursor='grab'; bar.title=(bar.title||'')+' · тяни, чтобы перенести даты';
    let sx=0, dx=0, orig=0, on=false;
    const move=ev=>{ if(!on) return; const p=ev.touches?ev.touches[0]:ev; dx=p.clientX-sx; if(ev.cancelable) ev.preventDefault(); bar.style.left=(orig+dx)+'px'; };
    const up=async ()=>{ if(!on) return; on=false; bar.style.cursor='grab'; bar.style.opacity=''; bar.style.zIndex='';
      document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
      document.removeEventListener('touchmove',move); document.removeEventListener('touchend',up);
      if(Math.abs(dx)<4){ bar.style.left=orig+'px'; openTrip(bar.dataset.gt); return; }
      const days=Math.round(dx/gDayW); if(!days){ bar.style.left=orig+'px'; return; }
      await shiftTrip(bar.dataset.gt,days); };
    const down=ev=>{ const p=ev.touches?ev.touches[0]:ev; sx=p.clientX; dx=0; on=true; orig=parseFloat(bar.style.left)||0;
      bar.style.cursor='grabbing'; bar.style.opacity='.75'; bar.style.zIndex='5';
      document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
      document.addEventListener('touchmove',move,{passive:false}); document.addEventListener('touchend',up); };
    bar.addEventListener('mousedown',down); bar.addEventListener('touchstart',down,{passive:true}); }); }
async function shiftTrip(id,days){ const t=ganttTrips.find(x=>x.id==id); if(!t||!t.date_from){ renderGantt(); return; }
  const mv=ds=>{ if(!ds) return null; const d=new Date(ds+'T00:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); };
  const oldFrom=t.date_from, oldTo=t.date_to; const from=mv(t.date_from), to=t.date_to?mv(t.date_to):null;
  const {error}=await sb.from('trips').update({date_from:from,date_to:to}).eq('id',id);
  if(error){ notify('Не удалось перенести: '+error.message,'err'); await renderGantt(); return; }
  await renderGantt();
  undoToast('Выезд перенесён на '+from+(to&&to!==from?(' → '+to):''), async ()=>{ const {error:e2}=await sb.from('trips').update({date_from:oldFrom,date_to:oldTo}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await renderGantt(); showToast('Даты возвращены'); }); }
// ── Гант ────────────────────────────────────────────────────────────────────
// Раньше окно считалось само: от самого раннего выезда до самого позднего,
// по 36 px на день. Один выезд в октябре растягивал шкалу на полгода, полоса
// уезжала в горизонтальный скролл, и увидеть «что на этой неделе» было
// нельзя. Теперь период выбирают, а ширина дня считается от окна.
let ganttDays=30;          // сколько дней в окне
let ganttShift=0;          // на сколько окон сдвинуты от «сегодня»
const GANTT_PERIODS=[[14,'2 недели'],[30,'месяц'],[90,'квартал']];
function ganttFrom(){
  // Окно начинается за три дня до сегодня: вчерашнее ещё нужно видеть.
  const d=new Date(); d.setDate(d.getDate()-3+ganttShift*ganttDays); return d;
}
function renderGanttBar(){
  const box=$('ganttBar'); if(!box) return;
  const d0=ganttFrom(), d1=new Date(d0); d1.setDate(d1.getDate()+ganttDays-1);
  box.innerHTML='<div class="seg" id="ganttPeriod">'
      +GANTT_PERIODS.map(([n,l])=>'<button'+(n===ganttDays?' class="on"':'')+' data-gd="'+n+'">'+l+'</button>').join('')
    +'</div>'
    +'<button class="btn sm" data-gnav="-1" title="Раньше">←</button>'
    +'<button class="btn sm" data-gnav="0">Сегодня</button>'
    +'<button class="btn sm" data-gnav="1" title="Позже">→</button>'
    +'<span class="hint" style="margin: 0">'+esc(tripPeriod(todayISO(d0),todayISO(d1)))+'</span>';
  box.querySelectorAll('[data-gd]').forEach(b=>b.onclick=()=>{ ganttDays=+b.dataset.gd; renderGanttBar(); renderGantt(); });
  box.querySelectorAll('[data-gnav]').forEach(b=>b.onclick=()=>{
    const v=+b.dataset.gnav; ganttShift=v?(ganttShift+v):0; renderGanttBar(); renderGantt(); });
}
async function renderGantt(){ await ensureRefs(); const box=$('gantt'); if(!box) return;
  renderGanttBar();
  const {data,error}=await sb.from('trips').select('*').is('deleted_at',null).order('date_from'); if(error){ box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  let src=(data||[]).filter(t=>t.date_from); if(role==='engineer') src=src.filter(t=>t.lead_engineer===session.user.id); ganttTrips=src;
  if(!src.length){ box.innerHTML='<div class="hint">Выездов с датами нет.</div>'; return; }
  const dayMs=86400000, today=todayISO();
  const d0=ganttFrom(); d0.setHours(0,0,0,0);
  const N=ganttDays;
  // Дни считаем календарём, а не прибавлением суток в миллисекундах:
  // в ночь перевода часов «плюс 24 часа» даёт 23:00 предыдущего дня,
  // и в шкале появился бы задвоенный день.
  const dayAt=i=>new Date(d0.getFullYear(),d0.getMonth(),d0.getDate()+i);
  const from=todayISO(d0), to=todayISO(dayAt(N-1));
  // Ширина дня — от ширины окна, а не константой. Подпись имени инженера
  // занимает свою колонку, её вычитаем.
  const avail=Math.max(320,(box.clientWidth||box.parentElement.clientWidth||900)-2);
  const dayW=Math.max(6,Math.floor(avail/N));
  gDayW=dayW;
  const off=ds=>Math.round((new Date(ds+'T00:00:00')-d0)/dayMs);
  const vis=src.filter(t=>{ const a=t.date_from, b=t.date_to||t.date_from; return !(b<from||a>to); });
  if(!vis.length){ box.innerHTML='<div class="hint">В этом периоде выездов нет.</div>'; return; }
  const groups={}; vis.forEach(t=>{ const eng=t.lead_engineer||'__none'; (groups[eng]=groups[eng]||[]).push(t); });
  // На узком дне число не влезает: подписываем только понедельники.
  const dense=dayW<22;
  let head='<div class="gantt-head" style="width:'+(N*dayW)+'px">';
  for(let i=0;i<N;i++){ const d=dayAt(i); const iso=todayISO(d);
    const wknd=(d.getDay()===0||d.getDay()===6);
    const lbl=dense?(d.getDay()===1?String(d.getDate()):''):String(d.getDate());
    head+='<div class="gantt-day'+(iso===today?' today':'')+(wknd?' wknd':'')+'" style="width:'+dayW+'px">'+lbl+'</div>'; }
  head+='</div>';
  let rows=''; Object.keys(groups).forEach(eng=>{ const p=profilesList.find(x=>x.id===eng); const nm=p?(p.full_name||'инженер'):(eng==='__none'?'Без инженера':'—');
    rows+='<div class="gantt-eng">'+esc(nm)+'</div><div class="gantt-row" style="width:'+(N*dayW)+'px">';
    groups[eng].forEach(t=>{ const s=off(t.date_from); const e=off(t.date_to||t.date_from);
      if(s>=N||e<0) return; const s2=Math.max(0,s); const span=Math.max(1,Math.min(N-1,e)-s2+1);
      const w=Math.max(4,span*dayW-4); const pts=(t.route_stops||[]).filter(x=>x&&x.name&&x.type!=='start'&&x.type!=='place'&&x.type!=='wp').map(x=>String(x.name).split(' · ')[0]); const label=pts[0]||t.vehicle_label||'выезд'; rows+='<div class="gantt-bar st-'+esc(t.status)+'" style="left:'+(s2*dayW)+'px;width:'+w+'px" data-gt="'+t.id+'" title="'+esc((t.date_from||'')+' → '+(t.date_to||'')+(pts.length?(' · '+pts.join(', ')):''))+'">'+esc(label)+'</div>'; });
    rows+='</div>'; });
  box.innerHTML='<div class="gantt-wrap">'+head+rows+'</div>';
  wireGantt(box); }
function wireKanbanDrag(box,onDrop){ if(!canWrite()) return;
  box.querySelectorAll('.kcard').forEach(card=>{ card.setAttribute('draggable','true');
    card.addEventListener('dragstart',e=>{ card.classList.add('dragging'); try{ e.dataTransfer.setData('text/plain',card.dataset.kid); e.dataTransfer.effectAllowed='move'; }catch(err){} });
    card.addEventListener('dragend',()=>{ card.classList.remove('dragging'); box.querySelectorAll('.kcol').forEach(c=>c.classList.remove('over')); }); });
  box.querySelectorAll('.kcol').forEach(col=>{
    col.addEventListener('dragover',e=>{ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(err){} col.classList.add('over'); });
    col.addEventListener('dragleave',()=>col.classList.remove('over'));
    col.addEventListener('drop',async e=>{ e.preventDefault(); col.classList.remove('over');
      let id=''; try{ id=e.dataTransfer.getData('text/plain'); }catch(err){}
      const st=col.dataset.kst; if(id&&st) await onDrop(id,st); }); }); }
async function dropJob(id,st){ const j=jobs.find(x=>x.id==id); if(!j||j.status===st) return; const old=j.status;
  const {error}=await sb.from('jobs').update({status:st}).eq('id',id); if(error){ notify(error.message,'err'); return; }
  j.status=st; await renderJobs(); await refreshStats();
  undoToast('Заявка → «'+(ST[st]||st)+'»', async ()=>{ const {error:e2}=await sb.from('jobs').update({status:old}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await renderJobs(); showToast('Статус возвращён'); }); }
// Канбан и выпадающий список статуса раньше писали статус напрямую.
// Триггер trg_guard_trip_status это запрещает: переходы в «в работе»,
// «на проверке» и «завершён» должны идти через trip_start / trip_finish /
// trip_confirm, потому что они пишут started_at, finished_at, fact_km
// и запускают детектор стоянок. Именно так выезд 33d36776 и оказался
// in_progress при пустом started_at — его перетащили, а не нажали «Начать».
const TRIP_KIND={in_progress:'start',finished:'finish',done:'confirm'};
async function dropTrip(id,st){ const t=trips.find(x=>x.id==id); if(!t||t.status===st) return; const old=t.status;
  const kind=TRIP_KIND[st];
  if(kind){ await tripAction(id,kind); await renderTrips(); return; }
  const {error}=await sb.from('trips').update({status:st}).eq('id',id); if(error){ notify(error.message,'err'); return; }
  t.status=st; await renderTrips();
  // Откат предлагаем, только если возвращаться некуда через RPC: отменить
  // старт, финиш или подтверждение нельзя — они уже записали время, факт
  // и стоянки.
  if(TRIP_KIND[old]){ showToast('Выезд → «'+(ST_TRIP[st]||st)+'»'); return; }
  undoToast('Выезд → «'+(ST_TRIP[st]||st)+'»', async ()=>{ const {error:e2}=await sb.from('trips').update({status:old}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await renderTrips(); showToast('Статус возвращён'); }); }
const TRIP_STATUS_ORDER=['planned','assigned','in_progress','finished','done','cancelled'];
let tripVisible={planned:true,assigned:true,in_progress:true,finished:true,done:false,cancelled:false};
function renderTripChips(){ const box=$('tripStatusChips'); if(!box) return; box.innerHTML=TRIP_STATUS_ORDER.map(s=>'<span class="chip'+(tripVisible[s]?' on':'')+'" data-ts="'+s+'">'+esc(ST_TRIP[s])+'</span>').join('');
  box.querySelectorAll('[data-ts]').forEach(c=>c.onclick=()=>{ tripVisible[c.dataset.ts]=!tripVisible[c.dataset.ts]; renderTripChips(); renderTrips(); }); }
function tripCard(t){ const e=t.econ_snapshot||{}; const eng=profilesList.find(p=>p.id===t.lead_engineer); const share=e.totalHours?Math.round((e.warrantyHours/e.totalHours)*100):0;
  const pts=(t.route_stops||[]).filter(s=>s&&s.name&&s.type!=='start'&&s.type!=='place'&&s.type!=='wp'&&!/^точка\s*\d+$/i.test(String(s.name).trim())).map(s=>String(s.name).split(' · ')[0].trim()).filter(Boolean);
  const uniq=[...new Set(pts)]; const dates=(t.date_from||'?')+' → '+(t.date_to||'?');
  const title=uniq.length?(uniq.slice(0,2).join(', ')+(uniq.length>2?(' +'+(uniq.length-2)):'')):dates;
  const mb=[]; if(uniq.length) mb.push(dates); if(t.vehicle_label) mb.push(t.vehicle_label);
  const head='<h4>'+esc(title)+'</h4>'+(mb.length?'<div class="meta">'+esc(mb.join(' · '))+'</div>':'');
  const meta=canWrite()
    ? '<div class="meta">'+((t.trip_jobs||[]).length)+' заявок · выручка '+(e.revenue||0)+(e.profit!=null?(' · приб. '+Math.round(e.profit)):'')+' · гар. '+share+'%'+(eng?' · '+esc(eng.full_name||'инженер'):'')+'</div>'
    : '<div class="meta">'+((t.trip_jobs||[]).length)+' заявок'+(e.km!=null?(' · '+(+e.km).toFixed(0)+' км'):'')+(e.driveH!=null?(' · '+(+e.driveH).toFixed(1)+' ч'):'')+'</div>';
  const mv=canWrite()?('<select class="kmove" data-tstat="'+t.id+'" title="Сменить статус">'+TRIP_STATUS_ORDER.map(s=>'<option value="'+s+'"'+(s===t.status?' selected':'')+'>'+esc(ST_TRIP[s])+'</option>').join('')+'</select>'):'';
  const acts=canWrite()
    ? '<div class="acts">'+mv+'<button class="btn sm" data-tedit="'+t.id+'">открыть</button><button class="btn sm" data-tmap="'+t.id+'" title="На карте">карта</button><button class="btn sm" data-tgm="'+t.id+'" title="Google Maps">⌖</button><button class="btn sm ghost" data-tdel="'+t.id+'" title="Удалить выезд">×</button></div>'
    : '<div class="acts"><button class="btn sm" data-tmap="'+t.id+'">карта</button><button class="btn sm" data-tgm="'+t.id+'">⌖ GMaps</button></div>';
  return '<div class="kcard" data-kid="'+t.id+'">'+head+meta+acts+'</div>'; }
function wireTripCards(box){
  box.querySelectorAll('[data-tedit]').forEach(b=>b.onclick=()=>openTrip(b.dataset.tedit));
  box.querySelectorAll('[data-tmap]').forEach(b=>b.onclick=()=>showTripOnMap(b.dataset.tmap));
  box.querySelectorAll('[data-tgm]').forEach(b=>b.onclick=()=>tripGmaps(b.dataset.tgm));
  box.querySelectorAll('[data-tdel]').forEach(b=>b.onclick=()=>delTrip(b.dataset.tdel));
  box.querySelectorAll('[data-tstat]').forEach(sel=>sel.onchange=async()=>{ const id=sel.dataset.tstat, st=sel.value;
    const kind=TRIP_KIND[st];
    if(kind){ await tripAction(id,kind); renderTrips(); return; }
    const {error}=await sb.from('trips').update({status:st}).eq('id',id); if(error){ notify(error.message,'err'); renderTrips(); return; } const t=trips.find(x=>x.id==id); if(t) t.status=st; showToast('Статус: '+(ST_TRIP[st]||st)); renderTrips(); }); }
async function renderTrips(){ await ensureRefs(); renderTripChips();
  const {data,error}=await sb.from('trips').select('*, trip_jobs(job_id)').is('deleted_at',null).order('created_at',{ascending:false});
  const box=$('tripList'); if(error){ box.className=''; box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  trips=data||[]; const q=$('tripSearch').value.trim().toLowerCase();
  const match=t=>(!q||((t.vehicle_label||'')+' '+(t.date_from||'')+' '+(t.date_to||'')).toLowerCase().includes(q));
  const cols=TRIP_STATUS_ORDER.filter(s=>tripVisible[s]);
  if(!cols.length){ box.className=''; box.innerHTML='<div class="hint">Выберите хотя бы один статус выше.</div>'; return; }
  if(!trips.length){ box.className=''; box.innerHTML='<div class="hint">'+(canWrite()?'Выездов нет. Собери первый из заявок на карте.':'На тебя пока не назначены выезды.')+'</div>'; return; }
  box.className='kanban';
  box.innerHTML=cols.map(s=>{ const items=trips.filter(t=>t.status===s&&match(t));
    const TEMPTY={planned:'Запланированных выездов нет',assigned:'Назначенных нет',
      in_progress:'Никто не в пути',finished:'Завершённых нет',done:'Подтверждённых нет',
      cancelled:'Отменённых нет'};
    const cards=items.map(t=>tripCard(t)).join('')
      ||'<div class="kempty">'+esc(TEMPTY[s]||'Пусто')+'</div>';
    return '<div class="kcol" data-kst="'+s+'"><div class="kcol-h"><span>'+esc(ST_TRIP[s])+'</span><span class="cnt">'+items.length+'</span></div><div class="kcol-b">'+cards+'</div></div>'; }).join('');
  wireTripCards(box); wireKanbanDrag(box,dropTrip); }
$('tripSearch').oninput=renderTrips; $('tripAdd').onclick=()=>{ if(canWrite()) openTrip(null); };
async function openTrip(id){ await ensureRefs(); await loadTripJobs();
  // econCompute считает дорогу по плательщикам через turf, когда готовых
  // километров в выезде нет. Без turf он молча уйдёт в плоскую ветку и
  // покажет другую цифру — поэтому ждём здесь, до первого tripCalc().
  await ensureTurf().catch(()=>{}); tripEditId=id; const t=id?getTrip(id):null; tripMainJobId=(t&&t.main_job_id)||null;
  $('tpFrom').value=t?(t.date_from||''):''; $('tpTo').value=t?(t.date_to||''):''; $('tpVeh').innerHTML='<option value="">— авто —</option>'+vehicles.map(v=>'<option value="'+v.id+'">'+esc(v.name+(v.plate?(' · '+v.plate):''))+'</option>').join(''); $('tpVeh').value=t&&t.vehicle_id?t.vehicle_id:''; updateVehInfo(); $('tpVeh').onchange=()=>{ updateVehInfo(); tripHead(); }; $('tpNotes').value=t?(t.notes||''):'';
  $('tpEng').innerHTML='<option value="">— инженер —</option>'+profilesList.map(p=>'<option value="'+p.id+'">'+esc((p.full_name||'без имени')+' ('+p.role+')')+'</option>').join('');
  $('tpEng').value=t&&t.lead_engineer?t.lead_engineer:''; $('tpStatus').value=t?t.status:'planned';
  curTripJobs=new Set(); if(t){ const {data}=await sb.from('trip_jobs').select('job_id').eq('trip_id',id); (data||[]).forEach(r=>curTripJobs.add(r.job_id)); }
  const ro=!canWrite(); ['tpFrom','tpTo','tpVeh','tpEng','tpStatus','tpNotes','tpSave'].forEach(x=>{ if($(x)) $(x).disabled=ro; });
  const es=(t&&t.econ_snapshot)||{}; tripRoute={km:es.km||0,driveH:es.driveH||0,geometry:(t&&t.route_geometry)||null}; tripVariants=[]; if($('tpVariants')) $('tpVariants').innerHTML='';
  const ovs=(t&&t.overrides)||{}; tripOverrides={revenue:(ovs.revenue!=null?String(ovs.revenue):''),cost:(ovs.cost!=null?String(ovs.cost):''),road:(ovs.road||{})}; $('tpOvRev').value=tripOverrides.revenue; $('tpOvCost').value=tripOverrides.cost;
  const saved=(t&&t.route_stops)?t.route_stops:[]; const st=saved.find(x=>x.type==='start'); tripStart=st?{name:st.name,lat:st.lat,lng:st.lng}:null;
  tripRouteKeys=new Set(saved.filter(s=>s.lat!=null&&s.lng!=null).map(s=>(+s.lat).toFixed(5)+','+(+s.lng).toFixed(5))); if($('tpJobsRoute')) $('tpJobsRoute').checked=true;
  tripRouteStops=saved.filter(x=>x.type!=='start').map(x=>({type:x.type||'job',name:x.name,lat:x.lat,lng:x.lng})); syncRouteStops(); renderRouteStops();
  $('tpRouteStatus').innerHTML=tripRoute.km?('<span class="ok">'+tripRoute.km.toFixed(1)+' км · '+tripRoute.driveH.toFixed(1)+' ч</span>'):'';
  drawTripMap(t);
  renderTripJobs(); $('tripErr').textContent=''; tripEcon(); switchTab('trip');
  const pane=document.querySelector('.view-trip .pane'); if(pane) pane.scrollTop=0; }
// Шапка страницы: чем занят выезд и сколько он приносит. Раньше это надо
// было собирать глазами из четырёх мест модалки.
function tripHead(){
  const per=tripPeriod($('tpFrom').value,$('tpTo').value);
  $('tripTitle').textContent=tripEditId?('Выезд '+per):'Новый выезд';
  $('tripCrumb').textContent=tripEditId?per:'Новый выезд';
  const veh=vehicles.find(x=>x.id==$('tpVeh').value);
  const eng=profilesList.find(x=>x.id==$('tpEng').value);
  const e=tripCalc();
  const parts=[];
  if(veh) parts.push(esc(veh.name+(veh.plate?(' · '+veh.plate):'')));
  if(eng) parts.push(esc(eng.full_name||eng.role));
  parts.push(e.jobCount+' '+plural(e.jobCount,'заявка','заявки','заявок'));
  if(e.km>0) parts.push(e.km.toFixed(0)+' км · '+(e.driveH+e.workH).toFixed(1)+' ч');
  $('tripSub').innerHTML=parts.join(' · ')||'—';
  const pc=e.profit>=0?'var(--green)':'var(--red)';
  $('tripHeadEcon').innerHTML='<div class="te-k">Прибыль</div>'
    +'<div class="te-v" style="color:'+pc+'">'+Math.round(e.profit).toLocaleString('ru-RU')+' '+e.cur+'</div>'
    +'<div class="te-s">маржа '+e.margin.toFixed(0)+'% · выручка '+Math.round(e.rev).toLocaleString('ru-RU')+'</div>';
  if($('tpJobsCnt')) $('tpJobsCnt').textContent=e.jobCount+' из '+tripJobsAll.length;
  if($('tpRouteKm')) $('tpRouteKm').textContent=tripRoute.km?(tripRoute.km.toFixed(0)+' км'):'—';
}
function plural(n,a,b,c){ n=Math.abs(n)%100; const n1=n%10;
  if(n>10&&n<20) return c; if(n1>1&&n1<5) return b; if(n1===1) return a; return c; }
// «07–11 сентября» вместо «2026-09-07 — 2026-09-11». Внутри одного месяца
// название пишется один раз, на стыке месяцев — оба.
const MON_RU=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function tripPeriod(df,dt){
  if(!df) return 'даты не заданы';
  const a=new Date(df+'T00:00:00'); if(isNaN(a)) return df;
  const b=(dt&&dt!==df)?new Date(dt+'T00:00:00'):null;
  const dd=x=>String(x.getDate()).padStart(2,'0');
  if(!b||isNaN(b)) return dd(a)+' '+MON_RU[a.getMonth()];
  if(a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear())
    return dd(a)+'\u2013'+dd(b)+' '+MON_RU[b.getMonth()];
  return dd(a)+' '+MON_RU[a.getMonth()]+'\u2013'+dd(b)+' '+MON_RU[b.getMonth()];
}
function jobKey(j){ const eq=j.equipment; const lat=(eq&&eq.lat!=null)?eq.lat:(j.clients?j.clients.lat:null); const lng=(eq&&eq.lng!=null)?eq.lng:(j.clients?j.clients.lng:null); if(lat==null) return null; return (+lat).toFixed(5)+','+(+lng).toFixed(5); }
let tripMainJobId=null;   // основная заявка выезда (для маржинального километража)
function renderTripJobs(){ const box=$('tpJobs');
  const routeOnly=$('tpJobsRoute')?$('tpJobsRoute').checked:false; const useFilter=routeOnly&&tripRouteKeys.size>0;
  let list=tripJobsAll; if(useFilter) list=tripJobsAll.filter(j=>curTripJobs.has(j.id)||tripRouteKeys.has(jobKey(j)));
  const hidden=tripJobsAll.length-list.length;
  box.innerHTML=list.length?'':'<div class="hint">'+(useFilter?'Нет заявок по точкам этого маршрута. Снимите галочку, чтобы показать все.':'Заявок нет.')+'</div>';
  list.forEach(j=>{ const w=j.job_works||[]; const rev=w.reduce((a,x)=>a+(+x.revenue||0),0); const d=document.createElement('label'); d.className='eqitem'; d.style.cssText='display:flex;gap: var(--sp-3);align-items:center';   // выручка: и платные, и гарантийные
    // Радио «основная»: её плательщик несёт базовый пробег, остальные — крюк.
    // Осмысленна только для заявок, включённых в выезд.
    const isMain=(tripMainJobId===j.id);
    const mainRadio=curTripJobs.has(j.id)
      ? '<input type="radio" name="tpMain" data-tjmain="'+j.id+'" '+(isMain?'checked':'')
        +' title="основная заявка выезда" style="width:auto;margin-left: var(--sp-2)">'
      : '<span style="width:13px;display:inline-block"></span>';
    d.innerHTML='<input type="checkbox" data-tj="'+j.id+'" '+(curTripJobs.has(j.id)?'checked':'')+' style="width:auto">'+mainRadio+
      '<span class="grow">'+esc(j.clients?j.clients.name:'—')+' · '+esc(ST[j.status]||j.status)+(j.scheduled_date?' · '+esc(j.scheduled_date):'')+'</span>'+
      '<span class="hint" style="margin: 0">'+(rev?('выручка '+rev):'гар.')+'</span>';
    box.appendChild(d); });
  if(useFilter&&hidden>0){ const h=document.createElement('div'); h.className='hint'; h.style.marginTop='6px'; h.textContent='Скрыто '+hidden+' заявок вне маршрута.'; box.appendChild(h); }
  box.querySelectorAll('[data-tjmain]').forEach(r=>r.onchange=()=>{
    tripMainJobId=r.checked?r.dataset.tjmain:null; renderTripJobs(); });
  box.querySelectorAll('[data-tj]').forEach(c=>c.onchange=()=>{ if(c.checked) curTripJobs.add(c.dataset.tj); else curTripJobs.delete(c.dataset.tj); const before=tripRouteStops.map(keyOf).join('|'); syncRouteStops(); const after=tripRouteStops.map(keyOf).join('|'); renderRouteStops(); if(before!==after) resetTripRoute(); else tripEcon(); }); }
// tariff_profiles попадают в снапшот наравне с тарифами и себестоимостями
// (аудит, В10). Раньше их там не было, и roadByPayer читал текущие профили —
// поэтому правка ставки задним числом переписывала экономику уже закрытых
// выездов. Снапшот на то и снапшот.
function tripT(){ return {shift_hours:appSettings.shift_hours,deviation_pct:appSettings.deviation_pct,tariffs:appSettings.tariffs,costs:appSettings.costs,currency:appSettings.currency,tariff_profiles:appSettings.tariff_profiles||[]}; }
// Снимок экономики для econ_snapshot. Единственное место, где он собирается.
//
// Считаем ДВАЖДЫ — по плану и по факту — и храним обе себестоимости.
// Раньше в поле cost лежало то одно, то другое: карточка выезда передавала
// в econCompute факт, планировщик — нет. Дашборд складывает econ_snapshot.cost
// по всем выездам, то есть суммировал разные величины, и общая себестоимость
// компании менялась от того, каким экраном выезд сохранили последним.
//
// Выручка на факт не смотрит по замыслу формулы: она согласована
// с плательщиком заранее (обоснование — в src/core/economics.js).
// Поэтому раздваиваем только себестоимость, прибыль и маржу.
function econSnapshot(jobs, km, driveH, T, ov, ctx, jobCount){
  const profs=appSettings.tariff_profiles;
  const plan=econCompute(jobs,km,driveH,T,ov,
    Object.assign({},ctx,{factKm:null,factWorkH:null}),profs,window.turf);
  const hasFact=(ctx.factKm!=null&&+ctx.factKm>0)||(ctx.factWorkH!=null&&+ctx.factWorkH>0);
  const fact=hasFact?econCompute(jobs,km,driveH,T,ov,ctx,profs,window.turf):null;
  const best=fact||plan;
  return {
    revenue:plan.rev, rWork:plan.rWork, rTravel:plan.rTravel, rPerDiem:plan.rPerDiem,
    warrantyHours:plan.wh, workH:plan.workH, km:plan.km, driveH:plan.driveH,
    totalHours:plan.totalH, days:plan.days, nights:plan.nights,
    cLabor:best.cLabor, cKm:best.cKm, cDay:best.cDay, cNight:best.cNight,
    // cost/profit/margin — лучшее известное: факт, если он есть, иначе план.
    // Оба пути записи дают теперь одно и то же, поэтому дашборд складывает
    // сопоставимые величины.
    cost:best.cost, profit:best.profit, margin:best.margin,
    cost_basis:fact?'fact':'plan',   // чем посчитан cost — чтобы больше не гадать
    cost_plan:plan.cost, profit_plan:plan.profit, margin_plan:plan.margin,
    cost_fact:fact?fact.cost:null,
    profit_fact:fact?fact.profit:null,
    margin_fact:fact?fact.margin:null,
    factKm:fact?fact.factKm:null, factWorkH:fact?fact.factWorkH:null,
    jobCount:jobCount
  };
}
function tripCalc(){ const jobs=tripJobsAll.filter(j=>curTripJobs.has(j.id)); const cur=tripEditId?trips.find(x=>x.id==tripEditId):null; return econCompute(jobs,tripRoute.km,tripRoute.driveH,tripT(),tripOverrides,{roadKm:(cur&&cur.road_km_by_payer)||null,start:tripStart,dateFrom:$('tpFrom').value,dateTo:$('tpTo').value,factKm:cur?cur.fact_km:null,factWorkH:tripEditId?factHByTrip[tripEditId]:null},appSettings.tariff_profiles,window.turf); }
function tripEcon(){ const e=tripCalc();
  $('tpEcon').innerHTML='Работа '+e.workH.toFixed(1)+' ч · в пути '+e.driveH.toFixed(1)+' ч · '
    +e.km.toFixed(0)+' км · дней '+e.days+' · гарантийная доля '+e.share+'%';
  // Разбивка лежит на странице, а не в окне поверх окна: цифры в шапке
  // и строки, из которых они сложились, должны быть видны одновременно.
  if($('tpEconBody')) $('tpEconBody').innerHTML=econHTML(e,'tpEconMap');
  renderTpRoadGroups(); tripHead(); }
function renderTpRoadGroups(){ const box=$('tpRoadGroups'); if(!box) return; const jobs=tripJobsAll.filter(j=>curTripJobs.has(j.id)); const rb=(tripStart&&(appSettings.tariff_profiles||[]).length)?roadByPayer(tripStart,jobs):null;
  if(!rb||!rb.groups.length){ box.innerHTML=''; return; }
  if(!tripOverrides.road) tripOverrides.road={}; const rd=tripOverrides.road;
  let h='<div class="meta" style="margin-top: var(--sp-3)">Дорога по плательщикам (оверрайд выручки, пусто = авто):</div>';
  rb.groups.forEach(g=>{ h+='<div class="row" style="align-items:center;margin-top: var(--sp-2)"><span class="grow" style="font-size: var(--fs-3)">'+esc(g.name)+' · '+g.km.toFixed(0)+' км × '+g.rate+' = '+g.rev.toFixed(0)+'</span><input type="number" data-rgov="'+esc(g.payer)+'" value="'+(rd[g.payer]!=null?rd[g.payer]:'')+'" placeholder="'+g.rev.toFixed(0)+'" style="max-width:110px"></div>'; });
  box.innerHTML=h;
  box.querySelectorAll('[data-rgov]').forEach(inp=>inp.onchange=()=>{ const k=inp.dataset.rgov; if(inp.value==='') delete tripOverrides.road[k]; else tripOverrides.road[k]=inp.value; tripEcon(); }); }
// [сборка] Удалено мёртвое определение showTripOnMap(id)=>loadTripIntoPlanner:
// из-за подъёма функций в браузере всегда побеждала вторая версия ниже
// (показ фактического трека), а эта была недостижима с самого начала.
$('tpEditMap').onclick=()=>{ if(tripEditId){ showTripOnMap(tripEditId); } else { notify('Сначала сохрани выезд — потом правь маршрут на карте.','warn'); } };
function loadTripIntoPlanner(id){ const t=trips.find(x=>x.id==id); if(!t) return; switchTab('map'); tripLayer.clearLayers(); plannerTripId=id;
  const saved=t.route_stops||[]; const st=saved.find(x=>x.type==='start'); rStart=st?{name:st.name,lat:st.lat,lng:st.lng,description:st.description||''}:null;
  rStops=saved.filter(x=>x.type!=='start').map(x=>({type:x.type||'client',name:x.name,lat:x.lat,lng:x.lng,clientId:x.clientId||null,equipId:x.equipId||null,description:x.description||''}));
  const es=t.econ_snapshot||{}; rRoute={km:es.km||0,driveH:es.driveH||0,geometry:t.route_geometry||null}; rVariants=[]; if($('rVariants')) $('rVariants').innerHTML='';
  renderRoutePanel(); $('rStatus').innerHTML=rRoute.km?('<span class="ok">'+rRoute.km.toFixed(1)+' км · '+rRoute.driveH.toFixed(1)+' ч</span>'):'';
  if(rStops.length) map.fitBounds(routeStopsAll().map(s=>[s.lat,s.lng]),{padding:[60,60]}); return;
}
$('tripCancel').onclick=()=>switchTab('planner','trips');
['tpFrom','tpTo','tpEng','tpStatus'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('change',tripEcon); });
$('tpOvRev').oninput=()=>{ tripOverrides.revenue=$('tpOvRev').value; tripEcon(); }; $('tpOvCost').oninput=()=>{ tripOverrides.cost=$('tpOvCost').value; tripEcon(); };
$('tpSave').onclick=async ()=>{ const jobIds=[...curTripJobs]; const stops=routeAll(); const veh=vehicles.find(x=>x.id==$('tpVeh').value);
  const ov={revenue:(tripOverrides.revenue!==''?(+tripOverrides.revenue||0):null),cost:(tripOverrides.cost!==''?(+tripOverrides.cost||0):null),road:(tripOverrides.road||{})};
  // Километраж по плательщикам — по реальным дорогам. Считаем и здесь:
  // выезд можно сохранить из карточки, минуя планировщик.
  const curTrip=tripEditId?trips.find(x=>x.id==tripEditId):null;
  const linkedForKm=tripJobsAll.filter(j=>curTripJobs.has(j.id));
  const roadKmTrip=await computeRoadKmByPayer(linkedForKm, tripMainJobId||null,
    m=>{ $('tripErr').textContent=m; }) || (curTrip&&curTrip.road_km_by_payer) || null;
  $('tripErr').textContent='';

  // Снимок считаем ПОСЛЕ километража. Раньше tripCalc() отрабатывал первой
  // строкой обработчика и брал ещё СТАРЫЙ road_km_by_payer — выручка по
  // дороге в снапшоте отставала ровно на одно сохранение.
  const e=econSnapshot(linkedForKm,tripRoute.km,tripRoute.driveH,tripT(),ov,{
    roadKm:roadKmTrip, start:tripStart,
    dateFrom:$('tpFrom').value, dateTo:$('tpTo').value,
    factKm:curTrip?curTrip.fact_km:null,
    factWorkH:tripEditId?factHByTrip[tripEditId]:null
  },jobIds.length);

  const rec={main_job_id:tripMainJobId||null,road_km_by_payer:roadKmTrip,date_from:$('tpFrom').value||null,date_to:$('tpTo').value||null,vehicle_label:veh?(veh.name+(veh.plate?(' '+veh.plate):'')):'',vehicle_id:veh?veh.id:null,lead_engineer:$('tpEng').value||null,status:$('tpStatus').value,notes:$('tpNotes').value.trim(),route_stops:stops,route_geometry:slimGeometry(tripRoute.geometry)||null,overrides:ov,econ_snapshot:e,tariffs_snapshot:tripT()};
  $('tpSave').disabled=true;
  try{ let tid=tripEditId;
    if(tripEditId){ const {error}=await sb.from('trips').update(rec).eq('id',tripEditId); if(error) throw error; }
    else { rec.created_by=session.user.id; const {data,error}=await sb.from('trips').insert(rec).select('id').single(); if(error) throw error; tid=data.id; }
    await sb.from('trip_jobs').delete().eq('trip_id',tid);
    if(jobIds.length){ const rows=jobIds.map((jid,i)=>({trip_id:tid,job_id:jid,ord:i})); const {error}=await sb.from('trip_jobs').insert(rows); if(error) throw error; }
    // Одометр здесь БОЛЬШЕ НЕ ТРОГАЕМ. Его пишет триггер trips_odometer
    // на переходе в 'done' — из fact_km, с фолбэком на плановый ORS.
    // Если оставить и эту ветку, пробег задвоится:два источника на одно поле.
    // Заодно чинится дыра: инженер закрывает выезд через RPC, saveTrip не
    // вызывается вовсе, и пробег молча переставал бы обновляться.
    switchTab('planner','trips'); await renderTrips(); showToast('Выезд сохранён');
  }catch(err){ console.error('Сохранение выезда не прошло:', err, '| детали:', err&&(err.details||err.hint||err.code)); $('tripErr').textContent='Ошибка: '+(err.message||err); } finally{ $('tpSave').disabled=false; } };
async function delTrip(id){ if(!await confirmDialog('Удалить выезд?',{danger:true,okText:'Удалить'})) return; const {error}=await sb.from('trips').update({deleted_at:new Date().toISOString()}).eq('id',id); if(error){ notify(error.message,'err'); return; } await renderTrips();
  undoToast('Выезд удалён', async ()=>{ const {error:e2}=await sb.from('trips').update({deleted_at:null}).eq('id',id); if(e2){ notify(e2.message,'err'); return; } await renderTrips(); showToast('Восстановлено'); }); }
function tripGmaps(id){ const t=trips.find(x=>x.id==id); const stops=(t&&t.route_stops)||[]; if(stops.length<2){ notify('Нужно минимум 2 точки в выезде (по клиентам заявок).','warn'); return; }
  const pts=stops.map(s=>(+s.lat).toFixed(6)+','+(+s.lng).toFixed(6)); const url='https://www.google.com/maps/dir/?api=1&origin='+pts[0]+'&destination='+pts[pts.length-1]+(pts.length>2?'&waypoints='+encodeURIComponent(pts.slice(1,-1).join('|')):'')+'&travelmode=driving'; window.open(url,'_blank'); }

// ---------- settings ----------
let appSettings={shift_hours:8,deviation_pct:10,currency:'грн',tariffs:{km:0,hour:0,day:0,night:0},costs:{km:0,hour:0,day:0,night:0},default_theme:{},repair_warranty_days:90,contact_period_days:0,company:{},act_template:{},avoid_zones:[],tariff_profiles:[],act_xlsx:{name:null,data:null},ors_proxy:''};
let vehicles=[], vhEditId=null;
async function loadVehicles(){ try{ const {data}=await sb.from('vehicles').select('*').order('name'); vehicles=data||[]; renderVehicles(); }catch(e){ loadFail('список машин',e); } }
function renderVehicles(){ const box=$('vehList'); if(!box) return; box.innerHTML=vehicles.length?'':'<div class="hint">Машин нет. Добавь ниже.</div>';
  vehicles.forEach(v=>{ const since=(+v.odometer||0)-(+v.last_service||0); const interval=(+v.service_interval||0); const left=interval>0?(interval-since):null; const overdue=left!=null&&left<=0;
    const d=document.createElement('div'); d.className='pt';
    d.innerHTML='<div class="nm">'+esc(v.name)+(v.plate?' <span class="pill">'+esc(v.plate)+'</span>':'')+(v.wialon_id?' <span class="pill">GPS</span>':'')+'</div>'+
      '<div class="meta">пробег '+Math.round(+v.odometer||0)+' км'+(left!=null?(' · до ТО '+(overdue?'<span style="color:var(--red)">просрочено</span>':Math.round(left)+' км')):'')+'</div>'+
      '<div class="acts"><button class="btn sm" data-vhedit="'+v.id+'">ред.</button><button class="btn sm" data-vhto="'+v.id+'">отметить ТО</button><button class="btn sm ghost" data-vhdel="'+v.id+'">×</button></div>';
    box.appendChild(d); });
  box.querySelectorAll('[data-vhedit]').forEach(b=>b.onclick=()=>editVehicle(b.dataset.vhedit));
  box.querySelectorAll('[data-vhto]').forEach(b=>b.onclick=()=>markService(b.dataset.vhto));
  box.querySelectorAll('[data-vhdel]').forEach(b=>b.onclick=()=>delVehicle(b.dataset.vhdel)); }
function vhReset(){ vhEditId=null; $('vhCancel').style.display='none'; $('vhAdd').textContent='Добавить машину'; $('vhName').value='';$('vhPlate').value='';$('vhOdo').value='';$('vhInt').value='';$('vhWialon').value='';$('vhErr').textContent=''; }
$('vhAdd').onclick=async ()=>{ const name=$('vhName').value.trim(); if(!name){ $('vhErr').textContent='Введи название.'; return; } const odo=+$('vhOdo').value||0, intv=+$('vhInt').value||0; const rec={name,plate:$('vhPlate').value.trim(),odometer:odo,service_interval:intv,wialon_id:($('vhWialon').value.trim()||null)};
  let error; if(vhEditId){ ({error}=await sb.from('vehicles').update(rec).eq('id',vhEditId)); } else { rec.last_service=odo; ({error}=await sb.from('vehicles').insert(rec)); }
  if(error){ $('vhErr').textContent=error.message; return; } vhReset(); await loadVehicles(); showToast('Автопарк обновлён'); };
$('vhCancel').onclick=vhReset;
function editVehicle(id){ const v=vehicles.find(x=>x.id==id); if(!v) return; vhEditId=id; $('vhName').value=v.name;$('vhPlate').value=v.plate||'';$('vhOdo').value=v.odometer||0;$('vhInt').value=v.service_interval||0;$('vhWialon').value=v.wialon_id||''; $('vhAdd').textContent='Сохранить'; $('vhCancel').style.display=''; }
async function delVehicle(id){ if(!await confirmDialog('Удалить машину?',{danger:true,okText:'Удалить'})) return; const {error}=await sb.from('vehicles').delete().eq('id',id); if(error){ notify(error.message,'err'); return; } await loadVehicles(); }
async function markService(id){ const v=vehicles.find(x=>x.id==id); if(!v) return; if(!await confirmDialog('Отметить ТО при пробеге '+Math.round(+v.odometer||0)+' км?',{okText:'Отметить ТО'})) return; const {error}=await sb.from('vehicles').update({last_service:+v.odometer||0}).eq('id',id); if(error){ notify(error.message,'err'); return; } await loadVehicles(); showToast('ТО отмечено'); }
function updateVehInfo(){ const el=$('tpVehInfo'); if(!el) return; const v=vehicles.find(x=>x.id==$('tpVeh').value); if(!v){ el.textContent=''; return; } const since=(+v.odometer||0)-(+v.last_service||0); const interval=(+v.service_interval||0); const left=interval>0?(interval-since):null; let t='Пробег '+Math.round(+v.odometer||0)+' км'+(left!=null?(' · до ТО '+(left>0?Math.round(left)+' км':'просрочено')):''); el.textContent=t; }
async function loadSettings(){ try{
  // Управленческая часть настроек (себестоимости, тарифы, профили, реквизиты)
  // читается только менеджером. Инженеру политика settings_read её не отдаёт,
  // поэтому для него берём settings_public — там валюта, тема, зоны объезда,
  // адрес прокси и пороги стоянок. Недостающие поля остаются нулями, а всё,
  // что их использует (экономика, акты), инженеру и так не показывается.
  // Столбцы перечислены поимённо, а не '*', ради act_xlsx: там лежит
  // xlsx-шаблон акта, закодированный base64 (файл до 3 МБ превращается
  // примерно в 4 МБ текста). При select('*') этот блоб приезжал КАЖДЫЙ раз,
  // когда открываются настройки, — а нужен он только при выгрузке акта.
  // Вместо содержимого берём одно имя файла: по нему видно, загружен ли
  // шаблон, и этого хватает всему, кроме самой выгрузки.
  const SETTINGS_COLS='id,shift_hours,deviation_pct,currency,tariffs,costs,'
    +'default_theme,repair_warranty_days,contact_period_days,company,act_template,'
    +'avoid_zones,tariff_profiles,ors_proxy,stay_radius_m,stay_min_minutes,'
    +'act_xlsx_name:act_xlsx->>name';
  let {data}=await sb.from('settings').select(SETTINGS_COLS).eq('id',true).single();
  if(!data){ const pub=await sb.from('settings_public').select('*').eq('id',true).single(); data=pub.data||null; }
  // Инженеру settings_public шаблон не отдаёт вовсе — там его и нет.
  if(data){ appSettings={shift_hours:data.shift_hours,deviation_pct:data.deviation_pct,currency:data.currency,tariffs:data.tariffs||{km:0,hour:0,day:0,night:0},costs:data.costs||{km:0,hour:0,day:0,night:0},default_theme:data.default_theme||{},repair_warranty_days:(data.repair_warranty_days==null?90:data.repair_warranty_days),contact_period_days:(data.contact_period_days||0),stay_radius_m:(data.stay_radius_m==null?300:data.stay_radius_m),stay_min_minutes:(data.stay_min_minutes==null?10:data.stay_min_minutes),company:(data.company||{}),act_template:(data.act_template||{}),avoid_zones:(data.avoid_zones||[]),tariff_profiles:(data.tariff_profiles||[]),act_xlsx:{name:(data.act_xlsx_name||null),data:null},ors_proxy:(data.ors_proxy||'')}; renderAvoidZones(); }
  // Пустой результат по обоим источникам — это не «настроек нет», это сбой
  // связи или прав. Без сообщения приложение молча открывалось бы без темы,
  // без зон объезда и без маршрутизации, и искать причину пришлось бы наугад.
  else loadFail('настройки',new Error('settings и settings_public вернули пусто'));
  }catch(e){ loadFail('настройки',e); } }
function renderSettings(){ const s=appSettings; $('stShift').value=s.shift_hours; $('stDev').value=s.deviation_pct; $('stCur').value=s.currency||'';
  const c=s.costs||{}; $('csKm').value=c.km||0;$('csHour').value=c.hour||0;$('csDay').value=c.day||0;$('csNight').value=c.night||0;
  if($('stStayRad')) $('stStayRad').value=(s.stay_radius_m==null?300:s.stay_radius_m);
  if($('stStayMin')) $('stStayMin').value=(s.stay_min_minutes==null?10:s.stay_min_minutes);
  const dt=s.default_theme||{}; $('dtMode').value=dt.mode||'dark'; $('orsProxy').value=s.ors_proxy||''; $('stWarrDays').value=(s.repair_warranty_days==null?90:s.repair_warranty_days); $('stContact').value=s.contact_period_days||0; const co=s.company||{}; $('coName').value=co.name||''; $('coDetails').value=co.details||''; $('coSigner').value=co.signer||'';
  const at=s.act_template||{}; $('atTitle').value=at.title||''; $('atIntro').value=at.intro||''; $('atExecRole').value=at.execRole||''; $('atCustRole').value=at.custRole||''; $('atWorksCol').value=at.worksCol||''; $('atTotalWords').value=at.totalWords||''; $('atWarrNote').value=at.warrNote||''; $('atNote').value=at.note||''; $('atCustSign').value=at.custSign||''; actVarsCur=(at.vars||[]).map(v=>({k:v.k,v:v.v})); renderActVars(); updateAxInfo();
  renderProfiles(); renderVehicles(); renderUsersAdmin(); }
let profEditId=null;
function tpProfiles(){ return appSettings.tariff_profiles||[]; }
function renderProfiles(){ const box=$('tpList'); if(!box) return; const list=tpProfiles();
  if(!list.length){ box.innerHTML='<div class="hint">Профилей нет. Добавь первый — например «Производство» (флажок гарантии) и «Клиент» (флажок платного).</div>'; return; }
  box.innerHTML=list.map(p=>{ const wp=p.work_paid||{}, ww=p.work_warr||{}, rd=p.road||{}; const badges=(p.def_warranty?'<span class="pill warn">гарантия по умолч.</span>':'')+(p.def_paid?'<span class="pill good">платно по умолч.</span>':'');
    return '<div class="card" style="padding: var(--sp-3);margin-top: var(--sp-3)"><h3 style="font-size: var(--fs-4)">'+esc(p.name||'—')+' '+badges+'</h3>'+
      '<div class="meta">платно '+(+wp.rate||0)+'/ч · гарантия '+(+ww.rate||0)+'/ч · км '+(+rd.km_rate||0)+' · сутки '+(+rd.day_rate||0)+' · ночь '+(+rd.night_rate||0)+'</div>'+
      '<div class="acts"><button class="btn sm" data-pedit="'+p.id+'">ред.</button><button class="btn sm ghost" data-pdel="'+p.id+'" title="Удалить">×</button></div></div>'; }).join('');
  box.querySelectorAll('[data-pedit]').forEach(b=>b.onclick=()=>profileEdit(b.dataset.pedit));
  box.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=()=>profileDel(b.dataset.pdel)); }
function profileResetForm(){ profEditId=null; if($('tpFormTitle')) $('tpFormTitle').textContent='Новый профиль'; if($('tpfSave')) $('tpfSave').textContent='Добавить профиль'; if($('tpfCancel')) $('tpfCancel').style.display='';
  ['tpfName','tpfPaidRate','tpfWarrRate','tpfKmRate','tpfDayRate','tpfNightRate','tpfReq'].forEach(id=>{ const el=$(id); if(el) el.value=''; });
  if($('tpfDefWarr')) $('tpfDefWarr').checked=false; if($('tpfDefPaid')) $('tpfDefPaid').checked=false; if($('tpfErr')) $('tpfErr').textContent=''; }
function profileEdit(id){ const p=tpProfiles().find(x=>x.id===id); if(!p) return; profEditId=id; $('tpFormTitle').textContent='Профиль: '+(p.name||''); $('tpfSave').textContent='Сохранить'; $('tpfCancel').style.display='';
  const wp=p.work_paid||{}, ww=p.work_warr||{}, wd=p.work_depot||{}, rd=p.road||{}; const sv=(id,v)=>{ $(id).value=(v==null?'':v); };
  sv('tpfName',p.name); sv('tpfPaidRate',wp.rate); sv('tpfWarrRate',ww.rate);
  sv('tpfKmRate',rd.km_rate); sv('tpfDayRate',rd.day_rate); sv('tpfNightRate',rd.night_rate);
  sv('tpfReq',p.requisites); $('tpfDefWarr').checked=!!p.def_warranty; $('tpfDefPaid').checked=!!p.def_paid; $('profOverlay').classList.add('on'); setTimeout(()=>{ try{ $('tpfName').focus(); }catch(e){} },40); }
async function profileSave(){ const name=$('tpfName').value.trim(); if(!name){ $('tpfErr').textContent='Укажи название.'; return; }
  const num=id=>{ const v=parseFloat($(id).value); return isNaN(v)?0:v; };
  const prof={ id:profEditId||('tp'+Date.now().toString(36)), name, work_paid:{rate:num('tpfPaidRate')}, work_warr:{rate:num('tpfWarrRate')}, work_depot:{rate:num('tpfDepotRate')}, road:{km_rate:num('tpfKmRate'),day_rate:num('tpfDayRate'),night_rate:num('tpfNightRate')}, requisites:$('tpfReq').value.trim(), def_warranty:$('tpfDefWarr').checked, def_paid:$('tpfDefPaid').checked };
  let list=tpProfiles().slice();
  if(prof.def_warranty) list.forEach(x=>{ if(x.id!==prof.id) x.def_warranty=false; });
  if(prof.def_paid) list.forEach(x=>{ if(x.id!==prof.id) x.def_paid=false; });
  const i=list.findIndex(x=>x.id===prof.id); if(i>=0) list[i]=prof; else list.push(prof);
  const {error}=await sb.from('settings').update({tariff_profiles:list}).eq('id',true); if(error){ $('tpfErr').textContent=error.message; return; }
  appSettings.tariff_profiles=list; renderProfiles(); profileResetForm(); $('profOverlay').classList.remove('on'); showToast('Профиль сохранён'); }
async function profileDel(id){ if(!await confirmDialog('Удалить профиль тарифа?',{danger:true,okText:'Удалить'})) return; const list=tpProfiles().filter(x=>x.id!==id); const {error}=await sb.from('settings').update({tariff_profiles:list}).eq('id',true); if(error){ notify(error.message,'err'); return; } appSettings.tariff_profiles=list; renderProfiles(); if(profEditId===id) profileResetForm(); }
if($('tpfSave')) $('tpfSave').onclick=profileSave; if($('tpfCancel')) $('tpfCancel').onclick=()=>{ profileResetForm(); $('profOverlay').classList.remove('on'); };
if($('profCreate')) $('profCreate').onclick=()=>{ profileResetForm(); $('profOverlay').classList.add('on'); setTimeout(()=>{ try{ $('tpfName').focus(); }catch(e){} },40); };
function settingsNav(sec){ document.querySelectorAll('#settingsNav .son').forEach(b=>b.classList.toggle('on',b.dataset.sec===sec)); document.querySelectorAll('.settings-body [data-sec-panel]').forEach(p=>p.style.display=(p.dataset.secPanel===sec)?'':'none'); }
document.querySelectorAll('#settingsNav .son').forEach(b=>b.onclick=()=>settingsNav(b.dataset.sec));
document.querySelectorAll('.settings-body > .card > h3').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('collapsed'));
$('stSave').onclick=async ()=>{ const rec={shift_hours:parseFloat($('stShift').value)||8,deviation_pct:parseFloat($('stDev').value)||0,currency:$('stCur').value.trim()||'грн',costs:{km:+$('csKm').value||0,hour:+$('csHour').value||0,day:+$('csDay').value||0,night:+$('csNight').value||0},ors_proxy:$('orsProxy').value.trim(),repair_warranty_days:parseInt($('stWarrDays').value)||0,contact_period_days:parseInt($('stContact').value)||0,stay_radius_m:parseInt($('stStayRad').value)||300,stay_min_minutes:parseInt($('stStayMin').value)||10,updated_at:new Date().toISOString()};
  const {error}=await sb.from('settings').update(rec).eq('id',true); if(error){ $('stStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings=Object.assign(appSettings,rec); $('stStatus').innerHTML='<span class="ok">Сохранено</span>'; };
$('dtSave').onclick=async ()=>{ const dt={mode:$('dtMode').value,accent:'#ffe100'}; const {error}=await sb.from('settings').update({default_theme:dt}).eq('id',true); if(error){ $('dtStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings.default_theme=dt; $('dtStatus').innerHTML='<span class="ok">Сохранено</span>'; };
$('coSave').onclick=async ()=>{ const company={name:$('coName').value.trim(),details:$('coDetails').value.trim(),signer:$('coSigner').value.trim()}; const {error}=await sb.from('settings').update({company}).eq('id',true); if(error){ $('coStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings.company=company; $('coStatus').innerHTML='<span class="ok">Сохранено</span>'; };
let actVarsCur=[];
function actVars(){ return (appSettings.act_template&&appSettings.act_template.vars)||[]; }
function renderActVars(){ const box=$('avList'); if(!box) return;
  if(!actVarsCur.length){ box.innerHTML='<div class="hint">Пока нет. «+ Добавить» — и укажи имя и значение.</div>'; return; }
  box.innerHTML=actVarsCur.map((v,i)=>'<div class="row" style="align-items:center;margin-top: var(--sp-3)"><span class="hint" style="margin: 0;font-family:var(--mono);white-space:nowrap">{{</span><input type="text" data-avk="'+i+'" value="'+esc(v.k||'')+'" placeholder="имя" style="max-width:150px"><span class="hint" style="margin: 0;font-family:var(--mono);white-space:nowrap">}}</span><input type="text" data-avv="'+i+'" value="'+esc(v.v||'')+'" placeholder="значение" class="grow"><button class="btn sm ghost" data-avrm="'+i+'" title="Удалить">×</button></div>').join('');
  box.querySelectorAll('[data-avk]').forEach(inp=>inp.oninput=()=>{ actVarsCur[inp.dataset.avk].k=inp.value.trim(); });
  box.querySelectorAll('[data-avv]').forEach(inp=>inp.oninput=()=>{ actVarsCur[inp.dataset.avv].v=inp.value; });
  box.querySelectorAll('[data-avrm]').forEach(b=>b.onclick=()=>{ actVarsCur.splice(b.dataset.avrm,1); renderActVars(); }); }
if($('avAdd')) $('avAdd').onclick=()=>{ actVarsCur.push({k:'',v:''}); renderActVars(); };
if($('avSave')) $('avSave').onclick=async ()=>{ const bad=actVarsCur.find(v=>v.k&&!/^[A-Za-zА-Яа-яЁё0-9_]+$/.test(v.k));
  if(bad){ $('avStatus').innerHTML='<span class="err">Имя «'+esc(bad.k)+'»: только буквы, цифры и _</span>'; return; }
  const vars=actVarsCur.filter(v=>v.k); const act_template=Object.assign({},appSettings.act_template||{},{vars});
  const {error}=await sb.from('settings').update({act_template}).eq('id',true); if(error){ $('avStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; }
  appSettings.act_template=act_template; actVarsCur=vars.map(v=>({k:v.k,v:v.v})); renderActVars(); $('avStatus').innerHTML='<span class="ok">Сохранено</span>'; };
$('atSave').onclick=async ()=>{ const act_template={title:$('atTitle').value.trim(),intro:$('atIntro').value.trim(),execRole:$('atExecRole').value.trim(),custRole:$('atCustRole').value.trim(),worksCol:$('atWorksCol').value.trim(),totalWords:$('atTotalWords').value.trim(),warrNote:$('atWarrNote').value.trim(),note:$('atNote').value.trim(),custSign:$('atCustSign').value.trim(),vars:actVars()}; const {error}=await sb.from('settings').update({act_template}).eq('id',true); if(error){ $('atStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings.act_template=act_template; $('atStatus').innerHTML='<span class="ok">Сохранено</span>'; };
async function renderUsersAdmin(){ const {data,error}=await sb.from('profiles').select('id,full_name,role'); const box=$('usersList'); if(error){ box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  profilesList=data||[]; box.innerHTML='';
  profilesList.forEach(p=>{ const d=document.createElement('div'); d.className='eqitem'; d.style.cssText='display:flex;gap: var(--sp-3);align-items:center';
    d.innerHTML='<input type="text" value="'+esc(p.full_name||'')+'" data-un="'+p.id+'" placeholder="имя" class="grow">'+
      '<select data-ur="'+p.id+'" style="width:130px"><option value="admin">админ</option><option value="logist">логист</option><option value="engineer">инженер</option></select>'+
      '<button class="btn sm" data-us="'+p.id+'">сохранить</button>';
    box.appendChild(d); d.querySelector('[data-ur]').value=p.role; });
  box.querySelectorAll('[data-us]').forEach(b=>b.onclick=async ()=>{ const id=b.dataset.us; const name=box.querySelector('[data-un="'+id+'"]').value.trim(); const r=box.querySelector('[data-ur="'+id+'"]').value;
    const {error}=await sb.from('profiles').update({full_name:name,role:r}).eq('id',id); if(error){ notify(error.message,'err'); return; } b.textContent='ок'; setTimeout(()=>b.textContent='сохранить',1200); if(id===session.user.id){ role=r; applyTabs(); } }); }

// ---------- пуш-уведомления ----------
// Ключ публичный по определению: он и так уезжает в браузер каждого
// пользователя. Приватный лежит только в секретах Edge Function.
const VAPID_PUBLIC='BMwNqmBgU83e_tapC1EbQxF_mnjErQqsvzAFZACpVw7RmexLI8Xj4qhOJFvB01VNJybovSV2Klq-58kpmymeGAM';

function b64ToU8(b64){
  const pad='='.repeat((4-b64.length%4)%4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw, c=>c.charCodeAt(0));
}
function u8ToB64(buf){
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

// iOS отдаёт PushManager ТОЛЬКО установленному на домашний экран приложению.
// Во вкладке Safari его нет вовсе — поэтому проверяем и объясняем, а не
// показываем кнопку, которая молча ничего не сделает.
function isIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent); }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }

let swReg=null;
async function initPush(){
  const st=$('pushState'), help=$('pushHelp');
  if(!st) return;
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    st.textContent='Браузер не умеет пуш.';
    if(isIOS() && !isStandalone()){
      help.innerHTML='<b>Это iPhone.</b> Пуш работает только у приложения, добавленного на домашний экран: «Поделиться» → «На экран „Домой“», затем открой DLIGHT с иконки и вернись сюда.';
    }
    $('pushOn').style.display='none';
    return;
  }
  try{
    swReg=await navigator.serviceWorker.register('sw.js');
    const sub=await swReg.pushManager.getSubscription();
    setPushUI(!!sub);
    // Подписки на iOS умеют молча протухать после пары недель простоя.
    // Раз уже подписаны — тихо перезаливаем на сервер при каждом входе.
    if(sub) sendSub(sub).catch(()=>{});
  }catch(e){
    st.textContent='Service worker не поднялся.';
    help.textContent='Проверь, что sw.js лежит рядом с dlight-app.html и сайт открыт по https.';
    $('pushErr').textContent=e.message||String(e);
  }
}

function setPushUI(on){
  $('pushState').innerHTML=on?'<span class="ok">Включены на этом устройстве</span>':'Выключены на этом устройстве';
  $('pushOn').style.display=on?'none':'';
  $('pushOff').style.display=on?'':'none';
  const help=$('pushHelp');
  if(!on && isIOS() && !isStandalone())
    help.innerHTML='<b>Это iPhone.</b> Сначала добавь DLIGHT на домашний экран и открой с иконки — иначе Safari подписку не даст.';
  else if(!on) help.textContent='';
}

async function sendSub(sub){
  const j=sub.toJSON();
  const { error }=await sb.rpc('push_subscribe',{
    p_endpoint:sub.endpoint,
    p_p256dh:(j.keys&&j.keys.p256dh)||u8ToB64(sub.getKey('p256dh')),
    p_auth:(j.keys&&j.keys.auth)||u8ToB64(sub.getKey('auth')),
    p_ua:navigator.userAgent.slice(0,180)
  });
  if(error) throw error;
}

if($('pushOn')) $('pushOn').onclick=async ()=>{
  $('pushErr').textContent='';
  try{
    if(!swReg) swReg=await navigator.serviceWorker.register('sw.js');
    // Разрешение просим строго по клику: спросишь при загрузке — человек
    // отмахнётся, и во второй раз спросить уже не дадут.
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){ $('pushErr').textContent='Разрешение не выдано. Включить можно в настройках сайта в браузере.'; return; }
    const sub=await swReg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(VAPID_PUBLIC)});
    await sendSub(sub);
    setPushUI(true); showToast('Уведомления включены');
  }catch(e){ $('pushErr').textContent=e.message||String(e); }
};

if($('pushOff')) $('pushOff').onclick=async ()=>{
  try{
    const sub=swReg&&await swReg.pushManager.getSubscription();
    if(sub){ await sb.rpc('push_unsubscribe',{p_endpoint:sub.endpoint}); await sub.unsubscribe(); }
    setPushUI(false); showToast('Уведомления выключены');
  }catch(e){ $('pushErr').textContent=e.message||String(e); }
};

// ---------- перенос выезда ----------
// Даты двигают суточные, то есть выручку. Поэтому инженер только просит,
// а меняет их менеджер — см. trip_reschedule_decide на сервере.
let reschedByTrip={};
// renderMine грузит выезды сам и в глобальный trips их не кладёт (там другая
// форма — с trip_jobs). Инженер канбан может не открывать вообще, поэтому
// trips.find() у него пустой. Отдельный кэш, который наполняют оба списка.
let tripCache={};
function getTrip(id){ return (trips||[]).find(x=>x.id==id) || tripCache[id] || null; }

async function loadRescheds(){
  try{
    const { data, error }=await sb.from('trip_reschedules')
      .select('*, profiles:req_by(full_name)').eq('status','pending');
    if(error) throw error;
    reschedByTrip={}; (data||[]).forEach(r=>reschedByTrip[r.trip_id]=r);
  }catch(e){ reschedByTrip={}; loadFail('просьбы о переносе',e); }
}

let rsTripId=null;
function openReschedModal(tid){
  const t=getTrip(tid); if(!t){ notify('Выезд не найден — обнови страницу.','err'); return; }
  rsTripId=tid;
  const span=(t.date_from&&t.date_to)?((new Date(t.date_to)-new Date(t.date_from))/86400000+1):1;
  $('reschedInfo').textContent='Сейчас: '+(t.date_from||'—')+(t.date_to&&t.date_to!==t.date_from?(' — '+t.date_to):'')+' · '+span+' дн.';
  $('rsFrom').value=t.date_from||''; $('rsTo').value=''; $('rsReason').value=''; $('rsErr').textContent='';
  $('rsWarn').textContent=(span>1)
    ? 'Оставишь окончание пустым — выезд останется '+span+'-дневным, конец сдвинется сам.'
    : '';
  $('reschedOverlay').classList.add('on');
}
if($('rsCancel')) $('rsCancel').onclick=()=>$('reschedOverlay').classList.remove('on');

if($('rsSend')) $('rsSend').onclick=async ()=>{
  const from=$('rsFrom').value; const to=$('rsTo').value||null;
  if(!from){ $('rsErr').textContent='Задай новую дату начала.'; return; }
  if(to && to<from){ $('rsErr').textContent='Окончание раньше начала.'; return; }
  try{
    const { data, error }=await sb.rpc('trip_reschedule_request',
      {p_trip:rsTripId,p_from:from,p_to:to,p_reason:$('rsReason').value.trim()});
    if(error) throw error;
    if(data==='wrong_status'){ $('rsErr').textContent='Выезд уже начат — перенести нельзя.'; return; }
    $('reschedOverlay').classList.remove('on');
    showToast('Просьба отправлена менеджеру');
    await loadRescheds(); if(plannerCur==='mine') renderMine();
  }catch(e){ $('rsErr').textContent=e.message||String(e); }
};

async function reschedDecide(rid,ok){
  // promptDialog отдаёт объект по ключам полей и null при отмене.
  let note='';
  if(!ok){
    const res=await promptDialog('Отклонить перенос',[{key:'note',label:'Причина (можно пусто)'}]);
    if(res===null) return;              // передумал — ничего не делаем
    note=(res.note||'').trim();
  }
  try{
    const { data, error }=await sb.rpc('trip_reschedule_decide',{p_req:rid,p_ok:ok,p_note:note||''});
    if(error) throw error;
    if(data==='already_decided'){ notify('Решение уже принято — обнови страницу.','err'); }
    else showToast(ok?'Перенос утверждён':'Перенос отклонён');
    await loadAll(); await loadRescheds();
    if(plannerCur==='mine') renderMine(); else renderTripsView();
  }catch(e){ notify('Ошибка: '+(e.message||e),'err'); }
}

async function reschedCancel(rid){
  try{
    const { error }=await sb.rpc('trip_reschedule_cancel',{p_req:rid});
    if(error) throw error;
    showToast('Просьба отозвана');
    await loadRescheds(); if(plannerCur==='mine') renderMine();
  }catch(e){ notify('Ошибка: '+(e.message||e),'err'); }
}

// Плашка висящего переноса в карточке выезда.
function reschedBanner(t){
  const r=reschedByTrip[t.id]; if(!r) return '';
  const who=(r.profiles&&r.profiles.full_name)?r.profiles.full_name:'инженер';
  const dates=esc(r.new_from)+((r.new_to&&r.new_to!==r.new_from)?(' — '+esc(r.new_to)):'');
  let h='<div class="ds" style="border-left:3px solid var(--accent);padding-left: var(--sp-3);margin-top: var(--sp-3)">'+
        '<b>⏳ Просьба перенести на '+dates+'</b>'+
        (r.reason?('<br><span style="color:var(--ink-dim)">'+esc(r.reason)+'</span>'):'')+
        '<br><span class="hint" style="margin: 0">'+esc(who)+'</span>';
  if(canWrite()){
    h+='<div class="row" style="margin-top: var(--sp-3)"><button class="btn sm amber" data-rok="'+r.id+'">Утвердить</button>'+
       '<button class="btn sm ghost" data-rno="'+r.id+'">Отклонить</button></div>';
  } else {
    h+='<div class="row" style="margin-top: var(--sp-3)"><button class="btn sm ghost" data-rcancel="'+r.id+'">Отозвать</button></div>';
  }
  return h+'</div>';
}

// ---------- стоянки -> факт-часы ----------
// Факт-часы кэшируем на клиенте, а не храним в trips: единственный источник
// правды — trip_stays, и лишняя копия в другой таблице разъезжается молча.
let factHByTrip={};

async function loadFactHours(){
  try{
    const { data, error }=await sb.from('trip_stays').select('trip_id,minutes_mgr,status,job_id')
      .eq('status','approved').not('job_id','is',null);
    if(error) throw error;
    const m={}; (data||[]).forEach(r=>{ m[r.trip_id]=(m[r.trip_id]||0)+(+r.minutes_mgr||0); });
    factHByTrip={}; Object.keys(m).forEach(k=>factHByTrip[k]=Math.round(m[k]/60*100)/100);
  }catch(e){ factHByTrip={}; loadFail('фактические часы по выездам',e); }
}


function minText(m){ if(m==null) return '—'; const h=Math.floor(m/60), r=Math.round(m-h*60); return h?(h+' ч '+r+' м'):(r+' м'); }

const STAY_ST={detected:'посчитано',engineer_ok:'подтвердил инженер',approved:'утверждено',rejected:'не работа'};

async function openStaysModal(tid){
  const t=getTrip(tid);
  $('staysTitle').textContent='Стоянки на выезде'+(t&&t.date_from?(' '+t.date_from):'');
  $('staysBody').innerHTML='<div class="hint">Загрузка…</div>';
  $('staysOverlay').classList.add('on');

  const { data, error }=await sb.from('trip_stays')
    .select('*, jobs(id, clients(name))').eq('trip_id',tid).order('stay_from');
  if(error){ $('staysBody').innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  const list=data||[];
  // Заявки выезда — для ручной привязки стоянки. Автопривязка в
  // trip_detect_stays работает по радиусу stay_radius_m, и если координата
  // объекта смещена (дефект В9: геокодер по адресу промахивается на 1-3 км),
  // стоянка остаётся без заявки навсегда.
  const {data:tjs}=await sb.from('trip_jobs')
    .select('job_id, jobs(id, clients(name))').eq('trip_id',tid).order('ord');
  const stayJobs=(tjs||[]).map(r=>({id:r.job_id,
    name:(r.jobs&&r.jobs.clients&&r.jobs.clients.name)||'заявка без клиента'}));
  if(!list.length){ $('staysBody').innerHTML='<div class="hint">Стоянок не найдено. Либо машина нигде не стояла дольше порога, либо трек не писался.</div>'; return; }

  const mgr=canWrite();
  let h='<div class="hint" style="margin-bottom: var(--sp-3)">Идёт только в себестоимость. Нормочасы в заявках и акт это не меняет.</div>';

  list.forEach(s=>{
    const cli=s.jobs&&s.jobs.clients?s.jobs.clients.name:null;
    const cur=(s.minutes_mgr!=null?s.minutes_mgr:(s.minutes_eng!=null?s.minutes_eng:s.minutes_raw));
    h+='<div class="card" style="margin-bottom: var(--sp-3)">';
    h+='<h3 style="font-size: var(--fs-5)">'+(cli?esc(cli):'<span style="color:var(--ink-dim)">не у заявки</span>')+
       ' <span class="pill">'+esc(STAY_ST[s.status]||s.status)+'</span></h3>';
    h+='<div class="meta">'+hhmm(s.stay_from)+' — '+hhmm(s.stay_to)+' · детектор: '+minText(s.minutes_raw)+
       (s.dist_m!=null?(' · '+s.dist_m+' м до точки'):'')+'</div>';

    // Инженер физически стоял на объекте — его координата точнее
    // геокодированного адреса. Со второго визита автопривязка сработает сама.
    if(cli && s.dist_m!=null && s.dist_m>0 && s.status!=='rejected' && (mgr||s.status!=='approved')){
      h+='<div class="row" style="margin-top: var(--sp-3)"><button class="btn sm ghost" data-spin="'+s.id+'">'+
         'Уточнить точку объекта ('+s.dist_m+' м)</button></div>';
    }

    if(!cli){
      // Не прячем: инженеру полезно видеть, что система про эту стоянку знает
      // и почему не засчитала. Иначе «где мои два часа» — вечный вопрос.
      h+='<div class="hint">Ни одной заявки выезда рядом — в часы не идёт.</div>';
      if(stayJobs.length && (mgr||s.status!=='approved')){
        h+='<div class="row" style="margin-top: var(--sp-3)"><select data-sjob="'+s.id+'" style="flex:1">'+
           '<option value="">— привязать к заявке вручную —</option>'+
           stayJobs.map(j=>'<option value="'+j.id+'">'+esc(j.name)+'</option>').join('')+
           '</select></div>';
      }
    } else if(s.status==='approved'){
      h+='<div class="ds">Зачтено: <b>'+minText(s.minutes_mgr)+'</b>'+
         (s.minutes_eng!=null&&s.minutes_eng!=s.minutes_mgr?(' <span class="hint" style="margin: 0">(инженер ставил '+minText(s.minutes_eng)+')</span>'):'')+'</div>';
    } else if(s.status==='rejected'){
      h+='<div class="ds" style="color:var(--ink-dim)">Отклонено'+(s.note?(': '+esc(s.note)):'')+'</div>';
    } else {
      const canAct=mgr?(s.status==='engineer_ok'||s.status==='detected'):(s.status==='detected');
      if(canAct){
        h+='<div class="row" style="margin-top: var(--sp-3);align-items:center">'+
           '<div style="width:120px"><label>минут</label><input type="number" min="0" step="5" id="sm_'+s.id+'" value="'+(cur!=null?cur:0)+'"></div>'+
           '<button class="btn sm amber" data-sok="'+s.id+'">'+(mgr?'Утвердить':'Подтвердить')+'</button>'+
           '<button class="btn sm ghost" data-sno="'+s.id+'">Не работа</button></div>';
      } else if(!mgr && s.status==='engineer_ok'){
        h+='<div class="ds">Ты подтвердил <b>'+minText(s.minutes_eng)+'</b>. Ждёт менеджера.</div>';
      }
    }
    h+='</div>';
  });

  const approved=list.filter(s=>s.status==='approved'&&s.job_id).reduce((a,s)=>a+(+s.minutes_mgr||0),0);
  h+='<div class="ds" style="margin-top: var(--sp-2)"><b>Утверждено в себестоимость: '+(approved/60).toFixed(2)+' ч</b></div>';
  $('staysBody').innerHTML=h;

  $('staysBody').querySelectorAll('[data-sok]').forEach(b=>b.onclick=()=>stayAct(b.dataset.sok,mgr?'approve':'confirm',tid));
  $('staysBody').querySelectorAll('[data-sno]').forEach(b=>b.onclick=()=>stayAct(b.dataset.sno,'reject',tid));

  $('staysBody').querySelectorAll('[data-sjob]').forEach(sel=>sel.onchange=async()=>{
    try{
      const { data, error }=await sb.rpc('stay_attach',{p_stay:sel.dataset.sjob,p_job:sel.value||null});
      if(error) throw error;
      if(data==='foreign_job') notify('Эта заявка не из текущего выезда.','err');
      else if(data==='already_approved') notify('Стоянку уже утвердил менеджер.','err');
      else showToast(data==='detached'?'Привязка снята':'Привязано к заявке');
      await loadFactHours(); await openStaysModal(tid);
    }catch(e){ notify('Ошибка: '+(e.message||e),'err'); } });

  $('staysBody').querySelectorAll('[data-spin]').forEach(b=>b.onclick=async()=>{
    const st=list.find(x=>x.id===b.dataset.spin); if(!st) return;
    if(!await confirmDialog('Записать координату этой стоянки в карточку объекта? Точка сместится на '+st.dist_m+' м.',{okText:'Записать'})) return;
    try{
      const { data, error }=await sb.rpc('stay_pin_point',{p_stay:b.dataset.spin});
      if(error) throw error;
      if(data==='too_far') notify('Слишком далеко: инженер может сдвинуть объект не дальше 1 км, менеджер — 5 км.','err');
      else if(data==='no_job') notify('Сначала привяжи стоянку к заявке.','err');
      else if(data==='pinned'){ showToast('Координата объекта уточнена'); await loadAll(); }
      await openStaysModal(tid);
    }catch(e){ notify('Ошибка: '+(e.message||e),'err'); } });
}

async function stayAct(sid,kind,tid){
  try{
    let rpc,args;
    if(kind==='reject'){ rpc='stay_reject'; args={p_stay:sid,p_note:''}; }
    else{
      const el=$('sm_'+sid); const m=el?(+el.value||0):null;
      rpc=(kind==='approve')?'stay_approve':'stay_confirm'; args={p_stay:sid,p_minutes:m};
    }
    const { data, error }=await sb.rpc(rpc,args);
    if(error) throw error;
    if(data==='already_approved') notify('Стоянку уже утвердил менеджер.','err');
    await loadFactHours();
    await openStaysModal(tid);
    if(plannerCur==='mine') renderMine();
  }catch(e){ notify('Ошибка: '+(e.message||e),'err'); }
}
if($('staysClose')) $('staysClose').onclick=()=>$('staysOverlay').classList.remove('on');

// ---------- выезд: старт / финиш / подтверждение ----------
// Всё через RPC. Инженеру НЕ дан UPDATE на trips: политика пустила бы его
// заодно в econ_snapshot, overrides и даты. Функции на сервере сами
// проверяют lead_engineer и допустимость перехода.
const TRIP_RPC={start:'trip_start',finish:'trip_finish',confirm:'trip_confirm'};
const TRIP_ASK={
  start:{q:'Начать выезд? С этого момента пишется фактический трек.',ok:'Начать'},
  finish:{q:'Завершить выезд? Трек перестанет писаться, факт-пробег зафиксируется. Дальше выезд уйдёт менеджеру на проверку.',ok:'Завершить'},
  confirm:{q:'Подтвердить выезд? Фактический пробег уйдёт в одометр машины.',ok:'Подтвердить'}
};
const TRIP_SAY={started:'Выезд начат',finished:'Выезд закрыт, ждёт менеджера',done:'Выезд подтверждён'};

async function tripAction(id,kind){
  const a=TRIP_ASK[kind];
  if(!await confirmDialog(a.q,{okText:a.ok})) return;
  try{
    const { data, error }=await sb.rpc(TRIP_RPC[kind],{p_trip:id});
    if(error) throw error;
    // Сервер отвечает словом, а не молчанием: не сработало — говорим прямо,
    // а не делаем вид, что всё прошло.
    if(data==='wrong_status'){ notify('Статус уже изменился — обнови страницу.','err'); }
    else if(data==='not_found'){ notify('Выезд не найден.','err'); }
    else showToast(TRIP_SAY[data]||String(data));
    await loadAll(); await loadVehicles(); await loadFactHours();
    if(plannerCur==='mine') renderMine(); else renderTripsView();
    loadVehState();
    // Детектор отработал внутри trip_finish — показываем сразу, пока инженер
    // ещё помнит день. Через сутки он уже не вспомнит, стоял он у клиента
    // два часа или полтора.
    if(data==='finished') setTimeout(()=>openStaysModal(id),200);
  }catch(e){ notify('Ошибка: '+(e.message||e),'err'); }
}

// ---------- модалка «сегодня выезд» ----------
// Пуша пока нет (этап 5), поэтому ловим момент открытия приложения.
// Инженер всё равно его открывает, чтобы работать.
let todayShown=false;
async function checkTodayTrip(){
  if(todayShown) return; 
  try{
    const today=todayISO();
    let q=sb.from('trips').select('*, vehicles(name,plate)').is('deleted_at',null)
      .in('status',['planned','assigned']).lte('date_from',today);
    if(!canWrite()) q=q.eq('lead_engineer',session.user.id);
    const { data }=await q.order('date_from');
    const list=(data||[]).filter(t=>(t.date_to||t.date_from)>=today || t.date_from<=today);
    if(!list.length) return;
    todayShown=true;

    const t=list[0];
    const veh=t.vehicles?(t.vehicles.name+(t.vehicles.plate?(' · '+t.vehicles.plate):'')):(t.vehicle_label||'машина не назначена');
    const late=t.date_from<today;
    $('todayTitle').textContent=late?'Выезд просрочен':'Сегодня выезд';
    let h='<div class="meta">'+esc(tripPeriod(t.date_from,t.date_to))+' · '+esc(veh)+'</div>';
    if(late) h+='<div class="ds" style="color:var(--red)">Дата выезда уже прошла, а он так и не начат.</div>';
    if(list.length>1) h+='<div class="hint">И ещё '+(list.length-1)+' — остальные в «Моём дне».</div>';
    h+='<div class="row" style="margin-top: var(--sp-4)"><button class="btn amber grow" id="todayStart">▶ Начать выезд</button><button class="btn grow" id="todayResched">📅 Перенести</button></div>';
    $('todayBody').innerHTML=h;
    $('todayStart').onclick=async ()=>{ $('todayOverlay').classList.remove('on'); await tripAction(t.id,'start'); };
    $('todayResched').onclick=()=>{ $('todayOverlay').classList.remove('on'); openReschedModal(t.id); };
    $('todayOverlay').classList.add('on');
  }catch(e){}
}
if($('todayLater')) $('todayLater').onclick=()=>$('todayOverlay').classList.remove('on');

// ---------- факт-трек на карте ----------
let factLayer=L.layerGroup().addTo(map);
async function showTripOnMap(tid){
  switchTab('map');
  factLayer.clearLayers();
  try{
    const { data }=await sb.from('vehicle_positions').select('lat,lng,ts,status')
      .eq('trip_id',tid).order('ts');
    const pts=(data||[]).filter(p=>p.lat!=null&&p.lng!=null);
    if(!pts.length){ setTimeout(()=>map.invalidateSize(),60); showToast('Фактического трека нет'); return; }
    // Факт поверх плана: план уже рисует routeLayer, мы кладём вторую линию.
    factLayer.addLayer(L.polyline(pts.map(p=>[p.lat,p.lng]),{color:'#22c55e',weight:4,opacity:.85,dashArray:'1 7',lineCap:'round'}));
    pts.filter(p=>p.status==='idle').forEach(p=>{
      factLayer.addLayer(L.circleMarker([p.lat,p.lng],{radius:5,color:'#f59e0b',fillColor:'#f59e0b',fillOpacity:.9,weight:2})
        .bindPopup('Стоянка с '+new Date(p.ts).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})));
    });
    setTimeout(()=>{ map.invalidateSize(); map.fitBounds(L.polyline(pts.map(p=>[p.lat,p.lng])).getBounds(),{padding:[40,40]}); },60);
    showToast('Факт: '+pts.length+' точек');
  }catch(e){ notify('Трек не загрузился: '+(e.message||e),'err'); }
}

// ---------- машины на карте (трекинг Wialon) ----------
// vehicle_state — одна строка на машину. Историю (vehicle_positions) карта
// не читает вообще.
//
// Обновление — опросом раз в 30 секунд, без realtime. Подписка тут была,
// и по строкам она действительно дешёвая, но платили мы не за строки:
// декодер WAL на стороне Supabase стоил 460 тысяч вызовов и 38 минут
// процессорного времени базы — больше, чем все прикладные запросы вместе.
// Опрос при этом всё равно оставался: сокет умирает молча, и без опроса
// машина замерзала бы на карте навсегда. То есть настоящим источником
// правды был именно он, а realtime лишь сокращал задержку с 30 секунд
// до одной. Для одной машины такая сделка не окупалась.
//
// Если снова понадобится живая точка: вернуть sb.channel('veh-state')
// сюда И вернуть таблицу в публикацию (см. sql/09-realtime-off.sql).
const VEH_STALE_MIN = 12;   // старше — считаем данные протухшими



// Курса Wialon не отдаёт ни одним тегом — считаем по двум последним точкам.








async function loadVehState(){
  try{
    const {data,error}=await sb.from('vehicle_state')
      .select('vehicle_id,ts,lat,lng,speed,status,lost_since,trip_id,mileage');
    if(error) throw error;
    const prev={}; vehState.forEach(r=>prev[r.vehicle_id]={lat:r.lat,lng:r.lng});
    vehState=(data||[]).map(r=>{ const o=prev[r.vehicle_id];
      const bear=(o && (o.lat!==r.lat || o.lng!==r.lng)) ? vehBearing(o,r) : (vehMk[r.vehicle_id]||{}).__bear;
      return Object.assign({},r,{__bear:bear}); });
    renderVehState();
    // Открытая модалка должна ехать вместе с картой, а не застывать на
    // цифрах момента открытия — иначе она врёт тем убедительнее, чем дольше висит.
    if(vehModalId && $('vehOverlay') && $('vehOverlay').classList.contains('on')) showVehModal(vehModalId);
  }catch(e){ /* нет патча/прав — просто не рисуем машины */ }
}



function renderVehState(){
  // Лента «в работе» показывает машины, поэтому обновляется вместе с ними.
  const wf=$('workFeed');
  if(mapScope==='work'&&wf&&wf.style.display!=='none') renderWorkFeed();
  if(!vehLayer) return;
  vehLayer.clearLayers(); vehMk={};
  if(!vehShow) return;
  vehState.forEach(r=>{
    if(r.lat==null || r.lng==null) return;
    const v=vehicles.find(x=>x.id===r.vehicle_id); if(!v) return;
    const cls=vehClass(r);
    const bear=(cls==='moving' && r.__bear!=null) ? r.__bear : null;
    const rot = bear!=null
      ? '<div class="veh-rot" style="transform:rotate('+bear.toFixed(0)+'deg)"><div class="veh-dir"></div></div>' : '';
    const icon=L.divIcon({className:'', iconSize:[70,44], iconAnchor:[35,14],
      html:'<div class="veh-mk '+cls+'">'+rot+'<div class="veh-ico">🚚</div><div class="veh-lbl '+cls+'">'+esc(vehLabel(v))+'</div></div>'});
    const m=L.marker([r.lat,r.lng],{icon,zIndexOffset:800});
    m.__bear=bear;
    m.on('click',()=>showVehModal(r.vehicle_id));
    vehMk[r.vehicle_id]=m; vehLayer.addLayer(m);
  });
}

function vehRow(k,val){ return '<div class="veh-kv"><span>'+k+'</span><span>'+val+'</span></div>'; }

function showVehModal(vid){
  const r=vehState.find(x=>x.vehicle_id===vid); const v=vehicles.find(x=>x.id===vid);
  if(!r||!v) return;
  vehModalId=vid;
  const cls=vehClass(r), age=vehAgeMin(r);
  const col = cls==='moving'?'#22c55e' : cls==='idle'?'#f59e0b' : '#94a3b8';
  const when=new Date(r.ts);
  const pad=n=>String(n).padStart(2,'0');
  // Время старше суток без даты не говорит ничего: «20:06» для события
  // трёхдневной давности — это какое 20:06?
  const sameDay=(todayISO(when)===todayISO());
  const hhmm=(sameDay?'':pad(when.getDate())+'.'+pad(when.getMonth()+1)+' ')
    +pad(when.getHours())+':'+pad(when.getMinutes());
  // Связь потеряна — значит всё ниже это ПОСЛЕДНЕЕ ИЗВЕСТНОЕ, а не текущее.
  // Раньше скорость и пробег набирались так же, как живые данные, и машина
  // «ехала 4 км/ч», молча третьи сутки.
  const stale=!!r.lost_since || age>VEH_STALE_MIN;

  $('vehTitle').textContent=v.name+(v.plate?(' · '+v.plate):'');
  let h='<div style="font-size: var(--fs-5);font-weight:600;color:'+col+';margin-bottom: var(--sp-3)">'+esc(vehTitle(r))+'</div>';

  h+=vehRow('Данные получены', hhmm+' <span class="hint" style="margin: 0">('+vehAgeText(age)+')</span>');
  if(stale) h+='<div class="vm-stale">Ниже — на момент последней связи, не текущее состояние.</div>';
  const dimv=v=>stale?('<span style="color:var(--ink-faint)">'+v+'</span>'):v;
  if(cls!=='idle') h+=vehRow('Скорость', dimv(Math.round(+r.speed||0)+' км/ч'));
  if(r.mileage!=null) h+=vehRow('Пробег по Wialon', dimv(Math.round(+r.mileage)+' км'));

  // Связь и занятие — разные строки. Машина у клиента с заглушенным мотором
  // стоит И молчит одновременно; склеив это в одну строку, соврём про оба.
  h+=vehRow('Связь', r.lost_since
      ? '<span style="color:var(--red)">потеряна с '+(()=>{ const L=new Date(r.lost_since);
          return (todayISO(L)===todayISO()?'':pad(L.getDate())+'.'+pad(L.getMonth()+1)+' ')
            +pad(L.getHours())+':'+pad(L.getMinutes()); })()+'</span>'
      : (age>VEH_STALE_MIN ? '<span style="color:var(--ink-dim)">сообщений нет</span>' : '<span style="color:var(--green)">есть</span>'));

  const trip=r.trip_id?(trips||[]).find(t=>t.id===r.trip_id):null;
  h+='<div class="meta" style="margin: var(--sp-3) 0 var(--sp-1)">Выезд</div>';
  if(trip){
    h+=vehRow('Дата', esc(trip.date_from||'—')+(trip.date_to&&trip.date_to!==trip.date_from?(' — '+esc(trip.date_to)):''));
    h+=vehRow('Статус', esc(trip.status||'—'));
    h+='<div class="hint" style="margin-top: var(--sp-2)">Трек пишется в историю.</div>';
  } else {
    // Не молчим об этом: без активного выезда история не пишется, и это
    // штатно. Иначе потом ищешь трек, которого никогда не было.
    h+='<div class="hint" style="margin-top: var(--sp-1)">Активного выезда нет — трек в историю не пишется. Поставь выезду статус «в работе».</div>';
  }

  h+='<div class="meta" style="margin: var(--sp-3) 0 var(--sp-1)">Координаты</div>';
  h+='<div class="veh-kv"><span style="font-family:var(--mono);font-size: var(--fs-2)">'+(+r.lat).toFixed(5)+', '+(+r.lng).toFixed(5)+'</span>'+
     '<span><button class="btn sm ghost" id="vehCopy">копировать</button></span></div>';

  $('vehBody').innerHTML=h;
  const cp=$('vehCopy'); if(cp) cp.onclick=()=>{ const t=(+r.lat).toFixed(6)+', '+(+r.lng).toFixed(6);
    try{ navigator.clipboard.writeText(t); }catch(e){} showToast('Координаты: '+t); };
  $('vehOverlay').classList.add('on');
}

if($('vehClose')) $('vehClose').onclick=()=>$('vehOverlay').classList.remove('on');
if($('vehCenter')) $('vehCenter').onclick=()=>{
  const r=vehState.find(x=>x.vehicle_id===vehModalId); if(!r) return;
  $('vehOverlay').classList.remove('on');
  switchTab('map'); setTimeout(()=>{ map.invalidateSize(); map.setView([r.lat,r.lng], Math.max(map.getZoom(),14)); },60);
};

const VEH_POLL_MS = 30000;

function subscribeVeh(){
  // Скрытую вкладку не опрашиваем: телефон инженера в кармане не должен
  // ходить в сеть каждые полминуты. При возврате на вкладку обновляемся
  // сразу, иначе первые 30 секунд на карте висела бы устаревшая точка.
  if(vehTick) clearInterval(vehTick);
  vehTick=setInterval(()=>{ if(!document.hidden) loadVehState(); }, VEH_POLL_MS);
  if(!vehVisWired){
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) loadVehState(); });
    vehVisWired=true;
  }
}

if($('vehBtn')) $('vehBtn').onclick=()=>{
  vehShow=!vehShow;
  $('vehBtn').classList.toggle('on',vehShow);
  renderVehState();
  if(vehShow) loadVehState();
};

// ---------- map route planner ----------
let rStops=[], rStart=null, rRoute={km:0,driveH:0,geometry:null}, rVariants=[], rVarSel=0, bufferKm=0, isoMin=0, places=[], plannerTripId=null, pendingLinkClient=null, baseMode='start', baseAfter=null, endDeclined=false, rBusy=false;
async function loadPlaces(){ places=clients.filter(c=>c.is_base); }
function routeStopsAll(){ return (rStart?[{type:'start',name:rStart.name,lat:rStart.lat,lng:rStart.lng,description:rStart.description||''}]:[]).concat(rStops); }
function routeHasClient(cid){ return rStops.some(s=>s.clientId===cid); }
function resetBuilt(){ rRoute={km:0,driveH:0,geometry:null}; rVariants=[]; $('rVariants').innerHTML=''; $('rStatus').textContent='маршрут не построен'; bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; endDeclined=false; drawStops(); }
function pushClientStop(c){ rStops.push({type:'client',name:c.name,lat:c.lat,lng:c.lng,clientId:c.id}); }
window.addBaseStart=function(id){ const c=clients.find(x=>x.id==id); if(!c||!canWrite()) return; map.closePopup(); switchTab('map'); rStart={name:c.name,lat:c.lat,lng:c.lng,placeId:c.id,description:c.description||''}; renderRoutePanel(); resetBuilt(); };
window.addBaseStop=function(id){ const c=clients.find(x=>x.id==id); if(!c||!canWrite()) return; map.closePopup(); switchTab('map'); rStops.push({type:'place',name:c.name,lat:c.lat,lng:c.lng,placeId:c.id,description:c.description||''}); const b=$('routeBlock'); if(b) b.classList.remove('collapsed'); renderRoutePanel(); resetBuilt(); };
window.addClientToRoute=function(cid){ const c=clients.find(x=>x.id==cid); if(!c||!canWrite()) return; map.closePopup(); switchTab('map'); pushClientStop(c); const b=$('routeBlock'); if(b) b.classList.remove('collapsed'); renderRoutePanel(); resetBuilt(); maybePromptJob(cid); };
window.addEquipToRoute=function(cid,eid){ const c=clients.find(x=>x.id==cid); const e=(eqByClient[cid]||[]).find(x=>x.id==eid); if(!c||!e||!canWrite()) return; map.closePopup(); switchTab('map');
  const lat=(e.lat!=null)?e.lat:c.lat, lng=(e.lng!=null)?e.lng:c.lng; rStops.push({type:'equip',name:c.name+' · '+(e.model||''),lat,lng,clientId:c.id,equipId:e.id}); const b=$('routeBlock'); if(b) b.classList.remove('collapsed'); renderRoutePanel(); resetBuilt(); maybePromptJob(c.id); };
async function maybePromptJob(cid){ try{ const {data}=await sb.from('jobs').select('id').is('deleted_at',null).eq('client_id',cid).not('status','in','(done,cancelled)'); if(data&&data.length) return; }catch(e){ return; } pendingLinkClient=cid; const c=clients.find(x=>x.id==cid); $('linkText').textContent='У клиента «'+(c?c.name:'')+'» нет открытых заявок. Создать заявку как основание выезда?'; $('linkOverlay').classList.add('on'); }
function ringColor(){ return theme.mode==='light'?'rgba(0,0,0,0.6)':'rgba(255,255,255,0.85)'; }
function drawRouteLine(layer,geometry){ if(!geometry||!geometry.coordinates) return; const ll=geometry.coordinates.map(c=>[c[1],c[0]]); L.polyline(ll,{color:ringColor(),weight:5,opacity:1,lineJoin:'round',lineCap:'round'}).addTo(layer); }
// Главная кнопка — одна, и та, что уместна сейчас.
//
// Раньше «+ Точка на карте», «Построить маршрут» и «Сохранить как выезд»
// были одинаково жёлтыми, и интерфейс не подсказывал следующий шаг.
// Хуже: «Сохранить» нажималось при нуле точек и отвечало ошибкой — то есть
// предлагало действие, заведомо обречённое.
//
// Состояний три: точек мало → добавляем; точек хватает, маршрута нет →
// строим; маршрут построен → сохраняем.
function updateRouteActions(){
  if(rBusy) return;                    // во время расчёта кнопками распоряжается doBuildRoute
  const enough=routeStopsAll().length>=2;
  const built=!!(rRoute&&rRoute.km>0);
  const set=(id,amber,disabled)=>{ const b=$(id); if(!b) return;
    b.classList.toggle('amber',!!amber); b.disabled=!!disabled; };
  set('rWpMode',   !enough,        false);
  set('rBuild',    enough&&!built, !enough);
  set('rOpt',      false,          !enough);
  set('rSaveTrip', built,          !built);
}

function drawStops(){ routeLayer.clearLayers(); const stops=routeStopsAll();
  drawRouteLine(routeLayer, rRoute.geometry);
  stops.forEach((s,i)=>{ const ic=L.divIcon({className:'',html:'<div style="background:var(--accent);color:var(--on-accent);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font:600 11px var(--mono);border:2.5px solid '+ringColor()+';pointer-events:none">'+(i+1)+'</div>',iconSize:[20,20],iconAnchor:[10,10]}); L.marker([s.lat,s.lng],{icon:ic,interactive:false}).addTo(routeLayer); }); updateMapSummary(); updateRouteActions(); }
function updateMapSummary(){ const el=$('mapSummary'); if(!el) return; const n=routeStopsAll().length; if(rRoute.km>0 && n){ el.innerHTML='<span><b>'+rRoute.km.toFixed(1)+'</b> км</span><span><b>'+rRoute.driveH.toFixed(1)+'</b> ч</span><span><b>'+n+'</b> точек</span>'; el.classList.add('on'); } else el.classList.remove('on'); }
function routePtCard(tag,s,idx,num,movable){ const d=document.createElement('div'); d.className='pt';
  d.innerHTML='<div class="nm"><span class="pill">'+num+'</span> '+esc(s.name||'точка')+' <span class="pill">'+tag+'</span></div>'+(s.description?'<div class="ds">'+esc(s.description)+'</div>':'')+'<div class="meta">'+(+s.lat).toFixed(4)+', '+(+s.lng).toFixed(4)+'</div>'+'<div class="acts">'+(movable?('<button class="btn sm ghost" data-rup="'+idx+'">↑</button><button class="btn sm ghost" data-rdn="'+idx+'">↓</button><button class="btn sm ghost" data-rrm="'+idx+'">×</button>'):('<button class="btn sm ghost" data-brm="'+idx+'">×</button>'))+'</div>'; return d; }
function renderEndpoints(){ const box=$('rEndpoints'); if(!box) return;
  const endStop=(rStops.length&&rStops[rStops.length-1].type==='place')?rStops[rStops.length-1]:null;
  const slot=(lbl,val,empty,act,canRm)=>'<div class="ep"><span class="ep-l">'+lbl+'</span><span class="ep-v'+(empty?' empty':'')+'">'+esc(val)+'</span><button class="btn sm ghost" data-ep="'+act+'">'+(empty?'выбрать':'сменить')+'</button>'+(canRm?'<button class="btn sm ghost" data-eprm="'+act+'" title="Убрать">×</button>':'')+'</div>';
  box.innerHTML=slot('Старт', rStart?rStart.name:'первая точка', !rStart, 'start', !!rStart)+slot('Финиш', endStop?endStop.name:'не задан', !endStop, 'end', !!endStop);
  box.querySelectorAll('[data-ep]').forEach(b=>b.onclick=()=>openBasePicker(b.dataset.ep,()=>{}));
  box.querySelectorAll('[data-eprm]').forEach(b=>b.onclick=()=>{ if(b.dataset.eprm==='start'){ rStart=null; } else if(rStops.length&&rStops[rStops.length-1].type==='place'){ rStops.pop(); } renderRoutePanel(); resetBuilt(); }); }
function renderRoutePanel(){ renderEndpoints(); $('rCount').textContent=routeStopsAll().length; const box=$('rStops'); box.innerHTML='';
  if(!rStart && !rStops.length){ box.innerHTML='<div class="hint">Точек нет. Добавь точку на карте, по адресу, из существующих или через «+ маршрут» в попапах.</div>'; drawStops(); return; }
  let n=0;
  if(rStart){ n++; box.appendChild(routePtCard('старт',rStart,-1,n,false)); }
  rStops.forEach((s,i)=>{ n++; const tag=(s.type==='place'?'депо':(s.type==='wp'?'пром.':(s.type==='equip'?'техника':'клиент'))); box.appendChild(routePtCard(tag,s,i,n,true)); });
  box.querySelectorAll('[data-rup]').forEach(b=>b.onclick=()=>rMove(+b.dataset.rup,-1));
  box.querySelectorAll('[data-rdn]').forEach(b=>b.onclick=()=>rMove(+b.dataset.rdn,1));
  box.querySelectorAll('[data-rrm]').forEach(b=>b.onclick=()=>{ rStops.splice(+b.dataset.rrm,1); renderRoutePanel(); resetBuilt(); });
  box.querySelectorAll('[data-brm]').forEach(b=>b.onclick=()=>{ rStart=null; renderRoutePanel(); resetBuilt(); });
  drawStops(); }
function rMove(i,dir){ const j=i+dir; if(j<0||j>=rStops.length) return; const t=rStops[i]; rStops[i]=rStops[j]; rStops[j]=t; renderRoutePanel(); resetBuilt(); }
$('rWpMode').onclick=()=>{ wpModeOn=!wpModeOn; $('rWpMode').classList.toggle('active',wpModeOn); $('rWpHint').style.display=wpModeOn?'block':'none'; if(wpModeOn&&addModeOn) toggleAdd(false); map.getContainer().style.cursor=wpModeOn?'crosshair':''; };
if($('rMoreToggle')) $('rMoreToggle').onclick=()=>{
  const closed=$('rMore').style.display==='none';
  $('rMore').style.display=closed?'':'none';
  $('rMoreToggle').textContent=(closed?'▾':'▸')+' Ещё: объезды, оптимизация, коридор';
};
$('corToggle').onclick=()=>{ const closed=$('corBody').style.display==='none'; $('corBody').style.display=closed?'':'none'; $('corToggle').textContent=(closed?'▾':'▸')+' Коридор: найти попутных клиентов'; };
$('rWpAdd').onclick=async ()=>{ const q=$('rWp').value.trim(); const box=$('rWpRes'); if(!q) return; box.innerHTML='<div class="hint">Ищу…</div>';
  try{ const data=await geoSearch(q,5); if(!data.length){ box.innerHTML='<div class="hint">Не найдено.</div>'; return; } box.innerHTML='';
    data.forEach(it=>{ const d=document.createElement('div'); d.className='pt'; d.style.cursor='pointer'; d.innerHTML='<div class="nm" style="font-size: var(--fs-3);font-weight:500">'+esc(it.display_name)+'</div>'; d.onclick=()=>{ rStops.push({type:'wp',name:it.display_name.split(',')[0],lat:+it.lat,lng:+it.lon}); $('rWp').value=''; box.innerHTML=''; renderRoutePanel(); resetBuilt(); }; box.appendChild(d); }); }catch(e){ box.innerHTML='<div class="err">'+esc(e.message||'Ошибка геокодера.')+'</div>'; } };
$('rClear').onclick=()=>{ rStops=[]; rStart=null; plannerTripId=null; endDeclined=false; $('rBuf').value=0; bufferKm=0; $('rBufVal').textContent='0 км'; $('rIso').value=0; isoMin=0; $('rIsoVal').textContent='0 мин'; tripLayer.clearLayers(); renderRoutePanel(); resetBuilt(); };
function openBasePicker(mode,after){ baseMode=mode; baseAfter=after||null; $('baseTitle').textContent=(mode==='start'?'Старт — депо':'Финиш — депо'); $('baseSub').textContent=(mode==='start'?'Выбери депо старта или создай новое. «Не нужно» — стартом станет первая точка маршрута.':'Выбери депо для финиша или откажись.'); renderBaseList(); $('baseNew').value=''; $('baseNewRes').innerHTML=''; $('baseOverlay').classList.add('on'); }
function renderBaseList(){ const box=$('baseList'); box.innerHTML=places.length?'':'<div class="hint">Депо пока нет. Создай новое ниже.</div>';
  places.forEach(p=>{ const d=document.createElement('div'); d.className='pt'; d.innerHTML='<div style="display:flex;gap: var(--sp-3);align-items:center"><span class="grow" style="cursor:pointer" data-bpick="'+p.id+'"><b>'+esc(p.name)+'</b>'+(p.description?'<div class="hint" style="margin: 0">'+esc(p.description)+'</div>':'')+'</span><button class="btn sm ghost" data-bedit="'+p.id+'">ред.</button></div>'; box.appendChild(d); });
  box.querySelectorAll('[data-bpick]').forEach(el=>el.onclick=()=>{ const p=places.find(x=>x.id==el.dataset.bpick); if(p) chooseBase(p); });
  box.querySelectorAll('[data-bedit]').forEach(b=>b.onclick=async ()=>{ const p=places.find(x=>x.id==b.dataset.bedit); if(!p) return; const r=await promptDialog('Депо',[{key:'name',label:'Название',value:p.name},{key:'desc',label:'Описание',value:p.description||'',type:'textarea'}]); if(!r) return; const {error}=await sb.from('clients').update({name:((r.name||'').trim()||p.name),description:(r.desc||'').trim()}).eq('id',p.id); if(error){ notify(error.message,'err'); return; } await loadAll(); renderBaseList(); }); }
function chooseBase(p){ const o={name:p.name,lat:p.lat,lng:p.lng,placeId:p.id,description:p.description||''}; if(baseMode==='start'){ rStart=o; } else { rStops.push(Object.assign({type:'place'},o)); } $('baseOverlay').classList.remove('on'); renderRoutePanel(); resetBuilt(); const a=baseAfter; baseAfter=null; if(typeof a==='function') a(true); }
$('baseSkip').onclick=()=>{ if(baseMode==='end') endDeclined=true; $('baseOverlay').classList.remove('on'); const a=baseAfter; baseAfter=null; if(typeof a==='function') a(false); };
$('baseNewAdd').onclick=async ()=>{ const q=$('baseNew').value.trim(); if(!q){ $('baseNewRes').innerHTML='<div class="hint">Укажи адрес для поиска координат.</div>'; return; } $('baseNewAdd').disabled=true; $('baseNewRes').innerHTML='<div class="hint">Ищу…</div>';
  try{ const data=await geoSearch(q,1); if(!data.length){ $('baseNewRes').innerHTML='<div class="hint">Адрес не найден.</div>'; return; } const it=data[0];
    const nm=$('baseNewName').value.trim()||it.display_name.split(',')[0]; const ds=$('baseNewDesc').value.trim();
    const ins=await sb.from('clients').insert({name:nm,description:ds,lat:+it.lat,lng:+it.lon,is_base:true,color:'#27d3c4'}).select().single(); if(ins.error){ $('baseNewRes').innerHTML='<div class="err">'+esc(ins.error.message)+'</div>'; return; }
    $('baseNew').value='';$('baseNewName').value='';$('baseNewDesc').value=''; await loadAll(); chooseBase(ins.data);
  }catch(e){ $('baseNewRes').innerHTML='<div class="err">Ошибка: '+esc(e.message||e)+'</div>'; } finally{ $('baseNewAdd').disabled=false; } };
$('rBuild').onclick=()=>{ const stops=routeStopsAll(); if(stops.length<2){ $('rStatus').textContent='Нужно минимум 2 точки.'; return; } if(orsKeyMissing()){ orsMissing($('rStatus')); return; } doBuildRoute(); };
$('rOpt').onclick=optimizeOrder;
async function avoidMatrix(pts,onProg){ await ensureTurf();
  const n=pts.length, ap=avoidPolygons(), pref=$('rPref').value;
  const M=Array.from({length:n},()=>new Array(n).fill(0)); let done=0, total=n*(n-1)/2;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
    let d=0;
    // Без зон объезда options не отправляем — с avoid_polygons:null
    // ORS отвечает внутренней ошибкой 2099.
    const pr=[[pts[i].lng,pts[i].lat],[pts[j].lng,pts[j].lat]];
    try{ const gj=await orsPost(ORS_DIR, ap?{coordinates:pr,preference:pref,options:{avoid_polygons:ap}}:{coordinates:pr,preference:pref});
      const f=(gj.features||[])[0]; d=+(((f&&f.properties&&f.properties.summary)||{}).distance)||0; }
    catch(e){ if(!isAvoidLimit(e.raw)) throw e;
      const gj=await orsPost(ORS_DIR,{coordinates:[[pts[i].lng,pts[i].lat],[pts[j].lng,pts[j].lat]],preference:pref});
      d=+(((((gj.features||[])[0])||{}).properties||{}).summary||{}).distance||0; }
    M[i][j]=M[j][i]=d; done++; if(onProg) onProg(done,total); }
  return M; }

async function optimizeOrder(){ if(rBusy) return; if(orsKeyMissing()){ orsMissing($('rStatus')); return; }
  try{ await ensureTurf(); }catch(e){ $('rStatus').innerHTML='<span class="err">'+esc(e.message)+'</span>'; return; }
  const visits=[]; rStops.forEach((s,i)=>{ if(s.type!=='place') visits.push({i,lng:s.lng,lat:s.lat}); });
  if(visits.length<2){ $('rStatus').textContent='Нужно минимум 2 точки выезда для оптимизации.'; return; }
  let startCoord, fixedStartIdx=null, jobsSrc=visits.slice();
  if(rStart){ startCoord=[rStart.lng,rStart.lat]; } else { fixedStartIdx=visits[0].i; startCoord=[visits[0].lng,visits[0].lat]; jobsSrc=visits.slice(1); }
  if(!jobsSrc.length){ $('rStatus').textContent='Нечего оптимизировать.'; return; }
  const placeStops=rStops.filter(s=>s.type==='place'); const endBase=placeStops.length?placeStops[placeStops.length-1]:null;
  const endCoord=endBase?[endBase.lng,endBase.lat]:(rStart?[rStart.lng,rStart.lat]:null);
  const veh={id:1,profile:'driving-car',start:startCoord}; if(endCoord) veh.end=endCoord;
  const body={jobs:jobsSrc.map(o=>({id:o.i,location:[o.lng,o.lat]})),vehicles:[veh]};
  const ap=avoidPolygons();
  if(ap){ const pts=[{lat:startCoord[1],lng:startCoord[0]}].concat(jobsSrc.map(o=>({lat:o.lat,lng:o.lng})));
    let endIdx=null; if(endBase){ pts.push({lat:endBase.lat,lng:endBase.lng}); endIdx=pts.length-1; }
    const pairs=pts.length*(pts.length-1)/2;
    if(pairs>28){ $('rStatus').innerHTML='<span class="err">Точек многовато ('+pts.length+') для оптимизации с объездами: понадобилось бы '+pairs+' запросов к ORS. Убери часть точек или оптимизируй без объездов.</span>'; return; }
    rBusy=true; $('rOpt').disabled=true; $('rBuild').disabled=true;
    try{ $('rStatus').textContent='Считаю расстояния с учётом объездов…';
      const M=await avoidMatrix(pts,(d,t)=>{ $('rStatus').textContent='Считаю расстояния с учётом объездов… '+d+'/'+t; });
      const res=tspOrder(M,endIdx);
      const orderedVisit=res.order.slice(1).filter(i=>i!==endIdx).map(i=>rStops[jobsSrc[i-1].i]).filter(Boolean);
      const fixedStart=(fixedStartIdx!=null)?rStops[fixedStartIdx]:null;
      rStops=[].concat(fixedStart?[fixedStart]:[], orderedVisit, placeStops); renderRoutePanel(); resetBuilt();
      $('rStatus').textContent='Порядок оптимизирован с учётом объездов (~'+(res.len/1000).toFixed(0)+' км), строю маршрут…';
      rBusy=false; updateRouteActions(); await doBuildRoute(); return;
    }catch(e){ $('rStatus').innerHTML='<span class="err">Ошибка оптимизации: '+esc(e.message||e)+'</span>'; return; }
    finally{ rBusy=false; updateRouteActions(); } }
  $('rStatus').textContent='Оптимизирую порядок…'; rBusy=true; $('rOpt').disabled=true; $('rBuild').disabled=true;
  try{ const data=await orsPost('https://api.openrouteservice.org/optimization',body); const route=data.routes&&data.routes[0]; if(!route) throw new Error('оптимизатор не нашёл решения');
    const orderIds=route.steps.filter(st=>st.type==='job').map(st=>st.job); const orderedVisit=orderIds.map(id=>rStops[id]).filter(Boolean); const fixedStart=(fixedStartIdx!=null)?rStops[fixedStartIdx]:null;
    rStops=[].concat(fixedStart?[fixedStart]:[], orderedVisit, placeStops); renderRoutePanel(); resetBuilt(); $('rStatus').textContent='Порядок оптимизирован, строю маршрут…';
    rBusy=false; updateRouteActions(); await doBuildRoute(); return;
  }catch(e){ $('rStatus').innerHTML='<span class="err">Ошибка оптимизации: '+esc(e.message||e)+'</span>'; } finally{ rBusy=false; updateRouteActions(); } }

function avoidHits(stops){ const zs=appSettings.avoid_zones||[]; if(!zs.length||typeof turf==='undefined') return []; const out=[];
  stops.forEach(s=>{ zs.forEach(z=>{ try{ if(turf.distance([z.lng,z.lat],[s.lng,s.lat],{units:'kilometers'})*1000<=(z.r||150)) out.push(s.name||'точка'); }catch(e){} }); }); return [...new Set(out)]; }
function avoidAreaKm2(){ return (appSettings.avoid_zones||[]).reduce((a,z)=>a+Math.PI*Math.pow((z.r||150)/1000,2),0); }
function orsErrMsg(status,t){ let msg=t; try{ const j=JSON.parse(t); if(j&&j.error) msg=(typeof j.error==='string')?j.error:(j.error.message||JSON.stringify(j.error)); }catch(e){}
  msg=String(msg||'').slice(0,180);
  if(status===429) return 'превышен лимит запросов ORS (на бесплатном ключе ~40 в минуту). Подожди минуту и повтори.';
  // 401/403 приходят от НАШЕГО прокси, а не от ORS: он проверяет сессию через
  // is_staff() и отказывает неактивным. Его текст точнее любого нашего домысла,
  // поэтому показываем сообщение прокси, а не гадаем про ключ.
  if(status===401||status===403) return msg || ('доступ к маршрутизации закрыт ('+status+').');
  if(isAvoidLimit(t)) return 'ORS не применяет объезды к маршрутам длиннее 150 км (лимит бесплатного сервера).';
  if(/routable|could not be found|not found/i.test(msg)) return 'ORS не смог привязать точку к дороге. Обычно причина — точка далеко от дорог или попала в зону объезда. ('+msg+')';
  if(/no route|route could not/i.test(msg)) return 'маршрут не найден — возможно, зоны объезда перекрыли единственную дорогу. ('+msg+')';
  if(/polygon|avoid/i.test(msg)) return 'сервер отклонил зоны объезда: '+msg;
  return 'ORS '+status+': '+msg; }
function isAvoidLimit(raw){ const s=String(raw||''); return /avoid areas/i.test(s)&&/must not be greater/i.test(s); }
// Лимит бесплатного ключа ORS — около 40 запросов в минуту. Матрица объездов
// и километраж по плательщикам легко дают несколько десятков подряд, и раньше
// это упиралось в 429 на середине: сообщение показывалось, а посчитанное
// терялось целиком. Теперь запросы сами притормаживают, не доходя до отказа.
const ORS_MAX_PER_MIN=35;            // с запасом от 40
let orsReqCount=0;                   // счётчик для показа прогресса
let orsProgress=null;                // куда писать «ждём» во время долгих операций
const _orsCalls=[];
async function orsThrottle(){
  for(;;){
    const t=Date.now();
    while(_orsCalls.length && t-_orsCalls[0]>60000) _orsCalls.shift();
    if(_orsCalls.length<ORS_MAX_PER_MIN){ _orsCalls.push(t); return; }
    const wait=Math.max(250, 60000-(t-_orsCalls[0])+50);
    if(orsProgress) orsProgress('Пауза '+Math.ceil(wait/1000)+' с — бережём лимит ORS…');
    await new Promise(r=>setTimeout(r,Math.min(wait,5000)));
  }
}

async function orsPost(url,body){ const px=(appSettings.ors_proxy||'').trim(); let r;
  await orsThrottle(); orsReqCount++;
  // Прямой режим убран: ключ ORS живёт только в секрете Edge Function.
  if(!px) throw new Error('Маршрутизация не настроена: не задан адрес прокси ORS в настройках.');
  if(px){ const path=url.replace('https://api.openrouteservice.org/',''); const tok=(session&&session.access_token)||'';
    r=await fetch(px,{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({path,body})}); }
  if(r.ok) return await r.json();
  let t=''; try{ t=await r.text(); }catch(e){}
  // Причина отказа ORS лежит в теле ответа. Без вывода в консоль виден только
  // голый «400», а понять, что именно не так (лимит координат, слишком сложные
  // зоны объезда, точка вне дорожной сети), невозможно.
  console.error('ORS '+r.status+' на '+url.replace('https://api.openrouteservice.org/','')
    +' · координат: '+((body&&body.coordinates&&body.coordinates.length)||0)
    +' · зоны объезда: '+((body&&body.options&&body.options.avoid_polygons)?'да':'нет')
    +'\n'+t.slice(0,600));
  const err=new Error(orsErrMsg(r.status,t)); err.raw=t; err.status=r.status; throw err; }
const ORS_DIR='https://api.openrouteservice.org/v2/directions/driving-car/geojson';
function mergeFeatures(fs){ let line=[],dist=0,dur=0;
  fs.forEach((f,i)=>{ const sm=(f.properties&&f.properties.summary)||{}; dist+=(+sm.distance||0); dur+=(+sm.duration||0); const c=(f.geometry&&f.geometry.coordinates)||[]; line=line.concat(i?c.slice(1):c); });
  return {type:'Feature',properties:{summary:{distance:dist,duration:dur}},geometry:{type:'LineString',coordinates:line}}; }
// Расставляем промежуточные точки по РЕАЛЬНОЙ линии дороги через каждые chunkKm.
// Точку, попавшую внутрь зоны объезда, пропускаем и идём дальше по линии —
// иначе ORS не сможет к ней подъехать.
function sampleVias(line,chunkKm){ const vias=[]; let acc=0;
  for(let i=1;i<line.length;i++){
    acc+=kmBetween({lng:line[i-1][0],lat:line[i-1][1]},{lng:line[i][0],lat:line[i][1]});
    if(acc>=chunkKm){ const p={lat:line[i][1],lng:line[i][0],name:'отрезок'};
      if(!avoidHits([p]).length){ vias.push(p); acc=0; } } }
  // если последняя точка вплотную к финишу — она бесполезна
  if(vias.length){ const last=vias[vias.length-1], end={lat:line[line.length-1][1],lng:line[line.length-1][0]};
    if(kmBetween(last,end)<15) vias.pop(); }
  return vias; }
async function legWithAvoid(a,b,pref,ap,prog){ const pair=[[a.lng,a.lat],[b.lng,b.lat]];
  // Зон объезда нет → options вообще не отправляем. Раньше уходило
  // options:{avoid_polygons:null}, и ORS падал с внутренней ошибкой 2099:
  // параметр обхода присутствует, а значения нет. Так же строит маршрут
  // и doBuildRoute — там тело собирается без options, когда ap пустой.
  const bodyOf=coords=>ap?{coordinates:coords,preference:pref,options:{avoid_polygons:ap}}
                        :{coordinates:coords,preference:pref};
  try{ const gj=await orsPost(ORS_DIR,bodyOf(pair));
    const f=(gj.features||[])[0]; if(!f) throw new Error('ORS вернул пустой участок.'); return {feature:f}; }
  catch(e){ if(!isAvoidLimit(e.raw)) throw e; }
  // плечо длиннее 150 км: берём геометрию дороги и дробим её на отрезки
  if(prog) prog('Плечо «'+(a.name||'?')+' → '+(b.name||'?')+'» длиннее 150 км — дроблю на отрезки…');
  const plain=await orsPost(ORS_DIR,{coordinates:pair,preference:pref});
  const pf=(plain.features||[])[0]; const line=(pf&&pf.geometry&&pf.geometry.coordinates)||[];
  const vias=sampleVias(line,100);
  if(!vias.length) return {feature:pf,noAvoid:true};
  const pts=[a].concat(vias,[b]); const parts=[]; let noAvoid=false;
  for(let i=0;i<pts.length-1;i++){ const p=[[pts[i].lng,pts[i].lat],[pts[i+1].lng,pts[i+1].lat]];
    let f=null;
    try{ const gj=await orsPost(ORS_DIR,bodyOf(p)); f=(gj.features||[])[0]; }
    catch(e){ if(!isAvoidLimit(e.raw)) throw e; const gj=await orsPost(ORS_DIR,{coordinates:p,preference:pref}); f=(gj.features||[])[0]; noAvoid=true; }
    if(!f||!f.geometry) throw new Error('ORS вернул пустой отрезок.'); parts.push(f); if(prog) prog('Дроблю плечо на отрезки… '+(i+1)+'/'+(pts.length-1)); }
  return {feature:mergeFeatures(parts),noAvoid,split:pts.length-1}; }

// ── Километраж по плательщикам по РЕАЛЬНЫМ маршрутам ────────────────────────
// Считается один раз при построении/сохранении маршрута и кладётся в
// trips.road_km_by_payer. Экономика потом читает готовое, поэтому расчёт
// денег остаётся мгновенным и не ходит в сеть.
//
// Две схемы (SPEC-road-km.md):
//   circuit  — основная заявка не отмечена: каждому плательщику свой круг
//              Депо → его точки → Депо по дорогам.
//   marginal — основная отмечена: её плательщик несёт базу Депо→A→Депо,
//              остальные платят только крюк Депо→X→A→Депо минус база.
//
// Промежуточные точки (place/wp) экономической строки не имеют, но входят
// в геометрию каждого круга — они обслуживают всю поездку.

// Длина маршрута через последовательность точек, в километрах.
//
// Устойчивость важнее точности: ORS иногда отдаёт 500 (код 2099 — внутренняя
// ошибка сервера) на вполне корректном участке. Раньше один такой участок
// ронял весь расчёт километража. Теперь сбойный участок заменяется прямой
// линией, а результат помечается приблизительным — лучше слегка заниженная
// цифра по одному плечу, чем отсутствие цифры вовсе.
async function routeKmThrough(pts, pref, ap, prog, stat){
  if(!pts || pts.length<2) return 0;
  const valid=p=>p && isFinite(+p.lat) && isFinite(+p.lng)
    && Math.abs(+p.lat)<=90 && Math.abs(+p.lng)<=180 && !(+p.lat===0 && +p.lng===0);
  let m=0;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    if(!valid(a)||!valid(b)){ console.warn('Километраж: пропущен участок с некорректной точкой',a,b); continue; }
    // Нулевое плечо (точка совпадает со следующей) ORS не переваривает.
    const straight=kmBetween(a,b,window.turf);
    if(straight<0.03){ continue; }
    try{
      // Код 2099 у ORS — внутренняя ошибка сервера, часто временная.
      // Пробуем ещё раз с паузой, прежде чем сдаваться на прямую.
      let r=null;
      for(let att=0; att<3; att++){
        try{ r=await legWithAvoid(a,b,pref,ap,prog); break; }
        catch(err){
          const transient=(err&&(err.status>=500||/2099/.test(String(err.raw||''))));
          if(!transient || att===2) throw err;
          if(prog) prog('ORS не ответил, повтор '+(att+2)+'/3…');
          await new Promise(res=>setTimeout(res,700*(att+1)));
        }
      }
      const sm=(r.feature&&r.feature.properties&&r.feature.properties.summary)||{};
      m+=(+sm.distance||0);
    }catch(e){
      // Один участок не построился — берём прямую и идём дальше.
      console.warn('Километраж: участок '+(a.name||'?')+' → '+(b.name||'?')
        +' не построен ('+((e&&e.message)||e)+'), взята прямая '+straight.toFixed(1)+' км',
        {from:[a.lat,a.lng],to:[b.lat,b.lng]});
      m+=straight*1000;
      if(stat) stat.approx=true;
    }
  }
  return m/1000;
}

// Промежуточные точки маршрута (не заявки) — их проезжают в любом случае.
function viaStopsOnly(){
  return (rStops||[]).filter(s=>s.type==='place'||s.type==='wp');
}

async function computeRoadKmByPayer(linkedJobs, mainJobId, prog){
  // Стартовая точка: из планировщика (rStart) либо из открытого выезда
  // (tripStart). Без неё считать не от чего.
  const start=rStart||tripStart;
  if(!start){ console.warn('Километраж: нет стартовой точки (депо) — пропускаю'); return null; }
  try{ await ensureTurf(); }catch(e){ console.warn('Километраж: turf не загрузился — пропускаю',e); return null; }
  if(orsKeyMissing()){ console.warn('Километраж: маршрутизация не настроена — пропускаю'); return null; }
  const pref=($('rPref')&&$('rPref').value)||'recommended';
  const ap=avoidPolygons();
  const vias=viaStopsOnly();

  // Группируем заявки по плательщику; заявки без профиля в экономику не идут.
  const groups={};
  (linkedJobs||[]).forEach(j=>{
    const pid=jobRoadPayer(j); if(!pid) return;      // без плательщика — мимо
    const pt=jobPoint(j); if(!pt) return;
    (groups[pid]=groups[pid]||[]).push({...pt,name:(j.clients&&j.clients.name)||'точка',job:j});
  });
  const payers=Object.keys(groups);
  if(!payers.length) return null;

  const stat={approx:false};
  // Счётчик запросов виден человеку: расчёт может занять десятки обращений
  // к ORS, и без цифры это выглядит как зависшая кнопка.
  const startedAt=orsReqCount;
  const say=m=>{ if(prog) prog(m+' (запросов к ORS: '+(orsReqCount-startedAt)+')'); };
  const prevProgress=orsProgress; orsProgress=m=>{ if(prog) prog(m); };
  console.info('Километраж: старт',{
    заявок:(linkedJobs||[]).length,
    плательщиков:'считаю…',
    основная:mainJobId||'нет',
    км_маршрута_планировщик:(rRoute&&rRoute.km)||0,
    км_маршрута_выезд:(tripRoute&&tripRoute.km)||0,
    старт_точка:start?[start.lat,start.lng]:null
  });
  const out={ mode:'circuit', main_job:null, base_km:null, total_route_km:null,
              payers:{}, computed_at:new Date().toISOString(), stale:false, approx:false };
  try{
    // ── Один плательщик: весь маршрут и есть его круг ─────────────────────
    // Километраж уже посчитан при построении маршрута (rRoute.km / tripRoute.km),
    // причём по реальным дорогам. Гонять ORS повторно незачем — это лишние
    // запросы и лишний риск нарваться на сбой сервиса.
    const builtKm=(rRoute&&rRoute.km)||(tripRoute&&tripRoute.km)||0;
    if(payers.length===1 && builtKm>0){
      const only=payers[0];
      out.payers[only]={km:Math.round(builtKm*10)/10,kind:'circuit'};
      out.total_route_km=Math.round(builtKm*10)/10;
      out.mode='circuit';
      console.info('Километраж: один плательщик, взят готовый маршрут',out.payers);
      return out;
    }

    const mainJob=mainJobId?(linkedJobs||[]).find(j=>j.id===mainJobId):null;
    const mainPid=mainJob?jobRoadPayer(mainJob):null;
    const mainPt=mainJob?jobPoint(mainJob):null;

    if(mainJob && mainPid && mainPt){
      // ── маржинальная схема ────────────────────────────────────────────────
      out.mode='marginal'; out.main_job=mainJobId;
      const A={...mainPt,name:'основная'};
      const base=await routeKmThrough([start,...vias,A,start],pref,ap,prog,stat);
      out.base_km=Math.round(base*10)/10;
      out.payers[mainPid]={km:out.base_km,kind:'base'};

      for(const pid of payers){
        if(pid===mainPid) continue;
        // Крюк ради этого плательщика: через все его точки, потом к основной.
        say('Считаю крюк плательщика');
        const withX=await routeKmThrough([start,...vias,...groups[pid],A,start],pref,ap,prog,stat);
        // Отсечка нулём: если точка была по пути, скидки за это не бывает.
        const detour=Math.max(0,withX-base);
        out.payers[pid]={km:Math.round(detour*10)/10,kind:'detour'};
      }
      out.total_route_km=Math.round(base*10)/10;
    } else {
      // ── каждому свой круг ─────────────────────────────────────────────────
      for(const pid of payers){
        say('Считаю круг плательщика');
        const km=await routeKmThrough([start,...vias,...groups[pid],start],pref,ap,prog,stat);
        out.payers[pid]={km:Math.round(km*10)/10,kind:'circuit'};
      }
      out.total_route_km=(rRoute&&rRoute.km)?Math.round(rRoute.km*10)/10:null;
    }
    console.info('Километраж: посчитано',{режим:out.mode,база:out.base_km,плательщики:out.payers,
      приблизительно:stat.approx,запросов_к_ORS:orsReqCount-startedAt});
    out.approx=stat.approx;
    if(stat.approx) notify('Часть плеч ORS не построил — километраж приблизительный.','warn');
    return out;
  }catch(e){
    // ORS недоступен — не обнуляем, помечаем. Экономика продолжит работать
    // на прежних числах, а не покажет нули.
    const why=(e&&(e.message||e.raw||e))+'';
    console.error('Километраж по плательщикам не пересчитан:',e,'\nСТЕК:',e&&e.stack);
    notify('Километраж не пересчитан: '+why.slice(0,140),'warn');
    return null;
  } finally { orsProgress=prevProgress; }
}

async function doBuildRoute(){ if(rBusy) return; const stops=dedupeStops(routeStopsAll());
  if(stops.length<2){ $('rStatus').textContent='Нужно минимум 2 разные точки (совпадающие подряд пропускаются).'; return; }
  if(orsKeyMissing()){ orsMissing($('rStatus')); return; }
  // Без turf avoidPolygons вернёт null, и маршрут построится БЕЗ зон объезда,
  // ничего об этом не сказав. Поэтому ждём явно, а не надеемся на прогрев.
  try{ await ensureTurf(); }catch(e){ $('rStatus').innerHTML='<span class="err">'+esc(e.message)+'</span>'; return; }
  const hits=avoidHits(stops); if(hits.length){ $('rStatus').innerHTML='<span class="err">В зоне объезда: '+esc(hits.join(', '))+'. ORS не построит маршрут к точке внутри «кирпича» — уменьши радиус или убери зону.</span>'; return; }
  rBusy=true; $('rBuild').disabled=true; if($('rOpt')) $('rOpt').disabled=true; $('rStatus').textContent='Считаю…';
  const pref=$('rPref').value; const coords=stops.map(s=>[s.lng,s.lat]); const ap=avoidPolygons();
  try{
    if(!ap){ const body={coordinates:coords,preference:pref}; if(stops.length===2) body.alternative_routes={target_count:3,weight_factor:1.6,share_factor:0.6};
      const gj=await orsPost(ORS_DIR,body); rVariants=(gj.features||[]).filter(f=>f&&f.geometry); rVarSel=0;
      if(!rVariants.length) throw new Error('ORS вернул пустой маршрут.'); applyRVariant(); renderRVariants(); return; }
    try{ const gj=await orsPost(ORS_DIR,{coordinates:coords,preference:pref,options:{avoid_polygons:ap}});
      rVariants=(gj.features||[]).filter(f=>f&&f.geometry); rVarSel=0;
      if(!rVariants.length) throw new Error('ORS вернул пустой маршрут.'); applyRVariant(); renderRVariants(); return;
    }catch(e){ if(!isAvoidLimit(e.raw)) throw e; }
    $('rStatus').textContent='Маршрут длиннее 150 км — строю по участкам, чтобы объезды работали…';
    const legs=[], skipped=[]; let splits=0;
    for(let i=0;i<stops.length-1;i++){
      const res=await legWithAvoid(stops[i],stops[i+1],pref,ap,m=>{ $('rStatus').textContent=m; });
      legs.push(res.feature); if(res.split) splits+=res.split;
      if(res.noAvoid) skipped.push((stops[i].name||'?')+' → '+(stops[i+1].name||'?')); }
    rVariants=[mergeFeatures(legs)]; rVarSel=0; applyRVariant(); renderRVariants();
    if(skipped.length) $('rStatus').innerHTML+='<div class="hint" style="color:var(--red);margin-top: var(--sp-2)">Объезды не применены: '+esc(skipped.join(' · '))+'</div>';
    else $('rStatus').innerHTML+='<span class="hint" style="margin: 0"> · по участкам</span>';
  }catch(e){ $('rStatus').innerHTML='<span class="err">Ошибка: '+esc(e.message||e)+'</span>'; } finally{ rBusy=false; updateRouteActions(); } }
function applyRVariant(){ const f=rVariants[rVarSel]; if(!f) return; const sum=(f.properties&&f.properties.summary)||{}; rRoute={km:(+sum.distance||0)/1000,driveH:(+sum.duration||0)/3600,geometry:f.geometry}; $('rStatus').innerHTML='<span class="ok">'+rRoute.km.toFixed(1)+' км · '+rRoute.driveH.toFixed(1)+' ч</span>'+((appSettings.avoid_zones||[]).length?('<span class="hint" style="margin: 0"> · объезды: '+appSettings.avoid_zones.length+'</span>'):''); drawStops(); rBuildBuffer(); }
function renderRVariants(){ const box=$('rVariants'); if(rVariants.length<2){ box.innerHTML=''; return; } box.innerHTML='';
  rVariants.forEach((f,i)=>{ const sum=(f.properties&&f.properties.summary)||{}; const b=document.createElement('button'); b.className='btn sm'+(i===rVarSel?' amber':''); b.style.cssText='margin: 0 var(--sp-3) var(--sp-3) 0'; b.textContent='№'+(i+1)+' · '+((+sum.distance||0)/1000).toFixed(1)+'км · '+Math.round((+sum.duration||0)/60)+'мин'; b.onclick=()=>{ rVarSel=i; applyRVariant(); renderRVariants(); }; box.appendChild(b); }); }
$('corDist').onclick=()=>{ $('corDist').classList.add('on'); $('corTime').classList.remove('on'); $('corDistBox').style.display=''; $('corTimeBox').style.display='none'; bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; rBuildBuffer(); };
$('corTime').onclick=()=>{ $('corTime').classList.add('on'); $('corDist').classList.remove('on'); $('corTimeBox').style.display=''; $('corDistBox').style.display='none'; bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; };
$('rBuf').oninput=e=>{ bufferKm=+e.target.value; $('rBufVal').textContent=bufferKm+' км'; rBuildBuffer(); };
$('rIso').oninput=e=>{ isoMin=+e.target.value; $('rIsoVal').textContent=isoMin+' мин'; };
$('rIsoBuild').onclick=buildIsochrone;
async function rBuildBuffer(){ if(!rRoute.geometry||bufferKm<=0){ bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; return; }
  try{ await ensureTurf(); }catch(e){ $('rCorridor').innerHTML='<div class="err">'+esc(e.message)+'</div>'; return; }
  let poly; try{ poly=turf.buffer(turf.feature(rRoute.geometry),bufferKm,{units:'kilometers'}); }catch(e){ return; }
  applyCorridor([poly]); }
async function buildIsochrone(){ if(!rRoute.geometry){ $('rCorridor').innerHTML='<div class="hint">Сначала построй маршрут.</div>'; return; } if(isoMin<=0){ bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; return; } if(orsKeyMissing()){ orsMissing($('rCorridor')); return; }
  const coords=rRoute.geometry.coordinates||[]; const n=coords.length; if(n<2) return; const k=Math.min(5,n); const locs=[]; for(let i=0;i<k;i++){ locs.push(coords[Math.round(i*(n-1)/(k-1||1))]); }
  $('rCorridor').innerHTML='<div class="hint">Строю изохрону…</div>';
  try{ await ensureTurf(); }catch(e){ $('rCorridor').innerHTML='<div class="err">'+esc(e.message)+'</div>'; return; }
  try{ const gj=await orsPost('https://api.openrouteservice.org/v2/isochrones/driving-car',{locations:locs,range:[isoMin*60],range_type:'time'});
    const polys=(gj.features||[]); if(!polys.length){ $('rCorridor').innerHTML='<div class="hint">Изохрона пуста.</div>'; return; } applyCorridor(polys);
  }catch(e){ $('rCorridor').innerHTML='<div class="err">Ошибка: '+esc(e.message||e)+'</div>'; } }
function applyCorridor(polys){ bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; if(!polys||!polys.length) return;
  polys.forEach(p=>{ try{ L.geoJSON(p,{style:{color:theme.accent,weight:1.5,fillColor:theme.accent,fillOpacity:.08,dashArray:'4 6'}}).addTo(bufferLayer); }catch(e){} });
  const inside=(lng,lat)=>polys.some(p=>{ try{ return turf.booleanPointInPolygon(turf.point([lng,lat]),p); }catch(e){ return false; } });
  const inClients=clients.filter(c=>!routeHasClient(c.id)&&inside(c.lng,c.lat));
  const inEquip=[]; clients.forEach(c=>(eqByClient[c.id]||[]).forEach(e=>{ if(e.lat!=null&&e.lng!=null&&inside(e.lng,e.lat)){ inEquip.push({c,e}); L.polyline([[c.lat,c.lng],[e.lat,e.lng]],{color:theme.accent,weight:2,opacity:.7,dashArray:'2 4'}).addTo(bufferLayer); L.circleMarker([e.lat,e.lng],{radius:5,color:ringColor(),fillColor:theme.accent,fillOpacity:.75,weight:2}).addTo(bufferLayer); } }));
  const box=$('rCorridor');
  if(!inClients.length&&!inEquip.length){ box.innerHTML='<div class="hint">В коридоре нет новых точек.</div>'; return; }
  box.innerHTML='';
  if(inClients.length){ const hd=document.createElement('div'); hd.className='hint'; hd.style.margin='0 0 4px'; hd.innerHTML='Клиенты ('+inClients.length+') · <a id="rAddAllC" style="color:var(--cyan);cursor:pointer">добавить всех</a>'; box.appendChild(hd);
    inClients.slice(0,40).forEach(c=>{ const d=document.createElement('div'); d.className='pt'; d.innerHTML='<div class="nm"><span class="dot" style="background:'+esc(c.color||'#9aa1ad')+'"></span>'+esc(c.name)+'</div><div class="acts"><button class="btn sm" data-radd="'+c.id+'">+ в маршрут</button></div>'; box.appendChild(d); }); }
  if(inEquip.length){ const hd=document.createElement('div'); hd.className='hint'; hd.style.margin='8px 0 4px'; hd.textContent='Техника в коридоре ('+inEquip.length+')'; box.appendChild(hd);
    inEquip.slice(0,40).forEach(o=>{ const d=document.createElement('div'); d.className='pt'; d.innerHTML='<div class="nm"><span class="dot" style="background:'+esc(o.c.color||'#9aa1ad')+'"></span>'+esc(o.c.name)+' · '+esc(o.e.model||'')+'</div><div class="acts"><button class="btn sm" data-readd="'+o.c.id+'|'+o.e.id+'">+ в маршрут</button></div>'; box.appendChild(d); }); }
  box.querySelectorAll('[data-radd]').forEach(b=>b.onclick=()=>addClientToRoute(b.dataset.radd));
  box.querySelectorAll('[data-readd]').forEach(b=>b.onclick=()=>{ const a=b.dataset.readd.split('|'); addEquipToRoute(a[0],a[1]); });
  const aa=$('rAddAllC'); if(aa) aa.onclick=()=>{ inClients.forEach(c=>pushClientStop(c)); renderRoutePanel(); resetBuilt(); }; }
$('rSaveTrip').onclick=async ()=>{ const stops=routeStopsAll(); if(stops.length<2){ notify('Нужно минимум 2 точки.','warn'); return; }
  const clientIds=[...new Set(rStops.filter(s=>s.clientId).map(s=>s.clientId))];
  let linked=[]; if(clientIds.length){ try{ const {data}=await sb.from('jobs').select('id, client_id, clients(name,lat,lng), equipment(lat,lng), job_works(hours,billable,revenue,tariff_profile)').is('deleted_at',null).in('client_id',clientIds).not('status','in','(done,cancelled)'); linked=data||[]; }catch(e){} }
  const exist=plannerTripId?(trips.find(x=>x.id==plannerTripId)||{}):{};
  const ov=exist.overrides||{};
  // Километраж по плательщикам — по реальным дорогам, один раз здесь.
  // Если не посчитался (ORS молчит), оставляем прежний из выезда.
  $('rStatus').textContent='Считаю километраж по плательщикам…';
  const roadKm=await computeRoadKmByPayer(linked, exist.main_job_id||null,
    m=>{ $('rStatus').textContent=m; }) || exist.road_km_by_payer || null;
  $('rStatus').textContent='';

  // Снимок собирается ТЕМ ЖЕ сборщиком и с ТЕМ ЖЕ контекстом, что и в
  // карточке выезда. Раньше здесь было четыре тихих отличия, и каждое
  // меняло цифры:
  //   • econCompute звался ДО расчёта километража → выручка по дороге
  //     считалась по прямым линиям (занижение на 30–45%, см. economics.js);
  //   • tariffs_snapshot собирался без tariff_profiles → ставки выезда
  //     не фиксировались, и правка тарифа задним числом переписывала
  //     экономику уже сохранённых выездов;
  //   • не передавались даты → дни считались из часов, а не по календарю;
  //   • не передавался факт → cost означал план, тогда как из карточки
  //     в то же поле уезжал факт.
  const T=tripT();
  const e=econSnapshot(linked,rRoute.km,rRoute.driveH,T,ov,{
    roadKm:roadKm, start:rStart,
    dateFrom:exist.date_from||null, dateTo:exist.date_to||null,
    factKm:exist.fact_km!=null?exist.fact_km:null,
    factWorkH:plannerTripId?(factHByTrip[plannerTripId]!=null?factHByTrip[plannerTripId]:null):null
  },linked.length);

  const rec={route_stops:stops.map(s=>({type:s.type,name:s.name,lat:s.lat,lng:s.lng,clientId:s.clientId||null,equipId:s.equipId||null,description:s.description||''})),route_geometry:slimGeometry(rRoute.geometry)||null,road_km_by_payer:roadKm,overrides:ov,econ_snapshot:e,tariffs_snapshot:T};
  let tid=plannerTripId;
  try{ if(plannerTripId){ const {error}=await sb.from('trips').update(rec).eq('id',plannerTripId); if(error) throw error; }
    else { rec.status='planned'; rec.created_by=session.user.id; const {data,error}=await sb.from('trips').insert(rec).select('id').single(); if(error) throw error; tid=data.id; plannerTripId=tid; }
    if(plannerTripId&&tid===plannerTripId&&exist.id){ // update: мёрджим связи, ручные снятия не возвращаем
      const {data:cur}=await sb.from('trip_jobs').select('job_id').eq('trip_id',tid); const have=new Set((cur||[]).map(r=>r.job_id));
      const fresh=linked.filter(j=>!have.has(j.id)); if(fresh.length){ const rows=fresh.map((j,i)=>({trip_id:tid,job_id:j.id,ord:have.size+i})); const {error}=await sb.from('trip_jobs').insert(rows); if(error) throw error; }
    } else {
      await sb.from('trip_jobs').delete().eq('trip_id',tid);
      if(linked.length){ const rows=linked.map((j,i)=>({trip_id:tid,job_id:j.id,ord:i})); const {error}=await sb.from('trip_jobs').insert(rows); if(error) throw error; }
    }
    await renderTrips(); await openTrip(tid); showToast('Выезд сохранён');
  }catch(e){ console.error('Сохранение маршрута не прошло:', e, '\nСТЕК:', e&&e.stack, '\nдетали БД:', e&&(e.details||e.hint||e.code)); notify('Ошибка сохранения: '+(e.message||e),'err'); } };

$('linkSkip').onclick=()=>{ $('linkOverlay').classList.remove('on'); pendingLinkClient=null; };
$('linkCreate').onclick=()=>{ $('linkOverlay').classList.remove('on'); const cid=pendingLinkClient; pendingLinkClient=null; if(cid) openJob(null,cid); };
// ---------- economics breakdown ----------
function econRow(k,v){ return '<div style="display:flex;justify-content:space-between;font-size: var(--fs-4);padding: var(--sp-1) 0"><span class="hint" style="margin: 0">'+esc(k)+'</span><span>'+esc(v)+'</span></div>'; }


// kmBetween и circuitKm жили здесь своими копиями, дублируя src/core/geo.js.
// Копии перекрывали импорт: подъём объявлений делал их видимыми во всём
// модуле, и весь километраж планировщика считался мимо тестов ядра.
// Теперь kmBetween берётся из core (см. импорт наверху), а circuitKm отсюда
// не вызывался вовсе — он нужен только внутри economics.js, где и живёт.


// Разбивка экономики одной строкой HTML: её показывают и окном (из списка
// выездов), и врезкой на странице выезда. mapId разводит две мини-карты,
// чтобы они не подрались за один id.
function econHTML(d, mapId){
  const cur=d.cur||'';
  const money0=n=>Math.round(+n||0).toLocaleString('ru-RU');
  const row=(k,v,cls)=>'<div class="erow'+(cls?' '+cls:'')+'"><span class="ek">'+k+'</span><span class="ev">'+v+'</span></div>';
  const head=t=>'<div class="ehead">'+t+'</div>';
  let h='';

  // ── Заявки: только работы. Транспорт на заявки не раскладывается —
  //    он уже распределён по плательщикам ниже.
  h+=head('Заявки · работы');
  if(d.perJob&&d.perJob.length){
    d.perJob.forEach(p=>{
      const hasFact=(p.factHours!=null);
      const costTxt=hasFact
        ? money0(p.costFact)+' <span class="edim">(факт '+p.factHours.toFixed(1)+' ч)</span>'
        : money0(p.costPlan)+' <span class="edim">(план '+p.hours.toFixed(1)+' ч)</span>';
      const pc=p.profit>=0?'var(--green)':'var(--red)';
      h+='<div class="ejob">'
        +'<div class="ejob-t"><b>'+esc(p.name)+'</b>'
        +(p.warrantyHours>0?' <span class="ewarr">гар. '+p.warrantyHours.toFixed(1)+' ч</span>':'')+'</div>'
        +row('Выручка', money0(p.revenue)+' '+cur)
        +row('Себестоимость труда', costTxt+' '+cur)
        +row('Прибыль', '<b style="color:'+pc+'">'+money0(p.profit)+' '+cur+'</b>')
        +'</div>';
    });
  } else h+='<div class="ehint">Заявок нет — выручка по работам 0.</div>';

  // ── Транспорт: по плательщикам (или плоско)
  h+=head('Транспорт'+(d.factKm!=null?' · факт '+Math.round(d.factKm)+' км':''));
  if(d.roadGroups&&d.roadGroups.length){
    let sumKm=0;
    d.roadGroups.forEach(g=>{
      sumKm+=+g.km||0;
      h+=row(esc(g.name)+' <span class="edim">'+g.count+' точ. · '+g.km.toFixed(0)+' км × '+g.rate+'</span>',
             money0(g.rev)+' '+cur+(g.ov?' <span class="edim">(вручную)</span>':''));
    });
    // Сумма километров по плательщикам БОЛЬШЕ длины маршрута — и это верно.
    // У каждого плательщика свой круг «Депо → его точки → Депо», круги
    // накладываются друг на друга, поэтому в сумме дают больше, чем один
    // общий проезд. Без этой строки цифры выглядят как ошибка вдвое:
    // 3994 км по плательщикам при маршруте в 1734.
    if(d.roadGroups.length>1&&d.km>0&&sumKm>d.km*1.05){
      h+='<div class="ehint">Сумма '+Math.round(sumKm)+' км больше маршрута ('
        +Math.round(d.km)+' км) не по ошибке: у каждого плательщика свой круг '
        +'«Депо → его точки → Депо», и круги накладываются.</div>';
    }
  } else {
    h+=row('Дорога <span class="edim">'+d.km.toFixed(0)+' км</span>', money0(d.rTravel)+' '+cur);
  }
  h+=row('Командировочные <span class="edim">'+d.days+' дн / '+d.nights+' ноч</span>', money0(d.rPerDiem)+' '+cur);

  // ── Итоги
  h+=head('Итого');
  h+=row('Выручка', '<b>'+money0(d.rev)+' '+cur+'</b>'+(d.revOv?' <span class="edim">(вручную)</span>':''));
  // При ручной сумме разбивка выше перестаёт объяснять итог, но продолжает
  // стоять над ним. Показываем расчётное значение и разницу, иначе читатель
  // складывает строки, не сходится и не понимает почему.
  if(d.revOv&&d.revComputed!=null){
    const dl=d.rev-d.revComputed;
    h+='<div class="ehint">По расчёту вышло '+money0(d.revComputed)+' '+cur
      +' — строки выше складываются в него. Ручная сумма отличается на '
      +(dl>=0?'+':'')+money0(dl)+' '+cur+'.</div>';
  }
  const kmTxt=(d.factKm!=null)?('факт '+Math.round(d.costKm)+' км, план '+Math.round(d.km)+' км'):(Math.round(d.km)+' км');
  const laborTxt=(d.factWorkH!=null)?('факт '+d.factWorkH.toFixed(1)+' ч, норма '+d.workH.toFixed(1)):(d.workH.toFixed(1)+' ч');
  h+=row('Затраты <span class="edim">труд '+laborTxt+' · '+kmTxt+'</span>',
         '<b>'+money0(d.cost)+' '+cur+'</b>'+(d.costOv?' <span class="edim">(вручную)</span>':''));
  if(d.costOv&&d.costComputed!=null){
    const dl=d.cost-d.costComputed;
    h+='<div class="ehint">По расчёту вышло '+money0(d.costComputed)+' '+cur
      +'. Ручная сумма отличается на '+(dl>=0?'+':'')+money0(dl)+' '+cur+'.</div>';
  }
  const pc=d.profit>=0?'var(--green)':'var(--red)';
  h+='<div class="etotal"><span>Прибыль</span><span style="color:'+pc+'"><b>'+money0(d.profit)+' '+cur+'</b> · '+d.margin.toFixed(0)+'%</span></div>';
  if(d.wh>0) h+='<div class="ehint">Гарантийные часы '+d.wh.toFixed(1)+' ч · доля '+d.share+'%</div>';

  // ── Мини-карта план/факт (рисуется после вставки html)
  h+='<div id="'+mapId+'Wrap" style="display:none"><div class="ehead">Маршрут</div>'
    +'<div id="'+mapId+'" class="emap"></div>'
    +'<div class="eleg"><span><i class="edash"></i>план</span><span><i class="esolid"></i>факт</span></div></div>';

  return h;
}


// Мини-карта на странице выезда. Раньше её роль играла кнопка «Экономика»
// в списке — окно, куда карта была спрятана вместе с разбивкой. Разбивка
// переехала на страницу, карта тоже: смотреть на маршрут, редактируя его,
// естественнее, чем открывать ради этого отдельное окно.
async function drawTripMap(t){
  const wrap=$('tpMapWrap'); if(!wrap) return;
  wrap.style.display='none';
  if(!t) return;
  const d={geoPlan:null,geoFact:null};
  // План: геометрия маршрута, как её вернул роутер.
  const g=t.route_geometry;
  if(g&&g.coordinates&&g.coordinates.length) d.geoPlan=g.coordinates.map(c=>[c[1],c[0]]);
  else {
    // Маршрут не строили — рисуем хотя бы ломаную по остановкам.
    const st=(t.route_stops||[]).filter(x=>x&&x.lat!=null&&x.lng!=null);
    if(st.length>1) d.geoPlan=st.map(x=>[+x.lat,+x.lng]);
  }
  // Факт: трек машины за дни выезда, если он есть.
  try{
    const {data}=await sb.from('vehicle_positions').select('lat,lng,ts')
      .eq('trip_id',t.id).order('ts',{ascending:true}).limit(2000);
    if(data&&data.length>1) d.geoFact=data.map(r=>[+r.lat,+r.lng]);
  }catch(e){}
  if(!d.geoPlan&&!d.geoFact) return;
  drawEconMap(d,'tpMap');
}

// Мини-карта: плановый маршрут пунктиром, реально пройденный — сплошной.
// Данные кладёт drawTripMap в d.geoPlan / d.geoFact; если их нет, блок скрыт.
function drawEconMap(d, mapId){
  mapId=mapId||'econMap';
  const wrap=$(mapId+'Wrap'); if(!wrap) return;
  const hasPlan=d.geoPlan&&d.geoPlan.length, hasFact=d.geoFact&&d.geoFact.length;
  if(!hasPlan&&!hasFact) return;
  wrap.style.display='';
  try{
    // Слот на каждую карту свой: страница выезда и врезка экономики могут
    // жить одновременно, и общий слот убивал бы чужую карту.
    window._miniMaps=window._miniMaps||{};
    if(window._miniMaps[mapId]){ window._miniMaps[mapId].remove(); window._miniMaps[mapId]=null; }
    const m=L.map(mapId,{zoomControl:false});
    window._miniMaps[mapId]=m;
    // Те же тайлы, что и на главной карте. Раньше здесь стоял cartocdn —
    // единственное место в приложении с другим поставщиком. Он раздаёт
    // тайлы только по ключу, и без ключа возвращал картинки с надписью
    // «API KEY» поперёк всей карты, прямо под итоговой прибылью.
    // Указание авторства OSM обязательно по лицензии, поэтому
    // attributionControl больше не отключаем.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom:19,attribution:'© OpenStreetMap',
       className:(theme.mode==='dark'?'dark-tiles':'')}).addTo(m);
    const layers=[];
    if(hasPlan) layers.push(L.polyline(d.geoPlan,{color:'#9aa1ad',weight:3,dashArray:'6,6',opacity:.9}).addTo(m));
    if(hasFact) layers.push(L.polyline(d.geoFact,{color:'#ffe100',weight:3,opacity:.95}).addTo(m));
    const g=L.featureGroup(layers); m.fitBounds(g.getBounds(),{padding:[16,16]});
    setTimeout(()=>{ try{ m.invalidateSize(); }catch(e){} },60);
  }catch(e){ wrap.style.display='none'; }
}
if($('tpJobsRoute')) $('tpJobsRoute').onchange=renderTripJobs;
// [сборка] showTripEcon удалён вместе с окном экономики: страница выезда
// показывает ту же разбивку врезкой, а карту план/факт — в карточке маршрута.

// ---------- акт выполненных работ ----------
function printDoc(html){ const f=document.createElement('iframe'); f.setAttribute('aria-hidden','true'); f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f); const d=f.contentWindow.document; d.open(); d.write(html); d.close();
  setTimeout(()=>{ try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){} setTimeout(()=>{ try{ f.remove(); }catch(e){} },1500); },350); }
function actNo(job){ const d=job.scheduled_date?new Date(job.scheduled_date):new Date(); const p=n=>String(n).padStart(2,'0'); return p(d.getDate())+p(d.getMonth()+1)+String(d.getFullYear()).slice(2)+'-'+String(job.id||'').replace(/-/g,'').slice(0,4).toUpperCase(); }
function actDate(job){ const d=job.scheduled_date?new Date(job.scheduled_date):new Date(); const p=n=>String(n).padStart(2,'0'); return p(d.getDate())+'.'+p(d.getMonth()+1)+'.'+d.getFullYear(); }

function workName(w){ if(w.title) return w.title; const cw=w.work_id?catalog.find(c=>c.id===w.work_id):null; return cw?cw.name:'Работа'; }
function buildActHtml(job){ const co=appSettings.company||{}; const tpl=appSettings.act_template||{}; const execRole=tpl.execRole||'Исполнитель'; const custRole=tpl.custRole||'Заказчик'; const cur=appSettings.currency||'грн'; const cl=job.clients||{}; const eq=job.equipment||null; const works=job.job_works||[]; let total=0;
  const rows=works.map((w,i)=>{ const h=+w.hours||0; const bill=w.billable!==false; const sum=bill?(+w.revenue||0):0; total+=sum; const price=bill?(h>0?sum/h:sum):0;
    return '<tr><td class="c">'+(i+1)+'</td><td>'+esc(workName(w))+(bill?'':' <span class="warr">(гарантия)</span>')+'</td><td class="c">'+(h?h.toLocaleString('ru-RU'):'—')+'</td><td class="r">'+(bill?money(price):'—')+'</td><td class="r">'+money(sum)+'</td></tr>'; }).join('');
  const mats=[]; works.forEach(w=>(w.materials||[]).forEach(m=>{ if(m&&m.name) mats.push(m); }));
  const matsHtml=mats.length?('<div class="sec">Использованные материалы</div><table class="mt"><thead><tr><th>Наименование</th><th class="c" style="width:90px">Кол-во</th><th style="width:70px">Ед.</th></tr></thead><tbody>'+mats.map(m=>'<tr><td>'+esc(m.name)+'</td><td class="c">'+esc(String(m.qty==null?'':m.qty))+'</td><td>'+esc(m.unit||'')+'</td></tr>').join('')+'</tbody></table>'):'';
  const hasWarr=works.some(w=>w.billable===false);
  const equipLine=eq?('<div class="eqline"><b>Оборудование:</b> '+esc(eq.model||'')+(eq.serial?(' · S/N '+esc(eq.serial)):'')+(eq.kind?(' · '+esc(eq.kind)):'')+'</div>'):'';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Акт '+esc(actNo(job))+'</title>'+
    '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">'+
    '<style>@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}'+
    'body{font-family:"IBM Plex Sans",Arial,sans-serif;color:#111;font-size: var(--fs-3);line-height:1.5;margin: 0;padding: var(--sp-6)}'+
    '.org{font-size: var(--fs-6);font-weight:700}.org-d{color:#555;white-space:pre-line;font-size: var(--fs-2);margin-top: var(--sp-1)}'+
    'h1{font-size: var(--fs-7);font-weight:700;text-align:center;margin: var(--sp-6) 0 var(--sp-1)}.subt{text-align:center;color:#555;font-size: var(--fs-3);margin-bottom: var(--sp-5)}'+
    '.parties{display:flex;gap: var(--sp-6);margin: var(--sp-5) 0}.parties>div{flex:1}'+
    '.parties .lbl{color:#888;font-size: var(--fs-1);text-transform:uppercase;letter-spacing:.6px;margin-bottom: var(--sp-1)}.parties .nm{font-weight:600}.parties .d{color:#555;white-space:pre-line;font-size: var(--fs-2);margin-top: var(--sp-1)}'+
    '.eqline{margin: var(--sp-3) 0;padding: var(--sp-3) var(--sp-3);background:#f6f6f6;border-radius: var(--r-sm)}'+
    'table{width:100%;border-collapse:collapse;margin-top: var(--sp-3)}th,td{border:1px solid #d6d6d6;padding: var(--sp-3) var(--sp-3);text-align:left;vertical-align:top}'+
    'th{background:#f2f2f2;font-weight:600;font-size: var(--fs-2);text-transform:uppercase;letter-spacing:.4px}td.c,th.c{text-align:center}td.r,th.r{text-align:right}tfoot td{font-weight:700;background:#fafafa}'+
    '.warr{color:#a06000;font-weight:600}.sec{font-weight:600;margin: var(--sp-5) 0 0;font-size: var(--fs-4)}.mt th,.mt td{font-size: var(--fs-2)}'+
    '.intro{margin: var(--sp-4) 0 var(--sp-1);font-size: var(--fs-3);color:#333;white-space:pre-line}.total-words{margin: var(--sp-5) 0 var(--sp-2);font-weight:600}.note{color:#777;font-size: var(--fs-2);margin-top: var(--sp-3)}'+
    '.sign{display:flex;gap: var(--sp-8);margin-top:46px}.sign>div{flex:1}.sign .role{font-size: var(--fs-2);color:#888;text-transform:uppercase;letter-spacing:.6px}.sign .line{border-top:1px solid #333;margin-top: var(--sp-7);padding-top: var(--sp-2);color:#555;font-size: var(--fs-2)}'+
    '@media print{body{padding: 0}}</style></head><body>'+
    '<div class="org">'+esc(co.name||'Организация')+'</div>'+(co.details?('<div class="org-d">'+esc(co.details)+'</div>'):'')+
    '<h1>'+esc(tpl.title||'Акт выполненных работ')+' № '+esc(actNo(job))+'</h1><div class="subt">от '+esc(actDate(job))+'</div>'+(tpl.intro?('<div class="intro">'+esc(tpl.intro)+'</div>'):'')+
    '<div class="parties"><div><div class="lbl">'+esc(execRole)+'</div><div class="nm">'+esc(co.name||'—')+'</div>'+(co.details?('<div class="d">'+esc(co.details)+'</div>'):'')+'</div>'+
    '<div><div class="lbl">'+esc(custRole)+'</div><div class="nm">'+esc(cl.name||'—')+'</div>'+(cl.description?('<div class="d">'+esc(cl.description)+'</div>'):'')+'</div></div>'+
    equipLine+
    '<table><thead><tr><th class="c" style="width:34px">№</th><th>'+esc(tpl.worksCol||'Наименование работ (услуг)')+'</th><th class="c" style="width:74px">Кол-во, ч</th><th class="r" style="width:110px">Цена, '+esc(cur)+'</th><th class="r" style="width:120px">Сумма, '+esc(cur)+'</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="5" class="c" style="color:#888">Работы не указаны</td></tr>')+'</tbody>'+
    '<tfoot><tr><td colspan="4" class="r">Итого</td><td class="r">'+money(total)+' '+esc(cur)+'</td></tr></tfoot></table>'+
    matsHtml+
    '<div class="total-words">'+esc((tpl.totalWords||'Всего оказано услуг на сумму {sum}.').replace('{sum}', money(total)+' '+cur))+'</div>'+
    (hasWarr?('<div class="note">'+esc(tpl.warrNote||'Работы, отмеченные как «гарантия», выполнены в рамках гарантийных обязательств и оплате не подлежат.')+'</div>'):'')+
    (tpl.note?('<div class="note">'+esc(tpl.note)+'</div>'):'')+
    '<div class="sign"><div><div class="role">'+esc(execRole)+'</div><div class="line">'+esc(co.signer||' ')+'</div></div>'+
    '<div><div class="role">'+esc(custRole)+'</div><div class="line">'+esc(tpl.custSign||'подпись / ФИО')+'</div></div></div></body></html>'; }
// ---------- xlsx act ----------



function actSubSimple(str,d){ let s=str; for(let pass=0;pass<2;pass++){ if(s.indexOf('{{')<0) break; s=s.replace(/\{\{\s*([A-Za-zА-Яа-яЁё0-9_]+)\s*\}\}/g,(m,k)=>(d[k]!=null?String(d[k]):m)); } return s; }
function actSubWork(str,w,i){ return str.replace(/\{\{w_(no|name|hours|price|sum)\}\}/g,(_,k)=>{ if(k==='no') return String(i+1); return (w[k]!=null?String(w[k]):''); }); }
function actFillSheet(ws,data){ let tplRow=null; ws.eachRow({includeEmpty:true},(row,rn)=>{ if(tplRow) return; row.eachCell({includeEmpty:true},cell=>{ if(typeof cell.value==='string'&&/\{\{w_/.test(cell.value)) tplRow=rn; }); });
  if(tplRow){ const works=data.works||[]; const n=works.length; if(n>1) ws.duplicateRow(tplRow,n-1,true); if(n===0){ ws.spliceRows(tplRow,1); } else { for(let i=0;i<n;i++){ const row=ws.getRow(tplRow+i); row.eachCell({includeEmpty:true},cell=>{ if(typeof cell.value==='string') cell.value=actSubWork(cell.value,works[i],i); }); } } }
  ws.eachRow({includeEmpty:true},row=>{ row.eachCell({includeEmpty:true},cell=>{ if(typeof cell.value==='string'&&cell.value.indexOf('{{')>=0) cell.value=actSubSimple(cell.value,data); }); }); }
function jobActPayer(job){ const works=job.job_works||[]; const paid=works.find(w=>w.billable!==false&&w.tariff_profile); if(paid) return profileById(paid.tariff_profile); const any=works.find(w=>w.tariff_profile); return any?profileById(any.tariff_profile):null; }

// Правило «одна заявка = один плательщик» — договорённость, на которую акт
// молча опирается: jobActPayer берёт профиль ПЕРВОЙ платной работы, а сумма
// складывается по ВСЕМ платным. Совпади на заявке два плательщика — счёт
// целиком уедет одному, без единого сообщения. Правило, на которое опирается
// код, обязано быть проверяемым, а не подразумеваемым.
//
// Гарантия здесь ни при чём: её выручка — внутренняя цифра для аналитики,
// в акт она не идёт и плательщика акта не определяет.
function actBlocker(job){
  const works=(job.job_works||[]).filter(w=>w.billable!==false);
  if(!works.length) return 'В заявке нет платных работ — актировать нечего. Гарантийные работы в акт не входят: это внутренняя цифра, «Производство» по ним не платит.';
  const ids=[...new Set(works.map(w=>w.tariff_profile).filter(Boolean))];
  if(ids.length>1){
    const names=ids.map(i=>{ const p=profileById(i); return p?p.name:'(профиль удалён)'; });
    return 'На заявке платные работы разных плательщиков: '+names.join(', ')+
           '. Акт выставляется одному — сумма ушла бы не туда. Раздели заявку по плательщикам.';
  }
  if(!ids.length) return 'У платных работ не проставлен тариф — непонятно, кому выставлять акт.';
  return null;
}
function buildActData(job){ const co=appSettings.company||{}; const tpl=appSettings.act_template||{}; const cur=appSettings.currency||'грн'; const cl=job.clients||{}; const works=job.job_works||[]; let total=0;
  const wr=works.map(w=>{ const h=+w.hours||0; const bill=w.billable!==false; const sum=bill?(+w.revenue||0):0; total+=sum; return {name:workName(w)+(bill?'':' (гарантия)'),hours:h?h.toLocaleString('ru-RU'):'—',price:bill?(h>0?money(sum/h):money(sum)):'—',sum:money(sum)}; });
  const pay=jobActPayer(job); const tw=(tpl.totalWords||'Всего оказано услуг на сумму {sum}.').replace('{sum}',money(total)+' '+cur);
  const d={ number:actNo(job), date:actDate(job), exec_name:co.name||'', exec_details:co.details||'', exec_signer:co.signer||'', client:cl.name||'', client_details:cl.description||'', client_signer:cl.signer||'', payer:pay?pay.name:'', payer_details:pay?(pay.requisites||''):'', total:money(total)+' '+cur, total_words:tw, note:tpl.note||'', works:wr };
  (tpl.vars||[]).forEach(v=>{ if(v.k&&d[v.k]===undefined) d[v.k]=(v.v!=null?v.v:''); });
  return d; }
function wsToHtml(ws){ const skip={}, span={}; (ws.model.merges||[]).forEach(m=>{ const [a,b]=m.split(':'); const s=cellRC(a),e=cellRC(b); span[a]={cs:e.c-s.c+1,rs:e.r-s.r+1}; for(let r=s.r;r<=e.r;r++)for(let c=s.c;c<=e.c;c++){ if(r===s.r&&c===s.c) continue; skip[colLetter(c)+r]=1; } });
  let maxCol=1; ws.eachRow({includeEmpty:true},row=>{ if(row.cellCount>maxCol) maxCol=row.cellCount; });
  let h='<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size: var(--fs-4);color:#000">';
  for(let r=1;r<=ws.rowCount;r++){ const row=ws.getRow(r); h+='<tr>'; for(let c=1;c<=maxCol;c++){ const ref=colLetter(c)+r; if(skip[ref]) continue; const cell=row.getCell(c); const st=cell.style||{}; const f=st.font||{}; let css='border:1px solid #e2e2e2;padding: var(--sp-1) var(--sp-3);vertical-align:top;'; if(f.bold)css+='font-weight:bold;'; if(f.italic)css+='font-style:italic;'; if(f.size)css+='font-size:'+f.size+'px;'; if(f.color&&f.color.argb)css+='color:#'+f.color.argb.slice(-6)+';'; if(st.fill&&st.fill.fgColor&&st.fill.fgColor.argb)css+='background:#'+st.fill.fgColor.argb.slice(-6)+';'; const al=st.alignment||{}; if(al.horizontal)css+='text-align:'+al.horizontal+';'; const sp=span[ref]?(' colspan="'+span[ref].cs+'" rowspan="'+span[ref].rs+'"'):''; let v=cell.value; if(v&&typeof v==='object') v=v.richText?v.richText.map(t=>t.text).join(''):(v.text!=null?v.text:(v.result!=null?v.result:'')); h+='<td'+sp+' style="'+css+'">'+esc(v==null?'':String(v))+'</td>'; } h+='</tr>'; } return h+'</table>'; }
// Содержимое шаблона догружается только тогда, когда оно действительно
// нужно: при выгрузке акта или при скачивании самого шаблона.
async function ensureActXlsxData(){
  const ax=appSettings.act_xlsx||{};
  if(ax.data) return ax.data;
  if(!ax.name) return null;                  // шаблон не загружен вовсе
  const {data,error}=await sb.from('settings').select('act_xlsx').eq('id',true).single();
  if(error||!data||!data.act_xlsx||!data.act_xlsx.data){
    notify('Не удалось получить шаблон акта'+(error?(': '+error.message):''),'err');
    return null;
  }
  appSettings.act_xlsx={name:data.act_xlsx.name||ax.name,data:data.act_xlsx.data};
  return appSettings.act_xlsx.data;
}

async function genActXlsx(job){
  const ax=appSettings.act_xlsx||{}; if(!ax.name) return false;
  const b64=await ensureActXlsxData(); if(!b64) return false;
  // exceljs грузится только здесь — а сюда попадают, лишь когда загружен
  // шаблон xlsx и человек открыл акт. У большинства открытий приложения
  // этих 900 КБ теперь просто нет.
  try{ await ensureExcel(); }catch(e){ notify(e.message,'err'); return false; }
  try{ const bin=atob(b64); const buf=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i); const wb=new ExcelJS.Workbook(); await wb.xlsx.load(buf.buffer); const ws=wb.worksheets[0]; const data=buildActData(job); actFillSheet(ws,data);
    const out=await wb.xlsx.writeBuffer(); const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    $('axPreview').innerHTML=wsToHtml(ws);
    // URL освобождаем сразу после клика: без revoke каждый скачанный акт
    // держал свой буфер в памяти до перезагрузки вкладки.
    $('axDlBtn').onclick=()=>{ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download='Акт '+data.number+'.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000); };
    $('actXlsxOverlay').classList.add('on'); return true;
  }catch(e){ notify('Ошибка генерации акта по шаблону: '+(e.message||e),'err'); return false; } }
if($('axClose')) $('axClose').onclick=()=>$('actXlsxOverlay').classList.remove('on');
function updateAxInfo(){ const ax=appSettings.act_xlsx||{}; if($('axInfo')) $('axInfo').innerHTML=ax.name?('<span class="ok">Шаблон загружен: '+esc(ax.name||'act.xlsx')+'</span>'):'Шаблон не загружен — используется встроенный HTML-акт.'; }
if($('axFile')) $('axFile').onchange=e=>{ const file=e.target.files[0]; if(!file) return; if(file.size>3000000){ notify('Файл великоват (>3 МБ).','err'); return; } const rd=new FileReader(); rd.onload=async()=>{ const b64=String(rd.result).split(',')[1]; const ax={name:file.name,data:b64}; const {error}=await sb.from('settings').update({act_xlsx:ax}).eq('id',true); if(error){ notify(error.message,'err'); return; } appSettings.act_xlsx=ax; updateAxInfo(); showToast('Шаблон акта загружен'); $('axFile').value=''; }; rd.readAsDataURL(file); };
if($('axDownload')) $('axDownload').onclick=async()=>{ const ax=appSettings.act_xlsx||{}; if(!ax.name){ notify('Шаблон не загружен.','warn'); return; } const b64=await ensureActXlsxData(); if(!b64) return; const bin=atob(b64); const buf=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i); const u=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); const a=document.createElement('a'); a.href=u; a.download=ax.name||'act-template.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000); };
if($('axRemove')) $('axRemove').onclick=async()=>{ if(!await confirmDialog('Убрать Excel-шаблон акта? Вернётся встроенный HTML-акт.',{danger:true,okText:'Убрать'})) return; const {error}=await sb.from('settings').update({act_xlsx:{}}).eq('id',true); if(error){ notify(error.message,'err'); return; } appSettings.act_xlsx={name:null,data:null}; updateAxInfo(); };
async function openAct(id){ let job=null;
  try{ const {data,error}=await sb.from('jobs').select('*, clients(*), equipment(*), job_works(*)').eq('id',id).single(); if(error) throw error; job=data; }
  catch(e){ notify('Не удалось загрузить заявку: '+(e.message||e),'err'); return; }
  if(!catalog.length){ try{ await loadCatalog(); }catch(e){ loadFail('каталог работ',e); } }
  // Проверка ДО обеих веток (HTML и Excel) — точка входа одна.
  const stop=actBlocker(job); if(stop){ notify(stop,'err'); return; }
  if(!(appSettings.company&&appSettings.company.name)) showToast('Заполни реквизиты организации в Настройках — в акте будут пустые поля «Исполнителя»');
  if((appSettings.act_xlsx||{}).name){ if(await genActXlsx(job)) return; }
  printDoc(buildActHtml(job)); }

// ---------- boot ----------
(async function boot(){ const c=loadCfg(); if(!c.url||!c.key){ $('cfgOverlay').classList.add('on'); return; }
  try{ sb=window.supabase.createClient(c.url,c.key); }catch(e){ $('cfgOverlay').classList.add('on'); return; }
  watchAuth();
  const { data:{ session:s } }=await sb.auth.getSession(); if(s){ await onSignedIn(); } else { $('authOverlay').classList.add('on'); } })();
