-- Approved presence and confirmed transport costs flow to canonical tasks.
-- Existing trip/request fields remain as compatibility projections.
begin;

create table public.trip_stay_task_allocations (
  stay_id uuid not null references public.trip_stays(id) on delete cascade,
  service_order_id uuid not null references public.service_orders(id) on delete restrict,
  share numeric(9,6) not null check(share>0 and share<=1),
  source text not null default 'manager' check(source in ('historical','automatic','manager')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key(stay_id,service_order_id)
);
alter table public.trip_stays add column task_allocations_explicit boolean not null default false;
create index trip_stay_task_allocations_order_idx on public.trip_stay_task_allocations(service_order_id,stay_id);
alter table public.trip_stay_task_allocations enable row level security;
revoke all on public.trip_stay_task_allocations from public,anon,authenticated;
grant select on public.trip_stay_task_allocations to authenticated;
create policy trip_stay_task_allocations_read on public.trip_stay_task_allocations for select to authenticated
using (
  dlight_private.order_access(service_order_id)
  or exists(select 1 from public.trip_stays s join public.trips t on t.id=s.trip_id
    where s.id=stay_id and coalesce(public.user_role() in ('admin','logist')
      or auth.uid()=t.lead_engineer or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])),false))
);

insert into public.trip_stay_task_allocations(stay_id,service_order_id,share,source)
select s.id,s.service_order_id,1,'historical'
from public.trip_stays s
join public.trip_service_orders tso on tso.trip_id=s.trip_id and tso.order_id=s.service_order_id
where s.service_order_id is not null
on conflict(stay_id,service_order_id) do nothing;
update public.trip_stays set task_allocations_explicit=true where exists(
  select 1 from public.trip_stay_task_allocations a where a.stay_id=trip_stays.id
);

-- A stay changed to another request must not retain its prior task link.
create or replace function dlight_private.trip_stay_task_link() returns trigger
language plpgsql set search_path='' as $$
declare matches uuid[];
begin
  if tg_op='UPDATE' and (new.trip_id is distinct from old.trip_id or new.job_id is distinct from old.job_id
       or new.service_order_id is distinct from old.service_order_id) then
    new.task_allocations_explicit:=false;
  end if;
  if tg_op='UPDATE' and new.job_id is distinct from old.job_id
     and new.service_order_id is not distinct from old.service_order_id then
    new.service_order_id:=null;
  end if;
  if new.service_order_id is null and new.job_id is not null then
    select array_agg(o.id order by o.id) into matches
    from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=new.trip_id and o.job_id=new.job_id;
    if cardinality(matches)=1 then new.service_order_id:=matches[1]; end if;
  elsif new.service_order_id is not null and not exists(
    select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=new.trip_id and tso.order_id=new.service_order_id and o.job_id=new.job_id
  ) then raise exception 'Задание стоянки должно быть связано с заявкой и выездом';
  end if;
  return new;
end $$;

create function dlight_private.trip_stay_task_allocations_guard() returns trigger
language plpgsql set search_path='' as $$
declare s public.trip_stays; t uuid; j uuid;
begin
  select * into s from public.trip_stays where id=new.stay_id;
  if not found then raise exception 'Стоянка не найдена'; end if;
  select job_id into j from public.service_orders where id=new.service_order_id;
  if j is null or j is distinct from s.job_id or not exists(
    select 1 from public.trip_service_orders where trip_id=s.trip_id and order_id=new.service_order_id
  ) then raise exception 'Задание распределения должно относиться к заявке и выезду стоянки'; end if;
  return new;
end $$;
revoke all on function dlight_private.trip_stay_task_allocations_guard() from public,anon,authenticated;
create trigger trip_stay_task_allocations_guard before insert or update on public.trip_stay_task_allocations
for each row execute function dlight_private.trip_stay_task_allocations_guard();

create function dlight_private.trip_stay_task_allocation_touch() returns trigger
language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
  select trip_id into tid from public.trip_stays where id=coalesce(new.stay_id,old.stay_id);
  update public.trips set workbench_revision=workbench_revision+1 where id=tid;
  return coalesce(new,old);
