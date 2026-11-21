begin;

create table dlight_private.payment_terms (
  scope text not null check (scope in ('job','order','work','trip')),
  owner_id uuid not null,
  subject text not null default '',
  terms jsonb not null,
  primary key(scope,owner_id,subject)
);
create table dlight_private.payment_term_changes (
  id bigint generated always as identity primary key,
  scope text not null, owner_id uuid not null, subject text not null,
  actor_id uuid not null, recorded_at timestamptz not null default now(),
  previous jsonb not null, current_terms jsonb not null
);
alter table dlight_private.payment_terms enable row level security;
alter table dlight_private.payment_term_changes enable row level security;
revoke all on dlight_private.payment_terms,dlight_private.payment_term_changes from public,anon,authenticated;

-- Keep explicit warranty terms from the existing work editor. Payers and
-- frozen tariff snapshots retain their existing sources.
insert into dlight_private.payment_terms(scope,owner_id,subject,terms)
  select 'work',order_id,id::text,'{"warranty":"warranty"}'::jsonb
  from public.service_order_items where kind='work' and billable=false
    and request_finance_void_event_id is null and legacy_snapshot->>'request_finance_voided_at' is null;

create function dlight_private.payment_local(p_scope text,p_owner uuid,p_subject text default '') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select terms from dlight_private.payment_terms
    where scope=p_scope and owner_id=p_owner and subject=p_subject),'{}'::jsonb)
$$;

create function dlight_private.payment_trip_jobs(p_trip uuid) returns setof uuid
language sql stable set search_path = '' as $$
  select job.id from public.jobs job where job.deleted_at is null and job.id in (
    select job_id from public.trip_jobs where trip_id=p_trip
    union select task.job_id from public.trip_service_orders link
      join public.service_orders task on task.id=link.order_id where link.trip_id=p_trip
  )
$$;

create function dlight_private.payment_job_model(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',job.id,'title',coalesce(client.name,'Клиент заявки'),
    'local',dlight_private.payment_local('job',job.id))
  from public.jobs job left join public.clients client on client.id=job.client_id
  where job.id=p_id and job.deleted_at is null
$$;

create function dlight_private.payment_order_model(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',task.id,'number',task.number,'title',task.title,
    'job',dlight_private.payment_job_model(task.job_id), 'local',dlight_private.payment_local('order',task.id),
    'works',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'title',item.title,
          'local',dlight_private.payment_local('work',task.id,item.id::text)) order by item.title,item.id)
      from public.service_order_items item where item.order_id=task.id and item.kind='work'
        and item.request_finance_void_event_id is null and item.legacy_snapshot->>'request_finance_voided_at' is null),'[]'::jsonb))
  from public.service_orders task where task.id=p_id
$$;

create function dlight_private.payment_trip_model(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',trip.id,'title',coalesce(trip.vehicle_label,'Выезд'),
    'local',dlight_private.payment_local('trip',trip.id),
    'jobs',coalesce((select jsonb_agg(dlight_private.payment_job_model(job_id) order by job_id)
      from dlight_private.payment_trip_jobs(trip.id) job_id),'[]'::jsonb))
  from public.trips trip where trip.id=p_id and trip.deleted_at is null
$$;

