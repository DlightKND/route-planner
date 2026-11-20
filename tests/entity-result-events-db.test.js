import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {calculateEntityFinance} from '../src/scoped-finance.js';

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
    alter table service_order_items add column kind text default 'work',add column billable boolean not null default true,
      add column legacy_snapshot jsonb not null default '{}',add column request_finance_void_event_id bigint,add column financial_revenue_snapshot numeric,add column financial_cost_snapshot numeric,add column unit_price_snapshot numeric,add column unit_cost_snapshot numeric;
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
  await db.exec('alter table trips add column workbench_revision integer not null default 0;alter table trip_stays add column crew_ids uuid[],add column crew_source text;');
  await db.exec(file('../supabase/migrations/20261120085354_order_trip_results.sql'));
  await db.exec(file('../supabase/migrations/20261120134312_order_work_plan.sql'));
  await db.exec(file('../supabase/migrations/20261120141912_order_work_parts.sql'));
  await db.exec(file('../supabase/migrations/20261120145437_order_extra_parts.sql'));
  await db.exec(file('./fixtures/order-photo-storage.sql'));
  await db.exec(file('../supabase/migrations/20261120150932_order_result_photos.sql'));
  await db.exec(file('../supabase/migrations/20261120190426_entity_payment_terms.sql'));
  await db.exec(`create table public.trip_tracks(trip_id uuid primary key references public.trips(id),data jsonb,updated_at timestamptz);
     alter table public.trip_stays add column presence_evidence jsonb;
     alter table public.service_order_items add column tariff_profile text,add column created_at timestamptz;
     alter table public.settings add column tariffs jsonb,add column costs jsonb,add column tariff_profiles jsonb;`);
  await db.exec(file('../supabase/migrations/20261120193258_journal_road_sections.sql'));
  await db.exec(file('../supabase/migrations/20261120195251_journal_road_split_preview.sql'));
  await db.exec(`alter table public.settings add column currency text;
    alter table public.trips add column plan_econ_snapshot jsonb;
    create table public.trip_cost_allocation_runs(id uuid primary key,trip_id uuid,current boolean,source_revision int,
      source_track_updated_at timestamptz,fact_km numeric);
    create table public.trip_cost_allocations(run_id uuid,cost_type text,service_order_id uuid,quantity numeric,amount numeric);`);
  await db.exec(file('../supabase/migrations/20261120200145_scoped_finance_workspace.sql'));
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

