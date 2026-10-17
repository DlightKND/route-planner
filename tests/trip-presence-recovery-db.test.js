import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {rebuildTripTrack} from '../src/core/trip-presence-recovery.js';
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(n,role='authenticated')=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role '+role);};
const deny=async(fn,re)=>{await db.exec('savepoint denied');await expect(fn()).rejects.toThrow(re);await db.exec('rollback to savepoint denied; release savepoint denied');};
const rev=async()=>Number((await q('select workbench_revision from trips where id=$1',[id(10)]))[0].workbench_revision);
const point=(km,min)=>({lat:50,lng:30+km/(111.32*Math.cos(50*Math.PI/180)),ts:new Date(Date.UTC(2026,9,12,6,min)).toISOString()});
const raw=()=>[point(0,-1),point(1,0),...Array.from({length:181},(_,i)=>point(100,360+i))];
const context=async()=> (await q('select trip_track_rebuild_context($1) data',[id(10)]))[0].data;
const calculate=async()=>{const c=await context(),p=raw();const m=await rebuildTripTrack(p,{}, {...c.trip,stops:c.stops},async(a,b)=>({ok:true,sec:10800,km:120,line:[[a.lng,a.lat],[b.lng,b.lat]]}));m.presence.source_digest=c.source_digest;m.presence.source_to=c.source_to;m.presence.source_from=c.source_from;delete m.presence.input_points;return {c,m};};
const save=async(c,m,expected=c.trip.workbench_revision)=>(await q('select trip_track_rebuild_save($1,$2,$3,$4,$5) result',[id(10),expected,c.source_to,c.source_digest,m]))[0].result;
const stay=async()=>(await q('select * from trip_stays where trip_id=$1',[id(10)]))[0];
const approve=async(extra=180,mins=180+extra,patch={})=>{const s=await stay(),key=s.presence_evidence.recovery_parts[0]?.key;return q('select trip_presence_save_tasks($1,$2,$3,$4)',[id(10),await rev(),[{id:s.id,job_id:id(20),crew_ids:[id(3)],minutes_mgr:mins,status:'approved',recovery_acceptance:key?{[key]:extra}:{},...patch}],'Сверено присутствие']);};
beforeAll(async()=>{
 db=new PGlite();await db.exec(file('./fixtures/trip-workbench-base.sql'));await db.exec(file('../supabase/migrations/20260921133835_trip_workbench.sql'));await db.exec(file('../supabase/migrations/20260922190447_service_orders.sql'));await db.exec(file('../supabase/migrations/20260923124804_request_task_trip_links.sql'));
 await db.exec(`alter table jobs add column owner_id uuid,add column curator_id uuid;alter table trips add column owner_id uuid,add column curator_id uuid,add column fact_km_source text,add column fact_km_note text;alter table service_orders add column owner_id uuid,add column curator_id uuid;alter table trip_stays add column created_at timestamptz default now();
 create table trip_tracks(trip_id uuid primary key references trips(id),km numeric,data jsonb,updated_at timestamptz);
 grant select on trips,trip_stays,trip_tracks,profiles to authenticated;alter function job_point(uuid) set search_path=public;grant usage on schema dlight_private to authenticated;`);
 await db.exec(file('../supabase/migrations/20260923133423_trip_cost_allocation.sql'));
 const responsibility=file('../supabase/migrations/20260929110000_entity_responsibility.sql'),start=responsibility.indexOf('function dlight_private.responsibility_manager('),prefix=responsibility.lastIndexOf('create ',start);await db.exec(responsibility.slice(prefix,responsibility.indexOf('$$;',start)+3));
 await db.exec(file('../supabase/migrations/20261012135646_trip_track_presence_recovery.sql'));
 await db.exec(file('../supabase/migrations/20261012144614_trip_presence_recovery_refresh.sql'));
 await db.exec("create function public.is_owner_or_mgr(uuid) returns boolean language sql stable as $$select public.user_role() in ('admin','logist') or auth.uid()=$1$$;create table trip_tracking_sessions(trip_id uuid,state text,finish_candidate_at timestamptz);");
 await db.exec(file('../supabase/migrations/20261017094833_validated_trip_mileage.sql'));
 await db.exec(file('../supabase/migrations/20261017104054_gps_anchor_serialization.sql'));
},30000);
afterAll(async()=>await db?.close());
beforeEach(async()=>{
 await db.exec('begin');await q("insert into profiles values($1,'admin',true),($2,'logist',true),($3,'engineer',true),($4,'admin',false),($5,'engineer',true)",[1,2,3,4,5].map(id));
 await q('select set_config(\'test.uid\',$1,true)',[id(1)]);
 const c=point(100,0);await q("insert into clients values($1,'Объект',$2,$3)",[id(30),c.lat,c.lng]);await q('insert into jobs(id,client_id) values($1,$2)',[id(20),id(30)]);
 await q("insert into trips(id,status,lead_engineer,engineer_ids,started_at,finished_at,owner_id,curator_id) values($1,'finished',$2,array[$2]::uuid[],$3,$4,$5,$5)",[id(10),id(3),raw()[0].ts,raw().at(-1).ts,id(5)]);await q('insert into trip_jobs values($1,$2,0)',[id(10),id(20)]);
 for(const [i,p]of raw().entries())await q('insert into vehicle_positions values($1,$2,$3,$4,$5)',[i+1,id(10),p.ts,p.lat,p.lng]);
});
afterEach(async()=>await db.exec('rollback'));
it('stores observed GPS and proposed time atomically, before confirmation',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);const s=await stay();expect(s.minutes_raw).toBe(180);expect(s.minutes_mgr).toBeNull();expect(s.status).toBe('detected');expect(s.presence_evidence.recovery_parts[0].minutes).toBe(180);expect(await q('select * from trip_tracks')).toHaveLength(1);
});
it('allows 3 to 6 hours and rejects reductions of the observed part or excessive recovered time',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);
 await approve(0);expect((await stay()).minutes_mgr).toBe('180');await approve(60);expect((await stay()).minutes_mgr).toBe('240');await approve(180);expect((await stay()).minutes_mgr).toBe('360');
 await deny(()=>approve(-1,179),/восстановленная|GPS/);await deny(()=>approve(181,361),/восстановленная|GPS/);await deny(()=>approve(0,120),/GPS|Итог/);expect((await stay()).minutes_mgr).toBe('360');
});
it('keeps exact accepted intervals when only part of the missing arrival is approved',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);await approve(60);const s=await stay();expect(new Date(s.stay_from).toISOString()).toBe(point(100,300).ts);expect(new Date(s.stay_to).toISOString()).toBe(point(100,540).ts);expect(s.accepted_intervals).toHaveLength(2);expect(s.minutes_raw).toBe(180);
});
it('is idempotent and does not reset a managers approval on a network retry or repeated reconstruction',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);await approve(60);const before=await rev();const retry=await save(c,m,999);expect(retry.repeated).toBe(true);expect(await rev()).toBe(before);expect((await stay()).minutes_mgr).toBe('240');expect(await q('select * from trip_stays')).toHaveLength(1);
});
it('rejects stale presence revisions and a GPS history changed during the ORS operation',async()=>{
 await as(1);const {c,m}=await calculate();await db.exec('reset role');await q('update vehicle_positions set lng=lng+.0001 where id=1');await as(1);await deny(()=>save(c,m),/GPS-данные/);expect(await q('select * from trip_tracks')).toHaveLength(0);
});
it('does not accept invented GPS observations, expanded gaps or unknown objects',async()=>{
 await as(1);const {c,m}=await calculate();const forged=structuredClone(m);forged.presence.stays[0].presence_evidence.gps_intervals[0].from=point(100,180).ts;await deny(()=>save(c,forged),/GPS/);
 const gap=structuredClone(m);gap.presence.stays[0].presence_evidence.recovery_parts[0].from=point(100,-10).ts;await deny(()=>save(c,gap),/участок/);
 const alien=structuredClone(m);alien.presence.stays[0].presence_evidence.job_ids=[id(999)];await deny(()=>save(c,alien),/Объект/);expect(await q('select * from trip_stays')).toHaveLength(0);
});
it.each([3,4,99])('denies engineer, inactive or missing manager profile %s',async n=>{await as(n);await deny(()=>context(),/менеджер/);});
it('allows the scoped trip curator and denies a foreign trip or anonymous calls',async()=>{
 await as(5);const {c,m}=await calculate();await save(c,m);expect(await q('select * from trip_stays')).toHaveLength(1);await as(null,'anon');await deny(()=>context(),/permission denied/);
});
it('legacy sparse-message detector cannot relock a restored gap as observed GPS',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);expect((await q('select trip_detect_stays($1) count',[id(10)]))[0].count).toBe(0);expect((await stay()).minutes_raw).toBe(180);
});

