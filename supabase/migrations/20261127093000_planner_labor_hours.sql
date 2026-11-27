-- The schedule takes a task's duration from its planned labour hours (норма-часы), as the task
-- card, the trip results and the finance workspace already do. Before this the planner read only
-- the billed quantity of works measured in hours: task 60 was created with "1 ч", its labour hours
-- were then set to 8, and the schedule kept a 1-hour bar.
--
-- Per work: planned labour hours when set (scaled down by the part already transferred to another
-- task), otherwise the remaining quantity of a work measured in hours. Works in other units count
-- only through their labour hours.

create function dlight_private.planner_work_hours(x public.service_order_items) returns numeric
language sql stable set search_path = '' as $$
  select case
    when x.planned_labor_hours is not null then
      x.planned_labor_hours * case when coalesce(x.planned_qty, 0) > 0
        then greatest(0, x.planned_qty - coalesce(x.transferred_qty, 0)) / x.planned_qty else 1 end
    when lower(trim(x.unit)) in ('ч','час','часа','часов','н-ч','нч','год','година','години','годин','h','hr','hour','hours')
      then greatest(0, x.planned_qty - coalesce(x.transferred_qty, 0))
    else 0 end
$$;

revoke all on function dlight_private.planner_work_hours(public.service_order_items) from public, anon, authenticated;

do $patch$
declare source text; patched text;
  old_sum constant text := $q$select coalesce(sum(greatest(0,x.planned_qty-x.transferred_qty)),0) into hours from public.service_order_items x where x.order_id=assignment.id and x.kind='work' and lower(trim(x.unit)) in ('ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours') and x.request_finance_void_event_id is null$q$;
  new_sum constant text := $q$select coalesce(sum(dlight_private.planner_work_hours(x)),0) into hours from public.service_order_items x where x.order_id=assignment.id and x.kind='work' and x.request_finance_void_event_id is null$q$;
begin
  source := pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  if (length(source) - length(replace(source, old_sum, ''))) / length(old_sum) <> 2 then
    raise exception 'baseline: labour hours patch expects two task hour sums';
  end if;
  patched := replace(source, old_sum, new_sum);
  execute patched;
end $patch$;
