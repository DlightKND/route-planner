Warning: truncated output (original token count: 167458)
Total output lines: 8235

// Приложение DLIGHT. Пока это цельный перенос боевого index.html в сборку:
// код тот же, но теперь это модуль: ядро подключается импортом.
// Обработчики вешаются из JS (.onclick=), инлайновых onclick в разметке нет,
// поэтому мост на window не нужен. Дальше извлекаем по модулю, см. MODULES.md.

import * as core from './core/index.js';
import { presenceSummary, validatePresence, remainingStops, presenceDaily, sameEditablePlan } from './core/trip-review.js';
import { presenceHTML, historyHTML, removedHTML, readPresenceForm, tripCostReviewHTML } from './trip-workbench.js';
import './trip-workbench.css';
import './service-orders.css';
import { createServiceOrders } from './service-orders.js';
import { installEngineerPickers } from './engineer-picker.js';
installEngineerPickers();
import { economicSnapshot } from './core/economic-snapshot.js';
import { calculateTripCostAllocation } from './core/trip-cost-allocation.js';
import { requestRouteProxy } from './core/route-proxy.js';

const serviceOrders=createServiceOrders({db:()=>sb,canWrite,profiles:()=>profilesList,ensureRefs,isPhone,wireDrag:wireKanbanDrag,notify,
 showBoard:()=>switchTab('planner','orders'),showOrder:()=>switchTab('order'),openJob,openTrip,tripStatus:s=>ST_TRIP[s]||s,
 tripCostSummary:async orderId=>{const {data,error}=await sb.rpc('service_order_trip_cost_summary',{p_order:orderId});if(error)throw error;return data||[];},
 confirmLeave:()=>window.confirm('Выйти без сохранения изменений задания?'),reason:async title=>window.prompt(title,'')});
serviceOrders.init();

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

const { money, hhmm, businessDays, jobRoadPayer, rateFrom, dedupeStops, tspOrder,
        econCompute, roadByPayer, jobPoint, partsMoney,
        vehAgeMin, vehAgeText, vehClass, vehTitle, vehBearing, vehLabel,
        jobUrgency, isCold, needsEngineer, attentionBuckets, urgencyRank,
        simplifyLine, kmBetween, todayISO, monthKey,
        planSchedule, scheduleJobIncluded, tripRouteSegments, driveOfLegs, piecesOf, normPos, addHours, diffHours, dayWindow, weekRowSpan, q4,
        trashDaysLeft,
        measureTrip } = core;


const $=id=>document.getElementById(id);


// ── Ленивая загрузка тяжёлых библиотек ──────────────────────────────────────
// turf (~500 КБ) висел тегом <script> в index.html и выполнялся ДО первой
// строки app.js — то есть приложение не начинало работать, пока библиотека
// не приедет. Нужна она только для маршрутов и экономики: инженеру в поле
// со слабой связью это полмегабайта ожидания ни за что.
//
// Здесь же грузился exceljs (~900 КБ) — ради выгрузки акта по шаблону xlsx.
// Генерация документов из приложения убрана, вместе с ней ушёл и exceljs.
//
// Хэши integrity перенесены из index.html дословно: проверка целостности
// осталась ровно та же, изменился только момент загрузки.
const LIBS={
  turf:{ src:'https://unpkg.com/@turf/turf@6.5.0/turf.min.js',
         integrity:'sha384-82q0nm29xZzIo5BMtDYnh2/NxeO6FoaK1S/0nF84w3cEsqbBfun3JdMyDVYWfVY5',
         global:'turf', label:'библиотеку геометрии (turf)' },
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
const LS_LOGIN_EMAIL='dl_login_email';
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
    // Указатель «где я» и кольцо фокуса — разные задачи, и в тёмной теме
    // их закрывает один и тот же жёлтый, а в светлой нет: жёлтая линия
    // на белом даёт контраст 1.31, а затемнённый жёлтый уходит в горчицу.
    // Поэтому токена два.
    '--accent-line':'#ffe100', '--focus':'#ffe100',
    '--nav-bg':'#24262b', '--nav-ink':'#ffe100',
    '--shadow-sm':'0 2px 8px rgba(0,0,0,.20)', '--shadow-md':'0 6px 18px rgba(0,0,0,.30)', '--shadow-lg':'0 12px 28px rgba(0,0,0,.38)',
    // Матовое стекло. Тон СВОЙ У КАЖДОЙ поверхности и равен её же сплошному
    // цвету: стекло делает панель прозрачной, а не перекрашивает её. Общий
    // тон на всё выглядел бы как смена темы — где-то светлее, где-то темнее,
    // чего никто не просил.
    //   --glass-panel — для того, что раньше было --panel (рельс, модалки,
    //                   всплывашки, тосты, панель карты);
    //   --glass-bg    — для того, что было --bg (липкие шапки разделов).
    //
    // Плотность ОДНА на всё приложение: 0.76. Раньше её было две — 0.58
    // у рельса и модалок и 0.90 у панели карты, — и рядом на одном экране
    // они читались как разный материал: панель почти сплошная, рельс рядом
    // с ней заметно темнее. Стекло, у которого плотность зависит от места,
    // перестаёт быть стеклом. 0.76 — середина между этими двумя.
    '--glass-panel':'rgba(26,28,32,0.76)', '--glass-bg':'rgba(16,17,20,0.76)'
  },
  light:{
    // Светлая тема была вдвое площе тёмной: bg → panel-2 давали контраст
    // 1.03 при 1.25 в тёмной, panel → panel-2 — 1.05 при 1.13. Три уровня
    // поверхностей лежали в пределах 4% друг от друга, слои не читались,
    // и всё сливалось в одну заливку. Шаги подобраны по контрастам тёмной
    // темы, а нейтраль уведена из синевы в тёплую: холодный серый спорил
    // с фирменным жёлтым.
    '--bg':'#e2e6ec', '--panel':'#ffffff', '--panel-2':'#f2f5f9', '--line':'#ccd4de',
    '--ink':'#0f141b', '--ink-dim':'#4e5866', '--ink-faint':'#7d8896',
    // Указатель остаётся фирменным жёлтым — под тёмным текстом он читается.
    // Фокус и выделение уходят в чернила: их работа — быть заметными,
    // а не фирменными. Горчица #b39400 давала на белом 2.94 — ниже порога
    // 3:1 для элементов интерфейса по WCAG 1.4.11, то есть была ещё
    // и недостаточно контрастной.
    '--accent-line':'#ffe100', '--focus':'#0f141b',
    '--nav-bg':'#ffe100', '--nav-ink':'#141414', 
    '--accent':'#ffe100', '--accent-ink':'#1a1d22', '--on-accent':'#141414', '--edge':'rgba(0,0,0,0)', // бренд-жёлтый для заливок/границ, тёмный текст-акцент для читаемости
    '--shadow-sm':'0 1px 2px rgba(15,20,27,.07), 0 2px 8px rgba(15,20,27,.07)',
    '--shadow-md':'0 4px 8px rgba(15,20,27,.07), 0 8px 20px rgba(15,20,27,.09)',
    '--shadow-lg':'0 8px 16px rgba(15,20,27,.07), 0 18px 40px rgba(15,20,27,.14)',
    // Те же цвета, что у сплошных поверхностей светлой темы: #ffffff и
    // #e2e6ec. Плотность чуть выше тёмной — на светлом фоне тонкая плёнка
    // слабее отделяет панель от подложки.
    '--glass-panel':'rgba(255,255,255,0.76)', '--glass-bg':'rgba(226,230,236,0.76)'
  }
};
function applyTheme(t){ theme=Object.assign({mode:'dark'},t||{});
  const pal=THEMES[theme.mode]||THEMES.dark, r=document.documentElement.style;
  document.documentElement.dataset.theme=theme.mode;
  for(const k in pal) r.setProperty(k,pal[k]);
  theme.accent=pal['--accent']||'#ffe100';
  $('modeDark').classList.toggle('on',theme.mode==='dark'); $('modeLight').classList.toggle('on',theme.mode==='light');
  setBaseLayer(theme.mode==='dark'?'dark':'light'); }
async function saveTheme(){ if(!sb||!session) return; try{ await sb.from('profiles').update({theme}).eq('id',session.user.id); }catch(e){} }
let toastT=null; function showToast(msg){ const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.remove('err','warn'); t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),2500); }
// Индикатор долгой работы. Пересчёт трека ходит в сеть и занимает секунды:
// без него человек видит замершую кнопку и решает, что сломалось. Доля
// известна не всегда — тогда крутилка без полосы.
let busyOn=false;
function busy(text,frac){
  const b=$('busy'); if(!b) return;
  busyOn=true; b.classList.add('on');
  if($('busyText')) $('busyText').textContent=text||'Работаю…';
  const bar=$('busyBar');
  if(bar) bar.style.width=(frac==null?0:Math.max(0,Math.min(1,frac))*100)+'%';
}
function busyDone(){ busyOn=false; const b=$('busy'); if(b) b.classList.remove('on'); }
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
function promptDialog(title,fields){ fields=fields||[]; return new Promise(res=>{ _pdRes=res; $('promptTitle').textContent=title||'Ввод'; $('promptFields').innerHTML=fields.map((f,i)=>'<label'+(i?' style="margin-top: var(--sp-3)"':'')+'>'+esc(f.label||'')+'</label>'+(f.type==='textarea'?('<textarea data-pf="'+esc(f.key)+'">'+esc(f.value||'')+'</textarea>'):f.type==='select'?('<select data-pf="'+esc(f.key)+'">'+(f.options||[]).map(o=>'<option value="'+esc(o.value)+'"'+(String(o.value)===String(f.value||'')?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>'):('<input type="text" data-pf="'+esc(f.key)+'" value="'+esc(f.value||'')+'">'))).join(''); $('promptOverlay').classList.add('on'); setTimeout(()=>{ const el=$('promptFields').querySelector('[data-pf]'); if(el){ try{ el.focus(); if(el.select) el.select(); }catch(e){} } },30); }); }
function _pdDone(ok){ const ov=$('promptOverlay'); let out=null; if(ok){ out={}; ov.querySelectorAll('[data-pf]').forEach(el=>{ out[el.dataset.pf]=el.value; }); } ov.classList.remove('on'); const r=_pdRes; _pdRes=null; if(r) r(out); }
$('promptYes').onclick=()=>_pdDone(true); $('promptNo').onclick=()=>_pdDone(false);
$('promptOverlay').addEventListener('click',e=>{ if(e.target===$('promptOverlay')) _pdDone(false); });
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; if($('confirmOverlay').classList.contains('on')) _cdDone(false); if($('promptOverlay').classList.contains('on')) _pdDone(false); });
window.gotoSettings=()=>{ try{ switchTab('settings'); }catch(e){} };
// Откуда взято число пробега — одним коротким словом рядом с ним.
// Пустой источник у старых выездов значит «пришло от Wialon».
function factSrcRu(src){
  if(src==='track') return '';
  if(src==='odometer') return ' (одометр)';
  if(src==='wialon'||!src) return ' (Wialon)';
  return '';
}
function orsKeyMissing(){ return !(appSettings.ors_proxy||'').trim(); }
function orsMissing(el){ if(el) el.innerHTML='Маршрутизация не настроена. <span class="lnk" onclick="gotoSettings()">Указать ключ ORS или адрес прокси в настройках</span>'; }
$('themeBtn').onclick=e=>{ e.stopPropagation(); $('themePop').classList.toggle('on'); };
document.addEventListener('click',e=>{ const p=$('themePop'); if(p.classList.contains('on') && !p.contains(e.target) && e.target!==$('themeBtn')) p.classList.remove('on'); });
$('modeDark').onclick=()=>{ theme.mode='dark'; applyTheme(theme); saveTheme(); if(typeof render==='function'&&clients&&clients.length) render(); if(typeof drawStops==='function') drawStops(); if(document.querySelector('.view-dash.active')) renderDashboard(); if(plannerCur==='mine') renderMine(); $('themePop').classList.remove('on'); };
$('modeLight').onclick=()=>{ theme.mode='light'; applyTheme(theme); saveTheme(); if(typeof render==='function'&&clients&&clients.length) render(); if(typeof drawStops==='function') drawStops(); if(document.querySelector('.view-dash.active')) renderDashboard(); if(plannerCur==='mine') renderMine(); $('themePop').classList.remove('on'); };
// закрытие модалок по фону и Esc
['baseOverlay','linkOverlay','editOverlay','eqOverlay','catOverlay'].forEach(id=>{ const o=$(id); if(o) o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('on'); }); });
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; ['baseOverlay','linkOverlay','editOverlay','eqOverlay','catOverlay'].forEach(id=>{ const o=$(id); if(o&&o.classList.contains('on')) o.classList.remove('on'); }); const tp=$('themePop'); if(tp) tp.classList.remove('on'); });

// ---------- logo ----------
(function(){ const lg=$('logoImg'); lg.onload=()=>{lg.style.display='block';$('wordmark').style.display='none';}; lg.onerror=()=>{lg.style.display='none';$('wordmark').style.display='';}; lg.src='./logo.png'; })();

// ---------- map ----------
const map=L.map('map',{zoomControl:true});

// ---------- подложка карты ----------
//
// Два стиля: «обычная» и «спутник». Обычная идёт за темой приложения —
// backdrop-v4-light и backdrop-v4-dark у MapTiler: это намеренно тихая
// подложка, на которой видно НАШИ точки, а не топонимы. Спутник —
// hybrid-v4, снимок с подписями и дорогами: без подписей на снимке
// невозможно понять, куда смотришь.
//
// Ключ MapTiler подставляется на сборке из секрета VITE_MAPTILER_KEY,
// в репозитории его нет. Без ключа приложение не ломается: обычная карта
// откатывается на OSM (тёмная — фильтром, как было раньше), а спутник
// недоступен, и кнопка гаснет с пояснением.
const MAPTILER_KEY=(import.meta.env&&import.meta.env.VITE_MAPTILER_KEY)||'';
const MT_ATTR='<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
const OSM_ATTR='© OpenStreetMap';
// Растровый XYZ-эндпоинт, а не style.json: карта на Leaflet, а style.json —
// это векторная спецификация для MapLibre GL. Leaflet её без плагина
// не понимает. Здесь MapTiler отрисовывает тот же стиль у себя и отдаёт
// готовые картинки: /{id}/{размер тайла}/{z}/{x}/{y}@2x.{формат}.
// @2x — версия для экранов с удвоенной плотностью; на телефоне без неё
// подписи мылят.
function mtUrl(id,fmt){ return 'https://api.maptiler.com/maps/'+id+'/256/{z}/{x}/{y}@2x.'+(fmt||'png')+'?key='+MAPTILER_KEY; }
// mtBroken — MapTiler ответил отказом: не тот домен у ключа, кончилась
// квота, сменился идентификатор стиля. Пустая карта в поле хуже старой,
// поэтому в этом случае молча возвращаемся на OSM (см. guardTiles).
let mtBroken=false;
function mtOn(){ return !!MAPTILER_KEY && !mtBroken; }
function hasSat(){ return mtOn(); }
// Если подложка не грузится, человек видит серый прямоугольник и не знает,
// что делать. Считаем неудачные тайлы: один-два — это сеть моргнула,
// шесть — это отказ. Тогда выбрасываем слои MapTiler и пересобираем всё
// на OSM, а спутник гасим.
function guardTiles(layer){
  if(!layer||!MAPTILER_KEY||!layer.on) return layer;
  let bad=0;
  layer.on('tileerror',()=>{
    if(mtBroken||++bad<6) return;
    mtBroken=true;
    Object.keys(baseLayers).forEach(k=>{ delete baseLayers[k]; });
    if(mapStyle==='sat'){ mapStyle='map'; try{ localStorage.removeItem(LS_MAPSTYLE); }catch(e){} }
    if(currentBase){ map.removeLayer(currentBase); currentBase=null; }
    applyBase(); syncMapStyleSeg();
    showToast('Подложка MapTiler не отвечает — вернулся на OpenStreetMap');
  });
  return layer;
}
// Каждый вызов создаёт НОВЫЙ слой: один экземпляр Leaflet нельзя повесить
// на две карты, а мини-карты выезда берут ту же подложку.
function makeBase(key){
  if(key==='sat'){ return mtOn()
    ? guardTiles(L.tileLayer(mtUrl('hybrid-v4','jpg'),{maxZoom:20,attribution:MT_ATTR}))
    : null; }
  const dark=(key==='map-dark');
  if(mtOn()) return guardTiles(L.tileLayer(mtUrl(dark?'backdrop-v4-dark':'backdrop-v4-light'),{maxZoom:20,attribution:MT_ATTR}));
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom:19,attribution:OSM_ATTR,className:dark?'dark-tiles':''});
}
const LS_MAPSTYLE='dl_map_style';
let mapMode='dark', mapStyle='map';
try{ if(localStorage.getItem(LS_MAPSTYLE)==='sat'&&MAPTILER_KEY) mapStyle='sat'; }catch(e){}
const baseLayers={};
let currentBase=null;
function baseKey(){ return mapStyle==='sat'?'sat':('map-'+mapMode); }
function applyBase(){
  const k=baseKey();
  const next=baseLayers[k]||(baseLayers[k]=makeBase(k));
  if(!next||next===currentBase) return;
  if(currentBase) map.removeLayer(currentBase);
  map.addLayer(next); currentBase=next;
  if(next.bringToBack) next.bringToBack();
}
// Тема зовёт эту функцию — она меняет ТОЛЬКО обычную подложку. На спутнике
// смена темы подложку не трогает: снимок не бывает светлым или тёмным.
function setBaseLayer(kind){ mapMode=(kind==='dark')?'dark':'light'; applyBase(); }
function setMapStyle(s){
  const want=(s==='sat')?'sat':'map';
  if(want==='sat'&&!hasSat()) return;
  mapStyle=want; try{ localStorage.setItem(LS_MAPSTYLE,mapStyle); }catch(e){}
  applyBase(); syncMapStyleSeg();
}
function syncMapStyleSeg(){
  const box=$('mapStyleSeg'); if(!box) return;
  box.querySelectorAll('button[data-mstyle]').forEach(b=>{
    b.classList.toggle('on',b.dataset.mstyle===mapStyle);
    // Присваиваем, а не включаем: было `if(...) disabled=true`, и кнопка,
    // однажды погашенная, уже не могла ожить.
    if(b.dataset.mstyle==='sat') b.disabled=!hasSat();
  });
  const h=$('mapStyleHint'); if(h) h.style.display=hasSat()?'none':'';
}
setBaseLayer('dark');
map.setView([48.4,31.2],6);
// Отступы вписывания с оглядкой на шторку.
//
// На телефоне карта лежит во весь экран, а шторка и нижняя навигация —
// НА ней: только так под ними есть что размывать, иначе стекло, о котором
// договорились для всего остального, здесь превращается в заливку.
// Плата за это — нижняя часть карты закрыта, и вписывать точки надо
// в ту часть, которую видно, иначе половина маршрута окажется под
// шторкой. Высоту меряем по факту: шторка бывает свёрнутой, и число
// в коде разошлось бы с ней в первый же раз.
function fitPad(p){
  p=p||40;
  const out={paddingTopLeft:[p,p],paddingBottomRight:[p,p]};
  const sd=document.querySelector('.view-map .side'), mw=document.querySelector('.view-map .map-wrap');
  if(!sd||!mw) return out;
  try{
    if(getComputedStyle(sd).position!=='absolute') return out;
    const r=sd.getBoundingClientRect(), m=mw.getBoundingClientRect();
    // Шторка сбоку (широкий экран) низ карты не занимает.
    if(r.width<m.width*0.9) return out;
    const hide=Math.round(m.bottom-r.top);
    if(hide>0&&hide<m.height-120) out.paddingBottomRight=[p,hide+p];
  }catch(e){}
  return out;
}
// То же самое по левому краю: на широком экране карта продолжается под
// рельсом (иначе ему нечего размывать), и эта полоса не видна.
function fitPadL(o){
  try{
    const mw=document.querySelector('.view-map .map-wrap'), vw=mw&&mw.parentElement;
    if(!mw||!vw) return o;
    const hide=Math.round(vw.getBoundingClientRect().left-mw.getBoundingClientRect().left);
    if(hide>0) o.paddingTopLeft=[o.paddingTopLeft[0]+hide,o.paddingTopLeft[1]];
  }catch(e){}
  return o;
}
function fitUkraine(){ map.fitBounds(UA_BOUNDS,fitPadL(fitPad(20))); }

// ---------- связь с точкой ----------
//
// Две вещи, которых инженеру не хватало на месте: позвонить и доехать.
// Обе решаются ссылками — набор номера и внешнюю навигацию берут на себя
// системные приложения, нам остаётся отдать им данные в правильном виде.
// Из номера выкидываем всё, кроме цифр и ведущего плюса: tel: со скобками
// и пробелами часть телефонов набирает неверно.
function telHref(phone){ const t=String(phone||'').trim(); if(!t) return '';
  const d=t.replace(/[^\d+]/g,'').replace(/(?!^)\+/g,'');
  return /\d/.test(d)?('tel:'+d):''; }
function navHref(lat,lng){ if(lat==null||lng==null||isNaN(+lat)||isNaN(+lng)) return '';
  return 'https://www.google.com/maps/dir/?api=1&destination='+(+lat).toFixed(6)+','+(+lng).toFixed(6)+'&travelmode=driving'; }
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
let vehLayer=L.layerGroup().addTo(map), vehShow=true, vehState=[], vehTrackSessions=[], vehActiveTrips={}, vehMk={}, vehTick=null, vehVisWired=false, vehModalId=null;
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
// Меню по правой кнопке — три пункта, и это все, ради которых по пустому
// месту карты вообще щёлкают: поставить здесь точку, довести сюда маршрут,
// забрать координаты. «Сделать стартом» ушло: старт меняется в самой
// карточке маршрута, где он и написан. Объезды ушли тоже — они больше
// не режим карты, а настройка построения (см. панель «Маршрут»).
function showCtxMenu(e){ ctxLatLng=e.latlng; const m=$('ctxMenu'); let h='';
  if(canWrite()){ h+='<button data-cx="add">Добавить точку здесь</button><button data-cx="wp">В маршрут</button>'; }
  h+='<button data-cx="copy">Копировать координаты</button>'; m.innerHTML=h;
  const x=e.originalEvent.clientX, y=e.originalEvent.clientY; m.style.left=Math.min(x,window.innerWidth-230)+'px'; m.style.top=Math.min(y,window.innerHeight-180)+'px'; m.classList.add('on');
  m.querySelectorAll('[data-cx]').forEach(b=>b.onclick=()=>{ ctxAction(b.dataset.cx); m.classList.remove('on'); }); }
function ctxAction(a){ if(!ctxLatLng) return; const ll=ctxLatLng;
  if(a==='add'){ if(addModeOn) toggleAdd(false); $('fName').value=''; $('fDesc').value=''; $('formErr').textContent=''; pendingLatLng={lat:ll.lat,lng:ll.lng}; flashPending(); openPointModal(); }
  else if(a==='wp'){ rStops.push({type:'wp',name:'точка '+(rStops.length+1),lat:ll.lat,lng:ll.lng}); showRouteTab(); renderRoutePanel(); resetBuilt(); }
  else if(a==='copy'){ const t=ll.lat.toFixed(6)+', '+ll.lng.toFixed(6); try{ navigator.clipboard.writeText(t); }catch(e){} showToast('Координаты: '+t); } }
map.on('contextmenu',e=>{ if(e.originalEvent) e.originalEvent.preventDefault(); showCtxMenu(e); });
map.on('click',()=>$('ctxMenu').classList.remove('on'));
document.addEventListener('click',e=>{ const m=$('ctxMenu'); if(m.classList.contains('on') && !m.contains(e.target)) m.classList.remove('on'); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ const m=$('ctxMenu'); if(m) m.classList.remove('on'); } });
function canWrite(){ return role==='admin'||role==='logist'; }
// Роль в списках и подписях — словом, а не идентификатором из базы:
// «Гречка Р.І. (engineer)» в шапке заявки читал инженер, которому это
// слово не говорит ничего.
const ROLE_RU={admin:'админ',logist:'логист',engineer:'инженер'};
function personLabel(p){
  if(!p) return '';
  const nm=p.full_name||'без имени';
  return nm+(ROLE_RU[p.role]?(' · '+ROLE_RU[p.role]):'');
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
document.querySelectorAll('.block.collapsible > h2.ch').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('collapsed'));

// ---------- панель карты: вкладки и перетаскивание ----------
//
// «Точки» и «Маршрут» были двумя сворачиваемыми блоками друг под другом.
// На телефоне это значило, что маршрут живёт ниже экрана: чтобы до него
// добраться, надо было сперва свернуть точки. Это не два раздела подряд,
// а два режима одной панели — значит вкладки.
function sideTab(name){
  document.querySelectorAll('#sideTabs button').forEach(b=>b.classList.toggle('on',b.dataset.sb===name));
  const p=$('pointsBlock'), r=$('routeBlock');
  if(p) p.classList.toggle('collapsed',name!=='points');
  if(r) r.classList.toggle('collapsed',name!=='route');
  // Шторка, свёрнутая в черту, по нажатию на вкладку обязана открыться:
  // иначе нажатие ничего не делает и выглядит сломанным.
  const sd=document.querySelector('.view-map .side');
  if(sd&&sd.classList.contains('sheet-collapsed')) sheetSnapTo(1);
}
document.querySelectorAll('#sideTabs button').forEach(b=>b.onclick=()=>sideTab(b.dataset.sb));
// Маршрут собирают кликами по карте — тогда панель обязана показать его
// сама. Раньше это делал `classList.remove('collapsed')` в семи местах;
// теперь у них одна дверь.
function showRouteTab(){
  if($('sideTabs')){ sideTab('route'); return; }
  const b=$('routeBlock'); if(b) b.classList.remove('collapsed');
}

// Шторка встаёт в одно из трёх положений: черта, половина, почти весь
// экран. Промежуточных нет намеренно — попасть пальцем в «примерно
// столько» нельзя, а три понятных состояния запоминаются.
//
// Доли, а не пиксели: экран у всех разный, а «половина» на любом экране
// половина.
const SHEET_SNAPS=[0, 0.52, 0.88];
let sheetSnap=1;
function sheetHost(){ return document.querySelector('.view-map .side'); }
function sheetIsSheet(){ const sd=sheetHost(); return !!sd&&window.innerWidth<=760; }
// Высота вкладки, а не окна: под шторкой ещё навигация. Пока вкладка
// скрыта (до входа), её высота ноль — тогда считаем от окна, иначе
// шторка родилась бы нулевой и открылась пустой полоской.
function sheetViewH(){
  const view=document.querySelector('.view-map');
  const h=view?view.getBoundingClientRect().height:0;
  return h>200?h:window.innerHeight;
}
function sheetSnapTo(i){
  const sd=sheetHost(); if(!sd) return;
  sheetSnap=Math.max(0,Math.min(SHEET_SNAPS.length-1,i));
  sd.classList.toggle('sheet-collapsed',sheetSnap===0);
  sd.style.setProperty('--sheet-snap',Math.round(sheetViewH()*SHEET_SNAPS[sheetSnap])+'px');
  // Карта сменила видимую высоту — Leaflet об этом надо сказать, иначе
  // центр уезжает и клики попадают мимо.
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} railHeight(); },220);
}
function wireSheetDrag(){
  const h=$('sideHandle'); if(!h) return;
  let y0=null, h0=0, moved=false, sd=null;
  h.addEventListener('pointerdown',e=>{
    sd=sheetHost(); if(!sd) return;
    if(!sheetIsSheet()){ return; }   // на широком экране шторку не тянут
    y0=e.clientY; h0=sd.getBoundingClientRect().height; moved=false;
    sd.classList.add('dragging');
    try{ h.setPointerCapture(e.pointerId); }catch(err){}
  });
  h.addEventListener('pointermove',e=>{
    if(y0==null||!sd) return;
    const dy=y0-e.clientY;
    // Свёрнутая шторка держит высоту классом, а не переменной, — иначе
    // её нельзя было бы вытянуть обратно: класс перебивал бы палец.
    if(Math.abs(dy)>4&&!moved){ moved=true; sd.classList.remove('sheet-collapsed'); }
    const max=sheetViewH()*0.92;
    sd.style.setProperty('--sheet-snap',Math.round(Math.max(27,Math.min(max,h0+dy)))+'px');
  });
  const end=()=>{
    if(y0==null||!sd) return;
    sd.classList.remove('dragging');
    const frac=sd.getBoundingClientRect().height/sheetViewH();
    if(!moved){
      // Просто нажатие — следующее положение по кругу. Свёрнутая
      // открывается, открытая сворачивается: одно и то же движение
      // и туда, и обратно.
      sheetSnapTo(sheetSnap===0?1:(sheetSnap===1?2:0));
    }else{
      let best=0, bd=1e9;
      SHEET_SNAPS.forEach((s,i)=>{ const d=Math.abs(s-frac); if(d<bd){ bd=d; best=i; } });
      sheetSnapTo(best);
    }
    y0=null; sd=null;
  };
  h.addEventListener('pointerup',end);
  h.addEventListener('pointercancel',end);
  // На широком экране шторку не тянут — карточка плавает и просто
  // складывается в черту.
  h.addEventListener('click',()=>{ if(sheetIsSheet()) return;
    const sd2=sheetHost(); if(!sd2) return;
    sd2.classList.toggle('sheet-collapsed');
    setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} },220); });
  h.addEventListener('keydown',e=>{ if(e.key!=='Enter'&&e.key!==' ') return; e.preventDefault();
    if(sheetIsSheet()) sheetSnapTo(sheetSnap===0?1:0); else h.click(); });
  window.addEventListener('resize',()=>{ if(sheetIsSheet()) sheetSnapTo(sheetSnap); });
  if(sheetIsSheet()) sheetSnapTo(1);
}
wireSheetDrag();
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
  applyMobileNav();
}

// ---------- нижнее меню на телефоне ----------
//
// Материал ограничивает нижнюю панель тремя-пятью РАЗДЕЛАМИ равной
// важности, и каждый её значок обязан вести в раздел, а не открывать меню
// или диалог. У нас там было шесть пунктов, из них «Вид» и «Выйти» —
// не разделы вовсе. Остальное уводим в шторку «Ещё».
//
// Что второстепенно, зависит от роли. С телефона не нужны каталог
// и настройки: их всё равно ведут с компьютера.
//
// «Выезды» здесь больше не упоминаются: они переехали внутрь «Диспетчера»
// и отдельным пунктом панели не бывают ни у кого.
function navKey(b){ return b.id?('#'+b.id):(b.dataset.tab+(b.dataset.sub?(':'+b.dataset.sub):'')); }
function secondaryNav(){
  const base=['#themeBtn','#cfgBtn','#logoutBtn'];
  return new Set(base.concat(['catalog','settings']));
}
function applyMobileNav(){
  const sec=secondaryNav();
  document.querySelectorAll('.rail .nav-i').forEach(b=>{
    if(b.id==='moreBtn') return;
    b.classList.toggle('nav-sec',sec.has(navKey(b)));
  });
  buildMoreSheet();
  railHeight();
}

