-- QA only: synthetic subscriptions are never sent and all data is rolled back.
begin;
do $$
declare
  owner_uid uuid; first_uid uuid; next_uid uuid;
  job_uid uuid; trip_uid uuid; order_uid uuid; entity_uid uuid;
  kind text; event_uid uuid; sub_uid uuid; n integer;
begin
  select id into owner_uid from public.profiles where role='logist' and active limit 1;
  select id into first_uid from public.profiles where role='engineer' and active order by id limit 1;
  select id into next_uid from public.profiles where role='engineer' and active and id<>first_uid limit 1;
  if owner_uid is null or first_uid is null or next_uid is null then raise exception 'Missing QA profiles'; end if;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  insert into public.jobs(client_id) select id from public.clients limit 1 returning id into job_uid;
  insert into public.trips(status) values('planned') returning id into trip_uid;
  insert into public.service_orders(job_id,title) values(job_uid,'QA notification test') returning id into order_uid;
  insert into public.push_subs(user_id,endpoint,p256dh,auth) values
    (owner_uid,'https://push.invalid/owner','test','test'),
    (first_uid,'https://push.invalid/first','test','test'),
    (next_uid,'https://push.invalid/next','test','test');
  foreach kind in array array['job','order','trip'] loop
    entity_uid:=case kind when 'job' then job_uid when 'order' then order_uid else trip_uid end;
    perform public.entity_responsibility_assign(kind,entity_uid,'curator',first_uid,'QA transfer to first curator',
      case when kind='order' then (select revision from public.service_orders where id=entity_uid) else null end);
    select count(*) into n from public.entity_push_due() where user_id=first_uid
      and event_id in(select id from public.entity_push_events where entity_kind=kind and entity_id=entity_uid);
    if n<>1 then raise exception 'Expected first recipient for %, got %',kind,n; end if;
    perform public.entity_responsibility_assign(kind,entity_uid,'curator',next_uid,'QA transfer to next curator',
      case when kind='order' then (select revision from public.service_orders where id=entity_uid) else null end);
    select count(*) into n from public.entity_push_due()
      where event_id in(select id from public.entity_push_events where entity_kind=kind and entity_id=entity_uid)
        and user_id in(owner_uid,first_uid);
    if n<>0 then raise exception 'Former curator or owner is still due for %',kind; end if;
    select event_id,sub_id into event_uid,sub_uid from public.entity_push_due() where user_id=next_uid
      and event_id in(select id from public.entity_push_events where entity_kind=kind and entity_id=entity_uid);
    if event_uid is null then raise exception 'New curator not due for %',kind; end if;
    -- Profile changes are administrative fixture setup, not curator actions.
    perform set_config('request.jwt.claim.sub','',true);
    update public.profiles set active=false where id=next_uid;
    if (select active from public.profiles where id=next_uid) then raise exception 'Fixture failed to deactivate profile'; end if;
    select count(*) into n from public.entity_push_due() where event_id=event_uid;
    if n<>0 then raise exception 'Inactive recipient is due'; end if;
    update public.profiles set active=true where id=next_uid;
    perform set_config('request.jwt.claim.sub',owner_uid::text,true);
    perform public.entity_push_mark(event_uid,sub_uid);
    perform public.entity_push_mark(event_uid,sub_uid);
    select count(*) into n from public.entity_push_due() where event_id=event_uid;
    if n<>0 then raise exception 'Delivered event retried'; end if;
  end loop;
  if has_function_privilege('authenticated','public.entity_push_due()','execute')
    or has_function_privilege('anon','public.entity_push_due()','execute') then raise exception 'Client has sender privilege'; end if;
end $$;
select 'QA passed: job/order/trip recipients, delegation, inactive profiles, delivery deduplication, privileges; transaction rolled back' as result;
rollback;
