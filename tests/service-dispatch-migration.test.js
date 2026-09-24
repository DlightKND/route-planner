import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;const q=async(s,a=[])=>(await db.query(s,a)).rows;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec("alter table public.jobs add column status public.job_status not null default 'open'");
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921133835_trip_workbench.sql',import.meta.url),'utf8'));
  await db.exec(`alter function job_point(uuid) set search_path=public;
    create table public.job_parts(id uuid primary key,job_id uuid,name text,sku text,unit text,qty numeric,price numeric,cost numeric,billable boolean default true,approved_at timestamptz,approved_by uuid,created_at timestamptz default now(),created_by uuid);
    create table public.work_catalog(id uuid primary key,name text,norm_hours numeric,warranty_eligible boolean default false,applicable_kinds text[]);
    create table public.job_works(id uuid primary key default gen_random_uuid(),job_id uuid,work_id uuid,hours numeric,materials jsonb,billable boolean,billable_reason text,revenue numeric,created_at timestamptz,title text,revenue_override numeric,tariff_profile text,approved_at timestamptz,approved_by uuid);`);
  await db.exec('alter table clients add column default_profile text');
  await q("insert into clients(id,name,lat,lng,default_profile) values($1,'A',50,30,'client'),($2,'B',51,31,null),($3,'C',52,32,null),($4,'D',53,33,null)",[id(20),id(21),id(22),id(23)]);
  await q('insert into jobs(id,client_id) values($1,$2),($3,$4),($5,$6),($7,$8)',[id(10),id(20),id(11),id(21),id(12),id(22),id(13),id(23)]);
  await q("insert into work_catalog values($1,'Диагностика')",[id(80)]);
  await q("insert into job_works(id,job_id,work_id,hours,materials,billable,billable_reason,revenue,created_at,title,revenue_override,tariff_profile,approved_at,approved_by) values($1,$2,$3,2.5,'[]',true,'',1200,'2026-09-20T10:00:00Z','',null,'client','2026-09-21T10:00:00Z',$4)",[id(60),id(10),id(80),id(1)]);
  await q("insert into job_works(id,job_id,work_id,hours,materials,billable,billable_reason,revenue,created_at,title,revenue_override,tariff_profile,approved_at,approved_by) values($1,$2,$3,1,'[]',false,'Гарантия',250,'2026-09-20T10:00:00Z','',null,'warranty','2026-09-21T10:00:00Z',$4)",[id(61),id(13),id(80),id(1)]);
  await q("insert into job_parts(id,job_id,name,sku,unit,qty,price,cost,billable,approved_at,approved_by,created_by) values($1,$2,'Фильтр','F-1','шт',2,100,55,true,'2026-09-21T11:00:00Z',$3,null)",[id(70),id(10),id(1)]);
  await q("insert into job_parts(id,job_id,name,sku,unit,qty,price,cost,billable,approved_at,approved_by,created_by) values($1,$2,'Прокладка','P-1','шт',1,30,15,false,'2026-09-21T11:00:00Z',$3,null)",[id(71),id(13),id(1)]);
  await db.exec("alter table settings add column costs jsonb; alter table settings add column tariffs jsonb; alter table settings add column tariff_profiles jsonb; update settings set costs='{\"hour\":750}',tariffs='{\"hour\":1500}',tariff_profiles='[{\"id\":\"client\",\"work_paid\":{\"rate\":1200},\"work_warr\":{\"rate\":350},\"work_depot\":{\"rate\":800}},{\"id\":\"standard\",\"work_paid\":{\"rate\":1000},\"def_paid\":true},{\"id\":\"warranty\",\"work_warr\":{\"rate\":250},\"def_warranty\":true}]' where id=true");
  await q("insert into trips(id,status) values($1,'planned'),($2,'planned'),($3,'finished')",[id(30),id(31),id(32)]);
  await q('insert into trip_jobs(trip_id,job_id,ord) values($1,$2,0),($1,$3,1),($4,$3,0),($5,$6,0)',[id(30),id(10),id(11),id(31),id(32),id(12)]);
  await q("insert into trip_stays(id,trip_id,job_id,stay_from,minutes_mgr,crew_ids,status) values($1,$2,$3,'2026-09-20 09:00Z',70,array[$5]::uuid[],'approved'),($4,$2,null,'2026-09-20 12:00Z',null,'{}','detected')",[id(40),id(30),id(10),id(41),id(3)]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260922190447_service_orders.sql',import.meta.url),'utf8'));
  await db.exec('grant select on trips to authenticated');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923124804_request_task_trip_links.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923133423_trip_cost_allocation.sql',import.meta.url),'utf8'));
  await db.exec("create type public.user_role as enum ('admin','logist','engineer')");
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923144500_employee_org_structure.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923154000_stock_catalog.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923183739_service_order_material_snapshots.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923210000_restore_task_link_invariants.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924091500_legacy_finance_to_task_items.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924123000_legacy_finance_dualwrite.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924160000_carry_task_financial_snapshots.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924180000_task_work_financial_snapshots.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924200000_task_work_catalog_and_warranty.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924210000_request_write_rpc.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924220000_request_parts_write_rpc.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924230000_seed_task_request_access.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924231000_request_finance_canonical_write.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260924130146_preserve_request_finance_approvals.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260925000000_audited_request_finance_void.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260925001000_index_request_finance_audit.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260925002000_lock_voided_request_approvals.sql',import.meta.url),'utf8'));
  expect((await q("select has_function_privilege('anon','public.job_request_save_canonical(uuid,jsonb,jsonb,jsonb)','execute') anon_exec,has_function_privilege('authenticated','public.job_request_save_canonical(uuid,jsonb,jsonb,jsonb)','execute') auth_exec,has_table_privilege('authenticated','public.service_order_items','insert') table_insert"))[0]).toEqual({anon_exec:false,auth_exec:true,table_insert:false});
},30000);

afterAll(async()=>{await db?.close();});

