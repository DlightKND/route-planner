begin;

alter table public.service_orders
  add column closed_with_remainder_at timestamptz,
  add column remainder_operation_id uuid unique,
  add column remainder_operation_digest text;

alter table public.service_order_items
  add column from_request_remainder boolean not null default false,
  add constraint request_remainder_source_required
    check (not from_request_remainder or source_item_id is not null);

create index service_orders_open_remainders_by_request
  on public.service_orders (job_id) where closed_with_remainder_at is not null;

create function public.service_order_request_remainders(p_job uuid)
returns table(id uuid, number bigint, title text, unit text, planned text, qty text)
language sql stable security invoker set search_path='' as $$
  select i.id,o.number::bigint,i.title,i.unit,i.planned_qty::text,
    (i.planned_qty-i.done_qty-i.transferred_qty)::text
  from public.service_orders o
  join public.service_order_items i on i.order_id=o.id and i.job_id=o.job_id
  where o.job_id=p_job and o.status='completed' and o.closed_with_remainder_at is not null
    and i.planned_qty>i.done_qty+i.transferred_qty
    and i.request_finance_void_event_id is null and i.legacy_snapshot->>'request_finance_voided_at' is null
  order by o.number,i.title,i.id
$$;

create function dlight_private.close_order_with_remainder(
  p_order uuid, p_expected integer, p_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare
  order_row public.service_orders;
  request_id uuid;
  reason text := btrim(coalesce(p_reason,''));
begin
  if not dlight_private.responsibility_manager('order',p_order) then
    raise exception 'Закрыть задание с остатком может ответственный менеджер';
  end if;
  if length(reason)<1 or length(reason)>1000 then
    raise exception 'Укажите причину закрытия с остатком';
  end if;

  select job_id into request_id from public.service_orders where id=p_order;
  perform 1 from public.jobs where id=request_id and deleted_at is null for update;
  if not found then raise exception 'Исходная заявка недоступна'; end if;
  select * into order_row from public.service_orders where id=p_order for update;
  if not found or order_row.job_id is distinct from request_id
    or order_row.revision is distinct from p_expected then
    raise exception 'Задание изменилось. Обновите карточку';
  end if;
  if not dlight_private.responsibility_manager('order',p_order) then
    raise exception 'Права на задание изменились. Обновите карточку';
  end if;
  if order_row.status not in ('in_progress','paused','review') then
    raise exception 'Задание нельзя закрыть с остатком на этой стадии';
  end if;
  if order_row.owner_id=auth.uid() and order_row.curator_id is distinct from auth.uid()
    and length(reason)<5 then raise exception 'Владелец указывает причину вмешательства'; end if;
  if exists(
    select 1 from public.trips t where t.deleted_at is null
      and t.status not in ('done','cancelled')
      and (t.service_order_id=p_order or exists(
        select 1 from public.trip_service_orders link where link.trip_id=t.id and link.order_id=p_order
      ))
  ) then raise exception 'Сначала завершите или отмените связанные выезды'; end if;

  if not exists(
    select 1 from public.service_order_items i where i.order_id=p_order and i.job_id=request_id
      and i.kind='work' and i.done_qty>0 and i.request_finance_void_event_id is null
      and i.legacy_snapshot->>'request_finance_voided_at' is null
  ) or not exists(
    select 1 from public.service_order_items i where i.order_id=p_order and i.job_id=request_id
      and i.planned_qty>i.done_qty+i.transferred_qty and i.request_finance_void_event_id is null
      and i.legacy_snapshot->>'request_finance_voided_at' is null
  ) then raise exception 'Для закрытия нужны выполненная работа и невыполненный остаток'; end if;

  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
    values(p_order,auth.uid(),'Закрыто с остатком · '||reason,dlight_private.order_snapshot(p_order));
  update public.service_orders
    set status='completed',closed_with_remainder_at=now(),revision=revision+1,updated_at=now()
    where id=p_order returning revision into p_expected;
  return p_expected;
end $$;

create function public.service_order_close_with_remainder(
  p_order uuid, p_expected integer, p_reason text
) returns integer language sql security invoker set search_path='' as $$
  select dlight_private.close_order_with_remainder(p_order,p_expected,p_reason)
$$;

create function dlight_private.create_order_with_remainders(
  p_job uuid, p_data jsonb, p_items jsonb, p_remainders jsonb, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  target uuid;
  digest text;
  previous public.service_orders;
  source_count integer;
  available_count integer;
begin
  if auth.uid() is null or coalesce(public.user_role()::text,'') not in ('admin','logist') then
    raise exception 'Создавать задание с остатком может диспетчер';
  end if;
  if p_operation_id is null or jsonb_typeof(p_remainders) is distinct from 'array' then
    raise exception 'Не указан остаток работ';
  end if;
  source_count := jsonb_array_length(p_remainders);
  if source_count=0 or source_count>500 or source_count<>(
    select count(distinct source.item_id)
    from jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric)
    where source.qty>0
  ) then raise exception 'Выберите неповторяющиеся строки остатка'; end if;
  digest := encode(sha256(convert_to(jsonb_build_array(p_job,p_data,p_items,p_remainders)::text,'UTF8')),'hex');

  -- Finance and result RPCs use the same request-before-task lock order.
  perform 1 from public.jobs where id=p_job and deleted_at is null for update;
  if not found then raise exception 'Исходная заявка недоступна'; end if;
  select * into previous from public.service_orders where remainder_operation_id=p_operation_id;
  if found then
    if previous.job_id is distinct from p_job or previous.created_by is distinct from auth.uid()
      or previous.remainder_operation_digest is distinct from digest then
      raise exception 'Идентификатор сохранения уже использован';
    end if;
    return previous.id;
  end if;

  perform o.id from public.service_orders o
  where o.job_id=p_job and o.closed_with_remainder_at is not null and o.status='completed'
    and exists (
      select 1 from public.service_order_items i
      join jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric) on source.item_id=i.id
      where i.order_id=o.id
    )
  order by o.id for update;

  perform i.id from public.service_order_items i
  join public.service_orders o on o.id=i.order_id
  join jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric) on source.item_id=i.id
  where i.job_id=p_job and o.job_id=p_job and o.status='completed' and o.closed_with_remainder_at is not null
    and i.request_finance_void_event_id is null and i.legacy_snapshot->>'request_finance_voided_at' is null
    and i.planned_qty-i.done_qty-i.transferred_qty=source.qty
  order by i.id for update of i;
  get diagnostics available_count=row_count;
  if available_count<>source_count then
    raise exception 'Доступный остаток изменился. Обновите остаток и проверьте выбор';
  end if;

  target := dlight_private.order_save_one(null,null,p_data,p_job,p_items);
  update public.service_orders
    set remainder_operation_id=p_operation_id,remainder_operation_digest=digest where id=target;

  insert into public.service_order_items(
    order_id,job_id,title,unit,planned_qty,source_item_id,from_request_remainder,kind,
    stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot,work_catalog_id,
    billable,billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot
  )
  select target,p_job,i.title,i.unit,source.qty,i.id,true,i.kind,
    i.stock_catalog_id,i.sku_snapshot,i.unit_price_snapshot,i.unit_cost_snapshot,i.work_catalog_id,
    i.billable,i.billable_reason,i.tariff_profile,
    round(i.financial_revenue_snapshot*source.qty/i.planned_qty,2),
    round(i.financial_cost_snapshot*source.qty/i.planned_qty,2)
  from public.service_order_items i
  join jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric) on source.item_id=i.id;

  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
  select distinct i.order_id,auth.uid(),'Остаток добавлен в следующее задание',dlight_private.order_snapshot(i.order_id)
  from public.service_order_items i
  join jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric) on source.item_id=i.id;
  update public.service_orders o set revision=revision+1,updated_at=now()
  where exists(
    select 1 from public.service_order_items i
    join jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric) on source.item_id=i.id
    where i.order_id=o.id
  );
  update public.service_order_items i set transferred_qty=i.transferred_qty+source.qty
  from jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric)
  where i.id=source.item_id;
  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
    values(target,auth.uid(),'Добавлен остаток работ по заявке',dlight_private.order_snapshot(target));
  return target;
