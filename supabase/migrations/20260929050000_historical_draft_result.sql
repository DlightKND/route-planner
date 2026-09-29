-- A closed legacy request can have a draft seed task. Record manually verified
-- quantities there without reopening the request or inferring them from stays.
begin;

create function dlight_private.order_historical_result(
  p_id uuid, p_expected integer, p_items jsonb, p_note text, p_basis text
) returns integer language plpgsql security definer set search_path='' as $$
declare
  o public.service_orders;
  i public.service_order_items;
  item jsonb;
  request_id uuid;
  request_status text;
  seen uuid[] := '{}'::uuid[];
  item_id uuid;
  quantity numeric;
begin
  if auth.uid() is null or public.user_role() not in ('admin','logist') then
    raise exception 'Исторический факт вводит диспетчер';
  end if;
  -- Finance writes lock the request before its seed task.
  select job_id into request_id from public.service_orders where id=p_id;
  select status::text into request_status from public.jobs
    where id=request_id and deleted_at is null for update;
  select * into o from public.service_orders where id=p_id for update;
  if not found or o.job_id is distinct from request_id or o.status<>'draft'
     or o.seed_request_id is distinct from o.job_id
     or (o.created_by is not null and o.legacy_trip_id is null)
     or request_status is distinct from 'done' then
    raise exception 'Исторический ввод доступен только для перенесённого черновика закрытой заявки';
  end if;
  if p_expected is distinct from o.revision then
    raise exception 'Задание изменено другим пользователем. Обнови данные';
  end if;
  if length(btrim(coalesce(p_basis,'')))<5 or length(p_basis)>1000 then
    raise exception 'Укажи основание факта от 5 до 1000 символов';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Укажи выполненные работы или материалы';
  end if;
  if jsonb_array_length(p_items)=0 then
    raise exception 'Укажи выполненные работы или материалы';
  end if;
  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
    values(p_id,auth.uid(),'Исторический факт вручную: '||btrim(p_basis),dlight_private.order_snapshot(p_id));
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' or
       jsonb_typeof(item->'done_qty') is distinct from 'number' or
       nullif(item->>'id','') is null then
      raise exception 'Некорректный факт по строке задания';
    end if;
    item_id := (item->>'id')::uuid;
    if item_id=any(seen) then raise exception 'Повтор строки задания'; end if;
    seen := array_append(seen,item_id);
    quantity := (item->>'done_qty')::numeric;
    select * into i from public.service_order_items
      where id=item_id and order_id=p_id for update;
    if not found then raise exception 'Строка работы не принадлежит заданию'; end if;
    if i.request_finance_void_event_id is not null or
       i.legacy_snapshot->>'request_finance_voided_at' is not null or
       quantity<0 or quantity>i.planned_qty-i.transferred_qty then
      raise exception 'Недопустимый факт по строке задания';
    end if;
    update public.service_order_items set done_qty=quantity,
      result_note=coalesce(item->>'result_note','') where id=item_id;
  end loop;
  update public.service_orders set result_note=coalesce(p_note,''),
    revision=revision+1,updated_at=now() where id=p_id returning revision into p_expected;
  return p_expected;
end $$;

create function public.service_order_historical_result(
  p_id uuid, p_expected integer, p_items jsonb, p_note text, p_basis text
) returns integer language sql security invoker set search_path='' as $$
  select dlight_private.order_historical_result(p_id,p_expected,p_items,p_note,p_basis)
$$;
revoke all on function dlight_private.order_historical_result(uuid,integer,jsonb,text,text),
  public.service_order_historical_result(uuid,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function dlight_private.order_historical_result(uuid,integer,jsonb,text,text),
  public.service_order_historical_result(uuid,integer,jsonb,text,text) to authenticated;

commit;