end $$;
revoke all on function dlight_private.trip_stay_task_allocation_touch() from public,anon,authenticated;
create trigger trip_stay_task_allocation_revision after insert or update or delete on public.trip_stay_task_allocations
for each row execute function dlight_private.trip_stay_task_allocation_touch();

create function dlight_private.trip_stay_task_allocation_sync() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.trip_id is distinct from old.trip_id or new.job_id is distinct from old.job_id
       or new.service_order_id is distinct from old.service_order_id or new.status is distinct from old.status) then
    delete from public.trip_stay_task_allocations where stay_id=new.id;
  end if;
  if new.status<>'approved' or new.task_allocations_explicit then return new; end if;
  if new.service_order_id is not null and not exists(
    select 1 from public.trip_stay_task_allocations where stay_id=new.id
  ) then
    insert into public.trip_stay_task_allocations(stay_id,service_order_id,share,source,created_by)
    values(new.id,new.service_order_id,1,'automatic',auth.uid()) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function dlight_private.trip_stay_task_allocation_sync() from public,anon,authenticated;
create trigger trip_stays_task_allocation_sync after insert or update of trip_id,job_id,service_order_id,status on public.trip_stays
for each row execute function dlight_private.trip_stay_task_allocation_sync();

create function dlight_private.trip_stay_task_allocations_save(p_trip uuid,p_stay uuid,p_rows jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trip_stays; x record; total numeric:=0; cnt integer:=0; assigned uuid[]:='{}'::uuid[];
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  select * into s from public.trip_stays where id=p_stay and trip_id=p_trip for update;
  if not found then raise exception 'Чужая стоянка'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Некорректное распределение стоянки'; end if;
  if s.status='approved' and s.job_id is null then raise exception 'Для подтверждённой стоянки выбери заявку'; end if;
  if s.status<>'approved' and jsonb_array_length(p_rows)>0 then raise exception 'Сначала подтверди стоянку'; end if;
  for x in select * from jsonb_to_recordset(p_rows) as r(order_id uuid,share numeric) loop
    if x.order_id is null or x.share is null or x.share<=0 or x.share>1 or x.order_id=any(assigned) then
      raise exception 'Проверь задание и долю стоянки';
    end if;
    if not exists(select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
      where tso.trip_id=p_trip and tso.order_id=x.order_id and o.job_id=s.job_id) then
      raise exception 'Задание должно относиться к заявке стоянки и этому выезду';
    end if;
    total:=total+x.share;cnt:=cnt+1;assigned:=array_append(assigned,x.order_id);
  end loop;
  if total>1.000001 then raise exception 'Сумма долей превышает 100 процентов'; end if;
  perform set_config('dlight.change_reason',coalesce(nullif(btrim(p_reason),''),'Распределены человеко-часы стоянки'),true);
  update public.trip_stays set task_allocations_explicit=true where id=p_stay;
  insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot)
  values(p_trip,(select workbench_revision from public.trips where id=p_trip),auth.uid(),
    coalesce(nullif(btrim(p_reason),''),'Распределены человеко-часы стоянки'),
    jsonb_build_object('stay_id',p_stay,'allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.trip_stay_task_allocations a where a.stay_id=p_stay),'[]'::jsonb)));
  delete from public.trip_stay_task_allocations where stay_id=p_stay;
  insert into public.trip_stay_task_allocations(stay_id,service_order_id,share,source,created_by)
    select p_stay,r.order_id,r.share,'manager',auth.uid()
    from jsonb_to_recordset(p_rows) as r(order_id uuid,share numeric);
end $$;
revoke all on function dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text) to authenticated;

create function public.trip_presence_save_tasks(p_trip uuid,p_expected integer,p_stays jsonb,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare revision integer; s jsonb; rows jsonb;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  revision:=public.trip_presence_save(p_trip,p_expected,p_stays,p_reason);
  for s in select value from jsonb_array_elements(p_stays) loop
    if s ? 'task_allocations' then
      rows:=coalesce(s->'task_allocations','[]'::jsonb);
      perform dlight_private.trip_stay_task_allocations_save(p_trip,(s->>'id')::uuid,rows,p_reason);
    end if;
  end loop;
  select workbench_revision into revision from public.trips where id=p_trip;
  return revision;
end $$;
revoke all on function public.trip_presence_save_tasks(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.trip_presence_save_tasks(uuid,integer,jsonb,text) to authenticated;

-- Keep task links and edited stay shares in the same plan transaction.
create or replace function dlight_private.trip_plan_save_tasks(
  p_trip uuid,p_expected integer,p_plan jsonb,p_order_ids uuid[],p_reason text,p_stays jsonb default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid; requests uuid[]; orders uuid[]:=coalesce(p_order_ids,'{}'::uuid[]); s jsonb;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  if cardinality(orders)<>(select count(distinct x) from unnest(orders) x) then raise exception 'Повтор задания в выезде'; end if;
  if exists(select 1 from unnest(orders) x where not exists(
    select 1 from public.service_orders o where o.id=x and o.job_id is not null and o.work_mode='onsite'
      and (o.status not in ('review','completed','cancelled') or exists(select 1 from public.trip_service_orders c where c.trip_id=p_trip and c.order_id=o.id))
  )) then raise exception 'Одно из заданий недоступно для выезда'; end if;
  if exists(select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=p_trip and o.status in ('review','completed','cancelled') and not(o.id=any(orders)))
  then raise exception 'Нельзя отвязать задание, переданное на проверку или закрытое'; end if;
  select coalesce(array_agg(distinct o.job_id order by o.job_id),'{}'::uuid[]) into requests
    from public.service_orders o where o.id=any(orders);
  tid:=public.trip_plan_save(p_trip,p_expected,p_plan,requests,p_reason,p_stays);
  delete from public.trip_service_orders where trip_id=tid;
  insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
    select tid,x,ord::integer-1,'dispatcher',auth.uid() from unnest(orders) with ordinality u(x,ord);
  update public.trip_stays s set service_order_id=null
    where s.trip_id=tid and not s.task_allocations_explicit and s.service_order_id is not null
      and not exists(select 1 from public.trip_service_orders tso where tso.trip_id=tid and tso.order_id=s.service_order_id);
  delete from public.trip_stay_task_allocations a using public.trip_stays s
    where s.id=a.stay_id and s.trip_id=tid and not exists(
      select 1 from public.trip_service_orders tso where tso.trip_id=tid and tso.order_id=a.service_order_id
    );
  if p_stays is not null then
    for s in select value from jsonb_array_elements(p_stays) where value ? 'task_allocations' loop
      perform dlight_private.trip_stay_task_allocations_save(tid,(s->>'id')::uuid,
        coalesce(s->'task_allocations','[]'::jsonb),p_reason);
    end loop;
  end if;
  return tid;
end $$;
revoke all on function dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) to authenticated;

create table public.trip_cost_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  source_revision integer not null,
  source_track_updated_at timestamptz,
  fact_km numeric not null check(fact_km>=0),
  components jsonb not null,
  diagnostics jsonb not null default '{}',
  approval_reason text not null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create unique index trip_cost_allocation_current_idx on public.trip_cost_allocation_runs(trip_id) where current;
create index trip_cost_allocation_trip_idx on public.trip_cost_allocation_runs(trip_id,approved_at desc);
alter table public.trip_cost_allocation_runs enable row level security;
revoke all on public.trip_cost_allocation_runs from public,anon,authenticated;
grant select on public.trip_cost_allocation_runs to authenticated;
create policy trip_cost_allocation_runs_read on public.trip_cost_allocation_runs for select to authenticated
using (coalesce(public.user_role() in ('admin','logist') or exists(
  select 1 from public.trips t where t.id=trip_id and (auth.uid()=t.lead_engineer
    or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])))
),false));