end $$;

create function public.service_order_create_with_remainders(
  p_job uuid, p_data jsonb, p_items jsonb, p_remainders jsonb, p_operation_id uuid
) returns uuid language sql security invoker set search_path='' as $$
  select dlight_private.create_order_with_remainders(p_job,p_data,p_items,p_remainders,p_operation_id)
$$;

-- Re-saving the order must retain the source title and financial snapshot,
-- including after an administrator renames the work in the catalogue.
do $$
declare
  definition text := pg_get_functiondef('dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb)'::regprocedure);
  anchor text := 'existing_item.legacy_job_work_id is not null';
begin
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Unexpected order_save source line guard';
  end if;
  execute replace(definition,anchor,'existing_item.from_request_remainder or '||anchor);
end $$;

-- A reserved line has frozen scope. A dispatcher can add independent work.
create function dlight_private.guard_request_remainder_quantity()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.from_request_remainder and new.planned_qty is distinct from old.planned_qty then
    raise exception 'Объём перенесённой работы зафиксирован исходным остатком';
  end if;
  return new;
end $$;
create trigger guard_request_remainder_quantity before update of planned_qty
  on public.service_order_items for each row execute function dlight_private.guard_request_remainder_quantity();

-- Cancellation releases only unperformed, unforwarded quantities.
create function dlight_private.release_cancelled_order_remainders()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  source record;
begin
  for source in
    select parent.order_id, parent.id, sum(child.planned_qty-child.done_qty-child.transferred_qty) as qty
    from public.service_order_items child
    join public.service_order_items parent on parent.id=child.source_item_id
    where child.order_id=new.id and child.from_request_remainder
      and child.planned_qty>child.done_qty+child.transferred_qty
    group by parent.order_id,parent.id
    order by parent.order_id,parent.id
  loop
    perform 1 from public.service_orders where id=source.order_id for update;
    insert into public.service_order_history(order_id,actor_id,reason,snapshot)
      values(source.order_id,auth.uid(),'Остаток возвращён в заявку после отмены задания',dlight_private.order_snapshot(source.order_id));
    update public.service_order_items set transferred_qty=transferred_qty-source.qty where id=source.id;
  end loop;

  update public.service_orders o set revision=revision+1,updated_at=now()
  where o.id in (
    select parent.order_id from public.service_order_items child
    join public.service_order_items parent on parent.id=child.source_item_id
    where child.order_id=new.id and child.from_request_remainder
      and child.planned_qty>child.done_qty+child.transferred_qty
  );
  return new;
end $$;
create trigger release_cancelled_order_remainders after update of status on public.service_orders
  for each row when (new.status='cancelled' and old.status is distinct from new.status)
  execute function dlight_private.release_cancelled_order_remainders();

revoke all on function dlight_private.guard_request_remainder_quantity(),
  dlight_private.release_cancelled_order_remainders() from public,anon,authenticated;
revoke all on function public.service_order_request_remainders(uuid),
  dlight_private.close_order_with_remainder(uuid,integer,text),
  dlight_private.create_order_with_remainders(uuid,jsonb,jsonb,jsonb,uuid),
  public.service_order_close_with_remainder(uuid,integer,text),
  public.service_order_create_with_remainders(uuid,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.service_order_request_remainders(uuid),
  dlight_private.close_order_with_remainder(uuid,integer,text),
  dlight_private.create_order_with_remainders(uuid,jsonb,jsonb,jsonb,uuid),
  public.service_order_close_with_remainder(uuid,integer,text),
  public.service_order_create_with_remainders(uuid,jsonb,jsonb,jsonb,uuid) to authenticated;

commit;
