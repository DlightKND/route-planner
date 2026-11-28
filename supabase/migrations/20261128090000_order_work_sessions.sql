-- Work without a trip (mockup v65). A task done in the workshop or remotely gets a
-- "work session": actual labour in person-hours plus the basis of manual accounting.
-- The session then takes the place of a trip in the per-work report: the same
-- result versions, review, acceptance, corrections, parts and photos. It is never a
-- trip, so mileage, GPS, road costs, the trips list and the planner stay untouched.
--
-- order_trip_result_versions.trip_id has no foreign key, so it holds either a trip
-- id or a session id ("visit").

create table dlight_private.order_work_sessions(
  id uuid primary key,
  order_id uuid not null references public.service_orders(id) on delete cascade,
  work_date date not null,
  hours numeric not null check (hours > 0 and hours <= 10000 and hours = round(hours, 2)),
  basis text not null check (length(btrim(basis)) between 5 and 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revision integer not null default 1
);
create index order_work_sessions_order_idx on dlight_private.order_work_sessions(order_id);
alter table dlight_private.order_work_sessions enable row level security;

create function dlight_private.order_visit_is_session(p_order uuid, p_visit uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from dlight_private.order_work_sessions s where s.id = p_visit and s.order_id = p_order)
$$;

-- A session belongs to its task: task access is the access. A trip keeps its own check.
create function dlight_private.order_visit_access(p_order uuid, p_visit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select dlight_private.order_visit_is_session(p_order, p_visit)
    or coalesce(dlight_private.responsibility_access('trip', p_visit), false)
$$;

create function dlight_private.order_session_presence(p_session dlight_private.order_work_sessions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('confirmed', true, 'no_work', false, 'base', p_session.hours, 'used', 0, 'available', p_session.hours)
$$;

-- Creating a session: the executor or the curator of a running task.
create function public.service_order_work_session_create(p_order uuid, p_hours numeric, p_basis text, p_date date, p_operation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.service_orders;
  existing dlight_private.order_work_sessions;
  basis text := btrim(coalesce(p_basis, ''));
begin
  if dlight_private.order_access(p_order) is not true then raise exception 'Нет доступа к заданию'; end if;
  select * into o from public.service_orders where id = p_order for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if not (coalesce(dlight_private.responsibility_manager('order', p_order), false) or auth.uid() = any(o.engineer_ids)) then
    raise exception 'Отчитывается исполнитель или куратор задания';
  end if;
  if p_operation is null then raise exception 'Некорректный отчёт'; end if;
  select * into existing from dlight_private.order_work_sessions where id = p_operation;
  if found then
    if existing.order_id <> p_order or existing.created_by <> auth.uid() then raise exception 'Идентификатор отчёта уже использован'; end if;
    return existing.id;
  end if;
  if o.status not in ('in_progress', 'paused', 'review') then raise exception 'Отчитаться можно по заданию в работе'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 10000 or p_hours <> round(p_hours, 2) then
    raise exception 'Укажите фактический труд, чел·ч';
  end if;
  if length(basis) < 5 or length(basis) > 1000 then raise exception 'Укажите основание ручного учёта'; end if;
  if p_date is null or p_date > (now() at time zone 'Europe/Kyiv')::date or p_date < date '2020-01-01' then
    raise exception 'Проверьте дату работы';
  end if;
  insert into dlight_private.order_work_sessions(id, order_id, work_date, hours, basis, created_by)
    values (p_operation, p_order, p_date, p_hours, basis, auth.uid());
  return p_operation;
end $$;

-- A session created by mistake can be removed until a result is reported on it.
create function public.service_order_work_session_delete(p_order uuid, p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s dlight_private.order_work_sessions;
begin
  if dlight_private.order_access(p_order) is not true then raise exception 'Нет доступа к заданию'; end if;
  perform 1 from public.service_orders where id = p_order for update;
  select * into s from dlight_private.order_work_sessions where id = p_session and order_id = p_order for update;
  if not found then raise exception 'Работа без поездки не найдена'; end if;
  if not (coalesce(dlight_private.responsibility_manager('order', p_order), false) or s.created_by = auth.uid()) then
    raise exception 'Удаляет автор или куратор задания';
  end if;
  if exists(select 1 from dlight_private.order_trip_result_versions v where v.order_id = p_order and v.trip_id = p_session) then
    raise exception 'По этой работе уже есть отчёт';
  end if;
  delete from dlight_private.order_work_sessions where id = p_session;
end $$;

revoke all on function public.service_order_work_session_create(uuid, numeric, text, date, uuid) from public, anon;
revoke all on function public.service_order_work_session_delete(uuid, uuid) from public, anon;
grant execute on function public.service_order_work_session_create(uuid, numeric, text, date, uuid) to authenticated;
grant execute on function public.service_order_work_session_delete(uuid, uuid) to authenticated;
revoke all on function dlight_private.order_visit_is_session(uuid, uuid) from public, anon, authenticated;
revoke all on function dlight_private.order_visit_access(uuid, uuid) from public, anon, authenticated;
revoke all on function dlight_private.order_session_presence(dlight_private.order_work_sessions) from public, anon, authenticated;

-- Writing a result: the visit is a trip or a session of the task.
create or replace function dlight_private.order_trip_result_write(p_order uuid, p_trip uuid, p_order_revision integer, p_trip_revision integer, p_expected_event uuid, p_operation uuid, p_action text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  receipt jsonb;
  photos jsonb;
  already_recorded boolean;
begin
  if dlight_private.order_access(p_order) is not true or dlight_private.order_visit_access(p_order, p_trip) is not true then
    raise exception 'Нет доступа к заданию или выезду';
  end if;
  perform 1 from public.trips where id = p_trip for update;
  select exists(select 1 from dlight_private.order_trip_result_versions where operation_id = p_operation)
    into already_recorded;
  receipt := dlight_private.order_trip_result_write_with_parts(p_order,p_trip,p_order_revision,p_trip_revision,
    p_expected_event,p_operation,p_action,p_result);
  if already_recorded or p_action = 'returned' then return receipt; end if;
  if p_result ? 'photos' then
    photos := dlight_private.register_order_result_photos(p_order,p_trip,p_result->'photos');
  else
    select payload->'photos' into photos from dlight_private.order_trip_result_versions
      where operation_id = p_expected_event and order_id = p_order and trip_id = p_trip;
    if photos is null then return receipt; end if;
  end if;
  update dlight_private.order_trip_result_versions set payload = payload || jsonb_build_object('photos',photos)
    where operation_id = p_operation;
  return receipt;
end $function$;

do $$
declare d text;
begin
  d := pg_get_functiondef('dlight_private.order_trip_result_write_with_parts(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)'::regprocedure);
  if (length(d) - length(replace(d, 'dlight_private.responsibility_access(''trip'',p_trip) is not true', ''))) / length('dlight_private.responsibility_access(''trip'',p_trip) is not true') <> 1 then
    raise exception 'write_with_parts: unexpected access check';
  end if;
  execute replace(d, 'dlight_private.responsibility_access(''trip'',p_trip) is not true',
    'dlight_private.order_visit_access(p_order,p_trip) is not true');
end $$;

create or replace function dlight_private.order_trip_result_write_core(p_order uuid, p_trip uuid, p_order_revision integer, p_trip_revision integer, p_expected_event uuid, p_operation uuid, p_action text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  t public.trips; o public.service_orders; item public.service_order_items;
  s dlight_private.order_work_sessions;
  latest dlight_private.order_trip_result_versions; accepted dlight_private.order_trip_result_versions;
  retry dlight_private.order_trip_result_versions;
  is_manager boolean; request_id uuid; fingerprint text; event_id uuid;
  revision integer; presence jsonb; available numeric; hours numeric:=0;
  used numeric:=0; quantity numeric; item_hours numeric; other_qty numeric;
  row jsonb; previous jsonb; note text; reason text; correction text;
  entered jsonb:='[]'::jsonb; aggregate_items jsonb:='[]'::jsonb; snapshot jsonb;
  is_session boolean; visit_revision integer; visit_date date; visit_label text;
begin
  if dlight_private.order_access(p_order) is not true or dlight_private.order_visit_access(p_order,p_trip) is not true then
    raise exception 'Нет доступа к заданию или выезду';
  end if;
  if p_operation is null or p_action is null or p_action not in ('submitted','accepted','returned')
    or jsonb_typeof(p_result) is distinct from 'object' then raise exception 'Некорректный результат'; end if;
  is_manager:=dlight_private.responsibility_manager('order',p_order);
  if p_action in ('accepted','returned') and not is_manager then raise exception 'Принимает результат куратор задания'; end if;
  is_session:=dlight_private.order_visit_is_session(p_order,p_trip);
  -- GPS and trip-link edits already lock the trip first. The next two locks
  -- follow the order used for task finance, cumulative results and remainder.
  if is_session then
    select * into s from dlight_private.order_work_sessions where id=p_trip and order_id=p_order for update;
    visit_revision:=s.revision;visit_date:=s.work_date;visit_label:='Работа без поездки';
  else
    select * into t from public.trips where id=p_trip for update;
    if not found then raise exception 'Выезд не найден'; end if;
    visit_revision:=t.workbench_revision;visit_date:=(coalesce(t.finished_at,now()) at time zone 'Europe/Kyiv')::date;visit_label:=t.vehicle_label;
  end if;
  select job_id into request_id from public.service_orders where id=p_order;
  perform 1 from public.jobs where id=request_id and deleted_at is null for update;
  if not found then raise exception 'Заявка задания недоступна'; end if;
  select * into o from public.service_orders where id=p_order for update;
  if not found or o.job_id is distinct from request_id then raise exception 'Задание изменилось. Обновите карточку'; end if;
  if not is_manager and not (auth.uid()=any(o.engineer_ids)) then raise exception 'Передаёт результат исполнитель задания'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('order',p_order,'trip',p_trip,
    'action',p_action,'result',p_result)::text,'UTF8')),'hex');
  select * into retry from dlight_private.order_trip_result_versions where operation_id=p_operation;
  if found then
    if retry.actor_id<>auth.uid() or retry.fingerprint<>fingerprint then
      raise exception 'Идентификатор отправки уже использован для другого результата';
    end if;
    return jsonb_build_object('event',p_operation,'revision',retry.order_revision);
  end if;
  if not is_session and (t.deleted_at is not null or not exists(select 1 from public.trip_service_orders l where l.trip_id=p_trip and l.order_id=p_order)) then
    raise exception 'Выезд больше не связан с заданием';
  end if;
  if o.status not in ('in_progress','paused','review') or (not is_session and t.status='cancelled') then
    raise exception 'Задание или выезд доступны только для просмотра';
  end if;
  select * into latest from dlight_private.order_trip_result_versions where order_id=p_order and trip_id=p_trip order by sequence desc limit 1;
  select * into accepted from dlight_private.order_trip_result_versions where order_id=p_order and trip_id=p_trip and state='accepted' order by sequence desc limit 1;
  if p_expected_event is distinct from latest.operation_id or p_order_revision is distinct from o.revision then
    raise exception 'Данные задания изменились. Обновите результат' using errcode='40001';
  end if;
  if p_action='submitted' and (latest.state='submitted' or accepted.sequence is not null) then
    raise exception 'Этот результат уже передан на приёмку или принят';
  end if;
  reason:=btrim(coalesce(p_result->>'reason',''));
  correction:=btrim(coalesce(p_result->>'correction',''));
  if length(reason)>1000 or length(correction)>1000 then raise exception 'Причина слишком длинная'; end if;
  revision:=o.revision;
  if p_action='returned' then
    if latest.state is distinct from 'submitted' or correction='' then
      raise exception 'Укажите причину возврата результата, ожидающего приёмку';
    end if;
    snapshot:=latest.payload||jsonb_build_object('correction',correction);
  else
    if p_trip_revision is distinct from visit_revision then
      raise exception 'Данные GPS изменились. Обновите предложенные часы' using errcode='40001';
    end if;
    if is_session then
      presence:=dlight_private.order_session_presence(s);
    else
      presence:=dlight_private.order_trip_presence(p_trip,request_id,p_order);
      if t.status not in ('finished','done') or not (presence->>'confirmed')::boolean then
        raise exception 'Сначала завершите выезд и подтвердите рабочие посещения в GPS-журнале';
      end if;
    end if;
    if accepted.sequence is not null and correction='' then raise exception 'Для исправления принятой версии нужна причина'; end if;
    available:=(presence->>'available')::numeric;
    if jsonb_typeof(p_result->'items') is distinct from 'array'
      or jsonb_array_length(p_result->'items')=0
      or jsonb_array_length(p_result->'items')<>(select count(*) from public.service_order_items i
        where i.order_id=p_order and i.request_finance_void_event_id is null
          and i.legacy_snapshot->>'request_finance_voided_at' is null)
      or jsonb_array_length(p_result->'items')<>(select count(distinct x->>'id') from jsonb_array_elements(p_result->'items') x)
    then raise exception 'Состав работ изменился. Обновите карточку'; end if;
    for row in select value from jsonb_array_elements(p_result->'items') loop
      select * into item from public.service_order_items i where i.order_id=p_order and i.id=(row->>'id')::uuid
        and i.request_finance_void_event_id is null and i.legacy_snapshot->>'request_finance_voided_at' is null;
      if not found then raise exception 'Строка не принадлежит заданию'; end if;
      if jsonb_typeof(row->'qty') is distinct from 'number' or jsonb_typeof(row->'hours') is distinct from 'number'
        then raise exception 'Укажите выполненный объём и трудозатраты'; end if;
      quantity:=(row->>'qty')::numeric;
      item_hours:=(row->>'hours')::numeric;
      note:=btrim(coalesce(row->>'note',''));
      select x into previous from jsonb_array_elements(accepted.payload->'items') x where x->>'id'=item.id::text;
      other_qty:=item.done_qty-coalesce((previous->>'qty')::numeric,0);
      if other_qty<0 or quantity<0 or quantity>item.planned_qty-item.transferred_qty-other_qty then
        raise exception 'Выполненный объём превышает остаток: %',item.title;
      end if;
      if item_hours<0 or item_hours>10000 or item_hours<>round(item_hours,2)
        or (item.kind='material' and item_hours<>0) or length(note)>4000 then
        raise exception 'Проверьте трудозатраты и комментарий: %',item.title;
      end if;
      if coalesce(item.kind,'work')='work' and quantity<item.planned_qty-item.transferred_qty-other_qty
        and (quantity>0 or item_hours>0) and note='' then raise exception 'Укажите, что осталось сделать: %',item.title; end if;
      hours:=hours+item_hours;
      entered:=entered||jsonb_build_array(jsonb_build_object('id',item.id,'kind',item.kind,'title',item.title,'unit',item.unit,
        'qty',quantity,'hours',item_hours,'note',note,'result_note',note,'planned_qty',item.planned_qty,'done_qty',quantity));
      aggregate_items:=aggregate_items||jsonb_build_array(jsonb_build_object('id',item.id,'done_qty',other_qty+quantity,'result_note',item.result_note));
    end loop;
    if hours<>available and reason='' then raise exception 'Укажите причину ручной корректировки трудозатрат'; end if;
    snapshot:=jsonb_build_object('items',entered,'hours',hours,'reason',reason,'correction',correction);
    if is_session then snapshot:=snapshot||jsonb_build_object('standalone',true,'basis',s.basis,'session_hours',s.hours); end if;
    if p_action='accepted' then
      revision:=dlight_private.order_result_apply_totals(p_order,p_order_revision,aggregate_items,o.result_note);
      used:=least(available,hours);
      insert into public.service_order_result_events(order_id,actor_id,actual_date,operation_id,request_digest,revision,snapshot)
        values(p_order,auth.uid(),visit_date,
          p_operation,fingerprint,revision,snapshot||jsonb_build_object('title',o.title,'number',o.number,
            'trip_id',p_trip,'trip_label',visit_label)) returning id into event_id;
    end if;
  end if;
  insert into dlight_private.order_trip_result_versions(order_id,trip_id,operation_id,actor_id,state,trip_revision,
    order_revision,payload,presence_used,fingerprint,activity_id)
  values(p_order,p_trip,p_operation,auth.uid(),p_action,visit_revision,revision,snapshot,used,fingerprint,event_id);
  return jsonb_build_object('event',p_operation,'revision',revision);
end $function$;

-- Reading: sessions join the task's visits, marked standalone.
create or replace function dlight_private.order_trip_result_read(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb; sessions jsonb; accepted_hours jsonb; o public.service_orders;
begin
  if not dlight_private.order_access(p_order) then raise exception 'Нет доступа к заданию'; end if;
  select * into o from public.service_orders where id=p_order;
  if not found then raise exception 'Задание не найдено'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'date_from',t.date_from,'date_to',t.date_to,
    'label',t.vehicle_label,'status',t.status,'revision',t.workbench_revision,
    'linked',not (t.deleted_at is not null) and exists(
      select 1 from public.trip_service_orders l where l.trip_id=t.id and l.order_id=p_order),
    'presence',dlight_private.order_trip_presence(t.id,o.job_id,p_order),
    'state',recent.state,'event',recent.operation_id,'submitted_revision',recent.trip_revision,
    'latest',recent.payload,'versions',coalesce(accepted.versions,'[]'::jsonb)
  ) order by t.date_from nulls last,t.id),'[]'::jsonb) into result
  from public.trips t
  left join lateral (
    select v.state,v.operation_id,v.trip_revision,v.payload
    from dlight_private.order_trip_result_versions v where v.order_id=p_order and v.trip_id=t.id
    order by v.sequence desc limit 1
  ) recent on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('at',v.recorded_at,'actor',v.actor_id,
      'event',v.operation_id,'result',v.payload) order by v.sequence) as versions
    from dlight_private.order_trip_result_versions v
    where v.order_id=p_order and v.trip_id=t.id and v.state='accepted'
  ) accepted on true
  where dlight_private.responsibility_access('trip',t.id)
    and ((t.deleted_at is null and exists(select 1 from public.trip_service_orders l
       where l.trip_id=t.id and l.order_id=p_order)) or recent.operation_id is not null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'date_from',s.work_date,'date_to',s.work_date,
    'label','Работа без поездки','status','finished','revision',s.revision,'linked',true,
    'standalone',true,'basis',s.basis,'hours',s.hours,'created_by',s.created_by,
    'presence',dlight_private.order_session_presence(s),
    'state',recent.state,'event',recent.operation_id,'submitted_revision',recent.trip_revision,
    'latest',recent.payload,'versions',coalesce(accepted.versions,'[]'::jsonb)
  ) order by s.work_date,s.created_at,s.id),'[]'::jsonb) into sessions
  from dlight_private.order_work_sessions s
  left join lateral (
    select v.state,v.operation_id,v.trip_revision,v.payload
    from dlight_private.order_trip_result_versions v where v.order_id=p_order and v.trip_id=s.id
    order by v.sequence desc limit 1
  ) recent on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('at',v.recorded_at,'actor',v.actor_id,
      'event',v.operation_id,'result',v.payload) order by v.sequence) as versions
    from dlight_private.order_trip_result_versions v
    where v.order_id=p_order and v.trip_id=s.id and v.state='accepted'
  ) accepted on true
  where s.order_id=p_order;
  select coalesce(jsonb_object_agg(item_id,hours),'{}'::jsonb) into accepted_hours
  from (
    select item->>'id' item_id,sum((item->>'hours')::numeric) hours
    from (
      select distinct on (v.trip_id) v.payload
      from dlight_private.order_trip_result_versions v
      where v.order_id=p_order and v.state='accepted'
      order by v.trip_id,v.sequence desc
    ) v cross join lateral jsonb_array_elements(v.payload->'items') item
    group by item->>'id'
  ) totals;
  return jsonb_build_object('trips',result||sessions,'accepted_hours',accepted_hours,
    'has_receipts',exists(select 1 from dlight_private.order_trip_result_versions v where v.order_id=p_order),
    'has_links',exists(select 1 from public.trip_service_orders l join public.trips t on t.id=l.trip_id
      where l.order_id=p_order and t.deleted_at is null),
    'sessions_supported',true);
