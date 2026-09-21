-- Review candidate. Apply on a staging clone before production.
begin;
create schema if not exists dlight_private;
revoke all on schema dlight_private from public, anon, authenticated;

alter table public.trips add column workbench_revision integer not null default 0;
alter table public.trips add column plan_baseline jsonb;
alter table public.trips add column remaining_route jsonb;
alter table public.trips add column plan_econ_snapshot jsonb;
alter table public.trip_stays add column crew_ids uuid[];
alter table public.trip_stays add column crew_source text not null default 'legacy_unverified';

create table public.trip_revision_history (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  revision integer not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid,
  reason text not null,
  snapshot jsonb not null
);
create index trip_revision_history_trip_idx on public.trip_revision_history(trip_id, revision desc);
alter table public.trip_revision_history enable row level security;
revoke all on public.trip_revision_history from public, anon, authenticated;
grant select on public.trip_revision_history to authenticated;
create policy trip_history_manager on public.trip_revision_history for select to authenticated
  using (coalesce((select public.user_role()),'') in ('admin','logist'));
revoke all on sequence public.trip_revision_history_id_seq from public, anon, authenticated;

create table public.trip_job_history (
  trip_id uuid not null references public.trips(id) on delete cascade,
  job_id uuid not null,
  removed_at timestamptz not null default now(),
  snapshot jsonb not null,
  primary key(trip_id,job_id)
);
alter table public.trip_job_history enable row level security;
revoke all on public.trip_job_history from public, anon, authenticated;
grant select on public.trip_job_history to authenticated;
create policy trip_job_history_manager on public.trip_job_history for select to authenticated
  using (coalesce((select public.user_role()),'') in ('admin','logist'));

create function dlight_private.trip_snapshot(p_trip public.trips) returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(p_trip) - array['plan_baseline'] || jsonb_build_object(
   'job_ids',coalesce((select jsonb_agg(job_id order by ord,job_id) from public.trip_jobs where trip_id=p_trip.id),'[]'::jsonb))
$$;
revoke all on function dlight_private.trip_snapshot(public.trips) from public,anon,authenticated;

create function dlight_private.audit_trip() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_snapshot jsonb; reason text;
begin
  if (to_jsonb(new)-array['plan_baseline']) is not distinct from
     (to_jsonb(old)-array['plan_baseline']) then return new; end if;
  old_snapshot := dlight_private.trip_snapshot(old);
  reason := coalesce(nullif(current_setting('dlight.change_reason',true),''),'Автоматическое событие / изменение данных');
  insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot)
    values(old.id,old.workbench_revision,auth.uid(),reason,old_snapshot);
  new.workbench_revision := old.workbench_revision+1;
  -- A pre-existing trip has no recoverable original plan. Label it honestly.
  if old.plan_baseline is null and (old.started_at is not null or new.started_at is not null) then
    new.plan_baseline := jsonb_build_object('source',case when old.started_at is null then 'before_execution' else 'legacy_at_first_edit' end,
      'captured_at',now(),'plan',old_snapshot);
  elsif old.plan_baseline is not null then new.plan_baseline := old.plan_baseline; end if;
  return new;
end $$;
revoke all on function dlight_private.audit_trip() from public,anon,authenticated;
create trigger zz_trip_revision before update on public.trips for each row execute function dlight_private.audit_trip();

create function dlight_private.audit_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
  if tg_op='DELETE' then
    tid := old.trip_id;
    if not exists(select 1 from public.trips where id=tid) then return old; end if;
    insert into public.trip_job_history(trip_id,job_id,snapshot)
      select old.trip_id,old.job_id,to_jsonb(j)||jsonb_build_object('client_name',c.name) from public.jobs j left join public.clients c on c.id=j.client_id where j.id=old.job_id
      on conflict(trip_id,job_id) do update set removed_at=now(),snapshot=excluded.snapshot;
  else tid := new.trip_id; end if;
  update public.trips set workbench_revision=workbench_revision+1 where id=tid;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dlight_private.audit_membership() from public,anon,authenticated;