// Высота нижней навигации — в --rail-h.
//
// На телефоне рельс лежит НА содержимом: только так под ним есть что
// размывать, и стекло, о котором договорились для шапок и модалок,
// работает и здесь. Плата за это — полоса, которую содержимое обязано
// уметь под собой прокрутить; её и раздаёт переменная.
//
// Меряем по факту, а не считаем: высота зависит от кегля, от того,
// сколько пунктов оставила роль, и от безопасной зоны телефона —
// любое зашитое число разойдётся с вёрсткой в первый же день.
// На широком экране рельс стоит слева, загораживать нечего — ноль.
function railHeight(){
  const rail=document.querySelector('.rail'); if(!rail) return;
  const over=getComputedStyle(rail).position==='absolute';
  const px=over?Math.round(rail.getBoundingClientRect().height):0;
  document.documentElement.style.setProperty('--rail-h',px+'px');
  // Высота пришвартованной снизу шторки карты — по той же причине.
  // Карта идёт под неё и под рельс, значит подпись об источнике карты
  // (её требует лицензия MapTiler и OSM) оказывалась ровно под ними и
  // не читалась. Поднимаем её ровно на то, что её закрывает.
  let sh=0;
  const sd=document.querySelector('.view-map .side'), mw=document.querySelector('.view-map .map-wrap');
  if(sd&&mw){
    const cs=getComputedStyle(sd), r=sd.getBoundingClientRect(), m=mw.getBoundingClientRect();
    // Только когда шторка действительно лежит понизу во всю ширину:
    // на широком экране она карточкой слева вверху и низ карты не занимает.
    if(cs.position==='absolute'&&r.width>m.width*0.9&&r.height>0) sh=Math.round(m.bottom-r.top);
  }
  document.documentElement.style.setProperty('--sheet-h',Math.max(0,sh-px)+'px');
}
if(typeof ResizeObserver!=='undefined'){
  const ro=new ResizeObserver(()=>railHeight());
  const startRailWatch=()=>{
    ['.rail','.view-map .side'].forEach(q=>{ const el=document.querySelector(q); if(el) ro.observe(el); });
    railHeight();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',startRailWatch);
  else startRailWatch();
}
window.addEventListener('resize',railHeight);

// ---------- сворачиваемые карточки заявки ----------
//
// На телефоне «Работы», «Запчасти» и «Фото» стоят одна под другой.
// Заполненная первая уводит две другие за нижний край экрана, и до
// фотографий инженер прокручивает половину страницы каждый раз.
// Свёрнутая карточка оставляет заголовок и число строк: видно, что
// там есть, разворачивать ради этого не нужно.
//
// Состояние живёт в памяти вкладки и НЕ пишется в базу: это положение
// рук, а не данные заявки. Между заявками оно сохраняется — свернувший
// «Фото» инженер не хочет сворачивать их снова в каждой следующей.
const folded=new Set();
function foldKey(card){ return card.dataset.fold||''; }
function foldSums(){
  document.querySelectorAll('.card.foldable').forEach(card=>{
    const out=card.querySelector('.foldsum'); if(!out) return;
    const box=$(foldKey(card));
    // Строк столько, сколько ЭЛЕМЕНТОВ в списке: текстовые заглушки
    // («Ничего не ставили») детьми не считаются — иначе пустая карточка
    // докладывала бы об одной позиции.
    const n=box?box.querySelectorAll(':scope > *').length:0;
    const w=(card.dataset.foldWord||'').split('|');
    out.textContent=n?(n+' '+(w.length===3?plural(n,w[0],w[1],w[2]):(w[0]||''))):'пусто';
  });
}
function foldApply(){
  document.querySelectorAll('.card.foldable').forEach(card=>{
    card.classList.toggle('folded',folded.has(foldKey(card)));
  });
  foldSums();
}
document.addEventListener('click',e=>{
  const h=e.target.closest('.card.foldable > h3'); if(!h) return;
  // Кружок «?» внутри заголовка — своё действие. Складывать карточку по
  // нажатию на пояснение значит прятать ответ вместе с вопросом.
  if(e.target.closest('.q')) return;
  // Переключатель периода живёт в том же заголовке. Клик по нему — выбор
  // периода, а не «сложить карточку»: иначе выбрать период невозможно.
  if(e.target.closest('.foldx-btn,.dgrip,.dmoves')) return;
  const card=h.parentElement, k=foldKey(card);
  if(folded.has(k)) folded.delete(k); else folded.add(k);
  foldApply();
});
// Строки шторки собираются ИЗ САМИХ пунктов рельса и кликают по ним же.
// Второй список тех же разделов рано или поздно разошёлся бы с первым.
function buildMoreSheet(){
  const box=$('moreList'); if(!box) return;
  box.innerHTML='';
  document.querySelectorAll('.rail .nav-i.nav-sec').forEach(b=>{
    if(b.classList.contains('hidden')||b.style.display==='none') return;
    const svg=b.querySelector('svg'), lab=b.querySelector('span');
    const r=document.createElement('button');
    r.type='button';
    r.className='sheet-row'+(b.id==='logoutBtn'?' danger':'');
    r.innerHTML=(svg?svg.outerHTML:'')+'<span>'+esc(lab?lab.textContent:'')+'</span>';
    // Клик по исходному пункту — СЛЕДУЮЩИМ тактом. Иначе он срабатывает
    // внутри обработки текущего касания, и то же самое касание, продолжая
    // всплывать до document, тут же закрывает открытое им окно: обработчик
    // «клик мимо» видит целью строку шторки, а не кнопку. Из-за этого «Вид»
    // на телефоне открывался и закрывался в одно нажатие — то есть
    // не работал вовсе.
    r.onclick=()=>{ closeMore(); setTimeout(()=>b.click(),0); };
    box.appendChild(r);
  });
  const w=$('sheetWho'), src=$('whoLabel');
  if(w) w.innerHTML=src?src.innerHTML:'';
}
function openMore(){ buildMoreSheet(); $('moreSheet').classList.add('on'); $('moreBack').classList.add('on'); }
function closeMore(){ $('moreSheet').classList.remove('on'); $('moreBack').classList.remove('on'); }
if($('moreBtn')) $('moreBtn').onclick=openMore;
if($('moreBack')) $('moreBack').onclick=closeMore;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeMore(); });
// В рельсе «График» и «Диспетчер» — разные пункты, но ведут в один и тот
// же view-planner. Поэтому у них есть data-sub, и подсветка идёт по паре
// (tab, sub), а не по одному tab.
//
// Внутри «Диспетчера» два подраздела, «Заявки» и «Выезды». В рельсе им
// соответствует ОДИН пункт data-sub="disp": navSub() и переводит состояние
// страницы в ключ пункта меню. Без этого перехода на «Выездах» не
// подсвечивалось бы ничего.
function navSub(s){ return (s==='jobs'||s==='trips'||s==='orders')?'disp':s; }
// URL живёт в hash, чтобы прямые ссылки работали и на GitHub Pages: серверу
// не приходится знать маршруты SPA. Пароль/сессия в ссылку не попадают.
let routeReady=false, routeApplying=false;
function routeUrl(path){ return location.pathname+location.search+'#/'+String(path||'dash').replace(/^\/+/, ''); }
function routeSet(path,replace){
  if(!routeReady||routeApplying) return;
  const hash='#/'+String(path||'dash').replace(/^\/+/,''), url=routeUrl(path);
  if(location.hash===hash) return;
  history[replace?'replaceState':'pushState'](null,'',url);
}
function routeForView(name,sub){
  if(name==='order'&&serviceOrders.currentId()) return 'order/'+encodeURIComponent(serviceOrders.currentId());
  if(name==='job'&&jobEditId) return 'job/'+encodeURIComponent(jobEditId);
  if(name==='trip'&&tripEditId) return 'trip/'+encodeURIComponent(tripEditId);
  if(name==='planner') return 'planner/'+(sub==='disp'?dispCur:(sub||plannerCur));
  return name;
}
async function routeTrip(id){
  let t=(trips||[]).find(x=>x.id==id)||tripCache[id]||null;
  if(t) return t;
  try{ const {data,error}=await sb.from('trips').select('*').eq('id',id).is('deleted_at',null).maybeSingle();
    if(error) throw error; if(data){ tripCache[id]=data; return data; } }
  catch(e){ loadFail('выезд по ссылке',e); }
  return null;
}
async function applyRoute(){
  if(!routeReady||routeApplying) return;
  routeApplying=true;
  try{
    const raw=location.hash.replace(/^#\/?/,'');
    const p=raw.split('/').filter(Boolean).map(x=>{ try{ return decodeURIComponent(x); }catch(e){ return x; } });
    if(!p.length){ const name=role==='engineer'?'planner':'dash', sub=role==='engineer'?'mine':null;
      switchTab(name,sub); history.replaceState(null,'',routeUrl(routeForView(name,sub))); return; }
    if(p[0]==='order'&&p[1]){await serviceOrders.open(p[1]);return;}
    if(p[0]==='job'&&p[1]){
      const j=await fetchJobFull(p[1]);
      if(!j){ notify('Заявка по ссылке не найдена.','warn'); switchTab('planner','jobs'); return; }
      if(!jobs.some(x=>x.id===j.id)) jobs.push(j);
      await openJob(p[1]); return;
    }
    if(p[0]==='trip'&&p[1]){
      const t=await routeTrip(p[1]);
      if(!t){ notify('Выезд по ссылке не найден.','warn'); switchTab('planner','trips'); return; }
      if(p[2]==='map') await showTripOnMap(p[1]); else await openTrip(p[1]);
      return;
    }
    if(p[0]==='planner'&&['mine','jobs','trips','orders'].includes(p[1])){ switchTab('planner',p[1]); return; }
    if(['dash','map','catalog','settings'].includes(p[0])){ switchTab(p[0]); return; }
    notify('Ссылка не распознана. Открыта сводка.','warn');
    const name=role==='engineer'?'planner':'dash', sub=role==='engineer'?'mine':null;
    switchTab(name,sub); history.replaceState(null,'',routeUrl(routeForView(name,sub)));
  } finally { routeApplying=false; }
}
window.addEventListener('popstate',applyRoute);
window.addEventListener('hashchange',applyRoute);
function switchTab(name, sub){ if(!tabAllowed(name)) return;
  if(name!=='order'&&serviceOrders.isDirty()&&!serviceOrders.leave())return;
  if(name!=='trip'&&document.querySelector('.view-trip.active')&&(tripPlanDirty||tripPresenceDirty)){if(!window.confirm('Выйти без сохранения изменений выезда?'))return;tripPlanDirty=false;tripPresenceDirty=false;}
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.nav-i[data-tab]').forEach(t=>{
    const hit = t.dataset.tab===name && (!t.dataset.sub || t.dataset.sub===navSub(sub||plannerCur));
    t.classList.toggle('active',hit);
  });
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelector('.view-'+name).classList.add('active');
  // У страницы выезда нет своего пункта в рельсе: она — вложенный экран
  // «Выездов», и подсветка должна остаться на них, иначе непонятно, где ты.
  if(name==='trip'||name==='job'||name==='order') document.querySelectorAll('.nav-i[data-sub="disp"]').forEach(t=>t.classList.add('active'));
  // Высота шторки считается от высоты вкладки, а вкладка получает высоту
  // только когда становится активной: пересчитываем при каждом заходе.
  if(name==='map'){ if(sheetIsSheet()) sheetSnapTo(sheetSnap); setTimeout(()=>map.invalidateSize(),60); }
  if(name==='catalog') catSub(catCur);
  // Клик по «Диспетчеру» возвращает в тот подраздел, где человек был
  // в прошлый раз: уводить его каждый раз на «Заявки» значило бы терять
  // место в работе на ровном месте.
  if(name==='planner') plannerSub(sub==='disp'?dispCur:(sub||plannerCur));
  if(name==='dash') renderDashboard(); if(name==='settings') renderSettings();
  routeSet(routeForView(name,sub)); }
document.querySelectorAll('.nav-i[data-tab]').forEach(el=>{
  el.onclick=()=>switchTab(el.dataset.tab, el.dataset.sub||null);
});
let catCur='works';
function catSub(name){ catCur=name; document.querySelectorAll('.view-catalog .subtab').forEach(t=>t.classList.toggle('active',t.dataset.csub===name)); $('catWorks').style.display=name==='works'?'':'none'; $('catModels').style.display=name==='models'?'':'none'; if(name==='works') renderCatalog(); else renderEqModels(); }
document.querySelectorAll('.view-catalog .subtab').forEach(t=>t.onclick=()=>catSub(t.dataset.csub));
let plannerCur='jobs';
let dispCur='jobs';        // последний открытый подраздел «Диспетчера»
function renderTripsView(){ renderTrips(); }
function plannerSub(name){ plannerCur=name;
  if(name==='jobs'||name==='trips'||name==='orders') dispCur=name;
  document.querySelectorAll('.nav-i[data-sub]').forEach(t=>
    t.classList.toggle('active', t.dataset.tab==='planner' && t.dataset.sub===navSub(name)));
  document.querySelectorAll('.view-planner .subtab').forEach(t=>t.classList.toggle('active',t.dataset.sub===name));
  if($('plMine')) $('plMine').style.display=name==='mine'?'':'none'; $('plJobs').style.display=name==='jobs'?'':'none'; $('plTrips').style.display=name==='trips'?'':'none'; $('plOrders').style.display=name==='orders'?'':'none'; if(name==='mine') renderMine(); else if(name==='jobs') renderJobs(); else if(name==='orders') serviceOrders.board(); else renderTripsView();
  routeSet('planner/'+name); }
// Поворот телефона и открытие на планшете меняют раскладку списков —
// перерисовываем, когда пересекли границу, а не на каждый пиксель.
try{
  const mqPhone=window.matchMedia('(max-width:760px)');
  const onPhoneChange=()=>{
    if(!document.querySelector('.view-planner.active')) return;
    if(plannerCur==='jobs') renderJobs();
    else if(plannerCur==='trips') renderTripsView();
    else if(plannerCur==='orders') serviceOrders.board();
  };
  if(mqPhone.addEventListener) mqPhone.addEventListener('change',onPhoneChange);
}catch(e){}
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
  // Навигация настроек липнет тем же классом .stickyhead — черта под ней
  // нужна по тому же правилу, и отдельного случая здесь больше нет.
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
try{ const saved=localStorage.getItem(LS_LOGIN_EMAIL)||'';
  if(saved){ $('auEmail').value=saved; $('auRemember').checked=true; } }catch(e){}
$('authForm').onsubmit=e=>{ e.preventDefault(); doAuth(); };
async function doAuth(){ const email=$('auEmail').value.trim(), password=$('auPass').value; if(!email||!password){ $('authErr').textContent='Введи email и пароль.'; return; } $('authErr').textContent='…';
  try{ const res=await sb.auth.signInWithPassword({email,password}); if(res.error) throw res.error;
    try{ if($('auRemember').checked) localStorage.setItem(LS_LOGIN_EMAIL,email);
      else localStorage.removeItem(LS_LOGIN_EMAIL); }catch(e){}
    await onSignedIn();
  }catch(err){ $('authErr').textContent='Ошибка: '+(err.message||err); } }
// Наш собственный выход не должен считаться потерей сессии.
let authLeaving=false;
// Выход — с подтверждением. В нижнем меню он стоял вплотную к разделам,
// и промах пальцем выбрасывал инженера из приложения посреди выезда;
// обратно он попадёт только через пароль, которого может не помнить.
$('logoutBtn').onclick=async ()=>{
  if(!await confirmDialog('Выйти из приложения? Чтобы вернуться, понадобится пароль.',{okText:'Выйти',danger:true})) return;
  authLeaving=true; await sb.auth.signOut(); location.reload(); };

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
  ['pointTools','pointToolsFab'].forEach(id=>{ const el=$(id); if(el) el.style.display=canWrite()?'':'none'; });
  $('routeBlock').style.display=canWrite()?'':'none';
  // Вкладка «Маршрут» уходит вместе со своим блоком: инженер маршруты
  // не собирает, и пустая вкладка была бы обещанием без содержимого.
  // Тогда у панели остаётся одна вкладка — заголовок вместо переключателя.
  { const rt=document.querySelector('#sideTabs [data-sb="route"]'), tb=$('sideTabs');
    if(rt) rt.style.display=canWrite()?'':'none';
    if(tb) tb.classList.toggle('solo',!canWrite());
    if(!canWrite()) sideTab('points'); }
  if($('jobAdd')) $('jobAdd').style.display=canWrite()?'':'none'; if($('jobTrash')) $('jobTrash').style.display=canWrite()?'':'none'; if($('jobEngFilter')) $('jobEngFilter').style.display=canWrite()?'':'none'; if($('tripAdd')) $('tripAdd').style.display=canWrite()?'':'none'; if($('tripTrash')) $('tripTrash').style.display=canWrite()?'':'none'; applyTabs(); if(role==='engineer'){ plannerCur='mine'; switchTab('planner'); }
  setTimeout(()=>{ map.invalidateSize(); fitUkraine(); },80);
  await loadAll(); await loadPlaces(); await loadVehicles(); await loadEqModels();
  await loadVehState(); subscribeVeh(); await loadFactHours(); await loadRescheds();
  // Очередь: показать, сколько лежит, и сразу попробовать отправить —
  // приложение чаще всего открывают уже вернувшись в зону связи.
  await qRefresh(); qFlush();
  checkTodayTrip(); initPush();
  // Сначала поднимаем все формы, справочники и права, и только потом
  // открываем deep link: /trip/:id без этого выглядел бы пустым выездом.
  routeReady=true; await applyRoute(); }

// ---------- data load ----------
async function loadAll(){ $('dataStatus').textContent='Загрузка…';
  const [cRes,eRes]=await Promise.all([ sb.from('clients').select('*').is('deleted_at',null).order('created_at'), sb.from('equipment').select('*').is('deleted_at',null).order('created_at') ]);
  if(cRes.error){
    // Справочник точек нужен всему: без него не подписать заявку и не
    // построить карту. Без связи поднимаем последний снимок — так экран
    // заявки остаётся рабочим, а не пустым.
    const s=await snapGet('refs');
    if(isNetErr(cRes.error) && s && s.val && s.val.clients){
      clients=s.val.clients; eqByClient=s.val.eqByClient||{};
      $('dataStatus').innerHTML='<span class="err">Нет связи · '+esc(snapAge(s.at))+'</span>';
      render(); return;
    }
    $('dataStatus').innerHTML='<span class="err">'+esc(cRes.error.message)+'</span>'; return; }
  clients=cRes.data||[]; eqByClient={}; (eRes.data||[]).forEach(e=>{ (eqByClient[e.client_id]=eqByClient[e.client_id]||[]).push(e); });
  snapSet('refs',{clients,eqByClient});
  $('dataStatus').innerHTML='<span class="ok">На карте: '+clients.length+'</span>';
  await loadReadings(); await loadClientStats();
  render(); if(clients.length) map.fitBounds(clients.map(c=>[c.lat,c.lng]),fitPadL(fitPad(40))); else fitUkraine(); }
