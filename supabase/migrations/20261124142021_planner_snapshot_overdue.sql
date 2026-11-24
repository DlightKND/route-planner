-- The planner overview lists overdue plans for all dates, not only inside the selected period:
--   overdue — a task not started whose planned work is entirely before today;
--   overrun — a started task (in progress or paused) whose planned work ended before today;
--   late    — a planned or assigned trip whose plan started before today.
-- Each item is visible only to people with access to its task or trip.

do $patch$
declare source text; patched text; step text;
begin
  source:=pg_get_functiondef('dlight_private.planner_snapshot(date,date)'::regprocedure);
  patched:=replace(source,'declare groups jsonb; all_groups jsonb; durations jsonb;','declare groups jsonb; all_groups jsonb; durations jsonb; overdue jsonb; today date;');
  if patched=source then raise exception 'planner_snapshot: declarations patch did not apply'; end if;
  step:=patched;
  patched:=replace(patched,'return jsonb_build_object(''groups'',groups,''order_plan_hours'',durations);',
'today:=(now() at time zone coalesce((select nullif(to_jsonb(s)->>''company_timezone'','''') from public.settings s where s.id=true),''Europe/Kyiv''))::date;
 select coalesce(jsonb_agg(item order by item->>''date'',item->>''id''),''[]'') into overdue from (
  select jsonb_build_object(''kind'',''order'',''id'',o.id,''type'',case when o.status in (''draft'',''assigned'') then ''overdue'' else ''overrun'' end,''date'',max(p->>''date'')) item
  from jsonb_array_elements(all_groups) g cross join lateral jsonb_array_elements(g->''parts'') p join public.service_orders o on o.id=(g->>''order_id'')::uuid
  where g->>''kind''=''work'' and not coalesce((g->>''booking'')::boolean,false) and o.status in (''draft'',''assigned'',''in_progress'',''paused'') and dlight_private.order_access(o.id)
  group by o.id,o.status having max(p->>''date'')<today::text
  union all
  select jsonb_build_object(''kind'',''trip'',''id'',t.id,''type'',''late'',''date'',min(p->>''date'')) item
  from jsonb_array_elements(all_groups) g cross join lateral jsonb_array_elements(g->''parts'') p join public.trips t on t.id=(g->>''trip_id'')::uuid
  where t.status::text in (''planned'',''assigned'') and not coalesce((g->>''booking'')::boolean,false) and dlight_private.responsibility_access(''trip'',t.id)
  group by t.id having min(p->>''date'')<today::text
 ) items;
 return jsonb_build_object(''groups'',groups,''order_plan_hours'',durations,''overdue'',overdue);');
  if patched=step then raise exception 'planner_snapshot: overdue patch did not apply'; end if;
  execute patched;
end $patch$;