it('projects accepted work, road and approved allocation across cards with audited independent corrections',async()=>{
  const readFinance=(scope,entity)=>q('select public.entity_finance_read($1,$2) model',[scope,id(entity)]).then(rows=>rows[0].model);
  const adjust=(scope,entity,subject,prior,value)=>q('select public.entity_finance_adjust($1,$2,$3,$4,$5) saved',
    [scope,id(entity),subject,prior,value]).then(rows=>rows[0].saved);
  expect(await readFinance('order',30)).toBeNull();
  await rejected(()=>adjust('order',30,'fact:revenue',{},{value:1,reason:'Отказ'}),/куратор/);
  await addConfirmedVisit(50);
  await db.exec('reset role');
  const trackAt='2026-10-05T12:00:00Z';
  await q("update trips set fact_km=20,econ_snapshot=$2,tariffs_snapshot=$3 where id=$1",
    [id(50),{km:21,rTravel:420,cKm:160},{tariffs:{km:20},costs:{km:8},tariff_profiles:[]}]);
  await q('insert into trip_tracks values($1,$2,$3)',[id(50),{segments:[{kind:'track',km:20,fromTs:'2026-10-05T07:00:00Z',toTs:'2026-10-05T08:00:00Z'}]},trackAt]);
  await q("insert into trip_cost_allocation_runs values($1,$2,true,0,$3,20)",[id(124),id(50),trackAt]);
  await q("insert into trip_cost_allocations values($1,'distance',$2,20,160)",[id(124),id(30)]);
  await as(3);
  await visitResult({extraParts:[{id:id(133),work_id:id(40),title:'Винт',unit:'шт',qty:2,unit_cost:12.75}]});
  await as(6);
  const submitted=await readFinance('trip',50);
  expect(submitted.lines[0]).toMatchObject({fact_qty:0,fact_hours:null});
  expect(submitted.extra_parts_cost).toBe(0);
  await visitResult({prior:100,operation:101,action:'accepted',extraParts:[{id:id(133),work_id:id(40),title:'Винт',unit:'шт',qty:2,unit_cost:12.75}]});
  for(const [scope,entity] of [['job',10],['order',30],['trip',50]]){
    const model=await readFinance(scope,entity),sum=calculateEntityFinance(model);
    expect(model.extra_parts_cost).toBe(25.5);
    expect(sum.breakdown.filter(row=>['Приход от пробега','Расход на выезды'].includes(row[0])))
      .toEqual([['Приход от пробега',420,400],['Расход на выезды',168,160]]);
    expect(sum.modes.fact).toMatchObject({revenue:1650,cost:1419.5});
  }
  const rates={plan:{revenue:100},fact:{revenue:200,cost:30}};
  await rejected(()=>adjust('work',30,id(40),{},{fact:{cost:-1}}),/тарифы/);
  await rejected(()=>adjust('work',30,id(41),{},rates),/не принадлежит/);
  expect(await adjust('work',30,id(40),{},rates)).toEqual(rates);
  await rejected(()=>adjust('work',30,id(40),{},rates),/изменились/);
  expect(calculateEntityFinance(await readFinance('trip',50)).modes.fact).toMatchObject({revenue:600,cost:245.5});
  await rejected(()=>adjust('trip',50,'fact:revenue',{},{value:910,reason:' '}),/причину/);
  const override={value:910,reason:'Утверждённая смета'};
  expect(await adjust('trip',50,'fact:revenue',{},override)).toEqual(override);
  const revised=calculateEntityFinance(await readFinance('trip',50));
  expect(revised.modes.fact.revenue).toBe(910);expect(revised.calculated.fact.revenue).toBe(600);
  expect(calculateEntityFinance(await readFinance('job',10)).modes.fact.revenue).toBe(600);
  expect(await adjust('trip',50,'fact:revenue',override,{})).toEqual({});
  expect(calculateEntityFinance(await readFinance('trip',50)).modes.fact.revenue).toBe(600);
  await db.exec('reset role');
  expect(await q('select scope,subject,actor_id from dlight_private.finance_adjustment_events order by id')).toHaveLength(3);
  expect(await q('select financial_revenue_snapshot,financial_cost_snapshot from service_order_items where id=$1',[id(40)]))
    .toEqual([{financial_revenue_snapshot:'2500',financial_cost_snapshot:'1234'}]);
});

