import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>{await q("select set_config('test.uid',$1,true)",[id(n)]);await db.exec('set local role authenticated');};
const result=(task,item,revision,qty,basis='Акт №42')=>q('select public.service_order_historical_result($1,$2,$3,$4,$5) revision',[task,revision,[{id:item,done_qty:qty,result_note:'По акту'}],'Работа выполнена',basis]);
const rejected=async(call,pattern)=>{await db.exec('savepoint denied');await expect(call()).rejects.toThrow(pattern);await db.exec('rollback to savepoint denied; release savepoint denied');};

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec('create schema dlight_private; alter function job_point(uuid) set search_path=public; alter table public.jobs add column status public.job_status not null default \'open\'');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260922190447_service_orders.sql',import.meta.url),'utf8'));
  await db.exec(`alter table public.service_orders add column job_id uuid references public.jobs(id), add column seed_request_id uuid references public.jobs(id);
    alter table public.service_order_items add column legacy_snapshot jsonb not null default '{}', add column request_finance_void_event_id bigint;
    create unique index on public.service_orders(seed_request_id);`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260929050000_historical_draft_result.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('begin');
  await q("insert into profiles values($1,'admin',true),($2,'logist',true),($3,'engineer',true)",[id(1),id(2),id(3)]);
  await q("insert into clients values($1,'Клиент',50,30)",[id(20)]);
  await q("insert into jobs(id,client_id,status) values($1,$2,'done'),($3,$2,'open')",[id(10),id(20),id(11)]);
  await q("insert into service_orders(id,title,job_id,seed_request_id,status) values($1,'Перенесено',$2,$2,'draft'),($3,'Новое',$4,$4,'draft')",[id(30),id(10),id(31),id(11)]);
  await q('insert into service_order_jobs(order_id,job_id) values($1,$2),($3,$4)',[id(30),id(10),id(31),id(11)]);
  await q("insert into service_order_items(id,order_id,job_id,title,unit,planned_qty) values($1,$2,$3,'Осмотр','ч',2),($4,$5,$6,'Новое','ч',2)",[id(40),id(30),id(10),id(41),id(31),id(11)]);
});
afterEach(async()=>{await db.exec('rollback');});

it('records a manually evidenced quantity and its previous snapshot without changing statuses',async()=>{
  await as(1);
  expect((await result(id(30),id(40),0,0.25))[0].revision).toBe(1);
  await db.exec('reset role');
  expect((await q('select done_qty,result_note from service_order_items where id=$1',[id(40)]))[0]).toEqual({done_qty:'0.25',result_note:'По акту'});
  expect((await q('select status,result_note from service_orders where id=$1',[id(30)]))[0]).toEqual({status:'draft',result_note:'Работа выполнена'});
  expect((await q('select status from jobs where id=$1',[id(10)]))[0].status).toBe('done');
  const history=(await q('select actor_id,reason,snapshot from service_order_history where order_id=$1 order by id desc limit 1',[id(30)]))[0];
  expect(history.actor_id).toBe(id(1));expect(history.reason).toContain('Акт №42');
  expect(history.snapshot.items[0].done_qty).toBe(0);
});
it('rejects engineer access, stale revisions, missing basis, excess and foreign rows',async()=>{
  await as(3);await rejected(()=>result(id(30),id(40),0,1),/диспетчер/);
  await as(1);
  await rejected(()=>result(id(30),id(40),0,1,''),/основание/);
  await rejected(()=>result(id(30),id(40),1,1),/изменено/);
  await rejected(()=>result(id(30),id(40),0,3),/Недопустимый/);
  await rejected(()=>result(id(30),id(41),0,1),/не принадлежит/);
  await db.exec('reset role');expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('0');
});
it('rejects a new closed request, a reopened old request and a voided row',async()=>{
  await q("update jobs set status='done' where id=$1",[id(11)]);
  await q('update service_orders set created_by=$2 where id=$1',[id(31),id(1)]);
  await as(1);
  await rejected(()=>result(id(31),id(41),0,1),/перенесённого черновика/);
  await db.exec('reset role');await q("update jobs set status='open' where id=$1",[id(10)]);await as(1);
  await rejected(()=>result(id(30),id(40),0,1),/перенесённого черновика/);
  await db.exec('reset role');await q("update jobs set status='done' where id=$1",[id(10)]);
  await db.exec('reset role');await q('update service_order_items set request_finance_void_event_id=1 where id=$1',[id(40)]);
  await as(1);await rejected(()=>result(id(30),id(40),0,1),/Недопустимый/);
});
it('exposes only the authenticated RPC, never direct table writes or anonymous execution',async()=>{
  expect((await q("select has_function_privilege('anon','public.service_order_historical_result(uuid,integer,jsonb,text,text)','execute') anon_exec,has_function_privilege('authenticated','public.service_order_historical_result(uuid,integer,jsonb,text,text)','execute') auth_exec,has_table_privilege('authenticated','public.service_order_items','update') direct_write"))[0]).toEqual({anon_exec:false,auth_exec:true,direct_write:false});
});
