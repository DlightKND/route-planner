-- Distinguish the old whole-request RPC from current canonical writes.
-- Its header has no revision, so even a manager's offline snapshot with an
-- unchanged in_progress status can carry a stale assignment.
begin;

-- Hosted roles cannot attach a custom GUC through ALTER FUNCTION, but the
-- legacy invoker RPC can set it for its own UPDATE and restore it afterwards.
-- Patch only the unique, audited UPDATE block without replacing its entire
-- 11 KB body or changing its invoker privileges.
do $$
declare
  definition text;
  before_update constant text := E'  if p_id is not null then\n    update public.jobs set client_id=';
  before_return constant text := E'    if not found then raise exception ''Заявка не найдена или недоступна''; end if;\n  end if;\n  return jsonb_build_object';
begin
  select pg_get_functiondef('public.job_request_save(uuid,jsonb,jsonb,jsonb)'::regprocedure)
    into definition;
  if position(before_update in definition)=0 or position(before_return in definition)=0
     or position('dlight.legacy_request_save' in definition)>0 then
    raise exception 'Unexpected legacy request RPC body; review before patching';
  end if;
  definition:=replace(definition,before_update,
    E'  if p_id is not null then\n    perform set_config(''dlight.legacy_request_save'',''on'',true);\n    update public.jobs set client_id=');
  definition:=replace(definition,before_return,
    E'    if not found then raise exception ''Заявка не найдена или недоступна''; end if;\n    perform set_config(''dlight.legacy_request_save'',''off'',true);\n  end if;\n  return jsonb_build_object');
  execute definition;
end $$;

create or replace function dlight_private.preserve_started_request_on_replay()
returns trigger language plpgsql security definer set search_path='' as $$
declare active_task boolean; stale_status boolean;
begin
  if new is not distinct from old then return new; end if;
  select exists(
    select 1 from public.service_orders o
    where o.job_id=old.id and o.status in ('in_progress','paused','review')
  ) into active_task;
  if not active_task then return new; end if;

  stale_status := old.status='in_progress' and new.status in ('open','planned');
  -- The legacy RPC marks its own call frame; the setting is restored on
  -- function exit, so a later canonical write is not treated as a replay.
  if current_setting('dlight.legacy_request_save',true)='on'
     or (current_setting('role',true)='authenticated' and public.user_role()='engineer')
     or stale_status then
    if not (old.status in ('open','planned') and new.status='in_progress') then
      new.status:=old.status;
    end if;
    new.client_id:=old.client_id;
    new.equipment_id:=old.equipment_id;
    new.scheduled_date:=old.scheduled_date;
    new.time_window:=old.time_window;
    new.due_date:=old.due_date;
    new.assigned_engineer:=old.assigned_engineer;
    new.engineer_ids:=old.engineer_ids;
    new.at_depot:=old.at_depot;
    new.depot_id:=old.depot_id;
  end if;
  return new;
end $$;

commit;
