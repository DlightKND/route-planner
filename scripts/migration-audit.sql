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
    (select count(*) from public.jobs j where j.deleted_at is null and not exists
      (select 1 from public.service_orders o where o.seed_request_id = j.id and o.job_id = j.id)) as requests_without_seed,
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
    (select count(*) from public.service_order_items where done_qty > 0) as items_with_fact,
    (select count(*) from public.service_order_items where transferred_qty > 0) as items_with_transfer
)
select *,
  requests_without_seed = 0 and works_missing = 0 and works_mismatch = 0
  and materials_missing = 0 and materials_mismatch = 0
  and trip_request_links_missing = 0 and approved_stays_missing_allocation = 0
  as historical_backfill_consistent
from checks;
