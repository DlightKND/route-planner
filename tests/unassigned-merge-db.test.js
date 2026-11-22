import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const q=async(sql,args=[])=>{await db.exec('savepoint check_query');try{const r=await db.query(sql,args);await db.exec('release savepoint check_query');return r.rows;}catch(e){await db.exec('rollback to savepoint check_query; release savepoint check_query');throw e;}};
const quote=key=>q('select unassigned_track_quote($1) result',[key]).then(r=>r[0].result);
const merge=async(keys,expected=null)=>q('select unassigned_track_merge($1,$2,$3) result',[keys,expected||Object.fromEntries(await Promise.all(keys.map(async key=>[key,await quote(key)]))),'Одна поездка после разрыва связи']).then(r=>r[0].result);
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync(new URL('./fixtures/unassigned-tracking-base.sql',import.meta.url),'utf8'));
 await db.exec('alter table trip_tracks add column km numeric; alter table trip_tracks add column data jsonb; alter table trip_tracks add column updated_at timestamptz');
 for(const file of ['20261006070024_unassigned_tracking_journal.sql','20261008172441_unassigned_track_merge.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 // The focused fixture already uses the real GPS resolver. Only the separate
 // plan-write subsystem is stubbed here to observe its transaction boundary.
 await db.exec(`create function public.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) returns uuid language plpgsql as $$
 declare tid uuid; begin
 insert into public.trips(vehicle_id,status,owner_id,curator_id) values (($3->>'vehicle_id')::uuid,'planned',auth.uid(),auth.uid()) returning id into tid;
 insert into public.trip_service_orders(trip_id,order_id,ordinal) select tid,x,0 from unnest($4)x;
 return tid; end $$;`);

 await db.exec(`alter table public.trips add column workbench_revision integer not null default 0;
 alter table public.trip_stays add column id uuid primary key, add column job_id uuid, add column vehicle_id uuid,
 add column stay_from timestamptz, add column stay_to timestamptz, add column crew_ids uuid[], add column crew_source text,
 add column mgr_by uuid, add column note text, add column minutes_mgr numeric, add column status text;
 create function public.trip_presence_save(uuid,integer,jsonb,text) returns integer language plpgsql as $$
 declare rev integer; begin
 update public.trip_stays set mgr_by=auth.uid(),note=$4,status=$3->0->>'status',minutes_mgr=($3->0->>'minutes_mgr')::numeric
 where trip_id=$1 and id=($3->0->>'id')::uuid;
 update public.trips set workbench_revision=workbench_revision+1 where id=$1 and workbench_revision=$2 returning workbench_revision into rev;
 return rev; end $$;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261122152709_workflow_gps_record_operations.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261122210819_gps_record_stop_drafts.sql',import.meta.url),'utf8'));

},30000);
beforeEach(async()=>{
 await db.exec('begin');await q("insert into profiles values($1,'admin',true),($2,'engineer',true)",[id(1),id(2)]);await q("select set_config('test.uid',$1,true)",[id(1)]);
 await q("insert into vehicles(id,name)values($1,'Машина'),($2,'Другая')",[id(10),id(11)]);
 for(let i=0;i<3;i++){
  const start=`2026-10-03T07:0${i*3}:00Z`,end=`2026-10-03T07:0${i*3+1}:00Z`;
  await q("insert into unassigned_tracks(id,vehicle_id,started_at,last_ts,ended_at,state)values($1,$2,$3,$4,$4,'review')",[id(100+i),id(10),start,end]);
  await q("insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,status)values($1,$2,50,30,'moving'),($1,$3,50.001,30,'moving')",[id(10),start,end]);
 }
});
afterEach(async()=>{await db.exec('reset role;rollback');});afterAll(async()=>await db?.close());
it('retains ordered sources, excludes unselected points and never measures the join',async()=>{
 const a=await quote(id(100)),c=await quote(id(102)),result=await merge([id(100),id(102)]),track=result.track_id;
 expect(result.source_ranges.map(x=>x.id)).toEqual([id(100),id(102)]);
 const total=await quote(track);expect(total.points).toBe(4);expect(total.km).toBeCloseTo(a.km+c.km,1);
 expect(await q("select state from unassigned_tracks where id in($1,$2) order by id",[id(100),id(102)])).toEqual([{state:'merged'},{state:'merged'}]);
 expect((await q('select * from unassigned_track_points($1,0,1000)',[track])).map(p=>p.part)).toEqual([1,1,2,2]);
 expect((await q('select count(*)::integer n from unassigned_track_events'))[0].n).toBe(3);
 expect((await q('select count(*)::integer n from vehicle_telemetry_archive'))[0].n).toBe(6);
 await expect(merge([id(100),id(101)],{[id(100)]:a,[id(101)]:await quote(id(101))})).rejects.toThrow('завершённые');
});
it('imports only selected GPS into an empty trip and persists separate measured pieces',async()=>{
 const {track_id:track}=await merge([id(100),id(102)]),total=await quote(track);
 await q("insert into trips(id,vehicle_id,status,owner_id,curator_id)values($1,$2,'planned',$3,$3)",[id(50),id(10),id(1)]);
 await q('select unassigned_track_resolve($1,$2,$3,$4)',[track,total.revision,'link',{trip:id(50),points:total.points,km:total.km,reason:'Проверен маршрут'}]);
 expect((await q('select count(*)::integer n from vehicle_positions where trip_id=$1',[id(50)]))[0].n).toBe(4);
 const stored=(await q('select data from trip_tracks where trip_id=$1',[id(50)]))[0].data;expect(stored.segments).toHaveLength(2);expect(stored.points).toHaveLength(4);expect(stored.source_ranges).toHaveLength(2);
 expect(stored.segments.every(s=>new Date(s.toTs)-new Date(s.fromTs)===60000)).toBe(true);
 expect((await q('select state from unassigned_tracks where id=$1',[id(101)]))[0].state).toBe('review');
});
it('blocks reversed, overlapping, duplicate, mixed-vehicle and changed sources atomically',async()=>{
 await expect(merge([id(101),id(100)])).rejects.toThrow('по времени');
 await expect(merge([id(100),id(100)])).rejects.toThrow('разных');
 const old=Object.fromEntries(await Promise.all([id(100),id(101)].map(async k=>[k,await quote(k)])));
 await q('update unassigned_tracks set revision=1 where id=$1',[id(100)]);await expect(merge([id(100),id(101)],old)).rejects.toThrow('изменились');
 await q('update unassigned_tracks set vehicle_id=$1 where id=$2',[id(11),id(101)]);await expect(merge([id(100),id(101)])).rejects.toThrow('одной машины');
 expect((await q('select count(*)::integer n from unassigned_tracks'))[0].n).toBe(3);
});
it('blocks points already assigned elsewhere and checks point-count freshness',async()=>{
 const expected=Object.fromEntries(await Promise.all([id(100),id(101)].map(async k=>[k,await quote(k)])));
 await q("insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng)values($1,'2026-10-03T07:00:30Z',50.0005,30)",[id(10)]);
 await expect(merge([id(100),id(101)],expected)).rejects.toThrow('изменились');
 await q("insert into vehicle_positions(vehicle_id,ts,trip_id,lat,lng)values($1,'2026-10-03T07:00:00Z',$2,50,30)",[id(10),id(50)]);
 await expect(merge([id(100),id(101)])).rejects.toThrow('уже привязан');
});
it('allows adding another track to a composite without losing original ranges',async()=>{
 const first=await merge([id(100),id(101)]),second=await merge([first.track_id,id(102)]);expect(second.source_ranges.map(x=>x.id)).toEqual([id(100),id(101),id(102)]);expect((await quote(second.track_id)).points).toBe(6);
});
it('denies engineers, anonymous users and direct writes',async()=>{
 await q("select set_config('test.uid',$1,true)",[id(2)]);await db.exec('set role authenticated');
 await expect(q('select unassigned_track_merge($1,$2,$3)',[[id(100),id(101)],{},'Проверка'])).rejects.toThrow('Только диспетчер');
 await expect(q('select * from unassigned_track_points($1)',[id(100)])).rejects.toThrow('Только диспетчер');
 expect((await q("select has_function_privilege('anon','unassigned_track_merge(uuid[],jsonb,text)','EXECUTE') allowed"))[0].allowed).toBe(false);
 expect((await q("select has_table_privilege('authenticated','unassigned_tracks','UPDATE') allowed"))[0].allowed).toBe(false);
});

it('keeps live recording separate, but accepts a stale recording after closing at its last GPS point',async()=>{
 await q("update unassigned_tracks set state='recording',ended_at=null,last_ts=now() where id=$1",[id(100)]);
 await expect(merge([id(100),id(101)])).rejects.toThrow('завершённые');
 await q("update unassigned_tracks set last_ts='2026-10-03T07:01:00Z' where id=$1",[id(100)]);
 const result=await merge([id(100),id(101)]);expect((await quote(result.track_id)).points).toBe(4);
 expect((await q('select ended_at from unassigned_tracks where id=$1',[id(100)]))[0].ended_at.toISOString()).toBe('2026-10-03T07:01:00.000Z');
});

it('preserves single-track linking through the same scoped GPS source',async()=>{
 const track=id(100),total=await quote(track);await q("insert into trips(id,vehicle_id,status,owner_id,curator_id)values($1,$2,'planned',$3,$3)",[id(50),id(10),id(1)]);
 await q('select unassigned_track_resolve($1,$2,$3,$4)',[track,total.revision,'link',{trip:id(50),points:total.points,km:total.km,reason:'Обычный одиночный трек'}]);
 expect((await q('select count(*)::integer n from vehicle_positions where trip_id=$1',[id(50)]))[0].n).toBe(2);expect(await q('select * from trip_tracks')).toHaveLength(0);
});


it('creates and binds one trip atomically, retries by operation ID and never creates a request',async()=>{
 const track=id(100),source=await quote(track),operation=id(60),order=id(61);
 const invoke=(points,action=operation)=>q('select gps_record_create_trip($1,$2,$3,$4,$5,$6,$7) id',
  [track,source.revision,points,action,{vehicle_id:id(10),status:'planned'},[order],'Проверена GPS-запись']);
 await expect(invoke(source.points+1)).rejects.toThrow('GPS изменился');
 expect(await q('select id from trips')).toEqual([]);
 const [{id:trip}]=await invoke(source.points);
 expect(await invoke(source.points)).toEqual([{id:trip}]);
 await expect(invoke(source.points,id(62))).rejects.toThrow('GPS-запись изменилась');
 expect(await q('select order_id from trip_service_orders where trip_id=$1',[trip])).toEqual([{order_id:order}]);
 expect(await q('select id from jobs')).toEqual([]);
 expect(await q('select id from service_orders')).toEqual([]);
});

it('keeps GPS-record comments separate and carries them into the linked record',async()=>{
 const track=id(100),source=await quote(track);
 await db.exec('set role authenticated');
 await q('insert into gps_record_comments(track_id,author_id,body) values($1,$2,$3)',[track,id(1),'Проверить остановку']);
 await expect(q('insert into gps_record_comments(track_id,author_id,body) values($1,$2,$3)',[track,id(2),'Чужой автор'])).rejects.toThrow('row-level security');
 const [{id:trip}]=await q('select gps_record_create_trip($1,$2,$3,$4,$5,$6,$7) id',
  [track,source.revision,source.points,id(62),{vehicle_id:id(10),status:'planned'},[id(61)],'Проверена GPS-запись']);
 expect(await q('select track_id,trip_id,body from gps_record_comments where trip_id=$1',[trip])).toEqual([{track_id:track,trip_id:trip,body:'Проверить остановку'}]);
});

it('validates an observed stop, versions the choice and preserves it separately across linking',async()=>{
 const track=id(115),trip=id(50),from='2026-10-03T09:00:00Z',to='2026-10-03T09:12:00Z';
 const stop={stay_from:from,stay_to:to,decision:'include',note:'Стоянка у заказчика'};
 await q("insert into unassigned_tracks(id,vehicle_id,started_at,last_ts,ended_at,state) values($1,$2,$3,$4,$4,'review')",[track,id(10),from,to]);
 await q("insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,status) select $1,$2::timestamptz+i*interval '4 minutes',50,30,'idle' from generate_series(0,3) i",[id(10),from]);
 const source=await quote(track);
 const save=(rows=[stop],revision=0,count=source.points)=>q(
  'select gps_record_stop_draft_save($1,$2,$3,$4,$5) version',[track,source.revision,count,revision,JSON.stringify(rows)]
 );
 await db.exec('set role authenticated');
 await expect(save([stop],0,source.points-1)).rejects.toThrow('GPS изменился');
 await expect(save([{...stop,stay_to:'2026-10-03T09:13:00Z'}])).rejects.toThrow('не совпадает');
 expect(await save()).toEqual([{version:1}]);
 await expect(save([{...stop,note:'Вторая вкладка'}])).rejects.toThrow('уже изменён');
 expect(await save([{...stop,decision:'exclude'}],1)).toEqual([{version:2}]);
 await q("select set_config('test.uid',$1,true)",[id(2)]);
 expect(await q('select * from gps_record_stop_drafts')).toEqual([]);
 await expect(save([stop],2)).rejects.toThrow('готовит диспетчер');
 expect(await q("select has_function_privilege('anon','gps_record_stop_draft_save(uuid,integer,integer,integer,jsonb)','EXECUTE') allowed")).toEqual([{allowed:false}]);
 await q("select set_config('test.uid',$1,true)",[id(1)]);
 await db.exec('reset role');
 await q("insert into trips(id,vehicle_id,status,owner_id,curator_id) values($1,$2,'planned',$3,$3)",[trip,id(10),id(1)]);
 await q('select unassigned_track_resolve($1,$2,$3,$4)',[track,source.revision,'link',{trip,points:source.points,km:source.km,reason:'Проверена запись'}]);
 expect(await q('select trip_id,source_current,stops from gps_record_stop_drafts where track_id=$1',[track]))
  .toMatchObject([{trip_id:trip,source_current:true,stops:[{decision:'exclude',note:stop.note,lat:50,lng:30}]}]);
 expect(await q('select * from trip_stays where trip_id=$1',[trip])).toEqual([]);
 await expect(save([stop],2)).rejects.toThrow('непривязанной');
});

it('retains but marks the saved choice stale if additional GPS arrives before linking',async()=>{
 const track=id(116),trip=id(50),from='2026-10-03T10:00:00Z',to='2026-10-03T10:12:00Z';
 await q("insert into unassigned_tracks(id,vehicle_id,started_at,last_ts,ended_at,state) values($1,$2,$3,$4,$4,'review')",[track,id(10),from,to]);
 await q("insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,status) select $1,$2::timestamptz+i*interval '4 minutes',50,30,'idle' from generate_series(0,3) i",[id(10),from]);
 const [saved]=await q('select gps_record_stop_draft_save($1,0,4,0,$2) version',[track,JSON.stringify([{stay_from:from,stay_to:to,decision:'include'}])]);
 expect(saved.version).toBe(1);
 await q("insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,status) values($1,'2026-10-03T10:06:00Z',50,30,'moving')",[id(10)]);
 const source=await quote(track);
 await expect(q('select gps_record_stop_draft_save($1,0,5,1,$2)',[track,JSON.stringify([{stay_from:from,stay_to:to,decision:'include'}])])).rejects.toThrow('не совпадает');
 await q("insert into trips(id,vehicle_id,status,owner_id,curator_id) values($1,$2,'planned',$3,$3)",[trip,id(10),id(1)]);
 await q('select unassigned_track_resolve($1,$2,$3,$4)',[track,source.revision,'link',{trip,points:source.points,km:source.km,reason:'Уточнена GPS-запись'}]);
 expect(await q('select trip_id,source_current from gps_record_stop_drafts where track_id=$1',[track])).toEqual([{trip_id:trip,source_current:false}]);
});


it('records an explicit manual visit in Kyiv time without manufacturing GPS time',async()=>{
 const trip=id(50),job=id(51),operation=id(62);
 await q("insert into trips(id,status,vehicle_id,started_at,finished_at) values($1,'finished',$2,'2026-10-03T07:00Z','2026-10-03T12:00Z')",[trip,id(10)]);
 await q('insert into trip_jobs values($1,$2,0)',[trip,job]);
 const visit=(from,to)=>q('select gps_record_manual_visit($1,0,$2,$3,$4,$5,$6,$7) revision',
  [trip,operation,job,from,to,[id(2)],'Согласованный журнал работ']);
 await expect(visit('2026-10-03T08:00','2026-10-03T08:30')).rejects.toThrow('внутри выезда');
 expect(await q('select id from trip_stays')).toEqual([]);
 expect(await visit('2026-10-03T10:00','2026-10-03T10:30')).toEqual([{revision:1}]);
 expect(await visit('2026-10-03T10:00','2026-10-03T10:30')).toEqual([{revision:1}]);
 expect(await q('select manual_origin,status,minutes_mgr from trip_stays where id=$1',[operation])).toEqual([{manual_origin:true,status:'approved',minutes_mgr:'30.0000000000000000'}]);
 expect(await q('select * from vehicle_positions')).toEqual([]);
});