it('prices verified road intervals independently of stops, preserves shares on split and guards stale edits',async()=>{
  const iso=hour=>'2026-10-05T'+hour+':00Z';
  const segment=(kind,km,from,to,why)=>({kind,km,fromTs:iso(from),toTs:iso(to),why});
  const segments=[segment('track',10,'08:00','09:00'),segment('road',20,'09:30','10:30'),
    segment('line',99,'10:30','11:00'),segment('road',4,'11:00','11:00','возвращение на финиш')];
  await db.exec('reset role');
  await q('insert into trip_tracks values($1,$2,$3)',[id(50),{segments},iso('12:00')]);
  await q("insert into trip_stays(id,trip_id,job_id,stay_from,stay_to,status) values($1,$2,$3,$4,$5,'approved')",
    [id(85),id(50),id(10),iso('09:00'),iso('09:30')]);
  const readRoad=()=>q('select public.journal_road_read($1) model',[id(50)]).then(rows=>rows[0].model);
  const save=(model,section,action,value)=>q('select public.journal_road_save($1,$2,$3,$4,$5,$6::jsonb) model',
    [id(50),section,model.revision,model.source,action,action==='split'?String(value)+'.000000':JSON.stringify(value)]).then(rows=>rows[0].model);
  const first='start~'+id(85);
  await as(7);await rejected(readRoad,/недоступен/);
  await as(3);
  const original=await readRoad();
  expect(original).toMatchObject({editable:false,revision:0,sections:[
    {id:first,km:10,measured_km:10,shares:{[id(10)]:10},returning:false},
    {id:id(85)+'~finish',km:null,measured_km:24,shares:{},returning:true}]});
  await rejected(()=>save(original,first,'terms',{payer:'service'}),/куратор/);
  await as(6);
  await rejected(()=>save(original,first,'shares',{[id(11)]:1}),/километры/);
  await rejected(()=>save(original,first,'shares',{[id(10)]:10.01}),/больше длины/);
  let latest=await save(original,first,'shares',{[id(10)]:6.03});
  await rejected(()=>save(original,first,'terms',{payer:'service'}),/Маршрут изменился/);
  latest=await save(latest,first,'terms',{payer:'service',warranty:'warranty'});
  await rejected(()=>save(latest,first,'rates',{revenue:-1}),/тарифы/);
  latest=await save(latest,first,'rates',{revenue:23.5,cost:10});
  const cut=Date.parse(iso('08:30'))/1000;
  const preview=async(model,section,at)=>q('select public.journal_road_split_preview($1,$2,$3,$4,$5) quote',
    [id(50),section,model.revision,model.source,at]).then(rows=>rows[0].quote);
  expect(await preview(latest,first,cut)).toEqual({left:5,right:5});
  expect(await preview(latest,id(85)+'~finish',Date.parse(iso('10:00'))/1000)).toEqual({left:10,right:null});
  await rejected(()=>preview(original,first,cut),/Маршрут изменился/);
  latest=await save(latest,first,'split',cut);
  expect(latest.sections.slice(0,2)).toMatchObject([
    {id:first,km:5,shares:{[id(10)]:3.02},local:{payer:'service',warranty:'warranty'},rates:{revenue:23.5,cost:10}},
    {id:first+'~'+cut,km:5,shares:{[id(10)]:3.01},local:{payer:'service',warranty:'warranty'},rates:{revenue:23.5,cost:10}}]);
  const [exceptions]=await q("select public.journal_road_exceptions('job',$1) rows",[id(10)]);
  expect(exceptions.rows[0].sections.map(row=>row.id)).toEqual([first,first+'~'+cut]);
  await as(3);
  expect(await readRoad()).toMatchObject({tariffs:null,sections:[{rates:null},{rates:null},{rates:null}]});
  await db.exec('reset role');
  await q("update trip_tracks set updated_at=$2 where trip_id=$1",[id(50),iso('12:10')]);
  expect(await q('select action from dlight_private.journal_road_events order by revision')).toEqual(['shares','terms','rates','split'].map(action=>({action})));
  await as(6);await rejected(()=>save(latest,first,'terms',{}),/Маршрут изменился/);
});

it('keeps a carried request plan intact and divides a shared road only by verified task shares',async()=>{
  const read=(scope,parent)=>q('select public.entity_finance_read($1,$2) model',[scope,id(parent)]).then(rows=>rows[0].model);
  await addConfirmedVisit(50);
  await db.exec('reset role');
  await q("insert into service_orders(id,job_id,title,status,owner_id,curator_id) values($1,$2,'Остаток','in_progress',$3,$3)",[id(32),id(10),id(6)]);
  await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[id(32),id(10)]);
  await q('insert into trip_service_orders values($1,$2)',[id(50),id(32)]);
  await q('update service_order_items set done_qty=1,transferred_qty=1 where id=$1',[id(40)]);
  await q("insert into service_order_items(id,order_id,job_id,source_item_id,title,planned_qty,done_qty,unit,financial_revenue_snapshot,financial_cost_snapshot) values($1,$2,$3,$4,'Осмотр · остаток',1,1,'ч',1250,617)",
    [id(42),id(32),id(10),id(40)]);
  const trackAt='2026-10-05T12:00:00Z';
  await q("update trips set fact_km=20,econ_snapshot=$2,tariffs_snapshot=$3 where id=$1",
    [id(50),{km:21,rTravel:420,cKm:160},{tariffs:{km:20},costs:{km:8},tariff_profiles:[]}]);
  await q('insert into trip_tracks values($1,$2,$3)',[id(50),{segments:[{kind:'track',km:20,fromTs:'2026-10-05T07:00:00Z',toTs:'2026-10-05T08:00:00Z'}]},trackAt]);
  await as(6);
  const check=async(scope,parent)=>calculateEntityFinance(await read(scope,parent)).breakdown.find(row=>row[0]==='Приход от пробега');
  expect(await check('order',30)).toEqual(['Приход от пробега',null,null]);
  const request=await read('job',10);
  expect(request.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({id:id(40),root_id:id(40),plan_qty:2,fact_qty:1}),expect.objectContaining({id:id(42),root_id:id(40),plan_qty:0,fact_qty:1})]));
  expect(calculateEntityFinance(request).modes.fact.partial).toBe(false);
  await db.exec('reset role');
  await q("insert into trip_cost_allocation_runs values($1,$2,true,0,$3,20)",[id(124),id(50),trackAt]);
  await q("insert into trip_cost_allocations values($1,'distance',$2,6,48),($1,'distance',$3,14,112)",[id(124),id(30),id(32)]);
  await as(6);
  expect(await check('job',10)).toEqual(['Приход от пробега',420,400]);
  expect(await check('order',30)).toEqual(['Приход от пробега',null,120]);
  expect(await check('order',32)).toEqual(['Приход от пробега',null,280]);
});

