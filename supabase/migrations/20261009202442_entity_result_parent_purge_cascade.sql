-- Result snapshots remain client-immutable, but must not add a new blocker to
-- authorized parent cleanup. Existing request/task purge dependencies remain.
begin;
alter table public.service_order_result_events
  drop constraint service_order_result_events_order_id_fkey,
  add constraint service_order_result_events_order_id_fkey
    foreign key(order_id) references public.service_orders(id) on delete cascade;
commit;
