-- Keep the original route/legacy-clock projection as the automatic baseline.
-- Saved anchors drive the effective sequence; new automatic tasks follow the
-- actual end of preceding work. Reads and collision validation share this code.
alter function dlight_private.planner_project() rename to planner_project_baseline;
create function dlight_private.planner_project()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare raw jsonb; output jsonb:='[]'; g jsonb; placed jsonb; parts jsonb; item jsonb; last_part jsonb; first_part jsonb; old_part jsonb;
 crew uuid[]; previous_trip text:=null; cursor_date date; clock numeric:=0; seen_manual boolean:=false; previous_auto boolean:=false; shift_manual boolean; hours numeric; busy_date date; busy_end numeric; attempt integer; baseline_parts jsonb;
begin
 raw:=dlight_private.planner_project_baseline();
 for g in select value from jsonb_array_elements(raw) loop
  baseline_parts:=g->'auto_parts';
  if g->>'trip_id' is not null then
   if previous_trip is distinct from g->>'trip_id' then previous_trip:=g->>'trip_id';cursor_date:=null;clock:=0;seen_manual:=false;previous_auto:=false;end if;
   crew:=array(select x::uuid from jsonb_array_elements_text(g->'auto_people') x);
   select value into first_part from jsonb_array_elements(baseline_parts) order by (value->>'offset')::numeric limit 1;
   if cursor_date is null then cursor_date:=(first_part->>'date')::date;clock:=(first_part->>'start')::numeric;end if;
   -- An unmodified route keeps its imported gaps and minute-precision clock.
   if seen_manual then
    if (first_part->>'date')::date>cursor_date then cursor_date:=(first_part->>'date')::date;clock:=(first_part->>'start')::numeric;elsif (first_part->>'date')::date=cursor_date then clock:=greatest(clock,(first_part->>'start')::numeric);end if;
    select sum((x->>'end')::numeric-(x->>'start')::numeric) into hours from jsonb_array_elements(baseline_parts) x;
    placed:=dlight_private.planner_place(jsonb_build_array((g-'parts')||jsonb_build_object('hours',hours)),cursor_date,clock,crew,false);
    g:=g||jsonb_build_object('auto_parts',placed->0->'parts');
    if not (g->>'manual')::boolean then g:=g||jsonb_build_object('parts',placed->0->'parts');end if;
   end if;
   select value into first_part from jsonb_array_elements(g->'parts') order by (value->>'offset')::numeric limit 1;
   shift_manual:=(g->>'manual')::boolean and seen_manual and ((first_part->>'date')::date<cursor_date or (first_part->>'date')::date=cursor_date and (first_part->>'start')::numeric<clock-.000001) and exists(select 1 from jsonb_array_elements(output) prior cross join lateral jsonb_array_elements(prior->'parts') a cross join jsonb_array_elements(g->'parts') b where prior->>'trip_id'=g->>'trip_id' and a->>'date'=b->>'date' and (a->>'start')::numeric<(b->>'end')::numeric-.000001 and (b->>'start')::numeric<(a->>'end')::numeric-.000001 and exists(select 1 from jsonb_array_elements_text(prior->'people') x where x.value::uuid=any(crew)));
   if shift_manual then
    parts:='[]';
    for old_part in select value from jsonb_array_elements(g->'parts') order by (value->>'offset')::numeric loop
     if (old_part->>'date')::date>cursor_date then cursor_date:=(old_part->>'date')::date;clock:=(old_part->>'start')::numeric;
     elsif (old_part->>'date')::date=cursor_date then clock:=greatest(clock,(old_part->>'start')::numeric);end if;
     placed:=dlight_private.planner_place(jsonb_build_array((g-'parts')||jsonb_build_object('hours',(old_part->>'end')::numeric-(old_part->>'start')::numeric)),cursor_date,clock,crew,false);
     for item in select value from jsonb_array_elements(placed->0->'parts') loop
      parts:=parts||jsonb_build_array(old_part||item||jsonb_build_object('id',case when (item->>'offset')::numeric=0 then old_part->>'id' else left(old_part->>'id',120)||':sequence:'||(item->>'offset') end,'offset',(old_part->>'offset')::numeric+(item->>'offset')::numeric));
     end loop;
     select value into last_part from jsonb_array_elements(parts) order by (value->>'offset')::numeric desc limit 1;cursor_date:=(last_part->>'date')::date;clock:=(last_part->>'end')::numeric;
    end loop;
    g:=g||jsonb_build_object('parts',parts);
   end if;
   select value into last_part from jsonb_array_elements(g->'parts') order by value->>'date' desc,(value->>'end')::numeric desc limit 1;
   cursor_date:=(last_part->>'date')::date;clock:=(last_part->>'end')::numeric;
   previous_auto:=not (g->>'manual')::boolean;seen_manual:=seen_manual or (g->>'manual')::boolean;
   g:=g||jsonb_build_object('trip_auto_parts',baseline_parts);
  elsif not (g->>'manual')::boolean then
   -- Unlinked automatic tasks also account for the effective trip sequence.
   crew:=array(select x::uuid from jsonb_array_elements_text(g->'people') x);
   select value into first_part from jsonb_array_elements(g->'parts') order by (value->>'offset')::numeric limit 1;
   cursor_date:=(first_part->>'date')::date;clock:=(first_part->>'start')::numeric;
   select sum((x->>'end')::numeric-(x->>'start')::numeric) into hours from jsonb_array_elements(g->'parts') x;
   for attempt in 1..2000 loop
    placed:=dlight_private.planner_place(jsonb_build_array((g-'parts')||jsonb_build_object('hours',hours)),cursor_date,clock,crew,false);
    select (b->>'date')::date,(b->>'end')::numeric into busy_date,busy_end
     from jsonb_array_elements(placed->0->'parts') a cross join jsonb_array_elements(output) prior cross join lateral jsonb_array_elements(prior->'parts') b
     where a->>'date'=b->>'date' and (a->>'start')::numeric<(b->>'end')::numeric and (b->>'start')::numeric<(a->>'end')::numeric and exists(select 1 from jsonb_array_elements_text(prior->'people') x where x.value::uuid=any(crew))
     order by b->>'date',(b->>'end')::numeric limit 1;
    if not found then exit;end if;cursor_date:=busy_date;clock:=ceil(busy_end*4)/4;
   end loop;
   g:=g||jsonb_build_object('parts',placed->0->'parts','auto_parts',placed->0->'parts');
  end if;
  g:=g||jsonb_build_object('placement_token',md5((g->'parts')::text||(g->'people')::text));output:=output||jsonb_build_array(g);
 end loop;
 return output;
