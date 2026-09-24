-- Keep dispatch approval and ownership checks across full request snapshots.
begin;
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
       and i.legacy_snapshot->>'request_finance_generation'='1' and not(i.id=any(kept))
       and manager and (i.approved_at is not null or i.done_qty>0 or i.transferred_qty>0 or i.source_item_id is not null)) then
      raise exception 'Нельзя удалить подтверждённую работу или работу с результатом';
    end if;
    delete from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='work'
      and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and not(i.id=any(kept))
      and i.approved_at is null and i.done_qty=0 and i.transferred_qty=0 and i.source_item_id is null
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
       and i.legacy_snapshot->>'request_finance_generation'='1' and not(i.id=any(kept))
       and manager and (i.approved_at is not null or i.done_qty>0 or i.transferred_qty>0 or i.source_item_id is not null)) then
      raise exception 'Нельзя удалить подтверждённый материал, чужой материал или материал с результатом';
    end if;
    delete from public.service_order_items i where i.order_id=oid and i.job_id=jid and i.kind='material'
      and i.legacy_job_work_id is null and i.legacy_job_part_id is null
       and i.legacy_snapshot->>'request_finance_generation'='1' and not(i.id=any(kept))
      and i.approved_at is null and i.done_qty=0 and i.transferred_qty=0 and i.source_item_id is null
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

commit;
