-- Schedule placement by task dates and SLA, with route-order conflicts as booking blocks.
--
-- 1. A task outside trips with its own start date is placed from that date (as before).
--    A task without a start date takes its hours at the latest point before its deadline:
--    the task end date, otherwise the request SLA. Busy days of its crew are skipped backwards.
-- 2. In a trip, a dated task never starts before its own start date: the route keeps its road
--    and the work waits for the start of its day (a gap in the schedule).
-- 3. If the route reaches a task after a task with a later date (Depot → A → B, B dated before A),
--    the order conflicts with the dates. Such a task leaves the route sequence and is shown as a
--    booking block on its own date until the route or the dates are changed. A booking cannot be
--    moved in the schedule.
-- Tasks with a fixed start date are placed before deadline-only tasks, which then avoid them.
-- Overflow, early placement and SLA conflicts are derived in the client from the final layout.

create or replace function dlight_private.planner_place(p_segments jsonb, p_date date, p_hour numeric, p_people uuid[], p_open boolean, p_cuts jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb:='[]'; segment jsonb; parts jsonb; w jsonb; cut jsonb; cuts jsonb; ci integer:=0; placed numeric:=0; used numeric; remaining numeric; take numeric; next_cut numeric; guard integer:=0; cursor_date date:=p_date; clock numeric:=p_hour;
begin
 if cursor_date is null or cardinality(p_people)=0 then return output; end if;
 select coalesce(jsonb_agg(c order by (c->>'after')::numeric),'[]') into cuts
  from jsonb_array_elements(coalesce(p_cuts,'[]')) c where (c->>'after')::numeric>0;
 for segment in select value from jsonb_array_elements(p_segments) loop
  parts:='[]';used:=0;remaining:=(segment->>'hours')::numeric;
  -- A dated task waits for the start of its own day.
  if nullif(segment->>'not_before','') is not null and (segment->>'not_before')::date>cursor_date then cursor_date:=(segment->>'not_before')::date;clock:=0; end if;
  while remaining>0.000001 and guard<6000 loop
   guard:=guard+1;
   if ci<jsonb_array_length(cuts) and placed>=(cuts->ci->>'after')::numeric-.000001 then
    cut:=cuts->ci;cursor_date:=(cut#>>'{at,d}')::date;clock:=(cut#>>'{at,t}')::numeric;ci:=ci+1;
   end if;
   w:=dlight_private.planner_window(case when segment ? 'clock_people' then array(select x::uuid from jsonb_array_elements_text(segment->'clock_people') x) else p_people end,cursor_date,p_open);
   if w is null or clock>=(w->>'ceiling')::numeric-.000001 then cursor_date:=cursor_date+1;clock:=0;continue; end if;
   clock:=greatest(clock,(w->>'start')::numeric);
   next_cut:=case when ci<jsonb_array_length(cuts) then (cuts->ci->>'after')::numeric-placed else remaining end;
   take:=least(remaining,(w->>'ceiling')::numeric-clock,next_cut);
   if take<=.000001 then exit; end if;
   parts:=parts||jsonb_build_array(jsonb_build_object('id',segment->>'source_key'||':'||used::text,'date',cursor_date,'start',round(clock,6),'end',round(clock+take,6),'offset',round(used,6)));
   clock:=clock+take;placed:=placed+take;used:=used+take;remaining:=remaining-take;
  end loop;
  if remaining>.000001 then segment:=segment||jsonb_build_object('incomplete',true); end if;
  output:=output||jsonb_build_array((segment-'hours'-'clock_people')||jsonb_build_object('parts',parts));
 end loop;
 return output;
end $$;

do $patch$
declare
  source text;
  patched text;
  step text;
  overlap constant text:='exists(select 1 from jsonb_array_elements(projected) candidate cross join lateral jsonb_array_elements(candidate->''parts'') p
      cross join lateral jsonb_array_elements(output) prior cross join lateral jsonb_array_elements(coalesce((select l.parts from public.planner_layouts l where l.source_key=prior->>''source_key'' and l.manual),prior->''parts'')) b
      where p->>''date''=b->>''date'' and (p->>''start'')::numeric<(b->>''end'')::numeric and (b->>''start'')::numeric<(p->>''end'')::numeric
       and exists(select 1 from jsonb_array_elements_text(coalesce((select to_jsonb(l.people) from public.planner_layouts l where l.source_key=prior->>''source_key'' and l.manual),prior->''people'')) x where x.value::uuid=any(crew)))';
begin
  -- planner_project_baseline -------------------------------------------------------------
  source:=pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  patched:=source;

  step:=patched;
  patched:=replace(patched,'attempt integer; busy_end numeric; busy_date date;',
    'attempt integer; busy_end numeric; busy_date date; bookings jsonb; booking jsonb; max_from date; work jsonb; deadline date; fallback date; d date;');
  if patched=step then raise exception 'baseline: declarations patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'segments:=''[]'';encountered:=''{}'';','segments:=''[]'';bookings:=''[]'';max_from:=null;encountered:=''{}'';');
  if patched=step then raise exception 'baseline: trip init patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,
    'segments:=segments||jsonb_build_array(jsonb_build_object(''source_key'',''work:''||assignment.id||'':''||trip.id,',
    'work:=(jsonb_build_object(''source_key'',''work:''||assignment.id||'':''||trip.id,');
  if patched=step then raise exception 'baseline: work segment head patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,
    'else jsonb_build_object(''clock_people'',to_jsonb(case when cardinality(taskcrew)>0 then taskcrew else crew end)) end);
    end if;',
    'else jsonb_build_object(''clock_people'',to_jsonb(case when cardinality(taskcrew)>0 then taskcrew else crew end)) end);
     -- The route reaches this task after a task with a later date: book its own date instead.
     if coalesce(assignment.date_to,assignment.date_from)<max_from then
      bookings:=bookings||jsonb_build_array(work||jsonb_build_object(''booking'',true,''conflict'',''order'',''not_before'',coalesce(assignment.date_from,assignment.date_to)));
     else
      if assignment.date_from is not null then work:=work||jsonb_build_object(''not_before'',assignment.date_from);max_from:=greatest(max_from,assignment.date_from); end if;
      segments:=segments||jsonb_build_array(work);
     end if;
    end if;');
  if patched=step then raise exception 'baseline: work segment tail patch did not apply'; end if;

  step:=patched;
  patched:=regexp_replace(patched,
    '(  output:=output\|\|projected;\n end loop;\n for assignment in select \* from public\.service_orders o where o\.status<>''cancelled'' and )o\.date_from is not null and ',
    '  output:=output||projected;
  for booking in select value from jsonb_array_elements(bookings) loop
   output:=output||dlight_private.planner_place(jsonb_build_array(booking-''clock_people''),(booking->>''not_before'')::date,0,array(select x::uuid from jsonb_array_elements_text(booking->''people'') x),false);
  end loop;
 end loop;
 for assignment in select * from public.service_orders o where o.status<>''cancelled'' and (o.date_from is not null or coalesce(o.date_to,(select j.due_date from public.jobs j where j.id=o.job_id)) is not null) and ');
  if patched=step then raise exception 'baseline: standalone selection patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'and t.status<>''cancelled'') order by date_from,id loop',
    'and t.status<>''cancelled'') order by o.date_from is null,coalesce(o.date_from,o.date_to,(select j.due_date from public.jobs j where j.id=o.job_id)),o.id loop');
  if patched=step then raise exception 'baseline: standalone order patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'start_day:=assignment.date_from;start_hour:=0;',
    'start_day:=assignment.date_from;start_hour:=0;
  if start_day is null then
   -- No own start date: take the hours at the latest point before the deadline, skipping busy days backwards.
   deadline:=coalesce(assignment.date_to,(select j.due_date from public.jobs j where j.id=assignment.job_id));fallback:=null;
   for attempt in 0..90 loop
    d:=deadline-attempt;
    projected:=dlight_private.planner_place(segments,d,0,crew,false);
    if coalesce((select max((p->>''date'')::date) from jsonb_array_elements(projected->0->''parts'') p),deadline+1)>deadline then continue; end if;
    fallback:=coalesce(fallback,d);
    if not '||overlap||' then start_day:=d; exit; end if;
   end loop;
   start_day:=coalesce(start_day,fallback,deadline);
  end if;');
  if patched=step then raise exception 'baseline: deadline placement patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'fingerprint:=md5((segment-''parts''-''order_revision''-''trip_revision'')::text',
    'fingerprint:=md5((segment-''parts''-''order_revision''-''trip_revision''-''not_before''-''booking''-''conflict'')::text');
  if patched=step then raise exception 'baseline: fingerprint patch did not apply'; end if;
  execute patched;

  -- planner_project: bookings stay on their date and are not part of the trip chain ------------
  source:=pg_get_functiondef('dlight_private.planner_project()'::regprocedure);
  patched:=replace(source,'  if g->>''trip_id'' is not null then
   if previous_trip is distinct from','  if coalesce((g->>''booking'')::boolean,false) then
   null;
  elsif g->>''trip_id'' is not null then
   if previous_trip is distinct from');
  if patched=source then raise exception 'planner_project: booking branch patch did not apply'; end if;
  -- A manual part keeps its place even before the task start date.
  step:=patched;
  patched:=replace(patched,'jsonb_build_array((g-''parts'')||jsonb_build_object(''hours'',(old_part->>''end'')',
    'jsonb_build_array((g-''parts''-''not_before'')||jsonb_build_object(''hours'',(old_part->>''end'')');
  if patched=step then raise exception 'planner_project: manual shift patch did not apply'; end if;
  execute patched;

  -- planner_trip_defaults: the automatic trip chain excludes bookings ---------------------------
  source:=pg_get_functiondef('dlight_private.planner_trip_defaults(jsonb,uuid)'::regprocedure);
  patched:=replace(source,'where g->>''trip_id''=p_trip::text;','where g->>''trip_id''=p_trip::text and not coalesce((g->>''booking'')::boolean,false);');
  if patched=source then raise exception 'planner_trip_defaults: booking filter patch did not apply'; end if;
  execute patched;

  -- planner_apply: a booking cannot be moved -------------------------------------------------
  source:=pg_get_functiondef('dlight_private.planner_apply(uuid,jsonb,text,jsonb)'::regprocedure);
  patched:=replace(source,'if base is null then raise exception ''Исходное размещение изменилось. Обновите график''; end if;',
    'if base is null then raise exception ''Исходное размещение изменилось. Обновите график''; end if;
  if coalesce((base->>''booking'')::boolean,false) then raise exception ''Бронирование не переносится: сначала согласуйте порядок маршрута и даты задания''; end if;');
  if patched=source then raise exception 'planner_apply: booking guard patch did not apply'; end if;
  execute patched;
end $patch$;
