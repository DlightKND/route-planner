begin;

-- Approval payloads and execution authority are private. No caller-controlled
-- session setting can grant authority; only the guarded decision RPC writes it.
create table dlight_private.approvals(
 id uuid primary key default gen_random_uuid(), kind text not null, target uuid not null,
 entity_kind text not null, entity_id uuid not null, scope text not null,
 requester uuid not null references public.profiles(id), assignee uuid not null references public.profiles(id),
 path uuid[] not null, payload jsonb not null, baseline jsonb not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 revision integer not null default 0, reason text not null default '',
 created_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid references public.profiles(id)
);
create unique index approvals_pending_scope on dlight_private.approvals(scope) where status='pending';
create index approvals_assignee_idx on dlight_private.approvals(assignee,status,created_at);
create index approvals_path_idx on dlight_private.approvals using gin(path);
create index approvals_requester_idx on dlight_private.approvals(requester,created_at);
create table dlight_private.approval_events(
 id bigint generated always as identity primary key, approval_id uuid not null references dlight_private.approvals(id),
 actor uuid not null references public.profiles(id), action text not null, recipient uuid references public.profiles(id),
 note text not null default '', created_at timestamptz not null default now()
);
create table dlight_private.approval_execution(
 tx bigint not null, actor uuid not null, entity_kind text not null, entity_id uuid not null,
 primary key(tx,actor)
);
alter table dlight_private.approvals enable row level security;
alter table dlight_private.approval_events enable row level security;
alter table dlight_private.approval_execution enable row level security;
revoke all on dlight_private.approvals,dlight_private.approval_events,dlight_private.approval_execution from public,anon,authenticated;

create function dlight_private.approval_active() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then
  raise exception 'Требуется активная учётная запись' using errcode='42501';
 end if;