async function refreshStats(){ if(!canWrite()) return; await loadClientStats(); renderMarkers(); }
async function loadClientStats(){ clientStats={}; if(!canWrite()) return;
  // due_date и created_at добавлены к тому же запросу: по ним считается
  // срочность клиента для раскраски точек на карте. Отдельного похода
  // в базу это не стоит, а карта из справочника координат превращается
  // в картину дня.
  try{ const {data,error}=await sb.from('jobs').select('id,client_id,status,due_date,created_at,clients(name),equipment(model),job_works(hours,billable,revenue,tariff_profile), job_parts(qty,price,cost,billable)').is('deleted_at',null);
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
      (j.job_works||[]).forEach(w=>{ const h=+w.hours||0; s.hours+=h; s.cost+=h*ch; if(w.billable===false) s.warrH+=h; s.rev+=(+w.revenue||0); });   // выручка и с гарантийных: тариф свой, но счёт есть всегда
      // Запчасти — такая же выручка и такая же себестоимость, как труд.
      // Без них клиент, которому продали узел на десять тысяч, выглядел
      // бы в статистике дешевле, чем он есть.
      const pm=partsMoney(j); s.rev+=pm.rev; s.cost+=pm.cost; });
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
document.querySelectorAll('#mapStyleSeg button[data-mstyle]').forEach(b=>b.onclick=()=>setMapStyle(b.dataset.mstyle));
syncMapStyleSeg();
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
      if(c.phone) html+='<br><span style="color:var(--ink-dim)">тел. '+esc(c.phone)+'</span>';
      html+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3);flex-wrap:wrap">'
        +(telHref(c.phone)?('<a href="'+esc(telHref(c.phone))+'" style="'+ab+';text-decoration:none">Позвонить</a>'):'')
        +'<a href="'+esc(navHref(c.lat,c.lng))+'" target="_blank" rel="noopener" style="'+lb+';text-decoration:none">Проехать</a></span>';
      // Депо добавляется в маршрут той же кнопкой, что и всё остальное.
      // Двух — «старт» и «финиш» — не нужно: и то и другое это точка
      // в списке маршрута, а её место в нём меняется перетаскиванием.
      if(canWrite()){ html+='<br><span style="display:inline-flex;gap: var(--gap-row);margin-top: var(--gap-row)"><button onclick="addBaseStop(\''+c.id+'\')" style="'+ab+'">в маршрут</button><button onclick="editClient(\''+c.id+'\')" style="'+lb+'">ред.</button></span>'; }
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
    if(c.phone) html+='<br><span style="color:var(--ink-dim)">тел. '+esc(c.phone)+'</span>';
    // «Позвонить» и «Проехать» — первыми и всем, включая инженера: на месте
    // это единственные две кнопки, которые вообще нужны.
    const tel=telHref(c.phone);
    html+='<br><span style="display:inline-flex;gap: var(--sp-3);margin-top: var(--sp-3);flex-wrap:wrap">';
    if(tel) html+='<a href="'+esc(tel)+'" style="'+ab+';text-decoration:none">Позвонить</a>';
    html+='<a href="'+esc(navHref(c.lat,c.lng))+'" target="_blank" rel="noopener" style="'+lb+';text-decoration:none">Проехать</a>';
    html+='<button onclick="openEquip(\''+c.id+'\')" style="'+lb+'">техника</button>';
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
// Свернуть список — не то же самое, что свернуть панель. Шторкой прячут
// всё сразу; здесь остаются поиск и фильтры, а список уходит — и под
// панелью открывается карта, по которой в этот момент и работают.
if($('listHead')) $('listHead').onclick=()=>{
  const h=$('listHead'), b=$('pointsBox');
  const folded=!h.classList.contains('folded');
  h.classList.toggle('folded',folded); b.classList.toggle('folded',folded);
  $('listHeadT').textContent=folded?'показать список':'свернуть список';
  // На телефоне высота шторки задана положением, а не содержимым: без
  // этого свёрнутый список оставлял бы под собой пустую половину экрана
  // вместо карты, ради которой его и свернули.
  const sd=sheetHost(); if(sd) sd.classList.toggle('list-folded',folded);
  // Панель стала ниже — карте об этом надо сказать, иначе её центр
  // и попадания кликов разъезжаются.
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} railHeight(); },220);
};
function renderSide(){
  const work=(mapScope==='work');
  // Поиск и фильтры нужны обоим режимам: в «работе» их прятали, потому что
  // лента и так короткая, но искать по ней приходится ровно так же.
  const t=$('sideTools'); if(t) t.style.display='';
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

const depotOpen=new Set();
function depotCars(id){
  return (vehState||[]).filter(r=>String(r.current_depot_id||'')===String(id)&&['inside','outside_candidate'].includes(r.depot_state));
}
function depotCarMeta(r){
  if(r.depot_state==='outside_candidate'){
    const mins=Math.max(0,Math.floor((Date.now()-new Date(r.depot_outside_since||r.ts))/60000));
    return 'вне зоны '+mins+' мин';
  }
  return vehClass(r)==='idle'?'стоит':'в депо';
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
    const dcars=c.is_base?depotCars(c.id):[];
    const inside=c.is_base?dcars.filter(r=>r.depot_state==='inside').length:0;
    const leaving=c.is_base?dcars.filter(r=>r.depot_state==='outside_candidate').length:0;
    meta.push(c.is_base?('депо · '+inside+' '+plural(inside,'машина','машины','машин')+(leaving?(' · '+leaving+' покидает зону'):'')):(eqn?(eqn+' '+plural(eqn,'единица','единицы','единиц')+' техники'):'без техники'));
    if(aln>0) meta.push(aln+' '+plural(aln,'заявка','заявки','заявок'));
    // Описание шло отдельной строкой и добавляло карточке третий этаж —
    // высоты разъезжались, и ровные промежутки читались как рваные.
    // Уходит в ту же строку меты, в одну строку с многоточием.
    if(c.description) meta.push(String(c.description).replace(/\s+/g,' ').trim());
    // Действия показываются только у выбранной точки: четыре кнопки под
    // каждой из восьмидесяти строк — это и есть та самая «духота».
    // Цвет точки несёт левая кромка карточки, а не кружок внутри неё.
    // Кружок стоял в строке имени и отбирал у него место — при том что
    // цвет и так виден на карте; кромка отвечает на «что это за точка»
    // до чтения, и карточка становится ровно такой же, как строки ленты
    // «в работе», где кромка была всегда.
    d.style.borderLeftColor=c.color||'var(--line)';
    const depotRows=c.is_base&&depotOpen.has(String(c.id))
      ? '<div class="depot-cars">'+(dcars.length?dcars.map(r=>{ const v=vehicles.find(x=>x.id===r.vehicle_id)||{};
          return '<button class="depot-car" type="button" data-depot-vehicle="'+r.vehicle_id+'"><i class="depot-state-dot'+(r.depot_state==='outside_candidate'?' leaving':'')+'"></i><span>'+esc(v.name||'Машина')+(v.plate?(' · '+esc(v.plate)):'')+'</span><small>'+esc(depotCarMeta(r))+'</small></button>'; }).join(''):'<div class="hint">Сейчас машин нет.</div>')+'</div>' : '';
    if(c.is_base&&depotOpen.has(String(c.id))) d.classList.add('depot-open');
    d.innerHTML='<div class="nm'+(c.is_base?' depot-head':'')+'" title="'+tip+'"><span class="nm-t">'+esc(c.name)+'</span>'+(c.is_base?'<button class="depot-toggle" type="button" data-depot-toggle="'+c.id+'" aria-label="Показать машины" aria-expanded="'+(depotOpen.has(String(c.id))?'true':'false')+'">⌄</button>':'')+'</div>'+
      '<div class="meta">'+esc(meta.join(' · '))+'</div>'+
      depotRows+
      '<div class="acts">'+(canWrite()?'<button class="btn sm amber" data-rt="'+c.id+'">+ маршрут</button>':'')+(c.is_base?'':'<button class="btn sm" data-eq="'+c.id+'">техника</button>')+
      (canWrite()?'<button class="btn sm ghost" data-edit="'+c.id+'">ред.</button><button class="btn sm ghost" data-del="'+c.id+'" title="Удалить точку">×</button>':'')+'</div>';
    // Клик по карточке = выбрать её и показать на карте. Раньше «показать»
    // висело на самом имени и требовало отдельного объяснения подсказкой.
    d.onclick=(e)=>{ const toggle=e.target.closest('[data-depot-toggle]');
      if(toggle){ const id=String(toggle.dataset.depotToggle); if(depotOpen.has(id)) depotOpen.delete(id); else depotOpen.add(id); renderList(); return; }
      const car=e.target.closest('[data-depot-vehicle]');
      if(car){ const r=vehState.find(x=>x.vehicle_id===car.dataset.depotVehicle); if(r){ map.flyTo([r.lat,r.lng],14); showVehModal(r.vehicle_id); } return; }
      if(e.target.closest('button')) return;
      if(c.is_base){ const id=String(c.id); if(depotOpen.has(id)) depotOpen.delete(id); else depotOpen.add(id); renderList(); return; }
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
// Создание точки живёт в двух местах разом: кнопкой в панели на широком
// экране и кругом над картой на телефоне. Действие одно, поэтому и
// обработчик один — по классу, а не по идентификатору.
document.querySelectorAll('.js-point-create').forEach(b=>b.onclick=()=>{ resetForm(); openPointModal(); });
function toggleAdd(on){ addModeOn=on; $('addMode').classList.toggle('active',on); $('modeTag').classList.toggle('on',on); $('addHint').style.display=on?'block':'none'; map.getContainer().style.cursor=on?'crosshair':''; }
// Кружок на карте только показывает объезд. Правят его в панели «Маршрут»:
// три кнопки в каждой всплывашке — это тот же орган в двух местах, и они
// неизбежно разъедутся.
function renderAvoidZones(){ if(!avoidLayer) return; avoidLayer.clearLayers(); (appSettings.avoid_zones||[]).forEach((z,i)=>{ const circ=L.circle([z.lat,z.lng],{radius:z.r||150,color:'#ef4444',fillColor:'#ef4444',fillOpacity:.12,weight:2,dashArray:'5 5'}); circ.bindPopup('<strong>Объезд '+(i+1)+'</strong> <span style="color:var(--ink-dim)">· '+(z.r||150)+' м</span><br><span style="color:var(--ink-faint);font-size:12px">радиус меняется в панели «Маршрут»</span>'); avoidLayer.addLayer(circ); }); }
async function saveAvoidZones(){ try{ const {error}=await sb.from('settings').update({avoid_zones:appSettings.avoid_zones||[]}).eq('id',true); if(error) notify('Не удалось сохранить объезды: '+error.message,'err'); }catch(e){ notify('Не удалось сохранить объезды','err'); } }
function addAvoidZone(ll){ if(!canWrite()) return; appSettings.avoid_zones=appSettings.avoid_zones||[]; appSettings.avoid_zones.push({id:'az'+Date.now().toString(36),lat:ll.lat,lng:ll.lng,r:150}); saveAvoidZones(); renderAvoidZones(); renderAvoidList(); toggleAvoid(false); if(avoidAreaKm2()>180) notify('Объездов много (суммарно ~'+avoidAreaKm2().toFixed(0)+' км²). Сервер ORS может отклонить запрос — уменьши радиусы.','warn'); else showToast('Объезд добавлен'); }
function avoidRadius(id,delta){ if(!canWrite()) return; const z=(appSettings.avoid_zones||[]).find(x=>x.id===id); if(!z) return; z.r=Math.max(50,Math.min(3000,(z.r||150)+delta)); saveAvoidZones(); renderAvoidZones(); renderAvoidList(); }
function avoidDel(id){ if(!canWrite()) return; appSettings.avoid_zones=(appSettings.avoid_zones||[]).filter(x=>x.id!==id); saveAvoidZones(); renderAvoidZones(); renderAvoidList(); map.closePopup(); }
function avoidPolygons(){ const zs=appSettings.avoid_zones||[]; if(!zs.length||typeof turf==='undefined') return null; const coords=[]; zs.forEach(z=>{ try{ const c=turf.circle([z.lng,z.lat],(z.r||150)/1000,{units:'kilometers',steps:20}); if(c&&c.geometry) coords.push(c.geometry.coordinates); }catch(e){} }); return coords.length?{type:'MultiPolygon',coordinates:coords}:null; }
// Постановка объезда — ОДИНОЧНОЕ действие, а не режим.
//
// Раньше это был флажок: включил — и каждый клик по карте ставил «кирпич»,
// пока не вспомнишь выключить. Забытый режим ставил их пачками, а каждый
// лишний объезд удорожает расчёт у ORS (полигоны уходят в запрос) и может
// вовсе завалить его по площади. Теперь: нажал «отметить», ткнул в одно
// место — режим сам погас.
function toggleAvoid(on){
  avoidModeOn=on;
  const h=$('avoidHint'); if(h) h.style.display=on?'block':'none';
  const b=$('avoidAdd'); if(b){ b.classList.toggle('active',on); b.textContent=on?'Отмена':'+ Отметить на карте'; }
  if(on&&addModeOn) toggleAdd(false);
  if(on&&wpModeOn){ wpModeOn=false; const w=$('rWpMode'); if(w) w.classList.remove('active'); }
  map.getContainer().style.cursor=on?'crosshair':'';
}
if($('avoidAdd')) $('avoidAdd').onclick=()=>toggleAvoid(!avoidModeOn);

// Список объездов в панели. Радиус меняется здесь же, а не во всплывашке
// на карте: чтобы попасть в неё, надо сперва найти кружок глазами.
function renderAvoidList(){
  const box=$('avoidList'); const n=(appSettings.avoid_zones||[]).length;
  const cnt=$('avoidN'); if(cnt) cnt.textContent=n?String(n):'';
  const chip=$('chipAvoid'); if(chip) chip.classList.toggle('has',n>0);
  if(!box) return;
  if(!n){ box.innerHTML='<div class="hint" style="margin:0">Объездов нет. Маршрут пойдёт как проложит роутер.</div>'; return; }
  box.innerHTML=(appSettings.avoid_zones||[]).map((z,i)=>
    '<div class="avrow" data-az="'+esc(z.id)+'">'
    +'<span class="nm">Объезд '+(i+1)+'</span>'
    +'<span class="r">'+(z.r||150)+' м</span>'
    +'<span class="avstep"><button type="button" data-azr="'+esc(z.id)+'" data-d="-50">−</button>'
    +'<button type="button" data-azr="'+esc(z.id)+'" data-d="50">+</button></span>'
    +'<button type="button" class="avx" data-azd="'+esc(z.id)+'" title="Убрать">×</button></div>').join('');
  const area=avoidAreaKm2();
  if(area>180) box.innerHTML+='<div class="err">Суммарная площадь ~'+area.toFixed(0)+' км². Сервер маршрутов может отклонить запрос — уменьши радиусы.</div>';
  box.querySelectorAll('[data-azr]').forEach(b=>b.onclick=()=>avoidRadius(b.dataset.azr,+b.dataset.d));
  box.querySelectorAll('[data-azd]').forEach(b=>b.onclick=()=>avoidDel(b.dataset.azd));
  // Нажатие по строке — показать этот объезд на карте: иначе среди
  // десятка кружков не понять, какой из них правишь.
  box.querySelectorAll('[data-az]').forEach(r=>r.onclick=e=>{
    if(e.target.closest('button')) return;
    const z=(appSettings.avoid_zones||[]).find(x=>x.id===r.dataset.az); if(!z) return;
    map.setView([z.lat,z.lng],Math.max(map.getZoom(),14));
  });
}
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
  $('saveBtn').disabled=true; const { error }=await sb.from('clients').insert({name,description:$('fDesc').value.trim(),phone:($('fPhone').value.trim()||null),color:$('fColor').value,lat:pendingLatLng.lat,lng:pendingLatLng.lng,is_base:$('fBase').checked}); $('saveBtn').disabled=false;
  if(error){ $('formErr').textContent='Ошибка: '+error.message; return; } const wasBase=$('fBase').checked; resetForm(); $('pointOverlay').classList.remove('on'); await loadAll(); showToast(wasBase?'Депо сохранено':'Точка сохранена'); };
window.editClient=function(id){ const c=clients.find(x=>x.id==id); if(!c||!canWrite()) return; editId=id; map.closePopup();
  $('eName').value=c.name; $('eDesc').value=c.description||''; $('ePhone').value=c.phone||''; $('eColor').value=c.color||'#9aa1ad'; $('eBase').checked=!!c.is_base; $('eLat').value=c.lat; $('eLng').value=c.lng; $('eProfile').innerHTML='<option value="">— не задан (по умолчанию платный) —</option>'+(appSettings.tariff_profiles||[]).map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join(''); $('eProfile').value=c.default_profile||''; $('eSigner').value=c.signer||''; $('editOverlay').classList.add('on'); };
$('eCancel').onclick=()=>$('editOverlay').classList.remove('on');
$('eSave').onclick=async ()=>{ const { error }=await sb.from('clients').update({name:$('eName').value.trim(),description:$('eDesc').value.trim(),phone:($('ePhone').value.trim()||null),color:$('eColor').value,is_base:$('eBase').checked,default_profile:($('eProfile').value||null),signer:($('eSigner').value.trim()||null),lat:parseFloat($('eLat').value),lng:parseFloat($('eLng').value)}).eq('id',editId);
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
function engineerIds(row,legacyField){
  const ids=Array.isArray(row&&row.engineer_ids)?row.engineer_ids.filter(Boolean):[];
  const legacy=row&&row[legacyField];
  if(legacy&&!ids.includes(legacy)) ids.unshift(legacy);
  return [...new Set(ids)];
}
const jobEngineerIds=j=>engineerIds(j,'assigned_engineer');
const tripEngineerIds=t=>engineerIds(t,'lead_engineer');
const assignedTo=(row,id,legacyField)=>!!id&&engineerIds(row,legacyField).includes(id);
function selectedEngineerIds(id){ const el=$(id); return el?[...el.selectedOptions].map(o=>o.value).filter(Boolean):[]; }
function setEngineerSelect(id,ids){ const chosen=new Set(ids||[]); const el=$(id); if(el) { [...el.options].forEach(o=>{ o.selected=chosen.has(o.value); }); el.dispatchEvent(new window.Event('crew-sync',{bubbles:true})); } }
function engineerNames(ids){ return (ids||[]).map(id=>profilesList.find(p=>p.id===id)).filter(Boolean).map(p=>p.full_name||'инженер'); }
const ST={open:'открыта',planned:'запланирована',in_progress:'в работе',done:'закрыта',cancelled:'отменена'};
const JOB_STATUS_ORDER=['open','planned','in_progress','done','cancelled'];
let jobVisible={open:true,planned:true,in_progress:true,done:false,cancelled:false};
// ---------- канбан против списка ----------
//
// Доска работает потому, что колонки видны ОДНОВРЕМЕННО: взгляд сравнивает
// высоту стопок и переносит карточку между ними. На телефоне колонки
// складываются в столбик — сравнивать нечего, а цена доски остаётся:
// заголовки, счётчики и пустая колонка на пол-экрана («Назначен · 0 —
// назначенных нет»). Поэтому на узком экране показываем ОДИН список,
// отсортированный по сроку: ближайшее сверху.
//
// Счётчики при этом переезжают внутрь чипов — без заголовков колонок это
// единственное место, где видно, сколько чего.
function isPhone(){ try{ return window.matchMedia('(max-width:760px)').matches; }catch(e){ return false; } }
function chipCounts(box,attr,pool){
  if(!box) return;
  const cnt={}; pool.forEach(x=>{ cnt[x.status]=(cnt[x.status]||0)+1; });
  box.querySelectorAll('[data-'+attr+']').forEach(c=>{
    const k=c.dataset[attr];
    let b=c.querySelector('.chip-n');
    if(!b){ b=document.createElement('b'); b.className='chip-n'; c.appendChild(b); }
    b.textContent=cnt[k]||0; });
}
// Сортировка по сроку, а не по статусу: у списка нет колонок, и порядок —
// единственное, что осталось от приоритета. Без срока — в конец.
function flatList(pool,visible,dateOf,card,empty){
  const key=x=>dateOf(x)||'9999-99-99';
  const arr=pool.filter(x=>visible[x.status]).sort((a,b)=>key(a)<key(b)?-1:(key(a)>key(b)?1:0));
  return arr.length?arr.map(card).join(''):'<div class="hint">'+esc(empty)+'</div>';
}
function renderJobChips(){ const box=$('jobStatusChips'); if(!box) return; box.innerHTML=JOB_STATUS_ORDER.map(s=>'<span class="chip'+(jobVisible[s]?' on':'')+'" data-js="'+s+'">'+esc(ST[s])+'</span>').join('');
  box.querySelectorAll('[data-js]').forEach(c=>c.onclick=()=>{ jobVisible[c.dataset.js]=!jobVisible[c.dataset.js]; renderJobChips(); renderJobs(); }); }
function jobCard(j){ const w=j.job_works||[]; const hours=w.reduce((a,x)=>a+(+x.hours||0),0);
  const pm=partsMoney(j);
  const rev=w.reduce((a,x)=>a+(+x.revenue||0),0)+pm.rev;   // и платные, и гарантийные, и запчасти
  const warr=w.some(x=>!x.billable), paid=w.some(x=>x.billable); const engs=engineerNames(jobEngineerIds(j));
  const head='<h4>'+esc(j.clients?j.clients.name:'—')+'</h4>'+(j.equipment?'<div class="meta">'+esc(j.equipment.model||'')+'</div>':'');
  const tags=(warr?'<span class="pill warn">гар.</span>':'')+(paid?'<span class="pill good">платно</span>':'');
  // Срок пишем так, как его читают: «до 11 сентября · 14 дн», а не
  // «SLA 2026-09-11». Остаток дней важнее самой даты — по нему принимают
  // решение, и он же красится по остроте.
  let dueTxt='';
  if(j.due_date){
    const u=jobUrgency({due_date:j.due_date,created_at:j.created_at||null},new Date());
    dueTxt='<span style="color:'+urgHue(u)+'">до '+esc(tripPeriod(j.due_date,null))
      +(u.left<0?(' · просрочено '+(-u.left)+' дн'):(' · '+u.left+' дн'))+'</span> · ';
  }
  // Выручку показываем только тем, кто ею распоряжается. Инженеру в поле
  // это не данные для решения, а лишняя строка в карточке.
  const revTxt=(rev&&canWrite())?(' · выручка '+rev):'';
  const meta='<div class="meta">'+(j.scheduled_date?'визит '+esc(tripPeriod(j.scheduled_date,null))+' · ':'')+dueTxt+w.length+' раб · '+hours.toFixed(1)+' ч'+revTxt+(engs.length?' · '+esc(engs.join(', ')):'')+'</div>';
  const mv=canWrite()?('<select class="kmove" data-jstat="'+j.id+'" title="Сменить статус">'+JOB_STATUS_ORDER.map(s=>'<option value="'+s+'"'+(s===j.status?' selected':'')+'>'+esc(ST[s])+'</option>').join('')+'</select>'):'';
  const eb=(assignedTo(j,session.user.id,'assigned_engineer')&&(j.status==='open'||j.status==='planned'))?'<button class="btn sm amber" data-jst="'+j.id+'|in_progress">В работу</button>':'';
  const eb2=(assignedTo(j,session.user.id,'assigned_engineer')&&j.status==='in_progress')?'<button class="btn sm amber" data-jst="'+j.id+'|done">Завершить</button>':'';
  const acts='<div class="acts">'+mv+eb+eb2+'<button class="btn sm" data-jedit="'+j.id+'">открыть</button>'+(canWrite()?'<button class="btn sm ghost" data-jdel="'+j.id+'" title="Удалить заявку">×</button>':'')+'</div>';
  return '<div class="kcard" data-kid="'+j.id+'">'+head+(tags?'<div class="ktags">'+tags+'</div>':'')+meta+acts+'</div>'; }
function wireJobCards(box){
  box.querySelectorAll('[data-jedit]').forEach(b=>b.onclick=()=>openJob(b.dataset.jedit));
  box.querySelectorAll('[data-jst]').forEach(b=>b.onclick=()=>{ const a=b.dataset.jst.split('|'); jobSetStatus(a[0],a[1]); });
  box.querySelectorAll('[data-jdel]').forEach(b=>b.onclick=()=>delJob(b.dataset.jdel));
  box.querySelectorAll('[data-jstat]').forEach(sel=>sel.onchange=()=>jobSetStatus(sel.dataset.jstat, sel.value)); }
async function renderJobs(){ await ensureRefs(); renderJobChips();
  const { data, error }=await sb.from('jobs').select('*, clients(name), equipment(model,kind), job_works(*), job_parts(qty,price,cost,billable)').is('deleted_at',null).order('created_at',{ascending:false});
  const box=$('jobList'); if(error){ box.className=''; box.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
  jobs=data||[]; const q=$('jobSearch').value.trim().toLowerCase();
  if($('jobEngFilter') && $('jobEngFilter').dataset.filled!=='1'){ $('jobEngFilter').innerHTML='<option value="">все инженеры</option>'+profilesList.filter(p=>p.role==='engineer').map(p=>'<option value="'+p.id+'">'+esc(p.full_name||'инженер')+'</option>').join(''); $('jobEngFilter').dataset.filled='1'; }
  const ef=$('jobEngFilter')?$('jobEngFilter').value:'';
  const baseJobs=(role==='engineer')?jobs.filter(j=>assignedTo(j,session.user.id,'assigned_engineer')):jobs;
  const match=j=>(!ef||assignedTo(j,ef,'assigned_engineer'))&&(!q||((j.clients&&j.clients.name)||'').toLowerCase().includes(q));
  const cols=JOB_STATUS_ORDER.filter(s=>jobVisible[s]);
  if(!cols.length){ box.className=''; box.innerHTML='<div class="hint">Выберите хотя бы один статус выше.</div>'; return; }
  const pool=baseJobs.filter(match);
  if(!pool.length){ box.className=''; box.innerHTML='<div class="hint">Заявок нет. Создай первую.</div>'; return; }
  chipCounts($('jobStatusChips'),'js',pool);
  if(isPhone()){ box.className='klist'; box.innerHTML=flatList(pool,jobVisible,j=>j.due_date,jobCard,'По выбранным статусам заявок нет.'); wireJobCards(box); await serviceOrders.attachJobs(box); return; }
  box.className='kanban';
  box.innerHTML=cols.map(s=>{ const items=pool.filter(j=>j.status===s);
    // Тире — это не пустое состояние, это отсутствие ответа. Строка о том,
    // что здесь появится, полезнее: она объясняет колонку, а не молчит.
    const EMPTY={open:'Новые заявки появятся здесь',planned:'Ничего не запланировано',
      in_progress:'Никто не в работе',done:'Закрытых пока нет',cancelled:'Отменённых нет'};
    const cards=items.map(j=>jobCard(j)).join('')
      ||'<div class="kempty">'+esc(EMPTY[s]||'Пусто')+'</div>';
    return '<div class="kcol" data-kst="'+s+'"><div class="kcol-h"><span>'+esc(ST[s])+'</span><span class="cnt">'+items.length+'</span></div><div class="kcol-b">'+cards+'</div></div>'; }).join('');
  wireJobCards(box); wireKanbanDrag(box,dropJob); await serviceOrders.attachJobs(box); }
$('jobSearch').oninput=renderJobs; if($('jobEngFilter')) $('jobEngFilter').onchange=renderJobs; if($('mineDone')) $('mineDone').onchange=renderMine; $('jobAdd').onclick=()=>{ if(canWrite()) openJob(null); };

// ── Корзина заявок и выездов ───────────────────────────────────────────
// Обычное удаление остаётся мягким: запись сразу исчезает из рабочих
// экранов, но семь дней доступна здесь. Окончательное удаление идёт через
// SECURITY DEFINER RPC, чтобы каскад и проверка роли были едиными для UI и
// автоматической серверной очистки.
let trashKind='jobs';
function trashLabel(row){
  if(trashKind==='jobs') return (row.clients&&row.clients.name)||'Заявка без клиента';
  const pts=(row.route_stops||[]).filter(s=>s&&s.name&&!['start','place','wp'].includes(s.type));
  return pts.length?pts.map(s=>String(s.name).split(' · ')[0]).slice(0,2).join(', '):tripPeriod(row.date_from,row.date_to);
}
function trashMeta(row){
  const left=trashDaysLeft(row.deleted_at), deleted=new Date(row.deleted_at);
  const when=isNaN(deleted)?'':deleted.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
  const ttl=left===0?'будет удалено при ближайшей очистке':('осталось '+left+' '+plural(left,'день','дня','дней'));
  if(trashKind==='jobs') return [row.equipment&&row.equipment.model,when,ttl].filter(Boolean).join(' · ');
  return [tripPeriod(row.date_from,row.date_to),row.vehicle_label,when,ttl].filter(Boolean).join(' · ');
}
async function renderTrash(){
  const box=$('trashList'), err=$('trashErr'); if(!box) return;
  err.textContent=''; box.innerHTML='<div class="hint">Загружаю…</div>';
  $('trashTitle').textContent=trashKind==='jobs'?'Корзина заявок':'Корзина выездов';
  $('trashTabs').querySelectorAll('[data-trash-kind]').forEach(b=>b.classList.toggle('on',b.dataset.trashKind===trashKind));
  let q=trashKind==='jobs'
    ? sb.from('jobs').select('id,deleted_at,status,clients(name),equipment(model)').not('deleted_at','is',null)
    : sb.from('trips').select('id,deleted_at,date_from,date_to,vehicle_label,route_stops').not('deleted_at','is',null);
  const {data,error}=await q.order('deleted_at',{ascending:false});
  if(error){ box.innerHTML=''; err.textContent=error.message; return; }
  const rows=data||[];
  box.innerHTML=rows.length?rows.map(r=>'<div class="trash-row"><div><div class="trash-name">'+esc(trashLabel(r))+'</div><div class="trash-meta">'+esc(trashMeta(r))+'</div></div><div class="trash-actions"><button class="btn sm" data-trash-restore="'+r.id+'">Восстановить</button><button class="btn sm red" data-trash-purge="'+r.id+'">Удалить навсегда</button></div></div>').join('')
    : '<div class="hint">Корзина пуста.</div>';
  box.querySelectorAll('[data-trash-restore]').forEach(b=>b.onclick=()=>restoreTrash(b.dataset.trashRestore));
  box.querySelectorAll('[data-trash-purge]').forEach(b=>b.onclick=()=>purgeTrash(b.dataset.trashPurge));
}
async function openTrash(kind){ if(!canWrite()) return; trashKind=kind||'jobs'; $('trashOverlay').classList.add('on'); await renderTrash(); }
async function restoreTrash(id){
  const {error}=await sb.rpc('trash_restore',{p_kind:trashKind,p_id:id});
  if(error){ $('trashErr').textContent=error.message; return; }
  showToast(trashKind==='jobs'?'Заявка восстановлена':'Выезд восстановлен');
  await renderTrash(); if(trashKind==='jobs') await renderJobs(); else await renderTrips();
}
async function purgeTrash(id){
  if(!await confirmDialog('Удалить запись без возможности восстановления? Все связанные данные также будут удалены.',{danger:true,okText:'Удалить навсегда'})) return;
  $('trashErr').textContent='';
  if(trashKind==='jobs'){
    const {data,error}=await sb.from('job_photos').select('path').eq('job_id',id);
    if(error){ $('trashErr').textContent=error.message; return; }
    const paths=(data||[]).map(x=>x.path).filter(Boolean);
    if(paths.length){ const {error:storageError}=await sb.storage.from('job-photos').remove(paths);
      if(storageError){ $('trashErr').textContent='Не удалось удалить файлы: '+storageError.message; return; } }
  }
  const {error}=await sb.rpc('trash_delete_forever',{p_kind:trashKind,p_id:id});
  if(error){ $('trashErr').textContent=error.message; return; }
  showToast('Удалено безвозвратно'); await renderTrash();
}
$('jobTrash').onclick=()=>openTrash('jobs');
$('tripTrash').onclick=()=>openTrash('trips');
$('trashClose').onclick=()=>$('trashOverlay').classList.remove('on');
$('trashTabs').querySelectorAll('[data-trash-kind]').forEach(b=>b.onclick=()=>{ trashKind=b.dataset.trashKind; renderTrash(); });
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
// ── Рабочие недели ──────────────────────────────────────────────────────
//
// Неделя считается по ISO: с понедельника по воскресенье, номер недели
// определяет четверг (он решает, к какому году неделя относится, — иначе
// первые дни января попадали бы в 53-ю неделю прошлого).
//
// Все вычисления в UTC и по частям даты, а не через локальный Date:
// перевод часов весной сдвигает полночь, и «понедельник» уезжает на день.
const DAY_MS=86400000;
function utcOf(iso){ const p=String(iso).split('-'); return Date.UTC(+p[0],+p[1]-1,+p[2]); }
function isoOf(ms){ const d=new Date(ms);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
function weekOf(iso){
  const t=utcOf(iso); if(isNaN(t)) return null;
  const dow=(new Date(t).getUTCDay()+6)%7;              // пн = 0
  const mon=t-dow*DAY_MS, thu=mon+3*DAY_MS;
  const y=new Date(thu).getUTCFullYear();
  const jan4=Date.UTC(y,0,4), j4dow=(new Date(jan4).getUTCDay()+6)%7;
  const week1=jan4-j4dow*DAY_MS;
  return { key:y+'-'+String(Math.round((mon-week1)/(7*DAY_MS))+1).padStart(2,'0'),
           n:Math.round((mon-week1)/(7*DAY_MS))+1, mon, from:isoOf(mon), to:isoOf(mon+6*DAY_MS) };
}
// «8–14 сен» — без года и без повтора месяца, когда он один.
function weekSpan(w){
  const a=new Date(w.mon), b=new Date(w.mon+6*DAY_MS);
  const ma=MON_RU_SHORT[a.getUTCMonth()], mb=MON_RU_SHORT[b.getUTCMonth()];
  return a.getUTCDate()+(ma===mb?'':(' '+ma))+'–'+b.getUTCDate()+' '+mb;
}
const MON_RU_SHORT=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
function dayLabel(iso){
  const d=new Date(String(iso)+'T00:00:00'); if(isNaN(d)) return String(iso||'');
  return WD_RU[d.getDay()]+' '+String(d.getDate()).padStart(2,'0')+' '+MON_RU[d.getMonth()];
}
function shortDate(iso){
  const d=new Date(String(iso)+'T00:00:00'); if(isNaN(d)) return String(iso||'');
  return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0');
}

// ── Лента «что горит» ───────────────────────────────────────────────────────
//
// Одна и та же лента в сводке у менеджера и в «Графике» у инженера.
// Различий ровно два: чьи заявки в неё попадают и есть ли под ней холодные
// потребности. Двух похожих лент быть не должно — через месяц они разойдутся,
// и человек, глядя на два экрана одного приложения, будет считать сроки
// по-разному.
//
// Порядок задаёт СРОК, а не наличие выезда. Раньше «в депо» и «без выезда»
// жили отдельными карточками внизу — то есть заявка, которая горит сегодня,
// пряталась под той, что через неделю, только потому что её ещё не собрали
// в маршрут. Признак «с выездом / без выезда / в депо» никуда не делся, он
// стал меткой в самой строке: это свойство заявки, а не раздел списка.
// ── Блоки планирования ──────────────────────────────────────────────────
// Одна функция на всю программу: и лента, и загрузка в сводке обязаны
// считать по одному и тому же. Пока это было в двух местах, «график» и
// «загрузка инженеров» показывали разные часы на одни и те же дни.
function jobHours(j){ return ((j&&j.job_works)||[]).reduce((a,w)=>a+(+w.hours||0),0); }
const schedulePtKey=p=>p&&p.lat!=null&&p.lng!=null?((+p.lat).toFixed(5)+','+(+p.lng).toFixed(5)):'';
function scheduleJobKey(j){
  const e=j&&j.equipment, c=j&&j.clients;
  return schedulePtKey(e&&e.lat!=null?e:c);
}
// Снимок маршрута хранит каждое плечо с ключами его концов. По ним снова
// собираем реальный порядок дня: доехали до точки → сделали её работы →
// поехали к следующей. Старый расчёт складывал все промежуточные плечи в
// один «рабочий островок», из-за чего недельный гант врал о ходе выезда.
function scheduleRouteSegs(t,jobs,legs,totalDriveH){
  const stops=((t&&t.route_stops)||[]).map(s=>({key:schedulePtKey(s),type:s&&s.type}));
  const work=jobs.map(j=>({id:j.id,key:scheduleJobKey(j),h:jobHours(j)}));
  return tripRouteSegments(stops,work,legs,totalDriveH);
}
function buildBlocks(list,tripOf,tripById,tripOrd,includeDone){
  const blockOf={}, tripJobs={}, blocks=[];
  const ord=tripOrd||{};
  // Закрытая заявка исчезает из «внимания», но не из ещё идущего выезда:
  // это уже выполненный кусок его хронологии. Удалив его, мы сдвигали все
  // следующие плечи и работы влево. После завершения самого выезда история
  // снова уходит из рабочего графика целиком.
  const scheduled=(list||[]).filter(j=>{
    const t=tripById[tripOf[j.id]];
    if(includeDone)return j.status!=='cancelled'&&(!t||t.status!=='cancelled');
    return scheduleJobIncluded(j.status,t&&t.status);
  });
  scheduled.forEach(j=>{ const tid=tripOf[j.id]; const t=tid?tripById[tid]:null;
    if(t&&t.status!=='cancelled') (tripJobs[tid]||(tripJobs[tid]=[])).push(j); });
  Object.keys(tripJobs).forEach(tid=>{
    // Порядок внутри выезда — порядок маршрута (trip_jobs.ord), а не сроков:
    // заявки делаются в том порядке, в котором к ним подъезжают.
    tripJobs[tid].sort((a,b)=>(ord[a.id]||0)-(ord[b.id]||0));
    const t=tripById[tid], js=tripJobs[tid], es=t.econ_snapshot||{};
    // Плечи знают, сколько ехать ДО первой точки и сколько обратно. У
    // выездов, сохранённых до появления плеч, дорога делится пополам.
    const d=driveOfLegs(es.legs), dh=+es.driveH||0;
    const routeSegs=scheduleRouteSegs(t,js,es.legs||[],dh);
    const slas=js.map(j=>j.due_date).filter(Boolean).sort();
    blocks.push({id:'t'+tid,kind:'trip',tripId:tid,status:t.status,startedAt:t.started_at||null,finishedAt:t.finished_at||null,
      engineerIds:tripEngineerIds(t),engineer:t.lead_engineer||js[0].assigned_engineer||null,
      sla:slas[0]||null,workH:js.reduce((a,j)=>a+jobHours(j),0),
      driveToH:d.toH||dh/2,driveBackH:d.backH||dh/2,driveMidH:d.midH||0,
      from:t.date_from||null,to:t.date_to||t.date_from||null,jobIds:js.map(j=>j.id),
      routeSegs:routeSegs.length?routeSegs:null,
      plan:t.day_plan||null,
      jobs:js.map(j=>({id:j.id,workH:jobHours(j),sla:j.due_date||null}))});
    js.forEach(j=>{ blockOf[j.id]='t'+tid; });
  });
  scheduled.forEach(j=>{ if((j.status==='done'&&(!includeDone||(!j.scheduled_date&&!j.day_plan)))||blockOf[j.id]||!j.due_date) return;
    blocks.push({id:'j'+j.id,kind:'job',engineer:j.assigned_engineer||null,
      sla:j.due_date,workH:jobHours(j),from:includeDone?(j.scheduled_date||null):null,to:includeDone?(j.scheduled_date||null):null,jobIds:[j.id],plan:j.day_plan||null,
      jobs:[{id:j.id,workH:jobHours(j),sla:j.due_date}]});
    blockOf[j.id]='j'+j.id; });
  return {blocks:blocks,blockOf:blockOf};
}
// ── Гант недели ─────────────────────────────────────────────────────────
//
// Полоса дней отвечает на «сколько занято», гант — на «чем и когда». Это
// один и тот же расчёт в двух масштабах: неделя (семь смен) и день (одна
// смена по часам). Строки — ЛЮДИ, а не выезды: выездов на неделе бывает
// шесть, инженеров — двое, и таблица не должна расти от числа поездок.
//
// Состояние (что раскрыто, какой день открыт, что выбрано) живёт здесь, а
// не в DOM: лента перерисовывается целиком после каждого сохранения, и
// иначе гант закрывался бы на каждое движение.
let feedCtx=null;                 // {plan, weeks, engN, shift, mine, nameOf}
const gtOpen={}, gtZoom={};
const gtLaneMode={};
let gtSel=null, gtDrag=null;
let gtPendingDivide=null;
const gtStickyVisible=new Set();let gtStickyFrame=0,gtStickyObserver=null;
function gtStickyPaint(){
  gtStickyFrame=0;
  gtStickyVisible.forEach(group=>{if(!group.isConnected){gtStickyVisible.delete(group);return;}const title=group.querySelector('.vg-gtitle');if(!title)return;const r=group.getBoundingClientRect(),max=Math.max(0,r.height-title.offsetHeight);title.style.top=Math.max(0,Math.min(max,8-r.top))+'px';});
}
function gtStickyRequest(){if(!gtStickyFrame)gtStickyFrame=requestAnimationFrame(gtStickyPaint);}
function gtStickyObserve(root){
  if(!gtStickyObserver&&'IntersectionObserver'in window)gtStickyObserver=new window.IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)gtStickyVisible.add(e.target);else gtStickyVisible.delete(e.target);});gtStickyRequest();});
  root.querySelectorAll('[data-vggroup]').forEach(g=>{if(gtStickyObserver)gtStickyObserver.observe(g);else gtStickyVisible.add(g);});gtStickyRequest();
}
// Scroll events do not bubble from the application's `.scrollp` panes.
document.addEventListener('scroll',gtStickyRequest,{passive:true,capture:true});
window.addEventListener('scroll',gtStickyRequest,{passive:true});window.addEventListener('resize',gtStickyRequest,{passive:true});

