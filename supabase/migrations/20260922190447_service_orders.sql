-- Additive transition: requests remain intact; assignments own execution, trips own travel.
create table public.service_orders (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 title text not null check(length(trim(title)) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','assigned','in_progress','paused','review','completed','cancelled')),
 work_mode text not null default 'onsite' check(work_mode in ('onsite','depot','remote')),
 date_from date, date_to date, lead_engineer uuid references public.profiles(id), engineer_ids uuid[] not null default '{}',
 instructions text not null default '', result_note text not null default '', revision integer not null default 0,
 legacy_trip_id uuid unique, legacy_snapshot jsonb, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(date_to is null or date_from is null or date_to>=date_from),
 check(lead_engineer is null or lead_engineer=any(engineer_ids))
);
create table public.service_order_jobs (
 order_id uuid not null references public.service_orders(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete restrict,
 snapshot jsonb not null default '{}', primary key(order_id,job_id)
);
create index service_order_jobs_job_idx on public.service_order_jobs(job_id);
create table public.service_order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null, job_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 500), unit text not null default 'работа' check(length(trim(unit)) between 1 and 40),
 planned_qty numeric not null check(planned_qty>0 and planned_qty<1000000),
 done_qty numeric not null default 0 check(done_qty>=0), transferred_qty numeric not null default 0 check(transferred_qty>=0),
 result_note text not null default '', source_item_id uuid references public.service_order_items(id),
 foreign key(order_id,job_id) references public.service_order_jobs(order_id,job_id),
 check(done_qty+transferred_qty<=planned_qty)
);
create index service_order_items_job_idx on public.service_order_items(job_id);
create index service_order_items_source_idx on public.service_order_items(source_item_id);
create index service_order_items_order_idx on public.service_order_items(order_id);
create table public.service_order_history (
 id bigint generated always as identity primary key, order_id uuid not null references public.service_orders(id),
 actor_id uuid, recorded_at timestamptz not null default now(), reason text not null, snapshot jsonb not null
);
create index service_order_history_order_idx on public.service_order_history(order_id,recorded_at desc);
create index service_orders_lead_idx on public.service_orders(lead_engineer);
create index service_orders_crew_idx on public.service_orders using gin(engineer_ids);
create index service_orders_status_date_idx on public.service_orders(status,date_from);
alter table public.trips add column service_order_id uuid references public.service_orders(id);
create index trips_service_order_idx on public.trips(service_order_id);

-- Preserve existing travel facts verbatim; completion is deliberately NOT inferred from travel status.
insert into public.service_orders(title,date_from,date_to,lead_engineer,engineer_ids,instructions,legacy_trip_id,legacy_snapshot,created_by)
 select 'Задание по выезду '||coalesce(date_from::text,'без даты'),date_from,date_to,lead_engineer,
 case when lead_engineer is null then coalesce(engineer_ids,'{}') else array(select distinct unnest(coalesce(engineer_ids,'{}')||array[lead_engineer])) end,
 coalesce(notes,''),id,to_jsonb(t),created_by from public.trips t;
update public.trips t set service_order_id=o.id from public.service_orders o where o.legacy_trip_id=t.id;
alter table public.trips alter column service_order_id set not null;
insert into public.service_order_jobs(order_id,job_id,snapshot)
 select t.service_order_id,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name)
 from public.trip_jobs tj join public.trips t on t.id=tj.trip_id join public.jobs j on j.id=tj.job_id left join public.clients c on c.id=j.client_id;
insert into public.service_order_history(order_id,reason,snapshot)
 select id,'Перенесены связи выезда. Состав работ и результат требуют уточнения.',to_jsonb(o) from public.service_orders o;

create function dlight_private.order_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(public.user_role() in ('admin','logist') or
 (public.user_role()='engineer' and exists(select 1 from public.service_orders where id=p_id and auth.uid()=any(engineer_ids))),false)
$$;
revoke all on function dlight_private.order_access(uuid) from public,anon;
grant usage on schema dlight_private to authenticated;
grant execute on function dlight_private.order_access(uuid) to authenticated;

alter table public.service_orders enable row level security;
alter table public.service_order_jobs enable row level security;
alter table public.service_order_items enable row level security;
alter table public.service_order_history enable row level security;
revoke all on public.service_orders,public.service_order_jobs,public.service_order_items,public.service_order_history from public,anon,authenticated;
grant select on public.service_orders,public.service_order_jobs,public.service_order_items,public.service_order_history to authenticated;
create policy orders_read on public.service_orders for select to authenticated using(dlight_private.order_access(id));
create policy order_jobs_read on public.service_order_jobs for select to authenticated using(dlight_private.order_access(order_id));
create policy order_items_read on public.service_order_items for select to authenticated using(dlight_private.order_access(order_id));
create policy order_history_read on public.service_order_history for select to authenticated using(dlight_private.order_access(order_id));

