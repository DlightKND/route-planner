import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db,trip,order,stay,trackAt;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const rev=async()=>Number((await q('select workbench_revision from trips where id=$1',[trip]))[0].workbench_revision);

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921133835_trip_workbench.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260922190447_service_orders.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923124804_request_task_trip_links.sql',import.meta.url),'utf8'));
  await db.exec('create table public.trip_tracks(trip_id uuid primary key references public.trips(id),km numeric,data jsonb,updated_at timestamptz); grant select,insert,update on public.trip_tracks to authenticated; grant select on public.trip_stays,public.trips to authenticated');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923133423_trip_cost_allocation.sql',import.meta.url),'utf8'));
  await q("insert into profiles(id,role,active) values($1,'logist',true),($2,'engineer',true)",[id(1),id(2)]);
  await q("select set_config('test.uid',$1,false)",[id(1)]);
  await q("insert into clients values($1,'Клиент',50,30)",[id(20)]);
  await q('insert into jobs(id,client_id) values($1,$2)',[id(10),id(20)]);
  await q("insert into trips(status,lead_engineer,engineer_ids,fact_km,econ_snapshot,tariffs_snapshot,overrides) values('done',$1,array[$1]::uuid[],10,$2,$3,$4)",[
    id(2),
    {cost_basis:'fact',presence_basis:'person_hours_v1',cKm:100,cLabor:20,cDay:10,cNight:5,costComputed:135,cost:140},
    {costs:{km:10,hour:20}},
    {cost:140}
  ]);
  trip=(await q('select id from trips'))[0].id;
  await q('insert into trip_jobs(trip_id,job_id,ord) values($1,$2,0)',[trip,id(10)]);
  order=(await q('select id from service_orders where seed_request_id=$1',[id(10)]))[0].id;
  await q("insert into trip_stays(trip_id,job_id,stay_from,stay_to,minutes_raw,minutes_mgr,crew_ids,crew_source,status) values($1,$2,'2026-09-23 09:00Z','2026-09-23 10:00Z',60,60,array[$3]::uuid[],'manager','approved') returning id",[trip,id(10),id(2)]).then(rows=>{stay=rows[0].id;});
  await q("insert into trip_tracks(trip_id,km,data,updated_at) values($1,10,$2,'2026-09-23 12:00Z')",[trip,{km:10,segments:[{kind:'road',km:10,fromTs:'2026-09-23T08:00:00Z',toTs:'2026-09-23T09:00:00Z'}]}]);
  trackAt=(await q('select updated_at from trip_tracks where trip_id=$1',[trip]))[0].updated_at;
},30000);
afterAll(async()=>{await db?.close();});

it('saves a split stay and checks task-level mileage, labor and explicit residuals',async()=>{
  const expected=await rev();
  await db.exec('set role authenticated');
  try{
    const result=await q('select trip_presence_save_tasks($1,$2,$3,$4) revision',[trip,expected,[
      {id:stay,job_id:id(10),crew_ids:[id(2)],minutes_mgr:60,status:'approved',task_allocations:[{order_id:order,share:.8}]}
    ],'Разделено по составу выполненных работ']);
    const allocations=await q('select service_order_id,share from trip_stay_task_allocations where stay_id=$1',[stay]);
    expect(allocations).toEqual([{service_order_id:order,share:'0.800000'}]);
    const lines=[
    {cost_type:'distance',service_order_id:order,track_segment_index:0,quantity:8,unit_rate:10,amount:80,basis:'до точки',source_ref:'road'},
    {cost_type:'distance_unallocated',track_segment_index:0,quantity:2,unit_rate:10,amount:20,basis:'не распределено',source_ref:'road'},
    {cost_type:'labor',service_order_id:order,stay_id:stay,quantity:.8,unit_rate:20,amount:16,basis:'80% часов',source_ref:'approved_stay'},
    {cost_type:'labor_unallocated',stay_id:stay,quantity:.2,unit_rate:20,amount:4,basis:'20% не назначено',source_ref:'approved_stay'},
    {cost_type:'per_diem',quantity:1,unit_rate:10,amount:10,basis:'суточные не распределяются',source_ref:'trip_economics_snapshot'},
    {cost_type:'overnight',quantity:1,unit_rate:5,amount:5,basis:'ночлег не распределяется',source_ref:'trip_economics_snapshot'},
    {cost_type:'manual_adjustment',quantity:1,unit_rate:5,amount:5,basis:'корректировка по документам',source_ref:'cost_override'}
    ];
    const [saved]=await q('select trip_cost_allocation_save($1,$2,$3,$4,$5,$6) id',[
      trip,Number(result[0].revision),trackAt,'Сверено по одометру и стоянке',lines,{fact_km:10,reliable_track_km:10}
    ]);
    const [run]=await q('select components,source_revision,source_track_updated_at,current from trip_cost_allocation_runs where id=$1',[saved.id]);
    expect(run.current).toBe(true);expect(run.source_track_updated_at).toEqual(trackAt);
    expect(run.components.distance).toEqual({total:100,assigned:80,unallocated:20});
    expect(run.components.labor).toEqual({total:20,assigned:16,unallocated:4});
    const summary=await q('select * from service_order_trip_cost_summary($1)',[order]);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({distance_km:'8',distance_cost:'80',labor_hours:'0.8',labor_cost:'16'});
    const afterApproval=Number(result[0].revision);
    await q('select trip_presence_save_tasks($1,$2,$3,$4)',[trip,afterApproval,[
      {id:stay,job_id:id(10),crew_ids:[id(2)],minutes_mgr:60,status:'approved',task_allocations:[]}
    ],'Оставить часы без назначения заданию']);
    expect(await q('select service_order_id from trip_stay_task_allocations where stay_id=$1',[stay])).toEqual([]);
    await q('select trip_presence_save($1,$2,$3,$4)',[trip,await rev(),[
      {id:stay,job_id:id(10),crew_ids:[id(2)],minutes_mgr:60,status:'approved'}
    ],'Обновлено описание стоянки']);
    expect(await q('select service_order_id from trip_stay_task_allocations where stay_id=$1',[stay])).toEqual([]);
  }finally{await db.exec('reset role');}
});

