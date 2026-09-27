-- A deadline proposal is a separate, reviewed action. It never edits a task
-- until its curator (or an administrator) accepts the exact task revision.
begin;

alter table public.service_orders
  add column curator_id uuid references public.profiles(id) on delete set null;

create table public.service_order_deadline_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  proposed_date_to date not null,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  order_revision integer not null,
  status text not null default 'open' check (status in ('open','accepted','declined')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  constraint deadline_decision_complete check (
    (status='open' and decided_by is null and decided_at is null)
    or (status<>'open' and decided_by is not null and decided_at is not null)
  )
);
create index service_order_deadline_requests_order_idx
  on public.service_order_deadline_requests(order_id,created_at desc);
create unique index service_order_deadline_one_open_idx
  on public.service_order_deadline_requests(order_id) where status='open';

alter table public.service_order_deadline_requests enable row level security;
revoke all on public.service_order_deadline_requests from public,anon,authenticated;
grant select on public.service_order_deadline_requests to authenticated;
create policy deadline_requests_read on public.service_order_deadline_requests
  for select to authenticated using (dlight_private.order_access(order_id));

create function dlight_private.order_deadline_propose(p_order uuid,p_date_to date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.service_orders; rid uuid;
begin
  if auth.uid() is null or public.user_role()<>'engineer'
     or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
  then raise exception 'Предложить срок может активный инженер'; end if;
  select * into o from public.service_orders where id=p_order for update;
  if not found or not (auth.uid()=any(coalesce(o.engineer_ids,'{}'::uuid[])))
     or o.status not in ('assigned','in_progress','paused','review')
  then raise exception 'Задание недоступно для предложения срока'; end if;
  if p_date_to is null or (o.date_from is not null and p_date_to<o.date_from)
     or p_date_to=o.date_to then raise exception 'Укажи новый допустимый срок'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 1000
  then raise exception 'Укажи причину изменения срока (5–1000 символов)'; end if;
  insert into public.service_order_deadline_requests(order_id,proposed_date_to,reason,order_revision,created_by)
  values(p_order,p_date_to,btrim(p_reason),o.revision,auth.uid()) returning id into rid;
  return rid;
end $$;

create function dlight_private.order_deadline_decide(p_request uuid,p_accept boolean,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.service_order_deadline_requests; o public.service_orders;
begin
  if auth.uid() is null or public.user_role() not in ('admin','logist')
     or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
  then raise exception 'Решение принимает куратор или администратор'; end if;
  select * into r from public.service_order_deadline_requests where id=p_request for update;
  if not found or r.status<>'open' then raise exception 'Предложение уже рассмотрено или не найдено'; end if;
  select * into o from public.service_orders where id=r.order_id for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if public.user_role()<>'admin' and o.curator_id is distinct from auth.uid()
  then raise exception 'Задание закреплено за другим куратором'; end if;
  if not p_accept and length(btrim(coalesce(p_note,'')))<5
  then raise exception 'Укажи причину отказа (не короче пяти символов)'; end if;
  if p_accept then
    if o.revision is distinct from r.order_revision
       or o.status not in ('assigned','in_progress','paused','review')
       or (o.date_from is not null and r.proposed_date_to<o.date_from)
    then raise exception 'Задание изменилось. Отклони предложение и попроси новое'; end if;
    insert into public.service_order_history(order_id,actor_id,reason,snapshot)
      values(o.id,auth.uid(),'Согласован новый срок: '||r.proposed_date_to::text,dlight_private.order_snapshot(o.id));
    update public.service_orders set date_to=r.proposed_date_to,
      revision=revision+1,updated_at=now() where id=o.id returning revision into o.revision;
  end if;
  update public.service_order_deadline_requests set status=case when p_accept then 'accepted' else 'declined' end,
    decided_by=auth.uid(),decided_at=now(),decision_note=nullif(btrim(coalesce(p_note,'')),'') where id=p_request;
  return o.revision;
end $$;

create function dlight_private.order_curator_assign(p_order uuid,p_curator uuid,p_expected integer)
returns integer language plpgsql security definer set search_path='' as $$
declare o public.service_orders;
begin
  if auth.uid() is null or public.user_role() not in ('admin','logist')
     or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
  then raise exception 'Назначить куратора может диспетчер'; end if;
  select * into o from public.service_orders where id=p_order for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if o.revision is distinct from p_expected then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
  if p_curator is not null and not exists(
      select 1 from public.profiles p where p.id=p_curator and p.active and p.role::text in ('admin','logist'))
  then raise exception 'Куратор должен быть активным диспетчером или администратором'; end if;
  if o.curator_id is not distinct from p_curator then return o.revision; end if;
  insert into public.service_order_history(order_id,actor_id,reason,snapshot)
    values(p_order,auth.uid(),'Изменён куратор задания',dlight_private.order_snapshot(p_order));
  update public.service_orders set curator_id=p_curator,revision=revision+1,updated_at=now()
    where id=p_order returning revision into o.revision;
  return o.revision;
end $$;

revoke all on function dlight_private.order_deadline_propose(uuid,date,text),
  dlight_private.order_deadline_decide(uuid,boolean,text),
  dlight_private.order_curator_assign(uuid,uuid,integer) from public,anon,authenticated;

create function public.service_order_deadline_propose(p_order uuid,p_date_to date,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
  select dlight_private.order_deadline_propose(p_order,p_date_to,p_reason)
$$;
create function public.service_order_deadline_decide(p_request uuid,p_accept boolean,p_note text default null)
returns integer language sql security invoker set search_path='' as $$
  select dlight_private.order_deadline_decide(p_request,p_accept,p_note)
$$;
create function public.service_order_curator_assign(p_order uuid,p_curator uuid,p_expected integer)
returns integer language sql security invoker set search_path='' as $$
  select dlight_private.order_curator_assign(p_order,p_curator,p_expected)
$$;
revoke all on function public.service_order_deadline_propose(uuid,date,text),
  public.service_order_deadline_decide(uuid,boolean,text),
  public.service_order_curator_assign(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function dlight_private.order_deadline_propose(uuid,date,text),
  dlight_private.order_deadline_decide(uuid,boolean,text),
  dlight_private.order_curator_assign(uuid,uuid,integer) to authenticated;
grant execute on function public.service_order_deadline_propose(uuid,date,text),
  public.service_order_deadline_decide(uuid,boolean,text),
  public.service_order_curator_assign(uuid,uuid,integer) to authenticated;
commit;
