-- Keep the request editor's legacy ledger and the canonical task line atomic
-- while reports and editors are moved to service_order_items in later PRs.
begin;

create or replace function dlight_private.guard_legacy_task_finance()
returns trigger language plpgsql set search_path='' as $$
begin
  -- Only the SECURITY DEFINER synchronization triggers set this transaction
  -- local flag; normal task edits cannot mutate imported scope or money.
  if coalesce(current_setting('dlight.legacy_finance_sync',true),'')='on' then
    return new;
  end if;
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

create function dlight_private.sync_job_work_to_task()
returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; rate numeric;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.service_order_items i where i.legacy_job_work_id=old.id) then
      raise exception 'Работу уже перенесли в задание; сначала аннулируй её согласованным способом';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and new.job_id is distinct from old.job_id and
     exists(select 1 from public.service_order_items i where i.legacy_job_work_id=old.id) then
    raise exception 'Нельзя перенести работу с исходной заявки';
  end if;
  if coalesce(new.hours,0)<=0 then
    if exists(select 1 from public.service_order_items i where i.legacy_job_work_id=new.id) then
      raise exception 'Нельзя обнулить объём перенесённой работы';
    end if;
    return new;
  end if;

  oid:=dlight_private.ensure_request_seed(new.job_id);
  select coalesce(nullif(costs->>'hour','')::numeric,0) into rate
  from public.settings where id=true;
  rate:=coalesce(rate,0);
  perform set_config('dlight.legacy_finance_sync','on',true);
  insert into public.service_order_items(
    order_id,job_id,title,unit,planned_qty,done_qty,kind,work_catalog_id,
    legacy_job_work_id,legacy_snapshot,billable,billable_reason,tariff_profile,
    unit_cost_snapshot,financial_revenue_snapshot,financial_cost_snapshot,
    approved_at,approved_by,created_at
  ) values (
    oid,new.job_id,coalesce(nullif(btrim(new.title),''),
      (select wc.name from public.work_catalog wc where wc.id=new.work_id),'Импортированная работа'),
    'ч',new.hours,0,'work',new.work_id,new.id,to_jsonb(new),coalesce(new.billable,true),
    coalesce(new.billable_reason,''),new.tariff_profile,rate,coalesce(new.revenue,0),
    new.hours*rate,new.approved_at,new.approved_by,coalesce(new.created_at,now())
  )
  on conflict (legacy_job_work_id) where legacy_job_work_id is not null do update set
    order_id=excluded.order_id,job_id=excluded.job_id,title=excluded.title,unit=excluded.unit,
    planned_qty=excluded.planned_qty,kind='work',work_catalog_id=excluded.work_catalog_id,
    legacy_snapshot=excluded.legacy_snapshot,billable=excluded.billable,
    billable_reason=excluded.billable_reason,tariff_profile=excluded.tariff_profile,
    unit_cost_snapshot=excluded.unit_cost_snapshot,
    financial_revenue_snapshot=excluded.financial_revenue_snapshot,
    financial_cost_snapshot=excluded.financial_cost_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,created_at=excluded.created_at;
  perform set_config('dlight.legacy_finance_sync','off',true);
  return new;
end $$;
revoke all on function dlight_private.sync_job_work_to_task() from public,anon,authenticated;
drop trigger if exists job_works_sync_task on public.job_works;
create trigger job_works_sync_task after insert or update on public.job_works
for each row execute function dlight_private.sync_job_work_to_task();
drop trigger if exists job_works_prevent_migrated_delete on public.job_works;
create trigger job_works_prevent_migrated_delete before delete on public.job_works
for each row execute function dlight_private.sync_job_work_to_task();

create function dlight_private.sync_job_part_to_task()
returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; catalog_id uuid;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.service_order_items i where i.legacy_job_part_id=old.id) then
      raise exception 'Материал уже перенесён в задание; сначала аннулируй его согласованным способом';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and new.job_id is distinct from old.job_id and
     exists(select 1 from public.service_order_items i where i.legacy_job_part_id=old.id) then
    raise exception 'Нельзя перенести материал с исходной заявки';
  end if;
  if coalesce(new.qty,0)<=0 then
    if exists(select 1 from public.service_order_items i where i.legacy_job_part_id=new.id) then
      raise exception 'Нельзя обнулить количество перенесённого материала';
    end if;
    return new;
  end if;

  oid:=dlight_private.ensure_request_seed(new.job_id);
  select id into catalog_id from public.stock_catalog where legacy_part_id=new.id;
  if catalog_id is null then
    insert into public.stock_catalog(name,sku,unit,price,cost,legacy_part_id,created_by)
    values(btrim(new.name),coalesce(new.sku,''),coalesce(nullif(btrim(new.unit),''),'шт'),
      new.price,new.cost,new.id,new.created_by)
    on conflict(legacy_part_id) do nothing;
    select id into catalog_id from public.stock_catalog where legacy_part_id=new.id;
  end if;
  if catalog_id is null then raise exception 'Не удалось связать legacy-материал с каталогом'; end if;

  perform set_config('dlight.legacy_finance_sync','on',true);
  insert into public.service_order_items(
    order_id,job_id,title,unit,planned_qty,done_qty,kind,stock_catalog_id,
    sku_snapshot,unit_price_snapshot,unit_cost_snapshot,
    legacy_job_part_id,legacy_snapshot,billable,
    financial_revenue_snapshot,financial_cost_snapshot,
    approved_at,approved_by,created_at
  ) values (
    oid,new.job_id,btrim(new.name),coalesce(nullif(btrim(new.unit),''),'шт'),new.qty,0,
    'material',catalog_id,coalesce(new.sku,''),new.price,new.cost,new.id,to_jsonb(new),
    coalesce(new.billable,true),case when new.billable then new.qty*new.price else 0 end,
    new.qty*new.cost,new.approved_at,new.approved_by,new.created_at
  )
  on conflict (legacy_job_part_id) where legacy_job_part_id is not null do update set
    order_id=excluded.order_id,job_id=excluded.job_id,title=excluded.title,unit=excluded.unit,
    planned_qty=excluded.planned_qty,kind='material',stock_catalog_id=excluded.stock_catalog_id,
    sku_snapshot=excluded.sku_snapshot,unit_price_snapshot=excluded.unit_price_snapshot,
    unit_cost_snapshot=excluded.unit_cost_snapshot,legacy_snapshot=excluded.legacy_snapshot,
    billable=excluded.billable,financial_revenue_snapshot=excluded.financial_revenue_snapshot,
    financial_cost_snapshot=excluded.financial_cost_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,created_at=excluded.created_at;
  perform set_config('dlight.legacy_finance_sync','off',true);
  return new;
end $$;
revoke all on function dlight_private.sync_job_part_to_task() from public,anon,authenticated;
drop trigger if exists job_parts_sync_task on public.job_parts;
create trigger job_parts_sync_task after insert or update on public.job_parts
for each row execute function dlight_private.sync_job_part_to_task();
drop trigger if exists job_parts_prevent_migrated_delete on public.job_parts;
create trigger job_parts_prevent_migrated_delete before delete on public.job_parts
for each row execute function dlight_private.sync_job_part_to_task();

commit;