function gtDragZoom(){ return gtDrag&&gtDrag.zoom; }
const GT_WEEK_PX_H=5;
function gtWindowHours(){return Math.max(.25,((+appSettings.day_end)||16)-((+appSettings.day_start)||7));}
function gtEff(){ return gtWindowHours()+((+appSettings.tolerance_h)||1); }
function gtSettings(blocks){
  const dayStart=(+appSettings.day_start)||7,dayEnd=(+appSettings.day_end)||16,toleranceH=(+appSettings.tolerance_h)||1;
  const staffDay={...staffDayMap};
  // Старые ручные планы могли уже быть прибиты к выходному до появления
  // staff_day. Открываем только даты, явно названные в плане; остальные
  // субботы и воскресенья остаются выходными.
  (blocks||((feedCtx&&feedCtx.plan&&feedCtx.plan.blocks)||[])).forEach(b=>{
    const dates=[];if(b.plan&&b.plan.start&&b.plan.start.d)dates.push(b.plan.start.d);
    ((b.plan&&b.plan.cuts)||[]).forEach(c=>{if(c.at&&c.at.d)dates.push(c.at.d);});
    if(b.kind==='trip'&&b.from)for(let x=utcOf(b.from),z=utcOf(b.to||b.from);x<=z;x+=DAY_MS)dates.push(isoOf(x));
    dates.forEach(iso=>{const d=new Date(utcOf(iso)).getUTCDay(),k=(b.engineer||' free')+'|'+iso;if((d===0||d===6)&&!staffDay[k])staffDay[k]={start_h:dayStart,end_h:dayEnd,tol_h:toleranceH,synthetic:true};});
  });
  return {dayStart,dayEnd,toleranceH,weekend:[0,6],staffDay};
}

function gtDayGeometry(lanes,iso){
  const ws=lanes.map(l=>dayWindow(l.id,iso,gtSettings())).filter(Boolean);
  const focusStart=Math.max(0,Math.min(...ws.map(w=>w.start))-1),focusEnd=Math.min(24,Math.max(...ws.map(w=>w.ceiling))+1);
  // The day view is a clock, not a focus lens: every hour from 00:00 to
  // 24:00 must occupy the same amount of space.  Compressing the night made
  // the evening labels jump from 19:00 to 22:00 and made late work hard to
  // resize accurately.
  const pxPerHour=20;
  const yOf=t=>Math.max(0,Math.min(24,+t||0))*pxPerHour;
  const tOf=y=>Math.max(0,Math.min(24,(+y||0)/pxPerHour));
  const height=yOf(24);
  return {focusStart,focusEnd,yOf,tOf,height};
}
function gtLaneTime(lane,y){return Math.max(0,Math.min(24,(+y||0)/20));}
function gtBlocks(){ return feedCtx?feedCtx.plan.blocks:[]; }
function gtFind(id){ return gtBlocks().find(b=>String(b.id)===String(id))||null; }

const LOAD_STOPS={
  light:[[0,'#9fb0c0'],[.8,'#2fbf6e'],[1,'#ffd21f'],[1.25,'#ff8f2e'],[1.75,'#e02d1f']],
  dark:[[0,'#5a6472'],[.8,'#2fd07a'],[1,'#ffd21f'],[1.25,'#ff9433'],[1.75,'#f04336']]
};
const LOAD_SATURATION=.72; // «сочно»; .42 — тише, 1 — максимум
function loadHexRgb(hex){ const n=parseInt(hex.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255].map(x=>x/255); }
function loadRgbHex(rgb){ return '#'+rgb.map(x=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0')).join(''); }
function loadRgbLab(hex){
  const c=loadHexRgb(hex).map(x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4));
  const l=.4122214708*c[0]+.5363325363*c[1]+.0514459929*c[2];
  const m=.2119034982*c[0]+.6806995451*c[1]+.1073969566*c[2];
  const s=.0883024619*c[0]+.2817188376*c[1]+.6299787005*c[2];
  const l3=Math.cbrt(l),m3=Math.cbrt(m),s3=Math.cbrt(s);
  return [.2104542553*l3+.793617785*m3-.0040720468*s3,1.9779984951*l3-2.428592205*m3+.4505937099*s3,.0259040371*l3+.7827717662*m3-.808675766*s3];
}
function loadLabRgb(lab){
  const l=Math.pow(lab[0]+.3963377774*lab[1]+.2158037573*lab[2],3);
  const m=Math.pow(lab[0]-.1055613458*lab[1]-.0638541728*lab[2],3);
  const s=Math.pow(lab[0]-.0894841775*lab[1]-1.291485548*lab[2],3);
  const rgb=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s]
    .map(x=>x<=.0031308?12.92*x:1.055*Math.pow(Math.max(0,x),1/2.4)-.055);
  return loadRgbHex(rgb);
}
function loadMix(a,b,t){
  const x=loadRgbLab(a),y=loadRgbLab(b),cx=Math.hypot(x[1],x[2]),cy=Math.hypot(y[1],y[2]);
  if(cx<.03||cy<.03) return loadLabRgb(x.map((v,i)=>v+(y[i]-v)*t));
  let hx=Math.atan2(x[2],x[1]),hy=Math.atan2(y[2],y[1]),dh=hy-hx;
  if(dh>Math.PI) dh-=2*Math.PI; if(dh<-Math.PI) dh+=2*Math.PI;
  const c=cx+(cy-cx)*t,h=hx+dh*t;
  return loadLabRgb([x[0]+(y[0]-x[0])*t,c*Math.cos(h),c*Math.sin(h)]);
}
function loadColor(p){
  const mode=theme.mode==='light'?'light':'dark', allowance=gtEff()/gtWindowHours();
  const base=LOAD_STOPS[mode], stops=base.map((s,i)=>[i===3?allowance:s[0],s[1]]);
  if(p<=0) return stops[0][1];
  for(let i=0;i<stops.length-1;i++) if(p<=stops[i+1][0]) return loadMix(stops[i][1],stops[i+1][1],(p-stops[i][0])/(stops[i+1][0]-stops[i][0]));
  return stops[stops.length-1][1];
}
function loadIntensity(p){ return p<=0?0:(p<.8?.35+.65*(p/.8):1); }
function loadWash(p){
  const rgb=loadHexRgb(loadColor(p)).map(x=>Math.round(x*255));
  const a=Math.min(.96,loadIntensity(p)*LOAD_SATURATION*(theme.mode==='dark'?.92:1));
  return 'rgba('+rgb.join(',')+','+a.toFixed(3)+')';
}
function loadTint(p){
  const rgb=loadHexRgb(loadColor(p)).map(x=>Math.round(x*255));
  return 'rgba('+rgb.join(',')+','+(theme.mode==='dark'?'.22':'.16')+')';
}
function rampCss(p,direction='90deg'){
  const stops=[];
  for(let i=0;i<=10;i++) stops.push(loadColor(p*i/10)+' '+(i*10)+'%');
  return 'linear-gradient('+direction+','+stops.join(',')+')';
}

/* Numbers animate only when a view first appears; the final value never
   depends on animation completing. */
function countTo(el,to,dur=700){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ el.textContent=to; return; }
  const t0=window.performance.now();
  const step=now=>{ const k=Math.min(1,(now-t0)/dur);
    el.textContent=Math.round(to*(1-Math.pow(1-k,3)));
    if(k<1) window.requestAnimationFrame(step); };
  window.requestAnimationFrame(step);
}
const motionPainted=new WeakSet();
function paintFirstMotion(root){
  if(!root||motionPainted.has(root)) return;
  motionPainted.add(root);
  root.querySelectorAll('[data-count]').forEach(el=>countTo(el,+el.dataset.count||0));
  root.querySelectorAll('.fin-v').forEach(el=>{
    const value=String(el.textContent||'').trim();
    if(/^\d+$/.test(value)) countTo(el,+value);
  });
}

// Куски блока с учётом того, что его сейчас тащат.
function gtPieces(b){
  if(gtDrag&&String(gtDrag.id)===String(b.id)){
    const s=gtSettings(),d=new Date(utcOf(gtDrag.start.iso)).getUTCDay(),k=(b.engineer||' free')+'|'+gtDrag.start.iso;
    if((d===0||d===6)&&!s.staffDay[k])s.staffDay[k]={start_h:s.dayStart,end_h:s.dayEnd,tol_h:s.toleranceH,synthetic:true};
    return piecesOf(gtDrag.start,b.segs,s,b.engineer,b.cuts||[]);
  }
  return b.pieces||[];
}
function gtStart(b){
  if(gtDrag&&String(gtDrag.id)===String(b.id)) return gtDrag.start;
  return b.start;
}

function scheduleNow(){
  const at=new Date(),n=core.scheduleNowAt(at,appSettings.day_start,'Europe/Kyiv'); return {iso:n.iso,t:n.t,label:n.label,ms:at.getTime()};
}
function paintScheduleNow(){
  if(feedCtx) Object.keys(gtOpen).filter(k=>gtOpen[k]&&!gtZoom[k]).forEach(gtPaint);
}
setInterval(paintScheduleNow,60000);

