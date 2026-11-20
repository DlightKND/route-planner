begin;

-- An append-only result belongs to one task and one visit. A purged trip keeps
-- its identity here so older accepted contributions still reconcile to totals.
create table dlight_private.order_trip_result_versions (
  sequence bigint generated always as identity primary key,
  order_id uuid not null references public.service_orders(id) on delete cascade,
  trip_id uuid not null,
  operation_id uuid not null unique,
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  state text not null check (state in ('submitted','accepted','returned')),
  trip_revision integer not null,
  order_revision integer not null,
  payload jsonb not null,
  presence_used numeric not null default 0,
  fingerprint text not null,
  activity_id uuid
);
create index order_trip_result_lookup on dlight_private.order_trip_result_versions(order_id,trip_id,sequence desc);
create index order_trip_result_pool on dlight_private.order_trip_result_versions(trip_id,order_id,sequence desc) where state='accepted';
alter table dlight_private.order_trip_result_versions enable row level security;
revoke all on dlight_private.order_trip_result_versions from public,anon,authenticated;

create function dlight_private.order_trip_presence(p_trip uuid,p_job uuid,p_order uuid)
returns jsonb language sql stable set search_path='' as $$
  with presence as (
    select count(*) filter (where s.status='approved' and s.minutes_mgr is not null
        and s.crew_source in ('snapshot','manager') and cardinality(s.crew_ids)>0)>0
      and count(*) filter (where s.status not in ('approved','rejected'))=0 as confirmed,
      round(coalesce(sum(s.minutes_mgr*cardinality(s.crew_ids)/60.0) filter (
        where s.status='approved' and s.crew_source in ('snapshot','manager')),0),2) as hours
    from public.trip_stays s where s.trip_id=p_trip and s.job_id=p_job and s.stay_to is not null
  ), allocated as (
    select coalesce(sum(current_version.presence_used),0) as hours from (
      select distinct on (v.order_id) v.presence_used
      from dlight_private.order_trip_result_versions v join public.service_orders o on o.id=v.order_id
      where v.trip_id=p_trip and v.order_id<>p_order and o.job_id=p_job and v.state='accepted'
      order by v.order_id,v.sequence desc
    ) current_version
  )
  select jsonb_build_object('confirmed',presence.confirmed,'base',presence.hours,
    'used',allocated.hours,'available',greatest(0,presence.hours-allocated.hours))
  from presence cross join allocated
$$;

