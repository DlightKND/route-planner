begin;

alter table public.service_order_items
  add column parent_work_id uuid references public.service_order_items(id) on delete set null,
  add constraint service_order_items_part_parent check (parent_work_id is null or kind = 'material');
create index service_order_items_parent_work_idx on public.service_order_items(parent_work_id)
  where parent_work_id is not null;

create function dlight_private.order_part_clear_on_kind_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'work' then
    new.parent_work_id := null;
  else
    update public.service_order_items set parent_work_id = null where parent_work_id = old.id;
  end if;
  return new;
end $$;
revoke all on function dlight_private.order_part_clear_on_kind_change() from public, anon, authenticated;
create trigger order_part_clear_on_kind_change before update of kind on public.service_order_items
  for each row when (new.kind is distinct from old.kind)
  execute function dlight_private.order_part_clear_on_kind_change();

create function dlight_private.order_work_part_save(
  p_order uuid, p_part uuid, p_work uuid, p_expected integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  task public.service_orders;
  part public.service_order_items;
begin
  select * into task from public.service_orders where id = p_order for update;
  if not found or not coalesce(dlight_private.responsibility_manager('order', p_order), false) then
    raise exception 'Запчасти распределяет куратор задания';
  end if;
  if task.status not in ('draft', 'assigned', 'in_progress', 'paused', 'review') then
    raise exception 'Запчасти закрытого задания доступны только для просмотра';
  end if;
  if task.revision is distinct from p_expected then
    raise exception 'Задание изменено другим пользователем. Обновите карточку' using errcode = '40001';
  end if;
  select * into part from public.service_order_items where id = p_part and order_id = p_order
    and kind = 'material' and request_finance_void_event_id is null
    and legacy_snapshot->>'request_finance_voided_at' is null for update;
  if not found then raise exception 'Запчасть не принадлежит заданию или аннулирована'; end if;
  if p_work is not null and not exists (
    select 1 from public.service_order_items where id = p_work and order_id = p_order
      and kind = 'work' and request_finance_void_event_id is null
      and legacy_snapshot->>'request_finance_voided_at' is null
  ) then raise exception 'Работа не принадлежит заданию или аннулирована'; end if;
  if part.parent_work_id is not distinct from p_work then return task.revision; end if;
  if part.done_qty > 0 or part.transferred_qty > 0 then
    raise exception 'Запчасть уже использована или перенесена';
  end if;
  insert into public.service_order_history(order_id, actor_id, reason, snapshot)
    values (p_order, auth.uid(), 'Изменена привязка запчасти: ' || part.title,
      dlight_private.order_snapshot(p_order));
  update public.service_order_items set parent_work_id = p_work where id = p_part;
  update public.service_orders set revision = revision + 1, updated_at = now()
    where id = p_order returning revision into task.revision;
  return task.revision;
end $$;

create function public.service_order_work_part_save(p_order uuid, p_part uuid, p_work uuid, p_expected integer)
returns integer language sql security invoker set search_path = '' as $$
  select dlight_private.order_work_part_save(p_order, p_part, p_work, p_expected)
$$;
revoke all on function dlight_private.order_work_part_save(uuid, uuid, uuid, integer),
  public.service_order_work_part_save(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function dlight_private.order_work_part_save(uuid, uuid, uuid, integer),
  public.service_order_work_part_save(uuid, uuid, uuid, integer) to authenticated;

-- Freeze the assignment in a receipt. Opening older receipts after a plan
-- edit still shows the parts with the work they were reported against.
create function dlight_private.order_result_parts_snapshot(p_order uuid, p_payload jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_set(p_payload, '{items}', jsonb_agg(case when item.kind = 'material'
    then entry.value || jsonb_build_object('parent_work_id', item.parent_work_id)
    else entry.value end order by entry.ordinality)), p_payload)
  from jsonb_array_elements(case when jsonb_typeof(p_payload->'items') = 'array'
    then p_payload->'items' else '[]'::jsonb end) with ordinality entry
  left join public.service_order_items item on item.id = (entry.value->>'id')::uuid
    and item.order_id = p_order
$$;
revoke all on function dlight_private.order_result_parts_snapshot(uuid, jsonb) from public, anon, authenticated;

create function dlight_private.order_trip_snapshot_parts() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.payload := dlight_private.order_result_parts_snapshot(new.order_id, new.payload);
  return new;
end $$;
revoke all on function dlight_private.order_trip_snapshot_parts() from public, anon, authenticated;
create trigger order_trip_snapshot_parts before insert on dlight_private.order_trip_result_versions
  for each row when (new.state in ('submitted', 'accepted'))
  execute function dlight_private.order_trip_snapshot_parts();

create function dlight_private.order_activity_snapshot_parts() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.snapshot := dlight_private.order_result_parts_snapshot(new.order_id, new.snapshot);
  return new;
end $$;
revoke all on function dlight_private.order_activity_snapshot_parts() from public, anon, authenticated;
create trigger order_activity_snapshot_parts before insert on public.service_order_result_events
  for each row execute function dlight_private.order_activity_snapshot_parts();

notify pgrst, 'reload schema';
commit;
