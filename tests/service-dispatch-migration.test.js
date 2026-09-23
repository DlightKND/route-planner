import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;const q=async(s,a=[])=>(await db.query(s,a)).rows;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec('create schema dlight_private; alter function job_point(uuid) set search_path=public; create table public.job_parts(id uuid primary key,job_id uuid,name text,sku text,unit text,qty numeric,price numeric,cost numeric,created_at timestamptz default now(),created_by uuid);');
  await db.exec("alter table trip_stays add column crew_ids uuid[] not null default '{}'");
  await q("insert into clients values($1,'A',50,30),($2,'B',51,31),($3,'C',52,32)",[id(20),id(21),id(22)]);
  await q('insert into jobs(id,client_id) values($1,$2),($3,$4),($5,$6)',[id(10),id(20),id(11),id(21),id(12),id(22)]);
  await q("insert into trips(id,status) values($1,'planned'),($2,'planned'),($3,'finished')",[id(30),id(31),id(32)]);
  await q('insert into trip_jobs(trip_id,job_id,ord) values($1,$2,0),($1,$3,1),($4,$3,0),($5,$6,0)',[id(30),id(10),id(11),id(31),id(32),id(12)]);
  await q("insert into trip_stays(id,trip_id,job_id,stay_from,minutes_mgr,crew_ids,status) values($1,$2,$3,'2026-09-20 09:00Z',70,array[$5]::uuid[],'approved'),($4,$2,null,'2026-09-20 12:00Z',null,'{}','detected')",[id(40),id(30),id(10),id(41),id(3)]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260922190447_service_orders.sql',import.meta.url),'utf8'));
  await db.exec('grant select on trips to authenticated');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923124804_request_task_trip_links.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923154000_stock_catalog.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923183739_service_order_material_snapshots.sql',import.meta.url),'utf8'));
},30000);

afterAll(async()=>{await db?.close();});

it('seeds one task per request, even when a request has multiple trips',async()=>{
  const rows=await q('select seed_request_id,job_id,count(*) over(partition by seed_request_id) duplicates from service_orders where seed_request_id is not null order by seed_request_id');
  expect(rows).toHaveLength(3);
  expect(rows.every(r=>r.job_id===r.seed_request_id&&Number(r.duplicates)===1)).toBe(true);
});

it('links a shared trip to all distinct request tasks and a request to all its trips',async()=>{
  const rows=await q('select trip_id,count(*) n from trip_service_orders group by trip_id order by trip_id');
  expect(rows).toEqual([{trip_id:id(30),n:2},{trip_id:id(31),n:1},{trip_id:id(32),n:1}]);
  const repeated=await q('select count(distinct tso.trip_id) n from trip_service_orders tso join service_orders o on o.id=tso.order_id where o.job_id=$1',[id(11)]);
  expect(repeated[0].n).toBe(2);
});

it('attaches an already-linked historical stay once and leaves an unbound stay intact',async()=>{
  const stays=await q('select id,job_id,service_order_id,status,minutes_mgr from trip_stays order by id');
  expect(stays[0]).toMatchObject({id:id(40),job_id:id(10),status:'approved',minutes_mgr:'70'});
  expect(stays[0].service_order_id).not.toBeNull();
  expect(stays[1]).toMatchObject({id:id(41),job_id:null,service_order_id:null,status:'detected'});
});

it('automatically links a new stay only when its request has one task on that trip',async()=>{
  const [single]=await q('select order_id from trip_service_orders where trip_id=$1 and order_id=(select id from service_orders where seed_request_id=$2)',[id(31),id(11)]);
  await q("insert into trip_stays(id,trip_id,job_id,stay_from,minutes_mgr,status) values($1,$2,$3,'2026-09-20 14:00Z',25,'approved')",[id(42),id(31),id(11)]);
  const [linked]=await q('select service_order_id from trip_stays where id=$1',[id(42)]);
  expect(linked.service_order_id).toBe(single.order_id);

  const duplicate=id(99);
  await q("insert into service_orders(id,title,work_mode,job_id) values($1,'Второе задание','onsite',$2)",[duplicate,id(10)]);
  await q("insert into service_order_jobs(order_id,job_id) values($1,$2)",[duplicate,id(10)]);
  await q("insert into trip_service_orders(trip_id,order_id) values($1,$2)",[id(30),duplicate]);
  await q("insert into trip_stays(id,trip_id,job_id,stay_from,minutes_mgr,status) values($1,$2,$3,'2026-09-20 15:00Z',25,'approved')",[id(43),id(30),id(10)]);
  const [ambiguous]=await q('select service_order_id from trip_stays where id=$1',[id(43)]);
  expect(ambiguous.service_order_id).toBeNull();
  await q('delete from trip_stays where id=any($1::uuid[])',[[id(42),id(43)]]);
  await q('delete from trip_service_orders where order_id=$1',[duplicate]);
  await q('delete from service_orders where id=$1',[duplicate]);
});

