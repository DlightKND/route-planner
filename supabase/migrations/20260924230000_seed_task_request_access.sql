-- Request assignees need read access to the canonical seed task for their
-- request. This keeps request editing and the request-to-task finance view in
-- sync without granting access to unrelated tasks on the same trip.
begin;

create or replace function dlight_private.order_access(p_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and coalesce(
    public.user_role() in ('admin','logist')
    or (public.user_role()='engineer' and (
      exists(
        select 1 from public.service_orders o
        where o.id=p_id and auth.uid()=any(o.engineer_ids)
      )
      or exists(
        select 1 from public.trip_service_orders tso
        join public.trips t on t.id=tso.trip_id
        where tso.order_id=p_id
          and (auth.uid()=t.lead_engineer or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])))
      )
      or exists(
        select 1 from public.service_orders o
        join public.jobs j on j.id=o.seed_request_id and j.id=o.job_id
        where o.id=p_id
          and (auth.uid()=j.assigned_engineer or auth.uid()=any(coalesce(j.engineer_ids,'{}'::uuid[])))
      )
    )),false)
$$;

notify pgrst,'reload schema';
commit;
