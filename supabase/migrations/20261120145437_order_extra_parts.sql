begin;

-- Current costs are separate from frozen trip tariffs and result versions.
-- A correction replaces the contribution of its visit atomically.
create table public.service_order_extra_part_costs (
  order_id uuid not null references public.service_orders(id) on delete cascade,
  trip_id uuid not null,
  cost numeric(18,2) not null check (cost >= 0),
  primary key (order_id, trip_id)
);
create index service_order_extra_part_costs_trip_idx on public.service_order_extra_part_costs(trip_id);
alter table public.service_order_extra_part_costs enable row level security;
revoke all on public.service_order_extra_part_costs from public, anon, authenticated;
grant select on public.service_order_extra_part_costs to authenticated;
create policy order_extra_part_costs_manager_read on public.service_order_extra_part_costs
  for select to authenticated using (dlight_private.responsibility_manager('order', order_id));

create function dlight_private.order_extra_parts_normalize(p_order uuid, p_parts jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  part jsonb;
  part_id uuid;
  work_id uuid;
  title text;
  unit_name text;
  qty numeric;
  unit_cost numeric;
  parts jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) > 100 then
    raise exception 'Проверьте список внеплановых запчастей';
  end if;
  for part in select value from jsonb_array_elements(p_parts) loop
    if jsonb_typeof(part->'qty') is distinct from 'number' or jsonb_typeof(part->'unit_cost') is distinct from 'number'
      or jsonb_typeof(part->'title') is distinct from 'string' or jsonb_typeof(part->'unit') is distinct from 'string'
      or coalesce(part->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or coalesce(part->>'work_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then raise exception 'Заполните данные внеплановой запчасти'; end if;
    part_id := (part->>'id')::uuid;
    work_id := (part->>'work_id')::uuid;
    title := btrim(part->>'title');
    unit_name := btrim(part->>'unit');
    qty := (part->>'qty')::numeric;
    unit_cost := (part->>'unit_cost')::numeric;
    if length(title) not between 1 and 500 or length(unit_name) not between 1 and 40
      or qty < 0 or qty >= 1000000 or qty <> round(qty, 6)
      or unit_cost not between 0 and 1000000 or unit_cost <> round(unit_cost, 2)
    then raise exception 'Проверьте название, количество и цену внеплановой запчасти'; end if;
    if exists(select 1 from jsonb_array_elements(parts) item where item->>'id' = part_id::text) then
      raise exception 'В отчёте повторяется внеплановая запчасть';
    end if;
    if not exists(select 1 from public.service_order_items where id = work_id and order_id = p_order
      and kind = 'work' and request_finance_void_event_id is null
      and legacy_snapshot->>'request_finance_voided_at' is null)
    then raise exception 'Работа для внеплановой запчасти отсутствует в задании'; end if;
    parts := parts || jsonb_build_array(jsonb_build_object('id',part_id,'work_id',work_id,
      'title',title,'unit',unit_name,'qty',qty,'unit_cost',unit_cost));
  end loop;
  return parts;
end $$;
revoke all on function dlight_private.order_extra_parts_normalize(uuid,jsonb) from public, anon, authenticated;

alter function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  rename to order_trip_result_write_core;
revoke all on function dlight_private.order_trip_result_write_core(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  from public, anon, authenticated;

create function dlight_private.order_trip_result_write(
  p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,p_expected_event uuid,
  p_operation uuid,p_action text,p_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt jsonb;
  version dlight_private.order_trip_result_versions;
  already_recorded boolean;
  extra_parts jsonb;
  cost_total numeric;
begin
  if dlight_private.order_access(p_order) is not true or dlight_private.responsibility_access('trip',p_trip) is not true then
    raise exception 'Нет доступа к заданию или выезду';
  end if;
  perform 1 from public.trips where id = p_trip for update;
  select exists(select 1 from dlight_private.order_trip_result_versions where operation_id = p_operation)
    into already_recorded;
  -- Core validates identity, permissions, revisions and the operation key.
  -- It holds the visit and order locks until this transaction commits.
  receipt := dlight_private.order_trip_result_write_core(p_order,p_trip,p_order_revision,p_trip_revision,
    p_expected_event,p_operation,p_action,p_result);
  if already_recorded or p_action = 'returned' then return receipt; end if;
  select * into version from dlight_private.order_trip_result_versions where operation_id = p_operation;

  if p_result ? 'extra_parts' then
    extra_parts := dlight_private.order_extra_parts_normalize(p_order,p_result->'extra_parts');
  else
    select payload->'extra_parts' into extra_parts from dlight_private.order_trip_result_versions
      where operation_id = p_expected_event and order_id = p_order and trip_id = p_trip;
    if extra_parts is null then return receipt; end if;
    extra_parts := dlight_private.order_extra_parts_normalize(p_order,extra_parts);
  end if;

  update dlight_private.order_trip_result_versions set payload = payload || jsonb_build_object('extra_parts',extra_parts)
    where sequence = version.sequence;
  if p_action = 'accepted' then
    update public.service_order_result_events set snapshot = snapshot || jsonb_build_object('extra_parts', (
      select coalesce(jsonb_agg(part - 'unit_cost' order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(extra_parts) with ordinality items(part, ordinality)
    )) where id = version.activity_id;
    select coalesce(round(sum((part->>'qty')::numeric * (part->>'unit_cost')::numeric),2),0)
      into cost_total from jsonb_array_elements(extra_parts) part;
    insert into public.service_order_extra_part_costs(order_id,trip_id,cost) values(p_order,p_trip,cost_total)
      on conflict (order_id,trip_id) do update set cost = excluded.cost;
  end if;
  return receipt;
end $$;

create or replace function public.service_order_trip_result_write(
  p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,p_expected_event uuid,
  p_operation uuid,p_action text,p_result jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select dlight_private.order_trip_result_write(p_order,p_trip,p_order_revision,p_trip_revision,
    p_expected_event,p_operation,p_action,p_result)
$$;
revoke all on function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.service_order_trip_results(p_order uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select dlight_private.order_trip_result_read(p_order) || jsonb_build_object('extra_parts_supported',true,
    'extra_part_cost',coalesce((select sum(cost) from public.service_order_extra_part_costs where order_id = p_order),0))
$$;

notify pgrst, 'reload schema';
commit;