create function dlight_private.order_trip_result_read(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; accepted_hours jsonb; o public.service_orders;
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
  return jsonb_build_object('trips',result,'accepted_hours',accepted_hours,
    'has_receipts',exists(select 1 from dlight_private.order_trip_result_versions v where v.order_id=p_order),
    'has_links',exists(select 1 from public.trip_service_orders l join public.trips t on t.id=l.trip_id
      where l.order_id=p_order and t.deleted_at is null));
end $$;

-- Reuse the existing result application and history for the cumulative totals.
-- The original aggregate RPC remains available for non-trip and historical work.
alter function dlight_private.order_result(uuid,integer,jsonb,text) rename to order_result_apply_totals;
revoke all on function dlight_private.order_result_apply_totals(uuid,integer,jsonb,text) from public,anon,authenticated;
create function dlight_private.order_result(p_id uuid,p_expected integer,p_items jsonb,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
begin
  if not dlight_private.order_access(p_id) then raise exception 'Нет доступа к заданию'; end if;
  perform 1 from public.service_orders where id=p_id for update;
  if exists(select 1 from dlight_private.order_trip_result_versions where order_id=p_id) then
    raise exception 'Результаты этого задания ведутся по выездам';
  end if;
  return dlight_private.order_result_apply_totals(p_id,p_expected,p_items,p_note);
end $$;
create or replace function public.service_order_result(p_id uuid,p_expected integer,p_items jsonb,p_note text)
returns integer language sql security invoker set search_path='' as $$
  select dlight_private.order_result(p_id,p_expected,p_items,p_note)
$$;

create function dlight_private.order_trip_result_write(
  p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,p_expected_event uuid,
  p_operation uuid,p_action text,p_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t public.trips; o public.service_orders; item public.service_order_items;
  latest dlight_private.order_trip_result_versions; accepted dlight_private.order_trip_result_versions;
  retry dlight_private.order_trip_result_versions;
  is_manager boolean; request_id uuid; fingerprint text; event_id uuid;
  revision integer; presence jsonb; available numeric; hours numeric:=0;
  used numeric:=0; quantity numeric; item_hours numeric; other_qty numeric;
  row jsonb; previous jsonb; note text; reason text; correction text;
  entered jsonb:='[]'::jsonb; aggregate_items jsonb:='[]'::jsonb; snapshot jsonb;
begin
  if dlight_private.order_access(p_order) is not true or dlight_private.responsibility_access('trip',p_trip) is not true then
    raise exception 'Нет доступа к заданию или выезду';
  end if;
  if p_operation is null or p_action is null or p_action not in ('submitted','accepted','returned')
    or jsonb_typeof(p_result) is distinct from 'object' then raise exception 'Некорректный результат'; end if;
  is_manager:=dlight_private.responsibility_manager('order',p_order);
  if p_action in ('accepted','returned') and not is_manager then raise exception 'Принимает результат куратор задания'; end if;
  -- GPS and trip-link edits already lock the trip first. The next two locks
  -- follow the order used for task finance, cumulative results and remainder.
  select * into t from public.trips where id=p_trip for update;
  if not found then raise exception 'Выезд не найден'; end if;
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
  if t.deleted_at is not null or not exists(select 1 from public.trip_service_orders l where l.trip_id=p_trip and l.order_id=p_order) then
    raise exception 'Выезд больше не связан с заданием';
  end if;
  if o.status not in ('in_progress','paused','review') or t.status='cancelled' then
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
    if p_trip_revision is distinct from t.workbench_revision then
      raise exception 'Данные GPS изменились. Обновите предложенные часы' using errcode='40001';
    end if;
    presence:=dlight_private.order_trip_presence(p_trip,request_id,p_order);
    if t.status not in ('finished','done') or not (presence->>'confirmed')::boolean then
      raise exception 'Сначала завершите выезд и подтвердите рабочие посещения в GPS-журнале';
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
    if p_action='accepted' then
      revision:=dlight_private.order_result_apply_totals(p_order,p_order_revision,aggregate_items,o.result_note);
      used:=least(available,hours);
      insert into public.service_order_result_events(order_id,actor_id,actual_date,operation_id,request_digest,revision,snapshot)
        values(p_order,auth.uid(),(coalesce(t.finished_at,now()) at time zone 'Europe/Kyiv')::date,
          p_operation,fingerprint,revision,snapshot||jsonb_build_object('title',o.title,'number',o.number,
            'trip_id',p_trip,'trip_label',t.vehicle_label)) returning id into event_id;
    end if;
  end if;
  insert into dlight_private.order_trip_result_versions(order_id,trip_id,operation_id,actor_id,state,trip_revision,
    order_revision,payload,presence_used,fingerprint,activity_id)
  values(p_order,p_trip,p_operation,auth.uid(),p_action,t.workbench_revision,revision,snapshot,used,fingerprint,event_id);
  return jsonb_build_object('event',p_operation,'revision',revision);
end $$;

create function public.service_order_trip_results(p_order uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select dlight_private.order_trip_result_read(p_order)
$$;
create function public.service_order_trip_result_write(p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,
    p_expected_event uuid,p_operation uuid,p_action text,p_result jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.order_trip_result_write(p_order,p_trip,p_order_revision,p_trip_revision,p_expected_event,p_operation,p_action,p_result)
$$;
revoke all on function dlight_private.order_trip_presence(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function dlight_private.order_result(uuid,integer,jsonb,text),
  dlight_private.order_trip_result_read(uuid),dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_results(uuid),public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function dlight_private.order_result(uuid,integer,jsonb,text),
  dlight_private.order_trip_result_read(uuid),dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_results(uuid),public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  to authenticated;

create function dlight_private.order_trip_result_pending_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from (
    select distinct on (v.trip_id) v.state
    from dlight_private.order_trip_result_versions v
    join public.trip_service_orders l on l.order_id=v.order_id and l.trip_id=v.trip_id
    join public.trips t on t.id=l.trip_id and t.deleted_at is null and t.status<>'cancelled'
    where v.order_id=old.id order by v.trip_id,v.sequence desc
  ) latest where latest.state='submitted') then raise exception 'Сначала рассмотрите результаты выездов'; end if;
  return new;
end $$;
revoke all on function dlight_private.order_trip_result_pending_guard() from public,anon,authenticated;
create trigger order_trip_result_pending_guard before update of status on public.service_orders
  for each row when (old.status is distinct from new.status and new.status in ('completed','cancelled'))
  execute function dlight_private.order_trip_result_pending_guard();

-- Old events have no trip attribution. Preserve their prior presentation;
-- accepted visit contributions only appear on the corresponding trip.
create or replace function public.entity_activity_results(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
  if auth.uid() is null or public.user_role() is null then raise exception 'Войдите для просмотра результатов'; end if;
  if p_kind='order' then
    if not exists(select 1 from public.service_orders where id=p_id) then raise exception 'Нет доступа к заданию'; end if;
  elsif p_kind='job' then
    if not exists(select 1 from public.jobs where id=p_id and deleted_at is null) then raise exception 'Нет доступа к заявке'; end if;
  elsif p_kind='trip' then
    if not exists(select 1 from public.trips where id=p_id and deleted_at is null) then raise exception 'Нет доступа к выезду'; end if;
  else raise exception 'Неизвестный тип карточки'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'order_id',x.order_id,
    'actor_id',x.actor_id,'recorded_at',x.recorded_at,'actual_date',x.actual_date,
    'snapshot',x.snapshot) order by x.recorded_at desc,x.id desc),'[]'::jsonb)
  into output from (
    select e.* from public.service_order_result_events e join public.service_orders o on o.id=e.order_id
    where (p_kind='order' and o.id=p_id) or (p_kind='job' and o.job_id=p_id)
      or (p_kind='trip' and (e.snapshot->>'trip_id'=p_id::text or
        e.snapshot->>'trip_id' is null and exists(select 1 from public.trip_service_orders l
          where l.trip_id=p_id and l.order_id=o.id)))
    order by e.recorded_at desc,e.id desc limit 100
  ) x;
  return output;
end $$;

create function dlight_private.order_trip_review_queue()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(waiting) order by waiting.at desc),'[]'::jsonb)
  from (
    select o.id as order_id,o.number,o.title,t.id as trip_id,t.vehicle_label,t.date_from,v.recorded_at as at
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
    order by v.recorded_at desc,o.id,t.id limit 101
  ) waiting
$$;
create function public.service_order_trip_review_queue()
returns jsonb language sql stable security invoker set search_path='' as $$
  select dlight_private.order_trip_review_queue()
$$;
revoke all on function dlight_private.order_trip_review_queue(),public.service_order_trip_review_queue() from public,anon,authenticated;
grant execute on function dlight_private.order_trip_review_queue(),public.service_order_trip_review_queue() to authenticated;

notify pgrst,'reload schema';
commit;
