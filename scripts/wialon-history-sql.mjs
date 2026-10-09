// One-off historical import. These statements never replay veh_ingest or
// touch vehicle_state, vehicle_positions, trip statuses, billing or sessions.
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const literal=value=>q(JSON.stringify(value))+'::jsonb';
function vehicleSQL({vehicleId,wialonId,plate}){
 if(!/^[0-9a-f-]{36}$/i.test(vehicleId))throw new Error('Invalid vehicle identifier');
 return `select id from public.vehicles where id=${q(vehicleId)}::uuid and wialon_id=${q(wialonId)} and plate=${q(plate)}`;
}
export function historyArchiveSQL(points,vehicle){
 for(const p of points)if(![p.lat,p.lng,p.speed].every(Number.isFinite)||p.lat<-90||p.lat>90||p.lng<-180||p.lng>180||p.speed<0||!Number.isFinite(Date.parse(p.ts)))throw new Error('Invalid import point');
 const payload=points.map(p=>[p.ts,p.lat,p.lng,p.speed]);
 return `with vehicle as (${vehicleSQL(vehicle)}), payload as(select x from jsonb_array_elements(${literal(payload)}) x), inserted as(
 insert into public.vehicle_telemetry_archive(vehicle_id,ts,lat,lng,speed,status,trip_id)
 select v.id,(x->>0)::timestamptz,(x->>1)::double precision,(x->>2)::double precision,(x->>3)::numeric,
 case when (x->>3)::numeric>3 then 'moving' else 'idle' end,
 (select p.trip_id from public.vehicle_positions p where p.vehicle_id=v.id and p.ts=(x->>0)::timestamptz)
 from payload cross join vehicle v where (x->>0)::timestamptz<=now()+interval '5 minutes'
 on conflict(vehicle_id,ts) do nothing returning 1)
 select (select count(*) from vehicle) as vehicles,(select count(*) from payload) as submitted,count(*) as inserted from inserted;`;
}
export function historyJournalSQL(ranges,vehicle,source){
 const payload=ranges.map(r=>({from:r.started_at,to:r.ended_at,reason:r.reason}));
 return `with vehicle as (${vehicleSQL(vehicle)}), payload as(select x from jsonb_array_elements(${literal(payload)}) x), inserted as(
 insert into public.unassigned_tracks(vehicle_id,started_at,last_ts,ended_at,state,review_note)
 select v.id,(x->>'from')::timestamptz,(x->>'to')::timestamptz,(x->>'to')::timestamptz,'review',
 ${q('История Wialon · '+source.filename+' · границы требуют проверки')}
 from payload cross join vehicle v where (x->>'from')::timestamptz<=(x->>'to')::timestamptz
 and not exists(select 1 from public.unassigned_tracks t where t.vehicle_id=v.id and t.started_at<=(x->>'to')::timestamptz and (t.state='recording' or coalesce(t.ended_at,t.last_ts)>=(x->>'from')::timestamptz))
 and not exists(select 1 from public.trips t where t.vehicle_id=v.id and t.started_at<=(x->>'to')::timestamptz and coalesce(t.finished_at,'infinity'::timestamptz)>=(x->>'from')::timestamptz)
 and exists(select 1 from public.vehicle_telemetry_archive a where a.vehicle_id=v.id and a.ts between (x->>'from')::timestamptz and (x->>'to')::timestamptz and a.trip_id is null and a.speed>3)
 returning id,vehicle_id,started_at,ended_at), events as(
 insert into public.unassigned_track_events(track_id,action,actor_id,reason,snapshot)
 select id,'history_import',null,${q('Импорт исторических сообщений Wialon')},${literal(source)}||jsonb_build_object('from',started_at,'to',ended_at,'vehicle_id',vehicle_id) from inserted returning 1)
 select (select count(*) from vehicle) as vehicles,(select count(*) from events) as events,coalesce(jsonb_agg(inserted),'[]'::jsonb) as tracks from inserted;`;
}
