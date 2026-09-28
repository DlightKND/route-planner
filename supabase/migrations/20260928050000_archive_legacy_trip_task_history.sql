begin;

-- Preserve the old trip-shadow task's audit without presenting its status or
-- plan as the status or plan of the canonical request task. The source event
-- stays in service_order_history for offline clients and provenance.
create table public.trip_legacy_task_events (
  source_history_id bigint primary key references public.service_order_history(id),
  trip_id uuid not null references public.trips(id) on delete cascade,
  legacy_order_id uuid not null references public.service_orders(id),
  actor_id uuid,
  recorded_at timestamptz not null,
  reason text not null,
  snapshot jsonb not null
);
create index trip_legacy_task_events_trip_time_idx
  on public.trip_legacy_task_events(trip_id, recorded_at desc, source_history_id desc);
create index trip_legacy_task_events_order_idx
  on public.trip_legacy_task_events(legacy_order_id);

alter table public.trip_legacy_task_events enable row level security;
revoke all on public.trip_legacy_task_events from public, anon, authenticated;
grant select on public.trip_legacy_task_events to authenticated;
create policy trip_legacy_task_events_read on public.trip_legacy_task_events
  for select to authenticated using (exists (
    select 1 from public.trips t where t.id = trip_id and coalesce(
      public.user_role() in ('admin', 'logist') or t.lead_engineer = auth.uid()
      or auth.uid() = any(coalesce(t.engineer_ids, '{}'::uuid[])), false)
  ));

insert into public.trip_legacy_task_events
  (source_history_id, trip_id, legacy_order_id, actor_id, recorded_at, reason, snapshot)
select h.id, o.legacy_trip_id, o.id, h.actor_id, h.recorded_at, h.reason, h.snapshot
from public.service_order_history h
join public.service_orders o on o.id = h.order_id
join public.trips t on t.id = o.legacy_trip_id
where o.job_id is null and o.legacy_trip_id is not null
on conflict (source_history_id) do nothing;

-- A delayed legacy client may still record an event on the shadow task.
-- Copy only that event; it never changes the canonical task or trip revision.
create function dlight_private.archive_legacy_trip_task_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_legacy_task_events
    (source_history_id, trip_id, legacy_order_id, actor_id, recorded_at, reason, snapshot)
  select new.id, o.legacy_trip_id, o.id, new.actor_id, new.recorded_at, new.reason, new.snapshot
  from public.service_orders o
  where o.id = new.order_id and o.job_id is null and o.legacy_trip_id is not null
  on conflict (source_history_id) do nothing;
  return new;
end $$;
revoke all on function dlight_private.archive_legacy_trip_task_event() from public, anon, authenticated;
create trigger archive_legacy_trip_task_event after insert on public.service_order_history
  for each row execute function dlight_private.archive_legacy_trip_task_event();

commit;
