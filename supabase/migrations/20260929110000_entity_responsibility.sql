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
create function public.entity_finance_config(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not dlight_private.responsibility_manager(p_kind,p_id) then
    raise exception 'Нет доступа к финансовым настройкам сущности';
  end if;
  select case when p_kind='trip' then
    jsonb_build_object('tariffs',tariffs,'costs',costs,'tariff_profiles',tariff_profiles)
    else jsonb_build_object('tariff_profiles',tariff_profiles) end into result
    from public.settings where id=true;
  return result;
end $$;
revoke all on function public.entity_finance_config(text,uuid) from public,anon,authenticated;
grant execute on function public.entity_finance_config(text,uuid) to authenticated;
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
do $$ begin
  if to_regclass('public.trip_reschedules') is not null then
    execute $policy$create policy trip_reschedules_responsibility_read on public.trip_reschedules
      for select to authenticated using (
        dlight_private.responsibility_manager('trip',trip_id)
      )$policy$;
  end if;
end $$;
create policy trip_cost_runs_responsibility_read on public.trip_cost_allocation_runs
  for select to authenticated using (
    dlight_private.responsibility_manager('trip',trip_id)
  );
create policy trip_stay_allocations_responsibility_read on public.trip_stay_task_allocations
  for select to authenticated using (
    exists(select 1 from public.trip_stays s where s.id=stay_id
      and dlight_private.responsibility_manager('trip',s.trip_id))
  );
create policy request_void_responsibility_read on public.request_finance_void_events
  for select to authenticated using (
    dlight_private.responsibility_manager('job',job_id)
  );
create policy request_correction_responsibility_read on public.request_finance_correction_links
  for select to authenticated using (
    exists(select 1 from public.request_finance_void_events e
      where e.id=event_id and dlight_private.responsibility_manager('job',e.job_id))
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

-- A delegated owner may still move a request or trip, but every such move
-- carries its reason in the same transaction. Clients cannot insert audit
-- rows directly, and the guard rejects status writes without one.
create table public.entity_status_interventions (
  id bigint generated always as identity primary key,
  entity_kind text not null check(entity_kind in ('job','trip')),
  entity_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  previous_status text not null,
  next_status text not null,
  reason text not null check(length(btrim(reason)) between 5 and 1000),
  transaction_id bigint not null,
  created_at timestamptz not null default now()
);
create index entity_status_interventions_entity_idx
  on public.entity_status_interventions(entity_kind,entity_id,created_at desc);
alter table public.entity_status_interventions enable row level security;
revoke all on public.entity_status_interventions from public,anon,authenticated;
grant select on public.entity_status_interventions to authenticated;
create policy entity_status_interventions_read on public.entity_status_interventions
  for select to authenticated using (
    dlight_private.responsibility_access(entity_kind,entity_id)
  );

create function dlight_private.record_status_intervention(
  p_kind text,p_id uuid,p_status text,p_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid; curator uuid; old_status text;
begin
  if p_kind='job' then
    select owner_id,curator_id,status::text into owner,curator,old_status
      from public.jobs where id=p_id and deleted_at is null for update;
  elsif p_kind='trip' then
    select owner_id,curator_id,status::text into owner,curator,old_status
      from public.trips where id=p_id and deleted_at is null for update;
  else raise exception 'Некорректный тип вмешательства'; end if;
  if not found or auth.uid() is null or auth.uid() is distinct from owner
    or curator is not distinct from owner or not dlight_private.responsibility_manager(p_kind,p_id)
  then raise exception 'Вмешательство владельца недоступно'; end if;
  if old_status=p_status then raise exception 'Стадия уже установлена'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 1000
  then raise exception 'Укажи причину вмешательства (5–1000 символов)'; end if;
  insert into public.entity_status_interventions(
    entity_kind,entity_id,actor_id,previous_status,next_status,reason,transaction_id)
  values(p_kind,p_id,auth.uid(),old_status,p_status,btrim(p_reason),txid_current());
end $$;
revoke all on function dlight_private.record_status_intervention(text,uuid,text,text)
  from public,anon,authenticated;

create function dlight_private.status_intervention_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  if new.status is not distinct from old.status or auth.uid() is null
    or auth.uid() is distinct from old.owner_id
    or old.curator_id is not distinct from old.owner_id then return new; end if;
  kind:=case tg_table_name when 'jobs' then 'job' else 'trip' end;
  if not exists(select 1 from public.entity_status_interventions e
    where e.entity_kind=kind and e.entity_id=old.id and e.actor_id=auth.uid()
      and e.previous_status=old.status::text and e.next_status=new.status::text
      and e.transaction_id=txid_current())
  then raise exception 'Владелец указывает причину вмешательства'; end if;
  return new;
end $$;
revoke all on function dlight_private.status_intervention_guard() from public,anon,authenticated;
create trigger jobs_status_intervention_guard before update of status on public.jobs
  for each row execute function dlight_private.status_intervention_guard();
create trigger trips_status_intervention_guard before update of status on public.trips
  for each row execute function dlight_private.status_intervention_guard();

create function public.entity_status_intervene(
  p_kind text,p_id uuid,p_status text,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare result text;
begin
  perform dlight_private.record_status_intervention(p_kind,p_id,p_status,p_reason);
  if p_kind='job' then
    update public.jobs set status=p_status::public.job_status where id=p_id;
    return p_status;
  end if;
  if p_status='in_progress' then result:=public.trip_start(p_id);
  elsif p_status='finished' then result:=public.trip_finish(p_id);
  elsif p_status='done' then result:=public.trip_confirm(p_id);
  else
    update public.trips set status=p_status::public.trip_status where id=p_id;
    result:=p_status;
  end if;
  if result in ('busy','wrong_status','not_found') then
    raise exception 'Выезд изменён другим пользователем. Обнови данные';
  end if;
  return result;
end $$;
revoke all on function public.entity_status_intervene(text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.entity_status_intervene(text,uuid,text,text)
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
  old_check:='update public.jobs set status=''in_progress'' where id=request_id and status in (''open'',''planned'');';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request stage sync in task transition';
  end if;
  definition:=replace(definition,old_check,
    'if exists(select 1 from public.jobs j where j.id=request_id '
    ||'and j.owner_id=auth.uid() and j.curator_id is distinct from auth.uid() '
    ||'and j.status in (''open'',''planned'')) then '
    ||'perform dlight_private.record_status_intervention(''job'',request_id,''in_progress'','
    ||'coalesce(nullif(btrim(p_reason),''''),''Автоматически вслед за запуском задания'')); end if;'||E'\n   '
    ||old_check);
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

do $$
declare target regprocedure; definition text; old_check text;
begin
  old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
  foreach target in array array[
    'public.trip_workbench_read(uuid)'::regprocedure,
    'public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure,
    'public.trip_presence_save(uuid,integer,jsonb,text)'::regprocedure,
    'public.trip_presence_detect(uuid,integer)'::regprocedure,
    'dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure,
    'public.trip_cost_allocation_save(uuid,integer,timestamptz,text,jsonb,jsonb)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(target);
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip manager check in %; review migration',target;
    end if;
    definition:=replace(definition,old_check,
      case when target='public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure
        or target='dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure
      then 'auth.uid() is null or (p_trip is null and public.user_role() not in (''admin'',''logist'')) or (p_trip is not null and not dlight_private.responsibility_manager(''trip'',p_trip))'
      else 'auth.uid() is null or not dlight_private.responsibility_manager(''trip'',p_trip)' end);
    execute definition;
  end loop;
end $$;

-- A plan save may also move an unstarted trip between planned and assigned.
-- Its existing reason field becomes the audited intervention reason.
do $$
declare target regprocedure; definition text; old_check text;
begin
  target:='public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='perform set_config(''dlight.change_reason'',coalesce(nullif(btrim(p_reason),''''),''Создание плана''),true);';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected trip plan status write; review migration';
  end if;
  execute replace(definition,old_check,
    'if p_trip is not null and t.owner_id=auth.uid() and t.curator_id is distinct from auth.uid() '
    ||'and v.status is distinct from t.status then '
    ||'perform dlight_private.record_status_intervention(''trip'',p_trip,v.status::text,p_reason); end if;'||E'\n  '
    ||old_check);
end $$;

-- Starting and finishing still allow assigned engineers; the curator and
-- owner gain the same controls even when they are not in the crew.
do $$
declare target regprocedure; definition text; old_check text;
begin
  foreach target in array array[
    to_regprocedure('public.trip_start(uuid)'),
    to_regprocedure('public.trip_finish(uuid)')
  ] loop
    if target is null then continue; end if;
    definition:=pg_get_functiondef(target);
    old_check:='public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids)';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip action guard in %; review migration',target;
    end if;
    execute replace(definition,old_check,
      'dlight_private.responsibility_manager(''trip'',p_trip) or '
      ||old_check);
  end loop;

  target:=to_regprocedure('public.trip_confirm(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='if coalesce(public.user_role(),'''') not in (''admin'',''logist'') then';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip confirmation guard; review migration';
    end if;
    execute replace(definition,old_check,
      'if not dlight_private.responsibility_manager(''trip'',p_trip) then');
  end if;
end $$;

-- Related trip actions must follow the same entity authority. Reassigning
-- tracking affects two trips and therefore requires authority over both.
do $$
declare target regprocedure; definition text; old_check text; replacement text;
begin
  foreach target in array array[
    to_regprocedure('public.trip_recalc_fact(uuid)'),
    to_regprocedure('public.trip_reschedule_decide(uuid,boolean,text)'),
    to_regprocedure('public.trip_tracking_cancel(uuid)'),
    to_regprocedure('public.trip_tracking_reassign(uuid,uuid)'),
    to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
  ] loop
    if target is null then continue; end if;
    definition:=pg_get_functiondef(target);
    old_check:=case when target=to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
      then 'auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')'
      else 'coalesce(public.user_role(),'''') not in (''admin'',''logist'')' end;
    if position(old_check in definition)=0 then
      raise exception 'Unexpected linked trip guard in %; review migration',target;
    end if;
    replacement:=case
      when target=to_regprocedure('public.trip_reschedule_decide(uuid,boolean,text)')
        then 'not dlight_private.responsibility_manager(''trip'',(select trip_id from public.trip_reschedules where id=p_req))'
      when target=to_regprocedure('public.trip_tracking_reassign(uuid,uuid)')
        then 'not (dlight_private.responsibility_manager(''trip'',p_from) and dlight_private.responsibility_manager(''trip'',p_to))'
      else 'not dlight_private.responsibility_manager(''trip'',p_trip)' end;
    if target=to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
    then replacement:='auth.uid() is null or '||replacement; end if;
    execute replace(definition,old_check,replacement);
  end loop;
end $$;

-- Curators need the task-aware presence editor and fact hours even when
-- they are not travelling as part of the crew. Assigned engineers retain
-- their existing read and detection privileges.
do $$
declare target regprocedure; definition text; old_check text;
begin
  target:=to_regprocedure('public.trip_presence_save_tasks(uuid,integer,jsonb,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then raise exception 'Unexpected presence task guard'; end if;
    execute replace(definition,old_check,
      'auth.uid() is null or not dlight_private.responsibility_manager(''trip'',p_trip)');
  end if;

  target:=to_regprocedure('public.trip_fact_hours(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='coalesce(public.user_role(),'''')=''engineer'' and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false)';
    if position(old_check in definition)=0 then raise exception 'Unexpected trip fact hours guard'; end if;
    execute replace(definition,old_check,
      'coalesce(public.user_role(),'''')=''engineer'' and not dlight_private.responsibility_manager(''trip'',p_trip) and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false)');
  end if;

  target:=to_regprocedure('public.trip_detect_stays(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false)';
    if position(old_check in definition)=0 then raise exception 'Unexpected trip detection guard'; end if;
    execute replace(definition,old_check,
      'and not dlight_private.responsibility_manager(''trip'',p_trip) '
      ||old_check);
  end if;

  target:=to_regprocedure('public.trip_reschedule_request(uuid,date,date,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='not public.is_owner_or_mgr(t.lead_engineer)';
    if position(old_check in definition)=0 then raise exception 'Unexpected reschedule request guard'; end if;
    execute replace(definition,old_check,
      'not (dlight_private.responsibility_manager(''trip'',p_trip) or public.is_owner_or_mgr(t.lead_engineer))');
  end if;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  target:='dlight_private.request_finance_save(uuid,jsonb,jsonb,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='manager:=coalesce(public.user_role() in (''admin'',''logist''),false);';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected canonical request save function; review migration';
  end if;
  definition:=replace(definition,old_check,
    'manager:=coalesce(public.user_role() in (''admin'',''logist''),false) or (jid is not null and dlight_private.responsibility_manager(''job'',jid));');
  old_check:='not (auth.uid()=any(coalesce(job.engineer_ids,''{}''::uuid[])) or job.assigned_engineer=auth.uid())';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request assignee guard; review migration';
  end if;
  definition:=replace(definition,old_check,
    'not coalesce(auth.uid()=any(coalesce(job.engineer_ids,''{}''::uuid[])) or job.assigned_engineer=auth.uid(),false)');
  old_check:='update public.jobs set client_id=(p_rec->>''client_id'')::uuid,';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected canonical request status write; review migration';
  end if;
  execute replace(definition,old_check,
    'if job.owner_id=auth.uid() and job.curator_id is distinct from auth.uid() '
    ||'and job.status is distinct from coalesce(nullif(p_rec->>''status'','''')::public.job_status,job.status) '
    ||'then perform dlight_private.record_status_intervention(''job'',jid,p_rec->>''status'',p_rec->>''intervention_reason''); end if;'||E'\n    '
    ||old_check);

  target:='dlight_private.request_finance_approve(uuid,uuid[])'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='auth.uid() is null or coalesce(public.user_role() in (''admin'',''logist''),false) is not true';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request approval function; review migration';
  end if;
  execute replace(definition,old_check,
    'auth.uid() is null or not dlight_private.responsibility_manager(''job'',p_job)');

  target:='dlight_private.request_finance_void(uuid,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if position(old_check in definition)=0 then
    raise exception 'Unexpected finance void function; review migration';
  end if;
  execute replace(definition,old_check,
    'auth.uid() is null or not dlight_private.responsibility_manager(''job'',(select i.job_id from public.service_order_items i where i.id=p_item))');

  target:='dlight_private.request_finance_link_correction(uuid,uuid)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if position(old_check in definition)=0 then
    raise exception 'Unexpected finance correction function; review migration';
  end if;
  execute replace(definition,old_check,
    'auth.uid() is null or not dlight_private.responsibility_manager(''job'',(select e.job_id from public.request_finance_void_events e where e.id=p_event))');
end $$;

-- Existing trip reminders keep their engineer recipient. The supervisory
-- recipient becomes the assigned curator instead of every global manager.
do $$
declare target regprocedure; definition text; old_join text;
begin
  target:=to_regprocedure('public.push_due(text)');
  if target is null then return; end if;
  definition:=pg_get_functiondef(target);
  old_join:='join profiles p on p.role in (''admin'',''logist'') and coalesce(p.active,true)';
  if position(old_join in definition)=0 then
    raise exception 'Unexpected push_due recipients; review migration';
  end if;
  execute replace(definition,old_join,
    'join profiles p on p.id=d.curator_id and p.active');
end $$;

create table public.entity_push_events (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check(entity_kind in ('job','order','trip')),
  entity_id uuid not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index entity_push_events_recipient_idx on public.entity_push_events(recipient_id,created_at desc);
create table public.entity_push_deliveries (
  event_id uuid not null references public.entity_push_events(id) on delete cascade,
  subscription_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key(event_id,subscription_id)
);
alter table public.entity_push_events enable row level security;
alter table public.entity_push_deliveries enable row level security;
revoke all on public.entity_push_events,public.entity_push_deliveries from public,anon,authenticated;
grant select on public.entity_push_events to authenticated;
create policy entity_push_recipient_read on public.entity_push_events
  for select to authenticated using (recipient_id=auth.uid());

create function dlight_private.enqueue_curator_notice(
  p_kind text,p_id uuid,p_title text,p_body text,p_actor uuid
) returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  if p_kind='job' then
    select curator_id into recipient from public.jobs where id=p_id;
  elsif p_kind='order' then
    select curator_id into recipient from public.service_orders where id=p_id;
  elsif p_kind='trip' then
    select curator_id into recipient from public.trips where id=p_id;
  else
    raise exception 'Некорректная сущность уведомления';
  end if;
  if recipient is null or recipient is not distinct from p_actor
    or not exists(select 1 from public.profiles p where p.id=recipient and p.active)
  then return; end if;
  insert into public.entity_push_events(entity_kind,entity_id,recipient_id,title,body)
    values(p_kind,p_id,recipient,left(p_title,120),left(p_body,500));
end $$;
revoke all on function dlight_private.enqueue_curator_notice(text,uuid,text,text,uuid)
  from public,anon,authenticated;

create function dlight_private.status_intervention_notify() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dlight_private.enqueue_curator_notice(new.entity_kind,new.entity_id,
    'Владелец изменил стадию',new.previous_status||' → '||new.next_status||' · '||new.reason,null);
  return null;
end $$;
revoke all on function dlight_private.status_intervention_notify() from public,anon,authenticated;
create trigger entity_status_intervention_notify after insert on public.entity_status_interventions
  for each row execute function dlight_private.status_intervention_notify();

create function dlight_private.responsibility_notify() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.curator_id is distinct from new.previous_curator_id then
    perform dlight_private.enqueue_curator_notice(new.entity_kind,new.entity_id,
      'Назначено кураторство','Передана ответственность: '||new.reason,new.actor_id);
  end if;
  return null;
end $$;
revoke all on function dlight_private.responsibility_notify() from public,anon,authenticated;
create trigger entity_responsibility_notify after insert on public.entity_responsibility_events
  for each row execute function dlight_private.responsibility_notify();

create function dlight_private.entity_status_notify() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; title text;
begin
  if new.status is not distinct from old.status then return null; end if;
  kind:=case tg_table_name when 'jobs' then 'job'
    when 'service_orders' then 'order' else 'trip' end;
  if kind in ('job','trip') and exists(
    select 1 from public.entity_status_interventions e
    where e.entity_kind=kind and e.entity_id=new.id and e.actor_id=auth.uid()
      and e.transaction_id=txid_current()
      and e.previous_status=old.status::text and e.next_status=new.status::text
  ) then return null; end if;
  title:=case kind when 'job' then 'Заявка' when 'order' then 'Задание' else 'Выезд' end;
  perform dlight_private.enqueue_curator_notice(kind,new.id,title||' сменил стадию',
    old.status::text||' → '||new.status::text,auth.uid());
  return null;
end $$;
revoke all on function dlight_private.entity_status_notify() from public,anon,authenticated;
create trigger jobs_status_curator_push after update of status on public.jobs
  for each row execute function dlight_private.entity_status_notify();
create trigger orders_status_curator_push after update of status on public.service_orders
  for each row execute function dlight_private.entity_status_notify();
create trigger trips_status_curator_push after update of status on public.trips
  for each row execute function dlight_private.entity_status_notify();

create function dlight_private.deadline_curator_notify() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dlight_private.enqueue_curator_notice('order',new.order_id,
    'Предложен новый срок задания',new.reason,new.created_by);
  return null;
end $$;
revoke all on function dlight_private.deadline_curator_notify() from public,anon,authenticated;
create trigger deadline_curator_push after insert on public.service_order_deadline_requests
  for each row execute function dlight_private.deadline_curator_notify();

-- The Edge Function uses its service key. Browser roles have no EXECUTE.
create function public.entity_push_due()
returns table(event_id uuid,sub_id uuid,endpoint text,p256dh text,auth text,
  user_id uuid,title text,body text)
language plpgsql security definer set search_path='' as $$
begin
  return query
    select e.id,s.id,s.endpoint,s.p256dh,s.auth,e.recipient_id,e.title,e.body
    from public.entity_push_events e
    join public.push_subs s on s.user_id=e.recipient_id and s.fails<5
    join public.profiles p on p.id=e.recipient_id and p.active
    join lateral (
      select j.curator_id from public.jobs j
        where e.entity_kind='job' and j.id=e.entity_id and j.deleted_at is null
      union all
      select o.curator_id from public.service_orders o
        where e.entity_kind='order' and o.id=e.entity_id
      union all
      select t.curator_id from public.trips t
        where e.entity_kind='trip' and t.id=e.entity_id and t.deleted_at is null
    ) current_entity on current_entity.curator_id=e.recipient_id
    left join public.entity_push_deliveries d on d.event_id=e.id and d.subscription_id=s.id
    where d.event_id is null and e.created_at>now()-interval '7 days'
    order by e.created_at,e.id limit 200;
end $$;
create function public.entity_push_mark(p_event uuid,p_sub uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.entity_push_events e
    join public.push_subs s on s.id=p_sub and s.user_id=e.recipient_id where e.id=p_event)
  then raise exception 'Подписка не принадлежит адресату'; end if;
  insert into public.entity_push_deliveries(event_id,subscription_id)
    values(p_event,p_sub) on conflict do nothing;
end $$;
revoke all on function public.entity_push_due(),public.entity_push_mark(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.entity_push_due(),public.entity_push_mark(uuid,uuid)
  to service_role;

-- Reuse the verified push scheduler URL and secret reference for production;
-- QA has no push_secret and therefore schedules nothing.
do $$
declare command_text text;
begin
  if to_regclass('cron.job') is null then return; end if;
  select command into command_text from cron.job where jobname='trip-today-push' limit 1;
  if command_text is not null and position('kind=trip_today' in command_text)>0 then
    perform cron.schedule('entity-curator-push','*/2 * * * *',
      replace(command_text,'kind=trip_today','kind=entity'));
  end if;
end $$;

commit;

-- Reason-aware tracking actions. Legacy RPCs retain their signatures and
-- remain protected by the status guard; they cannot bypass owner auditing.
do $migration$
begin
  if to_regprocedure('public.trip_tracking_cancel(uuid)') is not null then
    execute $definition$
create or replace function public.trip_tracking_cancel_with_reason(p_trip uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $body$
declare s public.trip_tracking_sessions; source public.trips;
begin
  if not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Недостаточно прав'; end if;
  select * into s from public.trip_tracking_sessions where trip_id=p_trip for update;
  if not found then return 'not_found'; end if;
  select * into source from public.trips where id=p_trip and deleted_at is null for update;
  if not found then return 'not_found'; end if;
  if source.status='in_progress' and source.owner_id=auth.uid() and source.curator_id is distinct from auth.uid() then
    perform dlight_private.record_status_intervention('trip',p_trip,'assigned',p_reason);
  end if;
  update public.vehicle_positions set trip_id=null where trip_id=p_trip and ts>=s.capture_from;
  update public.trip_tracking_sessions set state='cancelled',updated_at=now() where id=s.id;
  perform set_config('dlight.via_rpc','1',true);
  update public.trips set status='assigned',started_at=null where id=p_trip and status='in_progress';
  update public.vehicle_state set trip_id=null where vehicle_id=s.vehicle_id and trip_id=p_trip;
  return 'cancelled';
end $body$;
$definition$;
    revoke all on function public.trip_tracking_cancel_with_reason(uuid,text) from public,anon,authenticated;
    grant execute on function public.trip_tracking_cancel_with_reason(uuid,text) to authenticated;
  end if;
  if to_regprocedure('public.trip_tracking_reassign(uuid,uuid)') is not null then
    execute $definition$
create or replace function public.trip_tracking_reassign_with_reason(p_from uuid,p_to uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $body$
declare s public.trip_tracking_sessions; source public.trips; target public.trips;
  cutoff timestamptz; target_session uuid;
begin
  if not (dlight_private.responsibility_manager('trip',p_from) and dlight_private.responsibility_manager('trip',p_to)) then raise exception 'Недостаточно прав'; end if;
  if p_from=p_to then raise exception 'Выбери другой выезд'; end if;
  select * into s from public.trip_tracking_sessions where trip_id=p_from for update;
  select * into source from public.trips where id=p_from and deleted_at is null for update;
  select * into target from public.trips where id=p_to and deleted_at is null for update;
  if s.id is null or source.id is null or target.id is null then return 'not_found'; end if;
  if target.vehicle_id is distinct from s.vehicle_id then raise exception 'У выездов разные машины'; end if;
  if target.status not in ('planned','assigned') then raise exception 'Целевой выезд уже начат или закрыт'; end if;
  cutoff:=public.trip_planned_start_at(target);
  if cutoff is null then raise exception 'У целевого выезда нет времени старта'; end if;
  if source.status='in_progress' and source.owner_id=auth.uid() and source.curator_id is distinct from auth.uid() then
    perform dlight_private.record_status_intervention('trip',p_from,'assigned',p_reason);
  end if;
  if cutoff<=now() and target.owner_id=auth.uid() and target.curator_id is distinct from auth.uid() then
    perform dlight_private.record_status_intervention('trip',p_to,'in_progress',p_reason);
  end if;
  update public.vehicle_positions set trip_id=null where trip_id=p_from and ts>=s.capture_from;
  update public.trip_tracking_sessions set state='reassigned',updated_at=now() where id=s.id;
  insert into public.trip_tracking_sessions(trip_id,vehicle_id,depot_id,state,planned_start_at,capture_from,actual_started_at,start_source)
  values(target.id,s.vehicle_id,s.depot_id,case when cutoff<=now() then 'active' else 'armed' end,cutoff,cutoff,
    case when cutoff<=now() then cutoff end,case when cutoff<=now() then 'manual' end)
  on conflict(trip_id) do update set state=excluded.state,capture_from=cutoff,actual_started_at=excluded.actual_started_at,
    start_source=excluded.start_source,updated_at=now() returning id into target_session;
  insert into public.trip_tracking_points(session_id,vehicle_id,ts,lat,lng,speed,status)
    select target_session,p.vehicle_id,p.ts,p.lat,p.lng,p.speed,p.status from public.trip_tracking_points p
    where p.session_id=s.id and p.ts>=cutoff on conflict do nothing;
  if cutoff<=now() then
    insert into public.vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status,moving,mileage)
      select p.vehicle_id,target.id,p.ts,p.lat,p.lng,p.speed,p.status,(p.status='moving'),null
      from public.trip_tracking_points p where p.session_id=target_session and p.ts>=cutoff on conflict(vehicle_id,ts) do update set trip_id=excluded.trip_id;
  end if;
  perform set_config('dlight.via_rpc','1',true);
  update public.trips set status='assigned',started_at=null where id=p_from and status='in_progress';
  if cutoff<=now() then update public.trips set status='in_progress',started_at=cutoff where id=p_to; end if;
  return case when cutoff<=now() then 'reassigned_started' else 'reassigned_future' end;
end $body$;
$definition$;
    revoke all on function public.trip_tracking_reassign_with_reason(uuid,uuid,text) from public,anon,authenticated;
    grant execute on function public.trip_tracking_reassign_with_reason(uuid,uuid,text) to authenticated;
  end if;
end $migration$;
