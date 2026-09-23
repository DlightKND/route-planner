-- Normalize assignment ownership while preserving the existing request/trip
-- links until every old client and report has moved to the new relation.
begin;

alter table public.service_orders
  add column job_id uuid references public.jobs(id) on delete restrict,
  add column seed_request_id uuid unique references public.jobs(id) on delete restrict,
  add constraint service_orders_seed_matches_job
    check(seed_request_id is null or seed_request_id=job_id);
create index service_orders_job_id_idx on public.service_orders(job_id,created_at desc);

create table public.trip_service_orders (
  trip_id uuid not null references public.trips(id) on delete cascade,
  order_id uuid not null references public.service_orders(id) on delete restrict,
  ordinal integer not null default 0 check(ordinal>=0),
  link_source text not null default 'dispatcher'
    check(link_source in ('historical_backfill','legacy_job_sync','dispatcher','task_trip')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key(trip_id,order_id)
);
create index trip_service_orders_order_idx on public.trip_service_orders(order_id,trip_id);
alter table public.trip_service_orders enable row level security;
revoke all on public.trip_service_orders from public,anon,authenticated;
grant select on public.trip_service_orders to authenticated;
create policy trip_service_orders_read on public.trip_service_orders for select to authenticated
using (
  dlight_private.order_access(order_id)
  or exists(
    select 1 from public.trips t
    where t.id=trip_id and coalesce(
      public.user_role() in ('admin','logist')
      or auth.uid()=t.lead_engineer
      or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])),false)
  )
);

-- An assigned trip crew can read the attached tasks and their request snapshots
-- even when an individual task has a different lead engineer.
create or replace function dlight_private.order_access(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(
    public.user_role() in ('admin','logist')
    or (public.user_role()='engineer' and (
      exists(select 1 from public.service_orders o where o.id=p_id and auth.uid()=any(o.engineer_ids))
      or exists(select 1 from public.trip_service_orders tso join public.trips t on t.id=tso.trip_id
        where tso.order_id=p_id and (auth.uid()=t.lead_engineer or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[]))))
    )),false)
$$;
revoke all on function dlight_private.order_access(uuid) from public,anon;
grant execute on function dlight_private.order_access(uuid) to authenticated;

alter table public.trip_stays
  add column service_order_id uuid references public.service_orders(id) on delete restrict;
create index trip_stays_service_order_idx on public.trip_stays(service_order_id)
  where service_order_id is not null;

-- One stable seed per request that has ever appeared in a trip. This is a
-- baseline task, not the rule for ordinary task creation. No trip status,
-- crew, plan, completion, or cost is copied into the request's task.
insert into public.service_orders(title,status,work_mode,job_id,seed_request_id)
select 'Задание по заявке','draft',
       case when coalesce(j.at_depot,false) then 'depot' else 'onsite' end,
       j.id,j.id
from public.jobs j
where exists(select 1 from public.trip_jobs tj where tj.job_id=j.id)
on conflict(seed_request_id) do nothing;

insert into public.service_order_jobs(order_id,job_id,snapshot)
select o.id,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name)
from public.service_orders o
join public.jobs j on j.id=o.seed_request_id
left join public.clients c on c.id=j.client_id
on conflict(order_id,job_id) do nothing;

insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source)
select tj.trip_id,o.id,coalesce(tj.ord,0),'historical_backfill'
from public.trip_jobs tj
join public.service_orders o on o.seed_request_id=tj.job_id
on conflict(trip_id,order_id) do nothing;

-- Historical presence belongs to its request. Attach it to that request's
-- one-time seed only when the same request was on the same trip. Do not clone
-- stays, and leave auto-detected/unbound stays untouched.
update public.trip_stays s
set service_order_id=o.id
from public.service_orders o
where s.service_order_id is null
  and s.job_id=o.seed_request_id
  and exists(select 1 from public.trip_service_orders tso
             where tso.trip_id=s.trip_id and tso.order_id=o.id);

