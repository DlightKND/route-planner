-- New task-only work rows need the same frozen tariff and cost basis used by
-- request work. Browser payloads do not get to choose the resulting money.
begin;

create function dlight_private.task_work_financial_snapshots()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.settings%rowtype;
  client_profile text;
  profile_id text;
  profile jsonb;
  is_depot boolean;
  rate numeric:=0;
  global_rate numeric:=0;
  cost_rate numeric:=0;
begin
  -- Imported request rows and carried rows already have audited snapshots.
  if new.kind<>'work' or new.legacy_job_work_id is not null
     or new.legacy_job_part_id is not null or new.source_item_id is not null then
    return new;
  end if;
  -- The stored rates are hourly. A free-text work unit such as "job" or
  -- "piece" has no agreed conversion, so leave it visibly unpriced.
  if lower(replace(btrim(coalesce(new.unit,'')),'ё','е')) not in
     ('ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours') then
    return new;
  end if;

  if tg_op='UPDATE' then
    -- A quantity edit keeps the original frozen unit economics. A change to
    -- current tariffs must never rewrite an already-priced task line.
    if new.planned_qty is distinct from old.planned_qty and old.planned_qty>0 then
      if old.financial_revenue_snapshot is not null then
        new.financial_revenue_snapshot:=round(old.financial_revenue_snapshot*new.planned_qty/old.planned_qty,2);
      end if;
      if old.financial_cost_snapshot is not null then
        new.financial_cost_snapshot:=round(old.financial_cost_snapshot*new.planned_qty/old.planned_qty,2);
      end if;
    end if;
    return new;
  end if;

  select * into cfg from public.settings where id=true;
  if not found then raise exception 'Не найдены настройки тарифов и себестоимости'; end if;
  select coalesce(j.at_depot,false),to_jsonb(c)->>'default_profile'
    into is_depot,client_profile
  from public.jobs j left join public.clients c on c.id=j.client_id
  where j.id=new.job_id;
  if not found then raise exception 'Заявка работы не найдена'; end if;

  profile_id:=nullif(btrim(coalesce(new.tariff_profile,'')),'');
  if profile_id is null then
    if coalesce(new.billable,true) then
      select p->>'id' into profile_id
      from jsonb_array_elements(coalesce(cfg.tariff_profiles,'[]'::jsonb)) p
      where p->>'id'=client_profile limit 1;
    end if;
    if profile_id is null then
      select p->>'id' into profile_id
      from jsonb_array_elements(coalesce(cfg.tariff_profiles,'[]'::jsonb)) p
      where coalesce((p->>case when coalesce(new.billable,true) then 'def_paid' else 'def_warranty' end)::boolean,false)
      order by p->>'id' limit 1;
    end if;
  end if;

  if profile_id is not null then
    select p into profile
    from jsonb_array_elements(coalesce(cfg.tariff_profiles,'[]'::jsonb)) p
    where p->>'id'=profile_id limit 1;
    if profile is null then raise exception 'Профиль тарифа работы недоступен'; end if;
  end if;

  global_rate:=coalesce(nullif(cfg.tariffs->>'hour','')::numeric,0);
  cost_rate:=coalesce(nullif(cfg.costs->>'hour','')::numeric,0);
  if coalesce(new.billable,true) then
    if is_depot then
      rate:=coalesce(nullif(profile->'work_depot'->>'rate','')::numeric,0);
      if rate<=0 then rate:=coalesce(nullif(profile->'work_paid'->>'rate','')::numeric,0); end if;
    else
      rate:=coalesce(nullif(profile->'work_paid'->>'rate','')::numeric,0);
    end if;
    if rate<=0 then rate:=global_rate; end if;
  else
    rate:=coalesce(nullif(profile->'work_warr'->>'rate','')::numeric,0);
  end if;

  new.tariff_profile:=profile_id;
  new.financial_revenue_snapshot:=round(coalesce(new.planned_qty,0)*rate,2);
  new.financial_cost_snapshot:=round(coalesce(new.planned_qty,0)*cost_rate,2);
  return new;
end $$;

revoke all on function dlight_private.task_work_financial_snapshots() from public,anon,authenticated;
create trigger service_order_items_work_financial_snapshots
before insert or update of planned_qty on public.service_order_items
for each row execute function dlight_private.task_work_financial_snapshots();

commit;
