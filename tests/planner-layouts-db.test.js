import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {movePlannerPart} from '../src/core/planner-workspace.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db,transactional=false;const q=async(sql,args=[])=>{if(transactional)await db.exec('savepoint test_statement');try{const rows=(await db.query(sql,args)).rows;if(transactional)await db.exec('release savepoint test_statement');return rows;}catch(error){if(transactional)await db.exec('rollback to savepoint test_statement;release savepoint test_statement');throw error;}};
const as=async n=>{await db.exec('reset role');await q("select set_config('test.uid',$1,true)",[id(n)]);await db.exec('set local role authenticated');};
const snapshot=async()=>JSON.parse(JSON.stringify((await q("select planner_snapshot('2026-10-01','2026-11-30') data"))[0].data));
const save=(g,parts=g.parts,operation=id(500),extra={})=>q('select planner_apply($1,$2,$3,$4) data',[operation,[{source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.people,parts,manual:true,...extra}],'Перенос участка',[]]);
beforeAll(async()=>{
 db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create schema auth;create schema dlight_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,active boolean default true);
 create function public.user_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;
 create table jobs(id uuid primary key,lat double precision,lng double precision,owner_id uuid,curator_id uuid);
 create function public.job_point(p_job uuid) returns table(lat double precision,lng double precision) language sql stable as $$select lat,lng from public.jobs where id=p_job$$;
 create table service_orders(id uuid primary key,title text,status text default 'assigned',work_mode text default 'onsite',job_id uuid,lead_engineer uuid,engineer_ids uuid[] default '{}',owner_id uuid,curator_id uuid,date_from date,date_to date,revision integer default 0,created_at timestamptz default now());
 create table trips(id uuid primary key,status text default 'assigned',date_from date,date_to date,lead_engineer uuid,engineer_ids uuid[] default '{}',owner_id uuid,curator_id uuid,deleted_at timestamptz,started_at timestamptz,finished_at timestamptz,route_stops jsonb default '[]',econ_snapshot jsonb default '{}',plan_econ_snapshot jsonb,day_plan jsonb,workbench_revision integer default 0);
 create table trip_service_orders(trip_id uuid,order_id uuid,ordinal integer default 0);
 create table service_order_items(id uuid primary key,order_id uuid,kind text,unit text,planned_qty numeric,transferred_qty numeric default 0,request_finance_void_event_id uuid,legacy_snapshot jsonb default '{}');
 create table staff_day(engineer uuid,date date,start_h numeric,end_h numeric,tol_h numeric);
 create table settings(id boolean primary key,day_start numeric,day_end numeric,tolerance_h numeric);insert into settings values(true,7,16,1);
 create function dlight_private.responsibility_manager(kind text,entity uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce(public.user_role() in ('admin','logist') or (kind='order' and exists(select 1 from public.service_orders where id=entity and auth.uid() in (owner_id,curator_id))) or (kind='trip' and exists(select 1 from public.trips where id=entity and auth.uid() in (owner_id,curator_id))),false)$$;
 create function dlight_private.order_access(entity uuid) returns boolean language sql stable security definer set search_path='' as $$select dlight_private.responsibility_manager('order',entity) or exists(select 1 from public.service_orders where id=entity and auth.uid()=any(engineer_ids))$$;
 create function dlight_private.responsibility_access(kind text,entity uuid) returns boolean language sql stable security definer set search_path='' as $$select dlight_private.responsibility_manager(kind,entity) or (kind='trip' and exists(select 1 from public.trips where id=entity and (auth.uid()=lead_engineer or auth.uid()=any(engineer_ids))))$$;
 grant usage on schema public,auth,dlight_private to authenticated;grant execute on all functions in schema public,auth,dlight_private to authenticated;
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261026194156_canonical_planner_layouts.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261029093102_planner_sequence_ergonomics.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261029095227_planner_trip_auto_reset.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{await db.exec('begin');transactional=true;await q("insert into profiles values($1,'admin',true),($2,'engineer',true),($3,'engineer',true),($4,'engineer',true)",[1,2,3,4].map(id));await q('insert into jobs values($1,50,36,null,null)',[id(10)]);await q("insert into service_orders(id,title,job_id,engineer_ids,date_from,date_to) values($1,'Ремонт',$2,$3,'2026-10-26','2026-10-27')",[id(20),id(10),[id(2),id(3)]]);await q("insert into trips(id,date_from,date_to,lead_engineer,engineer_ids,route_stops,econ_snapshot) values($1,'2026-10-26','2026-10-27',$2,$3,$4,$5)",[id(30),id(2),[id(2),id(3)],[{type:'place',lat:49,lng:35},{type:'job',lat:50,lng:36},{type:'place',lat:49,lng:35}],{driveH:2,legs:[{a:'depot',b:'job',h:1},{a:'job',b:'depot',h:1}]}]);await q('insert into trip_service_orders values($1,$2,0)',[id(30),id(20)]);await q("insert into service_order_items(id,order_id,kind,unit,planned_qty) values($1,$2,'work','ч',2)",[id(40),id(20)]);await as(1);});
afterEach(async()=>{await db.exec('rollback');transactional=false;await db.exec('reset role');});
it('projects canonical work and roads without writing statuses or inferred facts',async()=>{const data=await snapshot();expect(data.groups).toHaveLength(3);expect(data.groups.map(g=>g.kind)).toEqual(['road','work','road']);expect(data.groups[1].order_id).toBe(id(20));expect(data.groups[1].parts[0]).toMatchObject({date:'2026-10-26',start:8,end:10});await db.exec('reset role');expect(await q('select * from planner_layouts')).toHaveLength(0);expect((await q('select status from service_orders'))[0].status).toBe('assigned');});
it('retains saved manual trip cuts in the canonical task clock',async()=>{await db.exec('reset role');await q('update trips set day_plan=$1 where id=$2',[{start:{d:'2026-10-26',t:8},cuts:[{after:1,at:{d:'2026-10-27',t:7}},{after:3,at:{d:'2026-10-27',t:12}}]},id(30)]);await as(1);const data=await snapshot();expect(data.groups[0].parts[0]).toMatchObject({date:'2026-10-26',start:8,end:9});expect(data.groups[1].parts[0]).toMatchObject({date:'2026-10-27',start:7,end:9});expect(data.groups[2].parts[0]).toMatchObject({date:'2026-10-27',start:12,end:13});});
it('saves a split atomically and replays its operation ID without duplicate history',async()=>{const group=(await snapshot()).groups[1],p=group.parts[0],parts=[{...p,end:9},{...p,id:'second',start:9,offset:1}];await save(group,parts);await save(group,parts);const next=(await snapshot()).groups[1];expect(next.parts).toHaveLength(2);expect(next.revision).toBe(1);expect(next.stale).toBe(false);await expect(save(group,parts,id(501))).rejects.toThrow(/другим/);await db.exec('reset role');expect(await q('select * from planner_layout_history')).toHaveLength(1);});
it('checks entity authority, RLS and direct-write denial',async()=>{let group=(await snapshot()).groups[1];await as(2);await expect(save(group)).rejects.toThrow(/Нет права/);await as(4);expect((await snapshot()).groups).toHaveLength(0);await expect(q("insert into planner_layouts(source_key) values('fake')")).rejects.toThrow(/permission denied/);});
it('allows an engineer curator to manage only their own task',async()=>{await db.exec('reset role');await q('update service_orders set curator_id=$1 where id=$2',[id(2),id(20)]);await as(2);const group=(await snapshot()).groups[1];await save(group);expect((await snapshot()).groups[1].revision).toBe(1);const road=(await snapshot()).groups[0];await expect(save(road,road.parts,id(501))).rejects.toThrow(/Нет права/);});
it('rejects a road collision and completed-entity placement without a partial commit',async()=>{let group=(await snapshot()).groups[1],parts=group.parts.map(p=>({...p,start:9,end:11}));await expect(save(group,parts)).rejects.toThrow(/Пересечение/);await db.exec('reset role');expect(await q('select * from planner_layouts')).toHaveLength(0);await q("update trips set status='done'");await as(1);await save(group,group.parts,id(590));});
it('extends the trip envelope for a moved task part and never changes actual timestamps',async()=>{const group=(await snapshot()).groups[1],parts=group.parts.map(p=>({...p,date:'2026-10-28'}));const result=(await save(group,parts))[0].data;expect(result.restore_windows).toHaveLength(1);await db.exec('reset role');const trip=(await q('select * from trips'))[0];expect(new Date(trip.date_to).toISOString().slice(0,10)).toBe('2026-10-28');expect(trip.started_at).toBeNull();expect(trip.finished_at).toBeNull();});
it('rejects null fields, duplicate IDs and new tiny fragments atomically',async()=>{
 const g=(await snapshot()).groups[1],p=g.parts[0];
 for(const parts of [[{...p,start:null}],[{...p,date:null}],[{...p,end:8.1},{...p,start:8.1,id:'tiny',offset:.1}],[p,p]])await expect(save(g,parts)).rejects.toThrow();
 await db.exec('reset role');expect(await q('select * from planner_layouts')).toHaveLength(0);expect(await q('select * from planner_operations')).toHaveLength(0);
});
it('expands an earlier envelope without shifting untouched roads, then restores it on undo',async()=>{
 const initial=await snapshot(),g=initial.groups[1],parts=g.parts.map(p=>({...p,date:'2026-10-25'})),receipt=(await save(g,parts))[0].data,next=await snapshot();
 expect(next.groups[0].parts).toEqual(initial.groups[0].parts);expect(next.groups[2].parts).toEqual(initial.groups[2].parts);
 const saved=next.groups[1];await q('select planner_apply($1,$2,$3,$4)',[id(501),[{source_key:g.source_key,expected_revision:saved.revision,placement_token:saved.placement_token,order_revision:saved.order_revision,trip_revision:saved.trip_revision,people:g.people,parts:g.parts,manual:true}],'Отмена изменения',receipt.restore_windows]);
 expect((await snapshot()).groups.map(g=>g.parts)).toEqual(initial.groups.map(g=>g.parts));await db.exec('reset role');expect(await q('select * from dlight_private.planner_trip_origins')).toHaveLength(0);
});
it('rejects stale source revisions and operation ID reuse with another payload',async()=>{
 const g=(await snapshot()).groups[1];await save(g);await expect(save(g,g.parts.map(p=>({...p,date:'2026-10-28'})))).rejects.toThrow(/использован/);
 await db.exec('reset role');await q('update service_orders set revision=revision+1');await as(1);const current=(await snapshot()).groups[1];await expect(save({...current,order_revision:0},current.parts,id(502))).rejects.toThrow(/Задание изменено/);
});
it('a pending staff-day proposal does not open a weekend automatically',async()=>{await db.exec('reset role');await q("insert into staff_day(engineer,date) values($1,'2026-10-25')",[id(2)]);const rows=await q("select dlight_private.planner_window($1,'2026-10-25',false) value",[[id(2)]]);expect(rows[0].value).toBeNull();});
it('persists calendar carryover and its logical identity through the actual RPC, then restores the original placement',async()=>{
 await db.exec('reset role');await q('delete from trip_service_orders');await q("update trips set deleted_at=now()");await q("update service_orders set work_mode='depot'");await q('update service_order_items set planned_qty=5');await as(1);
 const settings={dayStart:7,dayEnd:16,toleranceH:1,weekend:[0,6],staffDay:{}};
 let g=(await snapshot()).groups.find(g=>g.kind==='work'),noon=movePlannerPart(g,g.parts[0].id,'2026-10-26',12,settings);await save(g,noon.parts,id(510),{manual:noon.manual});
 g=(await snapshot()).groups.find(g=>g.kind==='work');const before=structuredClone(g.parts),moved=movePlannerPart(g,g.parts[0].id,'2026-10-26',13,settings);await save(g,moved.parts,id(511),{manual:moved.manual});
 g=(await snapshot()).groups.find(g=>g.kind==='work');expect(g.manual).toBe(true);expect(g.parts.map(({date,start,end,offset})=>({date,start,end,offset}))).toEqual([{date:'2026-10-26',start:13,end:17,offset:0},{date:'2026-10-27',start:7,end:8,offset:4}]);expect(new Set(g.parts.map(p=>p.carry_root)).size).toBe(1);
 await save(g,before,id(512));expect((await snapshot()).groups.find(g=>g.kind==='work').parts).toEqual(before);
 await db.exec('reset role');expect(await q('select * from staff_day')).toHaveLength(0);expect((await q('select status from service_orders'))[0].status).toBe('assigned');expect(Number((await q('select planned_qty from service_order_items'))[0].planned_qty)).toBe(5);
});
it('retains accepted non-trip task history as a protected plan',async()=>{await db.exec('reset role');await q('delete from trip_service_orders');await q("update service_orders set status='completed',work_mode='depot'");await as(1);const g=(await snapshot()).groups.find(g=>g.order_id===id(20));expect(g).toBeTruthy();await save(g);});

it('does not revive voided financial work into the plan',async()=>{await db.exec('reset role');await q('update service_order_items set legacy_snapshot=$1',[{request_finance_voided_at:'2026-10-26'}]);await as(1);expect((await snapshot()).groups.every(g=>g.kind==='road')).toBe(true);});
it('uses the canonical task team independently of the road crew',async()=>{await db.exec('reset role');await q('update service_orders set engineer_ids=$1',[ [id(4)] ]);await q("insert into staff_day values($1,'2026-10-26',10,16,0)",[id(4)]);await as(1);const groups=(await snapshot()).groups;expect(groups[1].people).toEqual([id(4)]);expect(groups[1].parts[0].start).toBe(10);expect(groups[0].people).not.toContain(id(4));});
it('migrates saved legacy cuts as explicit layouts and preserves them after volume changes',async()=>{await db.exec('reset role');await q('update trips set day_plan=$1',[{start:{d:'2026-10-26',t:8},cuts:[{after:1,at:{d:'2026-10-27',t:7}}]}]);await as(1);const before=await snapshot();await db.exec('reset role');const sql=readFileSync(new URL('../supabase/migrations/20261026194156_canonical_planner_layouts.sql',import.meta.url),'utf8');const start=sql.lastIndexOf('insert into public.planner_layouts(source_key,kind'),end=sql.indexOf('on conflict(source_key) do nothing;',start)+'on conflict(source_key) do nothing;'.length;await db.exec(sql.slice(start,end));await q('update service_order_items set planned_qty=4');await as(1);const after=await snapshot();expect(after.groups[1].parts).toEqual(before.groups[1].parts);expect(after.groups[1].manual).toBe(true);expect(after.groups[1].stale).toBe(true);});

it('honors manual bookings during automatic placement and rejects an outdated automatic clock',async()=>{await db.exec('reset role');await q("insert into service_orders(id,title,engineer_ids,date_from,date_to) values($1,'Автоматическая работа',$2,'2026-10-26','2026-10-26')",[id(21),[id(2)]]);await q("insert into service_order_items(id,order_id,kind,unit,planned_qty) values($1,$2,'work','ч',1)",[id(41),id(21)]);await as(1);const initial=await snapshot(),task=initial.groups.find(g=>g.order_id===id(21)),road=initial.groups[0];expect(task.parts[0].start).toBe(11);await save(road,road.parts.map(p=>({...p,date:'2026-10-27'})));const fresh=(await snapshot()).groups.find(g=>g.order_id===id(21));expect(fresh.parts[0].start).toBe(7);expect(fresh.revision).toBe(task.revision);await expect(save(task,task.parts,id(502))).rejects.toThrow(/размещение изменилось/);});
it('blocks direct legacy clock writes while canonical envelope edits remain available',async()=>{await db.exec('reset role');await db.exec('grant select,update on public.trips to authenticated');await as(1);await expect(q('update public.trips set day_plan=$1 where id=$2',[{start:{d:'2026-10-27',t:7}},id(30)])).rejects.toThrow(/новом графике/);});

it('retains layouts on soft deletion and does not block authorized trip purge or delete task history',async()=>{
 const groups=(await snapshot()).groups;await save(groups[0]);await save(groups[1],groups[1].parts,id(501));
 await db.exec('reset role');await q('update trips set deleted_at=now() where id=$1',[id(30)]);
 expect(await q('select * from planner_layouts')).toHaveLength(2);
 await q('update trips set deleted_at=null where id=$1',[id(30)]);await as(1);expect((await snapshot()).groups[0].revision).toBe(1);
 await db.exec('reset role');await q('delete from trip_service_orders where trip_id=$1',[id(30)]);await q('delete from trips where id=$1',[id(30)]);
 expect(await q('select * from planner_layouts')).toHaveLength(0);expect(await q('select * from planner_layout_history')).toHaveLength(2);expect(await q('select * from planner_operations')).toHaveLength(2);expect(await q('select * from service_orders')).toHaveLength(1);
});

it('places a newly linked task after a manually shifted trip and advances the saved return road',async()=>{
 const before=await snapshot(),changes=before.groups.map(g=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.people,parts:g.parts.map(p=>({...p,start:p.start+2,end:p.end+2})),manual:true}));
 await q('select planner_apply($1,$2,$3)',[id(550),changes,'Совместный перенос выезда']);
 await db.exec('reset role');await q("insert into service_orders(id,title,job_id,engineer_ids,date_from,date_to) values($1,'Добавленная работа',$2,$3,'2026-10-26','2026-10-27')",[id(21),id(10),[id(2),id(3)]]);await q("insert into service_order_items(id,order_id,kind,unit,planned_qty) values($1,$2,'work','ч',1)",[id(41),id(21)]);await q('insert into trip_service_orders values($1,$2,1)',[id(30),id(21)]);await as(1);
 const next=(await snapshot()).groups;expect(next.map(g=>g.parts.map(p=>[p.start,p.end]))).toEqual([[[9,10]],[[10,12]],[[12,13]],[[13,14]]]);
 // Turning the inserted automatic task into a manual split must not revive
 // the return road's old stored anchor under the new work.
 const inserted=next[2],p=inserted.parts[0];await save(inserted,[{...p,end:12.5},{...p,id:'inserted-cut',start:12.5,offset:.5}],id(553));expect((await snapshot()).groups.at(-1).parts[0]).toMatchObject({start:13,end:14});
 // The effective continuation is editable with a fresh token, not a stale stored clock.
 const back=(await snapshot()).groups.at(-1);await save(back,back.parts,id(551));expect((await snapshot()).groups.at(-1).parts).toEqual(back.parts);
 const current=(await snapshot()).groups,reset=current.map(g=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.auto_people,parts:g.trip_auto_parts||g.auto_parts,manual:false,reset_trip:true}));
 await q('select planner_apply($1,$2,$3)',[id(552),reset,'Сброс всего выезда']);expect((await snapshot()).groups.map(g=>g.parts.map(p=>[p.start,p.end]))).toEqual([[[7,8]],[[8,10]],[[10,11]],[[11,12]]]);
});
it('edits and splits accepted historical plans without changing facts, statuses or dates',async()=>{
 await db.exec('reset role');await q("update trips set status='done',started_at='2026-10-26T07:00Z',finished_at='2026-10-26T11:00Z'");await q("update service_orders set status='completed'");const before=(await q('select row_to_json(t) value from trips t'))[0].value;await as(1);
 const g=(await snapshot()).groups[1],p=g.parts[0];await save(g,[{...p,end:p.start+1},{...p,id:'historical-cut',start:p.start+1,offset:1}],id(560));const split=(await snapshot()).groups[1];await save(split,split.parts.map(p=>({...p,date:'2026-10-28'})),id(561));await db.exec('reset role');expect((await q('select row_to_json(t) value from trips t'))[0].value).toEqual(before);expect((await q('select status from service_orders'))[0].status).toBe('completed');
});
it('keeps historical saved volumes editable after a plan-volume change when crew remains the same',async()=>{
 const g=(await snapshot()).groups[1];await save(g);await db.exec('reset role');await q('update service_order_items set planned_qty=4');await as(1);const stale=(await snapshot()).groups[1];expect(stale.stale).toBe(true);await save(stale,stale.parts,id(570));expect((await snapshot()).groups[1].parts).toEqual(g.parts);
});
it('loads the complete trip for one-day views and rejects a partial whole-trip reset atomically',async()=>{
 const initial=(await snapshot()).groups,work=initial[1];await save(work,work.parts.map(p=>({...p,date:'2026-10-28'})),id(580));
 const narrow=(await q("select planner_snapshot('2026-10-28','2026-10-28') data"))[0].data;expect(narrow.groups).toHaveLength(3);const g=narrow.groups[1];await expect(save(g,g.auto_parts,id(581),{manual:false,reset_trip:true})).rejects.toThrow(/весь выезд|всего выезда/);
 await db.exec('reset role');expect(await q('select * from planner_operations where id=$1',[id(581)])).toHaveLength(0);
});
it('resets the whole minute-precision route including short original road fragments',async()=>{
 await db.exec('reset role');await q('update trips set econ_snapshot=$1',[{driveH:.4,legs:[{h:.1},{h:.3}]}]);await as(1);let groups=(await snapshot()).groups;
 const changes=groups.map((g,i)=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.people,parts:g.parts.map(p=>({...p,start:[8,8.25,10.25][i],end:[8.1,10.25,10.55][i]})),manual:true}));
 await q('select planner_apply($1,$2,$3)',[id(582),changes,'Перенос минутной дороги и работы']);groups=(await snapshot()).groups;
 const reset=groups.map(g=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.auto_people,parts:g.trip_auto_parts,manual:false,reset_trip:true}));await q('select planner_apply($1,$2,$3)',[id(583),reset,'Сброс всего выезда']);
 expect((await snapshot()).groups.map(g=>g.parts.map(p=>[p.start,p.end]))).toEqual([[[7,7.1]],[[7.1,9.1]],[[9.1,9.4]]]);
});
it('whole-trip reset removes imported legacy start/cuts and undo restores them without rewriting trip metadata',async()=>{
 await db.exec('reset role');const legacy={start:{d:'2026-10-26',t:8},cuts:[{after:1,at:{d:'2026-10-27',t:7}},{after:3,at:{d:'2026-10-27',t:12}}]};await q('update trips set day_plan=$1',[legacy]);
 const sql=readFileSync(new URL('../supabase/migrations/20261026194156_canonical_planner_layouts.sql',import.meta.url),'utf8'),a=sql.lastIndexOf('insert into public.planner_layouts(source_key,kind'),z=sql.indexOf('on conflict(source_key) do nothing;',a)+'on conflict(source_key) do nothing;'.length;await db.exec(sql.slice(a,z));await as(1);
 const before=(await snapshot()).groups;expect(before.map(g=>g.parts[0].date)).toEqual(['2026-10-26','2026-10-27','2026-10-27']);const command=(g,parts,extra={})=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.people,parts,manual:true,...extra});
 await q('select planner_apply($1,$2,$3)',[id(584),before.map(g=>command(g,g.trip_auto_parts,{manual:false,reset_trip:true,clock_reset:true})),'Полный автоматический сброс старого выезда']);
 let current=(await snapshot()).groups;expect(current.map(g=>g.parts.map(p=>[p.date,p.start,p.end]))).toEqual([[['2026-10-26',7,8]],[['2026-10-26',8,10]],[['2026-10-26',10,11]]]);expect(current.every(g=>g.clock_reset)).toBe(true);
 // A normal edit retains the shared automatic base and cannot bring legacy cuts back.
 await save(current[1],current[1].parts,id(585));current=(await snapshot()).groups;expect(current.every(g=>g.clock_reset)).toBe(true);
 const undo=before.map(g=>command(current.find(x=>x.source_key===g.source_key),g.parts,{manual:g.manual,clock_reset:false}));await q('select planner_apply($1,$2,$3)',[id(586),undo,'Отмена полного сброса старого выезда']);const restored=(await snapshot()).groups;expect(restored.map(g=>g.parts)).toEqual(before.map(g=>g.parts));expect(restored.every(g=>!g.clock_reset)).toBe(true);
 await db.exec('reset role');expect((await q('select day_plan from trips'))[0].day_plan).toEqual(legacy);expect((await q('select workbench_revision from trips'))[0].workbench_revision).toBe(0);
});
it('does not accept a forged automatic-clock marker or a partial clock-mode rollback',async()=>{
 let groups=(await snapshot()).groups,g=groups[1];await save(g,g.parts.map(p=>({...p,automatic_trip_clock:true})),id(587));groups=(await snapshot()).groups;expect(groups.every(g=>!g.clock_reset)).toBe(true);
 const changes=groups.map(g=>({source_key:g.source_key,expected_revision:g.revision,placement_token:g.placement_token,order_revision:g.order_revision,trip_revision:g.trip_revision,people:g.people,parts:g.trip_auto_parts,manual:false,reset_trip:true,clock_reset:true}));await q('select planner_apply($1,$2,$3)',[id(588),changes,'Сброс всего выезда']);g=(await snapshot()).groups[1];await expect(save(g,g.parts,id(589),{clock_reset:false})).rejects.toThrow(/всего выезда/);
});
