-- One durable owner and one operational curator per request, task and trip.
-- Existing records are deliberately left unassigned: created_by is not
-- evidence of responsibility for imported history.
begin;

alter table public.jobs
  add column owner_id uuid references public.profiles(id) on delete set null,
  add column curator_id uuid references public.profiles(id) on delete set null;
alter table public.trips
  add column owner_id uuid references public.profiles(id) on delete set null,
  add column curator_id uuid references public.profiles(id) on delete set null;
alter table public.service_orders
  add column owner_id uuid references public.profiles(id) on delete set null;

create index jobs_owner_idx on public.jobs(owner_id) where owner_id is not null;
create index jobs_curator_idx on public.jobs(curator_id) where curator_id is not null;
create index trips_owner_idx on public.trips(owner_id) where owner_id is not null;
create index trips_curator_idx on public.trips(curator_id) where curator_id is not null;
create index service_orders_owner_idx on public.service_orders(owner_id) where owner_id is not null;
create index service_orders_curator_idx on public.service_orders(curator_id) where curator_id is not null;

create table public.entity_responsibility_events (
  id bigint generated always as identity primary key,
  entity_kind text not null check (entity_kind in ('job','order','trip')),
  entity_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_owner_id uuid references public.profiles(id) on delete set null,
  previous_curator_id uuid references public.profiles(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  curator_id uuid references public.profiles(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  created_at timestamptz not null default now()
);
create index entity_responsibility_events_entity_idx
  on public.entity_responsibility_events(entity_kind,entity_id,created_at desc);
alter table public.entity_responsibility_events enable row level security;
revoke all on public.entity_responsibility_events from public,anon,authenticated;
grant select on public.entity_responsibility_events to authenticated;

create function dlight_private.responsibility_access(p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.active
  ) and (
    public.user_role() in ('admin','logist')
    or (p_kind='job' and exists(
      select 1 from public.jobs j where j.id=p_id and
        (auth.uid() in (j.owner_id,j.curator_id,j.assigned_engineer)
          or auth.uid()=any(coalesce(j.engineer_ids,'{}'::uuid[])))))
    or (p_kind='order' and exists(
      select 1 from public.service_orders o where o.id=p_id and
        (auth.uid() in (o.owner_id,o.curator_id,o.lead_engineer)
          or auth.uid()=any(o.engineer_ids))))
    or (p_kind='trip' and exists(
      select 1 from public.trips t where t.id=p_id and
        (auth.uid() in (t.owner_id,t.curator_id,t.lead_engineer)
          or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])))))
  )
$$;
revoke all on function dlight_private.responsibility_access(text,uuid) from public,anon;
grant execute on function dlight_private.responsibility_access(text,uuid) to authenticated;
create function dlight_private.responsibility_manager(p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.active
  ) and coalesce(
    public.user_role() in ('admin','logist')
    or (p_kind='job' and exists(
      select 1 from public.jobs j where j.id=p_id
        and auth.uid() in (j.owner_id,j.curator_id)))
    or (p_kind='order' and exists(
      select 1 from public.service_orders o where o.id=p_id
        and auth.uid() in (o.owner_id,o.curator_id)))
    or (p_kind='trip' and exists(
      select 1 from public.trips t where t.id=p_id
        and auth.uid() in (t.owner_id,t.curator_id))),false)
$$;
revoke all on function dlight_private.responsibility_manager(text,uuid) from public,anon;
grant execute on function dlight_private.responsibility_manager(text,uuid) to authenticated;
create policy responsibility_events_read on public.entity_responsibility_events
  for select to authenticated using (
    dlight_private.responsibility_access(entity_kind,entity_id)
  );

