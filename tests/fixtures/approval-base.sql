-- Minimal contracts for legacy endpoints. The new migration runs unchanged.
-- Existing workflow implementations have separate database suites.
create role anon;create role authenticated;create schema auth;create schema dlight_private;
grant usage on schema auth,dlight_private,public to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table public.profiles(id uuid primary key,role text,active boolean default true,full_name text);
create function public.user_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;
create function public.is_money_manager() returns boolean language sql stable security definer set search_path='' as $$select coalesce(public.user_role() in ('admin','logist'),false)$$;
create function public.is_owner_or_mgr(uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_money_manager() or auth.uid()=$1$$;
create table public.employee_org(profile_id uuid primary key references public.profiles,manager_id uuid references public.profiles);
create table public.settings(id boolean primary key,day_start numeric,day_end numeric,tolerance_h numeric);
insert into public.settings values(true,7,16,1);
create table public.staff_day(engineer uuid references public.profiles,date date,start_h numeric,end_h numeric,tol_h numeric,proposed_end_h numeric,proposed_by uuid,proposed_at timestamptz,primary key(engineer,date));
alter table public.staff_day enable row level security;
grant select,insert,update on public.staff_day to authenticated;
create policy staff_day_read on public.staff_day for select to authenticated using(true);
create policy staff_day_manager_write on public.staff_day for all to authenticated using(public.is_money_manager()) with check(public.is_money_manager());
create function public.guard_staff_day() returns trigger language plpgsql as $$begin return new;end$$;
create trigger staff_day_guard before insert or update on public.staff_day for each row execute function public.guard_staff_day();
create table public.jobs(id uuid primary key,assigned_engineer uuid,engineer_ids uuid[] default '{}',owner_id uuid,curator_id uuid,day_plan jsonb,deleted_at timestamptz);
create table public.trips(id uuid primary key,lead_engineer uuid,engineer_ids uuid[] default '{}',owner_id uuid,curator_id uuid,day_plan jsonb,deleted_at timestamptz,status text default 'finished',workbench_revision integer default 0);
create table public.service_orders(id uuid primary key default gen_random_uuid(),owner_id uuid,curator_id uuid,lead_engineer uuid,engineer_ids uuid[] default '{}',status text default 'review',revision integer default 0);
create table public.service_order_items(id uuid primary key,order_id uuid,job_id uuid,approved_at timestamptz,approved_by uuid);
create table public.service_order_deadline_requests(id uuid primary key,order_id uuid,status text default 'open');
create table public.trip_reschedules(id uuid primary key,trip_id uuid,status text default 'pending');
create table public.job_change_requests(id uuid primary key,job_id uuid,status text default 'open',decided_by uuid,decided_at timestamptz,decision text);
create table public.trip_stays(id uuid primary key,trip_id uuid,status text default 'detected',minutes_mgr numeric,mgr_by uuid);
create table public.trip_tracks(trip_id uuid primary key,updated_at timestamptz);
grant select,insert,update,delete on public.jobs,public.trips,public.service_orders,public.service_order_items,public.job_change_requests to authenticated;
create function dlight_private.responsibility_manager(text,uuid) returns boolean language sql stable as $$select public.is_money_manager()$$;
create function dlight_private.order_transition(p_id uuid,p_expected integer,p_status text,p_reason text) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('order',p_id) then raise exception 'Нет прав';end if;
 update public.service_orders set status=p_status,revision=revision+1 where id=p_id and revision=p_expected;
 if not found then raise exception 'Изменено другим пользователем';end if;return p_expected+1;
end$$;
create function public.service_order_transition(uuid,integer,text,text) returns integer language sql as $$select dlight_private.order_transition($1,$2,$3,$4)$$;
create function dlight_private.order_deadline_decide(p_request uuid,p_accept boolean,p_note text) returns integer language plpgsql security definer set search_path='' as $$
declare o public.service_orders;
begin
 select s.* into o from public.service_orders s join public.service_order_deadline_requests r on r.order_id=s.id where r.id=p_request;
 if public.user_role()<>'admin' and o.curator_id is distinct from auth.uid() then raise exception 'Чужой куратор';end if;
 update public.service_order_deadline_requests set status=case when p_accept then 'accepted' else 'declined' end where id=p_request;return 1;
end$$;
create function public.service_order_deadline_decide(uuid,boolean,text) returns integer language sql as $$select dlight_private.order_deadline_decide($1,$2,$3)$$;
create function public.trip_reschedule_decide(p_req uuid,p_ok boolean,p_note text) returns text language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('trip',(select trip_id from public.trip_reschedules where id=p_req)) then raise exception 'Нет прав';end if;
 update public.trip_reschedules set status=case when p_ok then 'accepted' else 'declined' end where id=p_req;return 'accepted';
end$$;
create function dlight_private.request_finance_approve(p_job uuid,p_ids uuid[]) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('job',p_job) then raise exception 'Нет прав';end if;
 update public.service_order_items set approved_at=now(),approved_by=auth.uid() where job_id=p_job and id=any(p_ids);return 1;
end$$;
create function public.job_request_finance_approve(uuid,uuid[]) returns integer language sql as $$select dlight_private.request_finance_approve($1,$2)$$;
create function public.trip_confirm(p_trip uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Нет прав';end if;
 update public.trips set status='done' where id=p_trip and status='finished';if not found then return 'wrong_status';end if;return 'done';
end$$;
create function public.trip_presence_save(p_trip uuid,p_expected integer,p_stays jsonb,p_reason text) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Нет прав';end if;return p_expected;
end$$;
create function public.trip_presence_save_tasks(uuid,integer,jsonb,text) returns integer language sql as $$select public.trip_presence_save($1,$2,$3,$4)$$;
create function public.trip_cost_allocation_save(p_trip uuid,p_expected integer,p_track_updated_at timestamptz,p_reason text,p_lines jsonb,p_diagnostics jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Нет прав';end if;return p_trip;
end$$;
create function public.stay_approve(p_stay uuid,p_minutes numeric default null) returns text language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Нет прав';end if;
 update public.trip_stays set status='approved',minutes_mgr=p_minutes,mgr_by=auth.uid() where id=p_stay;return 'approved';
end$$;
create function public.stay_reject(p_stay uuid,p_note text default '') returns text language plpgsql security definer set search_path='' as $$
declare s public.trip_stays;t public.trips;
begin
 select * into s from public.trip_stays where id=p_stay;select * into t from public.trips where id=s.trip_id;
 if not public.is_owner_or_mgr(t.lead_engineer) then raise exception 'Нет прав';end if;
 update public.trip_stays set status='rejected' where id=p_stay;return 'rejected';
end$$;

create table clients(id uuid primary key,name text,lat float8,lng float8);create table equipment(id uuid primary key,model text,lat float8,lng float8);
alter table jobs add column client_id uuid;alter table jobs add column equipment_id uuid;
create table trip_jobs(trip_id uuid,job_id uuid,ord integer);create table job_works(id uuid primary key,job_id uuid,hours numeric);

create table unassigned_tracks(id uuid primary key,state text default 'review',revision integer default 0,resolution jsonb,resolved_by uuid);
create function dlight_private.unassigned_quote(p_track uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Нет прав';end if;
 return jsonb_build_object('km',10,'rate',5,'points',2);
end$$;
create function public.unassigned_track_quote(uuid) returns jsonb language sql as $$select dlight_private.unassigned_quote($1)$$;
create function dlight_private.unassigned_resolve(p_track uuid,p_expected integer,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Нет прав';end if;
 update public.unassigned_tracks set state='charged',resolution=p_data,resolved_by=auth.uid(),revision=revision+1 where id=p_track and revision=p_expected;return '{}';
end$$;
create function public.unassigned_track_resolve(uuid,integer,text,jsonb) returns jsonb language sql as $$select dlight_private.unassigned_resolve($1,$2,$3,$4)$$;
create function dlight_private.unassigned_charge_cancel(p_track uuid,p_expected integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Нет прав';end if;
 update public.unassigned_tracks set state='review',resolution=null,resolved_by=auth.uid(),revision=revision+1 where id=p_track and revision=p_expected;
end$$;
create function public.unassigned_track_charge_cancel(uuid,integer,text) returns void language sql as $$select dlight_private.unassigned_charge_cancel($1,$2,$3)$$;