end $function$;

-- The curator's review queue and the task stage guard also see sessions.
create or replace function dlight_private.order_trip_review_queue()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select coalesce(jsonb_agg(to_jsonb(waiting) order by waiting.at desc),'[]'::jsonb)
  from (
    select * from (
      select o.id as order_id,o.number,o.title,t.id as trip_id,t.vehicle_label,t.date_from,v.recorded_at as at,false as standalone
      from public.service_orders o
      join public.trip_service_orders l on l.order_id=o.id
      join public.trips t on t.id=l.trip_id and t.deleted_at is null and t.status<>'cancelled'
      cross join lateral (
        select state,recorded_at from dlight_private.order_trip_result_versions
        where order_id=o.id and trip_id=t.id order by sequence desc limit 1
      ) v
      where auth.uid() is not null and o.curator_id=auth.uid()
        and o.status in ('in_progress','paused','review') and v.state='submitted'
        and dlight_private.responsibility_manager('order',o.id)
        and dlight_private.responsibility_access('trip',t.id)
      union all
      select o.id,o.number,o.title,s.id,'Работа без поездки',s.work_date,v.recorded_at,true
      from public.service_orders o
      join dlight_private.order_work_sessions s on s.order_id=o.id
      cross join lateral (
        select state,recorded_at from dlight_private.order_trip_result_versions
        where order_id=o.id and trip_id=s.id order by sequence desc limit 1
      ) v
      where auth.uid() is not null and o.curator_id=auth.uid()
        and o.status in ('in_progress','paused','review') and v.state='submitted'
        and dlight_private.responsibility_manager('order',o.id)
    ) queue
    order by at desc,order_id,trip_id limit 101
  ) waiting
