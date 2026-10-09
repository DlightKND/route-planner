import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
let db;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role authenticated');};
const rejected=async(call,pattern)=>{await db.exec('savepoint denied');await expect(call()).rejects.toThrow(pattern);await db.exec('rollback to savepoint denied; release savepoint denied');};
const submit=async({order=30,revision=0,item=40,qty=1,note='Диагностика выполнена',op=90,basis=null,date='2026-10-05'}={})=>(await q('select public.service_order_record_result($1,$2,$3,$4,$5,$6,$7) result',[id(order),revision,[{id:id(item),done_qty:qty,result_note:'Проверено'}],note,date,id(op),basis]))[0].result;
const read=async(kind,parent)=>(await q('select public.entity_activity_results($1,$2) events',[kind,id(parent)]))[0].events;
const pin=async(kind,parent,comment=70,pinned=true)=>(await q('select public.entity_activity_pin($1,$2,$3,$4) result',[kind,id(parent),id(comment),pinned]))[0].result;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(file('./fixtures/trip-workbench-base.sql'));
  await db.exec(`create schema dlight_private;alter function job_point(uuid) set search_path=public;
    alter table jobs add column status public.job_status not null default 'open',add column owner_id uuid,add column curator_id uuid;
    alter table trips add column owner_id uuid,add column curator_id uuid;
    create table trip_revision_history(id bigint generated always as identity primary key,trip_id uuid,revision integer,recorded_at timestamptz default now(),actor_id uuid,reason text,snapshot jsonb);
    alter table trip_revision_history enable row level security;grant select on trip_revision_history to authenticated;`);
  await db.exec(file('../supabase/migrations/20260922190447_service_orders.sql'));
  await db.exec(`alter table service_orders add column job_id uuid references jobs(id),add column seed_request_id uuid references jobs(id),add column owner_id uuid,add column curator_id uuid;
    alter table service_order_items add column kind text default 'work',add column legacy_snapshot jsonb not null default '{}',add column request_finance_void_event_id bigint,add column financial_revenue_snapshot numeric,add column financial_cost_snapshot numeric,add column unit_price_snapshot numeric,add column unit_cost_snapshot numeric;
    create table trip_service_orders(trip_id uuid references trips(id),order_id uuid references service_orders(id),primary key(trip_id,order_id));
    alter table trip_service_orders enable row level security;grant select on trip_service_orders to authenticated;
    grant select on jobs,trips,profiles to authenticated;
    alter table jobs enable row level security;alter table trips enable row level security;`);
  await db.exec(file('../supabase/migrations/20260923212724_entity_activity_comments.sql'));
  await db.exec(file('../supabase/migrations/20260929050000_historical_draft_result.sql'));
  // Published authorization functions and the published canonical-result
  // overrides form the test role model; no synthetic permission shortcut.
  const responsibility=file('../supabase/migrations/20260929110000_entity_responsibility.sql');
  for(const name of ['responsibility_access','responsibility_manager','order_access']){
    const start=responsibility.indexOf(`function dlight_private.${name}(`);
    const prefix=responsibility.lastIndexOf('create ',start);
    await db.exec(responsibility.slice(prefix,responsibility.indexOf('$$;',start)+3));
  }
  const normal=(await q("select pg_get_functiondef('dlight_private.order_result(uuid,integer,jsonb,text)'::regprocedure) source"))[0].source;
  await db.exec(normal.replace("o.status='review' and public.user_role()='engineer'","o.status='review' and not dlight_private.responsibility_manager('order',p_id)"));
  const historical=(await q("select pg_get_functiondef('dlight_private.order_historical_result(uuid,integer,jsonb,text,text)'::regprocedure) source"))[0].source;
  await db.exec(historical.replace("auth.uid() is null or public.user_role() not in ('admin','logist')","auth.uid() is null or not dlight_private.responsibility_manager('order',p_id)"));
  await db.exec(`create policy test_jobs_read on jobs for select to authenticated using(dlight_private.responsibility_access('job',id));
    create policy test_trips_read on trips for select to authenticated using(dlight_private.responsibility_access('trip',id));
    create policy test_links_read on trip_service_orders for select to authenticated using(dlight_private.order_access(order_id));
    create policy test_trip_comments_owner on trip_comments for select to authenticated using(dlight_private.responsibility_manager('trip',trip_id));`);
  await db.exec(file('../supabase/migrations/20261009144527_entity_activity_results_pins.sql'));
  await db.exec(file('../supabase/migrations/20261009145440_entity_activity_pin_actor_indexes.sql'));
  await db.exec(file('../supabase/migrations/20261009202442_entity_result_parent_purge_cascade.sql'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('begin');
  await q("insert into profiles values($1,'admin',true),($2,'logist',true),($3,'engineer',true),($4,'engineer',true),($5,'admin',false),($6,'engineer',true),($7,'engineer',true)",[1,2,3,4,5,6,7].map(id));
  await q("insert into clients values($1,'Клиент',50,30)",[id(20)]);
  await q("insert into jobs(id,client_id,status,engineer_ids,owner_id,curator_id) values($1,$3,'in_progress',$4,$5,$5),($2,$3,'done',$6,$5,$5)",[id(10),id(11),id(20),[id(3),id(4)],id(6),[id(7)]]);
  await q("insert into service_orders(id,title,job_id,status,engineer_ids,lead_engineer,owner_id,curator_id) values($1,'Диагностика',$3,'in_progress',$5,$6,$7,$7),($2,'Архив',$4,'draft',$8,$9,$7,$7)",[id(30),id(31),id(10),id(11),[id(3),id(4)],id(3),id(6),[id(7)],id(7)]);
  await q('update service_orders set seed_request_id=job_id where id=$1',[id(31)]);
  await q('insert into service_order_jobs(order_id,job_id) values($1,$3),($2,$4)',[id(30),id(31),id(10),id(11)]);
  await q("insert into service_order_items(id,order_id,job_id,title,planned_qty,unit,financial_revenue_snapshot,financial_cost_snapshot,unit_price_snapshot,unit_cost_snapshot,legacy_snapshot) values($1,$3,$5,'Осмотр',2,'ч',2500,1234,100,50,'{\"secret_tariffs\":999}'),($2,$4,$6,'Историческая работа',2,'ч',3000,1600,110,60,'{}')",[id(40),id(41),id(30),id(31),id(10),id(11)]);
  await q("insert into trips(id,status,engineer_ids,lead_engineer,owner_id,curator_id) values($1,'in_progress',$3,$4,$5,$5),($2,'done',$6,$7,$5,$5)",[id(50),id(51),[id(3),id(4)],id(3),id(6),[id(7)],id(7)]);
  await q('insert into trip_service_orders values($1,$3),($2,$4)',[id(50),id(51),id(30),id(31)]);
  await as(3);
  await q("insert into job_comments(id,job_id,body) values($1,$2,'Нужно фото')",[id(70),id(10)]);
  await q("insert into service_order_comments(id,order_id,body) values($1,$2,'На объекте')",[id(71),id(30)]);
  await q("insert into trip_comments(id,trip_id,body) values($1,$2,'Выезд начат')",[id(72),id(50)]);
});
afterEach(async()=>{await db.exec('rollback');});