it('seeds one task per request, even when a request has multiple trips',async()=>{
  const rows=await q('select seed_request_id,job_id,count(*) over(partition by seed_request_id) duplicates from service_orders where seed_request_id in (select distinct job_id from trip_jobs) order by seed_request_id');
  expect(rows).toHaveLength(3);
  expect(rows.every(r=>r.job_id===r.seed_request_id&&Number(r.duplicates)===1)).toBe(true);
});

it('creates a draft seed task for a legacy financial request without inventing a trip',async()=>{
  const [seed]=await q('select id,status,work_mode,job_id,seed_request_id from service_orders where seed_request_id=$1',[id(13)]);
  expect(seed).toMatchObject({status:'draft',work_mode:'onsite',job_id:id(13),seed_request_id:id(13)});
  expect(await q('select * from trip_service_orders where order_id=$1',[seed.id])).toHaveLength(0);
  expect(await q('select order_id,job_id from service_order_jobs where order_id=$1',[seed.id])).toEqual([{order_id:seed.id,job_id:id(13)}]);
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
  }finally{await db.exec('rollback');await db.exec('reset role');}
});

it('lets request assignees read only their canonical seed task under RLS',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'engineer',true),($2,'engineer',true)",[id(3),id(4)]);
    await q('update jobs set assigned_engineer=$1,engineer_ids=array[$1]::uuid[] where id=$2',[id(3),id(10)]);
    await q("select set_config('test.uid',$1,true)",[id(3)]);
    await db.exec('set role authenticated');
    const visible=await q('select o.id,i.legacy_job_work_id from service_orders o join service_order_items i on i.order_id=o.id where o.seed_request_id=$1',[id(10)]);
    expect(visible).toHaveLength(2);
    expect(visible.map(x=>x.legacy_job_work_id).filter(Boolean)).toEqual([id(60)]);

    await q("select set_config('test.uid',$1,true)",[id(4)]);
    const hidden=await q('select o.id from service_orders o where o.seed_request_id=$1',[id(10)]);
    expect(hidden).toHaveLength(0);
  }finally{await db.exec('rollback');await db.exec('reset role');}
});

it('backfills a legacy work and part as immutable financial snapshots on the request task',async()=>{
  const [work]=await q('select order_id,job_id,kind,work_catalog_id,legacy_job_work_id,legacy_snapshot,planned_qty,done_qty,billable,financial_revenue_snapshot,financial_cost_snapshot,approved_at,approved_by from service_order_items where legacy_job_work_id=$1',[id(60)]);
  expect(work).toMatchObject({job_id:id(10),kind:'work',work_catalog_id:id(80),legacy_job_work_id:id(60),planned_qty:'2.5',done_qty:'0',billable:true,approved_by:id(1)});
  expect(Number(work.financial_revenue_snapshot)).toBe(1200);
  expect(Number(work.financial_cost_snapshot)).toBe(1875);
  expect(work.legacy_snapshot).toMatchObject({id:id(60),job_id:id(10),hours:2.5,revenue:1200});
  const [part]=await q('select order_id,job_id,kind,legacy_job_part_id,legacy_snapshot,planned_qty,done_qty,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot,approved_at,approved_by from service_order_items where legacy_job_part_id=$1',[id(70)]);
  expect(part).toMatchObject({job_id:id(10),kind:'material',legacy_job_part_id:id(70),planned_qty:'2',done_qty:'0',sku_snapshot:'F-1',approved_by:id(1)});
  expect(Number(part.unit_price_snapshot)).toBe(100);
  expect(Number(part.unit_cost_snapshot)).toBe(55);
  expect(Number(part.financial_revenue_snapshot)).toBe(200);
  expect(Number(part.financial_cost_snapshot)).toBe(110);
  expect(part.legacy_snapshot).toMatchObject({id:id(70),job_id:id(10),qty:2,price:100,cost:55});
  expect((await q('select count(*) n from service_order_items where legacy_job_work_id=$1 or legacy_job_part_id=$2',[id(60),id(70)]))[0].n).toBe(2);
  const [warranty]=await q('select billable,billable_reason,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_work_id=$1',[id(61)]);
  expect(warranty).toMatchObject({billable:false,billable_reason:'Гарантия',financial_revenue_snapshot:'250',financial_cost_snapshot:'750'});
  const [warrantyPart]=await q('select billable,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_part_id=$1',[id(71)]);
  expect(warrantyPart).toMatchObject({billable:false,financial_revenue_snapshot:'0',financial_cost_snapshot:'15'});
});

it('prevents an imported financial line from being deleted or having its snapshots rewritten',async()=>{
  await expect(q('delete from service_order_items where legacy_job_work_id=$1',[id(60)])).rejects.toThrow(/нельзя удалить/);
  await expect(q('update service_order_items set financial_revenue_snapshot=0 where legacy_job_work_id=$1',[id(60)])).rejects.toThrow(/заблокирована до переключения/);
  await expect(q("update service_order_items set planned_qty=3 where legacy_job_work_id=$1",[id(60)])).rejects.toThrow(/заблокирована до переключения/);
  expect((await q('select financial_revenue_snapshot,planned_qty from service_order_items where legacy_job_work_id=$1',[id(60)]))[0]).toMatchObject({financial_revenue_snapshot:'1200',planned_qty:'2.5'});
});

it('atomically syncs edits from the legacy work/part editor into canonical task rows',async()=>{
  await db.exec('begin');
  try{
    await q("update job_works set hours=3,revenue=1500,billable=false,billable_reason='Warranty' where id=$1",[id(60)]);
    const [work]=await q('select planned_qty,billable,billable_reason,legacy_snapshot,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_work_id=$1',[id(60)]);
    expect(work).toMatchObject({planned_qty:'3',billable:false,billable_reason:'Warranty',financial_revenue_snapshot:'1500',financial_cost_snapshot:'2250'});
    expect(work.legacy_snapshot).toMatchObject({hours:3,revenue:1500,billable:false});
    await q("update job_parts set name='Фильтр v2',qty=3,price=110,cost=60,billable=false where id=$1",[id(70)]);
    const [part]=await q('select title,planned_qty,billable,legacy_snapshot,unit_price_snapshot,unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_part_id=$1',[id(70)]);
    expect(part).toMatchObject({title:'Фильтр v2',planned_qty:'3',billable:false,unit_price_snapshot:'110.00',unit_cost_snapshot:'60.00',financial_revenue_snapshot:'0',financial_cost_snapshot:'180'});
    expect(part.legacy_snapshot).toMatchObject({name:'Фильтр v2',qty:3,price:110,cost:60,billable:false});
  }finally{await db.exec('rollback');}
});