create function dlight_private.entity_payment_terms_read(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  item jsonb;
  model jsonb;
  editable boolean;
begin
  if p_scope is null or p_scope not in ('job','order','trip') or dlight_private.responsibility_access(p_scope,p_id) is not true then
    raise exception 'Условия оплаты недоступны';
  end if;
  if p_scope='job' then
    select status::text <> 'cancelled' into editable from public.jobs where id=p_id and deleted_at is null;
    item:=dlight_private.payment_job_model(p_id);
    model:=jsonb_build_object('orders',coalesce((select jsonb_agg(dlight_private.payment_order_model(id) order by number)
        from public.service_orders where job_id=p_id and dlight_private.responsibility_access('order',id)),'[]'::jsonb),
      'trips',coalesce((select jsonb_agg(dlight_private.payment_trip_model(trip.id) order by trip.date_from,trip.id)
        from public.trips trip where trip.deleted_at is null and dlight_private.responsibility_access('trip',trip.id)
          and (exists(select 1 from public.trip_jobs where trip_id=trip.id and job_id=p_id)
            or exists(select 1 from public.trip_service_orders link join public.service_orders task on task.id=link.order_id
              where link.trip_id=trip.id and task.job_id=p_id))),'[]'::jsonb));
  elsif p_scope='order' then
    select status::text <> 'cancelled' into editable from public.service_orders where id=p_id;
    item:=dlight_private.payment_order_model(p_id);
  else
    select status::text <> 'cancelled' into editable from public.trips where id=p_id and deleted_at is null;
    item:=dlight_private.payment_trip_model(p_id);
  end if;
  if item is null then raise exception 'Карточка недоступна'; end if;
  return coalesce(model,'{}'::jsonb)||jsonb_build_object('item',item,'scope',p_scope,
    'editable',editable and dlight_private.responsibility_manager(p_scope,p_id));
end $$;

create function dlight_private.entity_payment_terms_save(p_scope text,p_id uuid,p_subject text,p_previous jsonb,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  access_scope text;
  state text;
  request_id uuid;
  previous jsonb;
  payer text;
begin
  if p_scope is null or p_scope not in ('job','order','trip','work') or p_subject is null
    or (p_scope='work') is distinct from (p_subject<>'') then raise exception 'Некорректная карточка условий оплаты'; end if;
  access_scope:=case when p_scope='work' then 'order' else p_scope end;
  if dlight_private.responsibility_manager(access_scope,p_id) is not true then
    raise exception 'Условия оплаты изменяет куратор';
  end if;
  if access_scope='job' then
    select status::text,id into state,request_id from public.jobs where id=p_id and deleted_at is null for update;
  elsif access_scope='order' then
    select status::text,job_id into state,request_id from public.service_orders where id=p_id for update;
  else
    select status::text into state from public.trips where id=p_id and deleted_at is null for update;
  end if;
  if state is null or state='cancelled' or dlight_private.responsibility_manager(access_scope,p_id) is not true then
    raise exception 'Условия оплаты доступны только для просмотра';
  end if;
  if p_scope='work' and not exists(select 1 from public.service_order_items where order_id=p_id and id::text=p_subject
    and kind='work' and request_finance_void_event_id is null and legacy_snapshot->>'request_finance_voided_at' is null) then
    raise exception 'Работа не принадлежит заданию';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or (p_terms-'warranty'-'payer')<>'{}'
    or (p_terms?'warranty' and coalesce(p_terms->>'warranty','') not in ('paid','warranty')) then
    raise exception 'Проверьте условия оплаты';
  end if;
  payer:=p_terms->>'payer';
  if p_terms?'payer' and coalesce(payer,'') not in ('warranty-dept','service') then
    if access_scope='trip' then
      if not exists(select 1 from dlight_private.payment_trip_jobs(p_id) job_id where payer='client:'||job_id::text) then
        raise exception 'Выберите плательщика из связанных заявок';
      end if;
    elsif payer is distinct from ('client:'||request_id::text) or request_id is null then
      raise exception 'Выберите плательщика этой заявки';
    end if;
  end if;
  previous:=dlight_private.payment_local(p_scope,p_id,p_subject);
  if previous is distinct from p_previous then
    raise exception 'Условия изменились. Обновите карточку' using errcode='40001';
  end if;
  if previous=p_terms then return previous; end if;
  if p_terms='{}' then
    delete from dlight_private.payment_terms where scope=p_scope and owner_id=p_id and subject=p_subject;
  else
    insert into dlight_private.payment_terms values(p_scope,p_id,p_subject,p_terms)
      on conflict(scope,owner_id,subject) do update set terms=excluded.terms;
  end if;
  insert into dlight_private.payment_term_changes(scope,owner_id,subject,actor_id,previous,current_terms)
    values(p_scope,p_id,p_subject,auth.uid(),previous,p_terms);
  return p_terms;
end $$;

create function public.entity_payment_terms_read(p_scope text,p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select dlight_private.entity_payment_terms_read(p_scope,p_id)
$$;
create function public.entity_payment_terms_save(p_scope text,p_id uuid,p_subject text,p_previous jsonb,p_terms jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select dlight_private.entity_payment_terms_save(p_scope,p_id,p_subject,p_previous,p_terms)
$$;
revoke all on function dlight_private.payment_local(text,uuid,text),dlight_private.payment_trip_jobs(uuid),
  dlight_private.payment_job_model(uuid),dlight_private.payment_order_model(uuid),dlight_private.payment_trip_model(uuid),
  dlight_private.entity_payment_terms_read(text,uuid),public.entity_payment_terms_read(text,uuid),
  dlight_private.entity_payment_terms_save(text,uuid,text,jsonb,jsonb),public.entity_payment_terms_save(text,uuid,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function dlight_private.entity_payment_terms_read(text,uuid),public.entity_payment_terms_read(text,uuid),
  dlight_private.entity_payment_terms_save(text,uuid,text,jsonb,jsonb),public.entity_payment_terms_save(text,uuid,text,jsonb,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