function gtDayHtml(key){
  if(!feedCtx) return '';
  const it=feedCtx.weeks[key], iso=gtZoom[key]; if(!it||!iso) return '';
  const eff=gtEff(), shift=((+appSettings.day_end)||16)-((+appSettings.day_start)||7), st=gtSettings();
  const span=24, relFrom=0,lanes=gtWeekLanes(key),geo=gtDayGeometry(lanes,iso),dayH=geo.height,laneMin=window.matchMedia('(max-width:600px)').matches?120:150;
  let axis='<span class="vg-axis-head"></span>';
  for(let h=0;h<=24;h++) axis+='<span class="vg-hour-label" style="position:absolute;top:'+(34+geo.yOf(h))+'px">'+clockLabel(h)+'</span>';
  axis='<div class="vg-axis vg-day-axis" style="height:'+(dayH+34)+'px">'+axis+'</div>';
  let heads='',tracks='';
  lanes.forEach(l=>{
    const hours=gtLaneLoad(l.id,iso), pct=Math.round(hours/shift*100);
    heads+='<div class="vg-lane-head"><b>'+esc(l.name)+'</b><span>'+fmtH(hours)+(feedCtx.mine?'':' · '+pct+'%')+'</span></div>';
    const w=dayWindow(l.id,iso,st); let ticks=''; for(let h=1;h<24;h++)ticks+='<i class="vg-hour-line" style="top:'+geo.yOf(h)+'px"></i>';
    if(w) ticks+='<span class="vg-off" style="top:0;height:'+geo.yOf(w.start)+'px"></span><span class="vg-off" style="top:'+geo.yOf(w.ceiling)+'px;bottom:0"></span>'
      +'<span class="vg-tolerance" style="top:'+geo.yOf(w.end)+'px;height:'+(geo.yOf(w.ceiling)-geo.yOf(w.end))+'px"></span>'
      +'<button class="vg-win-line start" data-winline="start" data-engineer="'+esc(l.id)+'" style="top:'+geo.yOf(w.start)+'px"><i>начало '+clockLabel(w.start)+'</i></button>'
      +'<button class="vg-win-line end" data-winline="end" data-engineer="'+esc(l.id)+'" style="top:'+geo.yOf(w.end)+'px"><i>конец '+clockLabel(w.end)+'</i></button>'
      +'<button class="vg-win-line tolerance" data-winline="tol" data-engineer="'+esc(l.id)+'" style="top:'+geo.yOf(w.ceiling)+'px"><i>допуск '+clockLabel(w.ceiling)+'</i></button>'
      +(w.proposedEnd!=null?'<span class="vg-proposed" style="top:'+geo.yOf(w.proposedEnd)+'px">предложено '+clockLabel(w.proposedEnd)+'</span>':'');
    let bars='';
    gtBlocks().filter(b=>(b.engineer||' free')===l.id).forEach(b=>{
      const pcs=gtPieces(b).filter(p=>p.iso===iso);if(!pcs.length)return;
      const urgent=(b.lateJobs||[]).length||(!b.ok&&b.why==='late');
      pcs.forEach(p=>{const y=geo.yOf(p.from),h=Math.max(12,geo.yOf(p.to)-geo.yOf(p.from)),name=p.k==='d'?'Дорога':((p.jobId&&feedCtx.jobName(p.jobId))||gtBlockName(b));
        bars+='<div class="vg-block vg-piece '+(b.kind==='trip'?'trip':'job')+(urgent?' urgent':'')+(p.pinned?' man':'')+(h<40?' short':'')+'" data-gb="'+esc(b.id)+'" data-piece-at="'+p.at+'" data-piece-from="'+p.from+'" data-piece-to="'+p.to+'" data-piece-iso="'+p.iso+'" style="top:'+y+'px;height:'+h+'px">'
          +(p.k==='d'?'<i class="vg-seg road" style="inset:0"></i>':'')+'<span class="vg-label"><b>'+esc(name)+(p.pinned?' ✎':'')+'</b><small>'+esc(fmtH(p.h)+' · '+clockLabel(p.from)+'–'+clockLabel(p.to))+'</small></span>'
          +(canWrite()&&p.h>1?'<button class="vg-divide" type="button" data-gdivide aria-label="Разделить участок">÷</button>':'')+'</div>';});
    });
    const color=loadColor(hours/shift), over=Math.max(0,hours-gtEff());
    const now=scheduleNow(), nowY=geo.yOf(now.t), nowLine=now.iso===iso&&nowY>=0&&nowY<=dayH?'<span class="vg-now" title="Сейчас · '+esc(now.label)+'" style="top:'+nowY+'px"></span>':'';
    tracks+='<div class="vg-lane vg-day-lane" data-vglane="'+esc(l.id)+'" data-vgspan="'+span+'" data-focus-start="'+geo.focusStart+'" data-focus-end="'+geo.focusEnd+'" style="--load:'+color+'">'+ticks+bars+nowLine
      +(!feedCtx.mine&&over>.01?'<span class="vg-over">+'+fmtH(over)+'</span>':'')+'</div>';
  });
  const proposals=lanes.map(l=>({l,o:staffDayMap[l.id+'|'+iso]})).filter(x=>x.o&&x.o.proposed_end_h!=null);
  return '<div class="gtop"><button class="gback" type="button" data-gback="'+esc(key)+'">← неделя</button>'
    +'<span class="gttl">'+WD_RU[new Date(utcOf(iso)).getUTCDay()]+' '+esc(shortDate(iso))+'</span>'
    +'<span class="vg-auto">сутки · шаг 15 минут</span></div>'
    +proposals.map(x=>'<div class="vg-request">'+esc(x.l.name)+' просит сдвинуть конец дня на '+clockLabel(x.o.proposed_end_h)+'<button class="btn sm" data-day-decide="accept" data-engineer="'+x.l.id+'">Подтвердить</button><button class="btn sm ghost" data-day-decide="reject" data-engineer="'+x.l.id+'">Отклонить</button></div>').join('')
    +'<div class="vg-scroll"><div class="vg-grid vg-day-grid" style="--day-h:'+dayH+'px;--lanes:'+Math.max(1,lanes.length)+';--lane-min:'+laneMin+'px">'
    +axis+'<div class="vg-heads">'+heads+'</div><div class="vg-tracks">'+tracks+'</div></div></div>'
    +'<div class="gleg"><span><i class="trip-edge"></i>выезд</span><span><i class="job-edge"></i>заявка</span><span><i class="road"></i>дорога</span>'
    +(canWrite()?'<span>нажми участок — разрыв · перетащи — шаг 30 мин</span>':'<span>только просмотр</span>')+'<span>✎ — расставлено вручную</span></div>';
}
function gtWeekDays(it){ const out=[]; for(let i=0;i<7*(it.spanWeeks||1);i++) out.push(isoOf(it.w.mon+i*DAY_MS)); return out; }
function gtBusyWeekLanes(key){
  const it=feedCtx.weeks[key], days=gtWeekDays(it), used={};
  gtBlocks().forEach(b=>gtPieces(b).forEach(p=>{ if(days.includes(p.iso)) used[b.engineer||' free']=1; }));
  if(feedCtx.mine) return [{id:session.user.id,name:'Мои работы'}];
  const named=new Set((profilesList||[]).filter(p=>p&&p.role==='engineer'&&p.active!==false&&String(p.full_name||'').trim()).map(p=>p.id));
  return Object.keys(used).filter(id=>id===' free'||named.has(id))
    .map(id=>({id,name:id===' free'?'Без инженера':feedCtx.nameOf(id)}));
}
function gtWeekLanes(key){
  const busy=gtBusyWeekLanes(key);
  const selected=String(gtLaneMode[key]||'all');
  if(selected.startsWith('lane:')){
    const id=selected.slice(5), lane=busy.find(x=>String(x.id)===id);
    if(lane) return [lane];
  }
  return busy;
}
function gtLaneLoad(id,iso){
  const x=(feedCtx.plan.load||{})[id+'|'+iso]; return x?(x.workH+x.driveH):0;
}
function gtLanePicker(key){
  if(feedCtx.mine) return '';
  const current=String(gtLaneMode[key]||'all');
  const options=['<option value="all"'+(current==='all'?' selected':'')+'>Все занятые</option>'];
  gtBusyWeekLanes(key).forEach(l=>options.push('<option value="lane:'+esc(l.id)+'"'+(current==='lane:'+l.id?' selected':'')+'>'+esc(l.name)+'</option>'));
  return '<label class="vg-filter">Инженер <select data-vgmode aria-label="Инженер">'+options.join('')+'</select></label>';
}
function gtBlockName(b){
  const names=(b.jobIds||[]).map(id=>feedCtx.jobName(id)).filter(Boolean);
  return names.join(' + ')||(b.kind==='trip'?'Выезд':'Заявка');
}
function gtWeekProblem(key,lanes){
  const days=gtWeekDays(feedCtx.weeks[key]); let worst=null;
  lanes.forEach(l=>days.forEach((iso,i)=>{
    const w=dayWindow(l.id,iso,gtSettings()),over=gtLaneLoad(l.id,iso)-(w?Math.max(.25,w.ceiling-w.start):gtEff());
    if(over>.01&&(!worst||over>worst.over)) worst={over,l,iso,i};
  }));
  if(worst) return WD_RU[(worst.i+1)%7]+' у '+worst.l.name+' '+fmtH(gtLaneLoad(worst.l.id,worst.iso))+' — на '+fmtH(worst.over)+' сверх допуска';
  const warning=(feedCtx.plan.warnings||[]).find(w=>days.includes(w.date)||days.includes(w.sla));
  if(warning) return warning.kind==='late'?'не успеваем к сроку '+shortDate(warning.sla):'график требует решения';
  if(gtBlocks().some(b=>(b.engineer||' free')===' free'&&gtPieces(b).some(p=>days.includes(p.iso)))) return 'есть работа без инженера';
  return '';
}
function fmtH(n){ n=+n||0; return (+n.toFixed(n%1?1:0))+' ч'; }
function clockLabel(t){const h=Math.floor(+t||0),m=Math.round(((+t||0)-h)*60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
function gtLoadScale(){
  const allowance=gtEff()/gtWindowHours();
  const stops=[[0,'0%'],[.8,(.8/1.75*100)+'%'],[1,(1/1.75*100)+'%'],[allowance,(allowance/1.75*100)+'%'],[1.75,'100%']];
  const gradient=stops.map(x=>loadColor(x[0])+' '+x[1]).join(',');
  return '<div class="vg-scale"><div class="vg-scale-bar" style="background:linear-gradient(90deg,'+gradient+')"></div>'
    +'<div class="vg-scale-labels"><span style="left:0">нет работ</span><span style="left:'+(80/1.75)+'%">номинал 80%</span>'
    +'<span style="left:'+(100/1.75)+'%">окно</span><span style="left:'+(allowance/1.75*100)+'%">допуск</span><span style="left:100%">перегруз</span></div></div>';
}
const gtWallMs=(iso,t)=>utcOf(iso)+(+t||0)*3600000;
function gtElapsed(ms){
  const mins=Math.max(0,Math.floor(ms/60000));
  if(mins>=1440){const d=Math.floor(mins/1440);return d+' '+plural(d,'день','дня','дней');}
  return Math.floor(mins/60)+':'+String(mins%60).padStart(2,'0');
}
function gtTripLive(b,first,last,now){
  if(b.kind!=='trip') return null;
  const nowWall=gtWallMs(now.iso,now.t),startWall=gtWallMs(first.iso,first.from),endWall=gtWallMs(last.iso,last.to);
  if((b.status==='planned'||b.status==='assigned')&&nowWall>startWall)
    return {tone:'bad',html:'<i></i>не начат · +'+gtElapsed(nowWall-startWall)};
  if(b.status==='in_progress'){
    if(!b.startedAt) return {tone:'bad',html:'<i></i>идёт'};
    const elapsed=now.ms-new Date(b.startedAt).getTime();
    if(nowWall>endWall) return {tone:'bad',html:'<i></i>идёт '+gtElapsed(elapsed)+' · +'+gtElapsed(nowWall-endWall)};
    return {tone:'run',html:'<i></i>идёт '+gtElapsed(elapsed)};
  }
  if(b.status==='finished'){
    const elapsed=b.finishedAt?now.ms-new Date(b.finishedAt).getTime():0;
    return {tone:'wait',html:'<i></i>ждёт'+(elapsed>0?' '+gtElapsed(elapsed):'')};
  }
  return null;
}
function gtActionIcon(kind){
  const body=kind==='start'?'<path d="M5.5 3.4 12.8 8 5.5 12.6z"/>':kind==='finish'?'<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2"/>':kind==='confirm'?'<path d="M3.6 8.4 6.6 11.4 12.4 4.9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>':'<circle cx="4.2" cy="8" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="11.8" cy="8" r="1.35"/>';
  return '<svg viewBox="0 0 16 16" aria-hidden="true">'+body+'</svg>';
}
function gtTripAction(b,allowEarly){
  if(b.kind!=='trip') return null;
  const own=(b.engineerIds||[]).includes(session&&session.user&&session.user.id);
  const mayAct=own||canWrite(),first=(b.pieces||[])[0],startedToday=!first||first.iso<=todayISO();
  if((b.status==='planned'||b.status==='assigned')&&mayAct&&(startedToday||allowEarly)) return {kind:'start',label:'Начать выезд'};
  if(b.status==='in_progress'&&mayAct) return {kind:'finish',label:'Завершить выезд'};
  if(b.status==='finished'&&canWrite()) return {kind:'confirm',label:'Подтвердить выезд'};
  if(b.status==='finished'&&!canWrite()&&own) return {kind:'wait',label:'Ждёт менеджера',passive:true};
  return null;
}
function gtVerticalHtml(key){
  const it=feedCtx.weeks[key],days=gtWeekDays(it),lanes=gtWeekLanes(key);
  const laneMin=window.matchMedia('(max-width:600px)').matches?108:132,today=todayISO(),now=scheduleNow();
  const all=[];gtBlocks().forEach(b=>gtPieces(b).forEach(p=>all.push({...p,engineer:b.engineer||' free'})));
  const rows=days.map(iso=>weekRowSpan(iso,lanes.map(l=>l.id),all,gtSettings(),GT_WEEK_PX_H));
  const totalH=rows.reduce((n,r)=>n+r.px,0),template=rows.map(r=>r.px+'px').join(' ');
  let axis='<span class="vg-axis-head" aria-hidden="true"></span>';
  days.forEach((iso,i)=>{const weekendDay=[0,6].includes(new Date(utcOf(iso)).getUTCDay()),opened=weekendDay&&lanes.some(l=>dayWindow(l.id,iso,gtSettings()));axis+='<button style="height:'+rows[i].px+'px" class="vg-date'+(rows[i].weekend?' we':'')+(opened?' opened':'')+(iso===today?' today':'')+'" data-gday="'+iso+'"><b>'+WD_RU[(i+1)%7]+'</b> '+shortDate(iso)+(opened?'<small>открыт выездом</small>':'')+'</button>';});
  axis='<div class="vg-axis" style="grid-template-rows:34px '+template+'">'+axis+'</div>';
  let heads='',tracks='';
  lanes.forEach(l=>{
    const weekH=days.reduce((n,d)=>n+gtLaneLoad(l.id,d),0),windowH=gtWindowHours(),weekCap=days.reduce((n,d)=>{const w=dayWindow(l.id,d,gtSettings());return n+(w?Math.max(.25,w.end-w.start):0);},0);
    heads+='<div class="vg-lane-head"><b>'+esc(l.name)+'</b><span>'+fmtH(weekH)+(feedCtx.mine?'':' · '+Math.round(weekH/Math.max(.25,weekCap)*100)+'%')+'</span></div>';
    let cells='',bars='',offset=0;const groupBounds={},dayLayout={};
    days.forEach(iso=>{const entries=gtBlocks().filter(b=>(b.engineer||' free')===l.id).map(b=>{const pcs=gtPieces(b).filter(x=>x.iso===iso);return pcs.length?{b,from:Math.min(...pcs.map(x=>x.from)),to:Math.max(...pcs.map(x=>x.to))}:null;}).filter(Boolean).sort((a,z)=>a.from-z.from||a.to-z.to),ends=[];entries.forEach(x=>{let col=ends.findIndex(v=>v<=x.from+1e-6);if(col<0)col=ends.length;ends[col]=x.to;x.col=Math.min(2,col);});const cols=Math.min(3,Math.max(1,ends.length));entries.forEach(x=>dayLayout[String(x.b.id)+'|'+iso]={col:x.col,cols});});
    days.forEach((iso,i)=>{const row=rows[i],w=dayWindow(l.id,iso,gtSettings()),hours=gtLaneLoad(l.id,iso),p=hours/(w?Math.max(.25,w.end-w.start):windowH),over=Math.max(0,hours-(w?Math.max(0,w.end-w.start):windowH));
      const ceilingH=w?Math.max(.25,w.ceiling-w.start):windowH,railFill=Math.max(12,Math.min(100,hours/ceilingH*100));
      const weekendDay=[0,6].includes(new Date(utcOf(iso)).getUTCDay()),opened=weekendDay&&!!w;
      cells+='<div class="vg-cell'+(row.weekend?' we':'')+(opened?' opened':'')+(iso===today?' today':'')+'" data-vgday="'+iso+'" data-vgtop="'+row.top+'" data-vgbot="'+row.bot+'" style="position:absolute;top:'+offset+'px;height:'+row.px+'px">'
        +(w&&!feedCtx.mine?'<span class="vg-tolerance" style="top:'+((w.end-row.top)*GT_WEEK_PX_H)+'px;height:'+Math.max(0,(w.ceiling-w.end)*GT_WEEK_PX_H)+'px"></span><span class="vg-day-end" style="top:'+((w.end-row.top)*GT_WEEK_PX_H)+'px"></span>':'')
        +(!feedCtx.mine&&w?'<span class="vg-rail'+(hours>ceilingH?' over':'')+'" style="top:4px;height:'+Math.max(4,row.px-8)+'px">'+(hours>0?'<i style="height:'+railFill+'%;--rail-color:'+loadColor(p)+'"></i>':'')+'</span>':'')
        +(!feedCtx.mine&&over>.01?'<span class="vg-over" style="top:'+Math.max(2,(w.end-row.top)*GT_WEEK_PX_H-8)+'px">+'+fmtH(over)+'</span>':'')+'</div>';
      gtBlocks().filter(b=>(b.engineer||' free')===l.id).forEach(b=>{const blockPieces=gtPieces(b),pcs=blockPieces.filter(x=>x.iso===iso);if(!pcs.length)return;
        const from=Math.min(...pcs.map(x=>x.from)),to=Math.max(...pcs.map(x=>x.to)),top=offset+Math.max(1,(from-row.top)*GT_WEEK_PX_H),height=Math.max(12,(Math.min(to,row.bot)-Math.max(from,row.top))*GT_WEEK_PX_H);
        const occupied=[...new Set(blockPieces.map(x=>x.iso))].sort(),dayNo=occupied.indexOf(iso),firstDay=dayNo===0;
        const prev=occupied[dayNo-1],next=occupied[dayNo+1],contUp=prev&&days.includes(prev)&&utcOf(iso)-utcOf(prev)===DAY_MS,contDown=next&&days.includes(next)&&utcOf(next)-utcOf(iso)===DAY_MS;
        const urgent=(b.lateJobs||[]).length||(!b.ok&&b.why==='late'),startP=hours/windowH,first=blockPieces[0],last=blockPieces[blockPieces.length-1];
        const live=gtTripLive(b,first,last,now),action=firstDay?gtTripAction(b):null,dayHours=pcs.reduce((n,x)=>n+x.h,0),span=Math.max(.01,to-from);
        const roads=pcs.filter(x=>x.k==='d').map(x=>'<i class="vg-week-road" style="top:'+(((x.from-from)/span)*100).toFixed(2)+'%;height:'+(((x.to-x.from)/span)*100).toFixed(2)+'%"></i>').join('');
        const burnable=iso===today&&(b.status==='planned'||b.status==='assigned')&&now.t>from;
        const burn=burnable?Math.max(0,Math.min(100,(Math.min(now.t,to)-from)/span*100)):0;
        const title=occupied.length===1?gtBlockName(b):'';
        const meta=(live?'<span class="vg-live '+live.tone+'">'+live.html+'</span>':'<small>'+esc(fmtH(dayHours)+' · '+clockLabel(from)+'–'+clockLabel(to))+'</small>')+(occupied.length>1?'<span class="vg-day-count">'+(dayNo+1)+'/'+occupied.length+'</span>':'');
        const act=action?'<'+(action.passive?'span':'button')+' class="vg-act'+(action.passive?' passive':'')+'" '+(action.passive?'':'type="button" data-gact="'+action.kind+'"')+' aria-label="'+esc(action.label)+'" title="'+esc(action.label)+'">'+gtActionIcon(action.kind)+'</'+(action.passive?'span':'button')+'>':'';
        const layout=dayLayout[String(b.id)+'|'+iso]||{col:0,cols:1},narrow=layout.cols>1;
        bars+='<div class="vg-block '+(b.kind==='trip'?'trip':'job')+(urgent?' urgent':'')+(b.manual?' man':'')+(height<40?' short':'')+(height<40&&live?' short-live':'')+(height<44?' tap-short':'')+(contUp?' cont-up':'')+(contDown?' cont-down':'')+(action&&layout.col===0?' has-act':'')+(narrow?' col narrow':'')+'" data-gb="'+esc(b.id)+'" data-block="'+esc(b.id)+'" data-block-day="'+iso+'" style="--col:'+layout.col+';--cols:'+layout.cols+';--block-tint:'+(feedCtx.mine?'transparent':loadTint(startP))+';top:'+top+'px;height:'+height+'px">'+roads
          +(burn>0?'<i class="vg-burn" style="height:'+burn.toFixed(2)+'%"></i><i class="vg-burn-edge" style="top:'+burn.toFixed(2)+'%"></i>':'')
          +'<span class="vg-label">'+(title?'<b>'+esc(title)+(b.manual?' ✎':'')+'</b>':'')+'<span class="vg-meta">'+meta+'</span></span>'+(layout.col===0?act:'')+'</div>';
        if(occupied.length>1){const g=groupBounds[b.id]||(groupBounds[b.id]={top,bottom:top+height,b,name:gtBlockName(b)});g.top=Math.min(g.top,top);g.bottom=Math.max(g.bottom,top+height);}
        if(iso===today&&b.status==='in_progress'&&now.t>to){const tailTop=offset+(to-row.top)*GT_WEEK_PX_H,tailH=Math.max(2,(Math.min(now.t,row.bot)-to)*GT_WEEK_PX_H);if(tailH>0)bars+='<i class="vg-tail" style="top:'+tailTop+'px;height:'+tailH+'px"></i>';}
      });
      if(iso===today&&now.t>=row.top&&now.t<=row.bot) bars+='<span class="vg-nowline" style="top:'+(offset+(now.t-row.top)*GT_WEEK_PX_H)+'px"><b></b><s></s></span>';
      offset+=row.px;});
    const groups=Object.values(groupBounds).map(g=>'<div class="vg-group" data-vggroup data-gb="'+esc(g.b.id)+'" style="top:'+g.top+'px;height:'+(g.bottom-g.top)+'px"><b class="vg-gtitle">'+esc(g.name)+(g.b.manual?' ✎':'')+'</b></div>').join('');
    tracks+='<div class="vg-lane" data-vglane="'+esc(l.id)+'" style="height:'+totalH+'px">'+cells+bars+groups+'<span class="vg-tip" hidden></span></div>';
  });
  return '<div class="vg-tools"><span>'+(feedCtx.mine?'Работы по дням':'Рабочее окно '+fmtH((+appSettings.day_end||16)-(+appSettings.day_start||7))+' · допуск '+fmtH(appSettings.tolerance_h||1)+' · перетащите на сб/вс, чтобы открыть выходной')+'</span>'+gtLanePicker(key)+'</div>'
    +'<div class="vg-scroll" style="--lane-min:'+laneMin+'px"><div class="vg-grid" style="--week-h:'+totalH+'px;--lanes:'+Math.max(1,lanes.length)+'">'+axis+'<div class="vg-heads">'+heads+'</div><div class="vg-tracks">'+tracks+'</div></div></div>'
    +(feedCtx.mine?'':gtLoadScale())+'<div class="gleg"><span><i class="trip-edge"></i>выезд</span><span><i class="job-edge"></i>заявка</span><span><i class="road"></i>дорога</span><span>тап по дню — сутки и ручная раскладка</span></div>';
}
function gtHtml(key){ return gtZoom[key]?gtDayHtml(key):gtVerticalHtml(key); }
function gtPaint(key){
  const box=document.querySelector('[data-gtbox="'+key+'"]'); if(!box) return;
  box.innerHTML=gtHtml(key);
  gtWire(key,box);
}
function gtApply(){
  Object.keys(gtOpen).forEach(k=>{
    const box=document.querySelector('[data-gtbox="'+k+'"]'); if(!box) return;
    box.hidden=!gtOpen[k];
    const b=document.querySelector('[data-gtoggle="'+k+'"]'); if(b) b.classList.toggle('on',!!gtOpen[k]);
    if(b) b.setAttribute('aria-expanded',gtOpen[k]?'true':'false');
    if(gtOpen[k]) gtPaint(k);
  });
}

// ── Перетаскивание ──────────────────────────────────────────────────────
function gtWire(key,box){
  const eff=gtEff(), zoom=gtZoom[key]||null;
  const gantt=box.querySelector('.vg-scroll');
  gtStickyObserve(box);
  if(gantt&&!zoom){
    gantt.onpointerover=e=>{const el=e.target.closest('[data-block]');if(!el)return;gantt.classList.add('hl');gantt.querySelectorAll('[data-block]').forEach(x=>x.classList.toggle('on',x.dataset.block===el.dataset.block));};
    gantt.onpointerleave=()=>{gantt.classList.remove('hl');gantt.querySelectorAll('[data-block]').forEach(x=>x.classList.remove('on'));};
  }
  box.querySelectorAll('[data-gact]').forEach(btn=>{
    btn.onpointerdown=e=>e.stopPropagation();
    btn.onclick=async e=>{e.preventDefault();e.stopPropagation();const host=btn.closest('[data-gb]'),b=host&&gtFind(host.dataset.gb);if(b&&b.tripId){const own=(b.engineerIds||[]).includes(session.user.id);await tripAction(b.tripId,btn.dataset.gact,!own&&canWrite()?feedCtx.nameOf(b.engineer):'');}};
  });
  box.querySelectorAll('.vg-gtitle').forEach(title=>title.onclick=e=>{e.stopPropagation();const b=gtFind(title.closest('[data-gb]').dataset.gb);if(b){gtSel=b.id;gtPop(key,b);}});
  box.querySelectorAll('[data-gback]').forEach(b=>b.onclick=e=>{ e.stopPropagation();
    gtZoom[key]=null; gtSel=null; gtPaint(key); });
  box.querySelectorAll('[data-gday]').forEach(d=>d.onclick=e=>{ e.stopPropagation();
    gtZoom[key]=d.dataset.gday; gtSel=null; gtPaint(key); });
  box.querySelectorAll('[data-vgmode]').forEach(select=>select.onchange=e=>{ e.stopPropagation();
    gtLaneMode[key]=select.value; gtSel=null; gtPaint(key); });
  box.querySelectorAll('[data-winline]').forEach(line=>line.onpointerdown=e=>{
    const kind=line.dataset.winline,engineer=line.dataset.engineer;if((kind!=='end'||role!=='engineer')&&!canWrite())return;
    e.preventDefault();e.stopPropagation();const lane=…67458 tokens truncated…riff_profiles,ors_proxy,stay_radius_m,stay_min_minutes,'
    +'track_max_kmh,track_slack,depot_radius_m,depot_exit_margin_m,depot_outside_minutes';
  // day_start приходит из миграции sql/27. Если её ещё не накатили, запрос
  // со списком столбцов падает целиком, и настройки уехали бы в
  // settings_public — то есть без тарифов и себестоимости, молча. Поэтому
  // новый столбец спрашиваем отдельной попыткой, а не общим списком.
  let {data}=await sb.from('settings').select(SETTINGS_COLS).eq('id',true).single();
  if(!data){ hasDayStart=false;
    const r=await sb.from('settings').select(SETTINGS_COLS).eq('id',true).single(); data=r.data||null; }
  if(!data){ const pub=await sb.from('settings_public').select('*').eq('id',true).single(); data=pub.data||null; }
  if(data){ appSettings={shift_hours:data.shift_hours,deviation_pct:data.deviation_pct,day_start:(data.day_start==null?7:data.day_start),day_end:(data.day_end==null?16:data.day_end),tolerance_h:(data.tolerance_h==null?1:data.tolerance_h),currency:data.currency,tariffs:data.tariffs||{km:0,hour:0,day:0,night:0},costs:data.costs||{km:0,hour:0,day:0,night:0},default_theme:data.default_theme||{},repair_warranty_days:(data.repair_warranty_days==null?90:data.repair_warranty_days),contact_period_days:(data.contact_period_days||0),stay_radius_m:(data.stay_radius_m==null?300:data.stay_radius_m),stay_min_minutes:(data.stay_min_minutes==null?10:data.stay_min_minutes),track_max_kmh:(data.track_max_kmh==null?300:data.track_max_kmh),track_slack:(data.track_slack==null?1.5:data.track_slack),depot_radius_m:(data.depot_radius_m==null?5000:data.depot_radius_m),depot_exit_margin_m:(data.depot_exit_margin_m==null?300:data.depot_exit_margin_m),depot_outside_minutes:(data.depot_outside_minutes==null?60:data.depot_outside_minutes),avoid_zones:(data.avoid_zones||[]),tariff_profiles:(data.tariff_profiles||[]),ors_proxy:(data.ors_proxy||'')}; renderAvoidZones(); }
  // Пустой результат по обоим источникам — это не «настроек нет», это сбой
  // связи или прав. Без сообщения приложение молча открывалось бы без темы,
  // без зон объезда и без маршрутизации, и искать причину пришлось бы наугад.
  else loadFail('настройки',new Error('settings и settings_public вернули пусто'));
  }catch(e){ loadFail('настройки',e); } }
function renderSettings(){ const s=appSettings; $('stShift').value=s.shift_hours; $('stDev').value=s.deviation_pct;
  if($('stDayStart')) $('stDayStart').value=(s.day_start==null?7:s.day_start); if($('stDayEnd')) $('stDayEnd').value=(s.day_end==null?16:s.day_end); if($('stTolerance')) $('stTolerance').value=(s.tolerance_h==null?1:s.tolerance_h); $('stCur').value=s.currency||'';
  const c=s.costs||{}; $('csKm').value=c.km||0;$('csHour').value=c.hour||0;$('csDay').value=c.day||0;$('csNight').value=c.night||0;
  if($('stStayRad')) $('stStayRad').value=(s.stay_radius_m==null?300:s.stay_radius_m);
  if($('stStayMin')) $('stStayMin').value=(s.stay_min_minutes==null?10:s.stay_min_minutes);
  if($('stTrkKmh')) $('stTrkKmh').value=(s.track_max_kmh==null?300:s.track_max_kmh);
  if($('stTrkSlack')) $('stTrkSlack').value=(s.track_slack==null?1.5:s.track_slack);
  $('stDepotRad').value=(s.depot_radius_m==null?5000:s.depot_radius_m); $('stDepotMargin').value=(s.depot_exit_margin_m==null?300:s.depot_exit_margin_m); $('stDepotOut').value=(s.depot_outside_minutes==null?60:s.depot_outside_minutes);
  const dt=s.default_theme||{}; $('dtMode').value=dt.mode||'dark'; $('orsProxy').value=s.ors_proxy||''; $('stWarrDays').value=(s.repair_warranty_days==null?90:s.repair_warranty_days); $('stContact').value=s.contact_period_days||0;
  renderProfiles(); renderVehicles(); renderUsersAdmin(); renderVersionLine(); }
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
$('stSave').onclick=async ()=>{ const start=parseFloat($('stDayStart').value),end=parseFloat($('stDayEnd').value); if(!(end>start)){notify('Конец рабочего дня должен быть позже начала','warn');return;} const rec={shift_hours:parseFloat($('stShift').value)||8,deviation_pct:parseFloat($('stDev').value)||0,day_start:start,day_end:end,tolerance_h:Math.max(0,parseFloat($('stTolerance').value)||0),currency:$('stCur').value.trim()||'грн',costs:{km:+$('csKm').value||0,hour:+$('csHour').value||0,day:+$('csDay').value||0,night:+$('csNight').value||0},ors_proxy:$('orsProxy').value.trim(),repair_warranty_days:parseInt($('stWarrDays').value)||0,contact_period_days:parseInt($('stContact').value)||0,stay_radius_m:parseInt($('stStayRad').value)||300,stay_min_minutes:parseInt($('stStayMin').value)||10,track_max_kmh:parseFloat($('stTrkKmh').value)||300,track_slack:parseFloat($('stTrkSlack').value)||1.5,depot_radius_m:parseInt($('stDepotRad').value)||5000,depot_exit_margin_m:Math.max(0,parseInt($('stDepotMargin').value)||0),depot_outside_minutes:parseInt($('stDepotOut').value)||60,updated_at:new Date().toISOString()};
  if(!hasDayStart) delete rec.day_start;
  const {error}=await sb.from('settings').update(rec).eq('id',true); if(error){ $('stStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings=Object.assign(appSettings,rec); $('stStatus').innerHTML='<span class="ok">Сохранено</span>'; };
$('dtSave').onclick=async ()=>{ const dt={mode:$('dtMode').value,accent:'#ffe100'}; const {error}=await sb.from('settings').update({default_theme:dt}).eq('id',true); if(error){ $('dtStatus').innerHTML='<span class="err">'+esc(error.message)+'</span>'; return; } appSettings.default_theme=dt; $('dtStatus').innerHTML='<span class="ok">Сохранено</span>'; };
async function renderUsersAdmin(){
  const box=$('usersList');
  const [profileResult,orgResult]=await Promise.all([
    sb.from('profiles').select('id,full_name,role,active').order('full_name'),
    sb.from('employee_org').select('profile_id,manager_id,job_title')
  ]);
  if(profileResult.error||orgResult.error){ box.innerHTML='<div class="err">'+esc((profileResult.error||orgResult.error).message)+'</div>'; return; }
  profilesList=profileResult.data||[]; const orgByProfile=new Map((orgResult.data||[]).map(x=>[x.profile_id,x])); box.innerHTML='';
  if(!profilesList.length){ box.innerHTML='<div class="empty">Учётных записей пока нет.</div>'; return; }
  const roleLabel={admin:'админ',logist:'логист',engineer:'инженер'};
  profilesList.forEach(p=>{ const org=orgByProfile.get(p.id)||{}; const d=document.createElement('div'); d.className='eqitem urow staff-row';
    const managerOptions=profilesList.filter(m=>m.id!==p.id&&m.active).map(m=>'<option value="'+m.id+'">'+esc(m.full_name||roleLabel[m.role]||'Сотрудник')+'</option>').join('');
    const inactiveManager=org.manager_id&&!profilesList.some(m=>m.id===org.manager_id&&m.active)
      ?'<option value="'+org.manager_id+'" selected disabled>Текущий руководитель неактивен</option>':'';
    d.innerHTML='<label class="staff-field"><span>Сотрудник'+(p.active?'':' · неактивен')+'</span><input type="text" value="'+esc(p.full_name||'')+'" data-un="'+p.id+'" placeholder="Имя" autocomplete="off"></label>'+
      '<label class="staff-field"><span>Должность</span><input type="text" value="'+esc(org.job_title||'')+'" data-title="'+p.id+'" maxlength="120" placeholder="Например, старший инженер"></label>'+
      '<label class="staff-field"><span>Прямой руководитель</span><select data-manager="'+p.id+'"><option value="">Без руководителя</option>'+inactiveManager+managerOptions+'</select></label>'+
      '<label class="staff-field"><span>Роль в приложении</span><select data-ur="'+p.id+'"><option value="admin">админ</option><option value="logist">логист</option><option value="engineer">инженер</option></select></label>'+
      '<div class="staff-save"><button class="btn sm" data-us="'+p.id+'">Сохранить</button></div>';
    box.appendChild(d); d.querySelector('[data-ur]').value=p.role; d.querySelector('[data-manager]').value=org.manager_id||'';
  });
  box.querySelectorAll('[data-us]').forEach(b=>b.onclick=async ()=>{
    const id=b.dataset.us,row=b.closest('.staff-row'),name=row.querySelector('[data-un]').value.trim(),r=row.querySelector('[data-ur]').value;
    const title=row.querySelector('[data-title]').value.trim(),manager=row.querySelector('[data-manager]').value||null;
    if(!name){ notify('Укажи имя сотрудника','warn'); row.querySelector('[data-un]').focus(); return; }
    b.disabled=true;
    const {error}=await sb.rpc('employee_org_save',{p_profile:id,p_full_name:name,p_role:r,p_job_title:title,p_manager:manager});
    b.disabled=false;
    if(error){ notify(error.message,'err'); return; }
    const profile=profilesList.find(x=>x.id===id); if(profile){ profile.full_name=name; profile.role=r; }
    orgByProfile.set(id,{profile_id:id,manager_id:manager,job_title:title}); b.textContent='Сохранено';
    setTimeout(()=>{ if(b.isConnected)b.textContent='Сохранить'; },1200);
    if(id===session.user.id){ role=r; applyTabs(); }
  });
}

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
// Регистрация воркера переехала в index.html отдельным инлайн-скриптом:
// раньше она жила внутри initPush, и у того, кто не включил уведомления,
// воркера не было вовсе — а вместе с ним и кэша оболочки. Инлайн, а не
// здесь, потому что этот файл может и не выполниться (не загрузился
// leaflet, упала строка выше) — а кэш нужен именно в такие моменты.
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
    // Воркер уже зарегистрирован инлайн-скриптом — здесь только дожидаемся.
    swReg=await navigator.serviceWorker.ready.catch(()=>null)
       || await navigator.serviceWorker.register('sw.js');
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
if($('fixCancel')) $('fixCancel').onclick=()=>$('fixOverlay').classList.remove('on');
if($('fixSend')) $('fixSend').onclick=fixSend;

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
let factHByTrip={}, factPresenceRows=[];
let staysModalTripId=null;

async function loadFactHours(){
  try{
    const { data, error }=await sb.from('trip_stays').select('trip_id,stay_from,stay_to,minutes_mgr,minutes_raw,status,job_id,crew_ids,crew_source');
    if(error) throw error;
    factPresenceRows=data||[];
    const m={}; factPresenceRows.forEach(r=>{ (m[r.trip_id]||(m[r.trip_id]=[])).push(r); });
    factHByTrip={}; Object.keys(m).forEach(k=>{const s=presenceSummary(m[k]);if(s.complete)factHByTrip[k]=s.approved;});
  }catch(e){ factHByTrip={};factPresenceRows=[]; loadFail('фактические часы по выездам',e); }
}


function minText(m){ if(m==null) return '—'; const h=Math.floor(m/60), r=Math.round(m-h*60); return h?(h+' ч '+r+' м'):(r+' м'); }

const STAY_ST={detected:'посчитано',engineer_ok:'подтвердил инженер',approved:'утверждено',rejected:'не работа'};

async function openStaysModal(tid){
  if(canWrite()){$('staysOverlay').classList.remove('on');await openTrip(tid);return;}
  staysModalTripId=tid;
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
  let h='<div class="hint" style="margin-bottom: var(--sp-3)">Идёт только в себестоимость. Нормочасы в заявках это не меняет.</div>';

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
      const canAct=mgr&&(s.status==='engineer_ok'||s.status==='detected');
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
if($('staysMap')) $('staysMap').onclick=async()=>{
  if(!staysModalTripId) return;
  $('staysOverlay').classList.remove('on');
  await openStayBindingMap(staysModalTripId);
};

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

// Пересборка снимка экономики по живым данным.
//
// econ_snapshot писался ровно в одном месте — когда менеджер сохранял выезд.
// Ни «Завершить», ни «Подтвердить» его не трогали: это серверные RPC, а снимок
// считается в браузере (turf, факт-часы по стоянкам, факт-километры). Значит
// всё, что инженер вписал ПОСЛЕ последнего сохранения — часы, отметки приезда,
// запчасти, — в сводку не попадало, пока менеджер вручную не пересохранит
// выезд. Сводка показывала план, а выглядела как факт.
//
// Считаем в момент подтверждения: менеджер и так в этот момент смотрит на
// выезд, а после подтверждения цифры уже уходят в отчётность. На «Завершить»
// не считаем намеренно — его жмёт инженер, а UPDATE на trips ему не дан.
//
// Входные данные берём из самой строки выезда, а не со страницы: маршрут,
// ставки-оверрайды и километры по плательщикам там уже лежат.
async function refreshTripEcon(tripId){
  try{
    const {data:t,error}=await sb.from('trips')
      .select('id,econ_snapshot,overrides,road_km_by_payer,route_stops,date_from,date_to,fact_km,tariffs_snapshot,started_at')
      .eq('id',tripId).single();
    if(error||!t) return false;
    const {data:tj,error:e1}=await sb.from('trip_jobs')
      .select('jobs(id,clients(name,lat,lng),equipment(lat,lng),job_works(hours,billable,revenue,tariff_profile),job_parts(qty,price,cost,billable))')
      .eq('trip_id',tripId);
    if(e1) return false;
    const jobs=(tj||[]).map(r=>r.jobs).filter(Boolean);
    // turf нужен только запасному расчёту дороги по прямым — у выездов
    // с готовыми километрами он не понадобится, но ждать дешевле, чем
    // молча посчитать дорогу мимо.
    await ensureTurf().catch(()=>{});
    const es=t.econ_snapshot||{};
    const st=((t.route_stops)||[]).find(x=>x&&x.type==='start');
    const snap=econSnapshot(jobs, +es.km||0, +es.driveH||0, savedTripT(t), t.overrides||{}, {
      roadKm:t.road_km_by_payer||null,
      start:st?{name:st.name,lat:st.lat,lng:st.lng}:null,
      dateFrom:t.date_from, dateTo:t.date_to,
      factKm:t.fact_km, factWorkH:factHByTrip[tripId]??null
    }, jobs.length);
    const {error:e2}=await sb.from('trips').update({econ_snapshot:withLegs(snap,es.legs)}).eq('id',tripId);
    return !e2;
  }catch(e){ console.warn('Пересчёт экономики выезда не прошёл:',e); return false; }
}

// Ручной пересчёт пробега из карточки выезда.
//
// Проверка по дорогам зависит от чужого сервиса, а он бывает недоступен —
// кончилась квота, упал прокси, вернул ошибку на конкретную координату.
// В такой момент часть решений принимается кругом, и результат честно
// помечается словами «судили по кругу». Пересчёт даёт этому вторую попытку.
//
// Считаем ЗАНОВО, с нуля: прошлые достроенные отрезки не подмешиваем, иначе
// повтор наследовал бы ровно те ошибки, ради которых его и запускают.
async function remeasureTrip(tid){
  if(!canWrite()) return;
  const t=trips.find(x=>x.id==tid);
  const wasDone=t&&t.status==='done';
  if(!await confirmDialog(
      wasDone
        ? 'Пересчитать факт-пробег по треку? Выезд уже подтверждён: деньги пересоберутся, а одометр машины менялся в момент подтверждения — сверь его показания вручную.'
        : 'Пересчитать факт-пробег по треку?',
      {okText:'Пересчитать'})) return;
  if(busyOn){ showToast('Уже считаю — подожди'); return; }
  delete lastMeasure[tid];
  if(!await settleFactKm(tid)) return;
  // Цифра в карточке живёт не в памяти, а в базе: пока выезды не
  // перечитаны, человек видит старое число и думает, что пересчёт не
  // засчитался. Поэтому обновление тоже под индикатором.
  try{
    busy('Обновляю карточку…',1);
    if(wasDone) await refreshTripEcon(tid);
    await loadAll();
    if(plannerCur==='mine') renderMine(); else renderTripsView();
    renderTrips();
    if(tripEditId===tid) renderTpFactKm();
  } finally { busyDone(); }
  showToast('Готово');
}

// Сведение факта по выезду. Возвращает false, если закрывать рано:
// человек отказался вписывать одометр, а придумывать число за него мы не
// станем — лучше выезд повисит на проверке, чем в отчёт уедет выдумка.
async function settleFactKm(tid){
  let m;
  try{ busy('Читаю трек…'); m=await measureTripKm(tid); }
  catch(e){ notify('Пробег посчитать не вышло: '+(e.message||e),'err'); m=null; }
  finally{ busyDone(); }

  if(m&&m.ok){
    try{
      busy('Записываю пробег…',1);
      await writeFactKm(tid,m.km,'track',m.note);
      // Разбор — отдельной записью и не фатально: если он не лёг, число
      // всё равно записано, а карта просто пересчитает показ сама.
      try{ if(m.measure) await writeFactTrack(tid,m.measure); }
      catch(e2){ console.warn('Разбор трека не сохранился:',e2); }
    }
    catch(e){ notify('Пробег посчитан, но не записался: '+(e.message||e),'err'); return false; }
    finally{ busyDone(); }
    showToast('Факт: '+m.km+' км по треку'+(m.note?(' · '+m.note):''));
    return true;
  }

  const why=(m&&m.why)||'трек посчитать не удалось';
  const ok=await confirmDialog(
    why+'. Свести пробег по навигации нельзя — впиши два числа с одометра машины.',
    {title:'Трек недостоверен',okText:'Ввести одометр',cancelText:'Отложить'});
  if(!ok) return false;
  const od=await askOdometer();
  if(!od) return false;
  try{
    busy('Записываю пробег…',1);
    await writeFactKm(tid,od.km,'odometer','по одометру '+od.a+' → '+od.b+'; '+why);
    // Разбор сохраняем и здесь, хотя число взято с одометра: именно на
    // недостоверном треке и хочется посмотреть, что алгоритм вырезал и где.
    // Расхождение между его итогом и записанным числом видно в отчёте.
    try{ if(m&&m.measure) await writeFactTrack(tid,m.measure); }
    catch(e2){ console.warn('Разбор трека не сохранился:',e2); }
  }
  catch(e){ notify('Одометр не записался: '+(e.message||e),'err'); return false; }
  finally{ busyDone(); }
  showToast('Факт: '+od.km+' км по одометру');
  return true;
}

async function tripAction(id,kind,engineerName){
  const a=TRIP_ASK[kind];
  const question=engineerName?a.q.replace('выезд?', 'выезд '+engineerName+'?'):a.q;
  if(!await confirmDialog(question,{okText:a.ok})) return;
  // Подтверждение — последняя точка, где пробег ещё можно поправить: сразу
  // после него число уходит в одометр машины и в себестоимость. Поэтому
  // считаем факт ЗДЕСЬ, до RPC, и своими руками.
  if(kind==='confirm'&&canWrite()){
    if(!await settleFactKm(id)) return;
  }
  try{
    const { data, error }=await sb.rpc(TRIP_RPC[kind],{p_trip:id});
    if(error) throw error;
    // Сервер отвечает словом, а не молчанием: не сработало — говорим прямо,
    // а не делаем вид, что всё прошло.
    if(data==='wrong_status'){ notify('Статус уже изменился — обнови страницу.','err'); }
    else if(data==='not_found'){ notify('Выезд не найден.','err'); }
    else showToast(TRIP_SAY[data]||String(data));
    await loadAll(); await loadVehicles(); await loadFactHours();
    // Порядок важен: факт-часы уже перечитаны, значит снимок соберётся
    // с ними, а не с прошлыми.
    if(data==='done'&&canWrite()){
      if(await refreshTripEcon(id)){ await loadAll(); showToast('Экономика выезда пересчитана'); }
      else notify('Выезд подтверждён, но экономику пересчитать не вышло — открой и сохрани его','warn');
    }
    if(plannerCur==='mine') renderMine(); else renderTripsView();
    loadVehState();
    // Детектор отработал внутри trip_finish — показываем сразу, пока инженер
    // ещё помнит день. Через сутки он уже не вспомнит, стоял он у клиента
    // два часа или полтора.
    if(data==='finished') setTimeout(()=>openStaysModal(id),200);
  }catch(e){
    // Нет связи — не теряем действие, а кладём в очередь и сразу двигаем
    // статус в местном снимке: инженер должен видеть, что нажатие
    // засчитано, иначе он нажмёт ещё раз и ещё.
    if(isNetErr(e) && await qPush('trip',{tripId:id,action:kind})){
      await snapTripStatus(id,TRIP_NEXT_STATUS[kind]);
      showToast('Нет связи — отправлю, когда появится');
      if(plannerCur==='mine') renderMine();
      return;
    }
    notify('Ошибка: '+(e.message||e),'err');
  }
}
// Куда переходит выезд по каждому действию. Нужен, чтобы в офлайне
// показать результат до того, как сервер его подтвердит. Сервер остаётся
// последним словом: при отправке guard_trip_status всё равно проверит.
const TRIP_NEXT_STATUS={start:'in_progress',finish:'finished',confirm:'done'};
async function snapTripStatus(id,st){
  if(!st) return;
  const s=await snapGet('mine'); if(!s||!s.val||!s.val.list) return;
  const t=s.val.list.find(x=>x.id===id); if(!t) return;
  t.status=st;
  await snapSet('mine',s.val,s.at);
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
    // Multiple assignees are filtered after loading; legacy lead_engineer remains supported.
    const { data }=await q.order('date_from');
    const list=(data||[]).filter(t=>((t.date_to||t.date_from)>=today || t.date_from<=today)&& (canWrite()||assignedTo(t,session.user.id,'lead_engineer')));
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
// Факт-трек живёт не одним слоем, а пятью: иначе их нельзя включать и
// выключать по отдельности, а именно это и нужно — посмотреть план без
// факта, или факт без выброшенных точек.
const FACT_LAYERS=['track','road','line','live','drop','stay'];
let factG={}; FACT_LAYERS.forEach(k=>{ factG[k]=L.layerGroup().addTo(map); });
// Что показано. Переживает перерисовку: человек выключил выброшенные —
// они не должны вернуться сами при следующем открытии трека.
let factVis={plan:true,track:true,road:true,line:true,live:true,drop:true,stay:true};
let factTripId=null;
let factTrip=null, factRaw=[], factLiveBusy=false;
let stayBindMap=null;

function factClear(){
  FACT_LAYERS.forEach(k=>factG[k].clearLayers());
  factTripId=null; factTrip=null; factRaw=[]; factLast=null;
  try{ renderMapPanel(); }catch(e){}
}

function stayBindIcon(stay,index){
  const attached=stay.status==='approved', selected=stayBindMap&&stayBindMap.selected===stay.id;
  const bg=selected?'var(--accent)':(attached?'#2fbf6e':'#d5342a');
  const fg=selected?'var(--on-accent)':'#fff';
  return L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,14],html:'<div class="cbub" style="width:28px;height:28px;line-height:24px;background:'+bg+';color:'+fg+';border:2px solid '+ringColor()+'">'+(index+1)+'</div>'});
}
function stayJobLabel(j){return (j.clients&&j.clients.name)||((j.equipment&&j.equipment.model)||'заявка');}
function stayBindingPopup(stay,index){
  if(canWrite())return '<div class="trip-stop-popup"><b>Стоянка '+(index+1)+'</b><div class="meta">'+hhmm(stay.stay_from)+' — '+hhmm(stay.stay_to)+' · '+minText(stay.minutes_raw)+'</div><p class="hint">'+(stay.status==='approved'?'Присутствие подтверждено':stay.status==='rejected'?'Не учитывается':'Требует проверки')+'</p><button type="button" class="btn sm amber" data-stay-edit="'+esc(stay.id)+'">Привязка и присутствие</button><button type="button" class="btn sm ghost" data-stay-select="'+esc(stay.id)+'">Выбрать объект на карте</button></div>';

  const jobs=(stayBindMap&&stayBindMap.jobs)||[], current=jobs.find(j=>String(j.id)===String(stay.job_id));
  return '<div class="trip-stop-popup"><b>Стоянка '+(index+1)+'</b><div class="meta">'+hhmm(stay.stay_from)+' — '+hhmm(stay.stay_to)+' · '+minText(stay.minutes_raw)+'</div>'
    +'<div class="hint">'+(current?('Привязана: '+esc(stayJobLabel(current))):'Не привязана к заявке')+'</div>'
    +'<div class="trip-stop-jobs"><button type="button" class="btn sm amber" data-stay-select="'+esc(stay.id)+'">Выбрать точку</button>'
    +jobs.map(j=>'<button type="button" class="btn sm ghost" data-stay-job="'+esc(stay.id)+'" data-job="'+esc(j.id)+'">'+(String(j.id)===String(stay.job_id)?'✓ ':'')+esc(stayJobLabel(j))+'</button>').join('')
    +(stay.job_id?'<button type="button" class="btn sm ghost" data-stay-job="'+esc(stay.id)+'" data-job="">Снять привязку</button>':'')+'</div></div>';
}
function drawStayBindingMap(){
  if(!stayBindMap) return;
  factG.stay.clearLayers();
  const pts=[];
  stayBindMap.stays.forEach((s,i)=>{if(s.lat==null||s.lng==null)return;pts.push([s.lat,s.lng]);factG.stay.addLayer(L.marker([s.lat,s.lng],{icon:stayBindIcon(s,i)}).bindPopup(stayBindingPopup(s,i)));});
  factVis.stay=true;factApplyVis();renderMapPanel();
  if(pts.length)setTimeout(()=>map.fitBounds(pts,fitPadL(fitPad(70))),60);
}
async function attachStayOnMap(stayId,jobId){
  if(!stayBindMap) return;
  if(canWrite()){map.closePopup();return openPresenceEditor(stayBindMap.tid,stayId,jobId);}
  try{
    const {data,error}=await sb.rpc('stay_attach',{p_stay:stayId,p_job:jobId||null});
    if(error) throw error;
    if(data==='foreign_job') throw new Error('Эта заявка не входит в выезд.');
    if(data==='already_approved') throw new Error('Утверждённую стоянку менять нельзя.');
    const s=stayBindMap.stays.find(x=>String(x.id)===String(stayId));if(s)s.job_id=jobId||null;
    stayBindMap.selected=null;if(canWrite())drawStops();else drawTripPlan(factTrip||tripCache[stayBindMap.tid]);drawStayBindingMap();await loadFactHours();showToast(jobId?'Стоянка привязана к заявке':'Привязка снята');
  }catch(e){notify('Не удалось изменить привязку: '+(e.message||e),'err');}
}
async function reloadStayBindingData(tid){
  const {data,error}=await sb.rpc('trip_workbench_read',{p_trip:tid});if(error)throw error;
  stayBindMap={tid,stays:data.stays,jobs:tripJobsAll.filter(j=>data.job_ids.includes(j.id)||data.removed.some(r=>r.job_id===j.id)),selected:null};
  drawStayBindingMap();
}
async function openStayBindingMap(tid){
  const t=getTrip(tid)||tripCache[tid];
  if(t&&t.status!=='finished'&&t.status!=='done'){notify('Привязка факта доступна после завершения выезда.','warn');return;}
  await showTripOnMap(tid);
  if(canWrite()){try{await loadTripJobs();await reloadStayBindingData(tid);}catch(e){notify(e.message,'err');}return;}
  try{
    const [{data:stays,error:se},{data:links,error:je}]=await Promise.all([
      sb.from('trip_stays').select('*').eq('trip_id',tid).order('stay_from'),
      sb.from('trip_jobs').select('job_id,jobs(id,clients(name),equipment(model))').eq('trip_id',tid).order('ord')
    ]);
    if(se)throw se;if(je)throw je;
    stayBindMap={tid,stays:stays||[],jobs:(links||[]).map(x=>x.jobs).filter(Boolean),selected:null};
    drawStayBindingMap();
    showToast(stayBindMap.stays.length?'Выберите красную точку стоянки и заявку':'Стоянок для привязки не найдено');
  }catch(e){notify('Стоянки не загрузились: '+(e.message||e),'err');}
}
// Слой либо на карте, либо нет. Очистка слоя тут не годится: при следующем
// включении рисовать было бы нечего, пришлось бы пересчитывать трек.
function factApplyVis(){
  FACT_LAYERS.forEach(k=>{
    const on=factVis[k];
    if(on&&!map.hasLayer(factG[k])) map.addLayer(factG[k]);
    if(!on&&map.hasLayer(factG[k])) map.removeLayer(factG[k]);
  });
  if(factVis.plan&&!map.hasLayer(routeLayer)) map.addLayer(routeLayer);
  if(!factVis.plan&&map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
}
// Трек рисуется НЕ сырым. Приёмник ошибается тремя разными способами, и
// сплошная линия по всем точкам подряд врёт по-разному в каждом случае:
// телепорт добавляет две длины выброса, дрожание на стоянке — километры
// стоящей машины, а пропажа связи, наоборот, занижает — прямая через
// разрыв короче дороги.
//
// Поэтому: выбросы вырезаем, дрожание не считаем, а разрывы ПОКАЗЫВАЕМ
// как разрывы — отдельной пунктирной линией другого цвета. Дорисовать их
// маршрутом по дорогам можно и нужно, но пока этого не сделано, честнее
// нарисовать «здесь мы не знаем», чем провести прямую и промолчать.
// Цвета факт-трека. Три разных утверждения о выезде — три разных вида:
// что мы видели, что достроили по дорогам и чего не знаем вовсе.
const TRACK_C='#22c55e';   // измерено приёмником
const ROAD_C ='#7c3aed';   // достроено маршрутом по дорогам
const GAP_C  ='#9aa1ad';   // прямая через дыру: где ехали — неизвестно
const LIVE_C ='#38bdf8';   // последняя телеметрия, ещё не попавшая в историю
const DROP_C ='#dc2626';   // выброшено как ошибка приёмника
const STAY_C ='#dc2626';   // стоянка — знак «стоп», он красный

// СКОРОСТЬ ЦВЕТОМ. Один тон, разная светлота: трек остаётся узнаваемо
// «зелёным слоем», а внутри него видно, где машина ползла, а где летела.
// Разные тона тут были бы вторым языком поверх первого — цвет уже занят
// под вид отрезка (видели / достроили / не знаем).
const SPEED_MAX=110;                       // выше — цвет уже не меняется
const SPEED_RAMP=['#a7f3d0','#4ade80','#16a34a','#15803d','#064e3b'];
function segKmh(g){
  if(!g||!g.km) return 0;
  const ms=(g.ms!=null)?g.ms:((g.minutes||0)*60000);
  if(!ms) return 0;
  return g.km/(ms/3600000);
}
function speedColor(kmh){
  const t=Math.max(0,Math.min(1,(kmh||0)/SPEED_MAX));
  const i=Math.min(SPEED_RAMP.length-1,Math.floor(t*(SPEED_RAMP.length-1)+0.5));
  return SPEED_RAMP[i];
}
function atTime(ts){ try{ return new Date(ts).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}); }catch(e){ return '—'; } }
function dhm(ms){
  if(!ms||ms<0) return '—';
  const m=Math.round(ms/60000);
  return m<60?(m+' мин'):(Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин');
}
// Подпись к отрезку: когда, сколько, как быстро. Одинаковая у всех видов,
// чтобы сравнивать их между собой можно было не думая.
function segPopup(g,extra){
  const kmh=segKmh(g);
  return '<b>'+atTime(g.fromTs)+' → '+atTime(g.toTs)+'</b>'
    +'<br>'+g.km.toFixed(2)+' км за '+dhm(g.ms!=null?g.ms:(g.minutes||0)*60000)
    +(kmh?('<br>средняя <b>'+Math.round(kmh)+' км/ч</b>'):'')
    +(extra?('<br>'+extra):'');
}

// ИКОНКИ. Плоские, одноцветные, без обводок и теней — под остальной
// интерфейс. Рисуем разметкой, а не картинками: они должны менять цвет
// вместе с темой и не тянуть за собой файлы.
// Фигуры общие для карты и легенды: образец в подписи обязан быть тем же
// значком, что и на карте, иначе легенда объясняет не то, что видно.
function stopSvg(px){
  return '<svg viewBox="0 0 24 24" width="'+px+'" height="'+px+'" aria-hidden="true">'
    +'<polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" fill="'+STAY_C+'"/></svg>';
}
function dropSvg(px){
  return '<svg viewBox="0 0 24 24" width="'+px+'" height="'+px+'" aria-hidden="true">'
    +'<path d="M5 5 L19 19 M19 5 L5 19" stroke="'+DROP_C+'" stroke-width="4.5" '
    +'stroke-linecap="round" fill="none"/></svg>';
}
function stopIcon(){ return L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:stopSvg(16)}); }
function dropIcon(){ return L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],html:dropSvg(14)}); }

