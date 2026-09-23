-- Keep the canonical request and reviewed presence allocations consistent
-- across task carry, legacy planner edits and task-aware trip plan changes.
begin;

create or replace function dlight_private.order_carry(p_id uuid,p_expected integer,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.service_orders; nid uuid; source_job uuid; source_jobs uuid[];
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер переносит остаток'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if not found then raise exception 'Задание не найдено'; end if;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if o.status not in ('in_progress','paused','review') or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Перенос доступен после начала работ с указанием причины'; end if;
 if not exists(select 1 from public.service_order_items where order_id=p_id and planned_qty>done_qty+transferred_qty) then raise exception 'Остатка нет'; end if;

 select array_agg(distinct i.job_id order by i.job_id) into source_jobs
 from public.service_order_items i
 where i.order_id=p_id and i.planned_qty>i.done_qty+i.transferred_qty;
 if cardinality(source_jobs)<>1 then
   raise exception 'Нельзя перенести остаток: работы относятся к нескольким заявкам. Раздели задание перед переносом';
 end if;
 source_job:=source_jobs[1];
 if o.job_id is not null and o.job_id is distinct from source_job then
   raise exception 'Связь работ и заявки задания расходится. Сверь задание перед переносом';
 end if;

 insert into public.service_orders(title,work_mode,instructions,created_by,job_id)
 values(left(o.title||' · остаток',200),o.work_mode,p_reason,auth.uid(),source_job) returning id into nid;
 insert into public.service_order_jobs(order_id,job_id,snapshot)
 values(nid,source_job,coalesce((select j.snapshot from public.service_order_jobs j where j.order_id=p_id and j.job_id=source_job),'{}'::jsonb));
 insert into public.service_order_items(order_id,job_id,title,unit,planned_qty,source_item_id,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot)
 select nid,job_id,title,unit,planned_qty-done_qty-transferred_qty,id,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot
 from public.service_order_items where order_id=p_id and planned_qty>done_qty+transferred_qty;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Остаток перенесён: '||p_reason,dlight_private.order_snapshot(p_id));
 update public.service_order_items set transferred_qty=planned_qty-done_qty where order_id=p_id;
 update public.service_orders set revision=revision+1,updated_at=now() where id=p_id;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(nid,auth.uid(),'Остаток задания №'||o.number,dlight_private.order_snapshot(nid));
 return nid;
end $$;

create or replace function dlight_private.trip_order_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare tid uuid; jid uuid; oid uuid;
begin
  if tg_op='UPDATE' and new.trip_id=old.trip_id and new.job_id=old.job_id then
    update public.trip_service_orders tso set ordinal=coalesce(new.ord,0)
    from public.service_orders o where tso.trip_id=new.trip_id and tso.order_id=o.id and o.job_id=new.job_id;
    return new;
  end if;

  if tg_op='DELETE' or (tg_op='UPDATE' and (new.trip_id is distinct from old.trip_id or new.job_id is distinct from old.job_id)) then
    tid:=old.trip_id; jid:=old.job_id;
    if not exists(select 1 from public.trip_jobs where trip_id=tid and job_id=jid) then
      delete from public.trip_service_orders tso using public.service_orders o
      where tso.trip_id=tid and tso.order_id=o.id and o.job_id=jid;
    end if;
    if tg_op='DELETE' then return old; end if;
  end if;

  tid:=new.trip_id; jid:=new.job_id;
  -- A task-aware editor has already selected the work for this request.
  if exists(select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
            where tso.trip_id=tid and o.job_id=jid) then return new; end if;
  oid:=dlight_private.ensure_request_seed(jid);
  insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
  values(tid,oid,coalesce(new.ord,0),'legacy_job_sync',auth.uid()) on conflict do nothing;
  return new;
end $$;

create or replace function dlight_private.trip_plan_save_tasks(
  p_trip uuid,p_expected integer,p_plan jsonb,p_order_ids uuid[],p_reason text,p_stays jsonb default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid; requests uuid[]; orders uuid[]:=coalesce(p_order_ids,'{}'::uuid[]); s jsonb; chosen uuid;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  if cardinality(orders)<>(select count(distinct x) from unnest(orders) x) then raise exception 'Повтор задания в выезде'; end if;
  if exists(select 1 from unnest(orders) x where not exists(
    select 1 from public.service_orders o where o.id=x and o.job_id is not null and o.work_mode='onsite'
      and (o.status not in ('review','completed','cancelled') or exists(select 1 from public.trip_service_orders c where c.trip_id=p_trip and c.order_id=o.id))
  )) then raise exception 'Одно из заданий недоступно для выезда'; end if;
  if exists(select 1 from public.trip_service_orders tso join public.service_orders o on o.id=tso.order_id
    where tso.trip_id=p_trip and o.status in ('review','completed','cancelled') and not(o.id=any(orders)))
  then raise exception 'Нельзя отвязать задание, переданное на проверку или закрытое'; end if;

  -- A reviewed stay/share is a manager decision. A plan edit that removes one
  -- of its task links must carry an explicit replacement allocation for that
  -- same stay in the transaction, otherwise the whole request is rejected.
  if exists(
    select 1 from public.trip_stays s
    where s.trip_id=p_trip and s.task_allocations_explicit
      and (s.service_order_id is not null and not(s.service_order_id=any(orders))
        or exists(select 1 from public.trip_stay_task_allocations a
          where a.stay_id=s.id and not(a.service_order_id=any(orders))))
      and (p_stays is null or not exists(
        select 1 from jsonb_array_elements(p_stays) as payload(value)
        where value->>'id'=s.id::text and value ? 'task_allocations'
          and jsonb_typeof(value->'task_allocations')='array'
          and jsonb_array_length(value->'task_allocations')>0))
  ) then raise exception 'Перераспредели подтверждённую стоянку явно перед заменой задания'; end if;

  select coalesce(array_agg(distinct o.job_id order by o.job_id),'{}'::uuid[]) into requests
    from public.service_orders o where o.id=any(orders);
  tid:=public.trip_plan_save(p_trip,p_expected,p_plan,requests,p_reason,p_stays);
  delete from public.trip_service_orders where trip_id=tid;
  insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by)
    select tid,x,ord::integer-1,'dispatcher',auth.uid() from unnest(orders) with ordinality u(x,ord);

  update public.trip_stays s set service_order_id=null
    where s.trip_id=tid and not s.task_allocations_explicit and s.service_order_id is not null
      and not exists(select 1 from public.trip_service_orders tso where tso.trip_id=tid and tso.order_id=s.service_order_id);
  delete from public.trip_stay_task_allocations a using public.trip_stays s
    where s.id=a.stay_id and s.trip_id=tid and not exists(
      select 1 from public.trip_service_orders tso where tso.trip_id=tid and tso.order_id=a.service_order_id
    );
  if p_stays is not null then
    for s in select value from jsonb_array_elements(p_stays) where value ? 'task_allocations' loop
      select case when count(*)=1 and max(a.share)=1 then (array_agg(a.service_order_id))[1] else null end
        into chosen from jsonb_to_recordset(coalesce(s->'task_allocations','[]'::jsonb)) as a(service_order_id uuid,share numeric);
      update public.trip_stays set service_order_id=chosen where id=(s->>'id')::uuid;
      perform dlight_private.trip_stay_task_allocations_save(tid,(s->>'id')::uuid,
        coalesce(s->'task_allocations','[]'::jsonb),p_reason);
    end loop;
  end if;
  return tid;
end $$;

notify pgrst,'reload schema';
commit;
