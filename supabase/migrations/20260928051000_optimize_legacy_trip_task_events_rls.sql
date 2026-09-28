begin;
drop policy trip_legacy_task_events_read on public.trip_legacy_task_events;
create policy trip_legacy_task_events_read on public.trip_legacy_task_events
  for select to authenticated using (exists (
    select 1 from public.trips t where t.id = trip_id and coalesce(
      (select public.user_role()) in ('admin', 'logist') or t.lead_engineer = (select auth.uid())
      or (select auth.uid()) = any(coalesce(t.engineer_ids, '{}'::uuid[])), false)
  ));
commit;
