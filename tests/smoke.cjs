// Стенд: выполняет инлайн-скрипт приложения с заглушками браузерных API.
// Ловит падения на этапе загрузки — то есть ровно тот класс ошибок,
// когда страница открывается пустой.
const fs=require('fs'), vm=require('vm'), path=process.argv[2];
const html=fs.readFileSync(path,'utf8');
const code=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');

const el=()=>new Proxy(function(){},{
  get(t,k){ if(k==='style') return {}; if(k==='classList') return {add(){},remove(){},toggle(){},contains(){return false}};
    if(k==='dataset') return {}; if(k==='value'||k==='textContent'||k==='innerHTML') return '';
    if(k==='querySelectorAll'||k==='getElementsByClassName') return ()=>[];
    if(k==='querySelector') return ()=>el();
    if(k==='appendChild'||k==='addEventListener'||k==='removeChild'||k==='remove'||k==='focus'||k==='click'||k==='setAttribute') return ()=>{};
    if(k==='contentWindow') return {focus(){},print(){}};
    return el(); },
  set(){ return true; }, apply(){ return el(); }
});
const doc={ getElementById:()=>el(), querySelector:()=>el(), querySelectorAll:()=>[],
  createElement:()=>el(), body:el(), documentElement:el(), addEventListener(){}, head:el(), title:'' };
const store={}; 
const ls={ getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
const L=new Proxy(function(){},{ get:()=>L, apply:()=>L, construct:()=>L });
const sandbox={ document:doc, localStorage:ls, navigator:{userAgent:'node',clipboard:{writeText(){}},standalone:false,serviceWorker:{register:()=>Promise.resolve({})}},
  location:{search:'',hash:'',href:'',reload(){}}, L, turf:L, ExcelJS:L, Notification:{permission:'default'},
  fetch:()=>Promise.resolve({ok:false,status:0,text:()=>Promise.resolve(''),json:()=>Promise.resolve({})}),
  setTimeout:(f)=>0, setInterval:()=>0, clearTimeout(){}, clearInterval(){}, requestAnimationFrame:()=>0,
  console:{log(){},warn(){},error(){}}, Blob:function(){}, URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  atob:s=>Buffer.from(s,'base64').toString('binary'), btoa:s=>Buffer.from(s,'binary').toString('base64'),
  matchMedia:()=>({matches:false,addEventListener(){}}) };
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
process.on('unhandledRejection',()=>{});
try{ vm.createContext(sandbox); vm.runInContext(code,sandbox,{timeout:8000});
  console.log('ЗАГРУЗКА ПРОШЛА: скрипт выполнился до конца');
}catch(e){ console.log('ПАДЕНИЕ ПРИ ЗАГРУЗКЕ:\n  '+e.message);
  const st=(e.stack||'').split('\n').slice(1,4).join('\n'); if(st) console.log(st); process.exit(1); }