it('saves independent payment overrides and resets them with an audit trail',async()=>{
  const readTerms=(scope,parent)=>q('select public.entity_payment_terms_read($1,$2) model',[scope,id(parent)]).then(rows=>rows[0].model);
  const save=(scope,parent,previous,terms,subject='')=>q('select public.entity_payment_terms_save($1,$2,$3,$4,$5) terms',
    [scope,id(parent),subject,previous,terms]).then(rows=>rows[0].terms);
  expect(await readTerms('order',30)).toMatchObject({editable:false,item:{job:{id:id(10)},local:{},works:[{id:id(40),local:{}}]}});
  await rejected(()=>readTerms('order',31),/недоступны/);
  await rejected(()=>save('work',30,{},{warranty:'warranty'},id(40)),/куратор/);
  await rejected(()=>q('select * from dlight_private.payment_terms'),/permission denied/);
  await as(6);
  const jobTerms={warranty:'warranty',payer:'warranty-dept'};
  expect(await save('job',10,{},jobTerms)).toEqual(jobTerms);
  await rejected(()=>save('job',10,{},jobTerms),/Обновите карточку/);
  await rejected(()=>save('work',30,{},{warranty:'warranty'},id(41)),/не принадлежит/);
  await rejected(()=>save('trip',50,{},{payer:'client:'+id(11)}),/связанных заявок/);
  await rejected(()=>save('order',30,{},{cost:9}),/Проверьте условия/);
  const workTerms={payer:'service'};
  expect(await save('work',30,{},workTerms,id(40))).toEqual(workTerms);
  expect(await readTerms('job',10)).toMatchObject({editable:true,item:{local:jobTerms},orders:[{local:{},works:[{local:workTerms}]}],
    trips:[{id:id(50),local:{},jobs:[{local:jobTerms}]}]});
  expect(await save('work',30,workTerms,{},id(40))).toEqual({});
  await db.exec('reset role');
  const history=await q('select scope,actor_id,current_terms from dlight_private.payment_term_changes order by id');
  expect(history).toEqual([['job',jobTerms],['work',workTerms],['work',{}]].map(([scope,current_terms])=>({scope,actor_id:id(6),current_terms})));
  expect(await q('select financial_revenue_snapshot,financial_cost_snapshot from service_order_items where id=$1',[id(40)]))
    .toEqual([{financial_revenue_snapshot:'2500',financial_cost_snapshot:'1234'}]);
});

it('saves an audited planning norm with a fresh revision and preserves the quantity and finance snapshots',async()=>{
  const save=(revision,hours,item=40)=>q('select public.service_order_work_plan_save($1,$2,$3,$4) result',
    [id(30),id(item),revision,hours]).then(rows=>rows[0].result);
  await rejected(()=>save(0,4.25),/менеджер задания/);
  await as(6);
  await rejected(()=>save(0,4.25,41),/не принадлежит/);
  await rejected(()=>save(0,-1),/10 000/);
  const previous=(await q('select planned_qty,done_qty,financial_revenue_snapshot,financial_cost_snapshot from service_order_items where id=$1',[id(40)]))[0];
  expect(await save(0,4.255)).toEqual({revision:1,hours:4.26});
  expect(await save(1,4.26)).toEqual({revision:1,hours:4.26});
  await rejected(()=>save(0,2),/изменено другим/);
  const [item]=await q('select planned_qty,done_qty,financial_revenue_snapshot,financial_cost_snapshot,planned_labor_hours from service_order_items where id=$1',[id(40)]);
  expect(item).toEqual({...previous,planned_labor_hours:'4.26'});
  const [history]=await q('select actor_id, snapshot from service_order_history where order_id=$1',[id(30)]);
  expect(history).toMatchObject({actor_id:id(6),snapshot:{work_item_id:id(40),planned_labor_hours:null}});
  expect(await q('select id from service_order_history where order_id=$1',[id(30)])).toHaveLength(1);
  await db.exec('reset role');
  await q("update service_orders set status='cancelled' where id=$1",[id(30)]);
  await as(6);
  await rejected(()=>save(1,6),/закрытого задания/);
});

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


