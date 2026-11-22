create table public.trip_gps_no_work(
 trip_id uuid primary key references public.trips(id) on delete cascade,
 trip_revision integer not null,
 reason text not null,
 actor_id uuid not null references public.profiles(id),
 recorded_at timestamptz not null default now()
);
alter table public.trip_gps_no_work enable row level security;
revoke all on public.trip_gps_no_work from public,anon,authenticated;
grant select on public.trip_gps_no_work to authenticated;
create policy trip_gps_no_work_read on public.trip_gps_no_work for select to authenticated
 using(exists(select 1 from public.trips t where t.id=trip_id and t.deleted_at is null and t.workbench_revision=trip_revision));

create function dlight_private.trip_gps_no_work_save(p_trip uuid,p_expected integer,p_reason text,p_confirmed boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare trip public.trips; next_revision integer; reason text:=btrim(coalesce(p_reason,''));
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then
  raise exception 'Изменяет только куратор выезда';
 end if;
 select * into trip from public.trips where id=p_trip and deleted_at is null for update;
 if not found or trip.status not in ('finished','done') then raise exception 'Выезд ещё не завершён'; end if;
 if trip.workbench_revision is distinct from p_expected then
  raise exception 'Выезд изменился. Обновите журнал.' using errcode='40001';
 end if;
 if length(reason) not between 3 and 1000 or p_confirmed is null then raise exception 'Укажите основание решения'; end if;
 if p_confirmed and (
    exists(select 1 from public.trip_stays where trip_id=p_trip and status='approved')
    or exists(select 1 from dlight_private.order_trip_result_versions where trip_id=p_trip and state in ('submitted','accepted'))
 ) then
  raise exception 'В выезде есть подтверждённое посещение или отчёт о работах';
 end if;
 next_revision:=public.trip_presence_save(p_trip,p_expected,'[]',
  (case when p_confirmed then 'Работы не выполнялись · ' else 'Отменена отметка об отсутствии работ · ' end)||reason);
 if p_confirmed then
  insert into public.trip_gps_no_work(trip_id,trip_revision,reason,actor_id)
   values(p_trip,next_revision,reason,auth.uid())
   on conflict(trip_id) do update set trip_revision=excluded.trip_revision,reason=excluded.reason,
    actor_id=excluded.actor_id,recorded_at=now();
 else
  delete from public.trip_gps_no_work where trip_id=p_trip;
 end if;
 return next_revision;
end $$;

create function public.trip_gps_no_work_save(p_trip uuid,p_expected integer,p_reason text,p_confirmed boolean)
returns integer language sql security invoker set search_path='' as $$
 select dlight_private.trip_gps_no_work_save(p_trip,p_expected,p_reason,p_confirmed)
$$;
revoke all on function dlight_private.trip_gps_no_work_save(uuid,integer,text,boolean),
 public.trip_gps_no_work_save(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function dlight_private.trip_gps_no_work_save(uuid,integer,text,boolean),
 public.trip_gps_no_work_save(uuid,integer,text,boolean) to authenticated;

create function dlight_private.trip_gps_no_work_current(p_trip uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.trip_gps_no_work n join public.trips t on t.id=n.trip_id
  where n.trip_id=p_trip and t.deleted_at is null and t.workbench_revision=n.trip_revision)
$$;
revoke all on function dlight_private.trip_gps_no_work_current(uuid) from public,anon,authenticated;

create function dlight_private.order_trip_result_check_no_work() returns trigger
language plpgsql set search_path='' as $$
begin
 if dlight_private.trip_gps_no_work_current(new.trip_id) then
  raise exception 'В GPS-журнале подтверждено, что работы не выполнялись';
 end if;
 return new;
end $$;
revoke all on function dlight_private.order_trip_result_check_no_work() from public,anon,authenticated;
create trigger order_trip_result_check_no_work
 before insert on dlight_private.order_trip_result_versions for each row
 when(new.state in ('submitted','accepted')) execute function dlight_private.order_trip_result_check_no_work();

create or replace function dlight_private.order_trip_presence(p_trip uuid,p_job uuid,p_order uuid)
returns jsonb language sql stable set search_path='' as $$
  with presence as (
    select count(*) filter (where s.status='approved' and s.minutes_mgr is not null
        and s.crew_source in ('snapshot','manager') and cardinality(s.crew_ids)>0)>0
      and count(*) filter (where s.status not in ('approved','rejected'))=0 as confirmed,
      round(coalesce(sum(s.minutes_mgr*cardinality(s.crew_ids)/60.0) filter (
        where s.status='approved' and s.crew_source in ('snapshot','manager')),0),2) as hours
    from public.trip_stays s where s.trip_id=p_trip and s.job_id=p_job and s.stay_to is not null
  ), allocated as (
    select coalesce(sum(current_version.presence_used),0) as hours from (
      select distinct on (v.order_id) v.presence_used
      from dlight_private.order_trip_result_versions v join public.service_orders o on o.id=v.order_id
      where v.trip_id=p_trip and v.order_id<>p_order and o.job_id=p_job and v.state='accepted'
      order by v.order_id,v.sequence desc
    ) current_version
  )
  select jsonb_build_object('confirmed',presence.confirmed,'no_work',dlight_private.trip_gps_no_work_current(p_trip),'base',presence.hours,
    'used',allocated.hours,'available',greatest(0,presence.hours-allocated.hours))
  from presence cross join allocated
$$;
notify pgrst,'reload schema';
