-- Canonical schedule overrides. Requests do not own execution intervals.
-- No measured track, stay, quantity, status or economic snapshot is rewritten.
create table public.planner_layouts (
 source_key text primary key check(length(source_key) between 1 and 240),
 kind text not null check(kind in ('work','road')),
 order_id uuid references public.service_orders(id) on delete restrict,
 trip_id uuid references public.trips(id) on delete restrict,
 people uuid[] not null,
 parts jsonb not null default '[]' check(jsonb_typeof(parts)='array'),
 manual boolean not null default true,
 basis text not null,
 revision integer not null default 1 check(revision>0),
 updated_by uuid references public.profiles(id),updated_at timestamptz not null default now(),
 check((kind='work' and order_id is not null) or (kind='road' and order_id is null and trip_id is not null))
);
create index planner_layouts_order on public.planner_layouts(order_id) where order_id is not null;
create index planner_layouts_trip on public.planner_layouts(trip_id) where trip_id is not null;
create index planner_layouts_people on public.planner_layouts using gin(people);
-- Calendar envelopes may grow without moving the untouched automatic route.
create table dlight_private.planner_trip_origins (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 start_date date not null
);
revoke all on dlight_private.planner_trip_origins from public,anon,authenticated;
create table public.planner_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default now()
);
create table public.planner_layout_history (
 id bigint generated always as identity primary key,operation_id uuid not null references public.planner_operations(id),
 source_key text not null,actor_id uuid not null references public.profiles(id),
 reason text not null,before_plan jsonb,after_plan jsonb not null,created_at timestamptz not null default now()
);
create index planner_layout_history_source on public.planner_layout_history(source_key,created_at desc);
alter table public.planner_layouts enable row level security;
alter table public.planner_operations enable row level security;
alter table public.planner_layout_history enable row level security;
revoke all on public.planner_layouts,public.planner_operations,public.planner_layout_history from public,anon,authenticated;
grant select on public.planner_layouts,public.planner_layout_history to authenticated;
create policy planner_layout_read on public.planner_layouts for select to authenticated using(
 (order_id is not null and dlight_private.order_access(order_id))
 or (trip_id is not null and dlight_private.responsibility_access('trip',trip_id))
);
create policy planner_history_read on public.planner_layout_history for select to authenticated using(
 exists(select 1 from public.planner_layouts l where l.source_key=planner_layout_history.source_key)
);

