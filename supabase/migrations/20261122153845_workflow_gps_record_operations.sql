create function dlight_private.gps_record_create_trip(
 p_track uuid, p_expected integer, p_points integer, p_operation uuid,
 p_plan jsonb, p_order_ids uuid[], p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare source public.unassigned_tracks; new_trip uuid;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'Создаёт выезд только диспетчер';
 end if;
 if p_operation is null then raise exception 'Отсутствует идентификатор операции'; end if;
 select * into source from public.unassigned_tracks where id=p_track for update;
 if not found then raise exception 'GPS-запись не найдена'; end if;
 if source.state='linked' and source.resolution->>'workflow_operation'=p_operation::text
    and source.resolved_by=auth.uid() then
  return source.trip_id;
 end if;
 if source.revision is distinct from p_expected or source.state not in ('review','recording') then
  raise exception 'GPS-запись изменилась. Обновите журнал.' using errcode='40001';
 end if;
 if source.state='recording' and source.last_ts>now()-interval '5 minutes' then
  raise exception 'GPS-запись ещё продолжается';
 end if;
 if (p_plan->>'vehicle_id')::uuid is distinct from source.vehicle_id
    or p_plan->>'status' is distinct from 'planned' then
  raise exception 'Нужен плановый выезд той же машины';
 end if;
 if coalesce(cardinality(p_order_ids),0)=0 then raise exception 'Выберите хотя бы одно существующее задание'; end if;
 new_trip:=public.trip_plan_save_tasks(null,0,p_plan,p_order_ids,p_reason,null);
 -- The resolver checks the source revision and point count and imports only an empty trip.
 perform public.unassigned_track_resolve(p_track,p_expected,'link',
   jsonb_build_object('trip',new_trip,'points',p_points,'reason',p_reason));
 update public.unassigned_tracks set resolution=resolution||jsonb_build_object('workflow_operation',p_operation)
  where id=p_track and trip_id=new_trip;
 if not found then raise exception 'Не удалось связать GPS-запись'; end if;
 return new_trip;
end $$;

create function public.gps_record_create_trip(
 p_track uuid, p_expected integer, p_points integer, p_operation uuid,
 p_plan jsonb, p_order_ids uuid[], p_reason text
) returns uuid language sql security invoker set search_path='' as $$
 select dlight_private.gps_record_create_trip(p_track,p_expected,p_points,p_operation,p_plan,p_order_ids,p_reason)
$$;
revoke all on function public.gps_record_create_trip(uuid,integer,integer,uuid,jsonb,uuid[],text),
 dlight_private.gps_record_create_trip(uuid,integer,integer,uuid,jsonb,uuid[],text) from public,anon,authenticated;
grant execute on function public.gps_record_create_trip(uuid,integer,integer,uuid,jsonb,uuid[],text),
 dlight_private.gps_record_create_trip(uuid,integer,integer,uuid,jsonb,uuid[],text) to authenticated;

create table public.gps_record_comments(
 id uuid primary key default gen_random_uuid(),
 track_id uuid references public.unassigned_tracks(id) on delete cascade,
 trip_id uuid references public.trips(id) on delete cascade,
 author_id uuid not null references public.profiles(id),
 body text not null check(length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 check(track_id is not null or trip_id is not null)
);
create index gps_record_comments_track_idx on public.gps_record_comments(track_id,created_at desc) where track_id is not null;
create index gps_record_comments_trip_idx on public.gps_record_comments(trip_id,created_at desc) where trip_id is not null;
alter table public.gps_record_comments enable row level security;
revoke all on public.gps_record_comments from public,anon,authenticated;
grant select on public.gps_record_comments to authenticated;
grant insert (track_id,trip_id,author_id,body) on public.gps_record_comments to authenticated;
create policy gps_record_comments_read on public.gps_record_comments for select to authenticated
 using(exists(select 1 from public.trips t where t.id=trip_id and t.deleted_at is null)
    or exists(select 1 from public.unassigned_tracks s where s.id=track_id));
create policy gps_record_comments_add on public.gps_record_comments for insert to authenticated
 with check(author_id=(select auth.uid()) and (
   track_id is null and exists(select 1 from public.trips t where t.id=trip_id and t.deleted_at is null)
   or trip_id is null and (select public.user_role()) in ('admin','logist')
     and exists(select 1 from public.unassigned_tracks s where s.id=track_id and s.trip_id is null)
 ));

create function dlight_private.gps_record_comments_follow_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.gps_record_comments set trip_id=new.trip_id where track_id=new.id;
 return new;
end $$;
revoke all on function dlight_private.gps_record_comments_follow_link() from public,anon,authenticated;
create trigger gps_record_comments_follow_link after update of trip_id on public.unassigned_tracks
 for each row when (old.trip_id is distinct from new.trip_id)
 execute function dlight_private.gps_record_comments_follow_link();

alter table public.trip_stays add column manual_origin boolean not null default false;

create function dlight_private.gps_record_manual_visit(
 p_trip uuid, p_expected integer, p_operation uuid, p_job uuid,
 p_from timestamp, p_to timestamp, p_crew uuid[], p_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare trip public.trips; starts timestamptz:=p_from at time zone 'Europe/Kyiv';
 finishes timestamptz:=p_to at time zone 'Europe/Kyiv';
 reason text:=btrim(coalesce(p_reason,'')); minutes numeric;
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then
  raise exception 'Посещение добавляет только куратор выезда';
 end if;
 select * into trip from public.trips where id=p_trip and deleted_at is null for update;
 if not found then raise exception 'Выезд не найден'; end if;
 if exists(select 1 from public.trip_stays where id=p_operation and trip_id=p_trip and manual_origin and mgr_by=auth.uid()) then
  return trip.workbench_revision;
 end if;
 if trip.workbench_revision is distinct from p_expected then
  raise exception 'Выезд изменился. Обновите журнал.' using errcode='40001';
 end if;
 if trip.status not in ('in_progress','finished','done') then raise exception 'Выезд ещё не начат или отменён'; end if;
 if p_operation is null or length(reason) not between 3 and 1000 then raise exception 'Укажите основание ручного учёта'; end if;
 if starts is null or finishes is null or not isfinite(starts) or not isfinite(finishes)
    or starts>=finishes or finishes>now()
    or coalesce(trip.started_at,trip.date_from::timestamp at time zone 'Europe/Kyiv') is null
    or starts<coalesce(trip.started_at,trip.date_from::timestamp at time zone 'Europe/Kyiv')
    or finishes>coalesce(trip.finished_at,(trip.date_to+1)::timestamp at time zone 'Europe/Kyiv',now()) then
  raise exception 'Укажите прошедший интервал внутри выезда';
 end if;
 if not exists(select 1 from public.trip_jobs where trip_id=p_trip and job_id=p_job) then
  raise exception 'Заявка не относится к выезду';
 end if;
 if coalesce(cardinality(p_crew),0)=0 or exists(select 1 from unnest(p_crew) crew
    where not exists(select 1 from public.profiles where id=crew and role='engineer')) then
  raise exception 'Укажите присутствовавших инженеров';
 end if;
 if exists(select 1 from public.trip_tracks t cross join lateral
   jsonb_array_elements(coalesce(t.data#>'{presence,motion_intervals}','[]')) motion
   where t.trip_id=p_trip and starts<(motion->>'to')::timestamptz and finishes>(motion->>'from')::timestamptz)
 then raise exception 'Посещение пересекается с движением по GPS'; end if;
 minutes:=extract(epoch from finishes-starts)/60;
 insert into public.trip_stays(id,trip_id,job_id,vehicle_id,stay_from,stay_to,crew_ids,crew_source,manual_origin)
 values(p_operation,p_trip,p_job,trip.vehicle_id,starts,finishes,p_crew,'manager',true);
 return public.trip_presence_save(p_trip,
   (select workbench_revision from public.trips where id=p_trip),
   jsonb_build_array(jsonb_build_object('id',p_operation,'job_id',p_job,'crew_ids',p_crew,'minutes_mgr',minutes,'status','approved')),
   'Ручное посещение без GPS · '||reason);
end $$;

create function public.gps_record_manual_visit(
 p_trip uuid, p_expected integer, p_operation uuid, p_job uuid,
 p_from timestamp, p_to timestamp, p_crew uuid[], p_reason text
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.gps_record_manual_visit(p_trip,p_expected,p_operation,p_job,p_from,p_to,p_crew,p_reason)
$$;
revoke all on function public.gps_record_manual_visit(uuid,integer,uuid,uuid,timestamp,timestamp,uuid[],text),
 dlight_private.gps_record_manual_visit(uuid,integer,uuid,uuid,timestamp,timestamp,uuid[],text) from public,anon,authenticated;
grant execute on function public.gps_record_manual_visit(uuid,integer,uuid,uuid,timestamp,timestamp,uuid[],text),
 dlight_private.gps_record_manual_visit(uuid,integer,uuid,uuid,timestamp,timestamp,uuid[],text) to authenticated;
notify pgrst,'reload schema';