create table public.trip_cost_allocations (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.trip_cost_allocation_runs(id) on delete cascade,
  cost_type text not null check(cost_type in ('distance','distance_unallocated','labor','labor_unallocated','per_diem','overnight','manual_adjustment')),
  service_order_id uuid references public.service_orders(id) on delete restrict,
  stay_id uuid references public.trip_stays(id) on delete restrict,
  track_segment_index integer check(track_segment_index is null or track_segment_index>=0),
  quantity numeric not null check(quantity>=0),
  unit_rate numeric not null,
  amount numeric not null,
  basis text not null,
  source_ref text
);
create index trip_cost_allocations_run_idx on public.trip_cost_allocations(run_id,cost_type,service_order_id);
create index trip_cost_allocations_order_idx on public.trip_cost_allocations(service_order_id,run_id) where service_order_id is not null;
alter table public.trip_cost_allocations enable row level security;
revoke all on public.trip_cost_allocations from public,anon,authenticated;
grant select on public.trip_cost_allocations to authenticated;
create policy trip_cost_allocations_read on public.trip_cost_allocations for select to authenticated
using (
  (service_order_id is not null and dlight_private.order_access(service_order_id))
  or exists(select 1 from public.trip_cost_allocation_runs r where r.id=run_id)
);
revoke all on sequence public.trip_cost_allocations_id_seq from public,anon,authenticated;

