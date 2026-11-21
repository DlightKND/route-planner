begin;

create or replace function public.service_order_request_remainders(p_job uuid)
returns table(id uuid, number bigint, title text, unit text, planned text, qty text)
language sql stable security invoker set search_path='' as $$
  select i.id,o.number::bigint,i.title,i.unit,i.planned_qty::text,
    (i.planned_qty-i.done_qty-i.transferred_qty)::text
  from public.service_orders o
  join public.service_order_items i on i.order_id=o.id and i.job_id=o.job_id
  where o.job_id=p_job and o.status='completed' and o.closed_with_remainder_at is not null
    and i.planned_qty>i.done_qty+i.transferred_qty
    and i.request_finance_void_event_id is null and i.legacy_snapshot->>'request_finance_voided_at' is null
    and not exists (
      select 1 from public.service_order_items parent
      where parent.id=i.parent_work_id and parent.order_id=o.id and parent.job_id=p_job
        and parent.planned_qty>parent.done_qty and parent.request_finance_void_event_id is null
        and parent.legacy_snapshot->>'request_finance_voided_at' is null
    )
  order by o.number,i.title,i.id
$$;

create or replace function dlight_private.create_order_with_remainders(
  p_job uuid, p_data jsonb, p_items jsonb, p_remainders jsonb, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  target uuid;
  digest text;
  previous public.service_orders;
  source_count integer;
  available_count integer;
  carried jsonb;
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

  -- Keep the operation digest tied to the submitted selection. Add child parts
  -- only after the retry check and while the source request and task are locked.
  with picked as materialized (
    select * from jsonb_to_recordset(p_remainders) as source(item_id uuid,qty numeric)
  ), parts as (
    select part.id as item_id, least(
      part.planned_qty-part.done_qty-part.transferred_qty,
      round(part.planned_qty*picked.qty/work.planned_qty,2)
    ) as qty
    from picked
    join public.service_order_items work on work.id=picked.item_id and work.kind='work'
    join public.service_order_items part on part.parent_work_id=work.id and part.order_id=work.order_id
      and part.job_id=p_job and part.kind='material'
    where part.request_finance_void_event_id is null and part.legacy_snapshot->>'request_finance_voided_at' is null
      and not exists (select 1 from picked explicit where explicit.item_id=part.id)
  )
  select p_remainders||coalesce(jsonb_agg(to_jsonb(parts)),'[]'::jsonb)
    into carried from parts where qty>0;

  target := dlight_private.order_save_one(null,null,p_data,p_job,p_items);
  update public.service_orders
    set remainder_operation_id=p_operation_id,remainder_operation_digest=digest where id=target;

  insert into public.service_order_items(
    order_id,job_id,title,unit,planned_qty,source_item_id,from_request_remainder,kind,
    stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot,work_catalog_id,
    billable,billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot,planned_labor_hours
  )
  select target,p_job,i.title,i.unit,source.qty,i.id,true,i.kind,
    i.stock_catalog_id,i.sku_snapshot,i.unit_price_snapshot,i.unit_cost_snapshot,i.work_catalog_id,
    i.billable,i.billable_reason,i.tariff_profile,
    round(i.financial_revenue_snapshot*source.qty/i.planned_qty,2),
    round(i.financial_cost_snapshot*source.qty/i.planned_qty,2),
    round(i.planned_labor_hours*source.qty/i.planned_qty,2)
  from public.service_order_items i
  join jsonb_to_recordset(carried) as source(item_id uuid,qty numeric) on source.item_id=i.id;

  update public.service_order_items part
    set parent_work_id=work.id
    from public.service_order_items source_part,public.service_order_items work
    where part.order_id=target and part.from_request_remainder and part.kind='material'
      and source_part.id=part.source_item_id and work.order_id=target and work.from_request_remainder
      and work.kind='work' and work.source_item_id=source_part.parent_work_id;

  insert into dlight_private.payment_terms(scope,owner_id,subject,terms)
    select 'work',target,child.id::text,settings.terms
    from public.service_order_items child
    join public.service_order_items source on source.id=child.source_item_id
    join dlight_private.payment_terms settings on settings.scope='work'
      and settings.owner_id=source.order_id and settings.subject=source.id::text
    where child.order_id=target and child.from_request_remainder and child.kind='work';

  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
  select distinct i.order_id,auth.uid(),'Остаток добавлен в следующее задание',dlight_private.order_snapshot(i.order_id)
  from public.service_order_items i
  join jsonb_to_recordset(carried) as source(item_id uuid,qty numeric) on source.item_id=i.id;
  update public.service_orders o set revision=revision+1,updated_at=now()
  where exists(
    select 1 from public.service_order_items i
    join jsonb_to_recordset(carried) as source(item_id uuid,qty numeric) on source.item_id=i.id
    where i.order_id=o.id
  );
  update public.service_order_items i set transferred_qty=i.transferred_qty+source.qty
  from jsonb_to_recordset(carried) as source(item_id uuid,qty numeric)
  where i.id=source.item_id;
  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
    values(target,auth.uid(),'Добавлен остаток работ по заявке',dlight_private.order_snapshot(target));
  return target;
end $$;

commit;