const visitResult=async({order=30,trip=50,expected=0,gps=0,prior=null,operation=100,action='submitted',items=[{id:id(40),qty:1,hours:2,note:'Осталась проверка'}],reason='',correction='',extraParts,photos}={})=>(await q(
  'select public.service_order_trip_result_write($1,$2,$3,$4,$5,$6,$7,$8) result',
  [id(order),id(trip),expected,gps,prior?id(prior):null,id(operation),action,{items,reason,correction,
    ...(extraParts===undefined?{}:{extra_parts:extraParts}),...(photos===undefined?{}:{photos})}]
))[0].result;
const readVisits=async order=>(await q('select public.service_order_trip_results($1) result',[id(order)]))[0].result;
const readVisitQueue=async()=>(await q('select public.service_order_trip_review_queue() result'))[0].result;
const addConfirmedVisit=async n=>{
  await db.exec('reset role');
  await q("update trips set status='done' where id=$1",[id(n)]);
  await q("insert into trip_stays(trip_id,job_id,stay_from,stay_to,status,minutes_mgr,crew_ids,crew_source) values($1,$2,'2026-10-05 08:00Z','2026-10-05 09:00Z','approved',60,$3,'snapshot')",[id(n),id(10),[id(3),id(4)]]);
};

it('shares work photos only after submission and preserves them in earlier accepted versions',async()=>{
  await addConfirmedVisit(50);
  const photo={id:id(132),work_id:id(40),name:'Результат.jpg'};
  const path=[id(30),id(50),id(40),photo.id+'.jpg'].join('/');
  const visible=()=>q("select name from storage.objects where bucket_id='order-result-photos'");
  const upload=(name,owner)=>q("insert into storage.objects(name,bucket_id,owner_id) values($1,'order-result-photos',$2)",[name,id(owner)]);
  await as(7);
  await rejected(()=>upload(path,7),/row-level security/);
  await as(3);
  await rejected(()=>upload(path.replace(id(40),id(41)),3),/row-level security/);
  await rejected(()=>visitResult({photos:[photo]}),/не загружена/);
  await upload(path,3);
  expect(await visible()).toEqual([{name:path}]);
  await as(4);
  expect(await visible()).toEqual([]);
  await rejected(()=>visitResult({photos:[photo]}),/не загружена или недоступна/);
  await as(3);
  await visitResult({photos:[photo]});
  await as(4);
  expect(await visible()).toEqual([{name:path}]);
  await as(7);
  expect(await visible()).toEqual([]);
  await as(6);
  const accepted={prior:100,operation:101,action:'accepted',photos:[photo]};
  expect(await visitResult(accepted)).toEqual(await visitResult({...accepted,expected:99}));
  await visitResult({expected:1,prior:101,operation:102,action:'accepted',correction:'Уточнён отчёт',photos:[]});
  expect((await readVisits(30)).trips[0].versions.map(version=>version.result.photos)).toEqual([[photo],[]]);
  await db.exec('reset role');
  await rejected(()=>q('delete from storage.objects where name=$1',[path]),/foreign key constraint/);
  const abandoned=path.replace(photo.id,id(133));
  await q("insert into storage.objects(name,bucket_id,owner_id,created_at) values($1,'order-result-photos',$2,now()-interval '8 days')",[abandoned,id(3)]);
  await q("update storage.objects set created_at=now()-interval '8 days' where name=$1",[path]);
  await db.exec('set local role service_role');
  expect(await q('select public.order_result_photo_orphans() path')).toEqual([{path:abandoned}]);
});

