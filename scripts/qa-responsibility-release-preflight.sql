-- Read-only preflight of the exact legacy guard assumptions used by the responsibility migration.
-- Does not install migration objects or alter functions. Re-run immediately before release.
begin;
set transaction read only;
do $$
declare
  target regprocedure; definition text; old_check text;
begin
  foreach target in array array[
    'dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb)'::regprocedure,
    'dlight_private.order_carry(uuid,integer,text)'::regprocedure,
    'dlight_private.order_trip(uuid,integer)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected manager check in %; review migration',target;
    end if;
    definition:=replace(definition,old_check,
      case when target='dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb)'::regprocedure
      then 'auth.uid() is null or (p_id is null and public.user_role() not in (''admin'',''logist'')) or (p_id is not null and not dlight_private.responsibility_manager(''order'',p_id))'
      else 'auth.uid() is null or not dlight_private.responsibility_manager(''order'',p_id)' end);
    perform 1;
  end loop;

  target:='dlight_private.order_transition(uuid,integer,text,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='if public.user_role()=''engineer'' and not(';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected task transition function; review migration';
  end if;
  definition:=replace(definition,old_check,
    'if not dlight_private.responsibility_manager(''order'',p_id) and not(');
  definition:=replace(definition,
    'if p_status in (''paused'',''cancelled'') and length(trim(coalesce(p_reason,'''')))=0',
    'if o.owner_id=auth.uid() and o.curator_id is distinct from auth.uid() and length(btrim(coalesce(p_reason,'''')))<5 then raise exception ''Владелец указывает причину вмешательства''; end if;'||E'\n '||
    'if p_status in (''paused'',''cancelled'') and length(trim(coalesce(p_reason,'''')))=0');
  old_check:='update public.jobs set status=''in_progress'' where id=request_id and status in (''open'',''planned'');';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request stage sync in task transition';
  end if;
  definition:=replace(definition,old_check,
    'if exists(select 1 from public.jobs j where j.id=request_id '
    ||'and j.owner_id=auth.uid() and j.curator_id is distinct from auth.uid() '
    ||'and j.status in (''open'',''planned'')) then '
    ||'perform dlight_private.record_status_intervention(''job'',request_id,''in_progress'','
    ||'coalesce(nullif(btrim(p_reason),''''),''Автоматически вслед за запуском задания'')); end if;'||E'\n   '
    ||old_check);
  perform 1;

  target:='dlight_private.order_result(uuid,integer,jsonb,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='o.status=''review'' and public.user_role()=''engineer''';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected task result function; review migration';
  end if;
  perform 1;

  target:=to_regprocedure('dlight_private.order_historical_result(uuid,integer,jsonb,text,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or public.user_role() not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected historical result function; review migration';
    end if;
    perform 1;
  end if;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
  foreach target in array array[
    'public.trip_workbench_read(uuid)'::regprocedure,
    'public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure,
    'public.trip_presence_save(uuid,integer,jsonb,text)'::regprocedure,
    'public.trip_presence_detect(uuid,integer)'::regprocedure,
    'dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure,
    'public.trip_cost_allocation_save(uuid,integer,timestamptz,text,jsonb,jsonb)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(target);
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip manager check in %; review migration',target;
    end if;
    definition:=replace(definition,old_check,
      case when target='public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure
        or target='dlight_private.trip_plan_save_tasks(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure
      then 'auth.uid() is null or (p_trip is null and public.user_role() not in (''admin'',''logist'')) or (p_trip is not null and not dlight_private.responsibility_manager(''trip'',p_trip))'
      else 'auth.uid() is null or not dlight_private.responsibility_manager(''trip'',p_trip)' end);
    perform 1;
  end loop;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  target:='public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='perform set_config(''dlight.change_reason'',coalesce(nullif(btrim(p_reason),''''),''Создание плана''),true);';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected trip plan status write; review migration';
  end if;
  perform 1;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  foreach target in array array[
    to_regprocedure('public.trip_start(uuid)'),
    to_regprocedure('public.trip_finish(uuid)')
  ] loop
    if target is null then continue; end if;
    definition:=pg_get_functiondef(target);
    old_check:='public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids)';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip action guard in %; review migration',target;
    end if;
    perform 1;
  end loop;

  target:=to_regprocedure('public.trip_confirm(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='if coalesce(public.user_role(),'''') not in (''admin'',''logist'') then';
    if position(old_check in definition)=0 then
      raise exception 'Unexpected trip confirmation guard; review migration';
    end if;
    perform 1;
  end if;
end $$;

do $$
declare target regprocedure; definition text; old_check text; replacement text;
begin
  foreach target in array array[
    to_regprocedure('public.trip_recalc_fact(uuid)'),
    to_regprocedure('public.trip_reschedule_decide(uuid,boolean,text)'),
    to_regprocedure('public.trip_tracking_cancel(uuid)'),
    to_regprocedure('public.trip_tracking_reassign(uuid,uuid)'),
    to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
  ] loop
    if target is null then continue; end if;
    definition:=pg_get_functiondef(target);
    old_check:=case when target=to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
      then 'auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')'
      else 'coalesce(public.user_role(),'''') not in (''admin'',''logist'')' end;
    if position(old_check in definition)=0 then
      raise exception 'Unexpected linked trip guard in %; review migration',target;
    end if;
    replacement:=case
      when target=to_regprocedure('public.trip_reschedule_decide(uuid,boolean,text)')
        then 'not dlight_private.responsibility_manager(''trip'',(select trip_id from public.trip_reschedules where id=p_req))'
      when target=to_regprocedure('public.trip_tracking_reassign(uuid,uuid)')
        then 'not (dlight_private.responsibility_manager(''trip'',p_from) and dlight_private.responsibility_manager(''trip'',p_to))'
      else 'not dlight_private.responsibility_manager(''trip'',p_trip)' end;
    if target=to_regprocedure('dlight_private.trip_stay_task_allocations_save(uuid,uuid,jsonb,text)')
    then replacement:='auth.uid() is null or '||replacement; end if;
    perform 1;
  end loop;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  target:=to_regprocedure('public.trip_presence_save_tasks(uuid,integer,jsonb,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='auth.uid() is null or coalesce(public.user_role(),'''') not in (''admin'',''logist'')';
    if position(old_check in definition)=0 then raise exception 'Unexpected presence task guard'; end if;
    perform 1;
  end if;

  target:=to_regprocedure('public.trip_fact_hours(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='coalesce(public.user_role(),'''')=''engineer'' and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false)';
    if position(old_check in definition)=0 then raise exception 'Unexpected trip fact hours guard'; end if;
    perform 1;
  end if;

  target:=to_regprocedure('public.trip_detect_stays(uuid)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false)';
    if position(old_check in definition)=0 then raise exception 'Unexpected trip detection guard'; end if;
    perform 1;
  end if;

  target:=to_regprocedure('public.trip_reschedule_request(uuid,date,date,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    old_check:='not public.is_owner_or_mgr(t.lead_engineer)';
    if position(old_check in definition)=0 then raise exception 'Unexpected reschedule request guard'; end if;
    perform 1;
  end if;
end $$;

do $$
declare target regprocedure; definition text; old_check text;
begin
  target:='dlight_private.request_finance_save(uuid,jsonb,jsonb,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='manager:=coalesce(public.user_role() in (''admin'',''logist''),false);';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected canonical request save function; review migration';
  end if;
  definition:=replace(definition,old_check,
    'manager:=coalesce(public.user_role() in (''admin'',''logist''),false) or (jid is not null and dlight_private.responsibility_manager(''job'',jid));');
  old_check:='not (auth.uid()=any(coalesce(job.engineer_ids,''{}''::uuid[])) or job.assigned_engineer=auth.uid())';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request assignee guard; review migration';
  end if;
  definition:=replace(definition,old_check,
    'not coalesce(auth.uid()=any(coalesce(job.engineer_ids,''{}''::uuid[])) or job.assigned_engineer=auth.uid(),false)');
  old_check:='update public.jobs set client_id=(p_rec->>''client_id'')::uuid,';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected canonical request status write; review migration';
  end if;
  perform 1;

  target:='dlight_private.request_finance_approve(uuid,uuid[])'::regprocedure;
  definition:=pg_get_functiondef(target);
  old_check:='auth.uid() is null or coalesce(public.user_role() in (''admin'',''logist''),false) is not true';
  if position(old_check in definition)=0 then
    raise exception 'Unexpected request approval function; review migration';
  end if;
  perform 1;

  target:='dlight_private.request_finance_void(uuid,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if position(old_check in definition)=0 then
    raise exception 'Unexpected finance void function; review migration';
  end if;
  perform 1;

  target:='dlight_private.request_finance_link_correction(uuid,uuid)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if position(old_check in definition)=0 then
    raise exception 'Unexpected finance correction function; review migration';
  end if;
  perform 1;
end $$;

do $$
declare target regprocedure; definition text; old_join text;
begin
  target:=to_regprocedure('public.push_due(text)');
  if target is null then return; end if;
  definition:=pg_get_functiondef(target);
  old_join:='join profiles p on p.role in (''admin'',''logist'') and coalesce(p.active,true)';
  if position(old_join in definition)=0 then
    raise exception 'Unexpected push_due recipients; review migration';
  end if;
  perform 1;
end $$;
select 'All eight legacy function guard blocks match' as result;
rollback;
