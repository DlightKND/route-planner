// Стенд: выполняет код приложения с заглушками браузерных API.
// Ловит падения на этапе загрузки — то есть ровно тот класс ошибок,
// когда страница открывается пустой.
//
// ВАЖНО про историю. Прежняя версия искала только ИНЛАЙН-скрипты:
//   /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/
// Это было верно, пока приложение жило одним куском внутри index.html.
// После перехода на Vite оно уехало в <script type="module" src="assets/...">,
// регексп перестал его находить, извлекалось 0 символов — и vm послушно
// выполнял пустую строку. Смоук в CI горел зелёным и не проверял НИЧЕГО.
//
// Теперь стенд берёт и инлайн-скрипты, и локальные файлы по src=,
// а если кода не нашлось вовсе — падает вместо того, чтобы притвориться.

const fs = require('fs'), vm = require('vm'), path = require('path');
const htmlPath = process.argv[2];
if (!htmlPath) { console.log('использование: node tests/smoke.cjs dist/index.html'); process.exit(1); }
const html = fs.readFileSync(htmlPath, 'utf8');
const baseDir = path.dirname(htmlPath);

const parts = [];

// 1. Инлайн-скрипты.
for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  if (m[1].trim()) parts.push({ what: 'инлайн', code: m[1] });
}

// 2. Локальные файлы по src=. Внешние (http/https) пропускаем: это CDN,
//    их заглушают объекты песочницы ниже.
for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/g)) {
  const src = m[1];
  if (/^https?:\/\//i.test(src)) continue;
  const file = path.resolve(baseDir, src.replace(/^\.?\//, ''));
  if (!fs.existsSync(file)) { console.log('ПАДЕНИЕ: не найден файл скрипта ' + src); process.exit(1); }
  parts.push({ what: src, code: fs.readFileSync(file, 'utf8') });
}

if (!parts.length) {
  console.log('ПАДЕНИЕ: в ' + htmlPath + ' не найдено ни одного скрипта для проверки.');
  console.log('  Стенду нечего выполнять — значит он ничего и не проверяет.');
  process.exit(1);
}

const el = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === 'style') return {};
    if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
    if (k === 'dataset') return {};
    if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
    if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
    if (k === 'querySelector') return () => el();
    if (k === 'appendChild' || k === 'addEventListener' || k === 'removeChild'
        || k === 'remove' || k === 'focus' || k === 'click' || k === 'setAttribute') return () => {};
    if (k === 'contentWindow') return { focus(){}, print(){} };
    return el();
  },
  set() { return true; }, apply() { return el(); }
});

const doc = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
  createElement: () => el(), body: el(), documentElement: el(), addEventListener(){}, head: el(), title: '' };
const store = {};
const ls = { getItem: k => (k in store ? store[k] : null),
             setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const L = new Proxy(function () {}, { get: () => L, apply: () => L, construct: () => L });

const sandbox = {
  document: doc, localStorage: ls,
  navigator: { userAgent: 'node', clipboard: { writeText(){} }, standalone: false,
               serviceWorker: { register: () => Promise.resolve({}) } },
  location: { search: '', hash: '', href: '', reload(){} },
  L, turf: L, ExcelJS: L, supabase: L,
  Notification: { permission: 'default' },
  fetch: () => Promise.resolve({ ok: false, status: 0,
    text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
  setTimeout: () => 0, setInterval: () => 0, clearTimeout(){}, clearInterval(){},
  requestAnimationFrame: () => 0,
  console: { log(){}, warn(){}, error(){}, info(){} },
  Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL(){} },
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  matchMedia: () => ({ matches: false, addEventListener(){} }),
  // window.addEventListener — приложение вешает на него перехватчик ошибок
  // в первых же строках. Прежний стенд этого не замечал: он не выполнял код.
  addEventListener(){}, removeEventListener(){},
  // Vite-полифил модульного препролоада трогает MutationObserver.
  MutationObserver: function () { return { observe(){}, disconnect(){} }; },
  Uint8Array, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean,
  Error, RegExp, Map, Set, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
process.on('unhandledRejection', () => {});

vm.createContext(sandbox);
let total = 0;
for (const p of parts) {
  total += p.code.length;
  try {
    vm.runInContext(p.code, sandbox, { timeout: 8000, filename: p.what });
  } catch (e) {
    console.log('ПАДЕНИЕ ПРИ ЗАГРУЗКЕ (' + p.what + '):\n  ' + e.message);
    const st = (e.stack || '').split('\n').slice(1, 4).join('\n');
    if (st) console.log(st);
    process.exit(1);
  }
}
console.log('ЗАГРУЗКА ПРОШЛА: выполнено ' + parts.length
  + ' скрипт(ов), ' + total + ' символов — ' + parts.map(p => p.what).join(', '));
