-- Customers (26.11.2026): Client → Points → Equipment.
--
-- Until now a "client" was one place on the map. A customer (organisation) now
-- owns any number of such points; equipment keeps standing on a point. The
-- public.clients table stays the point table (jobs, equipment, routing and the
-- map keep using it); public.customers sits above it.
--
-- Every existing non-depot point gets its own customer with the same name, phone
-- and contact, so nothing is left without an owner; duplicates can be merged
-- later by moving points between customers.

create table if not exists public.customers(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 300),
  legal_name text not null default '' check (length(legal_name)<=300),
  tax_id text not null default '' check (length(tax_id)<=40),
  phone text not null default '' check (length(phone)<=80),
  email text not null default '' check (length(email)<=200),
  contact_person text not null default '' check (length(contact_person)<=200),
  notes text not null default '' check (length(notes)<=4000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz
);
alter table public.customers enable row level security;
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using (public.is_staff());
drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers for all to authenticated
  using (public.user_role() = any (array['admin','logist']))
  with check (public.user_role() = any (array['admin','logist']));
grant select, insert, update on public.customers to authenticated;

alter table public.clients add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists clients_customer_id_idx on public.clients(customer_id);

with src as (
  select c.id as point_id, gen_random_uuid() as customer_id, c.name, coalesce(c.phone,'') as phone,
         coalesce(c.contact_person,'') as contact_person, c.deleted_at
  from public.clients c
  where c.customer_id is null and not coalesce(c.is_base,false)
), created as (
  insert into public.customers(id,name,phone,contact_person,deleted_at,created_by)
  select customer_id, left(coalesce(nullif(btrim(name),''),'Без названия'),300), left(phone,80), left(contact_person,200), deleted_at, null from src
  returning id
)
update public.clients c set customer_id=s.customer_id
from src s where c.id=s.point_id and s.customer_id in (select id from created);

-- A customer with active points is not deleted: move or delete the points first.
create or replace function public.soft_delete_customer(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path to ''
as $$
declare stamp timestamptz := now(); points int;
begin
  if coalesce(public.user_role() in ('admin','logist'),false) is not true then
    raise exception 'Удалять клиентов может только диспетчер';
  end if;
  select count(*) into points from public.clients where customer_id=p_id and deleted_at is null;
  if points>0 then
    raise exception 'У клиента есть точки (%): перенесите их другому клиенту или удалите', points;
  end if;
  update public.customers set deleted_at=stamp where id=p_id and deleted_at is null;
  if not found then raise exception 'Клиент не найден'; end if;
  return stamp;
end $$;
revoke all on function public.soft_delete_customer(uuid) from public;
grant execute on function public.soft_delete_customer(uuid) to authenticated;
