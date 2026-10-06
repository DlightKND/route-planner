import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const timestamp=m=>new Date(Date.UTC(2026,9,1,7,0)+m*60000).toISOString();
const ingest=(m,lat=50,lng=30,speed=0,status='idle',unit='car')=>query('select veh_ingest($1,$2,$3,$4,$5,$6)',[unit,timestamp(m),lat,lng,speed,status]);
const quote=id=>query('select unassigned_track_quote($1) q',[id]).then(x=>x[0].q);
const resolve=(id,rev,action,data)=>query('select unassigned_track_resolve($1,$2,$3,$4) result',[id,rev,action,data]);
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync(new URL('./fixtures/unassigned-tracking-base.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261006070024_unassigned_tracking_journal.sql',import.meta.url),'utf8'));
 await db.exec("create trigger vehicle_state_depot_track after insert or update of ts,lat,lng on vehicle_state for each row execute function vehicle_depot_track()");
 await query("insert into profiles values($1,'admin',true),($2,'engineer',true),($3,'engineer',true),($4,'logist',true)",[uid(1),uid(2),uid(3),uid(4)]);
 await query("select set_config('test.uid',$1,false)",[uid(1)]);
 await query("insert into vehicles(id,wialon_id,name)values($1,'car','Тест'),($2,'other','Другая')",[uid(10),uid(11)]);
 await query("insert into clients(id,name,lat,lng,is_base)values($1,'Депо',50,30,true)",[uid(20)]);
},30000);
afterAll(async()=>await db?.close());
it('revokes Supabase default table and sequence writes, including RLS-bypassing truncate',async()=>{
 for(const role of ['anon','authenticated']){
  for(const table of ['unassigned_tracks','unassigned_track_events','vehicle_telemetry_archive']){
   for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])
    expect((await query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege]))[0].allowed).toBe(false);
  }
  expect((await query("select has_sequence_privilege($1,'unassigned_track_events_id_seq','USAGE') allowed",[role]))[0].allowed).toBe(false);
 }
});
it('archives unassigned packets, duplicates and late points without rewinding the vehicle',async()=>{
 await ingest(0);await ingest(1,50.005,30,40,'moving');await ingest(2,50.01,30,40,'moving');
 await ingest(2,50.01,30,40,'moving');await ingest(1.5,50.007,30,40,'moving');
 expect((await query('select count(*) n from vehicle_telemetry_archive'))[0].n).toBe(4);
 expect((await query('select ts from vehicle_state where vehicle_id=$1',[uid(10)]))[0].ts.toISOString()).toBe(timestamp(2));
 expect(await query('select * from unassigned_tracks')).toHaveLength(1);
 expect(await query('select * from vehicle_positions')).toHaveLength(0);
});
it('closes an unknown journey on continuous depot idle and preserves its measured arrival',async()=>{
 for(let m=3;m<=13;m++)await ingest(m);
 const [r]=await query('select * from unassigned_tracks');expect(r.state).toBe('review');expect(r.started_at.toISOString()).toBe(timestamp(0));expect(r.ended_at.toISOString()).toBe(timestamp(3));
 const q=await quote(r.id);expect(q.points).toBe(5);expect(q.km).toBeGreaterThan(1);expect(q.cost).toBe(Math.round(q.km*12.5*100)/100);
});
it('charges exactly once, checks current GPS and costs, and records a reversible manager decision',async()=>{
 const [r]=await query('select * from unassigned_tracks');const q=await quote(r.id),data={engineer:uid(2),reason:'Личная поездка',points:q.points,km:q.km,cost:q.cost};
 await expect(resolve(r.id,q.revision,'charge',{...data,cost:1})).rejects.toThrow('Себестоимость');
 await expect(resolve(r.id,q.revision,'charge',{...data,points:0})).rejects.toThrow('GPS изменился');
 await resolve(r.id,q.revision,'charge',data);await expect(resolve(r.id,q.revision,'charge',data)).rejects.toThrow('изменилась');
 expect(await query('select * from unassigned_track_events')).toHaveLength(1);
 await query('select unassigned_track_charge_cancel($1,$2,$3)',[r.id,q.revision+1,'Ошибочное списание']);
 expect((await query('select state from unassigned_tracks'))[0].state).toBe('review');expect(await query('select * from unassigned_track_events')).toHaveLength(2);
});
it('creates one request, one task and one reviewed trip atomically, without rewriting raw GPS',async()=>{
 const [r]=await query('select * from unassigned_tracks'),q=await quote(r.id),data={client:uid(20),title:'Восстановление поездки',engineer:uid(2),reason:'Работы у клиента',points:q.points,km:q.km};
 const before=(await query('select count(*) n from vehicle_telemetry_archive'))[0].n;
 await expect(resolve(r.id,q.revision,'chain',{...data,engineer:uid(999)})).rejects.toThrow('активного инженера');
 expect(await query('select * from jobs')).toHaveLength(0);
 const [{result}]=await resolve(r.id,q.revision,'chain',data);
 expect(await query('select * from jobs')).toHaveLength(1);expect(await query('select * from service_orders')).toHaveLength(1);expect(await query('select * from trip_service_orders')).toHaveLength(1);
 const [t]=await query('select * from trips where id=$1',[result.trip_id]);expect(t.status).toBe('finished');expect(t.started_at.toISOString()).toBe(timestamp(0));expect(t.finished_at.toISOString()).toBe(timestamp(3));
 expect(await query('select * from vehicle_positions where trip_id=$1',[t.id])).toHaveLength(q.points);
 expect((await query('select count(*) n from vehicle_telemetry_archive'))[0].n).toBe(before);
});
it('keeps gaps out of mileage and closes a stale journey for review before starting another',async()=>{
 await ingest(20,50,30,30,'moving','other');await ingest(21,50.005,30,30,'moving','other');await ingest(40,50.5,30,30,'moving','other');
 const rs=await query('select * from unassigned_tracks where vehicle_id=$1 order by started_at',[uid(11)]);expect(rs).toHaveLength(2);expect(rs[0].state).toBe('review');expect(rs[0].review_note).toContain('Разрыв');
 const q=await quote(rs[0].id);expect(q.km).toBeLessThan(1);
});
it('does not guess between eligible trips at a depot exit',async()=>{
 await query("insert into trips(vehicle_id,date_from,day_plan,status)values($1,'2026-10-01','{\"start\":{\"d\":\"2026-10-01\",\"t\":10}}','assigned'),($1,'2026-10-01','{\"start\":{\"d\":\"2026-10-01\",\"t\":10}}','assigned')",[uid(10)]);
 await ingest(50);for(let m=51;m<=63;m++)await ingest(m,50.025,30,40,'moving');
 expect((await query("select count(*) n from trips where status='in_progress'"))[0].n).toBe(0);
 const rs=await query("select * from unassigned_tracks where vehicle_id=$1 and state='recording'",[uid(10)]);expect(rs).toHaveLength(1);expect(rs[0].review_note).toContain('Несколько');
});
it('automatically starts a unique trip and stops capture after a continuous return',async()=>{
 await query("delete from trips where status='assigned'");await query("insert into trips(id,vehicle_id,date_from,day_plan,status)values($1,$2,'2026-10-01','{\"start\":{\"d\":\"2026-10-01\",\"t\":10}}','assigned')",[uid(50),uid(11)]);
 await ingest(70,50,30,0,'idle','other');for(let m=71;m<=82;m++)await ingest(m,50.025,30,40,'moving','other');
 expect((await query('select status from trips where id=$1',[uid(50)]))[0].status).toBe('in_progress');
 for(let m=83;m<=94;m++)await ingest(m,50,30,0,'idle','other');
 expect((await query('select active_trip_for_vehicle($1) tid',[uid(11)]))[0].tid).toBeNull();
 const [s]=await query('select * from trip_tracking_sessions where trip_id=$1',[uid(50)]);expect(s.state).toBe('finish_candidate');expect(s.finish_candidate_at.toISOString()).toBe(timestamp(83));
 await query('select trip_finish($1)',[uid(50)]);expect((await query('select finished_at from trips where id=$1',[uid(50)]))[0].finished_at.toISOString()).toBe(timestamp(83));
});
it('isolates the queue and write RPCs from engineers, anonymous and inactive users',async()=>{
 const [r]=await query("select * from unassigned_tracks where state='review' limit 1"),q=await quote(r.id);
 await query("select set_config('test.uid',$1,false)",[uid(2)]);await db.exec('set role authenticated');
 expect(await query('select * from unassigned_tracks')).toHaveLength(0);
 await expect(quote(r.id)).rejects.toThrow('Только диспетчер');await expect(resolve(r.id,q.revision,'charge',{})).rejects.toThrow('Только диспетчер');
 await expect(query("insert into unassigned_tracks(vehicle_id,started_at,last_ts)values($1,now(),now())",[uid(10)])).rejects.toThrow('permission denied');
 await db.exec('reset role');await query("select set_config('test.uid','',false)");await expect(quote(r.id)).rejects.toThrow('Только диспетчер');
 expect((await query("select has_function_privilege('anon','unassigned_track_resolve(uuid,integer,text,jsonb)','EXECUTE') allowed"))[0].allowed).toBe(false);
 await query("update profiles set active=false where id=$1",[uid(4)]);await query("select set_config('test.uid',$1,false)",[uid(4)]);await db.exec('set role authenticated');
 expect(await query('select * from unassigned_tracks')).toHaveLength(0);await expect(quote(r.id)).rejects.toThrow('Только диспетчер');
 await db.exec('reset role');await query("update profiles set active=true where id=$1",[uid(4)]);
 await query("select set_config('test.uid',$1,false)",[uid(1)]);
});
it('shows a charge only to its engineer and retains the manager audit when cancelled',async()=>{
 const [r]=await query("select * from unassigned_tracks where vehicle_id=$1 and state='review' order by started_at limit 1",[uid(11)]),q=await quote(r.id);
 await resolve(r.id,q.revision,'charge',{engineer:uid(2),reason:'Проверенная личная поездка',points:q.points,km:q.km,cost:q.cost});
 await query("select set_config('test.uid',$1,false)",[uid(2)]);await db.exec('set role authenticated');
 expect(await query('select * from unassigned_tracks')).toHaveLength(1);expect(await query('select * from unassigned_track_events')).toHaveLength(1);
 expect(await query('select * from vehicle_telemetry_archive')).toHaveLength(0);
 await expect(query('select unassigned_track_charge_cancel($1,$2,$3)',[r.id,q.revision+1,'Сам себе отменяю'])).rejects.toThrow('Недостаточно прав');
 await query("select set_config('test.uid',$1,false)",[uid(3)]);expect(await query('select * from unassigned_tracks')).toHaveLength(0);expect(await query('select * from unassigned_track_events')).toHaveLength(0);
 await db.exec('reset role');await query("select set_config('test.uid',$1,false)",[uid(1)]);
 await query('select unassigned_track_charge_cancel($1,$2,$3)',[r.id,q.revision+1,'Уточнение назначения поездки']);
 expect((await query('select snapshot from unassigned_track_events where track_id=$1 and action=\'charge_cancel\' order by id desc limit 1',[r.id]))[0].snapshot.cost).toBe(q.cost);
});
it('rejects non-finite and non-positive charge inputs without changing a journey',async()=>{
 const [r]=await query("select * from unassigned_tracks where state='review' limit 1"),q=await quote(r.id),data={engineer:uid(2),reason:'Проверка расчёта',points:q.points,km:q.km,cost:q.cost};
 for(const km of [-1,'NaN','Infinity'])await expect(resolve(r.id,q.revision,'charge',{...data,km})).rejects.toThrow('Некорректный пробег');
 for(const rate of [0,-1,'NaN','Infinity']){await query('update vehicles set cost_per_km=$1 where id=$2',[rate,r.vehicle_id]);await expect(resolve(r.id,q.revision,'charge',data)).rejects.toThrow('положительные конечные');}
 await query('update vehicles set cost_per_km=null where id=$1',[r.vehicle_id]);
 expect((await query('select state,revision from unassigned_tracks where id=$1',[r.id]))[0]).toEqual({state:'review',revision:q.revision});
});
it('never overwrites a measured track or confirmed stay while linking a queue journey',async()=>{
 const [r]=await query("select * from unassigned_tracks where state='review' limit 1"),q=await quote(r.id);
 await query("insert into trips(id,vehicle_id,status)values($1,$2,'planned')",[uid(60),r.vehicle_id]);
 await query('insert into trip_stays(trip_id)values($1)',[uid(60)]);
 await expect(resolve(r.id,q.revision,'link',{trip:uid(60),reason:'Восстановить привязку',points:q.points,km:q.km})).rejects.toThrow('фактический трек или стоянки');
 expect(await query('select * from trip_stays where trip_id=$1',[uid(60)])).toHaveLength(1);
 expect((await query('select state from unassigned_tracks where id=$1',[r.id]))[0].state).toBe('review');
});
it('requires uninterrupted idle at return and keeps a later departure separate from stopped capture',async()=>{
 await query("insert into vehicles(id,wialon_id,name)values($1,'return','Возврат')",[uid(70)]);
 await query("insert into trips(id,vehicle_id,date_from,day_plan,status)values($1,$2,'2026-10-01','{\"start\":{\"d\":\"2026-10-01\",\"t\":10}}','assigned')",[uid(71),uid(70)]);
 await ingest(100,50,30,0,'idle','return');for(let m=101;m<=112;m++)await ingest(m,50.025,30,40,'moving','return');
 expect((await query('select status from trips where id=$1',[uid(71)]))[0].status).toBe('in_progress');
 await ingest(113,50,30,0,'idle','return');await ingest(114,50,30,8,'moving','return');
 for(let m=115;m<=120;m++)await ingest(m,50,30,0,'idle','return');
 expect((await query('select state from trip_tracking_sessions where trip_id=$1',[uid(71)]))[0].state).toBe('active');
 // The ten-minute radio gap cannot count towards a ten-minute return dwell.
 await ingest(130,50,30,0,'idle','return');for(let m=131;m<=140;m++)await ingest(m,50,30,0,'idle','return');
 expect((await query('select finish_candidate_at from trip_tracking_sessions where trip_id=$1',[uid(71)]))[0].finish_candidate_at.toISOString()).toBe(timestamp(130));
 await ingest(141,50,30,8,'moving','return');
 expect((await query('select active_trip_for_vehicle($1) tid',[uid(70)]))[0].tid).toBeNull();
 expect((await query('select finish_candidate_at from trip_tracking_sessions where trip_id=$1',[uid(71)]))[0].finish_candidate_at.toISOString()).toBe(timestamp(130));
 expect(await query("select * from unassigned_tracks where vehicle_id=$1 and state='recording'",[uid(70)])).toHaveLength(1);
});
it('recovers surviving unassigned history while leaving original trip links and positions unchanged',async()=>{
 const historic=new PGlite();
 try{
  await historic.exec(readFileSync(new URL('./fixtures/unassigned-tracking-base.sql',import.meta.url),'utf8'));
  await historic.query("insert into vehicles(id,wialon_id)values($1,'history')",[uid(80)]);await historic.query("insert into trips(id,vehicle_id)values($1,$2)",[uid(81),uid(80)]);
  for(const [m,tid,status] of [[0,null,'moving'],[1,null,'moving'],[40,null,'moving'],[41,null,'moving'],[42,uid(81),'moving'],[43,uid(81),'idle'],[44,null,'idle'],[45,null,'idle']])
   await historic.query('insert into vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status)values($1,$2,$3,50,30,0,$4)',[uid(80),tid,timestamp(m),status]);
  const before=(await historic.query('select * from vehicle_positions order by ts')).rows;
  await historic.exec(readFileSync(new URL('../supabase/migrations/20261006070024_unassigned_tracking_journal.sql',import.meta.url),'utf8'));
  expect((await historic.query('select * from vehicle_positions order by ts')).rows).toEqual(before);
  expect((await historic.query('select * from vehicle_telemetry_archive')).rows).toHaveLength(8);
  const recovered=(await historic.query('select * from unassigned_tracks order by started_at')).rows;expect(recovered).toHaveLength(2);
  expect(recovered.map(x=>x.state)).toEqual(['review','review']);expect(recovered[0].review_note).toContain('Историческая');
 }finally{await historic.close();}
},30000);
