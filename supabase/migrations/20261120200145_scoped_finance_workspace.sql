begin;

create table dlight_private.finance_adjustments (
  scope text not null check(scope in ('job','order','trip','work')),
  owner_id uuid not null,
  subject text not null,
  value jsonb not null,
  primary key(scope,owner_id,subject)
);
create table dlight_private.finance_adjustment_events (
  id bigint generated always as identity primary key,
  scope text not null,
  owner_id uuid not null,
  subject text not null,
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  previous jsonb not null,
  new_value jsonb not null
);
alter table dlight_private.finance_adjustments enable row level security;
alter table dlight_private.finance_adjustment_events enable row level security;
revoke all on dlight_private.finance_adjustments,dlight_private.finance_adjustment_events from public,anon,authenticated;

create function dlight_private.finance_local(p_scope text,p_id uuid,p_subject text) returns jsonb
language sql stable set search_path='' as $$
  select coalesce((select value from dlight_private.finance_adjustments
    where scope=p_scope and owner_id=p_id and subject=p_subject),'{}'::jsonb)
$$;

create function dlight_private.finance_entities(p_scope text,p_id uuid)
returns setof uuid language sql stable set search_path='' as $$
  select o.id from public.service_orders o where
    (p_scope='order' and o.id=p_id or p_scope='job' and o.job_id=p_id or p_scope='trip' and exists(
      select 1 from public.trip_service_orders link where link.trip_id=p_id and link.order_id=o.id))
$$;

-- Only the latest accepted contribution per task and trip can change fact.
create function dlight_private.finance_lines(p_orders uuid[],p_trip uuid,p_scope text) returns jsonb
language sql stable set search_path='' as $$
  with recursive accepted as materialized (
    select distinct on(v.order_id,v.trip_id) v.order_id,v.trip_id,v.payload,v.recorded_at
    from dlight_private.order_trip_result_versions v
    where v.order_id=any(p_orders) and v.state='accepted' and (p_trip is null or v.trip_id=p_trip)
    order by v.order_id,v.trip_id,v.sequence desc
  ), per_item as (
    select a.order_id,(item->>'id')::uuid item_id,sum((item->>'qty')::numeric) qty,sum((item->>'hours')::numeric) hours,
      jsonb_agg(jsonb_build_object('trip',a.trip_id,'at',a.recorded_at,'qty',item->'qty','hours',item->'hours')
        order by a.recorded_at,a.trip_id) sources
    from accepted a cross join lateral jsonb_array_elements(a.payload->'items') item group by a.order_id,(item->>'id')::uuid
  ), latest as (
    select distinct on(v.order_id,v.trip_id) v.order_id,v.trip_id,v.state,v.payload
    from dlight_private.order_trip_result_versions v where v.order_id=any(p_orders) and (p_trip is null or v.trip_id=p_trip)
    order by v.order_id,v.trip_id,v.sequence desc
  ), pending as (
    select v.order_id,(item->>'id')::uuid item_id,count(*) count
    from latest v cross join lateral jsonb_array_elements(v.payload->'items') item
    where v.state='submitted' and ((item->>'qty')::numeric>0 or (item->>'hours')::numeric>0)
    group by v.order_id,(item->>'id')::uuid
  ), eligible as materialized (
    select * from public.service_order_items
    where order_id=any(p_orders) and request_finance_void_event_id is null
      and legacy_snapshot->>'request_finance_voided_at' is null
  ), lineage(id,root,seen) as (
    select e.id,e.id,array[e.id] from eligible e where p_scope='job'
      and not exists(select 1 from eligible parent where parent.id=e.source_item_id)
    union all
    select child.id,parent.root,parent.seen||child.id
    from lineage parent join eligible child on child.source_item_id=parent.id where not child.id=any(parent.seen)
  ), lines as (
    select i.*,o.number,o.status,
      coalesce(lineage.root,i.id) as root_id,
      case when o.status='cancelled' then i.done_qty
           when p_scope='job' and coalesce(lineage.root,i.id)=i.id then i.planned_qty
           when p_scope='job' then 0
           else greatest(0,i.planned_qty-i.transferred_qty) end as plan_qty,
      case when p_trip is null then i.done_qty else coalesce(f.qty,0) end as fact_qty,
      f.hours as accepted_hours,f.qty as accepted_qty,f.sources,coalesce(p.count,0) as pending_count,
      lower(btrim(i.unit)) in ('ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours') as hourly,
      coalesce(dlight_private.payment_local('job',o.job_id),'{}')||dlight_private.payment_local('order',o.id)
        ||dlight_private.payment_local('work',o.id,i.id::text) as terms,
      coalesce(lineage.root,i.id)=i.id as plan_in_scope
    from eligible i join public.service_orders o on o.id=i.order_id
    left join lineage on lineage.id=i.id
    left join per_item f on f.order_id=i.order_id and f.item_id=i.id
    left join pending p on p.order_id=i.order_id and p.item_id=i.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'order_id',order_id,'number',number,'title',title,'kind',kind,'unit',unit,
    'root_id',root_id,'plan_qty',plan_qty,'fact_qty',fact_qty,'accepted_qty',accepted_qty,'fact_hours',accepted_hours,
    'pending_count',pending_count,'sources',coalesce(sources,'[]'),
    'snapshot_qty',planned_qty,'plan_in_scope',plan_in_scope,
    'plan_hours',coalesce(planned_labor_hours,case when hourly then planned_qty end),
    'base_revenue',case when kind='material' then case when billable then unit_price_snapshot else 0 end
      else financial_revenue_snapshot / nullif(planned_qty,0) end,
    'base_cost',case when kind='material' then unit_cost_snapshot else financial_cost_snapshot / nullif(planned_qty,0) end,
    'hour_cost',financial_cost_snapshot / nullif(case when hourly then planned_qty else planned_labor_hours end,0),
    'terms',terms,'billable',billable,'hourly',hourly,'tariff_profile',tariff_profile,
    'rates',case when kind='work' then dlight_private.finance_local('work',order_id,id::text) end,
    'editable',kind='work' and status<>'cancelled' and dlight_private.responsibility_manager('order',order_id))
    order by number,title,id),'[]'::jsonb) from lines;
