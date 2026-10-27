-- psql -X -v ON_ERROR_STOP=1 -f scripts/qa-canonical-planner-server.sql
-- Compatibility/acceptance only: the migration and every test write roll back.
begin;
set local lock_timeout='2s';
set local statement_timeout='45s';
\ir ../supabase/migrations/20261026194156_canonical_planner_layouts.sql

create temporary table planner_qa_results(check_name text primary key, passed boolean not null);
create temporary table planner_qa_context(original_group jsonb, engineer_id uuid);
create temporary table planner_qa_facts as
select 'trips' as source, md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as digest from public.trips t
union all select 'orders',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.service_orders t
union all select 'items',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.service_order_items t
union all select 'tracks',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_tracks t
union all select 'stays',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_stays t;
grant select,insert on planner_qa_results,planner_qa_context to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where active and role='admin' order by id limit 1),true);
set local role authenticated;

do $$
declare g jsonb; p jsonb; parts jsonb; changes jsonb; receipt jsonb; fresh jsonb; undo_change jsonb; collision_part jsonb;
 op uuid; cut numeric; did_save boolean:=false; reasons text[]:='{}'; prior_count bigint; target_kind text; total_hours numeric;
begin
 if public.user_role()<>'admin' or public.user_role() is null then raise exception 'QA requires an active admin'; end if;
 insert into planner_qa_results values('authenticated_snapshot',jsonb_array_length(public.planner_snapshot('2026-01-01','2026-12-31')->'groups')>0);
 foreach target_kind in array array['road','work'] loop
 did_save:=false; reasons:='{}';
 for g in select value from jsonb_array_elements(public.planner_snapshot('2026-01-01','2026-12-31')->'groups') where value->>'kind'=target_kind loop
  p:=g->'parts'->0;
  if coalesce((g->>'stale')::boolean,false) or (p->>'end')::numeric-(p->>'start')::numeric<.5 then continue; end if;
  cut:=floor(((p->>'start')::numeric+(p->>'end')::numeric)*2)/4;
  if cut-(p->>'start')::numeric<.25 or (p->>'end')::numeric-cut<.25 then continue; end if;
  begin
   select jsonb_agg(piece order by n) into parts from (
    select p||jsonb_build_object('end',cut) as piece,0 as n
    union all select p||jsonb_build_object('id',p->>'id'||':server-qa','start',cut,'offset',(p->>'offset')::numeric+cut-(p->>'start')::numeric),1
    union all select value,ordinality::integer+1 from jsonb_array_elements(g->'parts') with ordinality where ordinality>1
   ) pieces;
   changes:=jsonb_build_array(jsonb_build_object('source_key',g->'source_key','expected_revision',g->'revision','placement_token',g->'placement_token','order_revision',g->'order_revision','trip_revision',g->'trip_revision','people',g->'people','parts',parts,'manual',true));
   select count(*) into prior_count from public.planner_layout_history where source_key=g->>'source_key';
   op:=gen_random_uuid();
   receipt:=public.planner_apply(op,changes,'Серверная проверка разделения с полным откатом','[]');
   if public.planner_apply(op,changes,'Серверная проверка разделения с полным откатом','[]')<>receipt then raise exception 'Idempotent replay changed the receipt'; end if;
   if (select count(*) from public.planner_layout_history where source_key=g->>'source_key')<>prior_count+1 then raise exception 'History duplicated on replay'; end if;
   fresh:=receipt->'layouts'->0;
   if fresh->'parts'<>parts or (fresh->>'revision')::integer<>(g->>'revision')::integer+1 then raise exception 'Split receipt is inconsistent'; end if;
   begin
    perform public.planner_apply(gen_random_uuid(),changes,'Проверка конфликта версии','[]');
    raise exception 'QA: stale revision was accepted';
   exception when others then
    if sqlerrm not like '%другим пользователем%' then raise; end if;
   end;
   select sum((value->>'end')::numeric-(value->>'start')::numeric) into total_hours from jsonb_array_elements(g->'parts');
   select p||jsonb_build_object('date',other_part->>'date','start',(other_part->>'start')::numeric,'end',(other_part->>'start')::numeric+total_hours,'offset',0)
    into collision_part from jsonb_array_elements(public.planner_snapshot('2026-01-01','2026-12-31')->'groups') other_group
    cross join lateral jsonb_array_elements(other_group->'parts') other_part
    where other_group->>'source_key'<>g->>'source_key'
     and exists(select 1 from jsonb_array_elements_text(g->'people') a join jsonb_array_elements_text(other_group->'people') b on a.value=b.value)
     and mod((other_part->>'start')::numeric*4,1)=0 and (other_part->>'start')::numeric+total_hours<=24 limit 1;
   if collision_part is null then raise exception 'No shared booking for collision acceptance'; end if;
   begin
    perform public.planner_apply(gen_random_uuid(),jsonb_build_array(jsonb_build_object('source_key',g->'source_key','expected_revision',fresh->'revision','placement_token',fresh->'placement_token','order_revision',fresh->'order_revision','trip_revision',fresh->'trip_revision','people',g->'people','parts',jsonb_build_array(collision_part),'manual',true)),'Проверка пересечения участников','[]');
    raise exception 'QA: overlapping booking was accepted';
   exception when others then
    if sqlerrm not like '%Пересечение%' then raise; end if;
   end;
   undo_change:=jsonb_build_array(jsonb_build_object('source_key',g->'source_key','expected_revision',fresh->'revision','placement_token',fresh->'placement_token','order_revision',fresh->'order_revision','trip_revision',fresh->'trip_revision','people',g->'people','parts',g->'parts','manual',coalesce((g->>'manual')::boolean,false)));
   receipt:=public.planner_apply(gen_random_uuid(),undo_change,'Отмена серверной проверки','[]');
   if receipt->'layouts'->0->'parts'<>g->'parts' then raise exception 'Undo did not restore original clock'; end if;
   if target_kind='work' then insert into planner_qa_context values(g,null); end if;
   insert into planner_qa_results values('split_and_undo_'||target_kind,true),('idempotent_replay_'||target_kind,true),('stale_revision_rejected_'||target_kind,true),('single_history_entry_on_replay_'||target_kind,true),('collision_rejected_'||target_kind,true);
   did_save:=true;
  exception when others then reasons:=array_append(reasons,sqlerrm);
  end;
  exit when did_save;
 end loop;
 if not did_save then raise exception 'No editable nonconflicting % source available for QA: %',target_kind,reasons; end if;
 end loop;