$function$;

create or replace function dlight_private.order_trip_result_pending_guard()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if exists(select 1 from (
    select distinct on (v.trip_id) v.state
    from dlight_private.order_trip_result_versions v
    where v.order_id=old.id
      and (exists(select 1 from public.trip_service_orders l join public.trips t on t.id=l.trip_id and t.deleted_at is null and t.status<>'cancelled'
            where l.order_id=v.order_id and l.trip_id=v.trip_id)
        or exists(select 1 from dlight_private.order_work_sessions s where s.id=v.trip_id and s.order_id=v.order_id))
    order by v.trip_id,v.sequence desc
  ) latest where latest.state='submitted') then raise exception 'Сначала рассмотрите результаты выездов'; end if;
  return new;
end $function$;

-- Result photos: the second path segment may be a session of the task.
create or replace function dlight_private.order_photo_storage_access(p_path text, p_owner text, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare
  segments text[];
  task public.service_orders;
  visit uuid;
  work uuid;
  own boolean := coalesce(p_owner = auth.uid()::text,false);
  referenced boolean;
  session boolean;
begin
  if auth.uid() is null or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  segments := string_to_array(p_path,'/');
  begin
    visit := segments[2]::uuid;
    work := segments[3]::uuid;
    select * into task from public.service_orders where id = segments[1]::uuid;
  exception when invalid_text_representation then return false;
  end;
  if task.id is null or dlight_private.order_access(task.id) is not true then return false; end if;
  session := dlight_private.order_visit_is_session(task.id, visit);
  if not session and dlight_private.responsibility_access('trip',visit) is not true then return false; end if;

  if p_action = 'read' then
    select exists(select 1 from dlight_private.order_result_photo_refs refs
      join storage.objects objects on objects.id = refs.object_id
      where refs.order_id = task.id and refs.trip_id = visit and refs.work_id = work
        and objects.bucket_id = 'order-result-photos' and objects.name = p_path) into referenced;
    return own or referenced;
  end if;

  return p_action = 'upload' and own and task.status in ('in_progress','paused','review')
    and (coalesce(dlight_private.responsibility_manager('order',task.id),false) or auth.uid() = any(task.engineer_ids))
    and (session or exists(select 1 from public.trip_service_orders link join public.trips trip on trip.id = link.trip_id
      where link.order_id = task.id and link.trip_id = visit and trip.deleted_at is null and trip.status <> 'cancelled'))
    and exists(select 1 from public.service_order_items item where item.id = work and item.order_id = task.id
      and item.kind = 'work' and item.request_finance_void_event_id is null
      and item.legacy_snapshot->>'request_finance_voided_at' is null);
end $function$;
