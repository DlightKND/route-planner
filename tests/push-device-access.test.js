import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
it('offers device notifications to a signed-in engineer without opening admin settings',async()=>{
  const win=new Window();
  try{
    win.document.body.innerHTML=html;
    const $=id=>win.document.getElementById(id),initPush=vi.fn();
    const start=source.indexOf('if($(\'pushBtn\'))'),end=source.indexOf('// Регистрация воркера',start);
    const tabStart=source.indexOf('function tabAllowed('),tabEnd=source.indexOf('// Пункт «Мой день»',tabStart);
    const bind=new Function('$','session','document','initPush','role','canWrite',source.slice(start,end)+source.slice(tabStart,tabEnd)+';return tabAllowed;');
    const tabAllowed=bind($,{user:{id:'curator'}},win.document,initPush,'engineer',()=>false);
    expect(tabAllowed('settings')).toBe(false);
    expect($('pushOverlay').closest('.tab')).toBeNull();
    expect($('pushBtn').dataset.tab).toBeUndefined();
    $('pushBtn').click();
    expect($('pushOverlay').classList.contains('on')).toBe(true);
    expect(initPush).toHaveBeenCalledOnce();
    win.document.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape'}));
    expect($('pushOverlay').classList.contains('on')).toBe(false);
    expect(win.document.activeElement).toBe($('pushBtn'));
    bind($,null,win.document,initPush,'engineer',()=>false);
    $('pushBtn').click();
    expect($('pushOverlay').classList.contains('on')).toBe(false);
    expect(initPush).toHaveBeenCalledOnce();
  }finally{await win.happyDOM.close();}
});
it('explains the HTTPS requirement instead of offering an unusable subscription button',async()=>{
  const win=new Window({url:'http://qa.test/'});
  try{
    win.document.body.innerHTML='<div id="pushState"></div><div id="pushHelp"></div><button id="pushOn"></button>';
    const start=source.indexOf('async function initPush(){'),end=source.indexOf('\nfunction setPushUI(',start);
    const init=new Function('$','navigator','window','isIOS','isStandalone','let pushBusy=false;'+source.slice(start,end)+';return initPush;')
      (id=>win.document.getElementById(id),{}, {isSecureContext:false},()=>false,()=>false);
    await init();
    expect(win.document.getElementById('pushState').textContent).toContain('HTTPS');
    expect(win.document.getElementById('pushOn').style.display).toBe('none');
  }finally{await win.happyDOM.close();}
});

it('starts permission on click, reports the pending stage and bounds a stalled push service',async()=>{
  vi.useFakeTimers();
  const win=new Window();
  try{
    win.document.body.innerHTML=html;
    const $=id=>win.document.getElementById(id);
    const subscribe=vi.fn(()=>new Promise(()=>{}));
    const reg={active:{},pushManager:{subscribe}};
    const register=vi.fn(async()=>reg),permission=vi.fn(async()=> 'granted');
    const start=source.indexOf('let pushBusy=false;'),end=source.indexOf('async function initPush(){',start);
    const onStart=source.indexOf("if($('pushOn')) $('pushOn').onclick=async ()=>{"),onEnd=source.indexOf("\nif($('pushOff'))",onStart);
    new Function('$','navigator','Notification','b64ToU8','VAPID_PUBLIC','sendSub','setPushUI','showToast',
      'let swReg=null;'+source.slice(start,end)+source.slice(onStart,onEnd))
      ($,{serviceWorker:{register,ready:new Promise(()=>{})}},{requestPermission:permission},()=>new Uint8Array(65),'public',vi.fn(),vi.fn(),vi.fn());
    const result=$('pushOn').onclick();
    expect(permission).toHaveBeenCalledOnce();
    expect($('pushOn').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribe).toHaveBeenCalledOnce();
    expect($('pushState').textContent).toContain('Создаём подписку');
    await vi.advanceTimersByTimeAsync(30000);
    await result;
    expect($('pushErr').textContent).toContain('Подписка браузера');
    expect($('pushErr').textContent).toContain('браузер не ответил');
    expect($('pushOn').disabled).toBe(false);
  }finally{vi.useRealTimers();await win.happyDOM.close();}
});
