begin;

create or replace function dlight_private.entity_finance_read_planned_road(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb := dlight_private.entity_finance_read(p_scope,p_id);
  trips jsonb;
  lines jsonb;
begin
  if result is null then return null; end if;
  select coalesce(jsonb_agg(trip||jsonb_build_object(
    'plan_legs',case when trip->>'plan_km' is not null then dlight_private.finance_planned_road((trip->>'id')::uuid)
      else '[]'::jsonb end,
    'plan_editable',t.status<>'cancelled' and dlight_private.responsibility_manager('trip',t.id)
  ) order by position),'[]') into trips
  from jsonb_array_elements(result->'trips') with ordinality as entry(trip,position)
    join public.trips t on t.id=(trip->>'id')::uuid;

  select coalesce(jsonb_agg(line||jsonb_build_object('order_title',o.title) order by position),'[]') into lines
  from jsonb_array_elements(result->'lines') with ordinality as entry(line,position)
    join public.service_orders o on o.id=(line->>'order_id')::uuid;

  return result||jsonb_build_object('trips',trips,'lines',lines);
end $$;

commit;
