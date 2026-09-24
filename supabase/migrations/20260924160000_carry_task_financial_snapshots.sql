-- Carry only the remaining quantity and its proportional frozen economics.
-- The source line remains the audit record; copied rows are new task items and
-- deliberately do not inherit legacy source IDs or approval stamps.
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
 insert into public.service_order_items(
   order_id,job_id,title,unit,planned_qty,source_item_id,kind,stock_catalog_id,
   sku_snapshot,unit_price_snapshot,unit_cost_snapshot,work_catalog_id,billable,
   billable_reason,tariff_profile,financial_revenue_snapshot,financial_cost_snapshot
 )
 select nid,i.job_id,i.title,i.unit,i.planned_qty-i.done_qty-i.transferred_qty,i.id,i.kind,
   i.stock_catalog_id,i.sku_snapshot,i.unit_price_snapshot,i.unit_cost_snapshot,i.work_catalog_id,
   i.billable,i.billable_reason,i.tariff_profile,
   case
     when i.financial_revenue_snapshot is not null then round(i.financial_revenue_snapshot*(i.planned_qty-i.done_qty-i.transferred_qty)/nullif(i.planned_qty,0),2)
     when i.kind='material' and i.billable then round((i.planned_qty-i.done_qty-i.transferred_qty)*coalesce(i.unit_price_snapshot,0),2)
     when i.kind='material' then 0
     else null
   end,
   case
     when i.financial_cost_snapshot is not null then round(i.financial_cost_snapshot*(i.planned_qty-i.done_qty-i.transferred_qty)/nullif(i.planned_qty,0),2)
     when i.kind='material' then round((i.planned_qty-i.done_qty-i.transferred_qty)*coalesce(i.unit_cost_snapshot,0),2)
     else null
   end
 from public.service_order_items i
 where i.order_id=p_id and i.planned_qty>i.done_qty+i.transferred_qty;

 insert into public.service_order_history(order_id,actor_id,reason,snapshot)
 values(p_id,auth.uid(),'Остаток перенесён: '||p_reason,dlight_private.order_snapshot(p_id));
 update public.service_order_items set transferred_qty=planned_qty-done_qty where order_id=p_id;
 update public.service_orders set revision=revision+1,updated_at=now() where id=p_id;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot)
 values(nid,auth.uid(),'Остаток задания №'||o.number,dlight_private.order_snapshot(nid));
 return nid;
end $$;

revoke all on function dlight_private.order_carry(uuid,integer,text) from public,anon,authenticated;
grant execute on function dlight_private.order_carry(uuid,integer,text) to authenticated;

commit;