create trigger aa_trip_membership_revision before insert or update or delete on public.trip_jobs
 for each row execute function dlight_private.audit_membership();

create function dlight_private.presence_crew() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.trips; saved jsonb;
begin
  if new.crew_ids is not null then return new; end if;
  select * into t from public.trips where id=new.trip_id;
  -- The first revision after the arrival contains the team in effect at arrival.
  select h.snapshot into saved from public.trip_revision_history h
    where h.trip_id=new.trip_id and h.recorded_at>=new.stay_from order by h.recorded_at,h.id limit 1;
  if saved is null then saved:=to_jsonb(t); end if;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into new.crew_ids
    from jsonb_array_elements_text(coalesce(saved->'engineer_ids','[]'::jsonb)) x;
  if cardinality(new.crew_ids)=0 and saved->>'lead_engineer' is not null then
    new.crew_ids:=array[(saved->>'lead_engineer')::uuid];
  end if;
  new.crew_source:=case when t.plan_baseline is null or t.plan_baseline->>'source'='legacy_at_first_edit'
    then 'legacy_unverified' else 'snapshot' end;
  if exists(select 1 from public.trip_revision_history h where h.trip_id=t.id
    and h.recorded_at>new.stay_from and h.recorded_at<coalesce(new.stay_to,now())
    and (h.snapshot->'engineer_ids' is distinct from saved->'engineer_ids'
      or to_jsonb(t.engineer_ids) is distinct from saved->'engineer_ids')) then
    new.crew_source:='legacy_unverified';
  end if;
  return new;
end $$;
revoke all on function dlight_private.presence_crew() from public,anon,authenticated;
create trigger trip_stay_crew before insert on public.trip_stays for each row execute function dlight_private.presence_crew();

create function public.trip_workbench_read(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.trips;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Доступ только менеджеру'; end if;
  select * into t from public.trips where id=p_trip and deleted_at is null;
  if not found then raise exception 'Выезд не найден'; end if;
  return jsonb_build_object('trip',to_jsonb(t),
    'job_ids',coalesce((select jsonb_agg(job_id order by ord,job_id) from public.trip_jobs where trip_id=p_trip),'[]'::jsonb),
    'stays',coalesce((select jsonb_agg(to_jsonb(s) order by s.stay_from) from public.trip_stays s where trip_id=p_trip),'[]'::jsonb),
    'removed',coalesce((select jsonb_agg(to_jsonb(h)) from public.trip_job_history h where h.trip_id=p_trip
       and not exists(select 1 from public.trip_jobs j where j.trip_id=p_trip and j.job_id=h.job_id)),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h)) from (select revision,recorded_at,reason,actor_id,snapshot from public.trip_revision_history
       where trip_id=p_trip order by id desc limit 100) h),'[]'::jsonb));
end $$;
revoke all on function public.trip_workbench_read(uuid) from public,anon,authenticated;
grant execute on function public.trip_workbench_read(uuid) to authenticated;

