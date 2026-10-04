-- QA only. Real authenticated RLS/RPC checks; all fixtures rolled back.
begin;
do $$
declare manager_uid uuid; curator_uid uuid; foreign_uid uuid;
  vehicle_uid uuid; source_uid uuid; target_uid uuid; other_uid uuid;
begin
  select id into manager_uid from public.profiles where role='logist' and active limit 1;
  select id into curator_uid from public.profiles where role='engineer' and active order by id limit 1;
  select id into foreign_uid from public.profiles where role='engineer' and active and id<>curator_uid limit 1;
  if manager_uid is null or curator_uid is null or foreign_uid is null then raise exception 'Missing QA profiles'; end if;
  insert into public.vehicles(name) values('QA scoped track rollback') returning id into vehicle_uid;
  perform set_config('request.jwt.claim.sub',manager_uid::text,true);
  insert into public.trips(status,vehicle_id,date_from,date_to) values('planned',vehicle_uid,current_date+2,current_date+2) returning id into source_uid;
  insert into public.trips(status,vehicle_id,date_from,date_to) values('planned',vehicle_uid,current_date+3,current_date+3) returning id into target_uid;
  insert into public.trips(status,vehicle_id,date_from,date_to) values('planned',vehicle_uid,current_date+4,current_date+4) returning id into other_uid;
  perform public.entity_responsibility_assign('trip',source_uid,'curator',curator_uid,'QA scoped source',null);
  perform public.entity_responsibility_assign('trip',target_uid,'curator',curator_uid,'QA scoped target',null);
  perform public.entity_responsibility_assign('trip',other_uid,'curator',foreign_uid,'QA foreign target',null);
  insert into public.trip_tracking_sessions(trip_id,vehicle_id,planned_start_at,capture_from)
    values(source_uid,vehicle_uid,(current_date+2)::timestamptz,(current_date+2)::timestamptz);
  perform set_config('qa.source',source_uid::text,true);
  perform set_config('qa.target',target_uid::text,true);
  perform set_config('qa.foreign',other_uid::text,true);
  perform set_config('request.jwt.claim.sub',curator_uid::text,true);
end $$;
set local role authenticated;
do $$
declare source_uid uuid:=current_setting('qa.source')::uuid;
  target_uid uuid:=current_setting('qa.target')::uuid;
  other_uid uuid:=current_setting('qa.foreign')::uuid;
  n integer; result text; denied boolean;
begin
  update public.trips set day_plan=jsonb_build_object('start',jsonb_build_object('d',(current_date+3)::text,'t',9)) where id=target_uid;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Curator cannot place own trip'; end if;
  update public.trips set day_plan='{"start":{"d":"2026-10-01","t":8}}' where id=other_uid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Curator updated foreign trip'; end if;
  denied:=false;
  begin perform public.trip_tracking_reassign(source_uid,other_uid);
  exception when others then
    if sqlerrm<>'Недостаточно прав' then raise; end if; denied:=true;
  end;
  if not denied then raise exception 'Foreign target allowed'; end if;
  denied:=false;
  begin perform public.trip_tracking_reassign(other_uid,target_uid);
  exception when others then
    if sqlerrm<>'Недостаточно прав' then raise; end if; denied:=true;
  end;
  if not denied then raise exception 'Foreign source allowed'; end if;
  denied:=false;
  begin perform public.trip_tracking_cancel(other_uid);
  exception when others then
    if sqlerrm<>'Недостаточно прав' then raise; end if; denied:=true;
  end;
  if not denied then raise exception 'Foreign cancellation allowed'; end if;
  result:=public.trip_tracking_reassign(source_uid,target_uid);
  if result<>'reassigned_future' then raise exception 'Unexpected move result %',result; end if;
  if not exists(select 1 from public.trip_tracking_sessions where trip_id=source_uid and state='reassigned')
    or not exists(select 1 from public.trip_tracking_sessions where trip_id=target_uid and state='armed') then
    raise exception 'Track session transition failed';
  end if;
  result:=public.trip_tracking_cancel(target_uid);
  if result<>'cancelled' or not exists(select 1 from public.trip_tracking_sessions where trip_id=target_uid and state='cancelled') then
    raise exception 'Curator cancellation failed';
  end if;
end $$;
reset role;
select 'QA passed: scoped plan update, denied foreign source/target/cancel, curator future reassign and cancel; rolled back' as result;
rollback;
