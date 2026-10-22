-- Change planning fields without reopening task scope or rewriting recorded work.
create function dlight_private.order_organization_save(
 p_id uuid,p_expected integer,p_date_from date,p_date_to date,
 p_engineer_ids uuid[],p_lead_engineer uuid,p_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare o public.service_orders; crew uuid[];
begin
 if auth.uid() is null then raise exception 'Период и команду меняет менеджер задания'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if not found or not dlight_private.responsibility_manager('order',p_id)
 then raise exception 'Период и команду меняет менеджер задания'; end if;
 if o.revision is distinct from p_expected then
  raise exception 'Задание изменено другим пользователем. Обновите карточку перед сохранением';
 end if;
 if o.status not in ('draft','assigned','in_progress','paused','review')
 then raise exception 'План закрытого задания доступен только для просмотра'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 1000
 then raise exception 'Укажите причину изменения (5–1000 символов)'; end if;
 if p_date_from is not null and p_date_to is not null and p_date_to<p_date_from
 then raise exception 'Окончание задания раньше начала'; end if;
 select coalesce(array_agg(distinct engineer order by engineer),'{}'::uuid[]) into crew
 from unnest(coalesce(p_engineer_ids,'{}'::uuid[])) engineer;
 if exists(select 1 from unnest(crew) engineer where not exists(
  select 1 from public.profiles p where p.id=engineer and p.active and p.role::text='engineer'))
 then raise exception 'В команде есть недоступный инженер'; end if;
 if (cardinality(crew)>0 and p_lead_engineer is null)
    or (p_lead_engineer is not null and not(p_lead_engineer=any(crew)))
 then raise exception 'Выберите ответственного инженера из команды'; end if;
 if o.status<>'draft' and (p_date_from is null or p_date_to is null or cardinality(crew)=0 or p_lead_engineer is null)
 then raise exception 'Для назначенного или активного задания нужны период, команда и ответственный инженер'; end if;
 if o.date_from is not distinct from p_date_from and o.date_to is not distinct from p_date_to
    and o.lead_engineer is not distinct from p_lead_engineer
    and o.engineer_ids @> crew and crew @> o.engineer_ids then return o.revision; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot)
 values(o.id,auth.uid(),'Изменены период или команда: '||btrim(p_reason),dlight_private.order_snapshot(o.id));
 update public.service_orders set date_from=p_date_from,date_to=p_date_to,
  engineer_ids=crew,lead_engineer=p_lead_engineer,revision=revision+1,updated_at=now()
 where id=o.id returning revision into o.revision;
 return o.revision;
end $$;
revoke all on function dlight_private.order_organization_save(uuid,integer,date,date,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function dlight_private.order_organization_save(uuid,integer,date,date,uuid[],uuid,text) to authenticated;
create function public.service_order_organization_save(
 p_id uuid,p_expected integer,p_date_from date,p_date_to date,
 p_engineer_ids uuid[],p_lead_engineer uuid,p_reason text
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.order_organization_save(p_id,p_expected,p_date_from,p_date_to,p_engineer_ids,p_lead_engineer,p_reason)
$$;
revoke all on function public.service_order_organization_save(uuid,integer,date,date,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.service_order_organization_save(uuid,integer,date,date,uuid[],uuid,text) to authenticated;