it('rejects disguising observed GPS as an editable gap even before the first saved proposal',async()=>{
 await as(1);const {c,m}=await calculate(),forged=structuredClone(m),e=forged.presence.stays[0].presence_evidence;
 e.gps_intervals=[];e.recovery_parts[0].to=point(100,540).ts;e.recovery_parts[0].gap_to=point(100,540).ts;e.recovery_parts[0].anchor_to.ts=point(100,540).ts;
 await deny(()=>save(c,forged),/наблюдаемые GPS/);expect(await q('select * from trip_stays')).toHaveLength(0);
});
it('keeps a reviewed partial arrival when a refreshed ETA still contains the exact accepted interval',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);await approve(60);const original=await stay();
 const fresh=structuredClone(m),s=fresh.presence.stays[0];s.presence_evidence.recovery_parts[0].from=point(100,190).ts;s.presence_evidence.recovery_parts[0].minutes=170;s.recovered_minutes=170;
 await save(c,fresh,await rev());const next=await stay();expect(next.status).toBe('approved');expect(next.minutes_mgr).toBe('240');expect(next.accepted_intervals).toEqual(original.accepted_intervals);
});
it('rejects removing still-observed GPS time in a later reconstruction and rolls back the track',async()=>{
 await as(1);const {c,m}=await calculate();await save(c,m);await approve(60);
 const original=await stay(),forged=structuredClone(m),s=forged.presence.stays[0];
 s.presence_evidence.gps_intervals[0].from=point(100,420).ts;s.gps_minutes=120;
 s.presence_evidence.recovery_parts=[];
 const revision=await rev();await deny(()=>save(c,forged,revision),/не может удалить/);
 expect((await stay()).minutes_mgr).toBe(original.minutes_mgr);expect((await q('select data from trip_tracks'))[0].data.presence).toEqual(m.presence);
});
it('uses the captured GPS cutoff while new later messages arrive',async()=>{
 await as(1);const {c,m}=await calculate();await db.exec('reset role');const p=point(100,541);
 await q('insert into vehicle_positions values($1,$2,$3,$4,$5)',[999,id(10),p.ts,p.lat,p.lng]);await as(1);
 await save(c,m);expect((await stay()).minutes_raw).toBe(180);
});

