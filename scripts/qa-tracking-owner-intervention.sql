-- QA only: active source, elapsed target, synthetic GPS and rollback.
begin;
do $$
declare manager_uid uuid; owner_uid uuid; curator_uid uuid;
  vehicle_uid uuid; source_uid uuid; target_uid uuid; session_uid uuid; cutoff timestamptz;
begin
  select id into manager_uid from public.profiles where role='logist' and active limit 1;
  select id into owner_uid from public.profiles where role='engineer' and active order by id limit 1;
  select id into curator_uid from public.profiles where role='engineer' and active and id<>owner_uid limit 1;
  if manager_uid is null or owner_uid is null or curator_uid is null then raise exception 'Missing QA profiles'; end if;
  insert into public.vehicles(name) values('QA owner track rollback') returning id into vehicle_uid;
  perform set_config('request.jwt.claim.sub',manager_uid::text,true);
  insert into public.trips(status,vehicle_id,date_from,date_to,started_at)
    values('in_progress',vehicle_uid,current_date-2,current_date-2,(current_date-2)::timestamptz) returning id into source_uid;
  insert into public.trips(status,vehicle_id,date_from,date_to)
    values('planned',vehicle_uid,current_date-1,current_date-1) returning id into target_uid;
  perform public.entity_responsibility_assign('trip',source_uid,'curator',curator_uid,'QA active source delegation',null);
  perform public.entity_responsibility_assign('trip',target_uid,'curator',curator_uid,'QA elapsed target delegation',null);
  perform public.entity_responsibility_assign('trip',source_uid,'owner',owner_uid,'QA engineer owner',null);
  perform public.entity_responsibility_assign('trip',target_uid,'owner',owner_uid,'QA engineer owner',null);
  insert into public.trip_tracking_sessions(trip_id,vehicle_id,state,planned_start_at,capture_from,actual_started_at)
    values(source_uid,vehicle_uid,'active',(current_date-2)::timestamptz,(current_date-2)::timestamptz,(current_date-2)::timestamptz)
    on conflict(trip_id) do update set state='active' returning id into session_uid;
  select public.trip_planned_start_at(t) into cutoff from public.trips t where id=target_uid;
  insert into public.trip_tracking_points(session_id,vehicle_id,ts,lat,lng,speed,status)
    values(session_uid,vehicle_uid,cutoff-interval '1 hour',50,30,20,'moving'),
      (session_uid,vehicle_uid,cutoff+interval '1 hour',50.1,30.1,20,'moving');
  insert into public.vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status,moving)
    values(vehicle_uid,source_uid,cutoff-interval '1 hour',50,30,20,'moving',true),
      (vehicle_uid,source_uid,cutoff+interval '1 hour',50.1,30.1,20,'moving',true);
  perform set_config('qa.source',source_uid::text,true);
  perform set_config('qa.target',target_uid::text,true);
  perform set_config('qa.curator',curator_uid::text,true);
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
end $$;
set local role authenticated;
do $$
declare source_uid uuid:=current_setting('qa.source')::uuid;
  target_uid uuid:=current_setting('qa.target')::uuid;
  rejected boolean; n integer; result text;
begin
  if public.user_role()<>'engineer' then raise exception 'Expected ordinary engineer owner'; end if;
  rejected:=false;
  begin perform public.trip_tracking_reassign(source_uid,target_uid);
  exception when others then
    if sqlerrm<>'Владелец указывает причину вмешательства' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'Legacy RPC bypassed owner reason'; end if;
  rejected:=false;
  begin perform public.trip_tracking_reassign_with_reason(source_uid,target_uid,null);
  exception when others then
    if sqlerrm<>'Укажи причину вмешательства (5–1000 символов)' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'Missing reason allowed'; end if;
  select count(*) into n from public.entity_status_interventions where entity_id in(source_uid,target_uid);
  if n<>0 then raise exception 'Failed actions left audit'; end if;
  if not exists(select 1 from public.trips where id=source_uid and status='in_progress')
    or not exists(select 1 from public.trips where id=target_uid and status='planned') then raise exception 'Failed action changed status'; end if;
  result:=public.trip_tracking_reassign_with_reason(source_uid,target_uid,'Перенос по решению владельца');
  if result<>'reassigned_started' then raise exception 'Unexpected result %',result; end if;
  select count(*) into n from public.entity_status_interventions
    where entity_id in(source_uid,target_uid) and actor_id=auth.uid() and reason='Перенос по решению владельца';
  if n<>2 then raise exception 'Expected two owner interventions, got %',n; end if;
  rejected:=false;
  begin perform public.trip_tracking_cancel_with_reason(target_uid,'bad');
  exception when others then
    if sqlerrm<>'Укажи причину вмешательства (5–1000 символов)' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'Short cancel reason allowed'; end if;
end $$;
reset role;
do $$
declare source_uid uuid:=current_setting('qa.source')::uuid;
  target_uid uuid:=current_setting('qa.target')::uuid;
  curator_uid uuid:=current_setting('qa.curator')::uuid; n integer;
begin
  if not exists(select 1 from public.trip_tracking_sessions where trip_id=source_uid and state='reassigned')
    or not exists(select 1 from public.trip_tracking_sessions where trip_id=target_uid and state='active') then raise exception 'Session states wrong'; end if;
  select count(*) into n from public.trip_tracking_points p join public.trip_tracking_sessions s on s.id=p.session_id where s.trip_id=target_uid;
  if n<>1 then raise exception 'GPS cutoff did not keep exactly one point'; end if;
  select count(*) into n from public.vehicle_positions where trip_id=target_uid;
  if n<>1 then raise exception 'Target GPS history wrong'; end if;
  select count(*) into n from public.vehicle_positions where trip_id=source_uid;
  if n<>0 then raise exception 'Source GPS linkage retained'; end if;
  select count(*) into n from public.entity_push_events where entity_id in(source_uid,target_uid)
    and recipient_id=curator_uid and title='Владелец изменил стадию';
  if n<>2 then raise exception 'Expected two curator notices, got %',n; end if;
end $$;
set local role authenticated;do $$
begin
  if public.trip_tracking_cancel_with_reason(current_setting('qa.target')::uuid,'Отмена активного трека владельцем')<>'cancelled' then raise exception 'Cancel failed'; end if;
end $$;
reset role;
do $$
declare target_uid uuid:=current_setting('qa.target')::uuid;
begin
  if not exists(select 1 from public.trips where id=target_uid and status='assigned' and started_at is null)
    or not exists(select 1 from public.trip_tracking_sessions where trip_id=target_uid and state='cancelled') then raise exception 'Cancel transition failed'; end if;
  if (select count(*) from public.entity_status_interventions where entity_id=target_uid)<>2 then raise exception 'Cancel audit missing'; end if;
  if has_function_privilege('anon','public.trip_tracking_reassign_with_reason(uuid,uuid,text)','execute')
    or has_function_privilege('anon','public.trip_tracking_cancel_with_reason(uuid,text)','execute') then raise exception 'Anonymous RPC execution'; end if;
end $$;
select 'QA passed: ordinary owner, denied absent/short reason, legacy guard, two audited transitions and curator notices, GPS cutoff, active cancel; rolled back' as result;
rollback;