it('creates the canonical seed and item when a new legacy line is entered for an unplanned request',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q("insert into clients(id,name,lat,lng) values($1,'Новый клиент',54,34)",[id(25)]);
    await q('insert into jobs(id,client_id) values($1,$2)',[id(16),id(25)]);
    await q("insert into job_works(id,job_id,work_id,hours,materials,billable,billable_reason,revenue,created_at,title,revenue_override,tariff_profile) values($1,$2,$3,1.5,'[]',true,'',500,'2026-09-22T10:00:00Z','',null,'client')",[id(62),id(16),id(80)]);
    const [seed]=await q('select id,status from service_orders where seed_request_id=$1',[id(16)]);
    const [item]=await q('select job_id,kind,legacy_job_work_id,planned_qty,financial_revenue_snapshot from service_order_items where legacy_job_work_id=$1',[id(62)]);
    expect(seed.status).toBe('draft');
    expect(item).toMatchObject({job_id:id(16),kind:'work',legacy_job_work_id:id(62),planned_qty:'1.5',financial_revenue_snapshot:'500'});
    expect(await q('select * from trip_service_orders where order_id=$1',[seed.id])).toHaveLength(0);
  }finally{await db.exec('reset role; rollback');}
});

it('maps a newly entered legacy material to the stock catalog and task atomically',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q("insert into clients(id,name,lat,lng) values($1,'Новый клиент',55,35)",[id(26)]);
    await q('insert into jobs(id,client_id) values($1,$2)',[id(17),id(26)]);
    await q("insert into job_parts(id,job_id,name,sku,unit,qty,price,cost,billable,approved_at,approved_by,created_by) values($1,$2,'Новый фильтр','NF-1','шт',2,180,90,true,'2026-09-22T11:00:00Z',$3,$3)",[id(72),id(17),id(1)]);
    const [seed]=await q('select id,status from service_orders where seed_request_id=$1',[id(17)]);
    const [item]=await q('select order_id,job_id,title,kind,legacy_job_part_id,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_part_id=$1',[id(72)]);
    const [catalog]=await q('select legacy_part_id,name,sku,price,cost from stock_catalog where id=$1',[item.stock_catalog_id]);
    expect(seed.status).toBe('draft');
    expect(item).toMatchObject({order_id:seed.id,job_id:id(17),title:'Новый фильтр',kind:'material',legacy_job_part_id:id(72),sku_snapshot:'NF-1',unit_price_snapshot:'180.00',unit_cost_snapshot:'90.00',financial_revenue_snapshot:'360',financial_cost_snapshot:'180'});
    expect(catalog).toMatchObject({legacy_part_id:id(72),name:'Новый фильтр',sku:'NF-1',price:'180.00',cost:'90.00'});
  }finally{await db.exec('reset role; rollback');}
});

it('atomically saves complete request material plans with stable replay IDs',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const rec={client_id:id(20),status:'open',engineer_ids:[],notes:'before'};
    const material={id:id(73),client_new:true,name:'Фильтр',sku:'F-2',unit:'шт',qty:2,price:180,cost:90,billable:true};
    const save=(record,parts)=>q('select public.job_request_save($1,$2::jsonb,null,$3::jsonb) result',[
      id(10),JSON.stringify(record),parts===null?null:JSON.stringify(parts)
    ]);
    const [first]=await save(rec,[material]);
    const firstId=first.result.parts[0].id;
    expect(firstId).toBe(id(73));
    expect((await q('select id,qty,price,cost from job_parts where id=$1',[id(73)]))[0]).toMatchObject({id:id(73),qty:'2',price:'180',cost:'90'});

    const [replay]=await save({...rec,notes:'retry'},[material]);
    expect(replay.result.parts[0].id).toBe(firstId);
    expect(await q('select id from job_parts where id=$1',[id(73)])).toHaveLength(1);

    await q("insert into profiles(id,role,active) values($1,'engineer',true)",[id(2)]);
    await q("select set_config('test.uid',$1,true)",[id(2)]);
    const engineerPart={id:id(74),client_new:true,name:'Прокладка',sku:'G-4',unit:'шт',qty:1,price:999,cost:500,billable:true};
    const [engineerInsert]=await save({...rec,notes:'engineer add'},[material,engineerPart]);
    expect(engineerInsert.result.parts[1].id).toBe(id(74));
    expect((await q('select qty,price,cost from job_parts where id=$1',[id(74)]))[0]).toMatchObject({qty:'1',price:'0',cost:'0'});
    const [engineerSave]=await save({...rec,notes:'engineer edit'},[{...material,client_new:false},{...engineerPart,qty:3}]);
    expect(engineerSave.result.parts.map(x=>x.id)).toEqual([firstId,id(74)]);
    expect((await q('select qty,price,cost from job_parts where id=$1',[id(74)]))[0]).toMatchObject({qty:'3',price:'0',cost:'0'});

    // A stale three-argument client continues to resolve to the original RPC
    // and does not replace the material plan when it has no parts snapshot.
    await q("select public.job_request_save($1,$2::jsonb,null)",[id(10),JSON.stringify({...rec,notes:'legacy replay'})]);
    expect(await q('select id from job_parts where id=$1',[id(73)])).toHaveLength(1);

    await db.exec('savepoint invalid_material');
    await expect(save({...rec,notes:'must roll back'},[{...material,qty:0}])).rejects.toThrow(/положительное количество/);
    await db.exec('rollback to savepoint invalid_material');
    expect((await q('select notes from jobs where id=$1',[id(10)]))[0].notes).toBe('legacy replay');

    await save(rec,[]);
    // Both rows are mirrored to the canonical table, whose existing delete
    // guard intentionally remains active until audited corrections ship.
    expect(await q('select id from job_parts where id in ($1,$2)',[id(73),id(74)])).toHaveLength(2);
  }finally{await db.exec('rollback');}
});

