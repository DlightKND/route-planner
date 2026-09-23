-- Material nomenclature only: physical balances need locations and inventory.
begin;

create table public.stock_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 300),
  sku text not null default '' check (length(sku)<=120),
  unit text not null default 'шт' check (length(btrim(unit)) between 1 and 40),
  price numeric(14,2) not null default 0 check (price>=0),
  cost numeric(14,2) not null default 0 check (cost>=0),
  active boolean not null default true,
  current_since timestamptz not null default now(),
  legacy_part_id uuid unique references public.job_parts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);
create index stock_catalog_name_search_idx on public.stock_catalog using gin (to_tsvector('simple',name));
create index stock_catalog_sku_idx on public.stock_catalog(lower(sku)) where sku<>'';
create index stock_catalog_active_name_idx on public.stock_catalog(active,name);

-- Existing material rows are snapshots with different financial meanings.
-- Preserve each row as an auditable source; do not merge by name or SKU.
insert into public.stock_catalog(name,sku,unit,price,cost,legacy_part_id,created_by,updated_by)
select btrim(name),coalesce(sku,''),coalesce(nullif(btrim(unit),''),'шт'),price,cost,id,created_by,created_by
from public.job_parts
on conflict(legacy_part_id) do nothing;

alter table public.stock_catalog enable row level security;
revoke all on public.stock_catalog from public,anon,authenticated;
grant select,insert,update on public.stock_catalog to authenticated;
create policy stock_catalog_read on public.stock_catalog for select to authenticated
  using (coalesce(public.user_role() in ('admin','logist','engineer'),false));
create policy stock_catalog_manage on public.stock_catalog for all to authenticated
  using (coalesce(public.user_role() in ('admin','logist'),false))
  with check (coalesce(public.user_role() in ('admin','logist'),false));

create function dlight_private.stock_catalog_touch() returns trigger
language plpgsql set search_path='' as $$
begin
  new.name:=btrim(new.name);
  new.sku:=btrim(coalesce(new.sku,''));
  new.unit:=btrim(coalesce(new.unit,'шт'));
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  if tg_op='UPDATE' and (new.name,new.sku,new.unit,new.price,new.cost) is distinct from
     (old.name,old.sku,old.unit,old.price,old.cost) then new.current_since:=now(); end if;
  return new;
end $$;
revoke all on function dlight_private.stock_catalog_touch() from public,anon,authenticated;
create trigger stock_catalog_touch before insert or update on public.stock_catalog
for each row execute function dlight_private.stock_catalog_touch();

commit;