// ПАНЕЛЬ КАРТЫ: легенда, слои, цифры и выход — одно место.
//
// Раньше их было две. Сводка с километражом плана висела сверху по центру,
// легенда факта — снизу справа, и человеку приходилось держать в голове,
// что где: маршрут стирается в одной панели, факт — в другой. При этом обе
// говорят про одну карту и про одни и те же линии.
//
// Теперь строка = слой: образец слева повторяет то, чем слой нарисован,
// флажок его включает, цифра справа говорит, сколько в нём километров.
// Крестик убирает с карты всё сразу.
let factLegend=null, factLegendEl=null;
let factLast=null;

function mapPanelRows(){
  const R=[];
  if(stayBindMap) R.push({key:'stay',icon:stopSvg(13),name:'привязка факта',sub:stayBindMap.selected?'Выбрана стоянка · нажмите точку заявки':'Нажмите стоянку, затем точку заявки'});
  const stops=routeStopsAll().length;
  if(stops||(rRoute&&rRoute.km>0)){
    R.push({key:'plan',style:'border-top:3px dashed var(--ink-faint)',name:'плановый маршрут',
      sub:(rRoute&&rRoute.km>0)
        ? (rRoute.km.toFixed(1)+' км · '+rRoute.driveH.toFixed(1)+' ч · '+stops+' точ.')
        : (stops+' '+plural(stops,'точка','точки','точек')+', маршрут не построен')});
  }
  const d=factLast;
  if(d){
    if(d.trackKm) R.push({key:'track',style:'border-top:4px dotted '+TRACK_C,name:'видели по трекеру',km:d.trackKm});
    if(d.roadKm)  R.push({key:'road', style:'border-top:5px solid '+ROAD_C, name:'посчитано по дорогам',km:d.roadKm});
    if(d.lineKm)  R.push({key:'line', style:'border-top:3px dotted '+GAP_C, name:'прямая, маршрут не строился',km:d.lineKm});
    if(factLiveTail(d)) R.push({key:'live',style:'border-top:3px dashed '+LIVE_C,name:'текущая позиция · ждёт истории'});
    if(d.dropped.length) R.push({key:'drop',icon:dropSvg(13),name:'выброшено точек',val:d.droppedTotal||d.dropped.length});
    if(!stayBindMap) R.push({key:'stay',icon:stopSvg(13),name:'стоянки'});
  }
  return R;
}

function renderMapPanel(){
  const rows=mapPanelRows();
  if(!rows.length){ hideMapPanel(); return; }
  if(!factLegend){
    factLegend=L.control({position:'bottomright'});
    factLegend.onAdd=function(){
      factLegendEl=L.DomUtil.create('div','mleg');
      L.DomEvent.disableClickPropagation(factLegendEl);
      return factLegendEl;
    };
    factLegend.addTo(map);
  }
  if(!factLegendEl) return;
  const bb=factLast?factBounds(factLast):null;
  factLegendEl.innerHTML='<button class="mleg-x" title="Убрать всё с карты">×</button>'
    +(bb?timeFilterHtml(bb):'')
    +rows.map(r=>'<label><input type="checkbox" data-fl="'+r.key+'"'+(factVis[r.key]?' checked':'')+'>'
      +(r.icon?('<span class="mleg-i">'+r.icon+'</span>'):('<i style="'+r.style+'"></i>'))
      +r.name
      +(r.km!=null?(' <b>'+Math.round(r.km)+' км</b>'):'')
      +(r.val!=null?(' <b>'+r.val+'</b>'):'')
      +'</label>'
      +(r.sub?('<div class="mleg-s">'+esc(r.sub)+'</div>'):'')
      +(r.key==='track'?speedScaleHtml():'')).join('')
    +(factLast?('<div class="mleg-t">факт <b>'+Math.round(factLast.km)+'</b> км</div>'):'');
  factLegendEl.querySelectorAll('[data-fl]').forEach(cb=>{
    cb.onchange=()=>{ factVis[cb.dataset.fl]=cb.checked; factApplyVis(); };
  });
  wireTimeFilter(bb);
  const x=factLegendEl.querySelector('.mleg-x');
  if(x) x.onclick=clearMapAll;
}

// Окно времени: два поля ввода, как период на сводке. Ползунки тут были
// хуже: попасть в нужную минуту ими нельзя, а нужна обычно именно она —
// «покажи, что было между девятью и десятью».
//
// Тип поля зависит от выезда. Однодневный — только время: дата в нём одна
// и повторять её в каждом поле незачем. Многодневный — дата со временем,
// иначе «09:30» непонятно какого дня.
const pad2=n=>String(n).padStart(2,'0');
function tfOneDay(bb){ return new Date(bb[0]).toDateString()===new Date(bb[1]).toDateString(); }
function tfValue(t,one){
  const d=new Date(t);
  const hm=pad2(d.getHours())+':'+pad2(d.getMinutes());
  return one?hm:(d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+'T'+hm);
}
function tfParse(v,one,baseT){
  if(!v) return null;
  if(one){
    const m=/^(\d{1,2}):(\d{2})$/.exec(v); if(!m) return null;
    const d=new Date(baseT); d.setHours(+m[1],+m[2],0,0); return +d;
  }
  const t=+new Date(v); return isFinite(t)?t:null;
}
function timeFilterHtml(bb){
  const one=tfOneDay(bb), type=one?'time':'datetime-local';
  return '<div class="mleg-tf">'
    +'<input type="'+type+'" id="tfA" value="'+tfValue(factFrom==null?bb[0]:factFrom,one)+'">'
    +'<span class="mleg-dash">—</span>'
    +'<input type="'+type+'" id="tfB" value="'+tfValue(factTo==null?bb[1]:factTo,one)+'">'
    +'<button type="button" id="tfAll" title="Показать весь выезд">весь</button>'
    +'</div>';
}
function wireTimeFilter(bb){
  if(!bb||!factLegendEl) return;
  const A=factLegendEl.querySelector('#tfA'), B=factLegendEl.querySelector('#tfB');
  const all=factLegendEl.querySelector('#tfAll');
  if(!A||!B) return;
  const one=tfOneDay(bb);
  const apply=()=>{
    let f=tfParse(A.value,one,bb[0]), t=tfParse(B.value,one,bb[1]);
    if(f==null&&t==null){ factFrom=null; factTo=null; }
    else{
      if(f==null) f=bb[0];
      if(t==null) t=bb[1];
      // Перепутанные местами границы — обычная опечатка, а не повод
      // показать пустую карту.
      if(f>t){ const q=f; f=t; t=q; }
      factFrom=f; factTo=t;
    }
    if(factLast) drawFact(factLast);
  };
  A.onchange=apply; B.onchange=apply;
  if(all) all.onclick=()=>{
    factFrom=null; factTo=null;
    A.value=tfValue(bb[0],one); B.value=tfValue(bb[1],one);
    if(factLast) drawFact(factLast);
  };
}

// Шкала скорости под строкой измеренного трека: без неё градиент — просто
// разноцветная линия.
function speedScaleHtml(){
  return '<div class="mleg-sp"><span>0</span>'
    +'<i style="background:linear-gradient(90deg,'+SPEED_RAMP.join(',')+')"></i>'
    +'<span>'+SPEED_MAX+'+ км/ч</span></div>';
}

function hideMapPanel(){
  if(factLegend){ try{ map.removeControl(factLegend); }catch(e){} }
  factLegend=null; factLegendEl=null;
}

// Крестик убирает с карты всё. Факт — просто показ, его не жалко. А вот
// точки планового маршрута это работа, и молча их стирать нельзя: спросим,
// и только если они есть.
async function clearMapAll(){
  const hasRoute=routeStopsAll().length>0;
  if(hasRoute && !await confirmDialog('Убрать с карты факт и плановый маршрут? Точки маршрута будут очищены.',
      {okText:'Убрать всё',cancelText:'Отмена'})) return;
  factClear();
  if(hasRoute && $('rClear')) $('rClear').click();
  renderMapPanel();
  showToast('Карта очищена');
}

// Старое имя оставлено: его зовёт всё, что перерисовывает маршрут.
function updateMapSummary(){ renderMapPanel(); }

function showFactLegend(m){ if(m) factLast=m; renderMapPanel(); }

// Показ выезда на карте: план и факт вместе.
//
// Кнопка «карта» и кнопка «редактировать маршрут» ведут в одно и то же
// место, потому что это одно и то же занятие. Раньше они расходились:
// вторая открывала факт-трек и запирала человека на карте — плановые точки
// в редактор не загружались, закрыть слой было нечем, и выход был один,
// перезагрузить страницу.
// Нарисовать ПЛАН выезда на карте: линия маршрута и его точки.
// Нужен тому, у кого нет планировщика, — инженеру: ему «на карте» должно
// показывать, куда ехать, а не пустую карту.
function drawTripPlan(t){
  tripLayer.clearLayers();
  const stops=(t&&t.route_stops)||[];
  drawRouteLine(tripLayer, t&&t.route_geometry);
  const pts=[];
  stops.forEach((x,i)=>{
    if(x.lat==null||x.lng==null) return;
    pts.push([x.lat,x.lng]);
    const popup=tripStopPopup(x,i);
    L.marker([x.lat,x.lng],{icon:L.divIcon({className:'',
      html:'<div class="cbub" style="background:var(--accent);color:var(--on-accent);'
        +'text-shadow:none;border:2px solid '+ringColor()+'">'+(i+1)+'</div>',
      iconSize:[24,24],iconAnchor:[12,12]})})
      .bindPopup(popup).addTo(tripLayer);
  });
  if(!pts.length&&t&&t.route_geometry&&t.route_geometry.coordinates)
    t.route_geometry.coordinates.forEach(c=>pts.push([c[1],c[0]]));
  if(pts.length) map.fitBounds(pts,fitPadL(fitPad(60)));
  return pts.length>0;
}
async function showTripOnMap(tid){
  stayBindMap=null;
  // Не записываем промежуточный #/map: одна кнопка должна давать одну запись
  // истории, чтобы Back возвращал туда, откуда открыли выезд.
  const wasApplying=routeApplying; routeApplying=true; switchTab('map'); routeApplying=wasApplying;
  // Выезд может быть не в памяти: из сводки список выездов ещё не грузили.
  // Раньше в этом случае «на карте» молча не делала ничего.
  let t=trips.find(x=>x.id==tid)||tripCache[tid]||null;
  if(!t){
    try{ const {data}=await sb.from('trips').select('*').eq('id',tid).maybeSingle();
      if(data){ t=data; tripCache[tid]=data; } }catch(e){}
  }
  if(!t){ notify('Выезд не найден.','warn'); return; }
  tripMapJobs=await loadTripMapJobs(tid);
  // План — в редактор, чтобы точки можно было двигать. Наличие факта этому
  // не мешает: факт про то, как съездили, план про то, как поедут ещё раз.
  const shown=canWrite()?loadTripIntoPlanner(tid,t):drawTripPlan(t);
  // Факт — сверху плана и только если он есть. Отсутствие факта больше не
  // повод показать пустую карту: у запланированного выезда факта нет по
  // определению, а посмотреть маршрут нужно именно до поездки.
  const fact=await showTripFact(tid,{quiet:true,trip:t});
  if(!fact) showToast(shown?'Факта нет — показан плановый маршрут':'У выезда нет ни маршрута, ни трека');
  routeSet('trip/'+encodeURIComponent(tid)+'/map');
}

async function loadTripMapJobs(tid){
  try{
    const {data,error}=await sb.from('trip_jobs')
      .select('ord,job_id,jobs(id,client_id,equipment_id,status,clients(name),equipment(model))')
      .eq('trip_id',tid).order('ord');
    if(error) throw error;
    return (data||[]).map(r=>r.jobs).filter(Boolean);
  }catch(e){
    console.warn('Не удалось загрузить заявки выезда для карты:',e);
    return [];
  }
}
function jobsAtTripStop(stop){
  const cid=String((stop&&stop.clientId)||''), eid=String((stop&&stop.equipId)||'');
  let found=tripMapJobs.filter(j=>(eid&&String(j.equipment_id||'')===eid)||(cid&&String(j.client_id||'')===cid));
  if(found.length) return found;
  // Старые route_stops не содержат идентификаторов. Для них оставляем
  // безопасный fallback по подписи, не назначая заявку случайной точке.
  const name=String((stop&&stop.name)||'').toLocaleLowerCase('ru');
  return tripMapJobs.filter(j=>{
    const client=String((j.clients&&j.clients.name)||'').toLocaleLowerCase('ru');
    const equip=String((j.equipment&&j.equipment.model)||'').toLocaleLowerCase('ru');
    return (client&&name.includes(client))||(equip&&name.includes(equip));
  });
}
function tripStopPopup(stop,index){
  const linked=jobsAtTripStop(stop);
  const selected=stayBindMap&&stayBindMap.selected;
  return '<div class="trip-stop-popup"><b>'+esc((stop&&stop.name)||('точка '+(index+1)))+'</b>'
    +(linked.length?'<div class="trip-stop-jobs">'+linked.map(j=>
      selected
        ? '<button type="button" class="btn sm amber" data-stay-job="'+esc(selected)+'" data-job="'+esc(j.id)+'">Привязать стоянку → '+esc(stayJobLabel(j))+'</button>'
        : '<button type="button" class="btn sm ghost" data-map-job="'+esc(j.id)+'">Открыть заявку'+(linked.length>1?(' · '+esc((j.equipment&&j.equipment.model)||String(j.id).slice(0,8))):'')+'</button>'
    ).join('')+'</div>':'')+'</div>';
}
window.openTripMapJob=function(id){
  if(!id) return;
  try{ map.closePopup(); }catch(e){}
  openJob(id);
};
map.on('popupopen',e=>{
  const el=e.popup&&e.popup.getElement&&e.popup.getElement();
  if(!el) return;
  el.querySelectorAll('[data-map-job]').forEach(b=>b.onclick=ev=>{
    ev.preventDefault(); ev.stopPropagation(); window.openTripMapJob(b.dataset.mapJob);
  });
  el.querySelectorAll('[data-stay-edit]').forEach(b=>b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();map.closePopup();openPresenceEditor(stayBindMap.tid,b.dataset.stayEdit);});
  el.querySelectorAll('[data-stay-select]').forEach(b=>b.onclick=ev=>{
    ev.preventDefault();ev.stopPropagation();if(!stayBindMap)return;stayBindMap.selected=b.dataset.staySelect;map.closePopup();if(canWrite())drawStops();else drawTripPlan(factTrip||tripCache[stayBindMap.tid]);drawStayBindingMap();showToast('Теперь нажмите плановую точку заявки');
  });
  el.querySelectorAll('[data-stay-job]').forEach(b=>b.onclick=ev=>{
    ev.preventDefault();ev.stopPropagation();attachStayOnMap(b.dataset.stayJob,b.dataset.job||null);
  });
});

// Отрисовка факта. Отдельно от загрузки, потому что её зовёт ещё и фильтр
// времени: там данные те же, меняется только окно.
function drawFact(m){
  FACT_LAYERS.forEach(k=>factG[k].clearLayers());
  const [a,b]=factWindow(m);
  const inWin=(from,to)=>{
    const t1=+new Date(from), t2=+new Date(to||from);
    return !(t2<a||t1>b);
  };
  // Тысяча точек не должна превращаться в тысячу Leaflet-слоёв. Для трека
  // склеиваем соседние отрезки одинаковой ступени скорости в одну polyline:
  // цвет скорости остаётся, а DOM/SVG на длинном выезде не разрастается.
  const runs=[]; let run=null;
  const flushRun=()=>{ if(run){ runs.push(run); run=null; } };
  (m.segments||[]).forEach(g=>{
    if(!inWin(g.fromTs,g.toTs)){ flushRun(); return; }
    const ab=[[g.fromPt.lat,g.fromPt.lng],[g.toPt.lat,g.toPt.lng]];
    if(g.kind==='road'){
      flushRun();
      const line=(g.line&&g.line.length>1)?g.line.map(p=>[p[1],p[0]]):ab;
      factG.road.addLayer(L.polyline(line,{color:ROAD_C,weight:5,opacity:.9})
        .bindPopup(segPopup(g,'достроено по дорогам'+(g.why?(' · '+esc(g.why)):''))));
      return;
    }
    if(g.kind==='line'){
      flushRun();
      factG.line.addLayer(L.polyline(ab,{color:GAP_C,weight:3,opacity:.85,dashArray:'2 9'})
        .bindPopup(segPopup(g,esc(g.why||'маршрут не строился')+' — цифра занижена')));
      return;
    }
    const kmh=segKmh(g), color=speedColor(kmh);
    if(!run || run.color!==color || run.toTs!==g.fromTs){
      flushRun();
      run={color,points:ab.slice(),km:g.km,ms:g.ms||0,fromTs:g.fromTs,toTs:g.toTs};
    }else{
      run.points.push(ab[1]); run.km+=g.km; run.ms+=(g.ms||0); run.toTs=g.toTs;
    }
  });
  flushRun();
  runs.forEach(g=>factG.track.addLayer(L.polyline(g.points,{color:g.color,weight:5,opacity:.95,lineCap:'round'})
    .bindPopup(segPopup(g))));
  // Выброшенное показываем, а не прячем: если приёмник врёт постоянно,
  // это видно на карте, и разговор с поставщиком трекера предметный.
  (m.dropped||[]).forEach(p=>{
    if(!inWin(p.ts)) return;
    factG.drop.addLayer(L.marker([p.lat,p.lng],{icon:dropIcon()})
      .bindPopup('<b>'+atTime(p.ts)+'</b><br>отброшено: '+esc(p.why)));
  });
  (m.points||[]).filter(p=>p.status==='idle').forEach(p=>{
    if(!inWin(p.ts)) return;
    factG.stay.addLayer(L.marker([p.lat,p.lng],{icon:stopIcon()})
      .bindPopup('<b>'+atTime(p.ts)+'</b><br>стоянка'));
  });
  // Опоры выезда — старт и финиш, если их пришлось подставить.
  (m.points||[]).filter(p=>p.anchor).forEach(p=>{
    factG.road.addLayer(L.circleMarker([p.lat,p.lng],{radius:7,color:ROAD_C,fillColor:'#fff',fillOpacity:1,weight:3})
      .bindPopup('<b>'+esc(p.anchor)+'</b><br>трек сюда не дошёл, дорога достроена'));
  });
  drawFactLiveTail(m);
  factApplyVis();
}

// Окно времени: [от, до] в миллисекундах. Пусто — весь выезд.
let factFrom=null, factTo=null;
function factBounds(m){
  let a=Infinity,b=-Infinity;
  (m.segments||[]).forEach(g=>{ a=Math.min(a,+new Date(g.fromTs)); b=Math.max(b,+new Date(g.toTs||g.fromTs)); });
  (m.points||[]).forEach(p=>{ a=Math.min(a,+new Date(p.ts)); b=Math.max(b,+new Date(p.ts)); });
  if(!isFinite(a)||!isFinite(b)||b<=a) return null;
  return [a,b];
}
function factWindow(m){
  const bb=factBounds(m); if(!bb) return [-Infinity,Infinity];
  return [factFrom==null?bb[0]:factFrom, factTo==null?bb[1]:factTo];
}