end $$;
create function dlight_private.approval_context(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from dlight_private.approval_execution where tx=txid_current() and actor=auth.uid() and entity_kind=p_kind and entity_id=p_id)
$$;
-- Preserve existing entity authority, adding only the scope of an executing decision.
create or replace function dlight_private.responsibility_manager(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
 and coalesce(public.user_role() in ('admin','logist')
 or (p_kind='job' and exists(select 1 from public.jobs where id=p_id and auth.uid() in(owner_id,curator_id)))
 or (p_kind='order' and exists(select 1 from public.service_orders where id=p_id and auth.uid() in(owner_id,curator_id)))
 or (p_kind='trip' and exists(select 1 from public.trips where id=p_id and auth.uid() in(owner_id,curator_id)))
 or dlight_private.approval_context(p_kind,p_id),false)
$$;

create or replace function dlight_private.responsibility_access(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active) and coalesce(
 public.user_role() in ('admin','logist')
 or (p_kind='job' and exists(select 1 from public.jobs where id=p_id and (auth.uid() in(owner_id,curator_id,assigned_engineer) or auth.uid()=any(engineer_ids))))
 or (p_kind='order' and exists(select 1 from public.service_orders where id=p_id and (auth.uid() in(owner_id,curator_id,lead_engineer) or auth.uid()=any(engineer_ids))))
 or (p_kind='trip' and exists(select 1 from public.trips where id=p_id and (auth.uid() in(owner_id,curator_id,lead_engineer) or auth.uid()=any(engineer_ids))))
 or exists(select 1 from dlight_private.approvals where status='pending' and assignee=auth.uid() and entity_kind=p_kind and entity_id=p_id),false)
$$;

create function dlight_private.approval_entity(p_kind text,p_target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare k text; i uuid;
begin
 case p_kind
 when 'window','split' then
  if p_kind='window' then k:='staff'; i:=p_target;
  elsif exists(select 1 from public.trips where id=p_target) then k:='trip';i:=p_target;
  else k:='job';i:=p_target;end if;
 when 'order_complete' then k:='order';i:=p_target;
 when 'order_deadline' then k:='order';select order_id into i from public.service_order_deadline_requests where id=p_target;
 when 'trip_reschedule' then k:='trip';select trip_id into i from public.trip_reschedules where id=p_target;
 when 'job_change' then k:='job';select job_id into i from public.job_change_requests where id=p_target;
 when 'finance' then k:='job';i:=p_target;
 when 'stay' then k:='trip';select trip_id into i from public.trip_stays where id=p_target;
 when 'presence','trip_confirm','trip_cost' then k:='trip';i:=p_target;
 when 'track_charge','track_cancel' then k:='track';i:=p_target;
 else raise exception 'Неизвестный вид согласования';
 end case;
 if i is null then raise exception 'Объект согласования не найден';end if;
 return jsonb_build_object('kind',k,'id',i);
end $$;
create function dlight_private.approval_split_data(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare crew uuid[]; trip_ids uuid[]; job_ids uuid[]; result jsonb;
begin
 if p_kind='trip' then select array(select distinct unnest(array_append(engineer_ids,lead_engineer))) into crew from public.trips where id=p_id;
 else select array(select distinct unnest(array_append(engineer_ids,assigned_engineer))) into crew from public.jobs where id=p_id;end if;
 select array_agg(id) into trip_ids from public.trips where deleted_at is null and (id=p_id or engineer_ids&&crew or lead_engineer=any(crew));
 select array_agg(id) into job_ids from public.jobs where deleted_at is null and (id=p_id or engineer_ids&&crew or assigned_engineer=any(crew) or id in(select job_id from public.trip_jobs where trip_id=any(trip_ids)));
 select jsonb_build_object(
 'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'status',to_jsonb(j)->'status','due_date',to_jsonb(j)->'due_date','scheduled_date',to_jsonb(j)->'scheduled_date','created_at',to_jsonb(j)->'created_at','assigned_engineer',j.assigned_engineer,'engineer_ids',j.engineer_ids,'at_depot',to_jsonb(j)->'at_depot','day_plan',j.day_plan,
 'clients',coalesce((select jsonb_build_object('name',c.name,'lat',c.lat,'lng',c.lng) from public.clients c where c.id=j.client_id),'{}'::jsonb),'equipment',coalesce((select jsonb_build_object('model',e.model,'lat',e.lat,'lng',e.lng) from public.equipment e where e.id=j.equipment_id),'{}'::jsonb),'job_works',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'hours',w.hours) order by w.id) from public.job_works w where w.job_id=j.id),'[]'::jsonb)) order by j.id) from public.jobs j where j.id=any(job_ids)),'[]'::jsonb),
 'trips',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'date_from',to_jsonb(t)->'date_from','date_to',to_jsonb(t)->'date_to','started_at',to_jsonb(t)->'started_at','finished_at',to_jsonb(t)->'finished_at','lead_engineer',t.lead_engineer,'engineer_ids',t.engineer_ids,'day_plan',t.day_plan,
 'route_stops',coalesce((select jsonb_agg(jsonb_build_object('type',s->'type','job_id',s->'job_id','lat',s->'lat','lng',s->'lng')) from jsonb_array_elements(coalesce(to_jsonb(t)->'route_stops','[]'::jsonb)) s),'[]'::jsonb),
 'econ_snapshot',jsonb_build_object('driveH',to_jsonb(t)#>'{econ_snapshot,driveH}','legs',coalesce((select jsonb_agg(jsonb_build_object('a',l->'a','b',l->'b','h',l->'h')) from jsonb_array_elements(coalesce(to_jsonb(t)#>'{econ_snapshot,legs}','[]'::jsonb)) l),'[]'::jsonb))) order by t.id) from public.trips t where t.id=any(trip_ids)),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(l) order by trip_id,job_id) from public.trip_jobs l where trip_id=any(trip_ids)),'[]'::jsonb),
 'days',coalesce((select jsonb_agg(to_jsonb(d) order by engineer,date) from public.staff_day d where engineer=any(crew)),'[]'::jsonb),
 'settings',(select jsonb_build_object('dayStart',day_start,'dayEnd',day_end,'toleranceH',tolerance_h) from public.settings where id=true)) into result;
 return result;
