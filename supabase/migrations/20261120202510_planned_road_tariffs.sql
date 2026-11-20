begin;

alter table dlight_private.finance_adjustments drop constraint finance_adjustments_scope_check,
  add constraint finance_adjustments_scope_check check(scope in ('job','order','trip','work','road_plan'));

-- Endpoint keys keep a rate attached to the same leg when other stops move.
create function dlight_private.finance_planned_road(p_trip uuid) returns jsonb
language sql stable set search_path='' as $$
  with source as (
    select coalesce(nullif(plan_econ_snapshot,'{}'),econ_snapshot) as plan,route_stops
    from public.trips where id=p_trip and deleted_at is null
  ), legs as (
    select entry->>'a' as a,entry->>'b' as b,(entry->>'km')::numeric as km,position,
      row_number() over(partition by entry->>'a',entry->>'b' order by position) as occurrence
    from source cross join lateral jsonb_array_elements(
      case when jsonb_typeof(plan->'legs')='array' then plan->'legs' else '[]' end
    ) with ordinality as leg(entry,position)
    where jsonb_typeof(entry->'km')='number'
  ), labels as (
    select (round((stop->>'lat')::numeric,5)::text||','||round((stop->>'lng')::numeric,5)::text) as endpoint,
      min(nullif(stop->>'name','')) as label
    from source cross join lateral jsonb_array_elements(coalesce(route_stops,'[]')) stop
    where stop->>'lat' is not null and stop->>'lng' is not null
    group by 1
  ), route as (
    select (plan->>'km')::numeric as total,
      (select count(*)>0 and bool_and(coalesce(length(a),0)>0 and coalesce(length(b),0)>0 and km>=0)
        and abs(sum(km)-(plan->>'km')::numeric)<=0.02+count(*)*0.005 from legs) as has_legs
    from source
  ), positions as (
    select md5(jsonb_build_array(a,b,occurrence)::text) as id,position,km,
      coalesce(from_stop.label,a)||' → '||coalesce(to_stop.label,b) as title
    from legs cross join route left join labels from_stop on from_stop.endpoint=a
      left join labels to_stop on to_stop.endpoint=b
    where route.has_legs and km>0
    union all
    select 'route',1,total,'Маршрут выезда' from route where total>0 and has_legs is not true
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'km',km,
    'rates',dlight_private.finance_local('road_plan',p_trip,id)) order by position),'[]') from positions
$$;

create function dlight_private.entity_finance_read_planned_road(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb := dlight_private.entity_finance_read(p_scope,p_id);
  trips jsonb;
begin
  if result is null then return null; end if;
  select coalesce(jsonb_agg(trip||jsonb_build_object(
    'plan_legs',case when trip->>'plan_km' is not null then dlight_private.finance_planned_road((trip->>'id')::uuid)
      else '[]'::jsonb end,
    'plan_editable',status<>'cancelled' and dlight_private.responsibility_manager('trip',t.id)
  ) order by position),'[]') into trips
  from jsonb_array_elements(result->'trips') with ordinality as entry(trip,position)
    join public.trips t on t.id=(trip->>'id')::uuid;
  return jsonb_set(result,'{trips}',trips);
end $$;

create function dlight_private.finance_planned_road_save(p_trip uuid,p_subject text,p_previous jsonb,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  current_status text;
  previous jsonb;
  rate record;
begin
  if dlight_private.responsibility_manager('trip',p_trip) is not true then
    raise exception 'Тарифы дороги изменяет куратор';
  end if;
  select status::text into current_status from public.trips where id=p_trip and deleted_at is null for update;
  if current_status is null or current_status='cancelled'
    or dlight_private.responsibility_manager('trip',p_trip) is not true then
    raise exception 'Тарифы дороги доступны только для просмотра';
  end if;
  if not exists(select 1 from jsonb_array_elements(dlight_private.finance_planned_road(p_trip)) leg
    where leg->>'id'=p_subject) then
    raise exception 'План маршрута изменился. Обновите карточку' using errcode='40001';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object' then raise exception 'Проверьте плановые тарифы'; end if;
  for rate in select key,value from jsonb_each(p_value) loop
    if rate.key not in ('revenue','cost') or dlight_private.finance_valid_amount(rate.value) is not true then
      raise exception 'Проверьте плановые тарифы';
    end if;
  end loop;
  previous:=dlight_private.finance_local('road_plan',p_trip,p_subject);
  if previous is distinct from p_previous then
    raise exception 'Тарифы изменились. Обновите карточку' using errcode='40001';
  end if;
  if previous=p_value then return p_value; end if;
  if p_value='{}' then
    delete from dlight_private.finance_adjustments where scope='road_plan' and owner_id=p_trip and subject=p_subject;
  else
    insert into dlight_private.finance_adjustments values('road_plan',p_trip,p_subject,p_value)
      on conflict(scope,owner_id,subject) do update set value=excluded.value;
  end if;
  insert into dlight_private.finance_adjustment_events(scope,owner_id,subject,actor_id,previous,new_value)
    values('road_plan',p_trip,p_subject,auth.uid(),previous,p_value);
  return p_value;
end $$;

create or replace function public.entity_finance_read(p_scope text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select dlight_private.entity_finance_read_planned_road(p_scope,p_id)
$$;
create or replace function public.entity_finance_adjust(p_scope text,p_id uuid,p_subject text,p_previous jsonb,p_value jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case when p_scope='road_plan' then dlight_private.finance_planned_road_save(p_id,p_subject,p_previous,p_value)
    else dlight_private.entity_finance_adjust(p_scope,p_id,p_subject,p_previous,p_value) end
$$;

revoke all on function dlight_private.finance_planned_road(uuid),
  dlight_private.entity_finance_read_planned_road(text,uuid),
  dlight_private.finance_planned_road_save(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.entity_finance_read_planned_road(text,uuid),
  dlight_private.finance_planned_road_save(uuid,text,jsonb,jsonb) to authenticated;

commit;