create function dlight_private.order_snapshot(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(o)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)) from public.service_order_items i where order_id=p_id),'[]'),
 'job_ids',coalesce((select jsonb_agg(job_id) from public.service_order_jobs where order_id=p_id),'[]')) from public.service_orders o where id=p_id
$$;
revoke all on function dlight_private.order_snapshot(uuid) from public,anon,authenticated;

-- All writes go through revision checked, role checked operations. No direct client table writes.
create function dlight_private.order_save(p_id uuid,p_expected integer,p_data jsonb,p_jobs uuid[],p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare oid uuid:=coalesce(p_id,gen_random_uuid()); oldrow public.service_orders; item jsonb; jid uuid; crew uuid[]; lead uuid; snap jsonb;
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
 -- Membership with existing travel or executed scope cannot disappear.
 if exists(select 1 from public.trips t join public.trip_jobs tj on tj.trip_id=t.id where t.service_order_id=oid and not(tj.job_id=any(p_jobs))) then raise exception 'Заявка уже входит в выезд задания'; end if;
 foreach jid in array p_jobs loop
  insert into public.service_order_jobs(order_id,job_id,snapshot) select oid,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name) from public.jobs j left join public.clients c on c.id=j.client_id where j.id=jid on conflict do nothing;
 end loop;
 if exists(select 1 from public.service_order_items i where order_id=oid and (done_qty>0 or transferred_qty>0 or source_item_id is not null) and
  not exists(select 1 from jsonb_array_elements(p_items)x where nullif(x->>'id','')::uuid=i.id)) then raise exception 'Нельзя удалить работу с результатом или переносом'; end if;
 delete from public.service_order_items i where order_id=oid and not exists(select 1 from jsonb_array_elements(p_items)x where nullif(x->>'id','')::uuid=i.id);
 for item in select * from jsonb_array_elements(p_items) loop
  jid:=(item->>'job_id')::uuid;
  if not(jid=any(p_jobs)) then raise exception 'Работа относится к другой заявке'; end if;
  if nullif(item->>'id','') is null then
   insert into public.service_order_items(order_id,job_id,title,unit,planned_qty) values(oid,jid,trim(item->>'title'),trim(item->>'unit'),(item->>'planned_qty')::numeric);
  else
   if exists(select 1 from public.service_order_items where id=(item->>'id')::uuid and order_id=oid and (done_qty>0 or transferred_qty>0 or source_item_id is not null) and unit is distinct from trim(item->>'unit')) then raise exception 'Единицу выполненной или переданной работы менять нельзя'; end if;
   update public.service_order_items set title=trim(item->>'title'),unit=trim(item->>'unit'),planned_qty=(item->>'planned_qty')::numeric
    where id=(item->>'id')::uuid and order_id=oid and job_id=jid;
   if not found then raise exception 'Строка работы не принадлежит заданию'; end if;
  end if;
 end loop;
 delete from public.service_order_jobs where order_id=oid and not(job_id=any(p_jobs));
 if oldrow.status='assigned' and (lead is null or cardinality(crew)=0 or nullif(p_data->>'date_from','') is null or nullif(p_data->>'date_to','') is null or not exists(select 1 from public.service_order_items where order_id=oid)) then raise exception 'Назначенное задание требует команды, периода и работ'; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(oid,auth.uid(),case when p_id is null then 'Создано задание' else 'Изменён план задания' end,coalesce(snap,dlight_private.order_snapshot(oid)));
 return oid;
end $$;

create function dlight_private.order_result(p_id uuid,p_expected integer,p_items jsonb,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare o public.service_orders; item jsonb;
begin
 if not dlight_private.order_access(p_id) then raise exception 'Нет доступа к заданию'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if o.status not in ('in_progress','paused','review') then raise exception 'Результат вводится после начала работ'; end if;
 if o.status='review' and public.user_role()='engineer' then raise exception 'Результат уже передан на проверку'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Некорректные работы'; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Обновлён результат',dlight_private.order_snapshot(p_id));
 for item in select * from jsonb_array_elements(p_items) loop
  update public.service_order_items set done_qty=(item->>'done_qty')::numeric,result_note=coalesce(item->>'result_note','') where id=(item->>'id')::uuid and order_id=p_id;
  if not found then raise exception 'Строка работы не принадлежит заданию'; end if;
 end loop;
 update public.service_orders set result_note=coalesce(p_note,''),revision=revision+1,updated_at=now() where id=p_id returning revision into p_expected;
 return p_expected;
