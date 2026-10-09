import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {parseWialonMessages,filterTeleportPoints,historicalJourneys,uncoveredJourneys,historyTime} from '../src/core/wialon-history.js';
import {historyArchiveSQL,historyJournalSQL} from '../scripts/wialon-history-sql.mjs';
const vehicle={vehicleId:'260ba937-3d7c-4e53-adfc-a0045520fff4',wialonId:'28307408',plate:'AX3150EI'};
const point=(s,lat=49,lng=33,speed=10)=>({us:s*1e6,ts:new Date(s*1000).toISOString(),lat,lng,speed});
it('preserves WLNTMNS subsecond messages and rejects conflicting exact timestamps',()=>{
 const a='REG;1790197222;33.4;49.1;0;0;;;;WLNTMNS:1790197222000000000;';
 const b=a.replace('222000000000','222010000000');
 const r=parseWialonMessages(a+'\n'+b+'\n'+a+'\n'+a.replace(';33.4;',';33.5;'));
 expect(r.points).toHaveLength(2);expect(r.points[1].us-r.points[0].us).toBe(10000);expect(r.duplicates).toBe(1);expect(r.errors[0].error).toMatch(/Conflicting/);
 expect(historyTime('2026-09-24T07:00:00.650632+03:00')).toBe(historyTime('2026-09-24T04:00:00Z')+650632);
 expect(parseWialonMessages('REG;1;;49;0;0;').errors).toHaveLength(1);
});
it('quarantines a distant excursion without moving the anchor or inventing a connecting road',()=>{
 const ps=[point(100),point(160,-12,-77),point(220,-12.01,-77.01),point(280,49.001,33.001),point(281,49.001,33.0011)];
 const q=filterTeleportPoints(ps);expect(q.rejected).toHaveLength(2);expect(q.points.map(p=>p.us)).toEqual([100e6,280e6,281e6]);
});
it('keeps overnight stops away from base and only closes a confirmed return or GPS gap',()=>{
 const ps=[point(0,49,33,0),point(60),point(120,49.1,33.1,0),point(180,49.1,33.1),point(240,49,33,0),point(360,49,33,0),point(900)];
 const js=historicalJourneys(ps,{depots:[{lat:49,lng:33}],radiusKm:1,idleMinutes:2});
 expect(js.map(j=>[j.from,j.to,j.reason])).toEqual([[0,240e6,'depot_return'],[900e6,900e6,'file_end_unconfirmed']]);
});
it('subtracts complete trip and journal coverage, including protected live recordings',()=>{
 const ps=[0,10,20,21,30,40,50,51,60,70,80,90].map(n=>point(n));
 const ranges=uncoveredJourneys(ps,[{from:0,to:90e6}], [{from:0,to:15e6},{from:30e6,to:45e6},{from:60e6,to:Infinity}]);
 expect(ranges.map(r=>[r.from,r.to])).toEqual([[20e6,21e6],[50e6,51e6]]);
});
it('imports idempotently, preserves linked GPS and refuses existing trip or live journal coverage',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create table vehicles(id uuid primary key,wialon_id text,plate text);
 create table vehicle_positions(vehicle_id uuid,ts timestamptz,trip_id uuid,primary key(vehicle_id,ts));
 create table vehicle_telemetry_archive(vehicle_id uuid,ts timestamptz,lat double precision,lng double precision,speed numeric,status text,trip_id uuid,primary key(vehicle_id,ts));
 create table trips(vehicle_id uuid,started_at timestamptz,finished_at timestamptz);
 create table unassigned_tracks(id uuid default gen_random_uuid(),vehicle_id uuid,started_at timestamptz,last_ts timestamptz,ended_at timestamptz,state text,review_note text);
 create table unassigned_track_events(track_id uuid,action text,actor_id uuid,reason text,snapshot jsonb);
 insert into vehicles values('${vehicle.vehicleId}','28307408','AX3150EI');`);
 const ps=[point(1790000000),point(1790000060)];
 await db.exec(`insert into vehicle_positions values('${vehicle.vehicleId}','${ps[0].ts}','00000000-0000-0000-0000-000000000001')`);
 const archive=historyArchiveSQL(ps,vehicle);expect((await db.query(archive)).rows[0].inserted).toBe(2);expect((await db.query(archive)).rows[0].inserted).toBe(0);
 expect((await db.query('select trip_id from vehicle_telemetry_archive order by ts')).rows[0].trip_id).toBe('00000000-0000-0000-0000-000000000001');
 const ranges=[{started_at:ps[0].ts,ended_at:ps[1].ts}],source={filename:"car's.wln",sha256:'test'};
 const sql=historyJournalSQL(ranges,vehicle,source);const first=(await db.query(sql)).rows[0];expect(first.events).toBe(1);expect(first.tracks).toHaveLength(1);
 expect((await db.query(sql)).rows[0].events).toBe(0);
 expect((await db.query(historyArchiveSQL(ps,{...vehicle,plate:'wrong'}))).rows[0].vehicles).toBe(0);
 await db.exec('delete from unassigned_tracks;delete from unassigned_track_events');
 await db.exec(`insert into trips values('${vehicle.vehicleId}','${ps[0].ts}','${ps[1].ts}')`);expect((await db.query(sql)).rows[0].events).toBe(0);
 await db.exec('delete from trips');await db.exec(`insert into unassigned_tracks(vehicle_id,started_at,last_ts,state) values('${vehicle.vehicleId}','${ps[0].ts}','${ps[0].ts}','recording')`);expect((await db.query(sql)).rows[0].events).toBe(0);
 }finally{await db.close();}
});