// PostgREST у проекта отдаёт не больше 1000 строк за запрос. У длинного
// рейса первая страница выглядела как «факт застыл на 821 км», хотя точки
// продолжали приходить. Курсор времени грузит весь трек, а затем — только
// хвост после уже увиденной точки.
async function loadTripPositions(tid,afterTs){
  const out=[]; let cursor=afterTs||null;
  for(;;){
    let q=sb.from('vehicle_positions').select('lat,lng,ts,status')
      .eq('trip_id',tid).order('ts',{ascending:true}).limit(1000);
    if(cursor) q=q.gt('ts',cursor);
    const {data,error}=await q; if(error) throw error;
    const page=data||[]; out.push(...page);
    if(page.length<1000) return out;
    cursor=page[page.length-1].ts;
  }
}
function factLiveTail(m){
  if(!factTrip||factTrip.status!=='in_progress'||!factRaw.length) return null;
  const r=vehState.find(x=>x.trip_id===factTripId || x.vehicle_id===factTrip.vehicle_id);
  const last=factRaw[factRaw.length-1];
  if(!r||r.lat==null||r.lng==null||!r.ts||+new Date(r.ts)<=+new Date(last.ts)) return null;
  return {from:last,to:r};
}
function drawFactLiveTail(m){
  factG.live.clearLayers();
  const tail=factLiveTail(m); if(!tail) return;
  factG.live.addLayer(L.polyline([[tail.from.lat,tail.from.lng],[tail.to.lat,tail.to.lng]],
    {color:LIVE_C,weight:4,opacity:.95,dashArray:'8 8',lineCap:'round'})
    .bindPopup('<b>Текущая позиция</b><br>ещё не записана в историю выезда'));
}
async function refreshFactLive(){
  if(factLiveBusy||!factTripId||!factTrip||factTrip.status!=='in_progress'||document.hidden) return;
  factLiveBusy=true;
  try{
    const last=factRaw.length?factRaw[factRaw.length-1].ts:null;
    const fresh=await loadTripPositions(factTripId,last);
    if(fresh.length){
      factRaw.push(...fresh);
      const m=await measureTrip(factRaw,trackOpts(),tripEnds(factTrip),null);
      factLast=m; drawFact(m); showFactLegend(m);
    }else if(factLast) drawFact(factLast); // обновить короткий live-хвост
  }catch(e){ console.warn('Не удалось догрузить факт-трек:',e); }
  finally{ factLiveBusy=false; }
}
async function showTripFact(tid,opt){
  const quiet=!!(opt&&opt.quiet);
  factClear();
  try{
    const raw=(await loadTripPositions(tid)).filter(p=>p.lat!=null&&p.lng!=null);
    if(!raw.length){ setTimeout(()=>map.invalidateSize(),60); if(!quiet) showToast('Фактического трека нет'); return false; }

    // Если выезд только что сводили, показываем ТОТ ЖЕ результат: карта и
    // деньги обязаны быть про одно. Если нет — считаем тем же проходом, но
    // без маршрутизатора: показ трека не должен стоить квоты. Отрезки, для
    // которых маршрут не строился, честно помечены.
    const t=(opt&&opt.trip)||trips.find(x=>x.id==tid)||tripCache[tid]||null;
    // Порядок важен. Свежий разбор этой вкладки — самый верный. Дальше
    // сохранённый: он посчитан с маршрутизатором, и это ровно то, что ушло
    // в деньги. И только если ни того ни другого нет — считаем на месте,
    // без запросов, помечая отрезки как непостроенные.
    // Активный выезд всегда строим из свежего raw: сохранённый разбор — это
    // снимок прошлого и он не должен останавливать live-линию.
    const m=(t&&t.status==='in_progress') ? await measureTrip(raw,trackOpts(),tripEnds(t),null)
      : (lastMeasure[tid]||await readFactTrack(tid)||await measureTrip(raw,trackOpts(),tripEnds(t),null));
    if(!m.segments.length&&!m.points.length){ setTimeout(()=>map.invalidateSize(),60); showToast('Трек есть, но весь состоит из ошибок приёмника'); return; }
    factTripId=tid; factTrip=t; factRaw=raw; factFrom=null; factTo=null;

    drawFact(m);

    // Границы считаем по отрезкам: у сохранённого разбора отдельных точек
    // почти нет, там только опоры и стоянки, и по ним карта уехала бы мимо.
    const bpts=[];
    m.segments.forEach(g=>{ bpts.push([g.fromPt.lat,g.fromPt.lng],[g.toPt.lat,g.toPt.lng]); });
    (m.points||[]).forEach(p=>bpts.push([p.lat,p.lng]));
    if(bpts.length) setTimeout(()=>{ map.invalidateSize(); map.fitBounds(L.polyline(bpts).getBounds(),fitPadL(fitPad(40))); },60);
    showFactLegend(m);
    const bits=['Факт: '+Math.round(m.km)+' км по '+m.points.length+' точкам'];
    if(m.dropped.length) bits.push('вырезано '+(m.droppedTotal||m.dropped.length));
    if(m.jitterKm>=0.5) bits.push('дрожание '+m.jitterKm.toFixed(1)+' км');
    if(m.stored) bits.push('разбор от '+new Date(m.at).toLocaleString('ru'));
    if(t&&t.fact_km!=null) bits.push('записано '+Math.round(t.fact_km)+' км'+factSrcRu(t.fact_km_source));
    showToast(bits.join(' · '));
  }catch(e){ notify('Трек не загрузился: '+(e.message||e),'err'); }
}

// Что показала проверка при сведении выезда. Держим, чтобы карта рисовала
// ровно то, что ушло в деньги, а не пересчитывала по-своему.
let lastMeasure={};

// ---------- откуда берётся факт-пробег ----------
//
// ЧЕМ СПРАШИВАТЬ ПРО ДОРОГИ. Сначала это была изохрона: строим от последней
// достоверной точки область «куда успел бы за Δt» и смотрим, попал ли
// кандидат внутрь. Идея верная, инструмент — нет. У изохрон везде потолок
// около часа (ORS 3600 секунд, у Mapbox и GraphHopper то же), и это не
// жадность бесплатного тарифа: область растёт по площади. А нужен ровно
// обратный случай — сбой на два-три часа, где круг уже бесполезен.
//
// Вопрос был поставлен сложнее, чем нужно. Изохрона отвечает про сотню
// кандидатов сразу; кандидат у нас один. Для одного есть прямой вопрос:
// СКОЛЬКО ЕХАТЬ ПО ДОРОГАМ от a до b. Потолка нет, эндпоинт уже разрешён
// в прокси, ответ строже (время самого быстрого пути — точная нижняя
// граница), и вместе с ним приходит расстояние по дорогам — ровно то,
// которое идёт в пробег вместо хорды.
function makeReach(){
  if(orsKeyMissing()) return null;
  const slack=+appSettings.track_slack>0?+appSettings.track_slack:1.5;
  return async function(a,b,ms){
    try{
      const gj=await orsPost(ORS_DIR,{coordinates:[[a.lng,a.lat],[b.lng,b.lat]]});
      const f=(gj.features||[])[0];
      const sm=(f&&f.properties&&f.properties.summary)||{};
      const sec=+sm.duration, km=(+sm.distance||0)/1000;
      if(!km) return null;
      // ms не задан — это достройка до финиша: там проверять нечего,
      // выезд закончился там, где закончился. Отдаём одно расстояние.
      const ok=(ms==null)||!isFinite(sec)||sec<=(ms/1000)*slack;
      return {ok,km,line:(f.geometry&&f.geometry.coordinates)||null};
    }catch(e){
      // ОТКАЗ МАРШРУТИЗАЦИИ — ДОВОД ПРОТИВ ТОЧКИ, но только если отказал
      // маршрут, а не связь. Кончилась квота, упала сеть, прокси вернул
      // 500 — это ничего не говорит о точке, и на исчерпанной квоте мы бы
      // вырезали весь трек. Такое — «не знаю», решает первый гейт.
      return orsSaysNoRoute(e)?{ok:false,km:0}:null;
    }
  };
}

// ORS кодирует причину в теле ответа. Про саму точку говорят ровно два кода:
// 2009 — маршрут между точками не найден, 2010 — рядом с координатой нет
// дороги. Остальное — про наш запрос (2003, 2012) или про сервис.
function orsSaysNoRoute(e){
  if(!e||e.status==null) return false;
  if(e.status===403||e.status===429||e.status>=500) return false;
  return /"code"\s*:\s*20(09|10)\b/.test(String(e.raw||''));
}

// Откуда выезд начался и где закончился. Стартовая остановка помечена
// типом, финишная — просто последняя остановка маршрута: кнопка «финиш»
// в карточке точки кладёт её в конец списка. Путевые точки без клиента
// опорой быть не могут — у них нет смысла «мы тут были».
function tripEnds(t){
  const stops=(t&&t.route_stops)||[];
  const start=stops.find(x=>x&&x.type==='start'&&x.lat!=null)||null;
  const real=stops.filter(x=>x&&x.lat!=null&&x.type!=='wp'&&x.type!=='start');
  const finish=real.length?real[real.length-1]:null;
  return {
    start:start?{lat:+start.lat,lng:+start.lng,name:start.name||'старт'}:null,
    finish:finish?{lat:+finish.lat,lng:+finish.lng,name:finish.name||'финиш'}:null
  };
}

// Пороги проверки из настроек.
function trackOpts(){
  const o={};
  if(+appSettings.track_max_kmh>0) o.hardSpeedKmh=+appSettings.track_max_kmh;
  if(+appSettings.track_slack>0) o.slack=+appSettings.track_slack;
  return o;
}

// Полный расчёт факта по выезду: один проход по точкам. Он же вырезает
// аномалии, он же меряет километры, он же строит отрезки для карты.
//
// Прошлая версия делала это двумя разными механизмами — проверкой и
// «достройкой разрывов», — и они расходились: карта показывала одно, а
// в деньги уходило другое. Теперь источник один.
async function measureTripKm(tid){
  const raw=(await loadTripPositions(tid)).filter(p=>p.lat!=null&&p.lng!=null);
  if(raw.length<2) return {ok:false,why:'трека нет'};

  const t=trips.find(x=>x.id==tid)||null;
  // Ход прохода наружу: точки идут быстро, а вот запрос к дорогам занимает
  // секунды, и именно на нём кажется, что всё зависло. Поэтому в подписи
  // отдельно видно, сколько маршрутов уже спросили.
  const opts=Object.assign(trackOpts(),{ onStep:(st)=>{
    busy('Считаю пробег: точка '+st.i+' из '+st.total
      +(st.checks?(' · маршрутов: '+st.checks):''), st.total?st.i/st.total:null);
  }});
  const m=await measureTrip(raw,opts,tripEnds(t),makeReach());
  lastMeasure[tid]=m;
  if(m.verdict.indexOf('трек недостоверен')===0){
    const by=Object.keys(m.reasons||{}).map(k=>k+': '+m.reasons[k]).join('; ');
    return {ok:false,why:m.verdict+(by?('. Причины — '+by):''),measure:m};
  }

  const note=[];
  if(m.dropped.length) note.push('вырезано аномалий: '+m.dropped.length
    +' из '+(m.dropped.length+m.points.length)+' точек');
  if(m.roadKm) note.push('по дорогам: '+Math.round(m.roadKm)+' км');
  if(m.lineKm) note.push('прямыми, маршрут не строился: '+Math.round(m.lineKm)+' км');
  if(m.jitterKm>=0.5) note.push('дрожание на стоянке: '+m.jitterKm.toFixed(1)+' км');
  return {ok:true,km:Math.round(m.km*10)/10,note:note.join('; '),measure:m};
}

// Ручной ввод одометра — фолбэк, когда треку верить нельзя. Человек читает
// с панели два числа, разницу считаем мы: складывать в уме на морозе он
// не обязан, а ошибка в этом месте уходит прямо в себестоимость.
async function askOdometer(){
  const v=await promptDialog('Пробег по одометру машины',[
    {key:'a',label:'Одометр на старте выезда, км'},
    {key:'b',label:'Одометр на финише, км'}
  ]);
  if(!v) return null;
  const num=x=>+String(x==null?'':x).replace(',','.').replace(/\s/g,'');
  const a=num(v.a), b=num(v.b);
  if(!isFinite(a)||!isFinite(b)){ notify('Одометр не разобрал: нужны два числа.','err'); return null; }
  if(b<a){ notify('Финиш меньше старта — числа перепутаны местами.','err'); return null; }
  const km=Math.round((b-a)*10)/10;
  if(km<=0){ notify('Разница нулевая — выезд без пробега так не закрывают.','err'); return null; }
  return {km,a,b};
}

// Записываем факт ДО подтверждения: trip_confirm гонит fact_km в одометр
// машины, и если писать после, в одометр уедет чужое число.
async function writeFactKm(tid,km,src,note){
  const {error}=await sb.from('trips').update({
    fact_km:km, fact_km_source:src, fact_km_note:note||null
  }).eq('id',tid);
  if(error) throw error;
}

// РАЗБОР СОХРАНЯЕМ ЦЕЛИКОМ, а не только итог.
//
// Пересчёт вырезает аномалии и достраивает куски по дорогам — и всё это
// жило в памяти вкладки. Обновил страницу: число в карточке осталось, а
// карта пересобралась заново и без маршрутизатора, достроенные отрезки
// превратились обратно в прямые, и километраж на карте разошёлся с
// записанным. Тот самый разрыв «карта про одно, деньги про другое»,
// зашедший с другой стороны.
//
// Линии маршрутов прореживаем: ORS отдаёт их с шагом в единицы метров,
// а на карте разница неразличима. Иначе один выезд с четырьмя достройками
// весит сотни килобайт.
function slimMeasure(m){
  return {
    km:m.km, trackKm:m.trackKm, roadKm:m.roadKm, lineKm:m.lineKm, jitterKm:m.jitterKm,
    checks:m.checks, weakChecks:m.weakChecks, verdict:m.verdict, reasons:m.reasons,
    at:new Date().toISOString(),
    segments:(m.segments||[]).map(g=>({
      kind:g.kind, km:g.km, minutes:g.minutes, why:g.why||null,
      fromTs:g.fromTs, toTs:g.toTs, fromPt:g.fromPt, toPt:g.toPt,
      line:(g.line&&g.line.length>2)?simplifyLine(g.line,0.0002):(g.line||null)
    })),
    // Выброшенные нужны на карте красными кружками. Их может быть много —
    // держим потолок: сотня точек показывает картину, тысяча только весит.
    dropped:(m.dropped||[]).slice(0,200).map(p=>({lat:p.lat,lng:p.lng,ts:p.ts,why:p.why})),
    droppedTotal:(m.dropped||[]).length,
    points:(m.points||[]).filter(p=>p.anchor||p.status==='idle')
      .map(p=>({lat:p.lat,lng:p.lng,ts:p.ts,anchor:p.anchor||null,status:p.status||null}))
  };
}

async function writeFactTrack(tid,m){
  const {error}=await sb.from('trip_tracks')
    .upsert({trip_id:tid,km:m.km,data:slimMeasure(m),updated_at:new Date().toISOString()},
            {onConflict:'trip_id'});
  if(error) throw error;
}

// Читаем сохранённый разбор. Пустой ответ — это не ошибка: у выездов,
// сведённых до появления таблицы, его просто нет.
async function readFactTrack(tid){
  try{
    const {data,error}=await sb.from('trip_tracks').select('data').eq('trip_id',tid).maybeSingle();
    if(error||!data||!data.data) return null;
    const d=data.data;
    return Object.assign({points:[],dropped:[],segments:[]},d,{stored:true});
  }catch(e){ return null; }
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
      .select('vehicle_id,ts,lat,lng,speed,status,lost_since,trip_id,current_depot_id,depot_state,depot_inside_since,depot_outside_since,depot_distance_km');
    if(error) throw error;
    const tracking=await sb.from('trip_tracking_sessions')
      .select('id,trip_id,vehicle_id,state,planned_start_at,actual_started_at,start_source,finish_candidate_at,trip:trips(id,date_from,date_to,status,vehicle_id,vehicle_label,started_at)')
      .in('state',['armed','active','finish_candidate']);
    if(!tracking.error) vehTrackSessions=tracking.data||[];
    // Старые, уже выполнявшиеся при установке tracking-сессий выезды имеют
    // корректный vehicle_state.trip_id, но могут не иметь строки сессии.
    // Подтягиваем их одним batch-запросом: открывать сначала «Диспетчер» ради
    // заполнения глобального массива trips пользователь не обязан.
    const activeIds=[...new Set((data||[]).map(r=>r.trip_id).filter(Boolean))];
    vehActiveTrips={};
    if(activeIds.length){
      const active=await sb.from('trips').select('id,date_from,date_to,status,vehicle_id,vehicle_label,started_at').in('id',activeIds);
      if(!active.error) (active.data||[]).forEach(t=>{ vehActiveTrips[t.id]=t; tripCache[t.id]=t; });
    }
    const prev={}; vehState.forEach(r=>prev[r.vehicle_id]={lat:r.lat,lng:r.lng});
    vehState=(data||[]).map(r=>{ const o=prev[r.vehicle_id];
      const bear=(o && (o.lat!==r.lat || o.lng!==r.lng)) ? vehBearing(o,r) : (vehMk[r.vehicle_id]||{}).__bear;
      return Object.assign({},r,{__bear:bear}); });
    renderVehState();
    // Счётчик и раскрытый список машин у депо должны обновляться тем же
    // пульсом, что и маркеры, а не только после перезагрузки справочника.
    if(mapScope!=='work'&&$('list')) renderList();
    // Открытый факт живёт тем же 30-секундным пульсом, что и маркер машины:
    // догружаем только новые исторические точки и соединяем коротким
    // пунктиром последнюю подтверждённую с текущей телеметрией.
    refreshFactLive();
    // Открытая модалка должна ехать вместе с картой, а не застывать на
    // цифрах момента открытия — иначе она врёт тем убедительнее, чем дольше висит.
    if(vehModalId && $('vehOverlay') && $('vehOverlay').classList.contains('on')) showVehModal(vehModalId);
  }catch(e){ /* нет патча/прав — просто не рисуем машины */ }
}



// Машина на карте. Была эмодзи 🚚: на каждой платформе своя, цвет чужой,
// на тёмной теме светится, размер не подчиняется. Теперь плоский силуэт
// разметкой — красится токенами вместе с остальным интерфейсом, состояние
// («едет», «молчит») задаётся цветом, а не подбором картинки.
const VEH_SVG='<svg viewBox="0 0 34 20" width="30" height="18" aria-hidden="true">'
  +'<path d="M1 3.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5V14H1z"/>'
  +'<path d="M18 6.5h5.6a2 2 0 0 1 1.5.7l3.4 3.9a2 2 0 0 1 .5 1.3V14H18z"/>'
  +'<circle class="w" cx="8" cy="14.6" r="3.2"/><circle class="w" cx="24" cy="14.6" r="3.2"/>'
  +'<circle class="h" cx="8" cy="14.6" r="1.3"/><circle class="h" cx="24" cy="14.6" r="1.3"/>'
  +'</svg>';

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
      html:'<div class="veh-mk '+cls+'">'+rot+'<div class="veh-ico">'+VEH_SVG+'</div><div class="veh-lbl '+cls+'">'+esc(vehLabel(v))+'</div></div>'});
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
  const depot=clients.find(c=>String(c.id)===String(r.current_depot_id));
  if(depot){
    const depotText=r.depot_state==='inside'?'в депо':r.depot_state==='outside_candidate'
      ? 'вне зоны '+Math.max(0,Math.floor((Date.now()-new Date(r.depot_outside_since||r.ts))/60000))+' мин':'вне депо';
    h+=vehRow('Депо',dimv(esc(depot.name)+' · '+depotText));
  } else h+=vehRow('Депо','<span style="color:var(--ink-faint)">не определено</span>');
  h+=vehRow('Одометр',Math.round(+v.odometer||0)+' км'+(canWrite()?' <button class="btn sm ghost" id="vehOdometer">изменить</button>':''));

  // Связь и занятие — разные строки. Машина у клиента с заглушенным мотором
  // стоит И молчит одновременно; склеив это в одну строку, соврём про оба.
  h+=vehRow('Связь', r.lost_since
      ? '<span style="color:var(--red)">потеряна с '+(()=>{ const L=new Date(r.lost_since);
          return (todayISO(L)===todayISO()?'':pad(L.getDate())+'.'+pad(L.getMonth()+1)+' ')
            +pad(L.getHours())+':'+pad(L.getMinutes()); })()+'</span>'
      : (age>VEH_STALE_MIN ? '<span style="color:var(--ink-dim)">сообщений нет</span>' : '<span style="color:var(--green)">есть</span>'));

  const tracking=vehTrackSessions.find(x=>x.vehicle_id===vid&&['armed','active','finish_candidate'].includes(x.state));
  // После автоматического старта vehicle_state.trip_id может обновиться лишь
  // со следующим пакетом телеметрии. Сессия уже является достоверным
  // источником связи, а вложенный trip позволяет показать статус даже если
  // пользователь ещё не открывал список выездов и глобальный trips пуст.
  const linkedTripId=(tracking&&tracking.trip_id)||r.trip_id||null;
  const trip=(tracking&&tracking.trip)||vehActiveTrips[linkedTripId]
    ||((trips||[]).find(t=>String(t.id)===String(linkedTripId))||tripCache[linkedTripId]||null);
  h+='<div class="meta" style="margin: var(--sp-3) 0 var(--sp-1)">Выезд</div>';
  if(trip){
    h+=vehRow('Дата', esc(trip.date_from||'—')+(trip.date_to&&trip.date_to!==trip.date_from?(' — '+esc(trip.date_to)):''));
    const trackingStatus=tracking&&tracking.state==='finish_candidate'?'ожидает завершения'
      : tracking&&tracking.state==='armed'?'ожидает старта'
      : (ST_TRIP[trip.status]||trip.status||'—');
    h+=vehRow('Статус', esc(trackingStatus));
    h+='<div class="hint" style="margin-top: var(--sp-2)">'+(tracking&&tracking.state==='armed'
      ?'Телеметрия сохраняется во временный трек до старта выезда.'
      :'Активный выезд найден · трек пишется в историю.')+'</div>';
  } else {
    // Не молчим об этом: без активного выезда история не пишется, и это
    // штатно. Иначе потом ищешь трек, которого никогда не было.
    h+='<div class="hint" style="margin-top: var(--sp-1)">Активного выезда нет — трек в историю не пишется. Поставь выезду статус «в работе».</div>';
  }
  if(tracking&&tracking.state==='armed'){
    h+='<div class="vm-stale" style="margin-top:var(--sp-3)">Трекинг подготовлен с '+esc(new Date(tracking.planned_start_at).toLocaleString('ru'))+'. Ожидаем кнопку «Начать» или подтверждённый выход из депо.</div>'
      +'<div class="row" style="margin-top:var(--sp-3);flex-wrap:wrap"><button class="btn sm amber" id="vehTrackStart">Начать выезд</button>'
      +(canWrite()?'<button class="btn sm" id="vehTrackMove">Другой выезд</button><button class="btn sm ghost" id="vehTrackCancel">Отменить трек</button>':'')+'</div>';
  } else if(tracking&&tracking.state==='finish_candidate'){
    h+='<div class="vm-stale" style="margin-top:var(--sp-3)">Машина не менее '+esc(String(appSettings.depot_outside_minutes||60))+' мин находится в депо. Можно завершить выезд.</div><button class="btn sm amber" id="vehTrackFinish" style="margin-top:var(--sp-3)">Завершить выезд</button>';
  }

  h+='<div class="meta" style="margin: var(--sp-3) 0 var(--sp-1)">Координаты</div>';
  h+='<div class="veh-kv"><span style="font-family:var(--mono);font-size: var(--fs-2)">'+(+r.lat).toFixed(5)+', '+(+r.lng).toFixed(5)+'</span>'+
     '<span><button class="btn sm ghost" id="vehCopy">копировать</button></span></div>';

  $('vehBody').innerHTML=h;
  const cp=$('vehCopy'); if(cp) cp.onclick=()=>{ const t=(+r.lat).toFixed(6)+', '+(+r.lng).toFixed(6);
    try{ navigator.clipboard.writeText(t); }catch(e){} showToast('Координаты: '+t); };
  const odo=$('vehOdometer'); if(odo) odo.onclick=async ()=>{
    const x=await promptDialog('Показание одометра',[{key:'value',label:'Пробег, км',value:String(v.odometer||0)},{key:'note',label:'Комментарий (необязательно)'}]);
    if(!x) return; const value=+String(x.value||'').replace(',','.');
    if(!isFinite(value)||value<0){ notify('Укажи корректный пробег.','warn'); return; }
    const {error}=await sb.rpc('vehicle_odometer_set',{p_vehicle:v.id,p_value:value,p_note:(x.note||'').trim()||null});
    if(error){ notify(error.message,'err'); return; }
    await loadVehicles(); showVehModal(v.id); showToast('Одометр обновлён');
  };
  const start=$('vehTrackStart'); if(start) start.onclick=()=>tripAction(tracking.trip_id,'start');
  const finish=$('vehTrackFinish'); if(finish) finish.onclick=()=>tripAction(tracking.trip_id,'finish');
  const cancel=$('vehTrackCancel'); if(cancel) cancel.onclick=async ()=>{
    if(!await confirmDialog('Отменить подготовленный трек? Телеметрия останется в журнале, но отвяжется от выезда.',{danger:true,okText:'Отменить трек'})) return;
    const {error}=await sb.rpc('trip_tracking_cancel',{p_trip:tracking.trip_id}); if(error){ notify(error.message,'err'); return; }
    await loadAll(); await loadVehState(); showVehModal(v.id); showToast('Трек отменён');
  };
  const move=$('vehTrackMove'); if(move) move.onclick=async ()=>{
    const options=(trips||[]).filter(t=>t.id!==tracking.trip_id&&t.vehicle_id===vid&&['planned','assigned'].includes(t.status))
      .map(t=>({value:t.id,label:tripPeriod(t.date_from,t.date_to)+' · '+(t.vehicle_label||v.name)}));
    if(!options.length){ notify('Нет другого ожидающего выезда этой машины.','warn'); return; }
    const x=await promptDialog('Переназначить трек',[{key:'trip',label:'Выезд',type:'select',options}]); if(!x) return;
    const {data,error}=await sb.rpc('trip_tracking_reassign',{p_from:tracking.trip_id,p_to:x.trip});
    if(error){ notify(error.message,'err'); return; }
    await loadAll(); await loadVehState(); showVehModal(v.id);
    showToast(data==='reassigned_future'?'Трек переназначен; будущие точки начнут новый буфер':'Трек переназначен и обрезан по старту');
  };
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
let rStops=[], rLegStops=[], rStart=null, rRoute={km:0,driveH:0,geometry:null,legs:[]}, rVariants=[], rVarSel=0, bufferKm=0, isoMin=0, places=[], plannerTripId=null, plannerTripRevision=0, pendingLinkClient=null, baseMode='start', baseAfter=null, endDeclined=false, rBusy=false;
async function loadPlaces(){ places=clients.filter(c=>c.is_base); }
function routeStopsAll(){ return (rStart?[{type:'start',name:rStart.name,lat:rStart.lat,lng:rStart.lng,description:rStart.description||''}]:[]).concat(rStops); }
function routeHasClient(cid){ return rStops.some(s=>s.clientId===cid); }
function resetBuilt(){ rRoute={km:0,driveH:0,geometry:null,legs:[]}; rVariants=[]; $('rVariants').innerHTML=''; $('rStatus').textContent='маршрут не построен'; bufferLayer.clearLayers(); $('rCorridor').innerHTML=''; endDeclined=false; drawStops(); }
function pushClientStop(c){ rStops.push({type:'client',name:c.name,lat:c.lat,lng:c.lng,clientId:c.id}); }
window.addBaseStop=function(id){ const c=clients.find(x=>x.id==id); if(!c||!canWrite()) return; map.closePopup(); switchTab('map'); rStops.push({type:'place',name:c.name,lat:c.lat,lng:c.lng,placeId:c.id,description:c.description||''}); showRouteTab(); renderRoutePanel(); resetBuilt(); };
window.addClientToRoute=function(cid){ const c=clients.find(x=>x.id==cid); if(!c||!canWrite()) return; map.closePopup(); switchTab('map'); pushClientStop(c); showRouteTab(); renderRoutePanel(); resetBuilt(); maybePromptJob(cid); };
window.addEquipToRoute=function(cid,eid){ const c=clients.find(x=>x.id==cid); const e=(eqByClient[cid]||[]).find(x=>x.id==eid); if(!c||!e||!canWrite()) return; map.closePopup(); switchTab('map');
  const lat=(e.lat!=null)?e.lat:c.lat, lng=(e.lng!=null)?e.lng:c.lng; rStops.push({type:'equip',name:c.name+' · '+(e.model||''),lat,lng,clientId:c.id,equipId:e.id}); showRouteTab(); renderRoutePanel(); resetBuilt(); maybePromptJob(c.id); };
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
  set('rSaveTrip', built,          !built);
  // Оптимизатору нужно, что переставлять: на двух точках порядок один.
  const co=$('chipOpt'); if(co) co.disabled=!enough;
}

function drawStops(){ routeLayer.clearLayers(); const stops=routeStopsAll();
  drawRouteLine(routeLayer, rRoute.geometry);
  stops.forEach((s,i)=>{ const ic=L.divIcon({className:'',html:'<div style="background:var(--accent);color:var(--on-accent);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font:600 11px var(--mono);border:2.5px solid '+ringColor()+';pointer-events:none">'+(i+1)+'</div>',iconSize:[20,20],iconAnchor:[10,10]});
    const marker=L.marker([s.lat,s.lng],{icon:ic,interactive:true}).addTo(routeLayer);
    if(plannerTripId) marker.bindPopup(tripStopPopup(s,i));
  }); updateMapSummary(); updateRouteActions(); }
