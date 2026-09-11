-- Multiple engineers may participate in a job or trip.  The legacy scalar
-- columns remain the primary/responsible engineer for old clients, scheduling
-- and existing RPCs; arrays are the complete assignment.
alter table public.jobs add column if not exists engineer_ids uuid[] not null default '{}';
alter table public.trips add column if not exists engineer_ids uuid[] not null default '{}';

update public.jobs set engineer_ids=array[assigned_engineer]
 where assigned_engineer is not null and cardinality(engineer_ids)=0;
update public.trips set engineer_ids=array[lead_engineer]
 where lead_engineer is not null and cardinality(engineer_ids)=0;

create index if not exists jobs_engineer_ids_gin on public.jobs using gin(engineer_ids);
create index if not exists trips_engineer_ids_gin on public.trips using gin(engineer_ids);

create or replace function public.sync_engineer_assignments()
returns trigger language plpgsql set search_path=public as $$
begin
  new.engineer_ids := coalesce((select array_agg(distinct x) from unnest(coalesce(new.engineer_ids,'{}'::uuid[])) x where x is not null),'{}'::uuid[]);
  if tg_table_name='jobs' then
    if new.assigned_engineer is not null and not(new.assigned_engineer=any(new.engineer_ids)) then new.engineer_ids=array_prepend(new.assigned_engineer,new.engineer_ids); end if;
    new.assigned_engineer=case when cardinality(new.engineer_ids)>0 then new.engineer_ids[1] else null end;
  else
    if new.lead_engineer is not null and not(new.lead_engineer=any(new.engineer_ids)) then new.engineer_ids=array_prepend(new.lead_engineer,new.engineer_ids); end if;
    new.lead_engineer=case when cardinality(new.engineer_ids)>0 then new.engineer_ids[1] else null end;
  end if;
  return new;
end $$;

drop trigger if exists jobs_sync_engineers on public.jobs;
create trigger jobs_sync_engineers before insert or update of assigned_engineer,engineer_ids on public.jobs
for each row execute function public.sync_engineer_assignments();
drop trigger if exists trips_sync_engineers on public.trips;
create trigger trips_sync_engineers before insert or update of lead_engineer,engineer_ids on public.trips
for each row execute function public.sync_engineer_assignments();

-- Match the existing ability of an assigned engineer to maintain their job.
-- Manager/admin policies remain unchanged and are OR-ed with this policy.
drop policy if exists jobs_update_assigned_team on public.jobs;
create policy jobs_update_assigned_team on public.jobs for update to authenticated
using (auth.uid()=any(engineer_ids))
with check (auth.uid()=any(engineer_ids));

drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select using (
  user_role()=any(array['admin'::text,'logist'::text])
  or lead_engineer=auth.uid() or auth.uid()=any(engineer_ids)
);

create or replace function public.trip_start(p_trip uuid) returns text
language plpgsql security definer set search_path=public as $$
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
end $$;

create or replace function public.trip_finish(p_trip uuid) returns text
language plpgsql security definer set search_path=public as $$
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
end $$;