end $$;

create function dlight_private.order_transition(p_id uuid,p_expected integer,p_status text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare o public.service_orders; allowed text[];
begin
 if not dlight_private.order_access(p_id) then raise exception 'Нет доступа к заданию'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if p_status=o.status then return o.revision; end if;
 allowed:=case o.status when 'draft' then array['assigned','cancelled'] when 'assigned' then array['draft','in_progress','cancelled']
 when 'in_progress' then array['paused','review'] when 'paused' then array['in_progress','review','cancelled'] when 'review' then array['in_progress','completed'] else '{}' end;
 if not(p_status=any(allowed)) then raise exception 'Недопустимый переход статуса задания'; end if;
 if public.user_role()='engineer' and not((o.status in ('assigned','paused') and p_status='in_progress') or (o.status='in_progress' and p_status in ('paused','review'))) then raise exception 'Этот переход выполняет диспетчер'; end if;
 if p_status in ('paused','cancelled') and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Укажи причину'; end if;
 if p_status in ('assigned','in_progress') and (o.lead_engineer is null or cardinality(o.engineer_ids)=0 or o.date_from is null or o.date_to is null or not exists(select 1 from public.service_order_items where order_id=p_id)) then raise exception 'Укажи команду, ответственного, период и состав работ'; end if;
 if p_status in ('review','completed') and not exists(select 1 from public.service_order_items where order_id=p_id) then raise exception 'Сначала уточни состав работ'; end if;
 if p_status='completed' and exists(select 1 from public.service_order_items where order_id=p_id and done_qty+transferred_qty<planned_qty) then raise exception 'Есть невыполненные работы. Выполни или перенеси остаток'; end if;
 if p_status='cancelled' and exists(select 1 from public.trips where service_order_id=p_id and deleted_at is null and status in ('assigned','in_progress')) then raise exception 'Сначала закончи или отмени активные выезды'; end if;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Статус: '||o.status||' → '||p_status||case when coalesce(p_reason,'')='' then '' else ' · '||p_reason end,dlight_private.order_snapshot(p_id));
 update public.service_orders set status=p_status,revision=revision+1,updated_at=now() where id=p_id returning revision into p_expected;
 return p_expected;
end $$;

create function dlight_private.order_carry(p_id uuid,p_expected integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
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
 insert into public.service_order_items(order_id,job_id,title,unit,planned_qty,source_item_id) select nid,job_id,title,unit,planned_qty-done_qty-transferred_qty,id from public.service_order_items where order_id=p_id and planned_qty>done_qty+transferred_qty;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Остаток перенесён: '||p_reason,dlight_private.order_snapshot(p_id));
 update public.service_order_items set transferred_qty=planned_qty-done_qty where order_id=p_id;
 update public.service_orders set revision=revision+1,updated_at=now() where id=p_id;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(nid,auth.uid(),'Остаток задания №'||o.number,dlight_private.order_snapshot(nid));
 return nid;
end $$;

-- Every new trip has a parent, including older clients still using the existing trip editor.
create function dlight_private.trip_order_parent() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.service_orders;
begin
 if tg_op='UPDATE' then
  if new.service_order_id is distinct from old.service_order_id then raise exception 'Перенос выезда между заданиями запрещён'; end if;
  return new;
 end if;
 if new.service_order_id is null then
  insert into public.service_orders(title,date_from,date_to,lead_engineer,engineer_ids,instructions,legacy_trip_id,legacy_snapshot,created_by)
  values('Задание по выезду '||coalesce(new.date_from::text,'без даты'),new.date_from,new.date_to,new.lead_engineer,
   case when new.lead_engineer is null then coalesce(new.engineer_ids,'{}') else array(select distinct unnest(coalesce(new.engineer_ids,'{}')||array[new.lead_engineer])) end,
   coalesce(new.notes,''),new.id,to_jsonb(new),auth.uid()) returning id into new.service_order_id;
 else
  select * into o from public.service_orders where id=new.service_order_id for update;
  if not found or o.work_mode<>'onsite' or o.status in ('completed','cancelled','review') then raise exception 'Задание недоступно для нового выезда'; end if;
 end if;
 return new;
end $$;
create trigger trips_order_parent before insert or update of service_order_id on public.trips for each row execute function dlight_private.trip_order_parent();
create function dlight_private.trip_order_job() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.service_orders;
begin
 select so.* into o from public.service_orders so join public.trips t on t.service_order_id=so.id where t.id=new.trip_id;
 if exists(select 1 from public.service_order_jobs where order_id=o.id and job_id=new.job_id) then return new; end if;
 if o.legacy_trip_id is null then raise exception 'Заявка не входит в сервисное задание'; end if;
 insert into public.service_order_jobs(order_id,job_id,snapshot) select o.id,j.id,to_jsonb(j)||jsonb_build_object('client_name',c.name) from public.jobs j left join public.clients c on c.id=j.client_id where j.id=new.job_id on conflict do nothing;
 return new;
end $$;
create trigger trip_jobs_order after insert or update on public.trip_jobs for each row execute function dlight_private.trip_order_job();
revoke all on function dlight_private.trip_order_parent(),dlight_private.trip_order_job() from public,anon,authenticated;

create function dlight_private.order_trip(p_id uuid,p_expected integer) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.service_orders; tid uuid; stops jsonb;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер планирует выезд'; end if;
 select * into o from public.service_orders where id=p_id for update;
 if not found then raise exception 'Задание не найдено'; end if;
 if p_expected is distinct from o.revision then raise exception 'Задание изменено другим пользователем. Обнови данные'; end if;
 if o.work_mode<>'onsite' or o.status in ('completed','cancelled','review') then raise exception 'Задание недоступно для нового выезда'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('type','job','name',x.name,'lat',x.lat,'lng',x.lng)),'[]') into stops from
 (select distinct c.name,p.lat,p.lng from public.service_order_jobs oj join public.jobs j on j.id=oj.job_id join public.clients c on c.id=j.client_id cross join lateral public.job_point(j.id) p where oj.order_id=p_id and not coalesce(j.at_depot,false) and p.lat is not null and p.lng is not null)x;
 insert into public.trips(service_order_id,date_from,date_to,lead_engineer,engineer_ids,route_stops,created_by)
 values(p_id,o.date_from,o.date_to,o.lead_engineer,o.engineer_ids,stops,auth.uid()) returning id into tid;
 insert into public.trip_jobs(trip_id,job_id,ord) select tid,oj.job_id,row_number() over(order by oj.job_id)-1 from public.service_order_jobs oj join public.jobs j on j.id=oj.job_id where oj.order_id=p_id and j.deleted_at is null and not coalesce(j.at_depot,false);
 if not found then raise exception 'В задании нет выездных заявок'; end if;
 update public.service_orders set revision=revision+1,updated_at=now() where id=p_id;
 insert into public.service_order_history(order_id,actor_id,reason,snapshot) values(p_id,auth.uid(),'Запланирован выезд',jsonb_build_object('trip_id',tid));
 return tid;
