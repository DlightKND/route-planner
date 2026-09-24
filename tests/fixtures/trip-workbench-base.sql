-- Minimal pre-migration schema contract. No production data or credentials.
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table profiles(id uuid primary key,role text,active boolean default true);
create function user_role() returns text language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() and active $$;
create table clients(id uuid primary key,name text,lat float8,lng float8);
create type public.job_status as enum('open','planned','in_progress','done','cancelled');
create table jobs(id uuid primary key default gen_random_uuid(),client_id uuid references clients(id),equipment_id uuid,
  scheduled_date date,time_window text,due_date date,assigned_engineer uuid,engineer_ids uuid[] not null default '{}',
  notes text,at_depot boolean default false,depot_id uuid,deleted_at timestamptz,created_by uuid);
create type trip_status as enum('planned','assigned','in_progress','finished','done','cancelled');
create table trips(id uuid primary key default gen_random_uuid(),date_from date,date_to date,vehicle_id uuid,vehicle_label text,
  lead_engineer uuid,engineer_ids uuid[] default '{}',status trip_status default 'planned',notes text,route_stops jsonb default '[]',route_geometry jsonb,
  overrides jsonb default '{}',econ_snapshot jsonb default '{}',tariffs_snapshot jsonb default '{}',main_job_id uuid,road_km_by_payer jsonb,
  started_at timestamptz,finished_at timestamptz,fact_km numeric,deleted_at timestamptz,created_by uuid,created_at timestamptz default now());
create table trip_jobs(trip_id uuid references trips(id) on delete cascade,job_id uuid references jobs(id),ord integer,primary key(trip_id,job_id));
create function clear_main() returns trigger language plpgsql set search_path=public as $$ begin update trips set main_job_id=null where id=old.trip_id and main_job_id=old.job_id;return null;end $$;
create trigger trip_jobs_clear_main after delete on trip_jobs for each row execute function clear_main();
create table trip_stays(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),job_id uuid references jobs(id),vehicle_id uuid,
  stay_from timestamptz,stay_to timestamptz,minutes_raw integer,minutes_mgr numeric,minutes_eng numeric,status text default 'detected',lat float8,lng float8,dist_m integer,
  note text,mgr_by uuid,mgr_at timestamptz,unique(trip_id,stay_from));
create table vehicle_positions(id integer primary key,trip_id uuid,ts timestamptz,lat float8,lng float8);
create table settings(id boolean primary key,stay_radius_m numeric,stay_min_minutes numeric);
insert into settings values(true,300,10);
create table trip_stays_raw(trip_id uuid,stay_from timestamptz,stay_to timestamptz,lat float8,lng float8);
create function job_point(p_job uuid) returns table(lat float8,lng float8) language sql as $$ select c.lat,c.lng from clients c join jobs j on j.client_id=c.id where j.id=p_job $$;
create function km_between(a float8,b float8,c float8,d float8) returns float8 language sql as $$ select sqrt(power(a-c,2)+power(b-d,2))*111 $$;
create function trip_detect_stays(uuid) returns integer language sql as $$ select 0 $$;
grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid(),user_role() to authenticated,anon;