end $$;
create function public.approval_review_read(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r dlight_private.approvals;
begin
 perform dlight_private.approval_active();select * into r from dlight_private.approvals where id=p_id;
 if not found or r.status<>'pending' or r.assignee<>auth.uid() or r.kind<>'split' then raise exception 'График согласования недоступен' using errcode='42501';end if;
 return dlight_private.approval_split_data(r.entity_kind,r.entity_id);
end $$;

create function dlight_private.approval_snapshot(p_kind text,p_target uuid,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e jsonb; body jsonb; related jsonb;
begin
 e:=case when p_kind='split' then jsonb_build_object('kind',p_payload->>'entity_kind','id',p_target) else dlight_private.approval_entity(p_kind,p_target) end;
 case e->>'kind'
 when 'staff' then
  select jsonb_build_object('day',to_jsonb(d),'settings',jsonb_build_object('start',s.day_start,'end',s.day_end,'tol',s.tolerance_h)) into body
  from public.settings s left join public.staff_day d on d.engineer=p_target and d.date=(p_payload->>'date')::date where s.id=true;
 when 'trip' then select to_jsonb(t) into body from public.trips t where id=(e->>'id')::uuid and deleted_at is null;
 when 'job' then select to_jsonb(j) into body from public.jobs j where id=(e->>'id')::uuid and deleted_at is null;
 when 'track' then select to_jsonb(t) into body from public.unassigned_tracks t where id=p_target;
 when 'order' then select to_jsonb(o) into body from public.service_orders o where id=(e->>'id')::uuid;
 end case;
 if body is null then raise exception 'Объект согласования недоступен';end if;
 case p_kind
 when 'track_charge','track_cancel' then related:=public.unassigned_track_quote(p_target);
 when 'split' then related:=dlight_private.approval_split_data(e->>'kind',p_target);
 when 'order_complete' then select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]'::jsonb) into related from public.service_order_items i where order_id=p_target;
 when 'order_deadline' then select to_jsonb(r) into related from public.service_order_deadline_requests r where id=p_target;
 when 'trip_reschedule' then select to_jsonb(r) into related from public.trip_reschedules r where id=p_target;
 when 'job_change' then select to_jsonb(r) into related from public.job_change_requests r where id=p_target;
 when 'finance' then select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]'::jsonb) into related from public.service_order_items i where job_id=p_target and id in(select value::uuid from jsonb_array_elements_text(p_payload->'ids'));
 when 'stay' then select to_jsonb(s) into related from public.trip_stays s where id=p_target;
 when 'presence','trip_cost' then select jsonb_build_object('stays',coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb),'track',(select updated_at from public.trip_tracks where trip_id=p_target)) into related from public.trip_stays s where trip_id=p_target;
 else related:=null;
 end case;
 return jsonb_build_object('entity',body,'related',related);
end $$;
create function dlight_private.approval_next(p_actor uuid,p_path uuid[]) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare next_id uuid;
begin
 select o.manager_id into next_id from public.employee_org o join public.profiles p on p.id=o.manager_id and p.active where o.profile_id=p_actor;
 if next_id is null then raise exception 'В структуре сотрудников не указан активный руководитель';end if;
 if next_id=any(p_path) then raise exception 'Передача создаёт цикл согласования';end if;
 return next_id;
