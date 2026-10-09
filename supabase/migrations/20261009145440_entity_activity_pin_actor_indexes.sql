-- Cover the pin-author FKs independently from the entity timeline indexes.
begin;
create index job_comments_pinned_by_idx on public.job_comments(pinned_by) where pinned_by is not null;
create index service_order_comments_pinned_by_idx on public.service_order_comments(pinned_by) where pinned_by is not null;
create index trip_comments_pinned_by_idx on public.trip_comments(pinned_by) where pinned_by is not null;
commit;
