-- Synthetic QA only. Both blocks roll back every data mutation.
begin;
select set_config('request.jwt.claim.sub',(select id::text from profiles where role in ('admin','logist') and active limit 1),true);
do $$ declare v uuid;c uuid;q uuid;e uuid;quote jsonb;r jsonb;begin
select id into e from profiles where active and role='engineer' limit 1;
insert into vehicles(name,cost_per_km) values('QA unassigned rollback',12.5) returning id into v;
insert into clients(name,lat,lng)values('QA rollback',50,30)returning id into c;
insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,speed,status)values(v,now()-interval '2 hours',50,30,30,'moving'),(v,now()-interval '119 minutes',50.01,30,30,'moving');
insert into unassigned_tracks(vehicle_id,started_at,last_ts,ended_at,state)values(v,now()-interval '2 hours',now()-interval '119 minutes',now()-interval '119 minutes','review')returning id into q;
quote:=unassigned_track_quote(q);
r:=unassigned_track_resolve(q,0,'chain',jsonb_build_object('client',c,'title','QA chain rollback','engineer',e,'reason','QA transactional smoke','points',quote->'points','km',quote->'km'));
if not exists(select 1 from trips where id=(r->>'trip_id')::uuid and status='finished')then raise exception 'missing imported trip';end if;
insert into unassigned_tracks(vehicle_id,started_at,last_ts,ended_at,state)values(v,now()-interval '4 hours',now()-interval '239 minutes',now()-interval '239 minutes','review')returning id into q;
insert into vehicle_telemetry_archive(vehicle_id,ts,lat,lng,speed,status)values(v,now()-interval '4 hours',50,30,30,'moving'),(v,now()-interval '239 minutes',50.01,30,30,'moving');
quote:=unassigned_track_quote(q);
r:=unassigned_track_resolve(q,0,'charge',jsonb_build_object('engineer',e,'reason','QA charge rollback','points',quote->'points','km',quote->'km','cost',quote->'cost'));
if r->>'cost' is null then raise exception 'missing charge';end if;
perform unassigned_track_charge_cancel(q,1,'QA cancel rollback');
if not exists(select 1 from unassigned_tracks where id=q and state='review' and revision=2)then raise exception 'missing cancelled charge';end if;
end $$; rollback;

begin;
select set_config('request.jwt.claim.sub',(select id::text from profiles where role in ('admin','logist') and active limit 1),true);
do $qa$ declare v uuid;c uuid;j uuid;o uuid;t uuid;e uuid;actor uuid;at timestamptz:=date_trunc('minute',now()-interval '6 hours');n integer;i integer;unit text;local_at timestamp;
begin
actor:=auth.uid();select id into e from profiles where active and role='engineer' limit 1;select depot_outside_minutes into n from settings where id=true;
insert into vehicles(name,cost_per_km,wialon_id)values('QA telemetry rollback',12.5,'qa-'||gen_random_uuid())returning id,wialon_id into v,unit;
insert into clients(name,lat,lng,is_base)values('QA depot rollback',40,20,true)returning id into c;
insert into jobs(client_id,created_by,assigned_engineer,engineer_ids,owner_id,curator_id)values(c,actor,e,array[e],actor,actor)returning id into j;
o:=service_order_save_one(null,0,jsonb_build_object('title','QA telemetry','work_mode','onsite','lead_engineer',e,'engineer_ids',jsonb_build_array(e)),j,'[]'::jsonb);
local_at:=at at time zone 'Europe/Kyiv';
insert into trips(vehicle_id,date_from,date_to,day_plan,status,service_order_id,lead_engineer,engineer_ids,owner_id,curator_id)values(v,local_at::date,local_at::date,jsonb_build_object('start',jsonb_build_object('d',local_at::date,'t',extract(hour from local_at)+extract(minute from local_at)/60)), 'assigned',o,e,array[e],actor,actor)returning id into t;
perform veh_ingest(unit,at,40,20,0,'idle');
for i in 1..n+3 loop perform veh_ingest(unit,at+make_interval(mins=>i),40.1,20,40,'moving');end loop;
if not exists(select 1 from trips where id=t and status='in_progress')then raise exception 'auto start failed';end if;
for i in n+4..2*n+7 loop perform veh_ingest(unit,at+make_interval(mins=>i),40,20,0,'idle');end loop;
if active_trip_for_vehicle(v) is not null then raise exception 'auto stop failed';end if;
perform veh_ingest(unit,at+make_interval(mins=>2*n+8),40.001,20,20,'moving');
if active_trip_for_vehicle(v) is not null then raise exception 'prior capture resumed';end if;
if not exists(select 1 from unassigned_tracks where vehicle_id=v and state='recording')then raise exception 'new departure lost';end if;
perform trip_finish(t);
end $qa$;
rollback;
