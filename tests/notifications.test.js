import {it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {createNotifications,notificationRowsHTML,notificationRoute} from '../src/notifications.js';
const uuid='10000000-0000-4000-8000-000000000001';
const sample=(id,recipient_id='me',read_at=null)=>({id,recipient_id,read_at,entity_kind:'trip',entity_id:uuid,title:'Личное событие',body:'Текст события',created_at:'2026-10-05T09:00:00Z',search_text:'Личное событие Текст события'});
function setup(){
  const win=new Window();win.document.body.innerHTML='<div id="host"></div><b id="badge"></b>';
  let user='me',rows=[sample('event:a'),sample('event:b','other'),sample('push:c','me','2026-10-04T10:00Z')],failWrite=false,deferred=null;
  const queries=[];
  const db={from:vi.fn(()=>{let own=[...rows],head=false;const filters=[];const b={select:(s,o)=>{head=!!o?.head;return b;},eq:(k,v)=>{filters.push([k,v]);own=own.filter(n=>n[k]===v);return b;},is:(k,v)=>{own=own.filter(n=>n[k]===v);return b;},order:()=>b,ilike:(k,v)=>{own=own.filter(n=>n[k].includes(v.slice(1,-1)));return b;},range:(a,z)=>{own=own.slice(a,z+1);return b;},then:(resolve,reject)=>{queries.push(filters);if(!head&&deferred){const p=deferred;deferred=null;return p.then(resolve,reject);}return Promise.resolve({data:head?null:own.map(n=>({...n})),count:own.length,error:null}).then(resolve,reject);}};return b;}),rpc:vi.fn(async(name,args)=>{if(failWrite)return {error:{message:'Нет связи'}};if(name==='notification_set_read'){const r=rows.find(n=>n.id===args.p_id&&n.recipient_id===user);if(r)r.read_at=args.p_read?'2026-10-05T10:00Z':null;}else rows.forEach(n=>{if(n.recipient_id===user&&n.created_at<=args.p_before)n.read_at='2026-10-05T10:00Z';});return {error:null};})};
  const error=vi.fn(),open=vi.fn(),push=vi.fn();
  const controller=createNotifications({db:()=>db,userId:()=>user,host:()=>win.document.getElementById('host'),badge:()=>win.document.getElementById('badge'),onPush:push,onOpen:open,onError:error});
  return {win,db,queries,controller,error,open,push,user:v=>user=v,fail:()=>failWrite=true,defer:p=>deferred=p,rows:v=>rows=v};
}
it('escapes event content, handles invalid dates and refuses external entity links',()=>{
  const win=new Window();win.document.body.innerHTML=notificationRowsHTML([{...sample('<svg onload=x>'),title:'<script>x</script>',body:'<img onerror=x>',created_at:'invalid',entity_id:'javascript:x'}]);
  expect(win.document.querySelector('script,img,svg,a')).toBeNull();expect(win.document.body.textContent).toContain('Без даты');
  expect(notificationRoute({...sample('a'),entity_kind:'https://evil'})).toBeNull();
  expect(notificationRoute(sample('a'))).toBe('#/trip/'+uuid);
});
it('loads only personal notices and persists read/unread state without enabling push',async()=>{
  const s=setup();try{
    await s.controller.open();await s.controller.refreshBadge();
    expect(s.win.document.querySelectorAll('.notice-row')).toHaveLength(2);expect(s.win.document.getElementById('badge').textContent).toBe('1');expect(s.push).not.toHaveBeenCalled();
    await s.win.document.querySelector('[data-notice-read]').onclick();await s.controller.refreshBadge();
    expect(s.win.document.querySelectorAll('.notice-row.unread')).toHaveLength(0);
    await s.controller.open();expect(s.win.document.querySelectorAll('.notice-row.unread')).toHaveLength(0);
    await s.win.document.querySelector('[data-notice-read]').onclick();expect(s.win.document.querySelectorAll('.notice-row.unread')).toHaveLength(1);
    expect(s.queries.every(q=>q.some(([k,v])=>k==='recipient_id'&&v==='me'))).toBe(true);
  }finally{s.controller.reset();await s.win.happyDOM.close();}
});
it('keeps a notice unread if persistence fails and still permits opening its card',async()=>{
  const s=setup();try{
    await s.controller.open();s.fail();
    await s.win.document.querySelector('[data-notice-read]').onclick();
    expect(s.win.document.querySelector('.notice-row').classList.contains('unread')).toBe(true);expect(s.error).toHaveBeenCalledWith('Нет связи');
    const event={preventDefault:vi.fn()};await s.win.document.querySelector('[data-notice-open]').onclick(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();expect(s.open).toHaveBeenCalledWith('#/trip/'+uuid);
  }finally{s.controller.reset();await s.win.happyDOM.close();}
});
it('discards a response from the previous account after switching users',async()=>{
  const s=setup();try{
    let resolve;s.defer(new Promise(r=>resolve=r));const first=s.controller.open();
    await Promise.resolve();await Promise.resolve();s.user('other');await s.controller.open();
    resolve({data:[sample('private-old')],error:null});await first;
    expect(s.win.document.querySelectorAll('.notice-row')).toHaveLength(1);expect(s.win.document.querySelector('.notice-row').dataset.notice).toBe('event:b');
  }finally{s.controller.reset();await s.win.happyDOM.close();}
});

it('does not skip unread notices on the next page after marking a loaded notice read',async()=>{
  const s=setup();try{
    s.rows(Array.from({length:51},(_,i)=>sample('event:'+i)));
    await s.controller.open();await s.win.document.querySelector('[data-notice-filter=unread]').onclick();
    // Wait for the filter request before interacting with its fresh rows.
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(s.win.document.querySelectorAll('.notice-row')).toHaveLength(50);
    await s.win.document.querySelector('[data-notice-read]').onclick();
    await s.win.document.querySelector('[data-notice-more]').onclick();
    expect(s.win.document.querySelectorAll('.notice-row')).toHaveLength(50);
    expect(s.win.document.querySelector('[data-notice="event:50"]')).not.toBeNull();
  }finally{s.controller.reset();await s.win.happyDOM.close();}
});
