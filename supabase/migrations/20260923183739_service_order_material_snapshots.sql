begin;

alter table public.service_order_items
  add column kind text not null default 'work' check (kind in ('work','material')),
  add column stock_catalog_id uuid references public.stock_catalog(id) on delete restrict,
  add column sku_snapshot text not null default '',
  add column unit_price_snapshot numeric(14,2),
  add column unit_cost_snapshot numeric(14,2),
  add constraint service_order_items_material_snapshot_check check (
    kind <> 'material' or (stock_catalog_id is not null and unit_price_snapshot is not null and unit_cost_snapshot is not null)
  );

create index service_order_items_stock_catalog_idx on public.service_order_items(stock_catalog_id) where stock_catalog_id is not null;

-- Snapshot stock values only when a material is first selected or deliberately
-- changed to another catalog entry. Saving unrelated task edits never rewrites
-- historical prices from the live catalog.
create or replace function dlight_private.order_save(p_id uuid,p_expected integer,p_data jsonb,p_jobs uuid[],p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 oid uuid:=coalesce(p_id,gen_random_uuid()); oldrow public.service_orders; item jsonb; jid uuid;
 crew uuid[]; lead uuid; snap jsonb; item_id uuid; item_kind text; catalog_id uuid;
 existing_item public.service_order_items; catalog_item public.stock_catalog;
 item_title text; item_unit text; item_sku text; item_price numeric(14,2); item_cost numeric(14,2);
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер меняет план задания'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Некорректное задание'; end if;
 if cardinality(coalesce(p_jobs,'{}'))=0 then raise exception 'Выбери хотя бы одну заявку'; end if;
 if p_id is not null then
  select * into oldrow from public.service_orders where id=p_id for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if p_expected is distinct from oldrow.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
  if oldrow.status not in ('draft','assigned','paused') then raise exception 'План можно менять в черновике, назначенном или приостановленном задании'; end if;
  snap:=dlight_private.order_snapshot(oid);
 end if;
 if exists(select 1 from unnest(p_jobs) j where not exists(select 1 from public.jobs where id=j and deleted_at is null)) then raise exception 'Заявка удалена или недоступна'; end if;
 select coalesce(array_agg(distinct v::uuid),'{}') into crew from jsonb_array_elements_text(coalesce(p_data->'engineer_ids','[]'))v;
 lead:=nullif(p_data->>'lead_engineer','')::uuid;
 if (cardinality(crew)>0 and lead is null) or (lead is not null and not(lead=any(crew))) then raise exception 'Выбери ответственного из команды'; end if;
 if exists(select 1 from unnest(crew) c where not exists(select 1 from public.profiles where id=c and active and role::text='engineer')) then raise exception 'В команде есть недоступный инженер'; end if;
 if p_id is null then
  insert into public.service_orders(id,title,work_mode,date_from,date_to,lead_engineer,engineer_ids,instructions,created_by)
  values(oid,trim(p_data->>'title'),p_data->>'work_mode',nullif(p_data->>'date_from','')::date,nullif(p_data->>'date_to','')::date,lead,crew,coalesce(p_data->>'instructions',''),auth.uid());
 else
  update public.service_orders set title=trim(p_data->>'title'),work_mode=p_data->>'work_mode',date_from=nullif(p_data->>'date_from','')::date,
   date_to=nullif(p_data->>'date_to','')::date,lead_engineer=lead,engineer_ids=crew,instructions=coalesce(p_data->>'instructions',''),revision=revision+1,updated_at=now() where id=oid;
 end if;
 if (p_data->>'work_mode')<>'onsite' and exists(select 1 from public.trips where service_order_id=oid and deleted_at is null and status<>'cancelled') then raise exception 'У задания есть выезды. Место выполнения нельзя сменить'; end if;
 if exists(select 1 from public.trips t join public.trip_jobs tj on tj.trip_id=t.id where t.service_order_id=oid and not(tj.job_id=any(p_jobs))) then raise exception 'Заявка уже входит в выезд задания'; end if;
 foreach jid in array p_jobs loop
  insert into public.service_order_jobs(order_id,job_id,snapshot) select oid,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name) from public.jobs j left join public.clients c on c.id=j.client_id where j.id=jid on conflict do nothing;
 end loop;
 if exists(select 1 from public.service_order_items i where order_id=oid and (done_qty>0 or transferred_qty>0 or source_item_id is not null) and
  not exists(select 1 from jsonb_array_elements(p_items)x where nullif(x->>'id','')::uuid=i.id)) then raise exception 'Нельзя удалить строку с результатом или переносом'; end if;
 delete from public.service_order_items i where order_id=oid and not exists(select 1 from jsonb_array_elements(p_items)x where nullif(x->>'id','')::uuid=i.id);
 for item in select * from jsonb_array_elements(p_items) loop
  jid:=(item->>'job_id')::uuid;
  if not(jid=any(p_jobs)) then raise exception 'Строка относится к другой заявке'; end if;
  item_id:=nullif(item->>'id','')::uuid;
  item_kind:=coalesce(nullif(item->>'kind',''),'work');
  if item_kind not in ('work','material') then raise exception 'Неизвестный тип строки задания'; end if;
  existing_item:=null;
  if item_id is not null then
   select * into existing_item from public.service_order_items where id=item_id and order_id=oid and job_id=jid for update;
   if not found then raise exception 'Строка не принадлежит заданию'; end if;
   if (existing_item.done_qty>0 or existing_item.transferred_qty>0) and
      (existing_item.kind is distinct from item_kind or (item_kind='material' and existing_item.stock_catalog_id is distinct from nullif(item->>'stock_catalog_id','')::uuid)) then
     raise exception 'Нельзя заменить номенклатуру строки с зафиксированным фактом';
   end if;
  end if;
  if item_kind='material' then
   catalog_id:=nullif(item->>'stock_catalog_id','')::uuid;
   if catalog_id is null then raise exception 'Выбери материал из склада'; end if;
   if item_id is not null and existing_item.kind='material' and existing_item.stock_catalog_id=catalog_id then
    item_title:=existing_item.title; item_unit:=existing_item.unit; item_sku:=existing_item.sku_snapshot;
    item_price:=existing_item.unit_price_snapshot; item_cost:=existing_item.unit_cost_snapshot;
   else
    select * into catalog_item from public.stock_catalog where id=catalog_id and active for share;
    if not found then raise exception 'Материал больше не доступен в каталоге'; end if;
    item_title:=catalog_item.name; item_unit:=catalog_item.unit; item_sku:=catalog_item.sku;
    item_price:=catalog_item.price; item_cost:=catalog_item.cost;
   end if;
  else
   catalog_id:=null; item_title:=trim(item->>'title'); item_unit:=trim(item->>'unit'); item_sku:=''; item_price:=null; item_cost:=null;
  end if;
  if item_id is null then
   insert into public.service_order_items(order_id,job_id,title,unit,planned_qty,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot)
   values(oid,jid,item_title,item_unit,(item->>'planned_qty')::numeric,item_kind,catalog_id,item_sku,item_price,item_cost);
  else
   if existing_item.done_qty>0 or existing_item.transferred_qty>0 then
    if item_unit is distinct from existing_item.unit or item_title is distinct from existing_item.title then
     raise exception 'Нельзя менять название или единицу строки с зафиксированным фактом';
    end if;
   end if;
   update public.service_order_items set title=item_title,unit=item_unit,planned_qty=(item->>'planned_qty')::numeric,
    kind=item_kind,stock_catalog_id=catalog_id,sku_snapshot=item_sku,unit_price_snapshot=item_price,unit_cost_snapshot=item_cost
   where id=item_id and order_id=oid and job_id=jid;
  end if;
 end loop;
 delete from public.service_order_jobs where order_id=oid and not(job_id=any(p_jobs));
 if oldrow.status='assigned' and (lead is null or cardinality(crew)=0 or nullif(p_data->>'date_from','') is null or nullif(p_data->>'date_to','') is null or not exists(select 1 from public.service_order_items where order_id=oid)) then raise exception 'Назначенное задание требует команды, периода и состава работ'; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(oid,auth.uid(),case when p_id is null then 'Создано задание' else 'Изменён план задания' end,coalesce(snap,dlight_private.order_snapshot(oid)));
 return oid;