it('keeps imported legacy material rows when a complete plan omits them',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q("select public.job_request_save($1,$2::jsonb,null,'[]'::jsonb)",[id(10),JSON.stringify({client_id:id(20),status:'open',engineer_ids:[],notes:'safe'})]);
    expect(await q('select id from job_parts where id=$1',[id(70)])).toHaveLength(1);
  }finally{await db.exec('rollback');}
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

it('server-snapshots new task work from the request tariff and global cost without trusting browser money',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q("update work_catalog set warranty_eligible=true,norm_hours=2 where id=$1",[id(80)]);
    const data={title:'Нова робота',work_mode:'onsite',engineer_ids:[],instructions:''};
    const [created]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[
      JSON.stringify(data),id(10),JSON.stringify([{job_id:id(10),kind:'work',title:'Діагностика',unit:'ч',planned_qty:2,financial_revenue_snapshot:1,financial_cost_snapshot:1}])
    ]);
    const [item]=await q('select billable,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[created.id]);
    expect(item).toEqual({billable:true,tariff_profile:'client',financial_revenue_snapshot:'2400.00',financial_cost_snapshot:'1500.00'});
    await q("update settings set tariffs='{\"hour\":9000}',costs='{\"hour\":3000}' where id=true");
    await q("select public.service_order_save_one($1,0,$2::jsonb,$3,$4::jsonb)",[created.id,JSON.stringify(data),id(10),JSON.stringify([{id:(await q('select id from service_order_items where order_id=$1',[created.id]))[0].id,job_id:id(10),kind:'work',work_catalog_id:null,billable:true,billable_reason:'',tariff_profile:'client',title:'Диагностика',unit:'ч',planned_qty:3}])]);
    const [resized]=await q('select tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[created.id]);
    expect(resized).toEqual({tariff_profile:'client',financial_revenue_snapshot:'3600.00',financial_cost_snapshot:'2250.00'});

    const [fallback]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[
      JSON.stringify({...data,title:'Обычный тариф'}),id(11),JSON.stringify([{job_id:id(11),kind:'work',title:'Настройка',unit:'ч',planned_qty:1}])
    ]);
    const [defaultPaid]=await q('select tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[fallback.id]);
    expect(defaultPaid).toEqual({tariff_profile:'standard',financial_revenue_snapshot:'1000.00',financial_cost_snapshot:'3000.00'});

    const [warrantyOrder]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[
      JSON.stringify({...data,title:'Гарантия'}),id(13),JSON.stringify([{job_id:id(13),kind:'work',work_catalog_id:id(80),billable:false,billable_reason:'Повторная неисправность',tariff_profile:'warranty',title:'Подмена из браузера',unit:'ч',planned_qty:2,financial_revenue_snapshot:1,financial_cost_snapshot:1}])
    ]);
    const [warranty]=await q('select title,work_catalog_id,billable,billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[warrantyOrder.id]);
    expect(warranty).toEqual({title:'Диагностика',work_catalog_id:id(80),billable:false,billable_reason:'Повторная неисправность',tariff_profile:'warranty',financial_revenue_snapshot:'500.00',financial_cost_snapshot:'6000.00'});
    await q('savepoint invalid_warranty_reason');
    await expect(q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb)",[
      JSON.stringify({...data,title:'Без причины'}),id(13),JSON.stringify([{job_id:id(13),kind:'work',work_catalog_id:id(80),billable:false,billable_reason:'',tariff_profile:'warranty',unit:'ч',planned_qty:1}])
    ])).rejects.toThrow('Укажи причину гарантийной работы');
    await q('rollback to savepoint invalid_warranty_reason');

    const [nonHourly]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[
      JSON.stringify({...data,title:'Фиксированная услуга'}),id(12),JSON.stringify([{job_id:id(12),kind:'work',title:'Фиксированная услуга',unit:'работа',planned_qty:1}])
    ]);
    const [unpriced]=await q('select financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[nonHourly.id]);
    expect(unpriced).toEqual({financial_revenue_snapshot:null,financial_cost_snapshot:null});
  }finally{await db.exec('reset role; rollback');}
});

it('saves a request and its work lines atomically while dual-writing the canonical task items',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const works=[{id:id(60),job_id:id(10),work_id:id(80),title:'',hours:4,billable:true,billable_reason:'',revenue:1,revenue_override:null,tariff_profile:'client'}];
    const rec={client_id:id(20),equipment_id:null,status:'in_progress',scheduled_date:null,time_window:'',due_date:null,assigned_engineer:null,engineer_ids:[],notes:'atomic update',at_depot:false,depot_id:null};
    const saved=await q('select public.job_request_save($1,$2::jsonb,$3::jsonb) value',[id(10),JSON.stringify(rec),JSON.stringify(works)]);
    expect(saved[0].value.job_id).toBe(id(10));
    expect(saved[0].value.works[0]).toMatchObject({id:id(60),revenue:1,approved_by:id(1)});
    const [source]=await q('select hours,revenue,approved_at is not null as approved from job_works where id=$1',[id(60)]);
    expect(source).toEqual({hours:'4',revenue:'1',approved:true});
    const [task]=await q('select planned_qty,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where legacy_job_work_id=$1',[id(60)]);
    expect(task).toEqual({planned_qty:'4',financial_revenue_snapshot:'1',financial_cost_snapshot:'3000'});
    const [header]=await q('select status,notes from jobs where id=$1',[id(10)]);
    expect(header).toEqual({status:'in_progress',notes:'atomic update'});

    await q('savepoint header_fk_failure');
    await expect(q('select public.job_request_save($1,$2::jsonb,$3::jsonb)',[
      id(10),JSON.stringify({...rec,client_id:id(999)}),JSON.stringify([{...works[0],hours:5,revenue:1}])
    ])).rejects.toThrow();
    await q('rollback to savepoint header_fk_failure');
    const [unchanged]=await q('select hours from job_works where id=$1',[id(60)]);
    expect(unchanged.hours).toBe('4');

    const created=await q('select public.job_request_save(null,$1::jsonb,$2::jsonb) value',[
      JSON.stringify({...rec,notes:'created atomically'}),JSON.stringify([{work_id:id(80),title:'Browser title',hours:2,billable:true,billable_reason:'',revenue:100,tariff_profile:'client'}])
    ]);
    const newJobId=created[0].value.job_id;
    const [newHeader]=await q('select status,notes from jobs where id=$1',[newJobId]);
    expect(newHeader).toEqual({status:'in_progress',notes:'created atomically'});
    const [newWork]=await q('select title,hours from job_works where job_id=$1',[newJobId]);
    expect(newWork).toEqual({title:'Browser title',hours:'2'});
    expect(created[0].value.works[0].id).toBeTruthy();
  }finally{await db.exec('rollback');await db.exec('reset role');}
});

