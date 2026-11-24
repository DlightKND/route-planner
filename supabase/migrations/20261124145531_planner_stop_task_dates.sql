-- Tasks at one route stop are done in the order of their own dates, not in the order they were
-- added to the trip. Before this, two tasks on the same site (trip 17: task 52 dated 25.11 added
-- before task 53 dated 24.11) were read as a route-order conflict and the earlier one was booked.
-- A route-order conflict is only possible between different stops of the route.

do $patch$
declare source text; patched text;
begin
  source:=pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  patched:=replace(source,'where l.trip_id=trip.id and o.status<>''cancelled'' order by l.ordinal,o.created_at,o.id loop',
    'where l.trip_id=trip.id and o.status<>''cancelled'' order by coalesce(o.date_from,o.date_to) nulls last,l.ordinal,o.created_at,o.id loop');
  if patched=source then raise exception 'baseline: stop task order patch did not apply'; end if;
  execute patched;
end $patch$;
