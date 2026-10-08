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
