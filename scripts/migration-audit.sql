-- Read-only reconciliation of historical request/trip data with canonical tasks.
-- Run against the intended Supabase project after checking its project ID.
-- A zero in the *_missing and *_mismatch fields is required. An explicit
-- empty stay allocation is a recorded decision, not a missing backfill.
with work_rows as (
  select w.id, w.hours, w.revenue, i.id as item_id,
    i.planned_qty, i.financial_revenue_snapshot
  from public.job_works w
  left join public.service_order_items i on i.legacy_job_work_id = w.id
), material_rows as (
  select p.id, p.qty, p.price, p.cost, p.billable, i.id as item_id,
    i.planned_qty, i.unit_price_snapshot, i.unit_cost_snapshot, i.billable as item_billable
  from public.job_parts p
  left join public.service_order_items i on i.legacy_job_part_id = p.id
), checks as (
  select
    (select count(*) from public.jobs where deleted_at is null) as requests,
    (select count(*) from public.service_orders where job_id is not null) as canonical_tasks,
    (select count(*) from public.service_orders where job_id is null and legacy_trip_id is not null) as retained_shadow_tasks,
    (select count(*) from public.trips where deleted_at is null) as trips,
    (select count(*) from public.jobs j join public.service_orders o on o.seed_request_id=j.id and o.job_id=j.id
      where j.deleted_at is null and j.status='done' and o.status='draft') as historical_done_requests_with_draft_tasks,
    (select count(*) from public.service_order_items i join public.jobs j on j.id=i.job_id
      where j.deleted_at is null and j.status='done' and i.planned_qty>0 and i.done_qty=0) as historical_done_request_items_without_task_fact,
    (select count(*) from public.trip_stays where job_id is null and status = 'detected') as detected_stays_without_request,
    (select count(*) from public.trip_stays where job_id is null and status = 'approved') as approved_stays_without_request,
    (select count(*) from public.trip_stays s where s.job_id is null and s.status = 'detected'
      and (select count(distinct tj.job_id) from public.trip_jobs tj where tj.trip_id = s.trip_id) = 1) as detected_stays_on_single_request_trips,
    (select count(*) from public.trip_stays s where s.job_id is null and s.status = 'detected'
      and (select count(distinct tj.job_id) from public.trip_jobs tj where tj.trip_id = s.trip_id) > 1) as detected_stays_on_multi_request_trips,
    (select count(*) from public.service_order_items i join public.service_orders o on o.id = i.order_id
      where o.job_id is null and o.legacy_trip_id is not null) as legacy_shadow_items_pending_review,
    (select count(*) from public.job_photos) as request_photos_retained,
    (select count(*) from public.jobs j where j.deleted_at is null and not exists
      (select 1 from public.service_orders o where o.seed_request_id = j.id and o.job_id = j.id)) as requests_without_seed,
    (select count(*) from (
      select j.id from public.jobs j
      left join public.service_orders o on o.seed_request_id = j.id and o.job_id = j.id
      where j.deleted_at is null group by j.id having count(o.id) > 1
    ) duplicates) as requests_with_multiple_seeds,
    (select count(*) from work_rows where item_id is null) as works_missing,
    (select count(*) from work_rows where item_id is not null and
      (hours is distinct from planned_qty or revenue is distinct from financial_revenue_snapshot)) as works_mismatch,
    (select count(*) from material_rows where item_id is null) as materials_missing,
    (select count(*) from material_rows where item_id is not null and
      (qty is distinct from planned_qty or price is distinct from unit_price_snapshot
       or cost is distinct from unit_cost_snapshot or billable is distinct from item_billable)) as materials_mismatch,
    (select count(*) from public.trip_jobs tj where not exists
      (select 1 from public.trip_service_orders l join public.service_orders o on o.id = l.order_id
       where l.trip_id = tj.trip_id and o.job_id = tj.job_id)) as trip_request_links_missing,
    (select count(*) from public.trip_stays s where s.job_id is not null and s.status = 'approved'
      and not s.task_allocations_explicit and not exists
      (select 1 from public.trip_stay_task_allocations a where a.stay_id = s.id)) as approved_stays_missing_allocation,
    (select count(*) from public.trip_stays s where s.job_id is not null and s.status = 'approved'
      and s.task_allocations_explicit and not exists
      (select 1 from public.trip_stay_task_allocations a where a.stay_id = s.id)) as explicitly_unallocated_stays,
    (select count(*) from public.service_order_history h join public.service_orders o on o.id = h.order_id
      where o.job_id is null and o.legacy_trip_id is not null) as retained_shadow_history,
    (select count(*) from public.service_order_history h join public.service_orders o on o.id = h.order_id
      where o.job_id is null and o.legacy_trip_id is not null and not exists
      (select 1 from public.trip_legacy_task_events e where e.source_history_id = h.id
       and e.legacy_order_id = o.id and e.trip_id = o.legacy_trip_id)) as shadow_history_missing_archive,
    (select count(*) from public.trip_legacy_task_events e
      left join public.service_order_history h on h.id = e.source_history_id
      left join public.service_orders o on o.id = e.legacy_order_id
      where h.id is null or o.id is null or h.order_id is distinct from o.id
         or e.trip_id is distinct from o.legacy_trip_id
         or e.actor_id is distinct from h.actor_id or e.recorded_at is distinct from h.recorded_at
         or e.reason is distinct from h.reason or e.snapshot is distinct from h.snapshot) as shadow_archive_mismatch,
    (select count(*) from public.service_order_items i join public.service_orders o on o.id = i.order_id
      where o.job_id is not null and i.job_id is distinct from o.job_id) as canonical_item_job_mismatch,
    (select count(*) from public.service_order_items i
      where i.legacy_snapshot->>'request_finance_generation' = '1') as new_finance_rows,
    (select count(*) from public.service_order_items i
      left join public.service_orders o on o.id = i.order_id
      where i.legacy_snapshot->>'request_finance_generation' = '1'
        and (o.id is null or o.seed_request_id is distinct from i.job_id
          or o.job_id is distinct from i.job_id)) as new_finance_rows_without_seed,
    (select count(*) from public.service_order_items where done_qty > 0) as items_with_fact,
    (select count(*) from public.service_order_items where transferred_qty > 0) as items_with_transfer
)
select *,
  requests_without_seed = 0 and requests_with_multiple_seeds = 0
  and works_missing = 0 and works_mismatch = 0
  and materials_missing = 0 and materials_mismatch = 0
  and trip_request_links_missing = 0 and approved_stays_missing_allocation = 0
  and approved_stays_without_request = 0
  and shadow_history_missing_archive = 0 and shadow_archive_mismatch = 0
  and canonical_item_job_mismatch = 0 and new_finance_rows_without_seed = 0
  as historical_backfill_consistent
from checks;