it('saves canonical quantities and an after-snapshot atomically without financial leakage',async()=>{
  const result=await submit();expect(result.revision).toBe(1);
  const [event]=await read('order',30);
  expect(event.actor_id).toBe(id(3));expect(event.actual_date).toBe('2026-10-05');expect(event.id).toBe(result.event_id);
  expect(event.snapshot).toMatchObject({title:'Диагностика',status:'in_progress',note:'Диагностика выполнена',items:[{done_qty:1,planned_qty:2,title:'Осмотр',unit:'ч'}]});
  expect(JSON.stringify(event)).not.toMatch(/revenue|cost|price|tariff|1234|2500|request_digest|operation_id/);
  const [history]=await q('select snapshot from service_order_history where order_id=$1',[id(30)]);
  expect(history.snapshot.items[0].done_qty).toBe(0);
});
it('retries before expected-revision validation and rejects changed payload or another actor',async()=>{
  const result=await submit();expect(await submit({revision:999})).toEqual(result);
  expect(await q('select id from service_order_result_events')).toHaveLength(1);
  expect(await q('select id from service_order_history where order_id=$1',[id(30)])).toHaveLength(1);
  await rejected(()=>submit({note:'Другой текст'}),/уже использован/);
  await as(4);await rejected(()=>submit(),/уже использован/);
});
it('rejects operation reuse against another accessible task without changing it',async()=>{
  await submit();await as(1);
  await rejected(()=>submit({order:31,item:41,basis:'Акт №42'}),/уже использован/);
  expect((await q('select done_qty from service_order_items where id=$1',[id(41)]))[0].done_qty).toBe('0');
});
it('rolls back quantities, note, revision and prior history when event insertion fails',async()=>{
  await db.exec('reset role');await db.exec("create function test_event_failure() returns trigger language plpgsql as $$begin raise exception 'test event rejected';end$$;create trigger test_event_failure before insert on service_order_result_events for each row execute function test_event_failure();");await as(3);
  await rejected(()=>submit(),/test event rejected/);
  expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('0');
  expect((await q('select revision,result_note from service_orders where id=$1',[id(30)]))[0]).toEqual({revision:0,result_note:''});
  expect(await q('select id from service_order_history where order_id=$1',[id(30)])).toHaveLength(0);
  expect(await q('select id from service_order_result_events')).toHaveLength(0);
});
it('preserves stale, foreign-item, quantity, review and inactive guards',async()=>{
  await rejected(()=>submit({revision:1}),/изменено другим/);
  await rejected(()=>submit({item:41}),/не принадлежит/);
  await rejected(()=>submit({qty:3}),/check constraint/);
  await db.exec('reset role');await q("update service_orders set status='review' where id=$1",[id(30)]);await as(3);
  await rejected(()=>submit(),/передан на проверку/);
  await as(5);await rejected(()=>submit(),/Нет доступа/);
  await as(6);expect((await submit()).revision).toBe(1);
});
it('preserves historical evidence requirements and rejects engineers and new drafts',async()=>{
  await as(1);await rejected(()=>submit({order:31,item:41}),/основание/);
  await as(7);await rejected(()=>submit({order:31,item:41,basis:'Акт №42'}),/диспетчер/);
  await as(6);expect((await submit({order:31,item:41,basis:'Акт №42'})).revision).toBe(1);
  const [event]=await read('order',31);expect(event.snapshot.basis).toBe('Акт №42');expect(event.snapshot.status).toBe('draft');
  await rejected(()=>submit({basis:'Обойти начало',op:91}),/перенесённого черновика/);
});
it('reads linked request/trip results and denies inaccessible parents despite child access',async()=>{
  await submit();expect(await read('job',10)).toHaveLength(1);expect(await read('trip',50)).toHaveLength(1);
  await rejected(()=>read('trip',51),/Нет доступа/);await rejected(()=>read('job',11),/Нет доступа/);
  await as(7);await rejected(()=>read('order',30),/Нет доступа/);
  await as(1);expect(await read('trip',51)).toEqual([]);
});
it('does not invent legacy events and keeps an earlier snapshot after correction',async()=>{
  expect(await read('order',30)).toEqual([]);
  const a=await submit();await submit({revision:1,qty:2,op:91,note:'Уточнено'});
  expect((await read('order',30)).find(e=>e.id===a.event_id).snapshot.items[0].done_qty).toBe(1);
});
it('allows entity owners to pin all kinds while denying an engineer author',async()=>{
  await rejected(()=>pin('job',10,70),/Нет права/);await as(6);
  for(const [kind,parent,comment] of [['job',10,70],['order',30,71],['trip',50,72]]){
    const saved=await pin(kind,parent,comment);expect(saved.pinned_by).toBe(id(6));expect(saved.pinned_at).toBeTruthy();
    expect(await pin(kind,parent,comment)).toEqual(saved);
    expect(await pin(kind,parent,comment,false)).toEqual({comment_id:id(comment),pinned_at:null,pinned_by:null});
  }
});
it('checks the pin parent/comment pair, active actor and known kind',async()=>{
  await as(1);await rejected(()=>pin('job',11,70),/не принадлежит/);
  await rejected(()=>pin('trip',50,71),/не принадлежит/);await rejected(()=>pin('oops',10,70),/Неизвестный/);
  await as(5);await rejected(()=>pin('job',10,70),/Нет права/);
});
it('prohibits direct edits and strips spoofed INSERT pin fields',async()=>{
  await rejected(()=>q("update service_order_comments set body='другое' where id=$1",[id(71)]),/permission denied/);
  await rejected(()=>q('update job_comments set pinned_at=now(),pinned_by=$2 where id=$1',[id(70),id(3)]),/permission denied/);
  await rejected(()=>q('insert into service_order_result_events(order_id) values($1)',[id(30)]),/permission denied/);
  expect((await q("insert into job_comments(job_id,body,pinned_at,pinned_by) values($1,'Spoof',now(),$2) returning pinned_at,pinned_by",[id(10),id(3)]))[0]).toEqual({pinned_at:null,pinned_by:null});
});
it('revokes anonymous RPC execution and retains immutable-table privileges',async()=>{
  expect((await q("select has_function_privilege('anon','public.service_order_record_result(uuid,integer,jsonb,text,date,uuid,text)','execute') result_anon,has_function_privilege('anon','public.entity_activity_pin(text,uuid,uuid,boolean)','execute') pin_anon,has_function_privilege('anon','public.entity_activity_results(text,uuid)','execute') read_anon,has_table_privilege('authenticated','service_order_result_events','update') event_update,has_table_privilege('authenticated','job_comments','update') comment_update"))[0]).toEqual({result_anon:false,pin_anon:false,read_anon:false,event_update:false,comment_update:false});
});
it('makes old pinned comments discoverable separately from the latest hundred',async()=>{
  await as(6);await pin('job',10,70);await db.exec('reset role');
  await q("update job_comments set created_at='2000-01-01T00:00:00Z' where id=$1",[id(70)]);
  await db.exec("insert into job_comments(job_id,body) select '00000000-0000-4000-8000-000000000010','Новая запись '||n from generate_series(1,105) n");await as(3);
  expect((await q('select id from job_comments where job_id=$1 order by created_at desc,id desc limit 100',[id(10)])).some(x=>x.id===id(70))).toBe(false);
  expect(await q('select id from job_comments where job_id=$1 and pinned_at is not null',[id(10)])).toEqual([{id:id(70)}]);
});
it('allows global managers, rejects missing operation IDs/future dates/deleted parents',async()=>{
  await as(2);expect((await pin('order',30,71)).pinned_by).toBe(id(2));
  await rejected(()=>q('select public.service_order_record_result($1,0,$2,$3,$4,null)',[id(30),[{id:id(40),done_qty:1}],'Без токена','2026-10-05']),/идентификатор/);
  await rejected(()=>submit({date:'2999-01-01'}),/не позднее/);
  await db.exec('reset role');await q('update trips set deleted_at=now() where id=$1',[id(50)]);await as(2);
  await rejected(()=>pin('trip',50,72),/Нет права/);await rejected(()=>read('trip',50),/Нет доступа/);
});
it('cascades result snapshots on authorized task cleanup without granting client deletion',async()=>{
  await submit();expect(await read('order',30)).toHaveLength(1);
  await as(1);
  await rejected(()=>q('delete from service_orders where id=$1',[id(30)]),/permission denied/);
  await rejected(()=>q('delete from service_order_result_events where order_id=$1',[id(30)]),/permission denied/);
  await db.exec('reset role');
  // Existing NO ACTION/RESTRICT dependencies are intentionally unchanged.
  // An authorized server cleanup resolves those before removing the parent.
  await q('delete from trip_service_orders where order_id=$1',[id(30)]);
  await q('delete from service_order_items where order_id=$1',[id(30)]);
  await q('delete from service_order_history where order_id=$1',[id(30)]);
  await q('delete from service_orders where id=$1',[id(30)]);
  expect(await q('select id from service_order_result_events where order_id=$1',[id(30)])).toEqual([]);
  expect(await q('select id from service_order_comments where order_id=$1',[id(30)])).toEqual([]);
  expect(await q('select id from service_orders where id=$1',[id(31)])).toHaveLength(1);
});
