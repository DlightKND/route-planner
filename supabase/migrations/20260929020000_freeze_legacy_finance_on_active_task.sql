-- Old clients can replay a complete request work/material plan without a
-- revision. Keep the historical source and canonical financial snapshot
-- stable once a task has passed the editable stages. Corrective finance has
-- its own audited task operations.
begin;

create function dlight_private.freeze_legacy_finance_on_active_task()
returns trigger language plpgsql security definer set search_path='' as $$
declare jid uuid;
begin
  if current_setting('role',true) <> 'authenticated' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='UPDATE' and new is not distinct from old then return new; end if;
  if tg_op='DELETE' then jid:=old.job_id; else jid:=new.job_id; end if;
  if exists(
    select 1 from public.service_orders o where o.job_id=jid
      and o.status not in ('draft','assigned','paused')
  ) then
    raise exception 'Состав работ и материалов нельзя менять после начала выполнения задания';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

revoke all on function dlight_private.freeze_legacy_finance_on_active_task() from public,anon,authenticated;
create trigger aa_job_works_freeze_active_task before insert or update or delete on public.job_works
  for each row execute function dlight_private.freeze_legacy_finance_on_active_task();
create trigger aa_job_parts_freeze_active_task before insert or update or delete on public.job_parts
  for each row execute function dlight_private.freeze_legacy_finance_on_active_task();

commit;