-- New stays inherit the task only when the trip has exactly one task for the
-- selected request. Ambiguous cases stay unassigned for an explicit choice.
create function dlight_private.trip_stay_task_link() returns trigger
language plpgsql set search_path='' as $$
declare matches uuid[];
begin
  if new.service_order_id is null and new.job_id is not null then
    select array_agg(o.id order by o.id) into matches
    from public.trip_service_orders tso
    join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=new.trip_id and o.job_id=new.job_id;
    if cardinality(matches)=1 then new.service_order_id:=matches[1]; end if;
  elsif new.service_order_id is not null and not exists(
    select 1 from public.trip_service_orders tso
    join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=new.trip_id and tso.order_id=new.service_order_id and o.job_id=new.job_id
  ) then
    raise exception 'Задание стоянки должно быть связано с заявкой и выездом';
  end if;
  return new;
end $$;
revoke all on function dlight_private.trip_stay_task_link() from public,anon,authenticated;
create trigger trip_stays_task_link before insert or update of trip_id,job_id,service_order_id on public.trip_stays
for each row execute function dlight_private.trip_stay_task_link();

create function dlight_private.ensure_request_seed(p_job uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
  select id into oid from public.service_orders where seed_request_id=p_job;
  if found then return oid; end if;
  insert into public.service_orders(title,status,work_mode,job_id,seed_request_id,created_by)
  select 'Задание по заявке','draft',
         case when coalesce(j.at_depot,false) then 'depot' else 'onsite' end,
         j.id,j.id,auth.uid()
  from public.jobs j where j.id=p_job and j.deleted_at is null
  on conflict(seed_request_id) do update set seed_request_id=excluded.seed_request_id
  returning id into oid;
  if oid is null then raise exception 'Активная заявка не найдена'; end if;
  insert into public.service_order_jobs(order_id,job_id,snapshot)
  select oid,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name)
  from public.jobs j left join public.clients c on c.id=j.client_id where j.id=p_job
  on conflict(order_id,job_id) do nothing;
  return oid;
end $$;
revoke all on function dlight_private.ensure_request_seed(uuid) from public,anon,authenticated;

create function dlight_private.trip_order_link_guard() returns trigger
language plpgsql set search_path='' as $$
declare job uuid; mode text;
begin
  select job_id,work_mode into job,mode from public.service_orders where id=new.order_id;
  if job is null then raise exception 'Выезд связывается только с заданием по одной заявке'; end if;
  if mode<>'onsite' then raise exception 'В выезд можно включить только задание с выездным форматом'; end if;
  return new;
end $$;
revoke all on function dlight_private.trip_order_link_guard() from public,anon,authenticated;
create trigger trip_service_orders_guard before insert or update of order_id on public.trip_service_orders
for each row execute function dlight_private.trip_order_link_guard();

-- If the task is the legacy trips.service_order_id, preserve that connection
-- in the many-to-many table too. Old trips still get their legacy parent from
-- trip_order_parent; trip_jobs below supplies their normalized seed links.
create function dlight_private.trip_parent_to_task_link() returns trigger
language plpgsql security definer set search_path='' as $$
declare job uuid;
begin
  select job_id into job from public.service_orders where id=new.service_order_id;
  if job is not null then
    insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
    values(new.id,new.service_order_id,0,'task_trip',auth.uid()) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function dlight_private.trip_parent_to_task_link() from public,anon,authenticated;
create trigger trips_task_link after insert on public.trips
for each row execute function dlight_private.trip_parent_to_task_link();

-- Old planner clients only send job IDs. Keep them functional by using the
-- unique seed task as the compatibility mapping. New clients write the
-- selected task IDs with trip_plan_save_tasks in the same transaction.
create or replace function dlight_private.trip_order_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare tid uuid; jid uuid; oid uuid;
begin
  if tg_op='DELETE' then
    tid:=old.trip_id; jid:=old.job_id;
    delete from public.trip_service_orders tso using public.service_orders o
      where tso.trip_id=tid and tso.order_id=o.id and o.job_id=jid;
    return old;
  end if;
  tid:=new.trip_id; jid:=new.job_id;
  -- A task-aware client has already inserted its selected task links.
  if exists(select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
            where tso.trip_id=tid and o.job_id=jid) then return new; end if;
  oid:=dlight_private.ensure_request_seed(jid);
  insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
  values(tid,oid,coalesce(new.ord,0),'legacy_job_sync',auth.uid()) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trip_jobs_order on public.trip_jobs;
create trigger trip_jobs_order after insert or update or delete on public.trip_jobs
for each row execute function dlight_private.trip_order_job();
revoke all on function dlight_private.trip_order_job() from public,anon,authenticated;

