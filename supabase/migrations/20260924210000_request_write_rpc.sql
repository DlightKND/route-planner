-- One authenticated RPC now saves a request header and its complete work
-- plan in one transaction. Existing legacy tables and their task dual-write
-- triggers remain active for already-open clients and queued work.
begin;

create or replace function public.job_request_save(
  p_id uuid,p_rec jsonb,p_works jsonb default null
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  jid uuid:=p_id; item jsonb; item_no bigint; wid uuid; existing public.job_works;
  v_work_id uuid; v_title text; v_hours numeric; v_billable boolean;
  v_reason text; v_revenue numeric; v_override numeric; v_profile text;
  v_approved_at timestamptz; v_approved_by uuid; kept uuid[]:='{}'::uuid[];
  saved jsonb:='[]'::jsonb; manager boolean:=coalesce(public.user_role() in ('admin','logist'),false);
begin
  if auth.uid() is null then raise exception 'Требуется вход в приложение'; end if;
  if jsonb_typeof(p_rec) is distinct from 'object' then raise exception 'Некорректные данные заявки'; end if;
  if p_works is not null and jsonb_typeof(p_works) is distinct from 'array' then raise exception 'Некорректный состав работ'; end if;
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
      where w.job_id=jid and not(w.id=any(kept))) then
      raise exception 'Перенесённую финансовую строку нельзя удалить до перехода на аннулирование';
    end if;
    delete from public.job_works w where w.job_id=jid and not(w.id=any(kept));
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
  return jsonb_build_object('job_id',jid,'works',saved);
end $$;
revoke all on function public.job_request_save(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.job_request_save(uuid,jsonb,jsonb) to authenticated;

commit;
