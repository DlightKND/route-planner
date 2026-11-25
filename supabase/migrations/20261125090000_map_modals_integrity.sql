-- Map dialogs: data integrity.
--
-- 1. A client or a piece of equipment with active work can no longer be deleted. Before this,
--    soft_delete_client() hid the client, its equipment and its requests, and left their tasks
--    (and the trips carrying them) pointing at deleted rows.
-- 2. Equipment gets its own soft delete with the same undo stamp as clients (restore_deleted).
-- 3. «Last service» is set only by closing work: register_equipment_visit() now also reads the
--    request's task items (the old job_works table is no longer written). The equipment dialog's
--    «✔ плановое ТО» button, which wrote the date directly, is gone; a direct write from the app
--    is refused.
-- 4. A client with requests or equipment can not be turned into a depot.
-- 5. Clients get contact person, street address and site access notes.

alter table public.clients
  add column if not exists contact_person text,
  add column if not exists address text,
  add column if not exists access_notes text;

-- Active tasks of a client, for the delete dialog and the server check.
create or replace function public.client_active_tasks(p_id uuid)
returns table(id uuid, number bigint, title text, status text, trip_from date)
language sql stable security definer set search_path to 'public' as $$
  select o.id, o.number, o.title, o.status,
         (select min(t.date_from) from trip_service_orders l join trips t on t.id=l.trip_id
           where l.order_id=o.id and t.deleted_at is null)
    from service_orders o join jobs j on j.id=o.job_id
   where j.client_id=p_id and j.deleted_at is null
     and o.status in ('draft','assigned','in_progress','paused','review')
     and public.is_staff()
   order by o.number;
$$;
revoke all on function public.client_active_tasks(uuid) from public, anon;
grant execute on function public.client_active_tasks(uuid) to authenticated;

create or replace function public.soft_delete_client(p_id uuid)
returns timestamp with time zone
language plpgsql security definer set search_path to 'public' as $function$
declare ts timestamptz := clock_timestamp(); blockers text;
begin
  if coalesce(public.user_role(),'') not in ('admin','logist') then
    raise exception 'Недостаточно прав для удаления';
  end if;
  select string_agg('№'||number, ', ' order by number) into blockers from public.client_active_tasks(p_id);
  if blockers is not null then
    raise exception 'У клиента активные задания: %. Отмените или завершите их.', blockers;
  end if;
  update clients   set deleted_at = ts where id = p_id       and deleted_at is null;
  update equipment set deleted_at = ts where client_id = p_id and deleted_at is null;
  update jobs      set deleted_at = ts where client_id = p_id and deleted_at is null;
  return ts;
end; $function$;

create or replace function public.soft_delete_equipment(p_id uuid)
returns timestamp with time zone
language plpgsql security definer set search_path to 'public' as $function$
declare ts timestamptz := clock_timestamp(); blockers text;
begin
  if coalesce(public.user_role(),'') not in ('admin','logist') then
    raise exception 'Недостаточно прав для удаления';
  end if;
  select string_agg(coalesce('№'||j.number::text,'без номера'), ', ' order by j.number) into blockers
    from jobs j
   where j.equipment_id=p_id and j.deleted_at is null and j.status not in ('done','cancelled');
  if blockers is not null then
    raise exception 'На технику открыты заявки: %. Закройте или отмените их.', blockers;
  end if;
  update equipment set deleted_at = ts where id = p_id and deleted_at is null;
  return ts;
end; $function$;
revoke all on function public.soft_delete_equipment(uuid) from public, anon;
grant execute on function public.soft_delete_equipment(uuid) to authenticated;

create or replace function public.register_equipment_visit(p_job uuid)
returns void
language plpgsql security definer set search_path to 'public' as $function$
declare eq uuid; vdate date; st text; has_maint boolean;
begin
  if not public.is_staff() then raise exception 'Нужен вход в систему'; end if;
  select equipment_id, coalesce(scheduled_date, current_date), status
    into eq, vdate, st from jobs where id = p_job;
  if eq is null or st <> 'done' then return; end if;
  update equipment set last_visit = greatest(coalesce(last_visit,'1900-01-01'::date), vdate)
   where id = eq;
  select exists(select 1 from job_works jw
                  left join work_catalog wc on wc.id = jw.work_id
                 where jw.job_id = p_job and coalesce(wc.is_maintenance,false))
      or exists(select 1 from service_order_items i
                  join service_orders o on o.id = i.order_id
                  join work_catalog wc on wc.id = i.work_catalog_id
                 where i.job_id = p_job and i.kind = 'work' and wc.is_maintenance
                   and o.status <> 'cancelled'
                   and (coalesce(i.done_qty,0) > 0 or o.status = 'completed'))
    into has_maint;
  if has_maint then
    update equipment set last_service = greatest(coalesce(last_service,'1900-01-01'::date), vdate)
     where id = eq;
  end if;
end; $function$;

-- Visit and service dates come from closed work only. Server functions run as their owner and
-- pass; a direct update from the app (role authenticated) is refused.
create or replace function dlight_private.guard_equipment_service_dates()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon')
     and (new.last_service is distinct from old.last_service or new.last_visit is distinct from old.last_visit) then
    raise exception 'Дата ТО и визита ставится закрытием заявки с работой «ТО»';
  end if;
  return new;
end $$;
drop trigger if exists equipment_service_dates_guard on public.equipment;
create trigger equipment_service_dates_guard before update of last_service, last_visit on public.equipment
  for each row execute function dlight_private.guard_equipment_service_dates();

create or replace function dlight_private.guard_client_depot_switch()
returns trigger language plpgsql as $$
begin
  if new.is_base and not coalesce(old.is_base,false)
     and (exists(select 1 from public.jobs where client_id=new.id and deleted_at is null)
          or exists(select 1 from public.equipment where client_id=new.id and deleted_at is null)) then
    raise exception 'Депо нельзя: у клиента есть заявки или техника';
  end if;
  return new;
end $$;
drop trigger if exists clients_depot_switch_guard on public.clients;
create trigger clients_depot_switch_guard before update of is_base on public.clients
  for each row execute function dlight_private.guard_client_depot_switch();