it('replaces the legacy 21747 km fact when a client only saves its reviewed reconstruction',async()=>{
 await q('update trips set fact_km=21747,fact_km_source=null where id=$1',[id(10)]);
 await as(1);const {c,m}=await calculate(),r=await save(c,m);
 const [t]=await q('select fact_km,fact_km_source from trips where id=$1',[id(10)]);
 expect(+t.fact_km).toBe(Math.round(m.km*10)/10);expect(t.fact_km_source).toBe('track');expect(r.fact_updated).toBe(true);
 expect(+(await q('select km from trip_tracks where trip_id=$1',[id(10)]))[0].km).toBeCloseTo(m.km,6);
 const retry=await save(c,m);expect(retry.repeated).toBe(true);expect(retry.fact_updated).toBe(false);
});
it('does not replace an explicit odometer during attendance reconstruction',async()=>{
 await q("update trips set fact_km=1700,fact_km_source='odometer' where id=$1",[id(10)]);
 await as(1);const {c,m}=await calculate(),r=await save(c,m);
 expect((await q('select fact_km,fact_km_source from trips where id=$1',[id(10)]))[0]).toEqual({fact_km:'1700',fact_km_source:'odometer'});expect(r.fact_updated).toBe(false);
});
it('rejects a financial GPS total that differs from its retained geometry atomically',async()=>{
 await as(1);const {c,m}=await calculate();
 await deny(()=>q('select trip_track_rebuild_save($1,$2,$3,$4,$5,$6,$7,$8)',[id(10),c.trip.workbench_revision,c.source_to,c.source_digest,m,21747,'track','']),/совпадать/);
 expect(await q('select * from trip_tracks')).toHaveLength(0);expect(await q('select * from trip_stays')).toHaveLength(0);
});
it('rejects inconsistent segment sums before writing a map or a financial fact',async()=>{
 await as(1);const {c,m}=await calculate();m.km+=1;await deny(()=>save(c,m),/отрезками/);
 expect(await q('select * from trip_tracks')).toHaveLength(0);
});
it('does not accept a numeric fact with an unspecified source',async()=>{
 await as(1);const {c,m}=await calculate();
 await deny(()=>q('select trip_track_rebuild_save($1,$2,$3,$4,$5,$6,$7,$8)',[id(10),c.trip.workbench_revision,c.source_to,c.source_digest,m,100,null,'']),/Некорректный факт/);
});
it.each([null,'track'])('closes the engineers trip without promoting raw or stale %s mileage',async source=>{
 await q("select set_config('dlight.via_rpc','1',true)");
 await q("update trips set status='in_progress',finished_at=null,fact_km=21747,fact_km_source=$2 where id=$1",[id(10),source]);
 await as(3);expect((await q('select trip_finish($1) state',[id(10)]))[0].state).toBe('finished');
 const [t]=await q('select status,fact_km,fact_km_source,fact_km_note from trips where id=$1',[id(10)]);
 expect(t.status).toBe('finished');expect(t.fact_km).toBeNull();expect(t.fact_km_source).toBeNull();expect(t.fact_km_note).toContain('ожидает проверки');
});
it('preserves a managers explicit odometer when the engineer closes the trip',async()=>{
 await q("select set_config('dlight.via_rpc','1',true)");
 await q("update trips set status='in_progress',finished_at=null,fact_km=1700,fact_km_source='odometer' where id=$1",[id(10)]);
 await as(3);await q('select trip_finish($1)',[id(10)]);
 const [t]=await q('select fact_km,fact_km_source from trips where id=$1',[id(10)]);
 expect(+t.fact_km).toBe(1700);expect(t.fact_km_source).toBe('odometer');
});
it('restricts the authoritative-mileage read to the existing trip access scope',async()=>{
 await q("update trips set fact_km=120,fact_km_source='track' where id=$1",[id(10)]);
 await as(3);expect(+(await q('select trip_fact_km($1) km',[id(10)]))[0].km).toBe(120);
 await as(99);expect((await q('select trip_fact_km($1) km',[id(10)]))[0].km).toBeNull();
 await as(null,'anon');await deny(()=>q('select trip_fact_km($1)',[id(10)]),/permission denied/);
});
it('blocks confirmation of the legacy raw total before it can reach odometer accounting',async()=>{
 await q('update trips set fact_km=21747,fact_km_source=null where id=$1',[id(10)]);
 await as(5);await deny(()=>q('select trip_confirm($1)',[id(10)]),/Сначала проверь/);
 expect((await q('select status from trips where id=$1',[id(10)]))[0].status).toBe('finished');
 const {c,m}=await calculate();await save(c,m);
 expect((await q('select trip_confirm($1) state',[id(10)]))[0].state).toBe('done');
});

it('accepts GPS anchors round-tripped through the production 15-digit JSON representation',async()=>{
 await as(1);const {c,m}=await calculate();
 const anchor=m.presence.stays[0].presence_evidence.recovery_parts[0].anchor_to;
 const original=anchor.lng;anchor.lng=Number(original.toPrecision(15));
 expect(anchor.lng).not.toBe(original);expect(Math.abs(anchor.lng-original)).toBeLessThan(1e-12);
 await save(c,m);expect(await q('select * from trip_tracks')).toHaveLength(1);
});
it.each(['anchor_from','anchor_to'])('still rejects a changed %s coordinate and rolls back mileage',async key=>{
 await as(1);const {c,m}=await calculate();
 m.presence.stays[0].presence_evidence.recovery_parts[0][key].lng+=1e-10;
 await deny(()=>save(c,m),/Опоры достройки/);
 expect(await q('select * from trip_tracks')).toHaveLength(0);
 expect((await q('select fact_km from trips where id=$1',[id(10)]))[0].fact_km).toBeNull();
});