$$;

create function dlight_private.finance_road_contribution(p_trip uuid,p_scope text,p_id uuid,p_job uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  trip public.trips;
  road jsonb;
  plan jsonb;
  allocation public.trip_cost_allocation_runs;
  track_at timestamptz;
  whole boolean;
  solo boolean;
  lower_ratio numeric;
  upper_ratio numeric;
  distance_cost numeric;
  allocated_km numeric;
begin
  select * into trip from public.trips where id=p_trip and deleted_at is null;
  if not found then return null; end if;
  plan:=coalesce(nullif(trip.plan_econ_snapshot,'{}'),trip.econ_snapshot);
  whole:=p_scope='trip';
  solo:=whole or (select count(*)=1 and bool_or(job=p_job) from dlight_private.payment_trip_jobs(p_trip) job)
    and (p_scope<>'order' or (select count(*)=1 from public.trip_service_orders where trip_id=p_trip));
  select updated_at into track_at from public.trip_tracks where trip_id=p_trip;
  select * into allocation from public.trip_cost_allocation_runs where trip_id=p_trip and current
    and source_revision=trip.workbench_revision and source_track_updated_at is not distinct from track_at
    and fact_km is not distinct from trip.fact_km;
  if allocation.id is not null then
    select coalesce(sum(line.amount),0),coalesce(sum(line.quantity),0) into distance_cost,allocated_km
    from public.trip_cost_allocations line
    where line.run_id=allocation.id and (
      (whole and line.cost_type in ('distance','distance_unallocated'))
      or (line.cost_type='distance' and line.service_order_id in (select dlight_private.finance_entities(p_scope,p_id)))
    );
  end if;
  if p_scope='order' then
    with per_order as (
      select link.order_id,
        (select sum(line.quantity) from public.trip_cost_allocations line where line.run_id=allocation.id
          and line.cost_type='distance' and line.service_order_id=link.order_id) as km
      from public.trip_service_orders link join public.service_orders o on o.id=link.order_id
      where link.trip_id=p_trip and o.job_id=p_job
    )
    select case when count(*)=1 then 0 when count(km)=count(*) and sum(km)>0
        then coalesce(sum(km) filter(where order_id<p_id),0)/sum(km) end,
      case when count(*)=1 then 1 when count(km)=count(*) and sum(km)>0
        then coalesce(sum(km) filter(where order_id<=p_id),0)/sum(km) end
    into lower_ratio,upper_ratio from per_order;
  else
    lower_ratio:=0;
    upper_ratio:=1;
  end if;
  if track_at is not null and dlight_private.responsibility_manager('trip',p_trip) then
    road:=dlight_private.journal_road_model(p_trip);
    if jsonb_array_length(road->'sections')=0 then road:=null; end if;
  end if;
  return jsonb_build_object('id',p_trip,'title',trip.vehicle_label,'date',trip.date_from,
    'whole',whole,'request_id',p_job,'lower',lower_ratio,'upper',upper_ratio,'road',road,
    'plan_km',case when solo then (plan->>'km')::numeric end,
    'plan_cost',case when solo then (plan->>'km')::numeric*(trip.tariffs_snapshot#>>'{costs,km}')::numeric end,
    'plan_revenue',case when solo then (plan->>'rTravel')::numeric end,
    'fact_km',case when whole or road is not null then trip.fact_km end,'allocated_km',allocated_km,'approved_cost',distance_cost,
    'legacy_fact_km',case when solo then trip.fact_km else allocated_km end,
    'legacy_fact_cost',case when solo and trip.fact_km is not null then (trip.econ_snapshot->>'cKm')::numeric end);
end $$;

create function dlight_private.entity_finance_read(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  order_ids uuid[];
  job_id uuid;
  status text;
  adjustments jsonb;
  roads jsonb;
  extras numeric;
  pricing jsonb;
begin
  if p_scope is null or p_scope not in ('job','order','trip') then raise exception 'Карточка экономики недоступна'; end if;
  if dlight_private.responsibility_manager(p_scope,p_id) is not true then return null; end if;
  if p_scope='job' then
    select j.status::text,j.id into status,job_id from public.jobs j where j.id=p_id and deleted_at is null;
  elsif p_scope='order' then
    select o.status::text,o.job_id into status,job_id from public.service_orders o where o.id=p_id;
  else
    select t.status::text into status from public.trips t where t.id=p_id and deleted_at is null;
  end if;
  if status is null then return null; end if;
  select coalesce(array_agg(e),'{}') into order_ids from dlight_private.finance_entities(p_scope,p_id) e;
  select coalesce(jsonb_object_agg(subject,value),'{}') into adjustments
    from dlight_private.finance_adjustments where scope=p_scope and owner_id=p_id;
  select coalesce(jsonb_agg(dlight_private.finance_road_contribution(t.id,p_scope,p_id,job_id) order by t.date_from,t.id),'[]') into roads
    from public.trips t where t.deleted_at is null and t.status<>'cancelled' and
      (p_scope='trip' and t.id=p_id or p_scope<>'trip' and (exists(
        select 1 from public.trip_service_orders where trip_id=t.id and order_id=any(order_ids))
        or p_scope='job' and exists(select 1 from public.trip_jobs link where link.trip_id=t.id and link.job_id=p_id)));
  select coalesce(sum(cost),0) into extras from public.service_order_extra_part_costs
    where order_id=any(order_ids) and (p_scope<>'trip' or trip_id=p_id);
  select jsonb_build_object('currency',s.currency,'tariffs',s.tariffs,'profiles',s.tariff_profiles)
    into pricing from public.settings s where s.id=true;
  return jsonb_build_object('scope',p_scope,'id',p_id,'editable',status<>'cancelled','currency',coalesce(pricing->>'currency','грн'),
    'pricing',pricing,
    'corrections',adjustments,'trips',roads,'extra_parts_cost',extras,
    'lines',dlight_private.finance_lines(order_ids,case when p_scope='trip' then p_id end,p_scope));
end $$;

create function dlight_private.finance_valid_amount(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='number' then p_value::numeric>=0 and p_value::numeric<=999999999999
    and p_value::numeric=round(p_value::numeric,2) else false end;
$$;

create function dlight_private.entity_finance_adjust(p_scope text,p_id uuid,p_subject text,p_previous jsonb,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  authority text := case when p_scope='work' then 'order' else p_scope end;
  current_status text;
  previous jsonb;
  mode record;
  rate record;
  value jsonb:=p_value;
  reason text;
begin
  if p_scope is null or p_scope not in ('job','order','trip','work') or p_subject is null
    or dlight_private.responsibility_manager(authority,p_id) is not true then raise exception 'Финансы изменяет куратор'; end if;
  if authority='job' then
    select status::text into current_status from public.jobs where id=p_id and deleted_at is null for update;
  elsif authority='order' then
    select status::text into current_status from public.service_orders where id=p_id for update;
  else
    select status::text into current_status from public.trips where id=p_id and deleted_at is null for update;
  end if;
  if current_status is null or current_status='cancelled'
    or dlight_private.responsibility_manager(authority,p_id) is not true then raise exception 'Финансы доступны только для просмотра'; end if;
  if jsonb_typeof(value) is distinct from 'object' then raise exception 'Проверьте сумму и тарифы'; end if;
  if p_scope='work' then
    if not exists(select 1 from public.service_order_items where order_id=p_id and id::text=p_subject and kind='work'
      and request_finance_void_event_id is null and legacy_snapshot->>'request_finance_voided_at' is null) then
      raise exception 'Работа не принадлежит заданию'; end if;
    for mode in select pair.key,pair.value as rates from jsonb_each(p_value) pair loop
      if mode.key not in ('plan','fact') or jsonb_typeof(mode.rates) is distinct from 'object' or mode.rates='{}' then
        raise exception 'Проверьте тарифы работы'; end if;
      for rate in select pair.key,pair.value as amount from jsonb_each(mode.rates) pair loop
        if rate.key not in ('revenue','cost') or dlight_private.finance_valid_amount(rate.amount) is not true then
          raise exception 'Проверьте тарифы работы'; end if;
      end loop;
    end loop;
  else
    if p_subject not in ('plan:revenue','plan:cost','fact:revenue','fact:cost') then raise exception 'Неизвестный итог'; end if;
    if value<>'{}' then
      reason:=btrim(coalesce(value->>'reason',''));
      if (value-'value'-'reason')<>'{}' or dlight_private.finance_valid_amount(value->'value') is not true
        or jsonb_typeof(value->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then
        raise exception 'Укажите согласованную сумму и причину корректировки'; end if;
      value:=jsonb_build_object('value',value->'value','reason',reason);
    end if;
  end if;
  previous:=dlight_private.finance_local(p_scope,p_id,p_subject);
  if previous is distinct from p_previous then
    raise exception 'Финансы изменились. Обновите карточку' using errcode='40001';
  end if;
  if previous=value then return value; end if;
  if value='{}' then
    delete from dlight_private.finance_adjustments where scope=p_scope and owner_id=p_id and subject=p_subject;
  else
    insert into dlight_private.finance_adjustments values(p_scope,p_id,p_subject,value)
      on conflict(scope,owner_id,subject) do update set value=excluded.value;
  end if;
  insert into dlight_private.finance_adjustment_events(scope,owner_id,subject,actor_id,previous,new_value)
    values(p_scope,p_id,p_subject,auth.uid(),previous,value);
  return value;
end $$;

create function public.entity_finance_read(p_scope text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select dlight_private.entity_finance_read(p_scope,p_id)
$$;
create function public.entity_finance_adjust(p_scope text,p_id uuid,p_subject text,p_previous jsonb,p_value jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.entity_finance_adjust(p_scope,p_id,p_subject,p_previous,p_value)
$$;
revoke all on function dlight_private.finance_local(text,uuid,text),dlight_private.finance_entities(text,uuid),
  dlight_private.finance_lines(uuid[],uuid,text),dlight_private.finance_road_contribution(uuid,text,uuid,uuid),
  dlight_private.finance_valid_amount(jsonb),dlight_private.entity_finance_read(text,uuid),public.entity_finance_read(text,uuid),
  dlight_private.entity_finance_adjust(text,uuid,text,jsonb,jsonb),public.entity_finance_adjust(text,uuid,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function dlight_private.entity_finance_read(text,uuid),public.entity_finance_read(text,uuid),
  dlight_private.entity_finance_adjust(text,uuid,text,jsonb,jsonb),public.entity_finance_adjust(text,uuid,text,jsonb,jsonb)
  to authenticated;
notify pgrst,'reload schema';
commit;
