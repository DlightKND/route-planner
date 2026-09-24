-- Prevent approval metadata changes on finance tombstones.
begin;

-- Keep tombstones immutable through the manager approval RPC as well.
create or replace function dlight_private.request_finance_approve(p_job uuid,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare oid uuid; changed integer;
begin
  if auth.uid() is null or coalesce(public.user_role() in ('admin','logist'),false) is not true then
    raise exception 'Подтверждает только диспетчер';
  end if;
  perform set_config('dlight.request_finance_sync','on',true);
  select id into oid from public.service_orders where seed_request_id=p_job;
  if oid is null then raise exception 'Не найдено базовое задание заявки'; end if;
  update public.service_order_items set approved_at=now(),approved_by=auth.uid()
   where order_id=oid and job_id=p_job and id=any(coalesce(p_ids,'{}'::uuid[])) and approved_at is null
     and legacy_job_work_id is null and legacy_job_part_id is null and request_finance_void_event_id is null;
  get diagnostics changed=row_count;
  if changed<>cardinality(coalesce(p_ids,'{}'::uuid[])) then raise exception 'Не все строки доступны для подтверждения'; end if;
  perform set_config('dlight.request_finance_sync','off',true);
  return changed;
end $$;

commit;