// Карточка точки маршрута.
//
// Отдельных полей «старт» и «финиш» над списком больше нет: они дублировали
// то, что и так стоит в списке по порядку, и заставляли держать в голове
// две картины одного маршрута. Роль теперь просто чип в своей строке, а
// сменить точку можно там же.
//
// Стрелки видны всегда. Раньше их прятало общее правило «действия только у
// выбранной карточки» — оно писалось для справочника на восемьдесят строк,
// а в маршруте их четыре, выделения нет вовсе, и порядок оказался
// неизменяемым: кнопки были в разметке, но добраться до них было нельзя.
function routePtCard(tag,s,idx,num,movable,role){
  const d=document.createElement('div');
  d.className='pt route-pt'+(role?(' role-'+role):'');
  if(movable){ d.dataset.ri=idx; d.setAttribute('draggable','true'); }
  const acts=movable
    ? '<button class="btn sm ghost" data-rup="'+idx+'" title="Выше">↑</button>'
     +'<button class="btn sm ghost" data-rdn="'+idx+'" title="Ниже">↓</button>'
     +(role==='finish'?'<button class="btn sm ghost" data-ep="end">сменить</button>':'')
     +'<button class="btn sm ghost" data-rrm="'+idx+'" title="Убрать">×</button>'
    : '<button class="btn sm ghost" data-ep="start">сменить</button>'
     +'<button class="btn sm ghost" data-brm="'+idx+'" title="Убрать">×</button>';
  d.innerHTML='<span class="rp-num">'+num+'</span>'
    +'<div class="nm">'+esc(s.name||'точка')+' <span class="pill">'+esc(tag)+'</span></div>'
    +(s.description?'<div class="ds">'+esc(s.description)+'</div>':'')
    +'<div class="meta">'+(+s.lat).toFixed(4)+', '+(+s.lng).toFixed(4)+'</div>'
    +'<div class="acts">'+acts+'</div>';
  return d;
}
function renderRoutePanel(){ $('rCount').textContent=routeStopsAll().length; const box=$('rStops'); box.innerHTML='';
  if(!rStart && !rStops.length){ box.innerHTML='<div class="hint">Точек нет. Добавь точку на карте, по адресу, из существующих или через «+ маршрут» в попапах.</div>'; drawStops(); return; }
  let n=0;
  // Старт стоит первым и не перетаскивается: он не «одна из точек», а
  // начало отсчёта. Финиш — последняя остановка-депо, её кнопка «сменить»
  // заменяет прежнее отдельное поле.
  const lastIdx=rStops.length-1;
  const finIdx=(rStops.length&&rStops[lastIdx].type==='place')?lastIdx:-1;
  if(rStart){ n++; box.appendChild(routePtCard('старт',rStart,-1,n,false,'start')); }
  rStops.forEach((s,i)=>{ n++;
    const tag=(i===finIdx)?'финиш':(s.type==='place'?'депо':(s.type==='wp'?'пром.':(s.type==='equip'?'техника':'клиент')));
    box.appendChild(routePtCard(tag,s,i,n,true,i===finIdx?'finish':null)); });
  box.querySelectorAll('[data-rup]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); rMove(+b.dataset.rup,-1); });
  box.querySelectorAll('[data-rdn]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); rMove(+b.dataset.rdn,1); });
  box.querySelectorAll('[data-rrm]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); rStops.splice(+b.dataset.rrm,1); renderRoutePanel(); resetBuilt(); });
  box.querySelectorAll('[data-brm]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); rStart=null; renderRoutePanel(); resetBuilt(); });
  box.querySelectorAll('[data-ep]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openBasePicker(b.dataset.ep,()=>{}); });
  wireRouteDrag(box);
  drawStops(); }

// Перетаскивание точек мышью — тем же приёмом, что карточки в диспетчере.
// Стрелки при этом остаются: на телефоне перетаскивания по стандарту
// браузера нет вовсе, и без них порядок снова стал бы неизменяемым.
function wireRouteDrag(box){
  let from=null;
  const clear=()=>box.querySelectorAll('.route-pt').forEach(c=>c.classList.remove('drag-over','drag-under','dragging'));
  box.querySelectorAll('.route-pt[draggable=true]').forEach(card=>{
    card.addEventListener('dragstart',e=>{ from=+card.dataset.ri; card.classList.add('dragging');
      try{ e.dataTransfer.setData('text/plain',String(from)); e.dataTransfer.effectAllowed='move'; }catch(err){} });
    card.addEventListener('dragend',clear);
    card.addEventListener('dragover',e=>{
      if(from==null) return;
      e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(err){}
      // Половина карточки решает, встанет точка до неё или после: без этого
      // непонятно, куда именно упадёт, и порядок приходится угадывать.
      const r=card.getBoundingClientRect(), up=(e.clientY-r.top)<r.height/2;
      card.classList.toggle('drag-over',up); card.classList.toggle('drag-under',!up);
    });
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over','drag-under'));
    card.addEventListener('drop',e=>{
      e.preventDefault();
      const to=+card.dataset.ri, r=card.getBoundingClientRect();
      const up=(e.clientY-r.top)<r.height/2;
      clear();
      if(from==null||isNaN(to)) return;
      let dest=up?to:to+1;
      if(from<dest) dest--;
      if(dest===from){ from=null; return; }
      const it=rStops.splice(from,1)[0];
      rStops.splice(Math.max(0,Math.min(rStops.length,dest)),0,it);
      from=null;
      renderRoutePanel(); resetBuilt();
    });
  });
}
function rMove(i,dir){ const j=i+dir; if(j<0||j>=rStops.length) return; const t=rStops[i]; rStops[i]=rStops[j]; rStops[j]=t; renderRoutePanel(); resetBuilt(); }
$('rWpMode').onclick=()=>{ wpModeOn=!wpModeOn; $('rWpMode').classList.toggle('active',wpModeOn); $('rWpHint').style.display=wpModeOn?'block':'none'; if(wpModeOn&&addModeOn) toggleAdd(false); map.getContainer().style.cursor=wpModeOn?'crosshair':''; };
// ---------- параметры построения ----------
//
// Три чипа под кнопкой «Построить». «Объезды» и «Коридор» открывают свои
// списки — одновременно не бывает, второй закрывает первый: панель узкая,
// и два раскрытых блока выталкивают саму кнопку за экран.
// «Оптимизировать» — залипающий: он не открывает ничего, а меняет то,
// что сделает «Построить». Раньше это была отдельная кнопка
// «Оптимизировать и построить», то есть второй способ запустить то же
// самое — и человек каждый раз выбирал между двумя кнопками вместо того,
// чтобы выбрать порядок точек.
let optOn=false;
function rParam(name){
  const bodies={avoid:'avoidBody',cor:'corBody'};
  const open=(name&&$(bodies[name])&&$(bodies[name]).style.display==='none')?name:null;
  Object.keys(bodies).forEach(k=>{ const b=$(bodies[k]); if(b) b.style.display=(k===open)?'':'none'; });
  const ca=$('chipAvoid'), cc=$('chipCor');
  if(ca) ca.classList.toggle('on',open==='avoid');
  if(cc) cc.classList.toggle('on',open==='cor');
  if(open==='avoid') renderAvoidList();
  // Уходя с объездов — гасим постановку: иначе следующий клик по карте
  // поставит кирпич из закрытого блока.
  if(open!=='avoid'&&avoidModeOn) toggleAvoid(false);
}
if($('chipAvoid')) $('chipAvoid').onclick=()=>rParam('avoid');
if($('chipCor')) $('chipCor').onclick=()=>rParam('cor');
if($('chipOpt')) $('chipOpt').onclick=()=>{
  optOn=!optOn;
  $('chipOpt').classList.toggle('on',optOn);
  $('chipOpt').setAttribute('aria-pressed',optOn?'true':'false');
  $('rStatus').textContent=optOn
    ? 'Порядок точек подберёт оптимизатор при построении.'
    : 'Порядок точек — как в списке.';
};
$('rWpAdd').onclick=async ()=>{ const q=$('rWp').value.trim(); const box=$('rWpRes'); if(!q) return; box.innerHTML='<div class="hint">Ищу…</div>';
  try{ const data=await geoSearch(q,5); if(!data.length){ box.innerHTML='<div class="hint">Не найдено.</div>'; return; } box.innerHTML='';
    data.forEach(it=>{ const d=document.createElement('div'); d.className='pt'; d.style.cursor='pointer'; d.innerHTML='<div class="nm" style="font-size: var(--fs-3);font-weight:500">'+esc(it.display_name)+'</div>'; d.onclick=()=>{ rStops.push({type:'wp',name:it.display_name.split(',')[0],lat:+it.lat,lng:+it.lon}); $('rWp').value=''; box.innerHTML=''; renderRoutePanel(); resetBuilt(); }; box.appendChild(d); }); }catch(e){ box.innerHTML='<div class="err">'+esc(e.message||'Ошибка геокодера.')+'</div>'; } };
$('rClear').onclick=()=>{ rStops=[]; rStart=null; plannerTripId=null; endDeclined=false; $('rBuf').value=0; bufferKm=0; $('rBufVal').textContent='0 км'; $('rIso').value=0; isoMin=0; $('rIsoVal').textContent='0 мин'; tripLayer.clearLayers(); renderRoutePanel(); resetBuilt(); };
function openBasePicker(mode,after){ baseMode=mode; baseAfter=after||null; $('baseTitle').textContent=(mode==='start'?'Старт — депо':'Финиш — депо'); $('baseSub').textContent=(mode==='start'?'Выбери депо старта или создай новое. «Не нужно» — стартом станет первая точка маршрута.':'Выбери депо для финиша или откажись.'); renderBaseList(); $('baseNew').value=''; $('baseNewRes').innerHTML=''; $('baseOverlay').classList.add('on'); }
function renderBaseList(){ const box=$('baseList'); box.innerHTML=places.length?'':'<div class="hint">Депо пока нет. Создай новое ниже.</div>';
  places.forEach(p=>{ const d=document.createElement('div'); d.className='pt'; const cars=depotCars(p.id).filter(x=>x.depot_state==='inside');
    const names=cars.map(r=>{ const v=vehicles.find(x=>x.id===r.vehicle_id); return v?(v.name+(v.plate?' · '+v.plate:'')):'Машина'; });
    d.innerHTML='<div style="display:flex;gap: var(--sp-3);align-items:center"><span class="grow" style="cursor:pointer" data-bpick="'+p.id+'"><b>'+esc(p.name)+'</b>'+(p.description?'<div class="hint" style="margin: 0">'+esc(p.description)+'</div>':'')+'<div class="hint" style="margin: var(--sp-1) 0 0">'+cars.length+' '+plural(cars.length,'машина','машины','машин')+(names.length?' · '+esc(names.join(', ')):'')+'</div></span><button class="btn sm ghost" data-bedit="'+p.id+'">ред.</button></div>'; box.appendChild(d); });
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
$('rBuild').onclick=()=>{ const stops=routeStopsAll(); if(stops.length<2){ $('rStatus').textContent='Нужно минимум 2 точки.'; return; } if(orsKeyMissing()){ orsMissing($('rStatus')); return; }
  // Одна кнопка на два пути: с включённым чипом она сперва подбирает
  // порядок, потом строит (optimizeOrder сам вызывает doBuildRoute).
  if(optOn) optimizeOrder(); else doBuildRoute(); };
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
    rBusy=true; $('rBuild').disabled=true;
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
  $('rStatus').textContent='Оптимизирую порядок…'; rBusy=true; $('rBuild').disabled=true;
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
    r=await requestRouteProxy(px,loadCfg().url,tok,{path,body}); }
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
// ── Плечи маршрута ──────────────────────────────────────────────────────
//
// ORS отдаёт их сам: в ответе на ОДИН запрос с несколькими точками лежит
// properties.segments — по отрезку на каждую пару соседних точек, с
// расстоянием и временем. Отдельных запросов это не стоит ни одного.
//
// Плечи нужны графику: чтобы разложить выезд по дням, мало общего времени
// дороги — надо знать, сколько ехать ДО точки и сколько обратно. Общее
// время делится пополам только у выезда в одну точку; у выезда депо → А →
// Б → депо половина — это выдумка.
// Плечи кладутся в снимок расчёта: там уже лежат общий километраж и общее
// время дороги, и плечи — их разбивка. Отдельная колонка потребовала бы
// миграции ради того же самого.
function withLegs(e,legs){ return Object.assign({},e,{legs:(legs||[]).map(l=>({km:+(+l.km).toFixed(2),h:+(+l.h).toFixed(3),a:l.a||'',b:l.b||''}))}); }
function legsOf(f){
  // Маршрут, собранный из участков, кладёт готовые плечи сам: там дроблёное
  // плечо — это несколько segments, а плечо графику нужно одно, между точками.
  const own=(f&&f.properties&&f.properties.dlLegs)||null;
  if(own&&own.length) return own.map(l=>({km:+l.km||0,h:+l.h||0}));
  const segs=(f&&f.properties&&f.properties.segments)||null;
  if(segs&&segs.length) return segs.map(g=>({km:(+g.distance||0)/1000,h:(+g.duration||0)/3600}));
  const sm=(f&&f.properties&&f.properties.summary)||null;
  return sm?[{km:(+sm.distance||0)/1000,h:(+sm.duration||0)/3600}]:[];
}
function sumLeg(f){ const sm=(f&&f.properties&&f.properties.summary)||{}; return {km:(+sm.distance||0)/1000,h:(+sm.duration||0)/3600}; }
// Плечо привязывается к точкам, а не к порядковому номеру: между построением
// и сохранением список точек может измениться (совпадающие подряд отбрасываются
// при построении), и график, читающий плечи по индексу, свяжет дорогу не с той
// заявкой. Ключ точки — координаты с той же точностью, что и везде в проекте.
function ptKey(p){ return p&&p.lat!=null&&p.lng!=null?((+p.lat).toFixed(5)+','+(+p.lng).toFixed(5)):''; }
function pairLegs(legs,stops){ return (legs||[]).map((l,i)=>Object.assign({},l,{a:ptKey(stops&&stops[i]),b:ptKey(stops&&stops[i+1])})); }
function mergeFeatures(fs){ let line=[],dist=0,dur=0,segs=[];
  fs.forEach((f,i)=>{ const sm=(f.properties&&f.properties.summary)||{}; dist+=(+sm.distance||0); dur+=(+sm.duration||0);
    // Склейка идёт по плечам, а не по итогам: маршрут, построенный
    // по участкам (когда объезды не влезли в один запрос), обязан
    // отдать те же плечи, что и построенный целиком.
    const ss=(f.properties&&f.properties.segments)||null;
    if(ss&&ss.length) segs=segs.concat(ss); else segs.push({distance:+sm.distance||0,duration:+sm.duration||0});
    const c=(f.geometry&&f.geometry.coordinates)||[]; line=line.concat(i?c.slice(1):c); });
  return {type:'Feature',properties:{summary:{distance:dist,duration:dur},segments:segs},geometry:{type:'LineString',coordinates:line}}; }
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
  rBusy=true; $('rBuild').disabled=true; $('rStatus').textContent='Считаю…';
  const pref=$('rPref').value; const coords=stops.map(s=>[s.lng,s.lat]); const ap=avoidPolygons(); rLegStops=stops;
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
    const merged=mergeFeatures(legs); merged.properties.dlLegs=legs.map(sumLeg);
    rVariants=[merged]; rVarSel=0; applyRVariant(); renderRVariants();
    if(skipped.length) $('rStatus').innerHTML+='<div class="hint" style="color:var(--red);margin-top: var(--sp-2)">Объезды не применены: '+esc(skipped.join(' · '))+'</div>';
    else $('rStatus').innerHTML+='<span class="hint" style="margin: 0"> · по участкам</span>';
  }catch(e){ $('rStatus').innerHTML='<span class="err">Ошибка: '+esc(e.message||e)+'</span>'; } finally{ rBusy=false; updateRouteActions(); } }
function applyRVariant(){ const f=rVariants[rVarSel]; if(!f) return; const sum=(f.properties&&f.properties.summary)||{}; rRoute={km:(+sum.distance||0)/1000,driveH:(+sum.duration||0)/3600,geometry:f.geometry,legs:pairLegs(legsOf(f),rLegStops)}; $('rStatus').innerHTML='<span class="ok">'+rRoute.km.toFixed(1)+' км · '+rRoute.driveH.toFixed(1)+' ч</span>'+((appSettings.avoid_zones||[]).length?('<span class="hint" style="margin: 0"> · объезды: '+appSettings.avoid_zones.length+'</span>'):''); drawStops(); rBuildBuffer(); }
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
async function seedTaskForRoute(jobId){const {data,error}=await sb.rpc('service_order_seed_task',{p_job:jobId});if(error)throw error;return data;}
$('rSaveTrip').onclick=async ()=>{ const stops=routeStopsAll(); if(stops.length<2){ notify('Нужно минимум 2 точки.','warn'); return; }
  const clientIds=[...new Set(rStops.filter(s=>s.clientId).map(s=>s.clientId))];
  let linked=[]; if(clientIds.length){ try{ const {data}=await sb.from('jobs').select('id, client_id, clients(name,lat,lng), equipment(lat,lng), job_works(hours,billable,revenue,tariff_profile), job_parts(qty,price,cost,billable)').is('deleted_at',null).in('client_id',clientIds).not('status','in','(done,cancelled)'); linked=data||[]; }catch(e){} }
  const exist=plannerTripId?(trips.find(x=>x.id==plannerTripId)||{}):{};let selectedOrderIds=[];
  let planReason='Создание маршрута';
  if(plannerTripId){
    const answer=await promptDialog('Изменение маршрута',[{key:'reason',label:'Причина изменения'}]);if(!answer?.reason?.trim())return;planReason=answer.reason.trim();
    const {data:members,error}=await sb.from('trip_jobs').select('job_id').eq('trip_id',plannerTripId);if(error){notify(error.message,'err');return;}
    const {data:taskLinks,error:linkError}=await sb.from('trip_service_orders').select('order_id').eq('trip_id',plannerTripId);if(linkError){notify(linkError.message,'err');return;}selectedOrderIds=(taskLinks||[]).map(x=>x.order_id);
    await loadTripJobs();const ids=new Set((members||[]).map(x=>x.job_id));
    // Route geometry does not decide job membership. Excluded jobs stay excluded.
    linked=tripJobsAll.filter(j=>ids.has(j.id));
  }
  try{if(!selectedOrderIds.length)for(const j of linked)selectedOrderIds.push(await seedTaskForRoute(j.id));}
  catch(e){notify('Не удалось подготовить задания маршрута: '+(e.message||e),'err');return;}
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
  const T=savedTripT(exist);
  const e=econSnapshot(linked,rRoute.km,rRoute.driveH,T,ov,{
    roadKm:roadKm, start:rStart,
    dateFrom:exist.date_from||null, dateTo:exist.date_to||null,
    factKm:exist.fact_km!=null?exist.fact_km:null,
    factWorkH:plannerTripId?(factHByTrip[plannerTripId]!=null?factHByTrip[plannerTripId]:null):null
  },linked.length);

  const rec={route_stops:stops.map(s=>({type:s.type,name:s.name,lat:s.lat,lng:s.lng,clientId:s.clientId||null,equipId:s.equipId||null,description:s.description||''})),route_geometry:slimGeometry(rRoute.geometry)||null,road_km_by_payer:roadKm,overrides:ov,econ_snapshot:withLegs(e,rRoute.legs),tariffs_snapshot:T};
  let tid=plannerTripId;
  try{ const {data,error}=await sb.rpc('trip_plan_save_tasks',{p_trip:tid,p_expected:tid?plannerTripRevision:0,p_plan:{...rec,remaining_route:null},p_order_ids:selectedOrderIds,p_reason:planReason});if(error)throw error;tid=data;plannerTripId=tid;
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
  h+=head('Заявки · работы и запчасти');
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
        +row('Выручка'+(p.partsRevenue?' <span class="edim">работы '+money0(p.workRevenue)+' + запчасти '+money0(p.partsRevenue)+'</span>':''),
             money0(p.revenue)+' '+cur)
        +row('Себестоимость труда', costTxt+' '+cur)
        // Закупка стоит отдельной строкой и только когда она есть: пустая
        // строка «запчасти 0» на каждой заявке была бы шумом.
        +(p.partsCost?row('Закупка запчастей <span class="edim">'+p.partsCount+' поз.</span>', money0(p.partsCost)+' '+cur):'')
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
  h+=row('Выручка'+(d.rParts?' <span class="edim">в т.ч. запчасти '+money0(d.rParts)+'</span>':''),
         '<b>'+money0(d.rev)+' '+cur+'</b>'+(d.revOv?' <span class="edim">(вручную)</span>':''));
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
  h+=row('Затраты <span class="edim">труд '+laborTxt+' · '+kmTxt
         +(d.cParts?' · запчасти '+money0(d.cParts):'')+'</span>',
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
  const d={geoPlan:null,geoFact:null,factSegs:null};
  // План: геометрия маршрута, как её вернул роутер.
  const g=t.route_geometry;
  if(g&&g.coordinates&&g.coordinates.length) d.geoPlan=g.coordinates.map(c=>[c[1],c[0]]);
  else {
    // Маршрут не строили — рисуем хотя бы ломаную по остановкам.
    const st=(t.route_stops||[]).filter(x=>x&&x.lat!=null&&x.lng!=null);
    if(st.length>1) d.geoPlan=st.map(x=>[+x.lat,+x.lng]);
  }
  // Факт: ИСПРАВЛЕННЫЙ трек, а не сырые точки. Раньше сюда шла выгрузка как
  // есть, и врезка показывала ту самую белиберду с телепортами, ради
  // которой всё и затевалось: на большой карте аномалии вырезаны, а в
  // карточке выезда они по-прежнему торчали.
  //
  // Считаем тем же проходом и без маршрутизатора: врезка рисуется при
  // каждом открытии выезда, и платить за неё запросами нельзя. Если выезд
  // только что сводили, берём готовый результат.
  try{
    const raw=(await loadTripPositions(t.id)).filter(r=>r.lat!=null&&r.lng!=null);
    if(raw.length>1){
      const m=lastMeasure[t.id]||await readFactTrack(t.id)
        ||await measureTrip(raw,trackOpts(),tripEnds(t),null);
      // Отрезками, а не одной ломаной: достроенный по дорогам кусок имеет
      // свою геометрию, и прямая через него соврала бы.
      d.factSegs=m.segments.map(g=>(g.kind==='road'&&g.line&&g.line.length>1)
        ? g.line.map(c=>[c[1],c[0]])
        : [[g.fromPt.lat,g.fromPt.lng],[g.toPt.lat,g.toPt.lng]]);
      if(!d.factSegs.length&&m.points.length>1) d.factSegs=[m.points.map(p=>[p.lat,p.lng])];
    }
  }catch(e){}
  if(!d.geoPlan&&!(d.factSegs&&d.factSegs.length)) return;
  // Врезка — не самостоятельная карта, а превью: по ней хочется ткнуть и
  // увидеть то же самое в полный размер. Открывает она ровно то же, что
  // кнопка рядом, — план в редакторе и факт поверх.
  drawEconMap(d,'tpMap',()=>{ if(tripEditId) showTripOnMap(tripEditId); });
}

// Мини-карта: плановый маршрут пунктиром, реально пройденный — сплошным.
// Факт приходит отрезками (d.factSegs), потому что достроенный по дорогам
// кусок имеет свою геометрию. Одна ломаная (d.geoFact) осталась для врезки
// экономики, где отрезков нет.
function drawEconMap(d, mapId, onOpen){
  mapId=mapId||'econMap';
  const wrap=$(mapId+'Wrap'); if(!wrap) return;
  const hasPlan=d.geoPlan&&d.geoPlan.length;
  const segs=(d.factSegs&&d.factSegs.length)?d.factSegs:((d.geoFact&&d.geoFact.length)?[d.geoFact]:[]);
  const hasFact=segs.length;
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
    // Подложка — та же, что на главной карте, включая выбранный стиль:
    // если человек смотрит спутник, врезка не должна показывать схему.
    const mb=makeBase(baseKey())||makeBase('map-'+(theme.mode==='dark'?'dark':'light'));
    if(mb) mb.addTo(m);
    const layers=[];
    if(hasPlan) layers.push(L.polyline(d.geoPlan,{color:'#9aa1ad',weight:3,dashArray:'6,6',opacity:.9}).addTo(m));
    segs.forEach(seg=>{ if(seg&&seg.length>1) layers.push(L.polyline(seg,{color:'#ffe100',weight:3,opacity:.95}).addTo(m)); });
    const g=L.featureGroup(layers); m.fitBounds(g.getBounds(),{padding:[16,16]});
    // Превью не таскают и не зумят: любое движение внутри — это попытка
    // рассмотреть, а рассматривать надо на большой карте. Поэтому всю
    // возню отключаем, а клик уводит туда.
    if(onOpen){
      ['dragging','scrollWheelZoom','doubleClickZoom','boxZoom','keyboard','touchZoom','tap']
        .forEach(k=>{ try{ m[k]&&m[k].disable&&m[k].disable(); }catch(e){} });
      // Клик вешаем на сам элемент, а не через карту: так он сработает,
      // даже если карта не поднялась, и не задвоится с обработчиком Leaflet.
      const cont=$(mapId);
      if(cont){ cont.style.cursor='pointer'; cont.onclick=onOpen; }
      const w=$(mapId+'Wrap');
      if(w&&!w.querySelector('.emap-open')){
        const tag=document.createElement('div');
        tag.className='emap-open'; tag.textContent='открыть на карте';
        w.appendChild(tag);
      }
    }
    setTimeout(()=>{ try{ m.invalidateSize(); }catch(e){} },60);
  }catch(e){ wrap.style.display='none'; }
}
if($('tpJobsRoute')) $('tpJobsRoute').onchange=renderTripJobs;
// [сборка] showTripEcon удалён вместе с окном экономики: страница выезда
// показывает ту же разбивку врезкой, а карту план/факт — в карточке маршрута.


// ---------- из чего собрана эта версия ----------
//
// Файлы ходят между нами по одному, кладутся в репозиторий по одному, и рано
// или поздно один остаётся не заменённым. Ошибка получается тихая: код новый,
// модуль ядра старый, поведение не сходится ни с одной из версий, и на её
// поиск уходит вечер. Отпечаток по содержимому закрывает этот класс ошибок
// целиком — соврать он не может и обновляться руками не просит.
//
// Второй половиной сверяется база. Схему я не вижу и увидеть не могу: SQL
// выполняется вручную, и пропущенный файл миграции даёт ту же тихую ошибку
// с другой стороны. Поэтому здесь же проверяется, на месте ли то, чего
// приложение ждёт от базы. Проверка идёт при ОТКРЫТИИ окна, а не при
// загрузке: это диагностика, и платить за неё запросами на каждом входе
// незачем.
// Если штампа нет, значит сборка шла со старым vite.config.js — говорим это
// словами, а не прочерком: прочерк человек читает как «ещё не загрузилось».
const BUILD = (typeof __DL_BUILD__ !== 'undefined')
  ? __DL_BUILD__
  : { id: 'без штампа', at: null, parts: [], nostamp: true };

// Что приложение ждёт от базы. Столбец или таблица, которых нет, роняют
// не себя, а весь запрос целиком — так и пропала бы вся страница настроек,
// если бы sql/24 не был применён.
const SCHEMA_MARKS = [
  { sql: 'sql/16', table: 'job_visits', col: 'id',            what: 'отметки приезда' },
  { sql: 'sql/17', table: 'job_parts',  col: 'id',            what: 'запчасти' },
  { sql: 'sql/23', table: 'trips',      col: 'fact_km_source', what: 'источник факт-пробега' },
  { sql: 'sql/24', table: 'settings',   col: 'track_slack',    what: 'пороги проверки трека' },
  { sql: 'migration/multi-engineer', table: 'jobs', col: 'engineer_ids', what: 'несколько инженеров' },
  // Разбор факт-трека пишется в отдельную таблицу и падает молча (console.warn):
  // без этой строки слепок сборки говорил «всё есть», а карта после
  // перезагрузки продолжала рисовать прямые вместо дорог.
  { sql: 'sql/25', table: 'trip_tracks', col: 'trip_id',        what: 'сохранённый разбор трека' },
  { sql: 'sql/26', table: 'job_parts',   col: 'approved_at',    what: 'подтверждение внесённого' },
  { sql: 'sql/26', table: 'job_change_requests', col: 'id',     what: 'предложения правок' },
  // Ручная расстановка этапов в ганте: без колонки перетаскивание молча
  // не сохранялось бы — этап возвращался бы на автоместо после обновления.
  { sql: 'sql/27', table: 'trips',      col: 'day_plan',       what: 'ручная расстановка' },
  { sql: 'sql/27', table: 'settings',   col: 'day_start',      what: 'начало смены' },
  { sql: '20260911', table: 'vehicle_state', col: 'current_depot_id', what: 'текущее депо машины' },
  { sql: '20260911', table: 'trip_tracking_sessions', col: 'planned_start_at', what: 'ожидание автоматического старта' },
  { sql: '20260911', table: 'vehicle_odometer_log', col: 'value_km', what: 'история ручного одометра' }
];

async function checkSchema(){
  const out=[];
  for(const m of SCHEMA_MARKS){
    try{
      const {error}=await sb.from(m.table).select(m.col).limit(1);
      // Отказ по правам — это не «нет столбца». Инженеру половина таблиц
      // не видна, и записывать это в непринятые миграции было бы враньём.
      const code=(error&&error.code)||'';
      if(!error) out.push({...m, state:'есть'});
      else if(code==='42501'||/permission|denied/i.test(error.message||'')) out.push({...m, state:'не видно (права)'});
      else out.push({...m, state:'НЕТ', err:(error.message||'').slice(0,80)});
    }catch(e){ out.push({...m, state:'не проверено'}); }
  }
  return out;
}

function verText(schema){
  const L=['DLIGHT · сборка '+BUILD.id+(BUILD.at?(' от '+new Date(BUILD.at).toLocaleString('ru')):'')];
  BUILD.parts.forEach(p=>L.push('  '+p.hash+'  '+String(p.lines).padStart(5)+'  '+p.name));
  if(schema) { L.push('база:'); schema.forEach(m=>L.push('  '+m.sql+'  '+m.state+'  '+m.what)); }
  return L.join('\n');
}

let verSchema=null;
async function openVersion(){
  $('verOverlay').classList.add('on');
  const box=$('verBody');
  const rows=BUILD.parts.map(p=>'<tr><td class="h">'+esc(p.hash)+'</td><td>'+esc(p.name)
    +'</td><td class="n">'+p.lines+'</td></tr>').join('');
  box.innerHTML='<div class="meta" style="margin-bottom: var(--sp-3)">Отпечаток сборки <b style="color:var(--ink)">'+esc(BUILD.id)+'</b>'
    +(BUILD.at?(' · '+esc(new Date(BUILD.at).toLocaleString('ru'))):'')+'</div>'
    +'<table class="vt">'+rows+'</table>'
    +'<div class="meta" style="margin: var(--sp-4) 0 var(--sp-2)">База данных</div>'
    +'<div id="verSchema" class="hint">проверяю…</div>';
  if(!sb){ $('verSchema').textContent='нет подключения'; return; }
  verSchema=await checkSchema();
  const bad=verSchema.filter(m=>m.state==='НЕТ');
  $('verSchema').innerHTML='<table class="vt">'+verSchema.map(m=>{
    const c=m.state==='НЕТ'?'var(--red)':(m.state==='есть'?'var(--green)':'var(--ink-faint)');
    return '<tr><td class="h">'+esc(m.sql)+'</td><td>'+esc(m.what)+'</td><td class="n" style="color:'+c+'">'+esc(m.state)+'</td></tr>';
  }).join('')+'</table>'
    +(bad.length?('<div class="err" style="margin-top: var(--sp-3)">Не применено файлов: '+bad.length
      +'. Пока они не выполнены, приложение работает не полностью.</div>'):'');
}

// Рисуем при открытии настроек, а не один раз на старте: так метка не
// зависит от того, в каком порядке сошлись разметка и скрипт. Прочерк на
// месте версии как раз и означал, что они разошлись — новый index.html
// при старом app.js. Ровно тот случай, ради которого всё это и заведено.
function renderVersionLine(){
  const el=$('verId'); if(!el) return;
  el.textContent=BUILD.id+(BUILD.nostamp?' (соберите с новым vite.config.js)':'');
}
renderVersionLine();
if($('verBtn')) $('verBtn').onclick=openVersion;
if($('verClose')) $('verClose').onclick=()=>$('verOverlay').classList.remove('on');
if($('verCopy')) $('verCopy').onclick=async()=>{
  try{ await navigator.clipboard.writeText(verText(verSchema)); showToast('Скопировано'); }
  catch(e){ notify('Скопировать не вышло — выдели текст руками','warn'); }
};

// ---------- boot ----------
(async function boot(){ const c=loadCfg(); if(!c.url||!c.key){ $('cfgOverlay').classList.add('on'); return; }
  try{ sb=window.supabase.createClient(c.url,c.key); }catch(e){ $('cfgOverlay').classList.add('on'); return; }
  watchAuth();
  const { data:{ session:s } }=await sb.auth.getSession(); if(s){ await onSignedIn(); } else { $('authOverlay').classList.add('on'); } })();