it('saves new request finance to canonical task rows and preserves imported history',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true),($2,'engineer',true)",[id(1),id(2)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q('update jobs set engineer_ids=array[$2]::uuid[],assigned_engineer=$2 where id=$1',[id(10),id(2)]);
    const works=[{id:id(62),work_id:id(80),title:'',hours:3,billable:true,billable_reason:'',tariff_profile:'client',revenue_override:1000}];
    const parts=[{index:0,id:id(63),name:'Фильтр новый',sku:'F-2',unit:'шт',qty:2,billable:true,price:240,cost:150}];
    const rec={client_id:id(20),equipment_id:null,status:'open',scheduled_date:null,time_window:'',due_date:null,assigned_engineer:id(2),engineer_ids:[id(2)],notes:'canonical',at_depot:false,depot_id:null};
    const [result]=await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb) value',[id(10),JSON.stringify(rec),JSON.stringify(works),JSON.stringify(parts)]);
    expect(result.value.works[0]).toMatchObject({id:id(62),revenue:1000,approved_by:id(1)});
    expect(result.value.parts[0]).toMatchObject({id:id(63),price:240,cost:150,approved_by:id(1)});
    expect(await q('select id from job_works where id=$1',[id(62)])).toHaveLength(0);
    expect(await q('select id from job_parts where id=$1',[id(63)])).toHaveLength(0);
    const [work]=await q('select kind,planned_qty,financial_revenue_snapshot,legacy_job_work_id,legacy_snapshot->>\'revenue_override\' revenue_override from service_order_items where id=$1',[id(62)]);
    expect(work).toMatchObject({kind:'work',planned_qty:'3',financial_revenue_snapshot:'1000',legacy_job_work_id:null,revenue_override:'1000'});
    const [part]=await q('select kind,title,planned_qty,unit_price_snapshot,unit_cost_snapshot,legacy_job_part_id from service_order_items where id=$1',[id(63)]);
    expect(part).toMatchObject({kind:'material',title:'Фильтр новый',planned_qty:'2',unit_price_snapshot:'240.00',unit_cost_snapshot:'150.00',legacy_job_part_id:null});
    expect(await q('select id from service_order_items where legacy_job_work_id=$1',[id(60)])).toHaveLength(1);
    expect(await q('select id from service_order_items where legacy_job_part_id=$1',[id(70)])).toHaveLength(1);
    const [replay]=await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb) value',[id(10),JSON.stringify(rec),JSON.stringify(works),JSON.stringify(parts)]);
    expect(replay.value.works[0].id).toBe(id(62));
    expect(await q('select id from service_order_items where id in ($1,$2)',[id(62),id(63)])).toHaveLength(2);
    const [seed]=await q('select id from service_orders where seed_request_id=$1',[id(10)]);
    const [remaining]=await q("select coalesce(jsonb_agg(jsonb_build_object('id',id,'job_id',job_id,'kind',kind,'stock_catalog_id',stock_catalog_id,'work_catalog_id',work_catalog_id,'planned_qty',planned_qty,'title',title,'unit',unit,'billable',billable,'billable_reason',billable_reason,'tariff_profile',tariff_profile)),'[]'::jsonb) items from service_order_items where order_id=$1 and id not in ($2,$3)",[seed.id,id(62),id(63)]);
    await q('savepoint task_editor_cannot_remove_request_finance');
    await expect(q('select public.service_order_save_one($1,0,$2::jsonb,$3,$4::jsonb)',[seed.id,JSON.stringify({title:'Задание по заявке',work_mode:'onsite',engineer_ids:[],instructions:''}),id(10),JSON.stringify(remaining.items)])).rejects.toThrow('Строку заявки меняют только через редактор заявки');
    await q('rollback to savepoint task_editor_cannot_remove_request_finance');
    await q("select set_config('test.uid',$1,true)",[id(2)]);
    const engineerWorks=[{id:id(64),work_id:id(80),title:'',hours:1,billable:true,billable_reason:'',tariff_profile:'client',revenue_override:99999}];
    const [engineerResult]=await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,null) value',[id(10),JSON.stringify(rec),JSON.stringify(engineerWorks)]);
    expect(engineerResult.value.works[0]).toMatchObject({id:id(64),approved_at:null,approved_by:null,revenue:1200});
    await q("select set_config('test.uid',$1,true)",[id(3)]);
    await q('savepoint unrelated_engineer_denied');
    await expect(q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,null)',[id(10),JSON.stringify(rec),JSON.stringify([])])).rejects.toThrow('Нет доступа к заявке');
    await q('rollback to savepoint unrelated_engineer_denied');
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q('select public.job_request_finance_approve($1,$2::uuid[])',[id(10),[id(64)]]);
    const [approved]=await q('select approved_at is not null approved,approved_by from service_order_items where id=$1',[id(64)]);
    expect(approved).toEqual({approved:true,approved_by:id(1)});
  }finally{await db.exec('rollback');await db.exec('reset role');}
});