create function public.trip_plan_save(p_trip uuid,p_expected integer,p_plan jsonb,p_jobs uuid[],p_reason text,p_stays jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.trips; v public.trips; tid uuid; k text; jobs uuid[]:=coalesce(p_jobs,'{}');
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  if jsonb_typeof(p_plan) is distinct from 'object' then raise exception 'Некорректный план'; end if;
  for k in select jsonb_object_keys(p_plan) loop
    if k <> all(array['date_from','date_to','vehicle_id','vehicle_label','lead_engineer','engineer_ids','status','notes',
      'route_stops','route_geometry','overrides','econ_snapshot','tariffs_snapshot','main_job_id','road_km_by_payer','remaining_route']) then
      raise exception 'Поле % не относится к плану',k;
    end if;
  end loop;
  if p_trip is null then
    if p_expected is distinct from 0 then raise exception 'Неверная версия'; end if;
    insert into public.trips(created_by) values(auth.uid()) returning * into t;
  else
    select * into t from public.trips where id=p_trip and deleted_at is null for update;
    if not found then raise exception 'Выезд не найден'; end if;
    if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён в другой вкладке. Обнови карточку.' using errcode='40001'; end if;
    if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Укажи причину изменения'; end if;
  end if;
  tid:=t.id;
  select * into v from jsonb_populate_record(t,p_plan);
  if v.date_from is not null and v.date_to<v.date_from then raise exception 'Конец раньше начала'; end if;
  if v.status is distinct from t.status and v.status not in ('planned','assigned') then raise exception 'Изменение статуса выполняется отдельно от плана'; end if;
  if t.started_at is not null and v.status is distinct from t.status then raise exception 'Статус начатого выезда сохраняется'; end if;
  if t.started_at is not null and v.vehicle_id is distinct from t.vehicle_id then raise exception 'Смена автомобиля начатого выезда требует отдельного переназначения трека'; end if;
  if exists(select 1 from unnest(jobs) j where j is null or not exists(select 1 from public.jobs x where x.id=j and x.deleted_at is null and not coalesce(x.at_depot,false))) then raise exception 'Недоступная заявка'; end if;
  if cardinality(jobs)<>(select count(distinct j) from unnest(jobs) j) then raise exception 'Повтор заявки'; end if;
  if v.main_job_id is not null and not(v.main_job_id=any(jobs)) then raise exception 'Основная заявка должна входить в план'; end if;
  if t.started_at is not null and t.tariffs_snapshot is distinct from v.tariffs_snapshot then raise exception 'Ставки начатого выезда зафиксированы'; end if;
  perform set_config('dlight.change_reason',coalesce(nullif(btrim(p_reason),''),'Создание плана'),true);
  -- Snapshot before any membership edits, including the previous set of jobs.
  update public.trips set date_from=v.date_from,date_to=v.date_to,vehicle_id=v.vehicle_id,vehicle_label=v.vehicle_label,
    lead_engineer=v.lead_engineer,engineer_ids=v.engineer_ids,status=v.status,notes=v.notes,
    route_stops=v.route_stops,route_geometry=v.route_geometry,overrides=v.overrides,
    econ_snapshot=case when t.started_at is null then v.econ_snapshot else t.econ_snapshot end,
    plan_econ_snapshot=v.econ_snapshot,tariffs_snapshot=v.tariffs_snapshot,road_km_by_payer=v.road_km_by_payer,remaining_route=v.remaining_route,
    workbench_revision=workbench_revision+1 where id=tid;
  delete from public.trip_jobs where trip_id=tid and not(job_id=any(jobs));
  insert into public.trip_jobs(trip_id,job_id,ord)
    select tid,j,ord::integer-1 from unnest(jobs) with ordinality u(j,ord)
    on conflict(trip_id,job_id) do update set ord=excluded.ord where public.trip_jobs.ord is distinct from excluded.ord;
  -- Deleting the old main job fires a legacy trigger; set the new main last.
  update public.trips set main_job_id=v.main_job_id where id=tid and main_job_id is distinct from v.main_job_id;
  if t.plan_baseline is null and v.status='assigned' and t.started_at is null then
    update public.trips x set plan_baseline=jsonb_build_object('source','before_execution','captured_at',now(),'plan',dlight_private.trip_snapshot(x)) where id=tid;
  end if;
  if p_stays is not null then
    perform public.trip_presence_save(tid,(select workbench_revision from public.trips where id=tid),p_stays,p_reason);
  end if;
  return tid;
end $$;
revoke all on function public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function public.trip_plan_save(uuid,integer,jsonb,uuid[],text,jsonb) to authenticated;

create function public.trip_presence_save(p_trip uuid,p_expected integer,p_stays jsonb,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare t public.trips; s jsonb; crew uuid[]; mins numeric; sid uuid; jid uuid; result integer;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Изменяет только менеджер'; end if;
  if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Укажи причину проверки'; end if;
  select * into t from public.trips where id=p_trip and deleted_at is null for update;
  if not found then raise exception 'Выезд не найден'; end if;
  if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён. Обнови карточку.' using errcode='40001'; end if;
  if jsonb_typeof(p_stays) is distinct from 'array' then raise exception 'Некорректное присутствие'; end if;
  perform set_config('dlight.change_reason',p_reason,true);
  -- Audit old presence alongside the trip; raw telemetry is never edited.
  insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot)
    select p_trip,t.workbench_revision,auth.uid(),p_reason,jsonb_build_object('stays',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb))
    from public.trip_stays x where x.trip_id=p_trip;
  for s in select value from jsonb_array_elements(p_stays) loop
    sid:=(s->>'id')::uuid; jid:=nullif(s->>'job_id','')::uuid;
    if not exists(select 1 from public.trip_stays where id=sid and trip_id=p_trip) then raise exception 'Чужая стоянка'; end if;
    if coalesce(s->>'status','') not in ('approved','rejected') then raise exception 'Нужен результат проверки каждой стоянки'; end if;
    select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into crew from jsonb_array_elements_text(coalesce(s->'crew_ids','[]'::jsonb)) x;
    mins:=(s->>'minutes_mgr')::numeric;
    if s->>'status'='approved' then
      if jid is null or not(exists(select 1 from public.trip_jobs where trip_id=p_trip and job_id=jid)
        or exists(select 1 from public.trip_job_history where trip_id=p_trip and job_id=jid)) then raise exception 'Заявка не относится к выезду'; end if;
      if cardinality(crew)=0 or exists(select 1 from unnest(crew) c where not exists(select 1 from public.profiles where id=c)) then raise exception 'Проверь состав команды'; end if;
      if mins is null or mins::text in ('NaN','Infinity','-Infinity') or mins<0 or exists(select 1 from public.trip_stays
        where id=sid and (stay_to is null or mins>extract(epoch from(stay_to-stay_from))/60+1)) then raise exception 'Проверь длительность'; end if;
    end if;
    update public.trip_stays set job_id=jid,minutes_mgr=mins,status=s->>'status',crew_ids=crew,crew_source='manager',
      mgr_by=auth.uid(),mgr_at=now(),note=p_reason where id=sid;
  end loop;
  if exists(select 1 from public.trip_stays a join public.trip_stays b on a.id<b.id and a.trip_id=b.trip_id
     where a.trip_id=p_trip and a.status='approved' and b.status='approved' and a.crew_ids && b.crew_ids
       and a.stay_from<b.stay_to and b.stay_from<a.stay_to) then raise exception 'Пересечение присутствия одного инженера'; end if;
  update public.trips set workbench_revision=workbench_revision+1 where id=p_trip returning workbench_revision into result;
  return result;
