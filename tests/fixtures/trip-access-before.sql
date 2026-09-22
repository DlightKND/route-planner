-- Inspected legacy functions, used only to reproduce the access regressions.
CREATE OR REPLACE FUNCTION public.is_owner_or_mgr(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- coalesce снаружи обязателен: без него при p_owner IS NULL результат
  -- NULL, а `IF NOT NULL THEN` ветку не выполняет — та же ловушка,
  -- только на другом операторе.
  select coalesce(
    auth.uid() is not null
    and ( p_owner = auth.uid()
          or coalesce(public.user_role(),'') in ('admin','logist') )
  , false);
$function$;

CREATE OR REPLACE FUNCTION public.restore_deleted(p_ts timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для восстановления';
  end if;
  update clients   set deleted_at = null where deleted_at = p_ts;
  update equipment set deleted_at = null where deleted_at = p_ts;
  update jobs      set deleted_at = null where deleted_at = p_ts;
  update trips     set deleted_at = null where deleted_at = p_ts;
end; $function$;

CREATE OR REPLACE FUNCTION public.soft_delete_client(p_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ts timestamptz := clock_timestamp();
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для удаления';
  end if;
  update clients   set deleted_at = ts where id = p_id       and deleted_at is null;
  update equipment set deleted_at = ts where client_id = p_id and deleted_at is null;
  update jobs      set deleted_at = ts where client_id = p_id and deleted_at is null;
  return ts;
end; $function$;

CREATE OR REPLACE FUNCTION public.trash_delete_forever(p_kind text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для окончательного удаления';
  end if;
  if p_kind = 'jobs' then
    delete from public.jobs where id = p_id and deleted_at is not null;
  elsif p_kind = 'trips' then
    -- Исторические точки принадлежат выезду, хотя FK раньше только отвязывал
    -- их. При окончательном удалении корзина не оставляет анонимный трек.
    delete from public.vehicle_positions where trip_id = p_id;
    update public.vehicle_state set trip_id = null where trip_id = p_id;
    delete from public.trips where id = p_id and deleted_at is not null;
  else
    raise exception 'Неизвестный раздел корзины: %', p_kind;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trash_restore(p_kind text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для восстановления';
  end if;
  if p_kind = 'jobs' then
    update public.jobs set deleted_at = null where id = p_id and deleted_at is not null;
  elsif p_kind = 'trips' then
    update public.trips set deleted_at = null where id = p_id and deleted_at is not null;
  else
    raise exception 'Неизвестный раздел корзины: %', p_kind;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trip_finish(p_trip uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t trips;
begin
  select * into t from trips where id=p_trip and deleted_at is null;
  if not found then return 'not_found'; end if;
  if not (public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids)) then raise exception 'Это не ваш выезд'; end if;
  if t.status<>'in_progress' then return 'wrong_status'; end if;
  begin perform 1 from trips where id=p_trip for update nowait;
  exception when lock_not_available then return 'busy'; end;
  perform set_config('dlight.via_rpc','1',true);
  update trips set status='finished',finished_at=now(),fact_km=public.trip_fact_km(p_trip) where id=p_trip;
  perform public.trip_detect_stays(p_trip);
  return 'finished';
end $function$;

CREATE OR REPLACE FUNCTION public.trip_start(p_trip uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t trips;
begin
  select * into t from trips where id=p_trip and deleted_at is null;
  if not found then return 'not_found'; end if;
  if not (public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids)) then raise exception 'Это не ваш выезд'; end if;
  if t.status not in ('planned','assigned') then return 'wrong_status'; end if;
  perform set_config('dlight.via_rpc','1',true);
  update trips set status='in_progress',started_at=coalesce(started_at,now()) where id=p_trip;
  update trip_reschedules set status='cancelled',dec_at=now() where trip_id=p_trip and status='pending';
  return 'started';
end $function$;

CREATE OR REPLACE FUNCTION public.trip_tracking_cancel(p_trip uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s trip_tracking_sessions;
begin
  if public.user_role() not in ('admin','logist') then raise exception 'Недостаточно прав'; end if;
  select * into s from trip_tracking_sessions where trip_id=p_trip for update;
  if not found then return 'not_found'; end if;
  update vehicle_positions set trip_id=null where trip_id=p_trip and ts>=s.capture_from;
  update trip_tracking_sessions set state='cancelled',updated_at=now() where id=s.id;
  perform set_config('dlight.via_rpc','1',true);
  update trips set status='assigned',started_at=null where id=p_trip and status='in_progress';
  update vehicle_state set trip_id=null where vehicle_id=s.vehicle_id and trip_id=p_trip;
  return 'cancelled';
end $function$;

CREATE OR REPLACE FUNCTION public.trip_tracking_reassign(p_from uuid, p_to uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s trip_tracking_sessions; target trips; cutoff timestamptz; target_session uuid;
begin
  if public.user_role() not in ('admin','logist') then raise exception 'Недостаточно прав'; end if;
  if p_from=p_to then raise exception 'Выбери другой выезд'; end if;
  select * into s from trip_tracking_sessions where trip_id=p_from for update;
  select * into target from trips where id=p_to and deleted_at is null for update;
  if s.id is null or target.id is null then return 'not_found'; end if;
  if target.vehicle_id is distinct from s.vehicle_id then raise exception 'У выездов разные машины'; end if;
  if target.status not in ('planned','assigned') then raise exception 'Целевой выезд уже начат или закрыт'; end if;
  cutoff:=public.trip_planned_start_at(target);
  if cutoff is null then raise exception 'У целевого выезда нет времени старта'; end if;

  update vehicle_positions set trip_id=null where trip_id=p_from and ts>=s.capture_from;
  update trip_tracking_sessions set state='reassigned',updated_at=now() where id=s.id;
  insert into trip_tracking_sessions(trip_id,vehicle_id,depot_id,state,planned_start_at,capture_from,actual_started_at,start_source)
  values(target.id,s.vehicle_id,s.depot_id,case when cutoff<=now() then 'active' else 'armed' end,cutoff,cutoff,
    case when cutoff<=now() then cutoff end,case when cutoff<=now() then 'manual' end)
  on conflict(trip_id) do update set state=excluded.state,capture_from=cutoff,actual_started_at=excluded.actual_started_at,
    start_source=excluded.start_source,updated_at=now() returning id into target_session;
  insert into trip_tracking_points(session_id,vehicle_id,ts,lat,lng,speed,status)
    select target_session,p.vehicle_id,p.ts,p.lat,p.lng,p.speed,p.status from trip_tracking_points p
    where p.session_id=s.id and p.ts>=cutoff on conflict do nothing;
  if cutoff<=now() then
    insert into vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status,moving,mileage)
      select p.vehicle_id,target.id,p.ts,p.lat,p.lng,p.speed,p.status,(p.status='moving'),null
      from trip_tracking_points p where p.session_id=target_session and p.ts>=cutoff on conflict(vehicle_id,ts) do update set trip_id=excluded.trip_id;
  end if;
  perform set_config('dlight.via_rpc','1',true);
  update trips set status='assigned',started_at=null where id=p_from and status='in_progress';
  if cutoff<=now() then update trips set status='in_progress',started_at=cutoff where id=p_to; end if;
  return case when cutoff<=now() then 'reassigned_started' else 'reassigned_future' end;
end $function$;

CREATE OR REPLACE FUNCTION public.vehicle_odometer_set(p_vehicle uuid, p_value numeric, p_note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare old_value numeric;
begin
  if public.user_role() not in ('admin','logist') then raise exception 'Недостаточно прав'; end if;
  if p_value is null or p_value < 0 then raise exception 'Некорректный пробег'; end if;
  select odometer into old_value from vehicles where id=p_vehicle for update;
  if not found then raise exception 'Машина не найдена'; end if;
  update vehicles set odometer=round(p_value,1) where id=p_vehicle;
  insert into vehicle_odometer_log(vehicle_id,value_km,previous_km,note,created_by)
  values(p_vehicle,round(p_value,1),old_value,nullif(trim(p_note),''),auth.uid());
  return round(p_value,1);
end $function$;
