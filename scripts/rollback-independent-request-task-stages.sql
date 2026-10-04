-- Restore the exact pre-UX function only if rollback is required.
-- Does not rewrite request/task data or remove migration history.
begin;
CREATE OR REPLACE FUNCTION dlight_private.order_transition(p_id uuid, p_expected integer, p_status text, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if not dlight_private.responsibility_manager('order',p_id) and not((o.status in ('assigned','paused') and p_status='in_progress') or (o.status='in_progress' and p_status in ('paused','review'))) then raise exception 'Этот переход выполняет диспетчер'; end if;
 if p_status='in_progress' and o.job_id is not null and request_state in ('done','cancelled') then
   raise exception 'Завершённая или отменённая заявка не может перейти в работу';
 end if;
 if o.owner_id=auth.uid() and o.curator_id is distinct from auth.uid() and length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Владелец указывает причину вмешательства'; end if;
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
   if exists(select 1 from public.jobs j where j.id=request_id and j.owner_id=auth.uid() and j.curator_id is distinct from auth.uid() and j.status in ('open','planned')) then perform dlight_private.record_status_intervention('job',request_id,'in_progress',coalesce(nullif(btrim(p_reason),''),'Автоматически вслед за запуском задания')); end if;
   update public.jobs set status='in_progress' where id=request_id and status in ('open','planned');
 end if;
 return p_expected;
end $function$
;
commit;