create function public.trip_cost_allocation_save(
  p_trip uuid,p_expected integer,p_track_updated_at timestamptz,p_reason text,p_lines jsonb,p_diagnostics jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  t public.trips; run_id uuid; track_at timestamptz; item record;
  target_distance numeric; target_labor numeric; target_labor_hours numeric; target_fixed numeric; target_adjustment numeric;
  sum_distance numeric:=0; sum_labor numeric:=0; sum_fixed numeric:=0; sum_adjustment numeric:=0;
  sum_distance_km numeric:=0; sum_labor_hours numeric:=0;
  distance_alloc numeric; labor_alloc numeric; distance_unalloc numeric; labor_unalloc numeric;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер утверждает распределение'; end if;
  if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Укажи основание подтверждения'; end if;
  select * into t from public.trips where id=p_trip and deleted_at is null for update;
  if not found or t.status<>'done' then raise exception 'Распределять можно только подтверждённый выезд'; end if;
  if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён. Обнови распределение.' using errcode='40001'; end if;
  if t.fact_km is null or t.fact_km<0 or t.econ_snapshot->>'cost_basis' is distinct from 'fact' then
    raise exception 'Нет подтверждённого факта пробега и себестоимости'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(coalesce(p_diagnostics,'{}'::jsonb))<>'object' then
    raise exception 'Некорректные строки распределения'; end if;
  select updated_at into track_at from public.trip_tracks where trip_id=p_trip;
  if track_at is distinct from p_track_updated_at then raise exception 'Трек изменился. Пересчитай распределение.' using errcode='40001'; end if;
  target_distance:=round(coalesce((t.econ_snapshot->>'cKm')::numeric,0),2);
  target_labor:=case when t.econ_snapshot->>'presence_basis'='person_hours_v1' then round(coalesce((
    select sum(s.minutes_mgr*cardinality(coalesce(s.crew_ids,'{}'::uuid[]))/60.0)
    from public.trip_stays s where s.trip_id=p_trip and s.status='approved'
      and s.crew_source in ('snapshot','manager') and s.minutes_mgr is not null
  ),0)*coalesce((t.tariffs_snapshot->'costs'->>'hour')::numeric,0),2) else 0 end;
  target_labor_hours:=case when t.econ_snapshot->>'presence_basis'='person_hours_v1' then coalesce((
    select sum(s.minutes_mgr*cardinality(coalesce(s.crew_ids,'{}'::uuid[]))/60.0)
    from public.trip_stays s where s.trip_id=p_trip and s.status='approved'
      and s.crew_source in ('snapshot','manager') and s.minutes_mgr is not null
  ),0) else 0 end;
  target_fixed:=round(coalesce((t.econ_snapshot->>'cDay')::numeric,0)+coalesce((t.econ_snapshot->>'cNight')::numeric,0),2);
  target_adjustment:=case when coalesce(t.overrides->>'cost','')='' then 0
    else round((t.overrides->>'cost')::numeric-coalesce((t.econ_snapshot->>'costComputed')::numeric,0),2) end;

  for item in select * from jsonb_to_recordset(p_lines) as x(
    cost_type text,service_order_id uuid,stay_id uuid,track_segment_index integer,
    quantity numeric,unit_rate numeric,amount numeric,basis text,source_ref text
  ) loop
    if item.cost_type is null or item.cost_type not in ('distance','distance_unallocated','labor','labor_unallocated','per_diem','overnight','manual_adjustment')
       or item.quantity is null or item.quantity<0 or item.unit_rate is null or item.amount is null or nullif(btrim(item.basis),'') is null then
      raise exception 'Некорректная строка распределения'; end if;
    if item.cost_type='manual_adjustment' then
      if item.service_order_id is not null or item.quantity<>1 or round(item.amount,2)<>round(item.unit_rate,2) then raise exception 'Некорректная корректировка'; end if;
    elsif item.source_ref='rounding_reconciliation' and item.cost_type in ('distance','distance_unallocated','labor','labor_unallocated') then
      if item.quantity<>0 or item.unit_rate<>0 or abs(item.amount)>0.05 then raise exception 'Некорректная поправка округления'; end if;
    elsif round(item.amount,2)<>round(item.quantity*item.unit_rate,2) then raise exception 'Сумма строки не совпадает с количеством и ставкой';
    end if;
    if item.cost_type in ('distance','distance_unallocated') and item.source_ref<>'rounding_reconciliation'
      and item.unit_rate is distinct from coalesce((t.tariffs_snapshot->'costs'->>'km')::numeric,0) then
      raise exception 'Ставка километра не совпадает со снимком выезда';
    end if;
    if item.cost_type in ('labor','labor_unallocated') and item.source_ref<>'rounding_reconciliation'
      and item.unit_rate is distinct from coalesce((t.tariffs_snapshot->'costs'->>'hour')::numeric,0) then
      raise exception 'Ставка часа не совпадает со снимком выезда';
    end if;
    if item.service_order_id is not null and not exists(
      select 1 from public.trip_service_orders where trip_id=p_trip and order_id=item.service_order_id
    ) then raise exception 'Задание не входит в выезд'; end if;
    if item.cost_type in ('distance','distance_unallocated') and item.stay_id is not null then raise exception 'Строка пробега не должна ссылаться на стоянку'; end if;
    if item.cost_type='distance' and item.track_segment_index is null then raise exception 'Распределённый пробег должен ссылаться на участок трека'; end if;
    if item.cost_type='distance_unallocated' and item.track_segment_index is null
      and coalesce(item.source_ref,'') not in ('odometer_reconciliation','rounding_reconciliation') then raise exception 'Для остатка пробега укажи источник'; end if;
    if item.cost_type in ('labor','labor_unallocated') and item.track_segment_index is not null then raise exception 'Человеко-часы не должны ссылаться на участок трека'; end if;
    if item.cost_type in ('per_diem','overnight','manual_adjustment') and (item.stay_id is not null or item.track_segment_index is not null) then
      raise exception 'Фиксированная статья не должна ссылаться на стоянку или участок';
    end if;
    if item.cost_type in ('labor','labor_unallocated') and item.stay_id is not null and not exists(
      select 1 from public.trip_stays s where s.id=item.stay_id and s.trip_id=p_trip and s.status='approved'
        and s.crew_source in ('snapshot','manager') and s.minutes_mgr is not null
    ) then raise exception 'Человеко-часы ссылаются на неподтверждённую стоянку'; end if;
    if item.cost_type in ('distance','distance_unallocated') and item.track_segment_index is not null then
      if not exists(select 1 from public.trip_tracks tt,jsonb_array_elements(tt.data->'segments') with ordinality s(v,n)
        where tt.trip_id=p_trip and n=item.track_segment_index+1
          and (s.v->>'kind' in ('road','track','line'))
          and item.quantity<=coalesce((s.v->>'km')::numeric,0)+0.01) then raise exception 'Участок трека изменился или превышена его длина'; end if;
    end if;
    if item.cost_type='labor' then
      if item.service_order_id is null or item.stay_id is null or not exists(
        select 1 from public.trip_stays s join public.trip_stay_task_allocations a on a.stay_id=s.id
        where s.id=item.stay_id and s.trip_id=p_trip and s.status='approved'
          and a.service_order_id=item.service_order_id
      ) then raise exception 'Факт труда должен ссылаться на подтверждённую стоянку и её задание'; end if;
      if item.quantity>coalesce((select s.minutes_mgr*cardinality(coalesce(s.crew_ids,'{}'::uuid[]))/60.0*a.share
        from public.trip_stays s join public.trip_stay_task_allocations a on a.stay_id=s.id
        where s.id=item.stay_id and a.service_order_id=item.service_order_id),0)+0.0001 then
        raise exception 'Человеко-часы превышают долю задания на стоянке';
      end if;
    end if;
    if item.cost_type in ('distance','labor','per_diem','overnight') then
      if item.service_order_id is null and item.cost_type in ('distance','labor') then raise exception 'Выбери задание для распределённой строки'; end if;
      if item.service_order_id is not null and item.cost_type in ('per_diem','overnight') then raise exception 'Фиксированные затраты пока остаются нераспределёнными'; end if;
    else
      if item.service_order_id is not null then raise exception 'Нераспределённая строка не должна иметь задание'; end if;
    end if;
    if item.cost_type in ('distance','distance_unallocated') then sum_distance:=sum_distance+item.amount; end if;
    if item.cost_type in ('labor','labor_unallocated') then sum_labor:=sum_labor+item.amount; end if;
    if item.cost_type in ('per_diem','overnight') then sum_fixed:=sum_fixed+item.amount; end if;
    if item.cost_type='manual_adjustment' then sum_adjustment:=sum_adjustment+item.amount; end if;
  end loop;
  select coalesce(sum(quantity),0) into sum_distance_km
  from jsonb_to_recordset(p_lines) as x(cost_type text,quantity numeric,source_ref text)
  where x.cost_type in ('distance','distance_unallocated') and coalesce(x.source_ref,'')<>'rounding_reconciliation';
  if abs(sum_distance_km-t.fact_km)>0.01 then raise exception 'Километры строк не сходятся с подтверждённым одометром'; end if;
  if exists(
    select 1 from (
      select x.track_segment_index,sum(x.quantity) quantity
      from jsonb_to_recordset(p_lines) as x(cost_type text,track_segment_index integer,quantity numeric)
      where x.cost_type in ('distance','distance_unallocated') and x.track_segment_index is not null
      group by x.track_segment_index
    ) grouped
    where not exists(select 1 from public.trip_tracks tt,jsonb_array_elements(tt.data->'segments') with ordinality s(v,n)
      where tt.trip_id=p_trip and n=grouped.track_segment_index+1
        and grouped.quantity<=coalesce((s.v->>'km')::numeric,0)+0.01)
  ) then raise exception 'Сумма километров распределения превышает длину участка трека'; end if;
  select coalesce(sum(quantity),0) into sum_labor_hours
  from jsonb_to_recordset(p_lines) as x(cost_type text,quantity numeric,source_ref text)
  where x.cost_type in ('labor','labor_unallocated') and coalesce(x.source_ref,'')<>'rounding_reconciliation';
  if abs(sum_labor_hours-target_labor_hours)>0.0001 then raise exception 'Человеко-часы не сходятся с подтверждёнными стоянками'; end if;
  if exists(
    select 1 from (
      select x.stay_id,sum(x.quantity) quantity
      from jsonb_to_recordset(p_lines) as x(cost_type text,stay_id uuid,quantity numeric)
      where x.cost_type in ('labor','labor_unallocated') and x.stay_id is not null
      group by x.stay_id
    ) grouped join public.trip_stays s on s.id=grouped.stay_id
    where s.trip_id=p_trip and grouped.quantity>s.minutes_mgr*cardinality(coalesce(s.crew_ids,'{}'::uuid[]))/60.0+0.0001
  ) then raise exception 'Человеко-часы по стоянке превышают подтверждённый факт'; end if;
  if abs(round(sum_distance,2)-target_distance)>0.01 then raise exception 'Километраж не сходится с подтверждённой себестоимостью'; end if;
  if abs(round(sum_labor,2)-target_labor)>0.01 then raise exception 'Труд не сходится с подтверждённым присутствием'; end if;
  if abs(round(sum_fixed,2)-target_fixed)>0.01 then raise exception 'Суточные и ночлег не сходятся с выездным снимком'; end if;
  if abs(round(sum_adjustment,2)-target_adjustment)>0.01 then raise exception 'Ручная корректировка не сходится со снимком'; end if;

  select coalesce(sum(amount) filter(where cost_type='distance'),0),coalesce(sum(amount) filter(where cost_type='labor'),0),
    coalesce(sum(amount) filter(where cost_type='distance_unallocated'),0),coalesce(sum(amount) filter(where cost_type='labor_unallocated'),0)
  into distance_alloc,labor_alloc,distance_unalloc,labor_unalloc
  from jsonb_to_recordset(p_lines) as x(cost_type text,amount numeric);
  update public.trip_cost_allocation_runs set current=false where trip_id=p_trip and current;
  insert into public.trip_cost_allocation_runs(trip_id,source_revision,source_track_updated_at,fact_km,
    components,diagnostics,approval_reason,approved_by,created_by)
  values(p_trip,t.workbench_revision,track_at,t.fact_km,
    jsonb_build_object(
      'distance',jsonb_build_object('total',target_distance,'assigned',round(distance_alloc,2),'unallocated',round(distance_unalloc,2)),
      'labor',jsonb_build_object('total',target_labor,'assigned',round(labor_alloc,2),'unallocated',round(labor_unalloc,2)),
      'fixed',jsonb_build_object('total',target_fixed,'assigned',0,'unallocated',target_fixed),
      'manual_adjustment',jsonb_build_object('total',target_adjustment,'assigned',0,'unallocated',target_adjustment)
    ),coalesce(p_diagnostics,'{}'::jsonb),btrim(p_reason),auth.uid(),auth.uid()) returning id into run_id;
  insert into public.trip_cost_allocations(run_id,cost_type,service_order_id,stay_id,track_segment_index,quantity,unit_rate,amount,basis,source_ref)
    select run_id,x.cost_type,x.service_order_id,x.stay_id,x.track_segment_index,x.quantity,x.unit_rate,x.amount,x.basis,x.source_ref
    from jsonb_to_recordset(p_lines) as x(
      cost_type text,service_order_id uuid,stay_id uuid,track_segment_index integer,
      quantity numeric,unit_rate numeric,amount numeric,basis text,source_ref text
    );
  return run_id;
end $$;
revoke all on function public.trip_cost_allocation_save(uuid,integer,timestamptz,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.trip_cost_allocation_save(uuid,integer,timestamptz,text,jsonb,jsonb) to authenticated;

-- Current, approved travel costs appear on the task without exposing the
-- manager-only review history of the trip to unrelated users.
create function public.service_order_trip_cost_summary(p_order uuid)
returns table(
  trip_id uuid,date_from date,vehicle_label text,distance_km numeric,distance_cost numeric,
  labor_hours numeric,labor_cost numeric,approved_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not dlight_private.order_access(p_order) then raise exception 'Нет доступа к заданию'; end if;
  return query
  select r.trip_id,t.date_from,t.vehicle_label,
    coalesce(sum(a.quantity) filter(where a.cost_type='distance'),0),
    coalesce(sum(a.amount) filter(where a.cost_type='distance'),0),
    coalesce(sum(a.quantity) filter(where a.cost_type='labor'),0),
    coalesce(sum(a.amount) filter(where a.cost_type='labor'),0),r.approved_at
  from public.trip_cost_allocations a
  join public.trip_cost_allocation_runs r on r.id=a.run_id and r.current
  join public.trips t on t.id=r.trip_id and t.deleted_at is null
  left join public.trip_tracks tt on tt.trip_id=t.id
  where a.service_order_id=p_order and a.cost_type in ('distance','labor')
    and r.source_revision=t.workbench_revision and r.fact_km is not distinct from t.fact_km
    and r.source_track_updated_at is not distinct from tt.updated_at
  group by r.trip_id,t.date_from,t.vehicle_label,r.approved_at
  order by t.date_from desc nulls last,r.approved_at desc;
end $$;
revoke all on function public.service_order_trip_cost_summary(uuid) from public,anon,authenticated;
grant execute on function public.service_order_trip_cost_summary(uuid) to authenticated;

commit;