end $$;
reset role;

update planner_qa_context c set engineer_id=(
 select p.id from public.profiles p where p.active and p.role='engineer'
 and not exists(select 1 from public.service_orders o where o.id=(c.original_group->>'order_id')::uuid and p.id in (o.owner_id,o.curator_id))
 and not exists(select 1 from public.trips t where t.id=(c.original_group->>'trip_id')::uuid and p.id in (t.owner_id,t.curator_id)) order by p.id limit 1
);
select set_config('request.jwt.claim.sub',(select engineer_id::text from planner_qa_context),true);
set local role authenticated;
do $$
declare g jsonb; change jsonb;
begin
 if public.user_role()<>'engineer' or public.user_role() is null then raise exception 'QA requires an engineer without source responsibility'; end if;
 select original_group into g from planner_qa_context;
 -- Fetch the current revision using the read API when visible; original + 2
 -- also works for a source hidden from this account, without reading private rows.
 change:=jsonb_build_array(jsonb_build_object('source_key',g->'source_key','expected_revision',(g->>'revision')::integer+2,'placement_token',g->'placement_token','order_revision',g->'order_revision','trip_revision',g->'trip_revision','people',g->'people','parts',g->'parts','manual',true));
 begin
  perform public.planner_apply(gen_random_uuid(),change,'Проверка запрета чужого изменения','[]');
  raise exception 'QA: engineer wrote another manager source';
 exception when others then
  if sqlerrm not like '%Нет права%' then raise; end if;
 end;
 insert into planner_qa_results values('engineer_write_scope',true);
end $$;
reset role;

do $$
declare current_facts jsonb; original_facts jsonb;
begin
 select jsonb_object_agg(source,digest) into original_facts from planner_qa_facts;
 select jsonb_object_agg(source,digest) into current_facts from (
  select 'trips' as source,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as digest from public.trips t
  union all select 'orders',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.service_orders t
  union all select 'items',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.service_order_items t
  union all select 'tracks',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_tracks t
  union all select 'stays',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_stays t
 ) sources;
 if current_facts<>original_facts then raise exception 'QA changed a business source'; end if;
 insert into planner_qa_results values('business_sources_unchanged',true),('anonymous_write_denied',not has_function_privilege('anon','public.planner_apply(uuid,jsonb,text,jsonb)','execute'));
 if exists(select 1 from planner_qa_results where not passed) then raise exception 'QA check failed'; end if;
end $$;
select * from planner_qa_results order by check_name;
rollback;