it('lets an assigned trip engineer read attached tasks under RLS',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'engineer',true)",[id(3)]);
    await q('update trips set engineer_ids=array[$1]::uuid[] where id=$2',[id(3),id(30)]);
    await q("select set_config('test.uid',$1,true)",[id(3)]);
    await db.exec('set role authenticated');
    const rows=await q('select o.id from service_orders o join trip_service_orders tso on tso.order_id=o.id where tso.trip_id=$1',[id(30)]);
    expect(rows).toHaveLength(2);
  }finally{await db.exec('reset role; rollback');}
});

it('creates one-request tasks through the manager RPC and rejects reassignment',async()=>{
  await db.exec('begin');
  await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
  await q("select set_config('test.uid',$1,true)",[id(1)]);
  const [created]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,'[]'::jsonb) id",[JSON.stringify({title:'Проверка',work_mode:'onsite',engineer_ids:[],instructions:''}),id(10)]);
  const [saved]=await q('select job_id from service_orders where id=$1',[created.id]);
  expect(saved.job_id).toBe(id(10));
  await expect(q("select public.service_order_save_one($1,0,$2::jsonb,$3,'[]'::jsonb)",[created.id,JSON.stringify({title:'Проверка',work_mode:'onsite',engineer_ids:[],instructions:''}),id(11)])).rejects.toThrow('Связь задания с заявкой зафиксирована');
  await db.exec('rollback');
});

it('snapshots a material price when selected and preserves it across later catalog changes',async()=>{
  await db.exec('begin');
  await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
  await q("select set_config('test.uid',$1,true)",[id(1)]);
  const [catalog]=await q("insert into stock_catalog(name,sku,unit,price,cost,created_by) values('Насос','P-7','шт',1200,800,$1) returning id",[id(1)]);
  const data={title:'Замена насоса',work_mode:'onsite',engineer_ids:[],instructions:''};
  const [created]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[JSON.stringify(data),id(10),JSON.stringify([{job_id:id(10),kind:'material',stock_catalog_id:catalog.id,planned_qty:2}])]);
  const [first]=await q('select id,title,unit,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot from service_order_items where order_id=$1',[created.id]);
  expect(first).toMatchObject({title:'Насос',unit:'шт',kind:'material',stock_catalog_id:catalog.id,sku_snapshot:'P-7',unit_price_snapshot:'1200.00',unit_cost_snapshot:'800.00'});
  await q("update stock_catalog set price=1500,cost=950,name='Насос новая цена' where id=$1",[catalog.id]);
  await q("select public.service_order_save_one($1,0,$2::jsonb,$3,$4::jsonb)",[created.id,JSON.stringify(data),id(10),JSON.stringify([{id:first.id,job_id:id(10),kind:'material',stock_catalog_id:catalog.id,planned_qty:2}])]);
  const [saved]=await q('select title,sku_snapshot,unit_price_snapshot,unit_cost_snapshot from service_order_items where id=$1',[first.id]);
  expect(saved).toEqual({title:'Насос',sku_snapshot:'P-7',unit_price_snapshot:'1200.00',unit_cost_snapshot:'800.00'});
  await db.exec('rollback');
});

it('does not create duplicates when the legacy trip planner inserts a request after migration',async()=>{
  await db.exec('begin');
  await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
  await q('select set_config(\'test.uid\',$1,true)',[id(1)]);
  await q("insert into clients values($1,'D',53,33)",[id(23)]);
  await q('insert into jobs(id,client_id) values($1,$2)',[id(13),id(23)]);
  await q("insert into trips(id,status) values($1,'planned')",[id(33)]);
  await q('insert into trip_jobs(trip_id,job_id,ord) values($1,$2,0)',[id(33),id(13)]);
  const seeded=await q('select id from service_orders where seed_request_id=$1',[id(13)]);
  const linked=await q('select order_id from trip_service_orders where trip_id=$1',[id(33)]);
  expect(seeded).toHaveLength(1);expect(linked.map(r=>r.order_id)).toEqual([seeded[0].id]);
  await db.exec('rollback');
});