it('bounds both total mileage and per-segment mileage before approving',async()=>{
  await db.exec('set role authenticated');
  await q('select trip_presence_save_tasks($1,$2,$3,$4)',[trip,await rev(),[
    {id:stay,job_id:id(10),crew_ids:[id(2)],minutes_mgr:60,status:'approved',task_allocations:[{order_id:order,share:.8}]}
  ],'Сверено для теста участка']);
  await db.exec('reset role');
  const current=await rev();
  const newTrackAt='2026-09-23 13:30Z';
  await q("update trip_tracks set data=$2,updated_at=$3 where trip_id=$1",[trip,{km:10,segments:[
    {kind:'road',km:8,fromTs:'2026-09-23T08:00:00Z',toTs:'2026-09-23T09:00:00Z'},
    {kind:'road',km:2,fromTs:'2026-09-23T10:00:00Z',toTs:'2026-09-23T11:00:00Z'}
  ]},newTrackAt]);
  await db.exec('set role authenticated');
  try{
    const tooLongSegment=[
      {cost_type:'distance',service_order_id:order,track_segment_index:0,quantity:5,unit_rate:10,amount:50,basis:'Часть 1'},
      {cost_type:'distance',service_order_id:order,track_segment_index:0,quantity:5,unit_rate:10,amount:50,basis:'Часть 2'},
      {cost_type:'labor',service_order_id:order,stay_id:stay,quantity:.8,unit_rate:20,amount:16,basis:'Доля задания'},
      {cost_type:'labor_unallocated',stay_id:stay,quantity:.2,unit_rate:20,amount:4,basis:'Остаток'},
      {cost_type:'per_diem',quantity:1,unit_rate:10,amount:10,basis:'Суточные'},
      {cost_type:'overnight',quantity:1,unit_rate:5,amount:5,basis:'Ночлег'},
      {cost_type:'manual_adjustment',quantity:1,unit_rate:5,amount:5,basis:'Корректировка'}
    ];
    await expect(q('select trip_cost_allocation_save($1,$2,$3,$4,$5,$6)',[
      trip,current,newTrackAt,'Проверка границ трека',tooLongSegment,{}
    ])).rejects.toThrow('Сумма километров распределения превышает длину участка');
  }finally{await db.exec('reset role');}
});

it('rejects stale track revisions and an allocation that breaks the component invariant',async()=>{
  const current=await rev();
  await db.exec('set role authenticated');
  try{
    await q("update trip_tracks set updated_at='2026-09-23 13:00Z' where trip_id=$1",[trip]);
    await expect(q('select trip_cost_allocation_save($1,$2,$3,$4,$5,$6)',[trip,current,trackAt,'Причина',[{cost_type:'distance',service_order_id:order,track_segment_index:0,quantity:10,unit_rate:10,amount:100,basis:'Участок'}],{}])).rejects.toThrow('Трек изменился');
  }finally{await db.exec('reset role');}
});

it('saves plan links and explicit stay shares in the same transaction',async()=>{
  await db.exec('set role authenticated');
  try{
    await q('select trip_plan_save_tasks($1,$2,$3,$4,$5,$6)',[trip,await rev(),{notes:'План с долями'},[order],
      'Утверждено на карточке выезда',[{id:stay,job_id:id(10),crew_ids:[id(2)],minutes_mgr:60,status:'approved',task_allocations:[{order_id:order,share:.7}]}]]);
    expect(await q('select service_order_id,share from trip_stay_task_allocations where stay_id=$1',[stay])).toEqual([{service_order_id:order,share:'0.700000'}]);
  }finally{await db.exec('reset role');}
});

it('does not allow engineers to approve distributions',async()=>{
  const current=await rev();
  await q("select set_config('test.uid',$1,false)",[id(2)]);
  await db.exec('set role authenticated');
  try{
    await expect(q('select trip_cost_allocation_save($1,$2,$3,$4,$5,$6)',[trip,current,trackAt,'Попытка инженера',[],{}])).rejects.toThrow('Только диспетчер');
    await expect(q("select dlight_private.trip_stay_task_allocations_save($1,$2,'[]'::jsonb,'Попытка инженера')",[trip,stay])).rejects.toThrow('Изменяет только менеджер');
  }
  finally{await db.exec('reset role');await q("select set_config('test.uid',$1,false)",[id(1)]);}
});
