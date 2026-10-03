import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';

// Execute the shipped handler with its Deno/JSR boundaries replaced. No
// subscription, credential, HTTP request or message leaves the test process.
async function harness({rows=[],rpcError=null,sendError=null,secret='test-secret',vapid='{}'}={}){
  let handler;
  const calls=[];
  const send=vi.fn(async()=>{if(sendError)throw sendError;});
  const rpc=vi.fn(async(name,args)=>{
    calls.push({name,args});
    return {data:name.endsWith('_due')?rows:null,error:rpcError?.name===name?{message:'database unavailable'}:null};
  });
  class PushMessageError extends Error {isGone(){return true;}}
  const webpush={PushMessageError,importVapidKeys:async()=>({}),ApplicationServer:{new:async()=>({subscribe:()=>({pushTextMessage:send})})}};
  const Deno={env:{get:name=>({PUSH_SECRET:secret,VAPID_KEYS:vapid}[name])},serve:fn=>{handler=fn;}};
  const source=readFileSync(new URL('../supabase/functions/push-send/index.ts',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'');
  new Function('Deno','webpush','createClient','console',source)(Deno,webpush,()=>({rpc}),{error:()=>{},log:()=>{}});
  return {calls,send,PushMessageError,request:kind=>handler(new Request(`https://test.invalid/push-send?k=test-secret&kind=${kind}`))};
}
const row={event_id:'event',sub_id:'sub',trip_id:'trip',user_id:'curator',endpoint:'https://push.invalid/test',p256dh:'key',auth:'auth',title:'Стадия',body:'Обновлено'};

it('routes entity notifications and records each subscription after delivery',async()=>{
  const h=await harness({rows:[row]});
  expect(await (await h.request('entity')).json()).toMatchObject({due:1,sent:1,failed:0,record_failed:0});
  expect(h.calls.map(c=>c.name)).toEqual(['entity_push_due','push_ok','entity_push_mark']);
  expect(h.calls[2].args).toEqual({p_event:'event',p_sub:'sub'});
  expect(JSON.parse(h.send.mock.calls[0][0])).toMatchObject({tag:'entity-event',title:'Стадия'});
});
it('preserves legacy trip notification routing',async()=>{
  const h=await harness({rows:[row]});await h.request('trip_move');
  expect(h.calls[0]).toEqual({name:'push_due',args:{p_kind:'trip_move'}});
  expect(h.calls[2].name).toBe('push_mark');
  expect(JSON.parse(h.send.mock.calls[0][0]).tag).toBe('trip-trip');
});
it('does not penalize a working subscription when the delivery journal fails',async()=>{
  const h=await harness({rows:[row],rpcError:{name:'entity_push_mark'}});
  expect(await (await h.request('entity')).json()).toMatchObject({sent:1,failed:0,record_failed:1});
  expect(h.calls.some(c=>c.name==='push_fail')).toBe(false);
});
it('leaves undelivered events pending and records transport failure',async()=>{
  const h=await harness({rows:[row],sendError:new Error('push unavailable')});
  expect(await (await h.request('entity')).json()).toMatchObject({sent:0,failed:1});
  expect(h.calls.map(c=>c.name)).toEqual(['entity_push_due','push_fail']);
});
it('rejects missing authentication and missing VAPID before reading recipients',async()=>{
  for(const [config,status] of [[{secret:''},403],[{vapid:''},500]]){
    const h=await harness(config);expect((await h.request('entity')).status).toBe(status);expect(h.calls).toEqual([]);
  }
});
it('does not send when the database cannot load the queue',async()=>{
  const h=await harness({rpcError:{name:'entity_push_due'}});
  expect((await h.request('entity')).status).toBe(500);expect(h.send).not.toHaveBeenCalled();
});
