-- Record manager-approved voids as append-only events; preserve row IDs and snapshots.
begin;

alter table public.service_order_items add column if not exists request_finance_void_event_id uuid;

create table public.request_finance_void_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  item_id uuid not null unique references public.service_order_items(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 5 and 1000),
  original_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index request_finance_void_events_job_idx on public.request_finance_void_events(job_id,created_at desc);
alter table public.request_finance_void_events enable row level security;
revoke all on public.request_finance_void_events from public,anon,authenticated;
grant select on public.request_finance_void_events to authenticated;
create policy request_finance_void_events_manager_read on public.request_finance_void_events
 for select to authenticated using(coalesce(public.user_role() in ('admin','logist'),false));

-- Append the audit event first, then tombstone the canonical row within one transaction.
create function dlight_private.request_finance_void(p_item uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.service_order_items; order_state text; event_id uuid; reason text:=btrim(coalesce(p_reason,''));
begin
  if auth.uid() is null or coalesce(public.user_role() in ('admin','logist'),false) is not true then
    raise exception 'Аннулирует финансовую строку только диспетчер';
  end if;
  if length(reason) not between 5 and 1000 then raise exception 'Укажи причину длиной от 5 до 1000 символов'; end if;
  select * into item from public.service_order_items where id=p_item for update;
  if not found then raise exception 'Финансовая строка не найдена'; end if;
  if item.legacy_job_work_id is null and item.legacy_job_part_id is null
     and item.legacy_snapshot->>'request_finance_generation' is distinct from '1' then
    raise exception 'Аннулировать можно только финансовую строку заявки';
  end if;
  if not exists(select 1 from public.service_orders o where o.id=item.order_id and o.seed_request_id=item.job_id) then
    raise exception 'Аннулировать можно только строку базового задания заявки';
  end if;
  if item.request_finance_void_event_id is not null then raise exception 'Строка уже аннулирована'; end if;
  if item.done_qty>0 or item.transferred_qty>0 or item.source_item_id is not null then
    raise exception 'Строка уже имеет факт или перенос; нужна отдельная корректировка факта';
  end if;
  select status into order_state from public.service_orders where id=item.order_id for update;
  if order_state in ('in_progress','review','completed') then
    raise exception 'Нельзя аннулировать строку после начала или завершения задания';
  end if;
  insert into public.request_finance_void_events(order_id,job_id,item_id,actor_id,reason,original_snapshot)
  values(item.order_id,item.job_id,item.id,auth.uid(),reason,to_jsonb(item)) returning id into event_id;
  perform set_config('dlight.legacy_finance_sync','on',true);
  perform set_config('dlight.request_finance_sync','on',true);
  update public.service_order_items set request_finance_void_event_id=event_id,
    legacy_snapshot=coalesce(legacy_snapshot,'{}'::jsonb)||jsonb_build_object(
      'request_finance_voided_at',now(),'request_finance_voided_by',auth.uid(),'request_finance_void_reason',reason)
  where id=item.id;
  perform set_config('dlight.request_finance_sync','off',true);
  perform set_config('dlight.legacy_finance_sync','off',true);
  return jsonb_build_object('event_id',event_id,'item_id',item.id,'voided_at',now());
end $$;
revoke all on function dlight_private.request_finance_void(uuid,text) from public,anon,authenticated;
grant execute on function dlight_private.request_finance_void(uuid,text) to authenticated;
create function public.job_request_finance_void(p_item uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
 select dlight_private.request_finance_void(p_item,p_reason)
$$;
revoke all on function public.job_request_finance_void(uuid,text) from public,anon;
grant execute on function public.job_request_finance_void(uuid,text) to authenticated;

-- Keep correction links append-only as well: one void event may be corrected
-- by several new rows, but an active replacement cannot answer two voids.
create table public.request_finance_correction_links (
  event_id uuid not null references public.request_finance_void_events(id) on delete restrict,
  replacement_item_id uuid not null unique references public.service_order_items(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key(event_id,replacement_item_id)
);
alter table public.request_finance_correction_links enable row level security;
revoke all on public.request_finance_correction_links from public,anon,authenticated;
grant select on public.request_finance_correction_links to authenticated;
create policy request_finance_correction_links_manager_read on public.request_finance_correction_links
 for select to authenticated using(coalesce(public.user_role() in ('admin','logist'),false));

create function dlight_private.request_finance_link_correction(p_event uuid,p_replacement uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ev public.request_finance_void_events; old_item jsonb; replacement public.service_order_items;
begin
  if auth.uid() is null or coalesce(public.user_role() in ('admin','logist'),false) is not true then
    raise exception 'Связать исправление может только диспетчер';
  end if;
  select * into ev from public.request_finance_void_events where id=p_event for update;
  if not found then raise exception 'Запись об аннулировании не найдена'; end if;
  old_item:=ev.original_snapshot;
  select * into replacement from public.service_order_items where id=p_replacement for update;
  if not found or replacement.job_id<>ev.job_id or replacement.order_id<>ev.order_id then
    raise exception 'Исправление должно быть строкой того же базового задания';
  end if;
  if replacement.request_finance_void_event_id is not null or
     replacement.legacy_snapshot->>'request_finance_generation' is distinct from '1' or
     replacement.kind is distinct from old_item->>'kind' then
    raise exception 'Исправление должно быть активной строкой того же типа из заявки';
  end if;
  if exists(select 1 from public.request_finance_correction_links l where l.event_id=p_event and l.replacement_item_id=p_replacement) then
    raise exception 'Эта строка уже связана с аннулированием';
  end if;
  insert into public.request_finance_correction_links(event_id,replacement_item_id,actor_id)
  values(p_event,p_replacement,auth.uid());
  return jsonb_build_object('event_id',p_event,'replacement_item_id',p_replacement);
end $$;
revoke all on function dlight_private.request_finance_link_correction(uuid,uuid) from public,anon,authenticated;
grant execute on function dlight_private.request_finance_link_correction(uuid,uuid) to authenticated;
create function public.job_request_finance_link_correction(p_event uuid,p_replacement uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select dlight_private.request_finance_link_correction(p_event,p_replacement)
$$;
revoke all on function public.job_request_finance_link_correction(uuid,uuid) from public,anon;
grant execute on function public.job_request_finance_link_correction(uuid,uuid) to authenticated;

create or replace function dlight_private.request_finance_save(
  p_id uuid,p_rec jsonb,p_works jsonb,p_parts jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  jid uuid:=p_id; oid uuid; job public.jobs; manager boolean; order_status text;
  item jsonb; item_no bigint; item_id uuid; kept uuid[]:='{}';
  saved_works jsonb:='[]'; saved_parts jsonb:='[]';
  prior public.service_order_items; work_id uuid; title text; unit text;
  qty numeric; billable boolean; reason text; profile text; override_value numeric;
  repricing_billable boolean;
  approved_at timestamptz; approved_by uuid; catalog_id uuid; stock public.stock_catalog;
  part_name text; part_sku text; part_unit text; part_qty numeric; part_price numeric; part_cost numeric;
begin
  if auth.uid() is null then raise exception 'Требуется вход в приложение'; end if;
  perform set_config('dlight.request_finance_sync','on',true);
  if jsonb_typeof(p_rec) is distinct from 'object' then raise exception 'Некорректные данные заявки'; end if;
  if p_works is not null and jsonb_typeof(p_works) is distinct from 'array' then raise exception 'Некорректный состав работ'; end if;
  if p_parts is not null and jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'Некорректный состав материалов'; end if;
  manager:=coalesce(public.user_role() in ('admin','logist'),false);
  if jid is null and not manager then raise exception 'Только диспетчер создаёт заявку'; end if;

  if jid is null then
    insert into public.jobs(client_id,equipment_id,status,scheduled_date,time_window,due_date,
      assigned_engineer,engineer_ids,notes,at_depot,depot_id,created_by)
    values((p_rec->>'client_id')::uuid,nullif(p_rec->>'equipment_id','')::uuid,
      coalesce(nullif(p_rec->>'status','')::public.job_status,'open'::public.job_status),
      nullif(p_rec->>'scheduled_date','')::date,coalesce(p_rec->>'time_window',''),
      nullif(p_rec->>'due_date','')::date,nullif(p_rec->>'assigned_engineer','')::uuid,
      coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_rec->'engineer_ids','[]'::jsonb))),'{}'::uuid[]),
      coalesce(p_rec->>'notes',''),coalesce((p_rec->>'at_depot')::boolean,false),
      nullif(p_rec->>'depot_id','')::uuid,auth.uid())
    returning id into jid;
  else
    select * into job from public.jobs where id=jid for update;
    if not found or job.deleted_at is not null then raise exception 'Заявка не найдена или недоступна'; end if;
    if not manager and (public.user_role()<>'engineer' or
        not (auth.uid()=any(coalesce(job.engineer_ids,'{}'::uuid[])) or job.assigned_engineer=auth.uid())) then
      raise exception 'Нет доступа к заявке';
    end if;
    if not manager and job.status='done' and (p_works is not null or p_parts is not null) then
      raise exception 'Закрытую заявку нельзя менять';
    end if;
  end if;

  oid:=dlight_private.ensure_request_seed(jid);
  select status into order_status from public.service_orders where id=oid for update;
  if (p_works is not null or p_parts is not null) and order_status not in ('draft','assigned','paused') then
    raise exception 'Финансовый состав нельзя менять после начала выполнения задания';
  end if;
  if oid is null then raise exception 'Не найдено базовое задание заявки'; end if;
  if not exists(select 1 from public.service_order_jobs where order_id=oid and job_id=jid) then
    raise exception 'Базовое задание не связано с заявкой';
  end if;

  if p_works is not null then
    for item,item_no in select value,ordinality from jsonb_array_elements(p_works) with ordinality loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Некорректная строка работы'; end if;
      item_id:=nullif(item->>'id','')::uuid;
      work_id:=nullif(item->>'work_id','')::uuid;
      title:=coalesce(nullif(btrim(item->>'title'),''),'');
      unit:=coalesce(nullif(btrim(item->>'unit'),''),'ч');
      qty:=coalesce(nullif(item->>'hours','')::numeric,0);
      billable:=coalesce((item->>'billable')::boolean,true);
      reason:=btrim(coalesce(item->>'billable_reason',''));
      profile:=nullif(btrim(coalesce(item->>'tariff_profile','')),'');
      override_value:=case when manager then nullif(item->>'revenue_override','')::numeric else null end;
      if qty<=0 or qty>=1000000 then raise exception 'У работы должны быть положительные часы'; end if;
      if not billable and reason='' then raise exception 'Укажи причину гарантийной работы'; end if;
      if work_id is not null then
        select wc.name into title from public.work_catalog wc where wc.id=work_id;
        if not found then raise exception 'Работа больше не доступна в каталоге'; end if;
        unit:='ч';
      elsif length(btrim(title)) not between 1 and 500 then
        raise exception 'У работы должно быть название';
      end if;
      prior:=null;
      if item_id is not null then
        select * into prior from public.service_order_items where id=item_id and order_id=oid and job_id=jid for update;
        if not found and exists(select 1 from public.service_order_items where id=item_id) then
          raise exception 'Строка работы не принадлежит базовому заданию';
        end if;
        if prior.request_finance_void_event_id is not null then continue; end if;
        if prior.legacy_job_work_id is not null or prior.legacy_job_part_id is not null then
          raise exception 'Историческую строку заявки нельзя менять обычным сохранением';
        end if;
        if prior.id is not null and prior.legacy_snapshot->>'request_finance_generation' is distinct from '1' then
          raise exception 'Строка плана задания не принадлежит редактору заявки';
        end if;
        if prior.kind<>'work' then raise exception 'Нельзя менять тип строки задания'; end if;
        if not manager and prior.id is not null and prior.approved_at is null and prior.legacy_snapshot->>'created_by' is distinct from auth.uid()::text then
          raise exception 'Менять чужую работу может только диспетчер';
        end if;
        if not manager and prior.approved_at is not null and
          (prior.title,prior.unit,prior.planned_qty,prior.work_catalog_id,prior.billable,prior.billable_reason,prior.tariff_profile)
          is distinct from (title,unit,qty,work_id,billable,reason,profile) then
          raise exception 'Подтверждённую работу может менять только диспетчер';
        end if;
        if (prior.done_qty>0 or prior.transferred_qty>0 or prior.source_item_id is not null) and
          (prior.title,prior.unit,prior.work_catalog_id) is distinct from (title,unit,work_id) then
          raise exception 'Нельзя менять номенклатуру строки с зафиксированным фактом';
        end if;
      else
        item_id:=gen_random_uuid();
      end if;
      if item_id=any(kept) then raise exception 'Повтор строки работы'; end if;
      kept:=array_append(kept,item_id);
      if prior.id is null then
        insert into public.service_order_items(id,order_id,job_id,title,unit,planned_qty,kind,
          work_catalog_id,billable,billable_reason,tariff_profile,approved_at,approved_by,legacy_snapshot)
        values(item_id,oid,jid,title,unit,qty,'work',work_id,billable,reason,profile,
          case when manager then now() else null end,case when manager then auth.uid() else null end,
          jsonb_build_object('request_finance_generation',1,'revenue_override',override_value,'created_by',auth.uid()));
      else
        if manager and prior.approved_at is not null then approved_at:=prior.approved_at; approved_by:=prior.approved_by;
        elsif manager then approved_at:=now(); approved_by:=auth.uid();
        elsif prior.approved_at is not null then approved_at:=prior.approved_at; approved_by:=prior.approved_by;
        else approved_at:=null; approved_by:=null; end if;
        update public.service_order_items set title=title,unit=unit,planned_qty=qty,
          work_catalog_id=work_id,billable=billable,billable_reason=reason,tariff_profile=profile,
          approved_at=approved_at,approved_by=approved_by,
          legacy_snapshot=coalesce(prior.legacy_snapshot,'{}'::jsonb)||jsonb_build_object('request_finance_generation',1,'revenue_override',override_value)
        where id=item_id;
      end if;
      if manager and override_value is not null then
        update public.service_order_items set financial_revenue_snapshot=override_value where id=item_id;
      elsif manager and prior.id is not null and (prior.legacy_snapshot->>'revenue_override') is not null then
        repricing_billable:=billable;
        update public.service_order_items set billable=not repricing_billable where id=item_id;
        update public.service_order_items set billable=repricing_billable where id=item_id;
      end if;
      select * into prior from public.service_order_items where id=item_id;
      saved_works:=saved_works||jsonb_build_array(jsonb_build_object('index',coalesce(nullif(item->>'index','')::integer,item_no-1),'id',item_id,
        'revenue',coalesce(prior.financial_revenue_snapshot,0),'approved_at',prior.approved_at,'approved_by',prior.approved_by));
    end loop;
    if exists(select 1 from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='work'
       and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and i.request_finance_void_event_id is null and not(i.id=any(kept))
       and manager and (i.approved_at is not null or i.done_qty>0 or i.transferred_qty>0 or i.source_item_id is not null)) then
      raise exception 'Нельзя удалить подтверждённую работу или работу с результатом';
    end if;
    delete from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='work'
      and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and i.request_finance_void_event_id is null and not(i.id=any(kept))
      and i.request_finance_void_event_id is null and i.approved_at is null and i.done_qty=0 and i.transferred_qty=0 and i.source_item_id is null
      and (manager or i.legacy_snapshot->>'created_by'=auth.uid()::text);
    kept:='{}'::uuid[];
  end if;

  if p_parts is not null then
    for item,item_no in select value,ordinality from jsonb_array_elements(p_parts) with ordinality loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Некорректная строка материала'; end if;
      item_id:=nullif(item->>'id','')::uuid;
      part_name:=btrim(coalesce(item->>'name','')); part_sku:=btrim(coalesce(item->>'sku',''));
      part_unit:=btrim(coalesce(item->>'unit','')); part_qty:=coalesce(nullif(item->>'qty','')::numeric,0);
      part_price:=case when manager then coalesce(nullif(item->>'price','')::numeric,0) else 0 end;
      part_cost:=case when manager then coalesce(nullif(item->>'cost','')::numeric,0) else 0 end;
      billable:=coalesce((item->>'billable')::boolean,true);
      if part_name='' or length(part_name)>300 or length(part_sku)>120 or part_unit='' or length(part_unit)>40 or part_qty<=0 then
        raise exception 'У материала должны быть название, единица и положительное количество';
      end if;
      prior:=null; catalog_id:=null;
      if item_id is not null then
        select * into prior from public.service_order_items where id=item_id and order_id=oid and job_id=jid for update;
        if not found and exists(select 1 from public.service_order_items where id=item_id) then
          raise exception 'Строка материала не принадлежит базовому заданию';
        end if;
        if prior.request_finance_void_event_id is not null then continue; end if;
        if prior.legacy_job_work_id is not null or prior.legacy_job_part_id is not null then
          raise exception 'Историческую строку заявки нельзя менять обычным сохранением';
        end if;
        if prior.id is not null and prior.legacy_snapshot->>'request_finance_generation' is distinct from '1' then
          raise exception 'Строка плана задания не принадлежит редактору заявки';
        end if;
        if prior.kind<>'material' then raise exception 'Нельзя менять тип строки задания'; end if;
        if not manager and prior.id is not null and prior.approved_at is null and prior.legacy_snapshot->>'created_by' is distinct from auth.uid()::text then
          raise exception 'Менять чужой материал может только диспетчер';
        end if;
        if not manager and prior.approved_at is not null and
          (prior.title,prior.unit,prior.planned_qty,prior.sku_snapshot,prior.billable)
          is distinct from (part_name,part_unit,part_qty,part_sku,billable) then
          raise exception 'Подтверждённый материал может менять только диспетчер';
        end if;
        if (prior.done_qty>0 or prior.transferred_qty>0 or prior.source_item_id is not null) and
          (prior.title,prior.unit,prior.stock_catalog_id) is distinct from (part_name,part_unit,prior.stock_catalog_id) then
          raise exception 'Нельзя менять номенклатуру строки с зафиксированным фактом';
        end if;
        catalog_id:=prior.stock_catalog_id;
      else
        item_id:=gen_random_uuid();
      end if;
      if item_id=any(kept) then raise exception 'Повтор строки материала'; end if;
      kept:=array_append(kept,item_id);
      if prior.id is null then
        insert into public.stock_catalog(name,sku,unit,price,cost,created_by,updated_by)
        values(part_name,part_sku,part_unit,part_price,part_cost,auth.uid(),auth.uid()) returning id into catalog_id;
      else
        update public.stock_catalog set name=part_name,sku=part_sku,unit=part_unit,
          price=case when manager then part_price else price end,
          cost=case when manager then part_cost else cost end,updated_by=auth.uid()
        where id=catalog_id and prior.legacy_snapshot->>'request_finance_generation'='1';
      end if;
      if prior.id is null then
        insert into public.service_order_items(id,order_id,job_id,title,unit,planned_qty,kind,stock_catalog_id,
          sku_snapshot,unit_price_snapshot,unit_cost_snapshot,billable,approved_at,approved_by,legacy_snapshot)
        values(item_id,oid,jid,part_name,part_unit,part_qty,'material',catalog_id,part_sku,part_price,part_cost,
          billable,case when manager then now() else null end,case when manager then auth.uid() else null end,
          jsonb_build_object('request_finance_generation',1,'created_by',auth.uid()));
      else
        if manager and prior.approved_at is not null then approved_at:=prior.approved_at; approved_by:=prior.approved_by;
        elsif manager then approved_at:=now(); approved_by:=auth.uid();
        elsif prior.approved_at is not null then approved_at:=prior.approved_at; approved_by:=prior.approved_by;
        else approved_at:=null; approved_by:=null; end if;
        update public.service_order_items set title=part_name,unit=part_unit,planned_qty=part_qty,
          stock_catalog_id=catalog_id,sku_snapshot=part_sku,
          unit_price_snapshot=case when manager then part_price else prior.unit_price_snapshot end,
          unit_cost_snapshot=case when manager then part_cost else prior.unit_cost_snapshot end,
          billable=billable,approved_at=approved_at,approved_by=approved_by,
          legacy_snapshot=coalesce(prior.legacy_snapshot,'{}'::jsonb)||jsonb_build_object('request_finance_generation',1)
        where id=item_id;
      end if;
      select * into prior from public.service_order_items where id=item_id;
      saved_parts:=saved_parts||jsonb_build_array(jsonb_build_object('index',coalesce(nullif(item->>'index','')::integer,item_no-1),
        'id',item_id,'price',prior.unit_price_snapshot,'cost',prior.unit_cost_snapshot,
        'approved_at',prior.approved_at,'approved_by',prior.approved_by));
    end loop;
    if exists(select 1 from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='material'
       and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and i.request_finance_void_event_id is null and not(i.id=any(kept))
       and manager and (i.approved_at is not null or i.done_qty>0 or i.transferred_qty>0 or i.source_item_id is not null)) then
      raise exception 'Нельзя удалить подтверждённый материал, чужой материал или материал с результатом';
    end if;
    delete from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='material'
      and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and i.request_finance_void_event_id is null and not(i.id=any(kept))
      and i.request_finance_void_event_id is null and i.approved_at is null and i.done_qty=0 and i.transferred_qty=0 and i.source_item_id is null
      and (manager or i.legacy_snapshot->>'created_by'=auth.uid()::text);
  end if;

  if p_id is not null then
    if not manager and not (auth.uid()=any(coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_rec->'engineer_ids','[]'::jsonb))),'{}'::uuid[]))
       or auth.uid()=nullif(p_rec->>'assigned_engineer','')::uuid) then raise exception 'Нельзя снять с себя доступ к заявке'; end if;
    update public.jobs set client_id=(p_rec->>'client_id')::uuid,
      equipment_id=nullif(p_rec->>'equipment_id','')::uuid,
      status=coalesce(nullif(p_rec->>'status','')::public.job_status,status),
      scheduled_date=nullif(p_rec->>'scheduled_date','')::date,time_window=coalesce(p_rec->>'time_window',''),
      due_date=nullif(p_rec->>'due_date','')::date,assigned_engineer=nullif(p_rec->>'assigned_engineer','')::uuid,
      engineer_ids=coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_rec->'engineer_ids','[]'::jsonb))),'{}'::uuid[]),
      notes=coalesce(p_rec->>'notes',''),at_depot=coalesce((p_rec->>'at_depot')::boolean,false),
      depot_id=nullif(p_rec->>'depot_id','')::uuid where id=jid;
  end if;
  perform set_config('dlight.request_finance_sync','off',true);
  return jsonb_build_object('job_id',jid,'works',case when p_works is null then null else saved_works end,
    'parts',case when p_parts is null then null else saved_parts end);
