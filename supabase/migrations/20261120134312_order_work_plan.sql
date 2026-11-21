begin;

alter table public.service_order_items
  add column planned_labor_hours numeric(7,2),
  add constraint service_order_items_work_plan_hours
    check (planned_labor_hours is null or
      (kind = 'work' and planned_labor_hours between 0 and 10000));

create function dlight_private.order_work_plan_clear_for_material() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.planned_labor_hours := null;
  return new;
end $$;

revoke all on function dlight_private.order_work_plan_clear_for_material() from public, anon, authenticated;

create trigger order_work_plan_clear_for_material
before update of kind on public.service_order_items
for each row when (new.kind = 'material' and old.kind is distinct from new.kind)
execute function dlight_private.order_work_plan_clear_for_material();

create function dlight_private.order_work_plan_save(
  p_order uuid, p_item uuid, p_expected integer, p_hours numeric
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  task public.service_orders;
  item public.service_order_items;
  hours numeric;
begin
  select * into task from public.service_orders where id = p_order for update;
  if not found or not coalesce(dlight_private.responsibility_manager('order', p_order), false) then
    raise exception 'План работ меняет менеджер задания';
  end if;
  if task.status not in ('draft', 'assigned', 'in_progress', 'paused', 'review') then
    raise exception 'План закрытого задания доступен только для просмотра';
  end if;
  if task.revision is distinct from p_expected then
    raise exception 'Задание изменено другим пользователем. Обновите карточку' using errcode = '40001';
  end if;
  if p_hours is null or p_hours not between 0 and 10000 then
    raise exception 'Введите от 0 до 10 000 н-ч';
  end if;
  hours := round(p_hours, 2);
  select * into item from public.service_order_items
    where id = p_item and order_id = p_order and kind = 'work'
      and request_finance_void_event_id is null
      and legacy_snapshot->>'request_finance_voided_at' is null
    for update;
  if not found then raise exception 'Работа не принадлежит заданию или аннулирована'; end if;
  if item.planned_labor_hours is distinct from hours then
    insert into public.service_order_history(order_id, actor_id, reason, snapshot)
      values (p_order, auth.uid(), 'Изменены плановые нормо-часы: ' || item.title,
        dlight_private.order_snapshot(p_order) ||
          jsonb_build_object('work_item_id', p_item, 'planned_labor_hours', item.planned_labor_hours));
    update public.service_order_items set planned_labor_hours = hours where id = p_item;
    update public.service_orders set revision = revision + 1, updated_at = now()
      where id = p_order returning revision into task.revision;
  end if;
  return jsonb_build_object('revision', task.revision, 'hours', hours);
end $$;

revoke all on function dlight_private.order_work_plan_save(uuid, uuid, integer, numeric) from public, anon, authenticated;
grant execute on function dlight_private.order_work_plan_save(uuid, uuid, integer, numeric) to authenticated;

create function public.service_order_work_plan_save(
  p_order uuid, p_item uuid, p_expected integer, p_hours numeric
) returns jsonb
language sql security invoker set search_path = '' as $$
  select dlight_private.order_work_plan_save(p_order, p_item, p_expected, p_hours)
$$;

revoke all on function public.service_order_work_plan_save(uuid, uuid, integer, numeric) from public, anon, authenticated;
grant execute on function public.service_order_work_plan_save(uuid, uuid, integer, numeric) to authenticated;

commit;
