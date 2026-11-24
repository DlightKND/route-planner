-- Schedule stage 3: the plan follows the progress of a trip.
--
-- 1. A task sent for review or completed ends its block at that moment (service_order_history):
--    the block is cut if the task was closed earlier than planned, and the rest of the automatic
--    trip chain continues from that moment — earlier or later than planned.
-- 2. In a started trip, a task that is not started yet (and the road leading to it) is not placed
--    before today: the remainder of the route starts from today.
-- 3. A trip whose route still passes a task stop with no active task (removed or cancelled) marks
--    its roads route_stale, so the planner asks to recalculate the route in the trip.
-- Manual placements keep their place; overdue plans are highlighted in the client, not moved.

-- planner_place: a segment may carry its closing moment (finish_d, finish_h).
create or replace function dlight_private.planner_place(p_segments jsonb, p_date date, p_hour numeric, p_people uuid[], p_open boolean, p_cuts jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb:='[]'; segment jsonb; parts jsonb; w jsonb; cut jsonb; cuts jsonb; ci integer:=0; placed numeric:=0; used numeric; remaining numeric; take numeric; next_cut numeric; guard integer:=0; cursor_date date:=p_date; clock numeric:=p_hour;
 finish_d date; finish_h numeric; kept jsonb; part jsonb;
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
  -- A closed task ends at its closing moment; the chain continues from there.
  finish_d:=nullif(segment->>'finish_d','')::date;finish_h:=nullif(segment->>'finish_h','')::numeric;
  if finish_d is not null and jsonb_array_length(cuts)=0 and jsonb_array_length(parts)>0
     and (finish_d,finish_h)>((parts->0->>'date')::date,(parts->0->>'start')::numeric) then
   kept:='[]';
   for part in select value from jsonb_array_elements(parts) loop
    if ((part->>'date')::date,(part->>'start')::numeric)>=(finish_d,finish_h) then exit; end if;
    if (part->>'date')::date=finish_d and (part->>'end')::numeric>finish_h then part:=part||jsonb_build_object('end',round(finish_h,6)); end if;
    kept:=kept||jsonb_build_array(part);
   end loop;
   parts:=kept;cursor_date:=finish_d;clock:=finish_h;
  end if;
  output:=output||jsonb_build_array((segment-'hours'-'clock_people'-'finish_d'-'finish_h')||jsonb_build_object('parts',parts));
 end loop;
 return output;
end $$;

do $patch$
declare source text; patched text; step text;
begin
  source:=pg_get_functiondef('dlight_private.planner_project_baseline()'::regprocedure);
  patched:=source;

  step:=patched;
  patched:=replace(patched,'fallback date; d date;','fallback date; d date; today date; tz text; finished timestamptz; stale boolean;');
  if patched=step then raise exception 'baseline: declarations patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'begin
 for trip in select t.* from public.trips t','begin
 tz:=coalesce((select nullif(to_jsonb(s)->>''company_timezone'','''') from public.settings s where s.id=true),''Europe/Kyiv'');
 today:=(now() at time zone tz)::date;
 for trip in select t.* from public.trips t');
  if patched=step then raise exception 'baseline: today patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'bookings:=''[]'';max_from:=null;','bookings:=''[]'';max_from:=null;stale:=false;');
  if patched=step then raise exception 'baseline: trip init patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'      segments:=segments||jsonb_build_array(work);
     end if;','      if assignment.status in (''review'',''completed'') then
       -- Closed task: its block ends when it went to review.
       select max(h.recorded_at) into finished from public.service_order_history h where h.order_id=assignment.id and h.reason ~ ''→ (review|completed)'';
       if finished is not null then work:=work||jsonb_build_object(''finish_d'',(finished at time zone tz)::date,''finish_h'',round(extract(epoch from (finished at time zone tz)::time)/3600.0,4)); end if;
      elsif trip.status=''in_progress'' and assignment.status in (''draft'',''assigned'') then
       -- Started trip: the not started remainder of the route begins no earlier than today.
       work:=work||jsonb_build_object(''not_before'',greatest(nullif(work->>''not_before'','''')::date,today));
       if jsonb_array_length(segments)>0 and segments->(jsonb_array_length(segments)-1)->>''kind''=''road'' then
        segments:=jsonb_set(segments,array[(jsonb_array_length(segments)-1)::text],(segments->(jsonb_array_length(segments)-1))||jsonb_build_object(''not_before'',greatest(nullif(segments->(jsonb_array_length(segments)-1)->>''not_before'','''')::date,today)));
       end if;
      end if;
      segments:=segments||jsonb_build_array(work);
     end if;');
  if patched=step then raise exception 'baseline: progress patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'    encountered:=encountered||assignment.id;
   end loop;
  end loop;','    encountered:=encountered||assignment.id;
   end loop;
   -- A task stop with no active task left: the route needs to be recalculated.
   if point_count>2 and i between 1 and point_count-2 and stop->>''type'' in (''client'',''job'') and not exists(
     select 1 from public.trip_service_orders link join public.service_orders task on task.id=link.order_id cross join lateral public.job_point(task.job_id) point
     where link.trip_id=trip.id and task.status<>''cancelled'' and abs(point.lat-(stop->>''lat'')::double precision)<=.00002 and abs(point.lng-(stop->>''lng'')::double precision)<=.00002) then stale:=true; end if;
  end loop;
  if stale then segments:=coalesce((select jsonb_agg(case when s->>''kind''=''road'' then s||jsonb_build_object(''route_stale'',true) else s end order by n) from jsonb_array_elements(segments) with ordinality x(s,n)),''[]''); end if;');
  if patched=step then raise exception 'baseline: stale route patch did not apply'; end if;

  step:=patched;
  patched:=replace(patched,'-''not_before''-''booking''-''conflict'')::text','-''not_before''-''booking''-''conflict''-''route_stale'')::text');
  if patched=step then raise exception 'baseline: fingerprint patch did not apply'; end if;
  execute patched;
end $patch$;
