-- Cover the audit table foreign keys used in lookups and row deletion checks.
begin;

create index if not exists request_finance_void_events_order_idx
  on public.request_finance_void_events(order_id);
create index if not exists request_finance_void_events_actor_idx
  on public.request_finance_void_events(actor_id);
create index if not exists request_finance_correction_links_actor_idx
  on public.request_finance_correction_links(actor_id);

commit;