end $$;

create function public.service_order_save(p_id uuid,p_expected integer,p_data jsonb,p_jobs uuid[],p_items jsonb) returns uuid language sql security invoker set search_path='' as $$select dlight_private.order_save(p_id,p_expected,p_data,p_jobs,p_items)$$;
create function public.service_order_result(p_id uuid,p_expected integer,p_items jsonb,p_note text) returns integer language sql security invoker set search_path='' as $$select dlight_private.order_result(p_id,p_expected,p_items,p_note)$$;
create function public.service_order_transition(p_id uuid,p_expected integer,p_status text,p_reason text) returns integer language sql security invoker set search_path='' as $$select dlight_private.order_transition(p_id,p_expected,p_status,p_reason)$$;
create function public.service_order_carry(p_id uuid,p_expected integer,p_reason text) returns uuid language sql security invoker set search_path='' as $$select dlight_private.order_carry(p_id,p_expected,p_reason)$$;
create function public.service_order_trip(p_id uuid,p_expected integer) returns uuid language sql security invoker set search_path='' as $$select dlight_private.order_trip(p_id,p_expected)$$;
revoke all on function dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb),dlight_private.order_result(uuid,integer,jsonb,text),dlight_private.order_transition(uuid,integer,text,text),dlight_private.order_carry(uuid,integer,text),dlight_private.order_trip(uuid,integer),public.service_order_save(uuid,integer,jsonb,uuid[],jsonb),public.service_order_result(uuid,integer,jsonb,text),public.service_order_transition(uuid,integer,text,text),public.service_order_carry(uuid,integer,text),public.service_order_trip(uuid,integer) from public,anon,authenticated;
grant execute on function dlight_private.order_save(uuid,integer,jsonb,uuid[],jsonb),dlight_private.order_result(uuid,integer,jsonb,text),dlight_private.order_transition(uuid,integer,text,text),dlight_private.order_carry(uuid,integer,text),dlight_private.order_trip(uuid,integer),public.service_order_save(uuid,integer,jsonb,uuid[],jsonb),public.service_order_result(uuid,integer,jsonb,text),public.service_order_transition(uuid,integer,text,text),public.service_order_carry(uuid,integer,text),public.service_order_trip(uuid,integer) to authenticated;