it('keeps manager approval when an engineer saves an unchanged request and rejects changing approved billability',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true),($2,'engineer',true)",[id(1),id(2)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q('update jobs set engineer_ids=array[$2]::uuid[],assigned_engineer=$2 where id=$1',[id(10),id(2)]);
    const rec={client_id:id(20),equipment_id:null,status:'open',scheduled_date:null,time_window:'',due_date:null,assigned_engineer:id(2),engineer_ids:[id(2)],notes:'approved',at_depot:false,depot_id:null};
    const works=[{id:id(65),work_id:id(80),hours:2,billable:true,tariff_profile:'client'}];
    const parts=[{id:id(66),name:'Новый фильтр',sku:'F-3',unit:'шт',qty:2,billable:true,price:100,cost:60}];
    await q("insert into service_order_items(id,order_id,job_id,title,unit,planned_qty,kind) values($1,(select id from service_orders where seed_request_id=$2),$2,'План задания','ч',1,'work')",[id(67),id(10)]);
    await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify(works),JSON.stringify(parts)]);
    await q("select set_config('test.uid',$1,true)",[id(2)]);
    await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify(works),JSON.stringify(parts)]);
    const rows=await q('select id,approved_at is not null approved,approved_by,billable from service_order_items where id in ($1,$2) order by id',[id(65),id(66)]);
    expect(rows).toEqual([{id:id(65),approved:true,approved_by:id(1),billable:true},{id:id(66),approved:true,approved_by:id(1),billable:true}]);
    expect(await q('select id from service_order_items where id=$1',[id(67)])).toHaveLength(1);
    await q('savepoint approved_billability');
    await expect(q('select public.job_request_save_canonical($1,$2::jsonb,null,$3::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([{...parts[0],billable:false}])])).rejects.toThrow('Подтверждённый материал');
    await q('rollback to savepoint approved_billability');
    await q('select public.job_request_save_canonical($1,$2::jsonb, $3::jsonb,$3::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([])]);
    expect(await q('select id from service_order_items where id in ($1,$2) order by id',[id(65),id(66)])).toEqual([{id:id(65)},{id:id(66)}]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q('savepoint approved_delete');
    await expect(q('select public.job_request_save_canonical($1,$2::jsonb,null,$3::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([])])).rejects.toThrow('подтверждённый материал');
    await q('rollback to savepoint approved_delete');
    await q("select set_config('test.uid',$1,true)",[id(2)]);
    await q('savepoint cross_kind');
    await expect(q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,null)',[id(10),JSON.stringify(rec),JSON.stringify([{...works[0],id:id(66)}])])).rejects.toThrow('тип строки');
    await q('rollback to savepoint cross_kind');
    await q('savepoint task_plan');
    await expect(q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,null)',[id(10),JSON.stringify(rec),JSON.stringify([{...works[0],id:id(67)}])])).rejects.toThrow('не принадлежит редактору заявки');
    await q('rollback to savepoint task_plan');
  }finally{await db.exec('rollback');}
});

it('audits finance voids and keeps stale legacy replay from restoring a voided amount',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const [work]=await q('select id,financial_revenue_snapshot from service_order_items where legacy_job_work_id=$1',[id(60)]);
    const [part]=await q('select id,unit_price_snapshot from service_order_items where legacy_job_part_id=$1',[id(70)]);
    const [voided]=await q('select public.job_request_finance_void($1,$2) value',[work.id,'Исправлена сумма в заявке']);
    expect(voided.value.item_id).toBe(work.id);
    await q('select public.job_request_finance_void($1,$2)',[part.id,'Исправлена цена материала']);
    const [event]=await q('select actor_id,reason,original_snapshot->>\'financial_revenue_snapshot\' revenue from request_finance_void_events where item_id=$1',[work.id]);
    expect(event).toEqual({actor_id:id(1),reason:'Исправлена сумма в заявке',revenue:'1200'});
    const [marked]=await q('select request_finance_void_event_id is not null voided,legacy_snapshot->>\'request_finance_void_reason\' reason from service_order_items where id=$1',[work.id]);
    expect(marked).toEqual({voided:true,reason:'Исправлена сумма в заявке'});
    const rec={client_id:id(20),equipment_id:null,status:'open',scheduled_date:null,time_window:'',due_date:null,assigned_engineer:null,engineer_ids:[],notes:'legacy replay',at_depot:false,depot_id:null};
    await q('select public.job_request_save($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([{id:id(60),work_id:id(80),title:'',hours:2.5,billable:true,billable_reason:'',revenue:1200,tariff_profile:'client'}]),JSON.stringify([{id:id(70),name:'Фильтр',sku:'F-1',unit:'шт',qty:2,price:100,cost:55,billable:true}])]);
    await q('delete from job_parts where id=$1',[id(70)]);
    expect(await q('select request_finance_void_event_id is not null voided from service_order_items where id=$1',[work.id])).toEqual([{voided:true}]);
    expect(await q('select id from job_works where id=$1',[id(60)])).toHaveLength(1);
    expect(await q('select id from job_parts where id=$1',[id(70)])).toHaveLength(1);
    expect(await q('select request_finance_void_event_id is not null voided from service_order_items where id=$1',[part.id])).toEqual([{voided:true}]);
    await q('savepoint repeated_void');
    await expect(q('select public.job_request_finance_void($1,$2)',[work.id,'Повторное аннулирование'])).rejects.toThrow('уже аннулирована');
    await q('rollback to savepoint repeated_void');
  }finally{await db.exec('rollback');}
});

it('keeps voided canonical request rows when a stale new-generation snapshot omits them',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const rec={client_id:id(20),equipment_id:null,status:'open',scheduled_date:null,time_window:'',due_date:null,assigned_engineer:null,engineer_ids:[],notes:'',at_depot:false,depot_id:null};
    const works=[{id:id(69),work_id:id(80),hours:1,billable:true,tariff_profile:'client'}];
    await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify(works),JSON.stringify([])]);
    await q('select public.job_request_finance_void($1,$2)',[id(69),'Дубликат строки в смете']);
    const replacement={id:id(77),work_id:id(80),title:'Исправленная работа',hours:2,billable:true,tariff_profile:'client'};
    await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([...works,replacement]),JSON.stringify([])]);
    const [event]=await q('select id from request_finance_void_events where item_id=$1',[id(69)]);
    const [linked]=await q('select public.job_request_finance_link_correction($1,$2) value',[event.id,id(77)]);
    expect(linked.value.replacement_item_id).toBe(id(77));
    expect(await q('select replacement_item_id from request_finance_correction_links where replacement_item_id=$1',[id(77)])).toHaveLength(1);
    await q('select public.job_request_save_canonical($1,$2::jsonb,$3::jsonb,$4::jsonb)',[id(10),JSON.stringify(rec),JSON.stringify([replacement]),JSON.stringify([])]);
    expect(await q('select request_finance_void_event_id is not null voided from service_order_items where id=$1',[id(69)])).toEqual([{voided:true}]);
    expect(await q('select item_id from request_finance_void_events where item_id=$1',[id(69)])).toHaveLength(1);
  }finally{await db.exec('rollback');}
});