-- The same clock projection serves reads and write-side collision validation.
create function dlight_private.planner_window(p_people uuid[],p_date date,p_open boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg jsonb; staff public.staff_day; person uuid; a numeric:=0; z numeric:=24; ordinary numeric:=24; ds numeric; de numeric; tol numeric;
begin
 select to_jsonb(s) into cfg from public.settings s where id=true;
 foreach person in array p_people loop
  select * into staff from public.staff_day where engineer=person and date=p_date;
  if staff.start_h is null and staff.end_h is null and extract(dow from p_date) in (0,6) and not p_open then return null; end if;
  ds:=coalesce(staff.start_h,(cfg->>'day_start')::numeric,7);
  de:=coalesce(staff.end_h,(cfg->>'day_end')::numeric,16);
  tol:=greatest(0,coalesce(staff.tol_h,(cfg->>'tolerance_h')::numeric,1));
  if de<=ds then return null; end if;
  a:=greatest(a,ds);ordinary:=least(ordinary,de);z:=least(z,de+tol,24);
 end loop;
 if cardinality(p_people)=0 or z<=a then return null; end if;
 return jsonb_build_object('start',a,'end',ordinary,'ceiling',z);
end $$;

create function dlight_private.planner_place(p_segments jsonb,p_date date,p_hour numeric,p_people uuid[],p_open boolean,p_cuts jsonb default '[]')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb:='[]'; segment jsonb; parts jsonb; w jsonb; cut jsonb; cuts jsonb; ci integer:=0; placed numeric:=0; used numeric; remaining numeric; take numeric; next_cut numeric; guard integer:=0; cursor_date date:=p_date; clock numeric:=p_hour;
begin
 if cursor_date is null or cardinality(p_people)=0 then return output; end if;
 select coalesce(jsonb_agg(c order by (c->>'after')::numeric),'[]') into cuts
  from jsonb_array_elements(coalesce(p_cuts,'[]')) c where (c->>'after')::numeric>0;
 for segment in select value from jsonb_array_elements(p_segments) loop
  parts:='[]';used:=0;remaining:=(segment->>'hours')::numeric;
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

create function dlight_private.planner_project()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb:='[]'; segments jsonb; trip public.trips; assignment public.service_orders; lay public.planner_layouts;
 crew uuid[]; taskcrew uuid[]; points jsonb; legs jsonb; stop jsonb; point_count integer; i integer; seq integer; road numeric; hours numeric; allocated integer;
 matched uuid[]; encountered uuid[]; pos record; segment jsonb; projected jsonb; item jsonb; start_day date; start_hour numeric; fingerprint text; owners uuid[]; attempt integer; busy_end numeric; busy_date date;
begin
 for trip in select * from public.trips where deleted_at is null and status<>'cancelled' and date_from is not null order by date_from,id loop
  crew:=array(select distinct x from unnest(array[trip.lead_engineer]||coalesce(trip.engineer_ids,'{}')) x where x is not null);
  if cardinality(crew)=0 then continue; end if;
  segments:='[]';encountered:='{}';points:=coalesce(trip.route_stops,'[]');point_count:=jsonb_array_length(points);legs:=coalesce(trip.plan_econ_snapshot->'legs',trip.econ_snapshot->'legs','[]');seq:=0;
  for i in 1..greatest(2,point_count-1,jsonb_array_length(legs)) loop
   road:=coalesce((legs->(i-1)->>'h')::numeric,coalesce((trip.plan_econ_snapshot->>'driveH')::numeric,(trip.econ_snapshot->>'driveH')::numeric,0)/greatest(2,point_count-1));
   if road>0 then
    segments:=segments||jsonb_build_array(jsonb_build_object('source_key','road:'||trip.id||':'||seq,'kind','road','order_id',null,'trip_id',trip.id,'people',to_jsonb(crew),'hours',road,'order_revision',null,'trip_revision',trip.workbench_revision,'route_key',coalesce(legs->(i-1)->>'a','')||'>'||coalesce(legs->(i-1)->>'b','')));seq:=seq+1;
   end if;
   stop:=points->i;
   for assignment in select o.* from public.trip_service_orders l join public.service_orders o on o.id=l.order_id where l.trip_id=trip.id and o.status<>'cancelled' order by l.ordinal,o.created_at,o.id loop
    if assignment.id=any(encountered) then continue; end if;
    select * into pos from public.job_point(assignment.job_id);
    if point_count>2 and not (i=1 and (select count(*) from public.trip_service_orders where trip_id=trip.id)=1)
      and (pos.lat is null or stop->>'lat' is null or abs(pos.lat-(stop->>'lat')::double precision)>.00002 or abs(pos.lng-(stop->>'lng')::double precision)>.00002) then continue; end if;
    select coalesce(sum(greatest(0,x.planned_qty-x.transferred_qty)),0) into hours from public.service_order_items x where x.order_id=assignment.id and x.kind='work' and lower(trim(x.unit)) in ('ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours') and x.request_finance_void_event_id is null and nullif(x.legacy_snapshot->>'request_finance_voided_at','') is null;
    select greatest(1,count(*)) into allocated from public.trip_service_orders l join public.trips t on t.id=l.trip_id where l.order_id=assignment.id and t.deleted_at is null and t.status<>'cancelled';
    -- A saved legacy clock plan retains its booked duration, independently of task volume.
    if trip.day_plan is null or trip.day_plan='{}' then hours:=hours/allocated; end if;
    taskcrew:=array(select distinct x from unnest(array[assignment.lead_engineer]||coalesce(assignment.engineer_ids,'{}')) x where x is not null);
    if hours>0 then
     segments:=segments||jsonb_build_array(jsonb_build_object('source_key','work:'||assignment.id||':'||trip.id,'kind','work','order_id',assignment.id,'trip_id',trip.id,'people',to_jsonb(case when cardinality(taskcrew)>0 then taskcrew else crew end),'hours',hours,'order_revision',assignment.revision,'trip_revision',trip.workbench_revision,'needs_assignment',cardinality(taskcrew)=0)||case when trip.day_plan ? 'start' then '{}'::jsonb else jsonb_build_object('clock_people',to_jsonb(case when cardinality(taskcrew)>0 then taskcrew else crew end)) end);
    end if;
    encountered:=encountered||assignment.id;
   end loop;
  end loop;
  -- Requests are location context only. Every work segment has a canonical task ID.
  start_day:=coalesce(nullif(trip.day_plan#>>'{start,d}','')::date,(select start_date from dlight_private.planner_trip_origins where trip_id=trip.id),trip.date_from);start_hour:=coalesce(nullif(trip.day_plan#>>'{start,t}','')::numeric,0);
  projected:=dlight_private.planner_place(segments,start_day,start_hour,case when trip.day_plan ? 'start' then array[coalesce(trip.lead_engineer,crew[1])] else crew end,true,coalesce(trip.day_plan->'cuts','[]'));
  output:=output||projected;
 end loop;
 for assignment in select * from public.service_orders o where o.status<>'cancelled' and o.date_from is not null and not exists(select 1 from public.trip_service_orders l join public.trips t on t.id=l.trip_id where l.order_id=o.id and t.deleted_at is null and t.status<>'cancelled') order by date_from,id loop
  crew:=array(select distinct x from unnest(array[assignment.lead_engineer]||coalesce(assignment.engineer_ids,'{}')) x where x is not null);if cardinality(crew)=0 then continue; end if;
  select coalesce(sum(greatest(0,x.planned_qty-x.transferred_qty)),0) into hours from public.service_order_items x where x.order_id=assignment.id and x.kind='work' and lower(trim(x.unit)) in ('ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours') and x.request_finance_void_event_id is null and nullif(x.legacy_snapshot->>'request_finance_voided_at','') is null;
  if hours<=0 then continue; end if;
  segments:=jsonb_build_array(jsonb_build_object('source_key','work:'||assignment.id||':base','kind','work','order_id',assignment.id,'trip_id',null,'people',to_jsonb(crew),'hours',hours,'order_revision',assignment.revision,'trip_revision',null));
  start_day:=assignment.date_from;start_hour:=0;
  for attempt in 1..2000 loop
   projected:=dlight_private.planner_place(segments,start_day,start_hour,crew,false);
   select (b->>'date')::date,(b->>'end')::numeric into busy_date,busy_end
    from jsonb_array_elements(projected) candidate cross join lateral jsonb_array_elements(candidate->'parts') p
    cross join lateral jsonb_array_elements(output) prior cross join lateral jsonb_array_elements(prior->'parts') b
    where p->>'date'=b->>'date' and (p->>'start')::numeric<(b->>'end')::numeric and (b->>'start')::numeric<(p->>'end')::numeric
     and exists(select 1 from jsonb_array_elements_text(prior->'people') x where x.value::uuid=any(crew))
    order by b->>'date',(b->>'end')::numeric limit 1;
   if not found then exit; end if;
   start_day:=busy_date;start_hour:=ceil(busy_end*4)/4;
  end loop;
  output:=output||projected;
 end loop;
 projected:='[]';
 for segment in select value from jsonb_array_elements(output) loop
  fingerprint:=md5((segment-'parts'-'order_revision'-'trip_revision')::text||coalesce((select round(sum((p->>'end')::numeric-(p->>'start')::numeric),6)::text from jsonb_array_elements(segment->'parts') p),''));
  segment:=segment||jsonb_build_object('auto_parts',segment->'parts','auto_people',segment->'people');
  select * into lay from public.planner_layouts where source_key=segment->>'source_key';
  if found and lay.manual then segment:=segment||jsonb_build_object('parts',lay.parts,'people',to_jsonb(lay.people),'manual',true,'stale',lay.basis<>fingerprint,'revision',lay.revision);
  else segment:=segment||jsonb_build_object('manual',false,'stale',false,'revision',coalesce(lay.revision,0)); end if;
  projected:=projected||jsonb_build_array(segment||jsonb_build_object('basis',fingerprint));
 end loop;
 return projected;
end $$;

create function dlight_private.planner_snapshot(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare groups jsonb; all_groups jsonb; durations jsonb;
begin
 if auth.uid() is null or public.user_role() is null then raise exception 'Нужно войти в приложение'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Выбери период не длиннее года'; end if;
 all_groups:=dlight_private.planner_project();
 select coalesce(jsonb_agg(g),'[]') into groups from jsonb_array_elements(all_groups) g where
  ((g->>'order_id' is not null and dlight_private.order_access((g->>'order_id')::uuid)) or (g->>'trip_id' is not null and dlight_private.responsibility_access('trip',(g->>'trip_id')::uuid)))
  and exists(select 1 from jsonb_array_elements(g->'parts') p where (p->>'date')::date between p_from and p_to);
 select coalesce(jsonb_object_agg(order_id,hours),'{}') into durations from (
  select g->>'order_id' order_id,sum((p->>'end')::numeric-(p->>'start')::numeric) hours
  from jsonb_array_elements(all_groups) g cross join lateral jsonb_array_elements(g->'parts') p
  where g->>'kind'='work' and dlight_private.order_access((g->>'order_id')::uuid) group by g->>'order_id'
 ) x;
 return jsonb_build_object('groups',groups,'order_plan_hours',durations);
end $$;

create function public.planner_snapshot(p_from date,p_to date) returns jsonb language sql security invoker set search_path='' as $$select dlight_private.planner_snapshot(p_from,p_to)$$;

-- Revoke helper execution; the public API explicitly checks identity and entity authority.
revoke all on function dlight_private.planner_window(uuid[],date,boolean),dlight_private.planner_place(jsonb,date,numeric,uuid[],boolean,jsonb),dlight_private.planner_project(),dlight_private.planner_snapshot(date,date),public.planner_snapshot(date,date) from public,anon,authenticated;
grant execute on function dlight_private.planner_snapshot(date,date),public.planner_snapshot(date,date) to authenticated;

create function dlight_private.planner_apply(p_operation uuid,p_changes jsonb,p_reason text,p_windows jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare projected jsonb; candidates jsonb:='[]'; change jsonb; base jsonb; part jsonb; old public.planner_layouts; saved public.planner_layouts;
 operation public.planner_operations; orderrow public.service_orders; triprow public.trips; source text; total numeric; expected_total numeric; offset_hours numeric; prev_end timestamp; at_start timestamp;
 manual boolean; people uuid[]; person uuid; part_ids text[]; changes_count integer; collision boolean; payload text; operation_result jsonb; result_rows jsonb:='[]'; bounds jsonb:='[]'; window_change jsonb; kind text; entity_id uuid; start_day date; end_day date; original_from date; original_to date; next_revision integer; original_origin date;
begin
 if auth.uid() is null or public.user_role() is null then raise exception 'Нужно войти в приложение'; end if;
 if p_operation is null or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 100 or jsonb_typeof(p_windows) is distinct from 'array' then raise exception 'Некорректное изменение графика'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Укажите действие с графиком'; end if;
 payload:=md5(p_changes::text||p_windows::text||p_reason);
 perform set_config('dlight.change_reason',p_reason,true);
 -- Serialize short shared-calendar edits to prevent cross-user conflict write skew.
 perform pg_advisory_xact_lock(19192026,2610);
 select * into operation from public.planner_operations where id=p_operation;
 if found then
  if operation.actor_id<>auth.uid() or operation.payload_hash<>payload then raise exception 'Идентификатор операции уже использован'; end if;
  return operation.result;
 end if;
 projected:=dlight_private.planner_project();
 select count(distinct x->>'source_key') into changes_count from jsonb_array_elements(p_changes) x;
 if changes_count<>jsonb_array_length(p_changes) then raise exception 'Брусок повторяется в операции'; end if;
 insert into public.planner_operations(id,actor_id,payload_hash,result) values(p_operation,auth.uid(),payload,'{}');
 for change in select value from jsonb_array_elements(p_changes) order by value->>'source_key' loop
  source:=change->>'source_key';select value into base from jsonb_array_elements(projected) where value->>'source_key'=source;
  if base is null then raise exception 'Исходное размещение изменилось. Обновите график'; end if;
  select * into old from public.planner_layouts where source_key=source for update;
  if coalesce(old.revision,0) is distinct from (change->>'expected_revision')::integer then raise exception 'Размещение изменено другим пользователем. Обновите график'; end if;
  manual:=coalesce((change->>'manual')::boolean,true);
  if manual and (base->>'stale')::boolean then raise exception 'Изменены состав или команда. Сначала обновите автоматическое размещение'; end if;
  if base->>'order_id' is not null then
   select * into orderrow from public.service_orders where id=(base->>'order_id')::uuid for update;
   if not dlight_private.responsibility_manager('order',orderrow.id) then raise exception 'Нет права изменять это задание'; end if;
   if orderrow.owner_id=auth.uid() and orderrow.curator_id is not null and orderrow.curator_id<>auth.uid() and length(trim(p_reason))<5 then raise exception 'Укажите причину вмешательства владельца'; end if;
   if orderrow.revision is distinct from (change->>'order_revision')::integer then raise exception 'Задание изменено другим пользователем. Обновите график'; end if;
   if orderrow.status in ('review','completed','cancelled') then raise exception 'Размещение переданного или завершённого задания защищено'; end if;
  end if;
  if base->>'trip_id' is not null then
   select * into triprow from public.trips where id=(base->>'trip_id')::uuid for update;
   if base->>'kind'='road' and not dlight_private.responsibility_manager('trip',triprow.id) then raise exception 'Нет права изменять дорогу этого выезда'; end if;
   if base->>'kind'='road' and triprow.owner_id=auth.uid() and triprow.curator_id is not null and triprow.curator_id<>auth.uid() and length(trim(p_reason))<5 then raise exception 'Укажите причину вмешательства владельца'; end if;
   if triprow.workbench_revision is distinct from (change->>'trip_revision')::integer then raise exception 'Выезд изменён другим пользователем. Обновите график'; end if;
   if triprow.deleted_at is not null or triprow.status in ('finished','done','cancelled') then raise exception 'Размещение завершённого выезда защищено'; end if;
  end if;
  if change->'people' is distinct from (case when manual then base->'people' else base->'auto_people' end) then raise exception 'Состав участников меняется в задании или выезде'; end if;
  if not manual then change:=change||jsonb_build_object('parts',base->'auto_parts','people',base->'auto_people'); end if;
  if jsonb_typeof(change->'parts') is distinct from 'array' or jsonb_array_length(change->'parts') not between 1 and 400 then raise exception 'Укажите части исходного бруска'; end if;
  total:=0;offset_hours:=0;prev_end:=null;part_ids:='{}';
  for part in select value from jsonb_array_elements(change->'parts') order by (value->>'offset')::numeric loop
   if jsonb_typeof(part) is distinct from 'object' or not (part ?& array['id','date','start','end','offset']) or exists(select 1 from unnest(array['id','date','start','end','offset']) k where part->>k is null) or length(part->>'id') not between 1 and 500 or part->>'id'=any(part_ids) or length(part->>'date')<>10 then raise exception 'Некорректная часть бруска'; end if;
   if to_char((part->>'date')::date,'YYYY-MM-DD')<>part->>'date' or (part->>'start')::numeric<0 or (part->>'end')::numeric>24 or (part->>'end')::numeric-(part->>'start')::numeric<=0 or abs((part->>'offset')::numeric-offset_hours)>.00001 then raise exception 'Некорректные дата, время или порядок частей'; end if;
   -- Existing minute-precision route durations survive quarter-hour drag/split operations.
   if mod((part->>'start')::numeric*4,1)<>0 and not exists(select 1 from jsonb_array_elements(base->'parts') p where p->>'date'=part->>'date' and abs((p->>'start')::numeric-(part->>'start')::numeric)<.00001) then raise exception 'Новое начало должно иметь шаг 15 минут'; end if;
   if (part->>'end')::numeric-(part->>'start')::numeric<.25 and not exists(select 1 from jsonb_array_elements(base->'parts') p where p->>'id'=part->>'id' and abs(((p->>'end')::numeric-(p->>'start')::numeric)-((part->>'end')::numeric-(part->>'start')::numeric))<.00001) then raise exception 'Новая часть должна быть не короче 15 минут'; end if;
   at_start:=(part->>'date')::date+make_interval(secs=>((part->>'start')::numeric*3600)::double precision);
   if prev_end is not null and at_start<prev_end then raise exception 'Продолжение должно идти после предыдущей части'; end if;
   prev_end:=at_start+make_interval(secs=>(((part->>'end')::numeric-(part->>'start')::numeric)*3600)::double precision);
   total:=total+(part->>'end')::numeric-(part->>'start')::numeric;offset_hours:=total;part_ids:=part_ids||(part->>'id');
  end loop;
  select sum((p->>'end')::numeric-(p->>'start')::numeric) into expected_total from jsonb_array_elements(case when manual then base->'parts' else base->'auto_parts' end) p;
  if abs(total-expected_total)>.00001 then raise exception 'Общая длительность исходного бруска должна сохраниться'; end if;
  candidates:=candidates||jsonb_build_array(base||jsonb_build_object('parts',change->'parts','people',change->'people','manual',manual));
 end loop;
 -- Check every participant against all placements, including records hidden by RLS or filters.
 select exists(
  select 1 from jsonb_array_elements(candidates) a cross join lateral jsonb_array_elements(a->'parts') ap
  cross join lateral jsonb_array_elements(projected||candidates) b cross join lateral jsonb_array_elements(b->'parts') bp
  where a->>'source_key'<>b->>'source_key'
   and (not exists(select 1 from jsonb_array_elements(candidates) c where c->>'source_key'=b->>'source_key') or b=any(array(select value from jsonb_array_elements(candidates))))
   and ap->>'date'=bp->>'date' and (ap->>'start')::numeric<(bp->>'end')::numeric-.000001 and (bp->>'start')::numeric<(ap->>'end')::numeric-.000001
   and exists(select 1 from jsonb_array_elements_text(a->'people') x join jsonb_array_elements_text(b->'people') y on x.value=y.value)
 ) into collision;
 if collision then raise exception 'Пересечение с работой или дорогой участника. Учитываются скрытые назначения'; end if;
 for change in select value from jsonb_array_elements(candidates) loop
  source:=change->>'source_key';select * into old from public.planner_layouts where source_key=source;select value into base from jsonb_array_elements(projected) where value->>'source_key'=source;
  select coalesce(array_agg(x::uuid),'{}') into people from jsonb_array_elements_text(change->'people') x;
  insert into public.planner_layouts(source_key,kind,order_id,trip_id,people,parts,manual,basis,updated_by)
   values(source,change->>'kind',(change->>'order_id')::uuid,(change->>'trip_id')::uuid,people,change->'parts',(change->>'manual')::boolean,change->>'basis',auth.uid())
   on conflict(source_key) do update set parts=excluded.parts,people=excluded.people,manual=excluded.manual,basis=excluded.basis,revision=public.planner_layouts.revision+1,updated_by=auth.uid(),updated_at=now() returning * into saved;
  insert into public.planner_layout_history(operation_id,source_key,actor_id,reason,before_plan,after_plan) values(p_operation,source,auth.uid(),p_reason,base,to_jsonb(saved));
  result_rows:=result_rows||jsonb_build_array(to_jsonb(saved));
 end loop;
 -- Trip calendar envelopes expand with moved parts. Actual trip timestamps remain untouched.
 for entity_id in select distinct (g->>'trip_id')::uuid from jsonb_array_elements(candidates) g where g->>'trip_id' is not null loop
  select * into triprow from public.trips where id=entity_id;
  select min((p->>'date')::date),max((p->>'date')::date) into start_day,end_day from jsonb_array_elements(candidates) g cross join lateral jsonb_array_elements(g->'parts') p where g->>'trip_id'=entity_id::text;
  if start_day<triprow.date_from or end_day>coalesce(triprow.date_to,triprow.date_from) then
   if triprow.status not in ('planned','assigned') or not dlight_private.responsibility_manager('trip',entity_id) then raise exception 'Расширение дат выезда доступно ответственному до начала выезда'; end if;
   select start_date into original_origin from dlight_private.planner_trip_origins where trip_id=entity_id;
   if start_day<triprow.date_from and nullif(triprow.day_plan#>>'{start,d}','') is null then
    insert into dlight_private.planner_trip_origins(trip_id,start_date) values(entity_id,triprow.date_from) on conflict do nothing;
   end if;
   update public.trips set date_from=least(date_from,start_day),date_to=greatest(coalesce(date_to,date_from),end_day),workbench_revision=workbench_revision+1 where id=entity_id returning workbench_revision into next_revision;
   bounds:=bounds||jsonb_build_array(jsonb_build_object('kind','trip','id',entity_id,'from',triprow.date_from,'to',triprow.date_to,'origin',original_origin,'expected_revision',next_revision));
  end if;
 end loop;
 for window_change in select value from jsonb_array_elements(p_windows) loop
  kind:=window_change->>'kind';entity_id:=(window_change->>'id')::uuid;start_day:=(window_change->>'from')::date;end_day:=coalesce((window_change->>'to')::date,start_day);
  if kind is distinct from 'trip' or start_day is null or end_day<start_day or not dlight_private.responsibility_manager('trip',entity_id) or not exists(select 1 from jsonb_array_elements(candidates) g where g->>'trip_id'=entity_id::text) then raise exception 'Некорректное восстановление периода выезда'; end if;
  select * into triprow from public.trips where id=entity_id for update;
  if triprow.status not in ('planned','assigned') or triprow.workbench_revision is distinct from (window_change->>'expected_revision')::integer then raise exception 'Период выезда уже изменён. Отмена недоступна'; end if;
  update public.trips set date_from=start_day,date_to=(window_change->>'to')::date,workbench_revision=workbench_revision+1 where id=entity_id;
  if window_change->>'origin' is null then delete from dlight_private.planner_trip_origins where trip_id=entity_id;
  else insert into dlight_private.planner_trip_origins values(entity_id,(window_change->>'origin')::date) on conflict(trip_id) do update set start_date=excluded.start_date; end if;
  if exists(select 1 from jsonb_array_elements(dlight_private.planner_project()) g cross join lateral jsonb_array_elements(g->'parts') p where g->>'trip_id'=entity_id::text and ((p->>'date')::date<start_day or (p->>'date')::date>end_day)) then raise exception 'Вне восстанавливаемого периода остались части выезда'; end if;
 end loop;
 -- Recheck the final projection after envelope changes and undo. All writes roll back together.
 projected:=dlight_private.planner_project();
 if exists(select 1 from jsonb_array_elements(projected) a cross join lateral jsonb_array_elements(a->'parts') ap
  cross join lateral jsonb_array_elements(projected) b cross join lateral jsonb_array_elements(b->'parts') bp
  where a->>'source_key'<>b->>'source_key' and exists(select 1 from jsonb_array_elements(candidates) c where c->>'source_key'=a->>'source_key')
   and ap->>'date'=bp->>'date' and (ap->>'start')::numeric<(bp->>'end')::numeric-.000001 and (bp->>'start')::numeric<(ap->>'end')::numeric-.000001
   and exists(select 1 from jsonb_array_elements_text(a->'people') x join jsonb_array_elements_text(b->'people') y on x.value=y.value)) then raise exception 'Пересечение после изменения периода выезда'; end if;
 operation_result:=jsonb_build_object('layouts',result_rows,'restore_windows',bounds);
 update public.planner_operations set result=operation_result where id=p_operation;
 return operation_result;
end $$;
create function public.planner_apply(p_operation uuid,p_changes jsonb,p_reason text,p_windows jsonb default '[]') returns jsonb language sql security invoker set search_path='' as $$select dlight_private.planner_apply(p_operation,p_changes,p_reason,p_windows)$$;
revoke all on function dlight_private.planner_apply(uuid,jsonb,text,jsonb),public.planner_apply(uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.planner_apply(uuid,jsonb,text,jsonb),public.planner_apply(uuid,jsonb,text,jsonb) to authenticated;

-- Preserve the existing saved clocks as explicit canonical placements at cutover.
-- No task is completed and no measured fact is reconstructed by this migration.
insert into public.planner_layouts(source_key,kind,order_id,trip_id,people,parts,manual,basis)
select g->>'source_key',g->>'kind',(g->>'order_id')::uuid,(g->>'trip_id')::uuid,
 array(select x::uuid from jsonb_array_elements_text(g->'people') x),g->'parts',true,g->>'basis'
from jsonb_array_elements(dlight_private.planner_project()) g
join public.trips t on t.id=(g->>'trip_id')::uuid
where t.day_plan is not null and t.day_plan<>'{}'::jsonb and jsonb_array_length(g->'parts')>0
on conflict(source_key) do nothing;
