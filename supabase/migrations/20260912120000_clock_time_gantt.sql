-- Clock-time scheduling is deliberately separate from tariff-day economics.
alter table public.settings add column if not exists day_end numeric not null default 16;
alter table public.settings add column if not exists tolerance_h numeric not null default 1;
alter table public.settings drop constraint if exists settings_day_window_check;
alter table public.settings add constraint settings_day_window_check check(day_start>=0 and day_start<24 and day_end>day_start and day_end<=24 and tolerance_h>=0 and day_end+tolerance_h<=24);

create table if not exists public.staff_day(
  engineer uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  start_h numeric(4,2), end_h numeric(4,2), tol_h numeric(4,2),
  proposed_end_h numeric(4,2), proposed_by uuid references public.profiles(id), proposed_at timestamptz,
  primary key(engineer,date),
  check(start_h is null or start_h between 0 and 24),
  check(end_h is null or end_h between 0 and 24),
  check(tol_h is null or tol_h between 0 and 8),
  check(proposed_end_h is null or proposed_end_h between 0 and 24)
);
alter table public.staff_day enable row level security;
drop policy if exists staff_day_read on public.staff_day;
create policy staff_day_read on public.staff_day for select using(auth.uid()=engineer or public.is_staff());
drop policy if exists staff_day_manager_write on public.staff_day;
create policy staff_day_manager_write on public.staff_day for all using(public.is_money_manager()) with check(public.is_money_manager());
drop policy if exists staff_day_engineer_insert on public.staff_day;
create policy staff_day_engineer_insert on public.staff_day for insert with check(auth.uid()=engineer and proposed_by=auth.uid() and proposed_end_h is not null and start_h is null and end_h is null and tol_h is null);
drop policy if exists staff_day_engineer_update on public.staff_day;
create policy staff_day_engineer_update on public.staff_day for update using(auth.uid()=engineer) with check(auth.uid()=engineer and proposed_by=auth.uid());

create or replace function public.guard_staff_day() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.is_money_manager() then return new; end if;
  if auth.uid()<>new.engineer then raise exception 'Недостаточно прав'; end if;
  if tg_op='UPDATE' and (new.start_h is distinct from old.start_h or new.end_h is distinct from old.end_h or new.tol_h is distinct from old.tol_h) then raise exception 'Инженер может предложить только новый конец дня'; end if;
  if new.proposed_by is distinct from auth.uid() or new.proposed_end_h is null then raise exception 'Некорректное предложение'; end if;
  new.proposed_at=coalesce(new.proposed_at,now()); return new;
end $$;
drop trigger if exists staff_day_guard on public.staff_day;
create trigger staff_day_guard before insert or update on public.staff_day for each row execute function public.guard_staff_day();

grant select,insert,update on public.staff_day to authenticated;

-- Discard the superseded per-segment/chunk format and convert start to wall-clock time.
update public.trips t set day_plan=jsonb_strip_nulls(jsonb_build_object(
  'start',jsonb_build_object('d',t.day_plan#>>'{start,d}','t',coalesce((t.day_plan#>>'{start,t}')::numeric,(select day_start from public.settings where id=true)+(t.day_plan#>>'{start,h}')::numeric)),
  'cuts',coalesce(t.day_plan->'cuts','[]'::jsonb)))
where t.day_plan is not null and t.day_plan ? 'start';
update public.jobs j set day_plan=jsonb_strip_nulls(jsonb_build_object(
  'start',jsonb_build_object('d',j.day_plan#>>'{start,d}','t',coalesce((j.day_plan#>>'{start,t}')::numeric,(select day_start from public.settings where id=true)+(j.day_plan#>>'{start,h}')::numeric)),
  'cuts',coalesce(j.day_plan->'cuts','[]'::jsonb)))
where j.day_plan is not null and j.day_plan ? 'start';

create or replace function public.trip_planned_start_at(t public.trips) returns timestamptz language sql stable as $$
  select (coalesce(nullif(t.day_plan#>>'{start,d}','')::date,t.date_from)::timestamp
    + make_interval(hours=>coalesce(nullif(t.day_plan#>>'{start,t}','')::numeric,(select day_start from public.settings where id=true),7)::int,
                    mins=>round(mod(coalesce(nullif(t.day_plan#>>'{start,t}','')::numeric,(select day_start from public.settings where id=true),7),1)*60)::int)) at time zone 'Europe/Kyiv'
$$;

create or replace view public.settings_public as
select id,currency,default_theme,avoid_zones,ors_proxy,stay_radius_m,stay_min_minutes,
       repair_warranty_days,shift_hours,deviation_pct,day_start,day_end,tolerance_h
from public.settings where id=true;
grant select on public.settings_public to anon,authenticated;
