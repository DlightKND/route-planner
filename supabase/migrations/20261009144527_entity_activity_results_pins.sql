-- Additive activity presentation. Business result guards remain canonical.
begin;

create table public.service_order_result_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete restrict,
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  actual_date date not null,
  operation_id uuid not null unique,
  request_digest text not null,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object')
);
create index service_order_result_events_timeline_idx
  on public.service_order_result_events(order_id,recorded_at desc,id desc);
alter table public.service_order_result_events enable row level security;
revoke all on public.service_order_result_events from public,anon,authenticated;
grant select on public.service_order_result_events to authenticated;
create policy service_order_result_events_read on public.service_order_result_events
  for select to authenticated using (dlight_private.order_access(order_id));

create function dlight_private.record_order_result(
  p_id uuid,p_expected integer,p_items jsonb,p_note text,
  p_actual_date date,p_operation_id uuid,p_basis text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  o public.service_orders;
  previous public.service_order_result_events;
  fingerprint text;
  result_revision integer;
  event_id uuid;
  payload jsonb;
  historical boolean;
  request_id uuid;
begin
  if auth.uid() is null or public.user_role() is null or not dlight_private.order_access(p_id) then
    raise exception 'Нет доступа к заданию';
  end if;
  if p_operation_id is null then raise exception 'Не указан идентификатор отправки результата'; end if;
  if p_actual_date is null or p_actual_date>(now() at time zone 'Europe/Kyiv')::date then
    raise exception 'Укажи дату результата не позднее сегодняшней';
  end if;
  -- Match the canonical finance/historical lock order: request before task.
  -- Concurrent retries then serialize without inverting financial save locks.
  select job_id into request_id from public.service_orders where id=p_id;
  perform 1 from public.jobs where id=request_id for update;
  select * into o from public.service_orders where id=p_id for update;
  if not found or o.job_id is distinct from request_id then raise exception 'Задание изменилось. Обнови данные'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object(
    'items',p_items,'note',coalesce(p_note,''),'actual_date',p_actual_date,
    'basis',p_basis)::text,'UTF8')),'hex');
  select * into previous from public.service_order_result_events where operation_id=p_operation_id;
  if found then
    if previous.order_id is distinct from p_id or previous.actor_id is distinct from auth.uid()
       or previous.request_digest is distinct from fingerprint then
      raise exception 'Идентификатор отправки уже использован для другого результата';
    end if;
    return jsonb_build_object('revision',previous.revision,'event_id',previous.id);
  end if;
  -- Historical drafts still pass the complete existing historical evidence,
  -- status, ownership, quantity and revision checks. No alternate write path.
  historical:=o.status='draft' and o.seed_request_id=o.job_id
    and (o.created_by is null or o.legacy_trip_id is not null)
    and exists(select 1 from public.jobs j where j.id=o.job_id and j.status='done');
  if historical or p_basis is not null then
    result_revision:=public.service_order_historical_result(p_id,p_expected,p_items,p_note,p_basis);
  else
    result_revision:=public.service_order_result(p_id,p_expected,p_items,p_note);
  end if;
  -- Allow-list the operational AFTER state; never expose financial snapshots,
  -- prices, costs, revenues or tariff settings through activity results.
  select jsonb_build_object('number',s.number,'title',s.title,'status',s.status,
    'note',s.result_note,'basis',case when historical then btrim(p_basis) else null end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'kind',i.kind,'title',i.title,'unit',i.unit,
      'planned_qty',i.planned_qty,'done_qty',i.done_qty,
      'transferred_qty',i.transferred_qty,'result_note',i.result_note) order by i.id)
      from public.service_order_items i where i.order_id=s.id
        and i.request_finance_void_event_id is null
        and i.legacy_snapshot->>'request_finance_voided_at' is null),'[]'::jsonb))
    into payload from public.service_orders s where s.id=p_id;
  insert into public.service_order_result_events(
    order_id,actor_id,actual_date,operation_id,request_digest,revision,snapshot
  ) values(p_id,auth.uid(),p_actual_date,p_operation_id,fingerprint,result_revision,payload)
  returning id into event_id;
  return jsonb_build_object('revision',result_revision,'event_id',event_id);
end $$;
revoke all on function dlight_private.record_order_result(uuid,integer,jsonb,text,date,uuid,text)
  from public,anon,authenticated;
grant execute on function dlight_private.record_order_result(uuid,integer,jsonb,text,date,uuid,text)
  to authenticated;