end $$;
revoke all on function dlight_private.planner_project(),dlight_private.planner_project_baseline() from public,anon,authenticated;

create or replace function dlight_private.planner_snapshot(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare groups jsonb; all_groups jsonb; durations jsonb;
begin
 if auth.uid() is null or public.user_role() is null then raise exception 'Нужно войти в приложение'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Выбери период не длиннее года'; end if;
 all_groups:=dlight_private.planner_project();
 select coalesce(jsonb_agg(g),'[]') into groups from jsonb_array_elements(all_groups) g where
  ((g->>'order_id' is not null and dlight_private.order_access((g->>'order_id')::uuid)) or (g->>'trip_id' is not null and dlight_private.responsibility_access('trip',(g->>'trip_id')::uuid)))
  and (exists(select 1 from jsonb_array_elements(g->'parts') p where (p->>'date')::date between p_from and p_to) or g->>'trip_id' is not null and exists(select 1 from jsonb_array_elements(all_groups) peer cross join lateral jsonb_array_elements(peer->'parts') p where peer->>'trip_id'=g->>'trip_id' and (p->>'date')::date between p_from and p_to));
 select coalesce(jsonb_object_agg(order_id,hours),'{}') into durations from (
  select g->>'order_id' order_id,sum((p->>'end')::numeric-(p->>'start')::numeric) hours
  from jsonb_array_elements(all_groups) g cross join lateral jsonb_array_elements(g->'parts') p
  where g->>'kind'='work' and dlight_private.order_access((g->>'order_id')::uuid) group by g->>'order_id'
 ) x;
 return jsonb_build_object('groups',groups,'order_plan_hours',durations);
end $$;

create or replace function dlight_private.planner_apply(p_operation uuid,p_changes jsonb,p_reason text,p_windows jsonb default '[]')
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
  if base->>'placement_token' is distinct from change->>'placement_token' then raise exception 'Автоматическое размещение изменилось. Обновите график'; end if;
  manual:=coalesce((change->>'manual')::boolean,true);
  if manual and (base->>'stale')::boolean and base->'people' is distinct from base->'auto_people' then raise exception 'Изменены состав или команда. Сначала обновите автоматическое размещение'; end if;
  if base->>'order_id' is not null then
   select * into orderrow from public.service_orders where id=(base->>'order_id')::uuid for update;
   if not dlight_private.responsibility_manager('order',orderrow.id) then raise exception 'Нет права изменять это задание'; end if;
   if orderrow.owner_id=auth.uid() and orderrow.curator_id is not null and orderrow.curator_id<>auth.uid() and length(trim(p_reason))<5 then raise exception 'Укажите причину вмешательства владельца'; end if;
   if orderrow.revision is distinct from (change->>'order_revision')::integer then raise exception 'Задание изменено другим пользователем. Обновите график'; end if;
   if orderrow.status='cancelled' then raise exception 'Отменённое задание недоступно для размещения'; end if;
  end if;
  if base->>'trip_id' is not null then
   select * into triprow from public.trips where id=(base->>'trip_id')::uuid for update;
   if base->>'kind'='road' and not dlight_private.responsibility_manager('trip',triprow.id) then raise exception 'Нет права изменять дорогу этого выезда'; end if;
   if base->>'kind'='road' and triprow.owner_id=auth.uid() and triprow.curator_id is not null and triprow.curator_id<>auth.uid() and length(trim(p_reason))<5 then raise exception 'Укажите причину вмешательства владельца'; end if;
   if triprow.workbench_revision is distinct from (change->>'trip_revision')::integer then raise exception 'Выезд изменён другим пользователем. Обновите график'; end if;
   if triprow.deleted_at is not null or triprow.status='cancelled' then raise exception 'Отменённый выезд недоступен для размещения'; end if;
  end if;
  if change->'people' is distinct from (case when manual then base->'people' else base->'auto_people' end) then raise exception 'Состав участников меняется в задании или выезде'; end if;
  if coalesce((change->>'reset_trip')::boolean,false) and (manual or base->>'trip_id' is null or exists(select 1 from jsonb_array_elements(projected) g where g->>'trip_id'=base->>'trip_id' and not exists(select 1 from jsonb_array_elements(p_changes) c where c->>'source_key'=g->>'source_key' and c->>'manual'='false' and c->>'reset_trip'='true'))) then raise exception 'Для сброса выберите весь выезд, включая скрытые бруски'; end if;
  if not manual then change:=change||jsonb_build_object('parts',case when coalesce((change->>'reset_trip')::boolean,false) then coalesce(base->'trip_auto_parts',base->'auto_parts') else base->'auto_parts' end,'people',base->'auto_people'); end if;
  if jsonb_typeof(change->'parts') is distinct from 'array' or jsonb_array_length(change->'parts') not between 1 and 400 then raise exception 'Укажите части исходного бруска'; end if;
  total:=0;offset_hours:=0;prev_end:=null;part_ids:='{}';
  for part in select value from jsonb_array_elements(change->'parts') order by (value->>'offset')::numeric loop
   if jsonb_typeof(part) is distinct from 'object' or not (part ?& array['id','date','start','end','offset']) or exists(select 1 from unnest(array['id','date','start','end','offset']) k where part->>k is null) or length(part->>'id') not between 1 and 500 or part->>'id'=any(part_ids) or length(part->>'date')<>10 then raise exception 'Некорректная часть бруска'; end if;
   if to_char((part->>'date')::date,'YYYY-MM-DD')<>part->>'date' or (part->>'start')::numeric<0 or (part->>'end')::numeric>24 or (part->>'end')::numeric-(part->>'start')::numeric<=0 or abs((part->>'offset')::numeric-offset_hours)>.00001 then raise exception 'Некорректные дата, время или порядок частей'; end if;
   -- Existing minute-precision route durations survive quarter-hour drag/split operations.
   if manual and mod((part->>'start')::numeric*4,1)<>0 and not exists(select 1 from jsonb_array_elements(base->'parts') p where p->>'date'=part->>'date' and abs((p->>'start')::numeric-(part->>'start')::numeric)<.00001) then raise exception 'Новое начало должно иметь шаг 15 минут'; end if;
   if manual and (part->>'end')::numeric-(part->>'start')::numeric<.25 and not exists(select 1 from jsonb_array_elements(base->'parts') p where p->>'id'=part->>'id' and abs(((p->>'end')::numeric-(p->>'start')::numeric)-((part->>'end')::numeric-(part->>'start')::numeric))<.00001) then raise exception 'Новая часть должна быть не короче 15 минут'; end if;
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
  if triprow.status in ('planned','assigned') and (start_day<triprow.date_from or end_day>coalesce(triprow.date_to,triprow.date_from)) then
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
 select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('parts',g->'parts','people',g->'people','trip_revision',g->'trip_revision','order_revision',g->'order_revision','placement_token',g->'placement_token') order by l.source_key),'[]') into result_rows
 from public.planner_layouts l join jsonb_array_elements(projected) g on g->>'source_key'=l.source_key
 where exists(select 1 from jsonb_array_elements(candidates) c where c->>'source_key'=l.source_key);
 update public.planner_layout_history h set after_plan=r.value from jsonb_array_elements(result_rows) r where h.operation_id=p_operation and h.source_key=r.value->>'source_key';
 operation_result:=jsonb_build_object('layouts',result_rows,'restore_windows',bounds);
 update public.planner_operations set result=operation_result where id=p_operation;
 return operation_result;
end $$;
