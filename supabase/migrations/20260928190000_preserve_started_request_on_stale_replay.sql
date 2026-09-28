-- An old offline client sends a whole request header without a revision. Once
-- a task has started, that stale header must not undo workflow or assignment.
-- Keep the legacy RPC accepting its note and safe row edits so old clients do
-- not discard the queued action on a server rejection.
begin;

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
  -- A maintenance transaction can carry a test JWT while running as the
  -- database owner. Only treat an authenticated client as an engineer replay.
  if (current_setting('role',true)='authenticated' and public.user_role()='engineer') or stale_status then
    -- order_transition has just marked the task in progress and now advances
    -- the request. Allow that forward transition even when the actor is an
    -- engineer; a stale client can only try to move it backwards.
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

revoke all on function dlight_private.preserve_started_request_on_replay() from public,anon,authenticated;
create trigger aa_jobs_preserve_started_request before update on public.jobs
for each row execute function dlight_private.preserve_started_request_on_replay();

commit;
