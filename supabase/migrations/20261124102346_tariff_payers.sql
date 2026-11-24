-- Payers are tariff profiles from settings (the mockup's "warranty/service department" and
-- "request client" placeholders had no tariff behind them). A payer is stored as the profile id.
--
-- Effective payer of a line, most specific first:
--   work terms → manually chosen work profile → task terms → request terms → default profile.
-- A work profile is "manual" when it differs from the default the work would get anyway
-- (client default profile for paid work, otherwise the profile flagged as the paid/warranty default).

create or replace function dlight_private.tariff_profile_list() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',coalesce(nullif(p->>'name',''),'Без названия'),
      'def_paid',coalesce((p->>'def_paid')::boolean,false),'def_warranty',coalesce((p->>'def_warranty')::boolean,false))
    order by p->>'name',p->>'id'),'[]'::jsonb)
  from public.settings s cross join lateral jsonb_array_elements(coalesce(s.tariff_profiles,'[]'::jsonb)) p
  where s.id=true and nullif(p->>'id','') is not null
$$;

create or replace function dlight_private.tariff_profile_exists(p_id text) returns boolean
language sql stable set search_path = '' as $$
  select p_id is not null and exists(select 1 from public.settings s
    cross join lateral jsonb_array_elements(coalesce(s.tariff_profiles,'[]'::jsonb)) p
    where s.id=true and p->>'id'=p_id)
$$;

-- Same rule as the work financial snapshot trigger: client profile for paid work, then the flagged default.
create or replace function dlight_private.tariff_default_payer(p_job uuid,p_warranty text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select c.default_profile from public.jobs j join public.clients c on c.id=j.client_id
      where j.id=p_job and p_warranty is distinct from 'warranty' and dlight_private.tariff_profile_exists(c.default_profile)),
    (select p->>'id' from public.settings s cross join lateral jsonb_array_elements(coalesce(s.tariff_profiles,'[]'::jsonb)) p
      where s.id=true and coalesce((p->>case when p_warranty='warranty' then 'def_warranty' else 'def_paid' end)::boolean,false)
      order by p->>'id' limit 1))
$$;

create or replace function dlight_private.payment_work_terms(p_job uuid,p_order uuid,p_item uuid,p_profile text,p_billable boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  item_warranty text:=case when p_billable is false then 'warranty' else 'paid' end;
  manual jsonb:='{}';
  terms jsonb;
begin
  if dlight_private.tariff_profile_exists(p_profile)
    and p_profile is distinct from dlight_private.tariff_default_payer(p_job,item_warranty) then
    manual:=jsonb_build_object('payer',p_profile);
  end if;
  terms:=coalesce(dlight_private.payment_local('job',p_job),'{}')||dlight_private.payment_local('order',p_order)
    ||manual||dlight_private.payment_local('work',p_order,p_item::text);
  -- The default is reported separately: an explicit payer re-prices the line, the default keeps its snapshot.
  return terms||jsonb_build_object('default_payer',dlight_private.tariff_default_payer(p_job,coalesce(terms->>'warranty',item_warranty)));
end $$;

create or replace function dlight_private.payment_job_model(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',job.id,'title',coalesce(client.name,'Клиент заявки'),
    'default_profile',case when dlight_private.tariff_profile_exists(client.default_profile) then client.default_profile end,
    'local',dlight_private.payment_local('job',job.id))
  from public.jobs job left join public.clients client on client.id=job.client_id
  where job.id=p_id and job.deleted_at is null
$$;

create or replace function dlight_private.payment_order_model(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',task.id,'number',task.number,'title',task.title,
    'job',dlight_private.payment_job_model(task.job_id), 'local',dlight_private.payment_local('order',task.id),
    'works',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'title',item.title,
          'tariff_profile',item.tariff_profile,'billable',item.billable,
          'local',dlight_private.payment_local('work',task.id,item.id::text)) order by item.title,item.id)
      from public.service_order_items item where item.order_id=task.id and item.kind='work'
        and item.request_finance_void_event_id is null and item.legacy_snapshot->>'request_finance_voided_at' is null),'[]'::jsonb))
  from public.service_orders task where task.id=p_id
$$;

-- Source patches keep the rest of each function exactly as deployed.
do $patch$
declare
  source text;
  patched text;
begin
  source:=pg_get_functiondef('dlight_private.entity_payment_terms_read(text,uuid)'::regprocedure);
  patched:=replace(source,'jsonb_build_object(''item'',item,''scope'',p_scope,',
    'jsonb_build_object(''item'',item,''scope'',p_scope,''profiles'',dlight_private.tariff_profile_list(),');
  if patched=source then raise exception 'entity_payment_terms_read: profiles patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.entity_payment_terms_save(text,uuid,text,jsonb,jsonb)'::regprocedure);
  patched:=regexp_replace(source,
    'if p_terms\?''payer'' and coalesce\(payer,''''\) not in \(''warranty-dept'',''service''\) then.*?raise exception ''Выберите плательщика этой заявки'';\s*end if;\s*end if;',
    'if p_terms?''payer'' and not dlight_private.tariff_profile_exists(payer) then
    raise exception ''Выберите плательщика из тарифных профилей'';
  end if;');
  if patched=source then raise exception 'entity_payment_terms_save: payer patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.journal_road_save(uuid,text,integer,jsonb,text,jsonb)'::regprocedure);
  patched:=regexp_replace(source,
    'if p_value\?''payer'' and coalesce\(payer,''''\) not in \(''warranty-dept'',''service''\) and not exists\(.*?\) then raise exception ''Выберите плательщика из связанных заявок''; end if;',
    'if p_value?''payer'' and not dlight_private.tariff_profile_exists(payer) then
      raise exception ''Выберите плательщика из тарифных профилей'';
    end if;');
  if patched=source then raise exception 'journal_road_save: payer patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.journal_road_model(uuid)'::regprocedure);
  patched:=replace(source,'''tariffs'',config,''editable''','''tariffs'',config,''profiles'',dlight_private.tariff_profile_list(),''editable''');
  if patched=source then raise exception 'journal_road_model: profiles patch did not apply'; end if;
  execute patched;

  source:=pg_get_functiondef('dlight_private.finance_lines(uuid[],uuid,text)'::regprocedure);
  patched:=regexp_replace(source,
    'coalesce\(dlight_private\.payment_local\(''job'',o\.job_id\),''\{\}''\)\|\|dlight_private\.payment_local\(''order'',o\.id\)\s*\|\|dlight_private\.payment_local\(''work'',o\.id,i\.id::text\) as terms',
    'dlight_private.payment_work_terms(o.job_id,o.id,i.id,i.tariff_profile,i.billable) as terms');
  if patched=source then raise exception 'finance_lines: terms patch did not apply'; end if;
  execute patched;
end $patch$;

-- Helpers run inside the SECURITY DEFINER read/save functions only.
revoke all on function dlight_private.tariff_profile_list(),dlight_private.tariff_profile_exists(text),
  dlight_private.tariff_default_payer(uuid,text),dlight_private.payment_work_terms(uuid,uuid,uuid,text,boolean)
  from public,anon,authenticated;