end $$;
revoke all on function public.trip_presence_save(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.trip_presence_save(uuid,integer,jsonb,text) to authenticated;

create function public.trip_presence_detect(p_trip uuid,p_expected integer) returns integer
language plpgsql security definer set search_path='' as $$
declare t public.trips; n integer;
begin
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Доступ только менеджеру'; end if;
  select * into t from public.trips where id=p_trip and deleted_at is null for update;
  if not found then raise exception 'Выезд не найден'; end if;
  if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён. Обнови карточку.' using errcode='40001'; end if;
  perform set_config('dlight.change_reason','Обновление стоянок по GPS',true);
  n:=public.trip_detect_stays(p_trip);
  update public.trips set workbench_revision=workbench_revision+1 where id=p_trip;
  return n;
end $$;
revoke all on function public.trip_presence_detect(uuid,integer) from public,anon,authenticated;
grant execute on function public.trip_presence_detect(uuid,integer) to authenticated;

create function dlight_private.presence_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.trips set workbench_revision=workbench_revision+1 where id=coalesce(new.trip_id,old.trip_id);
  return null;
end $$;
revoke all on function dlight_private.presence_changed() from public,anon,authenticated;
create trigger zz_presence_revision after insert or update or delete on public.trip_stays
  for each row execute function dlight_private.presence_changed();

create or replace function public.trip_detect_stays(p_trip uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare rad numeric; minm numeric; t trips; r record; jp record; best uuid; bestd double precision; d double precision; fin timestamptz; mins integer; n integer:=0;
begin
  -- Service-trigger calls have no auth.uid(); client calls require a live role.
  if auth.uid() is not null and coalesce(public.user_role(),'') not in ('admin','logist','engineer') then raise exception 'Нет доступа'; end if;
  select * into t from trips where id=p_trip and deleted_at is null;
  if not found then return 0; end if;
  if auth.uid() is not null and coalesce(public.user_role(),'')='engineer'
    and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false) then raise exception 'Чужой выезд'; end if;
  select coalesce(stay_radius_m,300),coalesce(stay_min_minutes,10) into rad,minm from settings where id=true;
  fin:=coalesce(t.finished_at,now());
  for r in select * from trip_stays_raw where trip_id=p_trip loop
    mins:=round(extract(epoch from(coalesce(r.stay_to,fin)-r.stay_from))/60);
    if mins is null or mins<minm then continue; end if;
    best:=null;bestd:=null;
    for jp in
      select candidates.job_id,p.lat,p.lng from (
        select job_id from trip_jobs where trip_id=p_trip
        union select job_id from trip_job_history where trip_id=p_trip and removed_at>=r.stay_from
      ) candidates cross join lateral public.job_point(candidates.job_id) p where p.lat is not null
    loop
      d:=public.km_between(r.lat,r.lng,jp.lat,jp.lng)*1000;
      if d<=rad and (bestd is null or d<bestd) then bestd:=d;best:=jp.job_id;end if;
    end loop;
    insert into trip_stays(trip_id,job_id,vehicle_id,stay_from,stay_to,lat,lng,dist_m,minutes_raw,status)
      values(p_trip,best,t.vehicle_id,r.stay_from,coalesce(r.stay_to,t.finished_at),r.lat,r.lng,round(bestd)::integer,mins,'detected')
      on conflict(trip_id,stay_from) do update set stay_to=excluded.stay_to,minutes_raw=excluded.minutes_raw,
        job_id=coalesce(trip_stays.job_id,excluded.job_id),dist_m=coalesce(trip_stays.dist_m,excluded.dist_m),
        crew_source=case when excluded.crew_source='legacy_unverified' then excluded.crew_source else trip_stays.crew_source end
      where trip_stays.status='detected';
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.trip_detect_stays(uuid) from public,anon,authenticated;
grant execute on function public.trip_detect_stays(uuid) to authenticated;

create or replace function public.trip_fact_hours(p_trip uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare t public.trips;
begin
  select * into t from public.trips where id=p_trip and deleted_at is null;
  if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist','engineer') then raise exception 'Нет доступа'; end if;
  if coalesce(public.user_role(),'')='engineer' and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false) then raise exception 'Чужой выезд'; end if;
  if t.id is null or not exists(select 1 from public.trip_stays where trip_id=p_trip) then return null; end if;
  if exists(select 1 from public.trip_stays s where trip_id=p_trip and status<>'rejected' and
    (status<>'approved' or job_id is null or minutes_mgr is null or minutes_mgr<0 or coalesce(cardinality(crew_ids),0)=0 or crew_source not in ('snapshot','manager'))) then return null; end if;
  return (select round(coalesce(sum(minutes_mgr*cardinality(crew_ids)),0)/60,2) from public.trip_stays where trip_id=p_trip and status='approved' and job_id is not null);
end $$;
revoke all on function public.trip_fact_hours(uuid) from public,anon,authenticated;
grant execute on function public.trip_fact_hours(uuid) to authenticated;

create or replace function public.trip_fact_hours_by_job(p_trip uuid) returns table(job_id uuid,hours numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.trip_fact_hours(p_trip) is null then return; end if;
  return query select s.job_id,round(sum(s.minutes_mgr*cardinality(s.crew_ids))/60,2)
    from public.trip_stays s where s.trip_id=p_trip and s.status='approved' and s.job_id is not null group by s.job_id;
end $$;
revoke all on function public.trip_fact_hours_by_job(uuid) from public,anon,authenticated;
grant execute on function public.trip_fact_hours_by_job(uuid) to authenticated;

-- All linked stays retain their job_id when membership is removed.
-- Legacy raw durations are NOT multiplied by today's crew during migration.
notify pgrst,'reload schema';
commit;
