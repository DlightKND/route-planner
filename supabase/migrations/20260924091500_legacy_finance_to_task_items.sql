-- Preserve legacy work/material accounting on request-owned base tasks.
-- This is an additive, atomic backfill: legacy source tables remain live
-- until every reader and writer is switched in a later release.
begin;

alter table public.service_order_items
  add column created_at timestamptz not null default now(),
  add column legacy_job_work_id uuid references public.job_works(id) on delete restrict,
  add column legacy_job_part_id uuid references public.job_parts(id) on delete restrict,
  add column legacy_snapshot jsonb not null default '{}'::jsonb,
  add column work_catalog_id uuid references public.work_catalog(id) on delete restrict,
  add column billable boolean not null default true,
  add column billable_reason text not null default '',
  add column tariff_profile text,
  add column financial_revenue_snapshot numeric,
  add column financial_cost_snapshot numeric,
  add column approved_at timestamptz,
  add column approved_by uuid,
  add constraint service_order_items_legacy_source_check check (
    not (legacy_job_work_id is not null and legacy_job_part_id is not null)
    and (legacy_job_work_id is null or kind='work')
    and (legacy_job_part_id is null or kind='material')
  );

create unique index service_order_items_legacy_work_uidx
  on public.service_order_items(legacy_job_work_id) where legacy_job_work_id is not null;
create unique index service_order_items_legacy_part_uidx
  on public.service_order_items(legacy_job_part_id) where legacy_job_part_id is not null;
create index service_order_items_work_catalog_idx
  on public.service_order_items(work_catalog_id) where work_catalog_id is not null;

-- Requests with legacy accounting lines need a canonical task to own those
-- lines. Existing trip-seeded tasks are reused; new tasks stay drafts and do
-- not infer completion, staffing, schedule, or actual quantity from old rows.
insert into public.service_orders(title,status,work_mode,job_id,seed_request_id)
select 'Мигрированное задание по заявке','draft',
       case when coalesce(j.at_depot,false) then 'depot' else 'onsite' end,
       j.id,j.id
from public.jobs j
where (exists(select 1 from public.job_works w where w.job_id=j.id)
       or exists(select 1 from public.job_parts p where p.job_id=j.id))
  and not exists(select 1 from public.service_orders o where o.seed_request_id=j.id)
on conflict(seed_request_id) do nothing;

insert into public.service_order_jobs(order_id,job_id,snapshot)
select o.id,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name)
from public.service_orders o
join public.jobs j on j.id=o.seed_request_id
left join public.clients c on c.id=j.client_id
where exists(select 1 from public.job_works w where w.job_id=j.id)
   or exists(select 1 from public.job_parts p where p.job_id=j.id)
on conflict(order_id,job_id) do nothing;

do $$
begin
  if exists (
    select 1 from public.job_parts p
    left join public.stock_catalog s on s.legacy_part_id=p.id
    where s.id is null
  ) then
    raise exception 'Не все legacy job_parts имеют снимок в stock_catalog';
  end if;
  if exists (
    select 1 from (
      select w.job_id from public.job_works w
      union
      select p.job_id from public.job_parts p
    ) src
    where not exists(select 1 from public.service_orders o where o.seed_request_id=src.job_id)
  ) then
    raise exception 'Для legacy финансовой строки не найдено базовое задание заявки';
  end if;
  if exists(select 1 from public.job_works where coalesce(hours,0)<=0)
     or exists(select 1 from public.job_parts where coalesce(qty,0)<=0) then
    raise exception 'Нулевая или отрицательная legacy-строка требует ручного разбора';
  end if;
end $$;

insert into public.service_order_items(
  order_id,job_id,title,unit,planned_qty,done_qty,kind,work_catalog_id,
  legacy_job_work_id,legacy_snapshot,billable,billable_reason,tariff_profile,
  unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot,
  approved_at,approved_by,created_at
)
select o.id,w.job_id,coalesce(nullif(btrim(w.title),''),wc.name,'Импортированная работа'),
       'ч',w.hours,0,'work',w.work_id,w.id,to_jsonb(w),coalesce(w.billable,true),
       coalesce(w.billable_reason,''),w.tariff_profile,
       coalesce(nullif(s.costs->>'hour','')::numeric,0),coalesce(w.revenue,0),
       w.hours*coalesce(nullif(s.costs->>'hour','')::numeric,0),
       w.approved_at,w.approved_by,coalesce(w.created_at,now())
from public.job_works w
join public.service_orders o on o.seed_request_id=w.job_id
left join public.work_catalog wc on wc.id=w.work_id
left join public.settings s on s.id=true
on conflict do nothing;

insert into public.service_order_items(
  order_id,job_id,title,unit,planned_qty,done_qty,kind,stock_catalog_id,
  sku_snapshot,unit_price_snapshot,unit_cost_snapshot,
  legacy_job_part_id,legacy_snapshot,billable,
  financial_revenue_snapshot,financial_cost_snapshot,
  approved_at,approved_by,created_at
)
select o.id,p.job_id,btrim(p.name),coalesce(nullif(btrim(p.unit),''),'шт'),
       p.qty,0,'material',s.id,s.sku,p.price,p.cost,p.id,to_jsonb(p),p.billable,
       case when p.billable then p.qty*p.price else 0 end,p.qty*p.cost,
       p.approved_at,p.approved_by,p.created_at
from public.job_parts p
join public.service_orders o on o.seed_request_id=p.job_id
join public.stock_catalog s on s.legacy_part_id=p.id
on conflict do nothing;