create function public.service_order_record_result(
  p_id uuid,p_expected integer,p_items jsonb,p_note text,
  p_actual_date date,p_operation_id uuid,p_basis text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.record_order_result(
    p_id,p_expected,p_items,p_note,p_actual_date,p_operation_id,p_basis)
$$;
revoke all on function public.service_order_record_result(uuid,integer,jsonb,text,date,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_order_record_result(uuid,integer,jsonb,text,date,uuid,text)
  to authenticated;

-- Read the parent's actual RLS before traversing child links. An accessible
-- request or trip does not grant access to unrelated task result events.
create function public.entity_activity_results(p_kind text,p_id uuid)
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
    select e.* from public.service_order_result_events e
    join public.service_orders o on o.id=e.order_id
    where (p_kind='order' and o.id=p_id)
       or (p_kind='job' and o.job_id=p_id)
       or (p_kind='trip' and exists(select 1 from public.trip_service_orders l
          where l.trip_id=p_id and l.order_id=o.id))
    order by e.recorded_at desc,e.id desc limit 100
  ) x;
  return output;
end $$;
revoke all on function public.entity_activity_results(text,uuid) from public,anon,authenticated;
grant execute on function public.entity_activity_results(text,uuid) to authenticated;

alter table public.job_comments
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles(id) on delete restrict,
  add constraint job_comments_pin_pair check ((pinned_at is null)=(pinned_by is null));
alter table public.service_order_comments
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles(id) on delete restrict,
  add constraint service_order_comments_pin_pair check ((pinned_at is null)=(pinned_by is null));
alter table public.trip_comments
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles(id) on delete restrict,
  add constraint trip_comments_pin_pair check ((pinned_at is null)=(pinned_by is null));
create index job_comments_pinned_idx on public.job_comments(job_id,pinned_at desc,id) where pinned_at is not null;
create index service_order_comments_pinned_idx on public.service_order_comments(order_id,pinned_at desc,id) where pinned_at is not null;
create index trip_comments_pinned_idx on public.trip_comments(trip_id,pinned_at desc,id) where pinned_at is not null;

-- Existing INSERT grants must not allow a caller to self-assign pin metadata.
-- Existing identity/body/time stamping still runs unchanged.
create function dlight_private.clear_insert_activity_pin() returns trigger
language plpgsql set search_path='' as $$
begin new.pinned_at:=null;new.pinned_by:=null;return new;end $$;
revoke all on function dlight_private.clear_insert_activity_pin() from public,anon,authenticated;
create trigger job_comments_clear_pin before insert on public.job_comments
  for each row execute function dlight_private.clear_insert_activity_pin();
create trigger service_order_comments_clear_pin before insert on public.service_order_comments
  for each row execute function dlight_private.clear_insert_activity_pin();
create trigger trip_comments_clear_pin before insert on public.trip_comments
  for each row execute function dlight_private.clear_insert_activity_pin();

create function dlight_private.pin_activity_comment(
  p_kind text,p_id uuid,p_comment uuid,p_pinned boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare table_name text;owner_column text;output jsonb;row_count integer;
begin
  if auth.uid() is null or public.user_role() is null or p_pinned is null then raise exception 'Нет права закрепления'; end if;
  if p_kind='job' then
    table_name:='job_comments';owner_column:='job_id';
    perform 1 from public.jobs where id=p_id and deleted_at is null for update;
  elsif p_kind='order' then
    table_name:='service_order_comments';owner_column:='order_id';
    perform 1 from public.service_orders where id=p_id and job_id is not null for update;
  elsif p_kind='trip' then
    table_name:='trip_comments';owner_column:='trip_id';
    perform 1 from public.trips where id=p_id and deleted_at is null for update;
  else raise exception 'Неизвестный тип карточки'; end if;
  if not found or not dlight_private.responsibility_access(p_kind,p_id)
    or not dlight_private.responsibility_manager(p_kind,p_id) then raise exception 'Нет права закрепления'; end if;
  execute format('update public.%I set pinned_at=case when $1 then coalesce(pinned_at,now()) else null end,
    pinned_by=case when $1 then coalesce(pinned_by,auth.uid()) else null end
    where id=$2 and %I=$3 returning jsonb_build_object(''comment_id'',id,''pinned_at'',pinned_at,''pinned_by'',pinned_by)',table_name,owner_column)
    into output using p_pinned,p_comment,p_id;
  get diagnostics row_count=row_count;
  if row_count<>1 then raise exception 'Комментарий не принадлежит карточке'; end if;
  return output;
end $$;
revoke all on function dlight_private.pin_activity_comment(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function dlight_private.pin_activity_comment(text,uuid,uuid,boolean) to authenticated;
create function public.entity_activity_pin(p_kind text,p_id uuid,p_comment uuid,p_pinned boolean)
returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.pin_activity_comment(p_kind,p_id,p_comment,p_pinned)
$$;
revoke all on function public.entity_activity_pin(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.entity_activity_pin(text,uuid,uuid,boolean) to authenticated;

commit;