create function dlight_private.order_save_one(
  p_id uuid,p_expected integer,p_data jsonb,p_job uuid,p_items jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid; prior_job uuid;
begin
  if p_job is null then raise exception 'Выбери одну заявку для задания'; end if;
  if p_id is not null then
    select job_id into prior_job from public.service_orders where id=p_id for update;
    if not found or prior_job is distinct from p_job then
      raise exception 'Связь задания с заявкой зафиксирована; создай отдельное задание для другой заявки';
    end if;
  end if;
  oid:=dlight_private.order_save(p_id,p_expected,p_data,array[p_job],p_items);
  update public.service_orders set job_id=p_job where id=oid;
  return oid;
end $$;
revoke all on function dlight_private.order_save_one(uuid,integer,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.order_save_one(uuid,integer,jsonb,uuid,jsonb) to authenticated;
create function public.service_order_save_one(p_id uuid,p_expected integer,p_data jsonb,p_job uuid,p_items jsonb)
returns uuid language sql security invoker set search_path='' as $$
  select dlight_private.order_save_one(p_id,p_expected,p_data,p_job,p_items)
$$;
revoke all on function public.service_order_save_one(uuid,integer,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_order_save_one(uuid,integer,jsonb,uuid,jsonb) to authenticated;

create function dlight_private.trip_plan_save_tasks(
  p_trip uuid,p_expected integer,p_plan jsonb,p_order_ids uuid[],p_reason text,p_stays jsonb default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid; requests uuid[]; orders uuid[]:=coalesce(p_order_ids,'{}'::uuid[]);
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
    raise exception 'Изменяет только менеджер';
  end if;
  if cardinality(orders)<>(select count(distinct x) from unnest(orders) x) then
    raise exception 'Повтор задания в выезде';
  end if;
  if exists(select 1 from unnest(orders) x where not exists(
    select 1 from public.service_orders o where o.id=x and o.job_id is not null
      and o.work_mode='onsite'
      and (o.status not in ('review','completed','cancelled') or exists(
        select 1 from public.trip_service_orders current_link
        where current_link.trip_id=p_trip and current_link.order_id=o.id
      ))
  )) then raise exception 'Одно из заданий недоступно для выезда'; end if;
  if exists(select 1 from public.trip_service_orders tso
    join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=p_trip and o.status in ('review','completed','cancelled') and not(o.id=any(orders)))
  then raise exception 'Нельзя отвязать задание, переданное на проверку или закрытое'; end if;
  select coalesce(array_agg(distinct o.job_id order by o.job_id),'{}'::uuid[])
    into requests from public.service_orders o where o.id=any(orders);
  -- The legacy plan operation still owns trip facts, ordered route jobs,
  -- optimistic revision checks, and stay approval. Run it in this transaction.
  tid:=public.trip_plan_save(p_trip,p_expected,p_plan,requests,p_reason,p_stays);
  delete from public.trip_service_orders where trip_id=tid;
  insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
    select tid,x,ord::integer-1,'dispatcher',auth.uid()
    from unnest(orders) with ordinality u(x,ord);
  return tid;
end $$;
revoke all on function dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) to authenticated;
create function public.trip_plan_save_tasks(p_trip uuid,p_expected integer,p_plan jsonb,p_order_ids uuid[],p_reason text,p_stays jsonb default null)
returns uuid language sql security invoker set search_path='' as $$
  select dlight_private.trip_plan_save_tasks(p_trip,p_expected,p_plan,p_order_ids,p_reason,p_stays)
$$;
revoke all on function public.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function public.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb) to authenticated;

create function dlight_private.ensure_request_seed_rpc(p_job uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
    raise exception 'Только диспетчер создаёт задание для заявки';
  end if;
  return dlight_private.ensure_request_seed(p_job);
end $$;
revoke all on function dlight_private.ensure_request_seed_rpc(uuid) from public,anon,authenticated;
grant execute on function dlight_private.ensure_request_seed_rpc(uuid) to authenticated;
create function public.service_order_seed_task(p_job uuid) returns uuid
language sql security invoker set search_path='' as $$
  select dlight_private.ensure_request_seed_rpc(p_job)
$$;
revoke all on function public.service_order_seed_task(uuid) from public,anon,authenticated;
grant execute on function public.service_order_seed_task(uuid) to authenticated;

commit;