it('uses depot and warranty tariff rules for task-only work snapshots',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q('insert into jobs(id,client_id,at_depot) values($1,$2,true)',[id(18),id(20)]);
    const data={title:'Робота в депо',work_mode:'depot',engineer_ids:[],instructions:''};
    const [created]=await q("select public.service_order_save_one(null,null,$1::jsonb,$2,$3::jsonb) id",[
      JSON.stringify(data),id(18),JSON.stringify([{job_id:id(18),kind:'work',title:'Ремонт',unit:'ч',planned_qty:2}])
    ]);
    const [depot]=await q('select tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1',[created.id]);
    expect(depot).toEqual({tariff_profile:'client',financial_revenue_snapshot:'1600.00',financial_cost_snapshot:'1500.00'});

    const [warrantyTask]=await q("insert into service_orders(title,work_mode,job_id) values('Гарантия','onsite',$1) returning id",[id(13)]);
    await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[warrantyTask.id,id(13)]);
    const [warranty]=await q("insert into service_order_items(order_id,job_id,title,unit,planned_qty,kind,billable) values($1,$2,'Гарантийная работа','ч',3,'work',false) returning tariff_profile,financial_revenue_snapshot,financial_cost_snapshot",[warrantyTask.id,id(13)]);
    expect(warranty).toEqual({tariff_profile:'warranty',financial_revenue_snapshot:'750.00',financial_cost_snapshot:'2250.00'});
  }finally{await db.exec('reset role; rollback');}
});

it('carries remaining work with request, material and work economics snapshots',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    await q("insert into stock_catalog(id,name,sku,unit,price,cost) values($1,'Насос','P-7','шт',1200,800)",[id(80)]);
    const [source]=await q("insert into service_orders(title,status,job_id) values('Замена насоса','in_progress',$1) returning id",[id(10)]);
    await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[source.id,id(10)]);
    const [item]=await q("insert into service_order_items(order_id,job_id,title,unit,planned_qty,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot) values($1,$2,'Насос','шт',5,'material',$3,'P-7',1200,800) returning id",[source.id,id(10),id(80)]);
    const [work]=await q("insert into service_order_items(order_id,job_id,title,unit,planned_qty,kind,work_catalog_id,billable,billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot) values($1,$2,'Сварка','ч',5,'work',$3,false,'Гарантия','warranty',900,3750) returning id",[source.id,id(10),id(80)]);
    await q('update service_order_items set done_qty=1 where id=any($1::uuid[])',[[item.id,work.id]]);
    const [carried]=await q("select public.service_order_carry($1,0,'Материал отсутствует') id",[source.id]);
    const [task]=await q('select job_id from service_orders where id=$1',[carried.id]);
    const [rel]=await q('select job_id from service_order_jobs where order_id=$1',[carried.id]);
    const [copy]=await q('select job_id,title,kind,source_item_id,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1 and source_item_id=$2',[carried.id,item.id]);
    const [workCopy]=await q('select job_id,title,kind,source_item_id,work_catalog_id,billable,billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where order_id=$1 and source_item_id=$2',[carried.id,work.id]);
    expect(task.job_id).toBe(id(10));
    expect(rel.job_id).toBe(id(10));
    expect(copy).toMatchObject({job_id:id(10),title:'Насос',kind:'material',source_item_id:item.id,stock_catalog_id:id(80),sku_snapshot:'P-7',unit_price_snapshot:'1200.00',unit_cost_snapshot:'800.00',financial_revenue_snapshot:'4800.00',financial_cost_snapshot:'3200.00'});
    expect(workCopy).toMatchObject({job_id:id(10),title:'Сварка',kind:'work',source_item_id:work.id,work_catalog_id:id(80),billable:false,billable_reason:'Гарантия',tariff_profile:'warranty',financial_revenue_snapshot:'1000.00',financial_cost_snapshot:'3000.00'});
  }finally{await db.exec('rollback');}
});

it('does not guess a request when a legacy multi-request task has remaining work for several requests',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const [source]=await q("insert into service_orders(title,status,job_id) values('Старое общее задание','in_progress',null) returning id");
    await q('insert into service_order_jobs(order_id,job_id) values($1,$2),($1,$3)',[source.id,id(10),id(11)]);
    await q("insert into service_order_items(order_id,job_id,title,planned_qty) values($1,$2,'Работа А',2),($1,$3,'Работа Б',3)",[source.id,id(10),id(11)]);
    const before=Number((await q('select count(*) n from service_orders'))[0].n);
    await db.exec('savepoint ambiguous_carry');
    await expect(q("select public.service_order_carry($1,0,'Разделить остаток')",[source.id])).rejects.toThrow('нескольким заявкам');
    await db.exec('rollback to savepoint ambiguous_carry');
    expect(Number((await q('select count(*) n from service_orders'))[0].n)).toBe(before);
    expect((await q('select sum(transferred_qty) transferred from service_order_items where order_id=$1',[source.id]))[0].transferred).toBe('0');
  }finally{await db.exec('rollback');}
});