end $$;
create function dlight_private.approval_check(p_kind text,p_target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r dlight_private.approvals;
begin
 select * into r from dlight_private.approvals where kind=p_kind and target=p_target and status='pending' for update;
 if found and not dlight_private.approval_context(r.entity_kind,r.entity_id) then
  raise exception 'Согласование передано руководителю. Решение доступно в очереди согласований' using errcode='42501';
 end if;
end $$;
create function dlight_private.approval_create(p_kind text,p_target uuid,p_payload jsonb,p_assignee uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e jsonb; rid uuid; key text;
begin
 e:=case when p_kind='split' then jsonb_build_object('kind',p_payload->>'entity_kind','id',p_target) else dlight_private.approval_entity(p_kind,p_target) end;
 key:=p_kind||'|'||p_target::text||case when p_kind='window' then '|'||(p_payload->>'date') else '' end;
 insert into dlight_private.approvals(kind,target,entity_kind,entity_id,scope,requester,assignee,path,payload,baseline,reason)
 values(p_kind,p_target,e->>'kind',(e->>'id')::uuid,key,auth.uid(),p_assignee,array[auth.uid(),p_assignee],p_payload,
 dlight_private.approval_snapshot(p_kind,p_target,p_payload),coalesce(p_reason,'')) returning id into rid;
 insert into dlight_private.approval_events(approval_id,actor,action,recipient,note) values(rid,auth.uid(),'submitted',p_assignee,coalesce(p_reason,''));
 return rid;
exception when unique_violation then raise exception 'Изменение уже ожидает согласования. Отзови его или дождись решения';
end $$;

create function public.approval_delegate(p_kind text,p_target uuid,p_payload jsonb default '{}'::jsonb,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare e jsonb; next_id uuid;
begin
 perform dlight_private.approval_active();
 if p_kind in ('split') then raise exception 'Сначала отправь изменение графика на согласование';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Некорректное согласование';end if;
 e:=dlight_private.approval_entity(p_kind,p_target);
 if (e->>'kind' in ('staff','track') and not public.is_money_manager()) or (e->>'kind' not in ('staff','track') and not dlight_private.responsibility_manager(e->>'kind',(e->>'id')::uuid)) then
  raise exception 'Недостаточно прав для передачи согласования' using errcode='42501';
 end if;
 if p_kind='window' then
  if not exists(select 1 from public.staff_day where engineer=p_target and date=(p_payload->>'date')::date and proposed_end_h=(p_payload->>'value')::numeric) then raise exception 'Предложение изменилось';end if;
  p_payload:=p_payload||jsonb_build_object('field','end','before',dlight_private.staff_window(p_target,(p_payload->>'date')::date));
 end if;
 next_id:=dlight_private.approval_next(auth.uid(),array[auth.uid()]);
 return dlight_private.approval_create(p_kind,p_target,p_payload,next_id,p_reason);
end $$;
create function public.approval_escalate(p_id uuid,p_expected integer,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare r dlight_private.approvals; next_id uuid;
begin
 perform dlight_private.approval_active();
 select * into r from dlight_private.approvals where id=p_id for update;
 if not found or r.status<>'pending' or r.assignee<>auth.uid() then raise exception 'Это согласование тебе недоступно' using errcode='42501';end if;
 if r.revision is distinct from p_expected then raise exception 'Согласование изменилось. Обнови очередь';end if;
 next_id:=dlight_private.approval_next(auth.uid(),r.path);
 update dlight_private.approvals set assignee=next_id,path=path||next_id,revision=revision+1 where id=p_id;
 insert into dlight_private.approval_events(approval_id,actor,action,recipient,note) values(p_id,auth.uid(),'delegated',next_id,coalesce(p_note,''));
 return next_id;
end $$;

create function dlight_private.staff_window(p_engineer uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('start',coalesce(d.start_h,s.day_start),'end',coalesce(d.end_h,s.day_end),'tol',coalesce(d.tol_h,s.tolerance_h))
 from public.settings s left join public.staff_day d on d.engineer=p_engineer and d.date=p_date where s.id=true
$$;
create function dlight_private.window_apply(p_engineer uuid,p_date date,p_field text,p_value numeric) returns void
language plpgsql security definer set search_path='' as $$
declare w jsonb; a numeric; z numeric; t numeric;
begin
 w:=dlight_private.staff_window(p_engineer,p_date);a:=(w->>'start')::numeric;z:=(w->>'end')::numeric;t:=(w->>'tol')::numeric;
 case p_field when 'start' then a:=p_value;when 'end' then z:=p_value;when 'tol' then t:=p_value;else raise exception 'Неизвестная граница дня';end case;
 if a<0 or z<=a or z>24 or t<0 or t>8 or z+t>24 or p_value is null or mod(p_value,.25)<>0 then raise exception 'Границы дня: 0–24 часа, допуск до 8 часов, шаг 15 минут';end if;
 insert into public.staff_day(engineer,date,start_h,end_h,tol_h) values(p_engineer,p_date,a,z,t)
 on conflict(engineer,date) do update set start_h=excluded.start_h,end_h=excluded.end_h,tol_h=excluded.tol_h,proposed_end_h=null,proposed_by=null,proposed_at=null;
end $$;
create or replace function public.guard_staff_day() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if dlight_private.approval_context('staff',new.engineer) then return new;end if;
 if exists(select 1 from dlight_private.approvals where scope='window|'||new.engineer::text||'|'||new.date::text and status='pending') then raise exception 'Рабочий день ожидает согласования';end if;
 if public.is_money_manager() then return new;end if;
 raise exception 'Изменяй рабочее окно через график: сокращение требует согласования' using errcode='42501';
end $$;
drop policy if exists staff_day_engineer_insert on public.staff_day;
drop policy if exists staff_day_engineer_update on public.staff_day;

create function public.schedule_window_change(p_engineer uuid,p_date date,p_field text,p_value numeric,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w jsonb; manager boolean; proposal boolean; rid uuid; next_id uuid;
begin
 perform dlight_private.approval_active();
 manager:=public.is_money_manager();
 if not manager and (public.user_role()<>'engineer' or p_engineer<>auth.uid()) then raise exception 'Можно изменять только собственный день' using errcode='42501';end if;
 if p_date is null or p_value is null or p_field not in ('start','end','tol') then raise exception 'Укажи день и границу';end if;
 -- Serialize both absent and existing day rows, including concurrent approvals.
 perform pg_advisory_xact_lock(hashtextextended('staff|'||p_engineer::text||'|'||p_date::text,0));
 w:=dlight_private.staff_window(p_engineer,p_date);
 if w is distinct from p_expected then raise exception 'Рабочее окно изменилось. Обнови график';end if;
 if p_value<0 or p_value>24 or mod(p_value,.25)<>0 or (p_field='start' and p_value>=(w->>'end')::numeric) or (p_field='end' and (p_value<=(w->>'start')::numeric or p_value+(w->>'tol')::numeric>24)) or (p_field='tol' and (p_value>8 or p_value+(w->>'end')::numeric>24)) then raise exception 'Недопустимая граница рабочего дня';end if;
 proposal:=not manager and case p_field when 'start' then p_value>(w->>'start')::numeric when 'end' then p_value<(w->>'end')::numeric else p_value<(w->>'tol')::numeric end;
 if proposal then
  next_id:=dlight_private.approval_next(auth.uid(),array[auth.uid()]);
  rid:=dlight_private.approval_create('window',p_engineer,jsonb_build_object('date',p_date,'field',p_field,'value',p_value,'before',w),next_id,'Изменение рабочего окна');
  return jsonb_build_object('status','pending','id',rid);
 end if;
 if exists(select 1 from dlight_private.approvals where scope='window|'||p_engineer::text||'|'||p_date::text and status='pending') then raise exception 'Сначала дождись решения по этому дню или отзови предложение';end if;
 insert into dlight_private.approval_execution values(txid_current(),auth.uid(),'staff',p_engineer);
 perform dlight_private.window_apply(p_engineer,p_date,p_field,p_value);
 delete from dlight_private.approval_execution where tx=txid_current() and actor=auth.uid();
 return jsonb_build_object('status','applied');
end $$;

create function public.schedule_split_propose(p_kind text,p_id uuid,p_date date,p_plan jsonb,p_expected_plan jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actual jsonb; own boolean; next_id uuid; cut jsonb; previous numeric:=0; n numeric;
begin
 perform dlight_private.approval_active();
 if p_kind='trip' then
  select day_plan,auth.uid()=any(engineer_ids) or lead_engineer=auth.uid() into actual,own from public.trips where id=p_id and deleted_at is null for update;
 elsif p_kind='job' then
  select day_plan,auth.uid()=any(engineer_ids) or assigned_engineer=auth.uid() into actual,own from public.jobs where id=p_id and deleted_at is null for update;
 else raise exception 'Неизвестный блок';end if;
 if public.user_role()<>'engineer' or own is distinct from true then raise exception 'Можно разделить только собственный рабочий блок' using errcode='42501';end if;
 if actual is distinct from p_expected_plan then raise exception 'Блок изменился. Обнови график';end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan->'cuts') is distinct from 'array' or jsonb_array_length(p_plan->'cuts')=0 or jsonb_array_length(p_plan->'cuts')>50 then raise exception 'Укажи разрезы блока';end if;
 if p_date is null or (p_plan#>>'{start,d}') is null or (p_plan#>>'{start,t}') is null or p_plan-array['start','cuts']::text[]<>'{}'::jsonb or (p_plan#>>'{start,d}')::date>p_date or (p_plan#>>'{start,t}')::numeric not between 0 and 24 or mod((p_plan#>>'{start,t}')::numeric,.25)<>0 then raise exception 'Некорректное начало блока';end if;
 if actual ? 'start' and actual->'start' is distinct from p_plan->'start' then raise exception 'Разделение не должно менять начало блока';end if;
 for cut in select value from jsonb_array_elements(p_plan->'cuts') loop
  n:=(cut->>'after')::numeric;
  if n is null or n<=previous or mod(n,.25)<>0 or (cut#>>'{at,d}') is null or (cut#>>'{at,t}') is null or (cut#>>'{at,t}')::numeric not between 0 and 24 or mod((cut#>>'{at,t}')::numeric,.25)<>0 then raise exception 'Некорректный разрез';end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(actual->'cuts','[]'::jsonb)) x where x=cut) and (cut#>>'{at,d}')::date<>p_date then raise exception 'Разделение доступно в пределах выбранного дня';end if;
  previous:=n;
 end loop;
 next_id:=dlight_private.approval_next(auth.uid(),array[auth.uid()]);
 return dlight_private.approval_create('split',p_id,jsonb_build_object('entity_kind',p_kind,'engineer',auth.uid(),'date',p_date,'plan',p_plan),next_id,'Разделение рабочего блока');
end $$;

create function public.approval_decide(p_id uuid,p_expected integer,p_accept boolean,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r dlight_private.approvals; p jsonb; answer text; before jsonb;
begin
 perform dlight_private.approval_active();
 select * into r from dlight_private.approvals where id=p_id for update;
 if not found or r.status<>'pending' or r.assignee<>auth.uid() then raise exception 'Это согласование тебе недоступно' using errcode='42501';end if;
 if r.revision is distinct from p_expected then raise exception 'Согласование изменилось. Обнови очередь';end if;
 if p_accept is null then raise exception 'Укажи решение';end if;
 p:=r.payload;
 if r.entity_kind='staff' then perform pg_advisory_xact_lock(hashtextextended('staff|'||r.entity_id::text||'|'||(p->>'date'),0));
 elsif r.entity_kind='track' then perform 1 from public.unassigned_tracks where id=r.entity_id for update;
 elsif r.entity_kind='trip' then perform 1 from public.trips where id=r.entity_id for update;
 elsif r.entity_kind='job' then perform 1 from public.jobs where id=r.entity_id for update;
 else perform 1 from public.service_orders where id=r.entity_id for update;end if;
 if p_accept and r.baseline is distinct from dlight_private.approval_snapshot(r.kind,r.target,p) then raise exception 'Исходные данные изменились. Отклони запрос и подготовь новое согласование';end if;
 insert into dlight_private.approval_execution values(txid_current(),auth.uid(),r.entity_kind,r.entity_id);
 case r.kind
 when 'window' then if p_accept then perform dlight_private.window_apply(r.target,(p->>'date')::date,p->>'field',(p->>'value')::numeric);end if;
 when 'split' then if p_accept then
  if r.entity_kind='trip' then update public.trips set day_plan=p->'plan' where id=r.target;
  else update public.jobs set day_plan=p->'plan' where id=r.target;end if;end if;
 when 'order_complete' then perform public.service_order_transition(r.target,(p->>'expected')::integer,case when p_accept then 'completed' else 'in_progress' end,coalesce(nullif(p_note,''),p->>'reason','Решение руководителя'));
 when 'order_deadline' then perform public.service_order_deadline_decide(r.target,p_accept,p_note);
 when 'trip_reschedule' then answer:=public.trip_reschedule_decide(r.target,p_accept,p_note);
 when 'job_change' then update public.job_change_requests set status=case when p_accept then 'accepted' else 'declined' end,decided_by=auth.uid(),decided_at=now(),decision=p_note where id=r.target and status='open';if not found then raise exception 'Предложение уже рассмотрено';end if;
 when 'finance' then if p_accept then perform public.job_request_finance_approve(r.target,array(select value::uuid from jsonb_array_elements_text(p->'ids')));end if;
 when 'stay' then if p_accept then answer:=public.stay_approve(r.target,(p->>'minutes')::numeric);else answer:=public.stay_reject(r.target,p_note);end if;
 when 'presence' then if p_accept then perform public.trip_presence_save_tasks(r.target,(p->>'expected')::integer,p->'stays',p->>'reason');end if;
 when 'trip_confirm' then if p_accept then answer:=public.trip_confirm(r.target);end if;
 when 'track_charge' then if p_accept then perform public.unassigned_track_resolve(r.target,(p->>'expected')::integer,'charge',p->'data');end if;
 when 'track_cancel' then if p_accept then perform public.unassigned_track_charge_cancel(r.target,(p->>'expected')::integer,p->>'reason');end if;
 when 'trip_cost' then if p_accept then perform public.trip_cost_allocation_save(r.target,(p->>'expected')::integer,(p->>'track_updated_at')::timestamptz,p->>'reason',p->'lines',coalesce(p->'diagnostics','{}'::jsonb));end if;
 end case;
 if answer in ('wrong_status','not_found','already_decided','already_approved') then raise exception 'Объект уже изменился: %',answer;end if;
 delete from dlight_private.approval_execution where tx=txid_current() and actor=auth.uid();
 update dlight_private.approvals set status=case when p_accept then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),revision=revision+1 where id=p_id;
 insert into dlight_private.approval_events(approval_id,actor,action,note) values(p_id,auth.uid(),case when p_accept then 'approved' else 'rejected' end,coalesce(p_note,''));
 return jsonb_build_object('status',case when p_accept then 'approved' else 'rejected' end);
end $$;
create function public.approval_cancel(p_id uuid,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare r dlight_private.approvals;
begin
 perform dlight_private.approval_active();select * into r from dlight_private.approvals where id=p_id for update;
 if not found or r.requester<>auth.uid() or r.status<>'pending' then raise exception 'Нельзя отозвать это согласование' using errcode='42501';end if;
 if r.revision is distinct from p_expected then raise exception 'Согласование изменилось';end if;
 update dlight_private.approvals set status='cancelled',revision=revision+1 where id=p_id;
 insert into dlight_private.approval_events(approval_id,actor,action) values(p_id,auth.uid(),'cancelled');
end $$;
create function public.approval_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform dlight_private.approval_active();
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'target',r.target,'entity_kind',r.entity_kind,'entity_id',r.entity_id,'status',r.status,'revision',r.revision,'requester',r.requester,'assignee',r.assignee,'date',r.payload->>'date','reason',r.reason,'created_at',r.created_at,'can_decide',r.status='pending' and r.assignee=auth.uid(),'can_cancel',r.status='pending' and r.requester=auth.uid(),
 'next_manager',(select jsonb_build_object('id',p.id,'name',p.full_name) from public.employee_org o join public.profiles p on p.id=o.manager_id and p.active where o.profile_id=auth.uid() and not p.id=any(r.path)),
 'preview',case when r.kind in ('window','split') then r.payload else r.payload end,
 'details',case when r.kind='finance' then r.baseline->'related' when r.kind in ('track_charge','track_cancel') then r.baseline->'entity' when r.kind='trip_confirm' then jsonb_build_object('vehicle',r.baseline#>>'{entity,vehicle_label}','from',r.baseline#>>'{entity,date_from}','km',r.baseline#>'{entity,fact_km}') when r.kind='order_complete' then jsonb_build_object('title',r.baseline#>>'{entity,title}','number',r.baseline#>'{entity,number}','items',r.baseline->'related') when r.kind in ('order_deadline','trip_reschedule','job_change','stay') then r.baseline->'related' else null end,
 'history',(select coalesce(jsonb_agg(jsonb_build_object('actor',e.actor,'recipient',e.recipient,'action',e.action,'note',e.note,'at',e.created_at) order by e.id),'[]'::jsonb) from dlight_private.approval_events e where e.approval_id=r.id)) order by r.created_at desc)
 from (select * from dlight_private.approvals where auth.uid()=any(path) order by (status='pending') desc,created_at desc limit 200) r),'[]'::jsonb);
end $$;

-- Engineers cannot create assignments even as owners/curators, including carryover.
create function dlight_private.order_creation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Создание заданий доступно только руководителю' using errcode='42501';end if;return new;
end $$;
create trigger order_creation_guard before insert on public.service_orders for each row execute function dlight_private.order_creation_guard();

-- Guard original decision endpoints too. Delegation cannot be bypassed by
-- calling their old RPCs. Existing validation, auditing and actor IDs remain.
do $$
declare item record; target regprocedure; definition text; body_start integer;
begin
 for item in select * from (values
 ('dlight_private.order_transition(uuid,integer,text,text)','if p_status in (''completed'',''in_progress'') then perform dlight_private.approval_check(''order_complete'',p_id);end if;'),
 ('dlight_private.order_deadline_decide(uuid,boolean,text)','perform dlight_private.approval_check(''order_deadline'',p_request);'),
 ('public.trip_reschedule_decide(uuid,boolean,text)','perform dlight_private.approval_check(''trip_reschedule'',p_req);'),
 ('dlight_private.request_finance_approve(uuid,uuid[])','perform dlight_private.approval_check(''finance'',p_job);'),
 ('public.trip_confirm(uuid)','perform dlight_private.approval_check(''trip_confirm'',p_trip);'),
 ('public.trip_presence_save(uuid,integer,jsonb,text)','perform dlight_private.approval_check(''presence'',p_trip);'),
 ('public.trip_cost_allocation_save(uuid,integer,timestamp with time zone,text,jsonb,jsonb)','perform dlight_private.approval_check(''trip_cost'',p_trip);'),
 ('public.stay_approve(uuid,numeric)','perform dlight_private.approval_check(''stay'',p_stay);'),
 ('public.stay_reject(uuid,text)','perform dlight_private.approval_check(''stay'',p_stay);'),
 ('dlight_private.unassigned_resolve(uuid,integer,text,jsonb)','perform dlight_private.approval_check(''track_charge'',p_track);'),
 ('dlight_private.unassigned_charge_cancel(uuid,integer,text)','perform dlight_private.approval_check(''track_cancel'',p_track);'),
 ('dlight_private.unassigned_quote(uuid)','perform dlight_private.approval_active();')
 ) as t(signature,guard) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'Missing approval endpoint: %',item.signature;end if;
  definition:=pg_get_functiondef(target);body_start:=strpos(lower(definition),E'\nbegin');
  if body_start=0 then raise exception 'Unexpected approval endpoint: %',item.signature;end if;
  definition:=overlay(definition placing E'\nbegin\n '||item.guard from body_start for 6);
  if item.signature='public.stay_approve(uuid,numeric)' then definition:=replace(definition,'coalesce(public.user_role(),'''') not in (''admin'',''logist'')','not dlight_private.responsibility_manager(''trip'',(select trip_id from public.trip_stays where id=p_stay))');end if;
  if item.signature='public.stay_reject(uuid,text)' then definition:=replace(definition,'not public.is_owner_or_mgr(t.lead_engineer)','not (public.is_owner_or_mgr(t.lead_engineer) or dlight_private.approval_context(''trip'',s.trip_id))');end if;
  if item.signature='dlight_private.order_deadline_decide(uuid,boolean,text)' then
   definition:=replace(definition,'o.curator_id is distinct from auth.uid()','o.curator_id is distinct from auth.uid() and not dlight_private.approval_context(''order'',o.id)');
  end if;
  if item.signature='dlight_private.unassigned_quote(uuid)' then definition:=replace(definition,'coalesce(public.user_role(),'''') not in (''admin'',''logist'')','(coalesce(public.user_role(),'''') not in (''admin'',''logist'') and not exists(select 1 from dlight_private.approvals where entity_kind=''track'' and entity_id=p_track and status=''pending'' and assignee=auth.uid()))');end if;
  if item.signature='dlight_private.unassigned_resolve(uuid,integer,text,jsonb)' then definition:=replace(definition,'coalesce(public.user_role(),'''') not in (''admin'',''logist'')','(coalesce(public.user_role(),'''') not in (''admin'',''logist'') and not (p_action=''charge'' and dlight_private.approval_context(''track'',p_track)))');end if;
  if item.signature='dlight_private.unassigned_charge_cancel(uuid,integer,text)' then definition:=replace(definition,'coalesce(public.user_role(),'''') not in (''admin'',''logist'')','(coalesce(public.user_role(),'''') not in (''admin'',''logist'') and not dlight_private.approval_context(''track'',p_track))');end if;
  execute definition;
 end loop;
end $$;
create function dlight_private.job_change_approval_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform dlight_private.approval_check('job_change',old.id);return old;end if;
 if new.status is distinct from old.status then
  perform dlight_private.approval_check('job_change',old.id);
  if not dlight_private.responsibility_manager('job',old.job_id) then raise exception 'Решает только руководитель' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger job_change_approval_guard before update or delete on public.job_change_requests for each row execute function dlight_private.job_change_approval_guard();

-- Entity curator/owner status cannot bypass the engineer's schedule proposal rule.
create function dlight_private.schedule_plan_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.day_plan is distinct from old.day_plan and public.user_role()='engineer' and not dlight_private.approval_context(case when tg_table_name='trips' then 'trip' else 'job' end,new.id) then
  raise exception 'Изменение раскладки инженером требует согласования' using errcode='42501';
 end if;return new;
end $$;
create trigger schedule_plan_guard before update of day_plan on public.trips for each row execute function dlight_private.schedule_plan_guard();
create trigger schedule_plan_guard before update of day_plan on public.jobs for each row execute function dlight_private.schedule_plan_guard();

-- Explicit privileges: implementation helpers are not callable via the API.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlight_private' and (p.proname like 'approval_%' or p.proname in ('staff_window','window_apply','order_creation_guard','job_change_approval_guard','schedule_plan_guard')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);end loop;
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'approval_%' or p.proname in ('schedule_window_change','schedule_split_propose')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;
end $$;
revoke all on function dlight_private.responsibility_access(text,uuid),dlight_private.responsibility_manager(text,uuid) from public,anon,authenticated;
grant execute on function dlight_private.responsibility_access(text,uuid),dlight_private.responsibility_manager(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
