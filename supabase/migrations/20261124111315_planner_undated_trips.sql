-- A trip without plan dates or a road crew still carries its tasks into the schedule.
-- Before this, such a trip (for example one formed from several tasks and started at once)
-- removed its tasks from the planner: linked tasks are placed only through their trip,
-- and the trip was skipped for a missing date_from or crew.
--
-- Trip start, first known value: saved clock start → planner origin → plan dates →
-- actual start (company time zone) → earliest linked task date.
-- Trip crew falls back to the linked tasks' leads and engineers.

create or replace function dlight_private.planner_trip_task_crew(p_trip uuid) returns uuid[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct person order by person),'{}')
  from public.trip_service_orders link join public.service_orders task on task.id=link.order_id
  cross join lateral unnest(array[task.lead_engineer]||coalesce(task.engineer_ids,'{}')) person
  where link.trip_id=p_trip and task.status<>'cancelled' and person is not null
$$;

create or replace function dlight_private.planner_trip_start(p_trip public.trips) returns date
language sql stable set search_path = '' as $$
  select coalesce(nullif(p_trip.day_plan#>>'{start,d}','')::date,
    (select start_date from dlight_private.planner_trip_origins where trip_id=p_trip.id),
    p_trip.date_from,
    (p_trip.started_at at time zone coalesce((select nullif(to_jsonb(s)->>'company_timezone','') from public.settings s where s.id=true),'Europe/Kyiv'))::date,
    (select min(task.date_from) from public.trip_service_orders link join public.service_orders task on task.id=link.order_id
      where link.trip_id=p_trip.id and task.status<>'cancelled'))
$$;

do $patch$
declare
  source text;
  patched text;
  step text;
begin
  source:=pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  patched:=source;
  step:=patched;
  patched:=replace(patched,
    'for trip in select * from public.trips where deleted_at is null and status<>''cancelled'' and date_from is not null order by date_from,id loop',
    'for trip in select t.* from public.trips t where t.deleted_at is null and t.status<>''cancelled'' and dlight_private.planner_trip_start(t) is not null order by dlight_private.planner_trip_start(t),t.id loop');
  if patched=step then raise exception 'planner_project_baseline: trip loop patch did not apply'; end if;
  step:=patched;
  patched:=regexp_replace(patched,
    '(crew:=array\(select distinct x from unnest\(array\[trip\.lead_engineer\]\|\|coalesce\(trip\.engineer_ids,''\{\}''\)\) x where x is not null\);)(\s*)(if cardinality\(crew\)=0 then continue; end if;)',
    '\1\2if cardinality(crew)=0 then crew:=dlight_private.planner_trip_task_crew(trip.id); end if;\2\3');
  if patched=step then raise exception 'planner_project_baseline: crew patch did not apply'; end if;
  step:=patched;
  patched:=replace(patched,',trip.date_from);start_hour:=',',trip.date_from,dlight_private.planner_trip_start(trip));start_hour:=');
  if patched=step then raise exception 'planner_project_baseline: start patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.planner_trip_defaults(jsonb,uuid)'::regprocedure);
  patched:=replace(source,'coalesce(origin,triprow.date_from),0,crew,true)',
    'coalesce(origin,triprow.date_from,dlight_private.planner_trip_start(triprow)),0,crew,true)');
  if patched=source then raise exception 'planner_trip_defaults: start patch did not apply'; end if;
  step:=patched;
  patched:=regexp_replace(patched,
    '(crew:=array\(select distinct x from unnest\(array\[triprow\.lead_engineer\]\|\|coalesce\(triprow\.engineer_ids,''\{\}''\)\) x where x is not null\);)',
    '\1 if cardinality(crew)=0 then crew:=dlight_private.planner_trip_task_crew(p_trip); end if;');
  if patched=step then raise exception 'planner_trip_defaults: crew patch did not apply'; end if;
  execute patched;
end $patch$;

revoke all on function dlight_private.planner_trip_task_crew(uuid),dlight_private.planner_trip_start(public.trips)
  from public,anon,authenticated;