end $$;

create or replace function dlight_private.order_carry(p_id uuid,p_expected integer,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.service_orders; nid uuid;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер переносит остаток'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if not found then raise exception 'Задание не найдено'; end if;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if o.status not in ('in_progress','paused','review') or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Перенос доступен после начала работ с указанием причины'; end if;
 if not exists(select 1 from public.service_order_items where order_id=p_id and planned_qty>done_qty+transferred_qty) then raise exception 'Остатка нет'; end if;
 insert into public.service_orders(title,work_mode,instructions,created_by) values(left(o.title||' · остаток',200),o.work_mode,p_reason,auth.uid()) returning id into nid;
 insert into public.service_order_jobs select nid,j.job_id,j.snapshot from public.service_order_jobs j where order_id=p_id and exists(select 1 from public.service_order_items i where i.order_id=p_id and i.job_id=j.job_id and planned_qty>done_qty+transferred_qty);
 insert into public.service_order_items(order_id,job_id,title,unit,planned_qty,source_item_id,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot)
 select nid,job_id,title,unit,planned_qty-done_qty-transferred_qty,id,kind,stock_catalog_id,sku_snapshot,unit_price_snapshot,unit_cost_snapshot
 from public.service_order_items where order_id=p_id and planned_qty>done_qty+transferred_qty;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Остаток перенесён: '||p_reason,dlight_private.order_snapshot(p_id));
 update public.service_order_items set transferred_qty=planned_qty-done_qty where order_id=p_id;
 update public.service_orders set revision=revision+1,updated_at=now() where id=p_id;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(nid,auth.uid(),'Остаток задания №'||o.number,dlight_private.order_snapshot(nid));
 return nid;
end $$;

revoke all on function dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb),dlight_private.order_carry(uuid,integer,text) from public,anon,authenticated;
grant execute on function dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb),dlight_private.order_carry(uuid,integer,text) to authenticated;

commit;
