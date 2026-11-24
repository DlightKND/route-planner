-- Weekends pause a trip by default: road and work continue on the next working day.
-- A weekend day is used only when it is explicitly opened in the crew's working hours (staff_day).
-- Trips with a legacy saved clock plan (day_plan.start) keep their explicit weekend days,
-- so historical schedules do not shift.

do $patch$
declare source text; patched text;
begin
  source:=pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  patched:=replace(source,'else crew end,true,coalesce(trip.day_plan->''cuts'',''[]''));',
    'else crew end,coalesce(trip.day_plan ? ''start'',false),coalesce(trip.day_plan->''cuts'',''[]''));');
  if patched=source then raise exception 'baseline: trip weekend patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.planner_trip_defaults(jsonb,uuid)'::regprocedure);
  patched:=replace(source,'dlight_private.planner_trip_start(triprow)),0,crew,true);','dlight_private.planner_trip_start(triprow)),0,crew,false);');
  if patched=source then raise exception 'planner_trip_defaults: weekend patch did not apply'; end if;
  execute patched;
end $patch$;