it('retains extra parts through submission, return, acceptance and correction, costing only the current accepted visit',async()=>{
  await addConfirmedVisit(50);
  const part={id:id(130),work_id:id(40),title:'Кольцо',unit:'шт.',qty:2,unit_cost:12.75};
  const costRows=()=>q('select trip_id,cost from service_order_extra_part_costs where order_id=$1',[id(30)]);
  await as(3);
  await rejected(()=>visitResult({extraParts:[{...part,work_id:id(41)}]}),/отсутствует в задании/);
  await rejected(()=>visitResult({extraParts:[part,part]}),/повторяется/);
  await visitResult({extraParts:[part]});
  expect((await readVisits(30)).trips[0].latest.extra_parts).toEqual([part]);
  expect(await costRows()).toEqual([]);
  await as(6);
  expect(await costRows()).toEqual([]);
  await visitResult({prior:100,operation:101,action:'returned',correction:'Уточните наименование'});
  expect((await readVisits(30)).trips[0].latest.extra_parts).toEqual([part]);
  const accepted={prior:101,operation:102,action:'accepted'};
  const receipt=await visitResult(accepted);
  expect(await visitResult({...accepted,prior:100,expected:9})).toEqual(receipt);
  expect(await costRows()).toEqual([{trip_id:id(50),cost:'25.50'}]);
  expect((await readVisits(30)).extra_part_cost).toBe(25.5);
  expect((await read('order',30))[0].snapshot.extra_parts[0]).not.toHaveProperty('unit_cost');
  await as(3);
  expect(await costRows()).toEqual([]);
  expect((await readVisits(30)).extra_part_cost).toBe(0);
  await as(6);
  await rejected(()=>visitResult({expected:1,prior:102,operation:103,action:'accepted',correction:'Корректировка',
    extraParts:[{...part,unit_cost:-1}]}),/Проверьте название, количество и цену/);
  expect((await readVisits(30)).trips[0].versions).toHaveLength(1);
  expect(await costRows()).toEqual([{trip_id:id(50),cost:'25.50'}]);
  await visitResult({expected:1,prior:102,operation:103,action:'accepted',correction:'Запчасть не использовалась',extraParts:[]});
  expect(await costRows()).toEqual([{trip_id:id(50),cost:'0.00'}]);
  expect((await readVisits(30)).trips[0].versions.map(version=>version.result.extra_parts)).toEqual([[part],[]]);
});

it('audits a part assignment and snapshots it with accepted quantities without changing prices',async()=>{
  await addConfirmedVisit(50);
  await q("insert into service_order_items(id,order_id,job_id,title,planned_qty,unit,kind,unit_price_snapshot,unit_cost_snapshot) values($1,$2,$3,'Подшипник',3,'шт','material',24,20)",[id(43),id(30),id(10)]);
  const attach=(work,revision)=>q('select public.service_order_work_part_save($1,$2,$3,$4) revision',
    [id(30),id(43),work===null?null:id(work),revision]).then(rows=>rows[0].revision);
  await as(3);await rejected(()=>attach(40,0),/куратор задания/);
  await as(6);await rejected(()=>attach(41,0),/Работа не принадлежит заданию/);
  expect(await attach(40,0)).toBe(1);
  expect(await attach(40,1)).toBe(1);
  await rejected(()=>attach(null,0),/Задание изменено/);
  const items=[{id:id(40),qty:2,hours:2,note:''},{id:id(43),qty:2,hours:0,note:''}];
  await as(3);await visitResult({expected:1,items});
  expect((await readVisits(30)).trips[0].latest.items[1]).toMatchObject({parent_work_id:id(40),qty:2,planned_qty:3});
  await as(6);await visitResult({expected:1,prior:100,operation:101,action:'accepted',items});
  expect((await readVisits(30)).trips[0].versions[0].result.items[1]).toMatchObject({parent_work_id:id(40),qty:2,planned_qty:3});
  expect((await read('order',30))[0].snapshot.items[1]).toMatchObject({parent_work_id:id(40),qty:2});
  const [part]=await q('select done_qty,unit_price_snapshot,unit_cost_snapshot from service_order_items where id=$1',[id(43)]);
  expect(part).toEqual({done_qty:'2',unit_price_snapshot:'24',unit_cost_snapshot:'20'});
  await rejected(()=>attach(null,2),/Запчасть уже использована/);
});

