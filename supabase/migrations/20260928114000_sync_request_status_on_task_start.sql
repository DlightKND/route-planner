-- Starting execution of a canonical task starts its request in the same
-- transaction. Historical done requests with draft seed tasks stay untouched.
begin;

create or replace function dlight_private.order_transition(p_id uuid,p_expected integer,p_status text,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare o public.service_orders; allowed text[]; request_id uuid; request_state public.job_status;
begin
 if not dlight_private.order_access(p_id) then raise exception 'Нет доступа к заданию'; end if;
 -- Request finance writes lock jobs before service_orders. Keep that order
 -- here too, or concurrent edits and task starts can deadlock.
 if p_status='in_progress' then
   select job_id into request_id from public.service_orders where id=p_id;
   if request_id is not null then
     select status into request_state from public.jobs where id=request_id and deleted_at is null for update;
     if not found then raise exception 'Заявка удалена или недоступна'; end if;
   end if;
 end if;
 select * into o from public.service_orders where id=p_id for update;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if p_status=o.status then return o.revision; end if;
 allowed:=case o.status when 'draft' then array['assigned','cancelled'] when 'assigned' then array['draft','in_progress','cancelled']
 when 'in_progress' then array['paused','review'] when 'paused' then array['in_progress','review','cancelled'] when 'review' then array['in_progress','completed'] else '{}' end;
 if not(p_status=any(allowed)) then raise exception 'Недопустимый переход статуса задания'; end if;
 if public.user_role()='engineer' and not((o.status in ('assigned','paused') and p_status='in_progress') or (o.status='in_progress' and p_status in ('paused','review'))) then raise exception 'Этот переход выполняет диспетчер'; end if;
 if p_status='in_progress' and o.job_id is not null and request_state in ('done','cancelled') then
   raise exception 'Завершённая или отменённая заявка не может перейти в работу';
 end if;
 if p_status in ('paused','cancelled') and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Укажи причину'; end if;
 if p_status in ('assigned','in_progress') and (o.lead_engineer is null or cardinality(o.engineer_ids)=0 or o.date_from is null or o.date_to is null or not exists(select 1 from public.service_order_items where order_id=p_id)) then raise exception 'Укажи команду, ответственного, период и состав работ'; end if;
 if p_status in ('review','completed') and not exists(select 1 from public.service_order_items where order_id=p_id) then raise exception 'Сначала уточни состав работ'; end if;
 if p_status='completed' and exists(select 1 from public.service_order_items where order_id=p_id and done_qty+transferred_qty<planned_qty) then raise exception 'Есть невыполненные работы. Выполни или перенеси остаток'; end if;
 if p_status in ('completed','cancelled') and exists(
   select 1 from public.trips t
   where t.deleted_at is null and t.status not in ('done','cancelled')
     and (t.service_order_id=p_id or exists(
       select 1 from public.trip_service_orders l where l.trip_id=t.id and l.order_id=p_id
     ))
 ) then raise exception 'Сначала заверши или отмени связанные выезды'; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Статус: '||o.status||' → '||p_status||case when coalesce(p_reason,'')='' then '' else ' · '||p_reason end,dlight_private.order_snapshot(p_id));
 update public.service_orders set status=p_status,revision=revision+1,updated_at=now() where id=p_id returning revision into p_expected;
 if p_status='in_progress' and request_id is not null then
   update public.jobs set status='in_progress' where id=request_id and status in ('open','planned');
 end if;
 return p_expected;
end $$;

-- Reconcile only already running tasks. In production the historical seed
-- tasks are drafts, including those whose legacy requests are done.
update public.jobs j set status='in_progress'
where j.deleted_at is null and j.status in ('open','planned')
  and exists(select 1 from public.service_orders o where o.job_id=j.id and o.status='in_progress');

commit;