end $$;
create or replace function dlight_private.sync_job_work_to_task()
returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; rate numeric;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.service_order_items i where i.legacy_job_work_id=old.id and i.request_finance_void_event_id is not null) then return null; end if;
    if exists(select 1 from public.service_order_items i where i.legacy_job_work_id=old.id) then
      raise exception 'Работу уже перенесли в задание; сначала аннулируй её согласованным способом';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.service_order_items i where i.legacy_job_work_id=old.id and i.request_finance_void_event_id is not null) then return new; end if;
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
create or replace function dlight_private.sync_job_part_to_task()
returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; catalog_id uuid;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.service_order_items i where i.legacy_job_part_id=old.id and i.request_finance_void_event_id is not null) then return null; end if;
    if exists(select 1 from public.service_order_items i where i.legacy_job_part_id=old.id) then
      raise exception 'Материал уже перенесён в задание; сначала аннулируй его согласованным способом';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.service_order_items i where i.legacy_job_part_id=old.id and i.request_finance_void_event_id is not null) then return new; end if;
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
create or replace function public.job_request_save(
  p_id uuid,p_rec jsonb,p_works jsonb default null,p_parts jsonb default null
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  jid uuid:=p_id; item jsonb; item_no bigint; wid uuid; existing public.job_works;
  v_work_id uuid; v_title text; v_hours numeric; v_billable boolean;
  v_reason text; v_revenue numeric; v_override numeric; v_profile text;
  v_approved_at timestamptz; v_approved_by uuid; kept uuid[]:='{}'::uuid[];
  saved jsonb:='[]'::jsonb; manager boolean:=coalesce(public.user_role() in ('admin','logist'),false);
  existing_part public.job_parts; part_id uuid; part_name text; part_sku text; part_unit text;
  part_qty numeric; part_price numeric; part_cost numeric; part_billable boolean;
  kept_parts uuid[]:='{}'::uuid[]; saved_parts jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Требуется вход в приложение'; end if;
  if jsonb_typeof(p_rec) is distinct from 'object' then raise exception 'Некорректные данные заявки'; end if;
  if p_works is not null and jsonb_typeof(p_works) is distinct from 'array' then raise exception 'Некорректный состав работ'; end if;
  if p_parts is not null and jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'Некорректный состав материалов'; end if;
  if jid is null and not manager then raise exception 'Только диспетчер создаёт заявку'; end if;

  if jid is null then
    insert into public.jobs(client_id,equipment_id,status,scheduled_date,time_window,due_date,
      assigned_engineer,engineer_ids,notes,at_depot,depot_id,created_by)
    values((p_rec->>'client_id')::uuid,nullif(p_rec->>'equipment_id','')::uuid,
      coalesce(nullif(p_rec->>'status','')::public.job_status,'open'::public.job_status),
      nullif(p_rec->>'scheduled_date','')::date,coalesce(p_rec->>'time_window',''),
      nullif(p_rec->>'due_date','')::date,nullif(p_rec->>'assigned_engineer','')::uuid,
      coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_rec->'engineer_ids','[]'::jsonb))),'{}'::uuid[]),
      coalesce(p_rec->>'notes',''),coalesce((p_rec->>'at_depot')::boolean,false),
      nullif(p_rec->>'depot_id','')::uuid,auth.uid())
    returning id into jid;
  else
    perform 1 from public.jobs where id=jid for update;
    if not found then raise exception 'Заявка не найдена или недоступна'; end if;
  end if;

  if p_works is not null then
    for item,item_no in select value,ordinality from jsonb_array_elements(p_works) with ordinality loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Некорректная строка работы'; end if;
      wid:=nullif(item->>'id','')::uuid;
      v_work_id:=nullif(item->>'work_id','')::uuid;
      v_title:=coalesce(item->>'title','');
      v_hours:=coalesce(nullif(item->>'hours','')::numeric,0);
      v_billable:=coalesce((item->>'billable')::boolean,true);
      v_reason:=coalesce(item->>'billable_reason','');
      v_revenue:=coalesce(nullif(item->>'revenue','')::numeric,0);
      v_override:=nullif(item->>'revenue_override','')::numeric;
      v_profile:=nullif(item->>'tariff_profile','');
      if wid is not null then
        select * into existing from public.job_works where id=wid for update;
        if found and existing.job_id is distinct from jid then raise exception 'Работа относится к другой заявке'; end if;
        if not found then raise exception 'Строка работы изменилась. Обнови заявку и повтори правку'; end if;
        if exists(select 1 from public.service_order_items i where i.legacy_job_work_id=wid and i.request_finance_void_event_id is not null) then continue; end if;
      end if;
      if wid is not null and
        (existing.work_id,existing.title,existing.hours,existing.billable,existing.billable_reason,
         existing.revenue,existing.revenue_override,existing.tariff_profile)
        is not distinct from
        (v_work_id,v_title,v_hours,v_billable,v_reason,v_revenue,v_override,v_profile) then
        v_approved_at:=existing.approved_at; v_approved_by:=existing.approved_by;
      else
        if manager then v_approved_at:=now(); v_approved_by:=auth.uid();
        else v_approved_at:=null; v_approved_by:=null; end if;
        if wid is null then
          insert into public.job_works(job_id,work_id,title,hours,billable,billable_reason,revenue,
            revenue_override,tariff_profile,approved_at,approved_by)
          values(jid,v_work_id,v_title,v_hours,v_billable,v_reason,v_revenue,
            case when manager then v_override else null end,v_profile,v_approved_at,v_approved_by)
          returning id,revenue,approved_at,approved_by into wid,v_revenue,v_approved_at,v_approved_by;
        else
          update public.job_works set work_id=v_work_id,title=v_title,hours=v_hours,billable=v_billable,
            billable_reason=v_reason,revenue=v_revenue,
            revenue_override=case when manager then v_override else existing.revenue_override end,
            tariff_profile=v_profile,approved_at=v_approved_at,approved_by=v_approved_by
          where id=wid
          returning revenue,approved_at,approved_by into v_revenue,v_approved_at,v_approved_by;
        end if;
      end if;
      if wid=any(kept) then raise exception 'Повтор строки работы'; end if;
      kept:=array_append(kept,wid);
      saved:=saved||jsonb_build_array(jsonb_build_object('index',item_no-1,'id',wid,'revenue',v_revenue,
        'approved_at',v_approved_at,'approved_by',v_approved_by));
    end loop;

    if exists(select 1 from public.job_works w join public.service_order_items i on i.legacy_job_work_id=w.id
      where w.job_id=jid and not(w.id=any(kept))
        and not exists(select 1 from public.service_order_items i where i.legacy_job_work_id=w.id and i.request_finance_void_event_id is not null)) then
      raise exception 'Перенесённую финансовую строку нельзя удалить до перехода на аннулирование';
    end if;
    delete from public.job_works w where w.job_id=jid and not(w.id=any(kept))
      and not exists(select 1 from public.service_order_items i where i.legacy_job_work_id=w.id and i.request_finance_void_event_id is not null);
  end if;

  if p_parts is not null then
    for item,item_no in select value,ordinality from jsonb_array_elements(p_parts) with ordinality loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Некорректная строка материала'; end if;
      part_id:=nullif(item->>'id','')::uuid;
      part_name:=btrim(coalesce(item->>'name',''));
      part_sku:=btrim(coalesce(item->>'sku',''));
      part_unit:=btrim(coalesce(item->>'unit',''));
      part_qty:=coalesce(nullif(item->>'qty','')::numeric,0);
      part_billable:=coalesce((item->>'billable')::boolean,true);
      part_price:=coalesce(nullif(item->>'price','')::numeric,0);
      part_cost:=coalesce(nullif(item->>'cost','')::numeric,0);
      if part_name='' or part_unit='' or part_qty<=0 then raise exception 'У материала должны быть название, единица и положительное количество'; end if;

      existing_part:=null;
      if part_id is not null then
        select * into existing_part from public.job_parts where id=part_id for update;
        if found and existing_part.job_id is distinct from jid then raise exception 'Материал относится к другой заявке'; end if;
        if not found and not coalesce((item->>'client_new')::boolean,false) then
          raise exception 'Строка материала изменилась. Обнови заявку и повтори правку';
        end if;
        if found and exists(select 1 from public.service_order_items i where i.legacy_job_part_id=part_id and i.request_finance_void_event_id is not null) then continue; end if;
      end if;
      if part_id=any(kept_parts) then raise exception 'Повтор строки материала'; end if;
      if part_id is null then part_id:=gen_random_uuid(); end if;
      kept_parts:=array_append(kept_parts,part_id);

      if existing_part.id is null then
        insert into public.job_parts(id,job_id,name,sku,unit,qty,price,cost,billable,created_by)
        values(part_id,jid,part_name,part_sku,part_unit,part_qty,
          case when manager then part_price else 0 end,case when manager then part_cost else 0 end,
          part_billable,auth.uid());
      elsif (existing_part.name,existing_part.sku,existing_part.unit,existing_part.qty,existing_part.billable)
              is distinct from (part_name,part_sku,part_unit,part_qty,part_billable)
         or (manager and (existing_part.price,existing_part.cost) is distinct from (part_price,part_cost)) then
        if manager then
          update public.job_parts set name=part_name,sku=part_sku,unit=part_unit,qty=part_qty,
            price=part_price,cost=part_cost,billable=part_billable where id=part_id;
        else
          update public.job_parts set name=part_name,sku=part_sku,unit=part_unit,qty=part_qty,
            billable=part_billable where id=part_id;
        end if;
      end if;

      select * into existing_part from public.job_parts where id=part_id;
      saved_parts:=saved_parts||jsonb_build_array(jsonb_build_object(
        'index',coalesce(nullif(item->>'index','')::integer,item_no-1),'id',part_id,
        'price',existing_part.price,'cost',existing_part.cost,
        'approved_at',existing_part.approved_at,'approved_by',existing_part.approved_by));
    end loop;

    -- Match the old row editor's removal rights. The dual-write trigger may
    -- reject deletion of canonical-linked rows, so isolate that known guard
    -- per row; all other database errors abort this request transaction.
    for existing_part in
      select p.* from public.job_parts p
      where p.job_id=jid and not(p.id=any(kept_parts))
        and not exists(select 1 from public.service_order_items i where i.legacy_job_part_id=p.id and i.request_finance_void_event_id is not null)
        and (manager or (p.created_by=auth.uid() and p.approved_at is null
          and exists(select 1 from public.jobs j where j.id=p.job_id and j.status<>'done')))
    loop
      begin
        delete from public.job_parts where id=existing_part.id;
      exception when others then
        if sqlerrm<>'Материал уже перенесён в задание; сначала аннулируй его согласованным способом' then raise; end if;
      end;
    end loop;
  end if;

  -- Apply the request state after work writes. This preserves engineer RLS
  -- checks that allow editing work while the request is still open.
  if p_id is not null then
    update public.jobs set client_id=(p_rec->>'client_id')::uuid,
      equipment_id=nullif(p_rec->>'equipment_id','')::uuid,
      status=coalesce(nullif(p_rec->>'status','')::public.job_status,status),
      scheduled_date=nullif(p_rec->>'scheduled_date','')::date,time_window=coalesce(p_rec->>'time_window',''),
      due_date=nullif(p_rec->>'due_date','')::date,assigned_engineer=nullif(p_rec->>'assigned_engineer','')::uuid,
      engineer_ids=coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_rec->'engineer_ids','[]'::jsonb))),'{}'::uuid[]),
      notes=coalesce(p_rec->>'notes',''),at_depot=coalesce((p_rec->>'at_depot')::boolean,false),
      depot_id=nullif(p_rec->>'depot_id','')::uuid
    where id=jid;
    if not found then raise exception 'Заявка не найдена или недоступна'; end if;
  end if;
  return jsonb_build_object('job_id',jid,'works',saved,'parts',case when p_parts is null then null else saved_parts end);
end $$;

notify pgrst,'reload schema';
commit;