-- Reading a related task also reads its items, links and timeline through
-- their existing order_access policies. Existing global manager access stays.
create or replace function dlight_private.order_access(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select dlight_private.responsibility_manager('order',p_id)
    or (
      auth.uid() is not null
      and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
      and exists(select 1 from public.service_orders o where o.id=p_id
        and auth.uid()=any(o.engineer_ids))
    )
    or (
      auth.uid() is not null
      and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
      and exists(select 1 from public.trip_service_orders l
        join public.trips t on t.id=l.trip_id
        where l.order_id=p_id and
          (t.lead_engineer=auth.uid() or auth.uid()=any(t.engineer_ids)))
    )
    or (
      auth.uid() is not null and public.user_role()='engineer'
      and exists(
        select 1 from public.service_orders o
        join public.jobs j on j.id=o.seed_request_id and j.id=o.job_id
        where o.id=p_id and (auth.uid()=j.assigned_engineer
          or auth.uid()=any(coalesce(j.engineer_ids,'{}'::uuid[])))
      )
    )
$$;

create policy jobs_responsibility_update on public.jobs
  for update to authenticated
  using (dlight_private.responsibility_manager('job',id))
  with check (dlight_private.responsibility_manager('job',id));
create policy trips_responsibility_update on public.trips
  for update to authenticated
  using (dlight_private.responsibility_manager('trip',id))
  with check (dlight_private.responsibility_manager('trip',id));
create policy trips_responsibility_read on public.trips
  for select to authenticated using (
    dlight_private.responsibility_manager('trip',id)
  );
create policy trip_stays_responsibility_read on public.trip_stays
  for select to authenticated using (
    dlight_private.responsibility_manager('trip',trip_id)
  );

create function dlight_private.responsibility_default() returns trigger
language plpgsql set search_path='' as $$
begin
  -- SQL backfills and service operations without an authenticated creator
  -- remain unassigned, as do records created by an inactive profile.
  if auth.uid() is not null and exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.active
  ) then
    new.owner_id:=auth.uid();
    new.curator_id:=auth.uid();
  end if;
  return new;
end $$;
revoke all on function dlight_private.responsibility_default() from public,anon,authenticated;
create trigger jobs_responsibility_default before insert on public.jobs
  for each row execute function dlight_private.responsibility_default();
create trigger trips_responsibility_default before insert on public.trips
  for each row execute function dlight_private.responsibility_default();
create trigger orders_responsibility_default before insert on public.service_orders
  for each row execute function dlight_private.responsibility_default();

-- Direct client UPDATE of responsibility columns would evade delegation
-- validation and its audit log. The RPC below executes as the database owner.
create function dlight_private.responsibility_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user='authenticated'
     and (new.owner_id is distinct from old.owner_id
       or new.curator_id is distinct from old.curator_id) then
    raise exception 'Владельца и куратора меняют через передачу ответственности';
  end if;
  return new;
end $$;
revoke all on function dlight_private.responsibility_guard() from public,anon,authenticated;
create trigger jobs_responsibility_guard before update on public.jobs
  for each row execute function dlight_private.responsibility_guard();
create trigger trips_responsibility_guard before update on public.trips
  for each row execute function dlight_private.responsibility_guard();
create trigger orders_responsibility_guard before update on public.service_orders
  for each row execute function dlight_private.responsibility_guard();