it('reconciles legacy request edits without dropping other task selections',async()=>{
  await db.exec('begin');
  try{
    await q('update trip_jobs set job_id=$1 where trip_id=$2 and job_id=$3',[id(12),id(30),id(10)]);
    const expected=[id(11),id(12)].sort();
    const links=await q('select o.job_id from trip_service_orders tso join service_orders o on o.id=tso.order_id where tso.trip_id=$1 order by o.job_id',[id(30)]);
    expect(links.map(row=>row.job_id)).toEqual(expected);

    await q('update trip_jobs set ord=ord+5 where trip_id=$1 and job_id=$2',[id(30),id(11)]);
    const afterReorder=await q('select o.job_id from trip_service_orders tso join service_orders o on o.id=tso.order_id where tso.trip_id=$1 order by o.job_id',[id(30)]);
    expect(afterReorder.map(row=>row.job_id)).toEqual(expected);
  }finally{await db.exec('rollback');}
});

it('rejects removing a task with approved stay allocation unless that stay is explicitly reassigned atomically',async()=>{
  await db.exec('begin');
  try{
    await q("insert into profiles(id,role,active) values($1,'logist',true)",[id(1)]);
    await q("insert into profiles(id,role,active) values($1,'engineer',true)",[id(3)]);
    await q("select set_config('test.uid',$1,true)",[id(1)]);
    const [old]=await q('select id from service_orders where seed_request_id=$1',[id(10)]);
    const [keep]=await q('select id from service_orders where seed_request_id=$1',[id(11)]);
    const [replacement]=await q("insert into service_orders(title,work_mode,job_id) values('Дополнительная работа','onsite',$1) returning id",[id(10)]);
    const [replacement2]=await q("insert into service_orders(title,work_mode,job_id) values('Вторая дополнительная работа','onsite',$1) returning id",[id(10)]);
    await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[replacement.id,id(10)]);
    await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[replacement2.id,id(10)]);
    await q('insert into trip_service_orders(trip_id,order_id) values($1,$2)',[id(30),replacement.id]);
    await q('insert into trip_service_orders(trip_id,order_id) values($1,$2)',[id(30),replacement2.id]);
    await q('update trip_stays set service_order_id=$1 where id=$2',[old.id,id(40)]);
    await q("update trip_stays set stay_to=stay_from+interval '70 minutes' where id=$1",[id(40)]);
    await q('insert into trip_stay_task_allocations(stay_id,service_order_id,share,source) values($1,$2,1,\'manager\') on conflict do nothing',[id(40),old.id]);
    await q('update trip_stays set task_allocations_explicit=true where id=$1',[id(40)]);
    await q("insert into trip_cost_allocation_runs(trip_id,source_revision,fact_km,components,diagnostics,approval_reason) values($1,(select workbench_revision from trips where id=$1),0,'{}','{}','До замены')",[id(30)]);
    const before=await q('select order_id from trip_service_orders where trip_id=$1 order by order_id',[id(30)]);
    const revision=(await q('select workbench_revision from trips where id=$1',[id(30)]))[0].workbench_revision;
    const call=(stays)=>q('select dlight_private.trip_plan_save_tasks($1,$2,$3,$4,$5,$6)',[id(30),revision,{},[keep.id,replacement.id,replacement2.id],'Замена задания',stays]);

    await db.exec('savepoint without_explicit_reallocation');
    await expect(call(null)).rejects.toThrow();
    await db.exec('rollback to savepoint without_explicit_reallocation');
    expect(await q('select order_id from trip_service_orders where trip_id=$1 order by order_id',[id(30)])).toEqual(before);
    expect((await q('select service_order_id from trip_stays where id=$1',[id(40)]))[0].service_order_id).toBe(old.id);
    expect((await q('select service_order_id from trip_stay_task_allocations where stay_id=$1',[id(40)]))[0].service_order_id).toBe(old.id);
    expect((await q('select workbench_revision from trips where id=$1',[id(30)]))[0].workbench_revision).toBe(revision);

    const stays=[{id:id(40),job_id:id(10),service_order_id:null,crew_ids:[id(3)],minutes_mgr:70,status:'approved',task_allocations:[{order_id:replacement.id,share:0.4},{order_id:replacement2.id,share:0.6}]}];
    await call(stays);
    expect((await q('select service_order_id from trip_stays where id=$1',[id(40)]))[0].service_order_id).toBeNull();
    const allocations=await q('select service_order_id,share from trip_stay_task_allocations where stay_id=$1',[id(40)]);
    expect(Object.fromEntries(allocations.map(row=>[row.service_order_id,row.share]))).toEqual({
      [replacement.id]:'0.400000',[replacement2.id]:'0.600000'
    });
    expect(await q('select 1 from trip_service_orders where trip_id=$1 and order_id=$2',[id(30),old.id])).toHaveLength(0);
    const [run]=await q('select source_revision,current from trip_cost_allocation_runs where trip_id=$1',[id(30)]);
    const [after]=await q('select workbench_revision from trips where id=$1',[id(30)]);
    expect(Number(after.workbench_revision)).toBeGreaterThan(Number(run.source_revision));
    expect(run.current).toBe(true);
  }finally{await db.exec('rollback');}
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
  await q("insert into clients(id,name,lat,lng) values($1,'E',54,34)",[id(24)]);
  await q('insert into jobs(id,client_id) values($1,$2)',[id(14),id(24)]);
  await q("insert into trips(id,status) values($1,'planned')",[id(33)]);
  await q('insert into trip_jobs(trip_id,job_id,ord) values($1,$2,0)',[id(33),id(14)]);
  const seeded=await q('select id from service_orders where seed_request_id=$1',[id(14)]);
  const linked=await q('select order_id from trip_service_orders where trip_id=$1',[id(33)]);
  expect(seeded).toHaveLength(1);expect(linked.map(r=>r.order_id)).toEqual([seeded[0].id]);
  await db.exec('rollback');
});