do $$
declare
  work_cost_rate numeric:=coalesce((select nullif(costs->>'hour','')::numeric from public.settings where id=true),0);
begin
  if exists(select 1 from public.job_works w left join public.service_order_items i
            on i.legacy_job_work_id=w.id
            where i.id is null or i.legacy_snapshot is distinct from to_jsonb(w)) then
    raise exception 'Backfill job_works неполон или снимок отличается от источника';
  end if;
  if exists(select 1 from public.job_parts p left join public.service_order_items i
            on i.legacy_job_part_id=p.id
            where i.id is null or i.legacy_snapshot is distinct from to_jsonb(p)) then
    raise exception 'Backfill job_parts неполон или снимок отличается от источника';
  end if;
  if (select count(*) from public.job_works)<>
     (select count(*) from public.service_order_items where legacy_job_work_id is not null)
     or (select coalesce(sum(hours),0) from public.job_works)<>
        (select coalesce(sum(planned_qty),0) from public.service_order_items where legacy_job_work_id is not null)
     or (select coalesce(sum(revenue),0) from public.job_works)<>
        (select coalesce(sum(financial_revenue_snapshot),0) from public.service_order_items where legacy_job_work_id is not null)
     or (select coalesce(sum(hours*work_cost_rate),0) from public.job_works)<>
        (select coalesce(sum(financial_cost_snapshot),0) from public.service_order_items where legacy_job_work_id is not null) then
    raise exception 'Финансовые итоги job_works не совпали после backfill';
  end if;
  if (select count(*) from public.job_parts)<>
     (select count(*) from public.service_order_items where legacy_job_part_id is not null)
     or (select coalesce(sum(qty),0) from public.job_parts)<>
        (select coalesce(sum(planned_qty),0) from public.service_order_items where legacy_job_part_id is not null)
     or (select coalesce(sum(case when billable then qty*price else 0 end),0) from public.job_parts)<>
        (select coalesce(sum(financial_revenue_snapshot),0) from public.service_order_items where legacy_job_part_id is not null)
     or (select coalesce(sum(qty*cost),0) from public.job_parts)<>
        (select coalesce(sum(financial_cost_snapshot),0) from public.service_order_items where legacy_job_part_id is not null) then
    raise exception 'Финансовые итоги job_parts не совпали после backfill';
  end if;
end $$;

-- Preserve historical task/trip participation through canonical request tasks.
insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source)
select old.legacy_trip_id,seed.id,coalesce(min(tj.ord),0),'historical_backfill'
from public.service_order_jobs old_job
join public.service_orders old on old.id=old_job.order_id and old.legacy_trip_id is not null
join public.service_orders seed on seed.seed_request_id=old_job.job_id
left join public.trip_jobs tj on tj.trip_id=old.legacy_trip_id and tj.job_id=old_job.job_id
group by old.legacy_trip_id,seed.id
on conflict(trip_id,order_id) do nothing;

update public.trip_stays stay
set service_order_id=seed.id
from public.service_orders seed
where stay.service_order_id is null and stay.job_id=seed.job_id
  and exists(select 1 from public.trip_service_orders tso
             where tso.trip_id=stay.trip_id and tso.order_id=seed.id);

insert into public.service_order_history(order_id,reason,snapshot)
select o.id,'Исторические работы и материалы перенесены из заявки',
       dlight_private.order_snapshot(o.id)
from public.service_orders o
where o.seed_request_id is not null
  and (exists(select 1 from public.service_order_items i where i.order_id=o.id and i.legacy_job_work_id is not null)
       or exists(select 1 from public.service_order_items i where i.order_id=o.id and i.legacy_job_part_id is not null))
  and not exists(select 1 from public.service_order_history h where h.order_id=o.id
                 and h.reason='Исторические работы и материалы перенесены из заявки');

create function dlight_private.guard_legacy_task_finance()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.legacy_job_work_id is not null or old.legacy_job_part_id is not null then
      raise exception 'Импортированную финансовую строку нельзя удалить из задания';
    end if;
    return old;
  end if;
  if (new.legacy_job_work_id,new.legacy_job_part_id,new.legacy_snapshot,
      new.work_catalog_id,new.billable,new.billable_reason,new.tariff_profile,
      new.kind,new.title,new.unit,new.planned_qty,new.stock_catalog_id,new.sku_snapshot,
      new.unit_price_snapshot,new.unit_cost_snapshot,
      new.financial_revenue_snapshot,new.financial_cost_snapshot,
      new.approved_at,new.approved_by,new.created_at)
     is distinct from
     (old.legacy_job_work_id,old.legacy_job_part_id,old.legacy_snapshot,
      old.work_catalog_id,old.billable,old.billable_reason,old.tariff_profile,
      old.kind,old.title,old.unit,old.planned_qty,old.stock_catalog_id,old.sku_snapshot,
      old.unit_price_snapshot,old.unit_cost_snapshot,
      old.financial_revenue_snapshot,old.financial_cost_snapshot,
      old.approved_at,old.approved_by,old.created_at)
     and (old.legacy_job_work_id is not null or old.legacy_job_part_id is not null) then
    raise exception 'Импортированная строка заявки заблокирована до переключения финансовых записей';
  end if;
  return new;
end $$;
revoke all on function dlight_private.guard_legacy_task_finance() from public,anon,authenticated;
drop trigger if exists service_order_items_legacy_finance_guard on public.service_order_items;
create trigger service_order_items_legacy_finance_guard
before update or delete on public.service_order_items
for each row execute function dlight_private.guard_legacy_task_finance();

commit;