it('submits by trip, accepts only by the curator, and combines accepted quantities with historical totals',async()=>{
  await submit({qty:0.25});
  await addConfirmedVisit(50);await as(3);
  expect((await readVisits(30)).trips[0].presence).toEqual({confirmed:true,base:2,used:0,available:2});
  expect(await visitResult({expected:1})).toEqual({event:id(100),revision:1});
  expect(await readVisitQueue()).toEqual([]);
  await rejected(()=>visitResult({expected:1,prior:100,operation:101,action:'accepted'}),/Принимает результат куратор/);
  expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('0.25');
  await as(6);
  expect(await readVisitQueue()).toMatchObject([{order_id:id(30),trip_id:id(50)}]);
  await db.exec('reset role');
  await rejected(()=>q("update service_orders set status='completed' where id=$1",[id(30)]),/Сначала рассмотрите результаты выездов/);
  await as(6);
  const accepted=await visitResult({expected:1,prior:100,operation:101,action:'accepted'});
  expect(accepted.revision).toBe(2);
  expect(await visitResult({expected:99,prior:100,operation:101,action:'accepted'})).toEqual(accepted);
  const [trip]= (await readVisits(30)).trips;
  expect(trip.state).toBe('accepted');expect(trip.versions).toHaveLength(1);
  expect((await readVisits(30)).accepted_hours).toEqual({[id(40)]:2});
  expect(await readVisitQueue()).toEqual([]);
  expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('1.25');
  await rejected(()=>submit({revision:2,op:102,qty:0}),/ведутся по выездам/);
  await rejected(()=>visitResult({expected:2,prior:101,operation:103,action:'accepted'}),/исправления принятой версии нужна причина/);
  await visitResult({expected:2,prior:101,operation:104,action:'accepted',correction:'Уточнили акт',items:[{id:id(40),qty:0.75,hours:2,note:'Уточнён остаток'}]});
  expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('1.00');
  expect((await readVisits(30)).trips[0].versions.map(v=>v.result.items[0].qty)).toEqual([1,0.75]);
});

it('checks GPS revision, returns a submission, and protects the shared pool from duplicate labor',async()=>{
  await rejected(()=>visitResult(),/подтвердите рабочие посещения/);
  await addConfirmedVisit(50);
  await q("insert into service_orders(id,title,job_id,status,engineer_ids,lead_engineer,curator_id) values($1,'Соседнее задание',$2,'in_progress',$3,$4,$5)",[id(32),id(10),[id(3)],id(3),id(6)]);
  await q('insert into service_order_jobs(order_id,job_id) values($1,$2)',[id(32),id(10)]);
  await q("insert into service_order_items(id,order_id,job_id,title,planned_qty,unit) values($1,$2,$3,'Проверка',2,'ч')",[id(42),id(32),id(10)]);
  await q('insert into trip_service_orders values($1,$2)',[id(50),id(32)]);
  await q('update trips set workbench_revision=3 where id=$1',[id(50)]);
  await as(3);
  await rejected(()=>visitResult(),/Данные GPS изменились/);
  await visitResult({gps:3});
  await as(6);
  await visitResult({gps:3,prior:100,operation:101,action:'returned',correction:'Приложите уточнение'});
  expect((await readVisits(30)).trips[0].state).toBe('returned');
  await visitResult({gps:3,prior:101,operation:102,action:'accepted'});
  expect((await readVisits(32)).trips[0].presence.available).toBe(0);
  const sibling={order:32,gps:3,operation:105,action:'accepted',items:[{id:id(42),qty:2,hours:2,note:''}]};
  await rejected(()=>visitResult(sibling),/ручной корректировки/);
  await visitResult({...sibling,reason:'Дополнительное время подтверждено отдельно'});
  await as(7);await rejected(()=>readVisits(30),/Нет доступа/);
});

it('keeps two trip receipts distinct in history and subtracts earlier quantities from the remaining work',async()=>{
  await addConfirmedVisit(50);
  await q("insert into trips(id,status,engineer_ids,lead_engineer,owner_id,curator_id) values($1,'done',$2,$3,$4,$4)",[id(52),[id(3)],id(3),id(6)]);
  await q('insert into trip_service_orders values($1,$2)',[id(52),id(30)]);
  await addConfirmedVisit(52);await as(6);
  await visitResult({action:'accepted'});
  await rejected(()=>visitResult({trip:52,expected:1,operation:106,action:'accepted',items:[{id:id(40),qty:2,hours:2,note:''}]}),/превышает остаток/);
  await visitResult({trip:52,expected:1,operation:106,action:'accepted'});
  expect((await q('select done_qty from service_order_items where id=$1',[id(40)]))[0].done_qty).toBe('2');
  expect((await read('trip',50)).map(e=>e.snapshot.trip_id)).toEqual([id(50)]);
  expect((await read('trip',52)).map(e=>e.snapshot.trip_id)).toEqual([id(52)]);
});