create function dlight_private.responsibility_assign(
  p_kind text,p_id uuid,p_field text,p_person uuid,p_reason text,p_expected integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  old_owner uuid; old_curator uuid; next_owner uuid; next_curator uuid;
  old_revision integer; actor_role text;
begin
  if auth.uid() is null or p_kind not in ('job','order','trip')
    or p_field not in ('owner','curator') or p_id is null then
    raise exception 'Некорректная передача ответственности';
  end if;
  select role into actor_role from public.profiles where id=auth.uid() and active;
  if actor_role is null then raise exception 'Учётная запись неактивна'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 1000
  then raise exception 'Укажи причину передачи (5–1000 символов)'; end if;
  if p_person is null or not exists(
    select 1 from public.profiles where id=p_person and active
  ) then raise exception 'Выбери активного пользователя'; end if;

  if p_kind='job' then
    select owner_id,curator_id into old_owner,old_curator
    from public.jobs where id=p_id and deleted_at is null for update;
  elsif p_kind='trip' then
    select owner_id,curator_id into old_owner,old_curator
    from public.trips where id=p_id and deleted_at is null for update;
  else
    select owner_id,curator_id,revision into old_owner,old_curator,old_revision
    from public.service_orders where id=p_id and job_id is not null for update;
    if p_expected is distinct from old_revision then
      raise exception 'Задание изменено другим пользователем. Обнови данные';
    end if;
  end if;
  if not found then raise exception 'Сущность не найдена'; end if;
  if p_field='owner' then
    if actor_role<>'admin' and old_owner is distinct from auth.uid()
      and not (old_owner is null and actor_role='logist')
    then raise exception 'Владельца меняет текущий владелец или администратор'; end if;
    next_owner:=p_person;
    next_curator:=case when old_curator is null or old_curator=old_owner
      then p_person else old_curator end;
  else
    if actor_role<>'admin' and old_owner is distinct from auth.uid()
      and old_curator is distinct from auth.uid()
      and not (old_owner is null and old_curator is null and actor_role='logist')
    then raise exception 'Куратора меняет владелец, текущий куратор или администратор'; end if;
    next_owner:=coalesce(old_owner,p_person);
    next_curator:=p_person;
  end if;
  if old_owner is not distinct from next_owner and old_curator is not distinct from next_curator
  then return jsonb_build_object('owner_id',old_owner,'curator_id',old_curator); end if;

  if p_kind='job' then
    update public.jobs set owner_id=next_owner,curator_id=next_curator where id=p_id;
  elsif p_kind='trip' then
    update public.trips set owner_id=next_owner,curator_id=next_curator where id=p_id;
  else
    insert into public.service_order_history(order_id,actor_id,reason,snapshot)
      values(p_id,auth.uid(),'Передача ответственности: '||btrim(p_reason),
        dlight_private.order_snapshot(p_id));
    update public.service_orders set owner_id=next_owner,curator_id=next_curator,
      revision=revision+1,updated_at=now() where id=p_id;
  end if;
  insert into public.entity_responsibility_events(
    entity_kind,entity_id,actor_id,previous_owner_id,previous_curator_id,
    owner_id,curator_id,reason
  ) values(p_kind,p_id,auth.uid(),old_owner,old_curator,
    next_owner,next_curator,btrim(p_reason));
  return jsonb_build_object('owner_id',next_owner,'curator_id',next_curator);
end $$;
revoke all on function dlight_private.responsibility_assign(text,uuid,text,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function dlight_private.responsibility_assign(text,uuid,text,uuid,text,integer)
  to authenticated;
create function public.entity_responsibility_assign(
  p_kind text,p_id uuid,p_field text,p_person uuid,p_reason text,p_expected integer default null
) returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.responsibility_assign(
    p_kind,p_id,p_field,p_person,p_reason,p_expected)
$$;
revoke all on function public.entity_responsibility_assign(text,uuid,text,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.entity_responsibility_assign(text,uuid,text,uuid,text,integer)
  to authenticated;

-- Existing clients may still call the original task-curator RPC. Route it
-- through the same audited transfer instead of leaving a bypass behind.
create or replace function dlight_private.order_curator_assign(
  p_order uuid,p_curator uuid,p_expected integer
) returns integer language plpgsql security definer set search_path='' as $$
declare current_revision integer;
begin
  perform dlight_private.responsibility_assign(
    'order',p_order,'curator',p_curator,
    'Назначение куратора через редактор задания',p_expected);
  select revision into current_revision from public.service_orders where id=p_order;
  return current_revision;
end $$;

-- Curator is an entity-scoped role. The reviewer no longer needs a global
-- manager role; an administrator can recover a stalled decision.
create or replace function dlight_private.order_deadline_decide(
  p_request uuid,p_accept boolean,p_note text
) returns integer language plpgsql security definer set search_path='' as $$
declare r public.service_order_deadline_requests; o public.service_orders; actor_role text;
begin
  select role::text into actor_role from public.profiles where id=auth.uid() and active;
  if auth.uid() is null or actor_role is null then
    raise exception 'Решение принимает активный куратор или администратор';
  end if;
  select * into r from public.service_order_deadline_requests where id=p_request for update;
  if not found or r.status<>'open' then raise exception 'Предложение уже рассмотрено или не найдено'; end if;
  select * into o from public.service_orders where id=r.order_id for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if actor_role<>'admin' and o.curator_id is distinct from auth.uid()
  then raise exception 'Задание закреплено за другим куратором'; end if;
  if not p_accept and length(btrim(coalesce(p_note,'')))<5
  then raise exception 'Укажи причину отказа (не короче пяти символов)'; end if;
  if p_accept then
    if o.revision is distinct from r.order_revision
       or o.status not in ('assigned','in_progress','paused','review')
       or (o.date_from is not null and r.proposed_date_to<o.date_from)
    then raise exception 'Задание изменилось. Отклони предложение и попроси новое'; end if;
    insert into public.service_order_history(order_id,actor_id,reason,snapshot)
      values(o.id,auth.uid(),'Согласован новый срок: '||r.proposed_date_to::text,
        dlight_private.order_snapshot(o.id));
    update public.service_orders set date_to=r.proposed_date_to,
      revision=revision+1,updated_at=now() where id=o.id returning revision into o.revision;
  end if;
  update public.service_order_deadline_requests
    set status=case when p_accept then 'accepted' else 'declined' end,
      decided_by=auth.uid(),decided_at=now(),
      decision_note=nullif(btrim(coalesce(p_note,'')),'')
    where id=p_request;
  return o.revision;
end $$;

-- Extend the existing guarded task operations to the two people with
-- entity-specific authority. Keep their existing revision/finance checks.
do $$
declare
  target regprocedure; definition text; old_check text;
begin
  foreach target in array array[
    'dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb)'::regprocedure,
    'dlight_private.order_carry(uuid,integer,text)'::regprocedure,
    'dlight_private.order_trip(uuid,integer)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected manager check in %; review migration',target;
    end if;
    definition:=replace(definition,old_check,
      case when target='dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb)'::regprocedure
      then 'auth.uid() is null or (p_id is null and public.user_role() not in (''admin'',''logist'')) or (p_id is not null and not dlight_private.responsibility_manager(''order'',p_id))'
      else 'auth.uid() is null or not dlight_private.responsibility_manager(''order'',p_id)' end);
    execute definition;
  end loop;

  target:='dlight_private.order_transition(uuid,integer,text,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='if public.user_role()=''engineer'' and not(';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected task transition function; review migration';
  end if;
  definition:=replace(definition,old_check,
    'if not dlight_private.responsibility_manager(''order'',p_id) and not(');
  definition:=replace(definition,
    'if p_status in (''paused'',''cancelled'') and length(trim(coalesce(p_reason,'''')))=0',
    'if o.owner_id=auth.uid() and o.curator_id is distinct from auth.uid() and length(btrim(coalesce(p_reason,'''')))<5 then raise exception ''Владелец указывает причину вмешательства''; end if;'||E'\n '||
    'if p_status in (''paused'',''cancelled'') and length(trim(coalesce(p_reason,'''')))=0');
  execute definition;

  target:='dlight_private.order_result(uuid,integer,jsonb,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='o.status=''review'' and public.user_role()=''engineer''';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected task result function; review migration';
  end if;
  execute replace(definition,old_check,
    'o.status=''review'' and not dlight_private.responsibility_manager(''order'',p_id)');

  target:=to_regprocedure('dlight_private.order_historical_result(uuid,integer,jsonb,text,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or public.user_role() not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected historical result function; review migration';
    end if;
    execute replace(definition,old_check,
      'auth.uid() is null or not dlight_private.responsibility_manager(''order'',p_id)');
  end if;
end $$;

commit;
