begin;
-- No historical backfill: evidence becomes protected during an explicit rebuild.
alter table public.trip_stays add column presence_evidence jsonb;
alter table public.trip_stays add column recovery_acceptance jsonb not null default '{}';
alter table public.trip_stays add column accepted_intervals jsonb;
alter table public.trip_stays add column recovery_key text;
create unique index trip_stays_recovery_key_idx on public.trip_stays(trip_id,recovery_key) where recovery_key is not null;

create function dlight_private.trip_position_digest(p_trip uuid,p_to timestamptz) returns text
language sql stable set search_path='' as $$
 select md5(coalesce(string_agg(p.ts::text||':'||p.lat::text||':'||p.lng::text,'|' order by p.ts,p.id),''))
 from public.vehicle_positions p where p.trip_id=p_trip and p.ts<=p_to and p.lat is not null and p.lng is not null
$$;
revoke all on function dlight_private.trip_position_digest(uuid,timestamptz) from public,anon,authenticated;

create function dlight_private.track_rebuild_context(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.trips; last_ts timestamptz; first_ts timestamptz;
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Проверяет трек только менеджер выезда';end if;
 select * into t from public.trips where id=p_trip and deleted_at is null;if not found then raise exception 'Выезд не найден';end if;
 select min(ts),max(ts) into first_ts,last_ts from public.vehicle_positions where trip_id=p_trip and lat is not null and lng is not null;
 return jsonb_build_object('trip',to_jsonb(t),'source_from',first_ts,'source_to',last_ts,'source_digest',dlight_private.trip_position_digest(p_trip,last_ts),
  'stops',coalesce((select jsonb_agg(jsonb_build_object('job_id',ids.job_id,'lat',p.lat,'lng',p.lng,'name',coalesce(c.name,'Объект')) order by ids.job_id)
   from (select job_id from public.trip_jobs where trip_id=p_trip union select job_id from public.trip_job_history where trip_id=p_trip) ids
   cross join lateral public.job_point(ids.job_id) p join public.jobs j on j.id=ids.job_id left join public.clients c on c.id=j.client_id where p.lat is not null and p.lng is not null),'[]'::jsonb));
end $$;
revoke all on function dlight_private.track_rebuild_context(uuid) from public,anon,authenticated;
grant execute on function dlight_private.track_rebuild_context(uuid) to authenticated;
create function public.trip_track_rebuild_context(p_trip uuid) returns jsonb language sql security invoker set search_path='' as $$select dlight_private.track_rebuild_context(p_trip)$$;
revoke all on function public.trip_track_rebuild_context(uuid) from public,anon,authenticated;
grant execute on function public.trip_track_rebuild_context(uuid) to authenticated;

create function dlight_private.presence_intervals(p_e jsonb,p_a jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb; rows jsonb:=coalesce(p_e->'gps_intervals','[]'); a timestamptz;b timestamptz;n numeric;cap numeric;k text;
begin
 if jsonb_typeof(p_a) is distinct from 'object' then raise exception 'Укажи длительность каждой достройки';end if;
 for k in select jsonb_object_keys(p_a) loop
  if not exists(select 1 from jsonb_array_elements(coalesce(p_e->'recovery_parts','[]')) x where x->>'key'=k) then raise exception 'Чужой участок достройки';end if;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_e->'recovery_parts','[]')) loop
  a:=(r->>'from')::timestamptz;b:=(r->>'to')::timestamptz;cap:=round(extract(epoch from(b-a))/60,3);n:=coalesce((p_a->>(r->>'key'))::numeric,0);
  if n::text in ('NaN','Infinity','-Infinity') or n<0 or n>cap then raise exception 'Меняется только восстановленная часть: от 0 до % мин',cap;end if;
  if n>0 then
   if r->>'side'='before' then a:=greatest(a,b-make_interval(secs=>(n*60)::double precision));else b:=least(b,a+make_interval(secs=>(n*60)::double precision));end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('from',a,'to',b));
  end if;
 end loop;
 return rows;
end $$;
revoke all on function dlight_private.presence_intervals(jsonb,jsonb) from public,anon,authenticated;

create function dlight_private.interval_minutes(p_rows jsonb) returns numeric language sql immutable set search_path='' as $$
 select round(coalesce(sum(extract(epoch from((x->>'to')::timestamptz-(x->>'from')::timestamptz))/60),0),3) from jsonb_array_elements(coalesce(p_rows,'[]')) x
$$;
revoke all on function dlight_private.interval_minutes(jsonb) from public,anon,authenticated;

-- Validate immutable observations against actual samples. Long holes do not
-- become GPS merely because their endpoints are near the same object.
create function dlight_private.validate_presence_evidence(p_trip uuid,p_to timestamptz,p_lat double precision,p_lng double precision,p_e jsonb) returns numeric
language plpgsql stable set search_path='' as $$
declare r jsonb;a timestamptz;b timestamptz;previous_to timestamptz;rad numeric;cnt integer;max_gap interval;g_from timestamptz;g_to timestamptz;
begin
 if coalesce((p_e->>'version')::integer,0)<>1 or jsonb_typeof(p_e->'gps_intervals') is distinct from 'array' or jsonb_typeof(p_e->'recovery_parts') is distinct from 'array'
  or jsonb_array_length(p_e->'gps_intervals')>1000 or jsonb_array_length(p_e->'recovery_parts')>100 then raise exception 'Некорректные интервалы присутствия';end if;
 if p_lat is null or p_lng is null or not(p_lat between -90 and 90 and p_lng between -180 and 180) then raise exception 'Некорректная точка объекта';end if;
 select coalesce(stay_radius_m,300) into rad from public.settings where id=true;
 for r in select value from jsonb_array_elements(p_e->'gps_intervals') loop
  a:=(r->>'from')::timestamptz;b:=(r->>'to')::timestamptz;
  if a is null or b is null or b<=a or b>p_to or (previous_to is not null and a<previous_to) then raise exception 'Некорректная GPS-часть стоянки';end if;
  if not exists(select 1 from public.vehicle_positions where trip_id=p_trip and ts=a and public.km_between(lat,lng,p_lat,p_lng)*1000<=rad)
   or not exists(select 1 from public.vehicle_positions where trip_id=p_trip and ts=b and public.km_between(lat,lng,p_lat,p_lng)*1000<=rad) then raise exception 'GPS-границы не подтверждены сообщениями';end if;
  select count(*),max(delta) into cnt,max_gap from (
   select ts-lag(ts) over(order by ts) delta from public.vehicle_positions where trip_id=p_trip and ts between a and b and public.km_between(lat,lng,p_lat,p_lng)*1000<=rad
  ) q;
  if cnt<2 or max_gap>interval '5 minutes' then raise exception 'Потеря навигации не является достоверной GPS-стоянкой';end if;
  previous_to:=b;
 end loop;
 if (select count(distinct x->>'key') from jsonb_array_elements(p_e->'recovery_parts') x)<>jsonb_array_length(p_e->'recovery_parts') then raise exception 'Повтор участка достройки';end if;
 for r in select value from jsonb_array_elements(p_e->'recovery_parts') loop
  a:=(r->>'from')::timestamptz;b:=(r->>'to')::timestamptz;g_from:=(r->>'gap_from')::timestamptz;g_to:=(r->>'gap_to')::timestamptz;
  if a is null or b is null or g_from is null or g_to is null or b<=a or a<g_from or b>g_to or g_to>p_to or g_to-g_from<=interval '5 minutes'
   or coalesce(r->>'side','') not in ('before','after','between','island') or length(coalesce(r->>'key','')) not between 1 and 500 then raise exception 'Некорректный участок потери навигации';end if;
  if not exists(select 1 from public.vehicle_positions p where p.trip_id=p_trip and p.ts=g_from and p.lat=(r->'anchor_from'->>'lat')::float8 and p.lng=(r->'anchor_from'->>'lng')::float8)
   or not exists(select 1 from public.vehicle_positions p where p.trip_id=p_trip and p.ts=g_to and p.lat=(r->'anchor_to'->>'lat')::float8 and p.lng=(r->'anchor_to'->>'lng')::float8) then raise exception 'Опоры достройки не подтверждены GPS';end if;
 end loop;
 previous_to:=null;
 for r in select x from (select value x from jsonb_array_elements(p_e->'gps_intervals') union all select value x from jsonb_array_elements(p_e->'recovery_parts')) q order by (x->>'from')::timestamptz loop
  a:=(r->>'from')::timestamptz;b:=(r->>'to')::timestamptz;if previous_to is not null and a<previous_to then raise exception 'Интервалы присутствия пересекаются';end if;previous_to:=b;
 end loop;
 return dlight_private.interval_minutes(p_e->'gps_intervals');
end $$;
revoke all on function dlight_private.validate_presence_evidence(uuid,timestamptz,float8,float8,jsonb) from public,anon,authenticated;

create function dlight_private.guard_presence_recovery() returns trigger language plpgsql set search_path='' as $$
declare gps numeric;cap numeric;actual numeric;
begin
 if tg_op='UPDATE' and old.presence_evidence is not null and current_user in ('authenticated','anon') and
  (new.presence_evidence is distinct from old.presence_evidence or new.recovery_key is distinct from old.recovery_key or new.minutes_raw is distinct from old.minutes_raw
   or new.stay_from is distinct from old.stay_from or new.stay_to is distinct from old.stay_to or new.accepted_intervals is distinct from old.accepted_intervals) then raise exception 'GPS-часть изменяет только операция проверки трека';end if;
 if new.presence_evidence is null then return new;end if;
 gps:=dlight_private.interval_minutes(new.presence_evidence->'gps_intervals');cap:=gps+dlight_private.interval_minutes(new.presence_evidence->'recovery_parts');
 if new.minutes_mgr is not null and (new.minutes_mgr::text in ('NaN','Infinity','-Infinity') or new.minutes_mgr<gps or new.minutes_mgr>cap) then raise exception 'Достоверная GPS-часть % мин неизменяема; максимум % мин',gps,cap;end if;
 if new.status='approved' then
  if new.minutes_mgr is null or new.accepted_intervals is null then raise exception 'Подтверди восстановленные интервалы';end if;
  actual:=dlight_private.interval_minutes(dlight_private.presence_intervals(new.presence_evidence,new.recovery_acceptance));
  if abs(actual-new.minutes_mgr)>.001 or new.accepted_intervals is distinct from dlight_private.presence_intervals(new.presence_evidence,new.recovery_acceptance) then raise exception 'Длительность не совпадает с подтверждёнными интервалами';end if;
 end if;
 return new;
end $$;
revoke all on function dlight_private.guard_presence_recovery() from public,anon,authenticated;
create trigger trip_stays_recovery_guard before insert or update on public.trip_stays for each row execute function dlight_private.guard_presence_recovery();

create function dlight_private.track_rebuild_save(p_trip uuid,p_expected integer,p_to timestamptz,p_digest text,p_track jsonb,p_fact_km numeric,p_fact_source text,p_fact_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips;old_track public.trip_tracks;proposal jsonb;e jsonb;old_stay public.trip_stays;ids uuid[]:='{}';sid uuid;gps numeric;site_lat double precision;site_lng double precision;jid uuid;
 a timestamptz;b timestamptz;changed integer:=0;key text;first_ts timestamptz;known_job boolean;
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Проверяет трек только менеджер выезда';end if;
 select * into t from public.trips where id=p_trip and deleted_at is null for update;if not found then raise exception 'Выезд не найден';end if;
 if p_to is null or p_digest is distinct from dlight_private.trip_position_digest(p_trip,p_to) then raise exception 'GPS-данные обновились. Повтори проверку трека' using errcode='40001';end if;
 if jsonb_typeof(p_track) is distinct from 'object' or jsonb_typeof(p_track->'segments') is distinct from 'array' or (p_track->'presence'->>'version')::int is distinct from 1 then raise exception 'Некорректный разбор трека';end if;
 if p_track->'presence'->>'source_digest' is distinct from p_digest or (p_track->'presence'->>'source_to')::timestamptz is distinct from p_to then raise exception 'Разбор не относится к снимку GPS';end if;
 if p_fact_km is not null and (p_fact_km::text in ('NaN','Infinity','-Infinity') or p_fact_km<0 or p_fact_source not in ('track','odometer')) then raise exception 'Некорректный факт-пробег';end if;
 select * into old_track from public.trip_tracks where trip_id=p_trip;
 -- A network retry must not reset a manager's reviewed presence.
 if old_track.data-'at' is not distinct from p_track-'at' and (p_fact_km is null or (t.fact_km=p_fact_km and t.fact_km_source=p_fact_source)) then
  return jsonb_build_object('revision',t.workbench_revision,'stays_changed',0,'repeated',true);
 end if;
 if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён. Обнови карточку.' using errcode='40001';end if;
 select min(ts) into first_ts from public.vehicle_positions where trip_id=p_trip and ts<=p_to and lat is not null and lng is not null;
 if old_track.data->'presence'->>'source_from' is not null and first_ts>(old_track.data->'presence'->>'source_from')::timestamptz then raise exception 'Исходный GPS-трек сохранён не полностью; прежний разбор оставлен';end if;
 perform set_config('dlight.change_reason','Проверка и достройка трека; предложения присутствия',true);
 if coalesce((p_track->'presence'->>'usable')::boolean,false) then
  if jsonb_typeof(p_track->'presence'->'stays') is distinct from 'array' or jsonb_array_length(p_track->'presence'->'stays')>1000 then raise exception 'Некорректные предложения стоянок';end if;
  for proposal in select value from jsonb_array_elements(p_track->'presence'->'stays') loop
   e:=proposal->'presence_evidence';site_lat:=(proposal->>'lat')::float8;site_lng:=(proposal->>'lng')::float8;jid:=nullif(proposal->>'job_id','')::uuid;key:=proposal->>'key';
   if length(coalesce(key,'')) not between 1 and 200 or jsonb_typeof(e->'job_ids') is distinct from 'array' then raise exception 'Некорректная привязка предложения';end if;
   if exists(select 1 from jsonb_array_elements_text(e->'job_ids') x where not exists(select 1 from public.trip_jobs where trip_id=p_trip and job_id=x::uuid) and not exists(select 1 from public.trip_job_history where trip_id=p_trip and job_id=x::uuid)) then raise exception 'Объект не относится к выезду';end if;
   select exists(select 1 from jsonb_array_elements_text(e->'job_ids') x cross join lateral public.job_point(x::uuid) p where public.km_between(site_lat,site_lng,p.lat,p.lng)<.001) into known_job;
   if not known_job or (jid is not null and not(e->'job_ids' @> jsonb_build_array(jid))) then raise exception 'Координаты объекта не подтверждены заявкой';end if;
   gps:=dlight_private.validate_presence_evidence(p_trip,p_to,site_lat,site_lng,e);
   select min((x->>'from')::timestamptz),max((x->>'to')::timestamptz) into a,b from (
    select value x from jsonb_array_elements(e->'gps_intervals') union all select value x from jsonb_array_elements(e->'recovery_parts')) ranges;
   if a is null or b is null or b<=a or (t.started_at is not null and a<t.started_at) or (t.finished_at is not null and b>t.finished_at) then raise exception 'Стоянка выходит за границы выезда';end if;
   select * into old_stay from public.trip_stays s where s.trip_id=p_trip and (s.recovery_key=key or
    (public.km_between(s.lat,s.lng,site_lat,site_lng)<.001 and s.stay_from<=b and coalesce(s.stay_to,s.stay_from)>=a)) order by (s.recovery_key=key) desc,s.created_at limit 1 for update;
   if old_stay.id is null then
    insert into public.trip_stays(trip_id,job_id,vehicle_id,lat,lng,stay_from,stay_to,minutes_raw,status,presence_evidence,recovery_key)
     values(p_trip,jid,t.vehicle_id,site_lat,site_lng,a,b,round(gps)::int,'detected',e,key) returning id into sid;changed:=changed+1;
   else
    sid:=old_stay.id;
    if old_stay.presence_evidence is distinct from e then
     insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot) values(p_trip,t.workbench_revision,auth.uid(),'Новые GPS-данные: нужна повторная проверка присутствия',jsonb_build_object('stays',jsonb_build_array(to_jsonb(old_stay))));
     update public.trip_stays set stay_from=a,stay_to=b,minutes_raw=round(gps)::int,presence_evidence=e,recovery_acceptance='{}',accepted_intervals=null,recovery_key=key,
      minutes_mgr=null,status='detected',note='Обновлён разбор трека; проверь восстановленное присутствие',mgr_at=null,mgr_by=null where id=sid;changed:=changed+1;
    end if;
   end if;
   if sid=any(ids) then raise exception 'Предложения стоянок пересекаются';end if;ids:=array_append(ids,sid);
  end loop;
  -- Withdraw obsolete zero-GPS hypotheses. Retained observed or historical
  -- attendance is not deleted or silently reclassified during a partial read.
  for old_stay in select * from public.trip_stays where trip_id=p_trip and presence_evidence is not null and not(id=any(ids)) and status<>'rejected' loop
   if dlight_private.interval_minutes(old_stay.presence_evidence->'gps_intervals')=0 then
    update public.trip_stays set status='rejected',minutes_mgr=0,recovery_acceptance='{}',accepted_intervals='[]',note='Предложение снято после повторной валидации трека' where id=old_stay.id;changed:=changed+1;
   end if;
  end loop;
 end if;
 insert into public.trip_tracks(trip_id,km,data,updated_at) values(p_trip,(p_track->>'km')::numeric,p_track,now())
  on conflict(trip_id) do update set km=excluded.km,data=excluded.data,updated_at=excluded.updated_at;
 if p_fact_km is not null then update public.trips set fact_km=p_fact_km,fact_km_source=p_fact_source,fact_km_note=p_fact_note where id=p_trip;end if;
 update public.trips set workbench_revision=workbench_revision+1 where id=p_trip returning workbench_revision into t.workbench_revision;
 return jsonb_build_object('revision',t.workbench_revision,'stays_changed',changed,'repeated',false);
end $$;
revoke all on function dlight_private.track_rebuild_save(uuid,integer,timestamptz,text,jsonb,numeric,text,text) from public,anon,authenticated;
grant execute on function dlight_private.track_rebuild_save(uuid,integer,timestamptz,text,jsonb,numeric,text,text) to authenticated;
create function public.trip_track_rebuild_save(p_trip uuid,p_expected integer,p_source_to timestamptz,p_source_digest text,p_track jsonb,p_fact_km numeric default null,p_fact_source text default null,p_fact_note text default null)
returns jsonb language sql security invoker set search_path='' as $$select dlight_private.track_rebuild_save(p_trip,p_expected,p_source_to,p_source_digest,p_track,p_fact_km,p_fact_source,p_fact_note)$$;
revoke all on function public.trip_track_rebuild_save(uuid,integer,timestamptz,text,jsonb,numeric,text,text) from public,anon,authenticated;
grant execute on function public.trip_track_rebuild_save(uuid,integer,timestamptz,text,jsonb,numeric,text,text) to authenticated;

-- The existing approval API and task-allocation transaction remain the entry
-- point. Only managed evidence changes how duration/intervals are validated.
create or replace function public.trip_presence_save(p_trip uuid,p_expected integer,p_stays jsonb,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare t public.trips;s jsonb;crew uuid[];mins numeric;sid uuid;jid uuid;result integer;original public.trip_stays;acceptance jsonb;intervals jsonb;gps numeric;a timestamptz;b timestamptz;
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Изменяет только менеджер';end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Укажи причину проверки';end if;
 select * into t from public.trips where id=p_trip and deleted_at is null for update;if not found then raise exception 'Выезд не найден';end if;
 if t.workbench_revision is distinct from p_expected then raise exception 'Выезд изменён. Обнови карточку.' using errcode='40001';end if;
 if jsonb_typeof(p_stays) is distinct from 'array' then raise exception 'Некорректное присутствие';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_stays) x)<>jsonb_array_length(p_stays) then raise exception 'Повтор стоянки';end if;
 perform set_config('dlight.change_reason',p_reason,true);
 insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot)
  select p_trip,t.workbench_revision,auth.uid(),p_reason,jsonb_build_object('stays',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) from public.trip_stays x where x.trip_id=p_trip;
 for s in select value from jsonb_array_elements(p_stays) loop
  sid:=(s->>'id')::uuid;jid:=nullif(s->>'job_id','')::uuid;select * into original from public.trip_stays where id=sid and trip_id=p_trip for update;if not found then raise exception 'Чужая стоянка';end if;
  if coalesce(s->>'status','') not in ('approved','rejected') then raise exception 'Нужен результат проверки каждой стоянки';end if;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into crew from jsonb_array_elements_text(coalesce(s->'crew_ids','[]'::jsonb)) x;
  mins:=(s->>'minutes_mgr')::numeric;acceptance:=original.recovery_acceptance;intervals:=original.accepted_intervals;a:=original.stay_from;b:=original.stay_to;
  if original.presence_evidence is not null then
   if s ? 'presence_evidence' or s ? 'gps_minutes' or s ? 'accepted_intervals' or s ? 'stay_from' or s ? 'stay_to' then raise exception 'GPS-часть и границы задаёт проверка трека';end if;
   gps:=dlight_private.interval_minutes(original.presence_evidence->'gps_intervals');
   if s ? 'recovery_acceptance' then acceptance:=s->'recovery_acceptance';
   elsif s->>'status'='approved' and mins is distinct from dlight_private.interval_minutes(dlight_private.presence_intervals(original.presence_evidence,acceptance)) then
    if jsonb_array_length(original.presence_evidence->'recovery_parts')=1 then acceptance:=jsonb_build_object(original.presence_evidence->'recovery_parts'->0->>'key',mins-gps);
    else raise exception 'Укажи длительность каждой восстановленной части';end if;
   end if;
   intervals:=dlight_private.presence_intervals(original.presence_evidence,acceptance);
   if s->>'status'='approved' and (mins is null or abs(mins-dlight_private.interval_minutes(intervals))>.001) then raise exception 'Итог должен включать всю достоверную GPS-часть и выбранные достройки';end if;
   if s->>'status'='approved' and jsonb_array_length(intervals)>0 then
    select min((x->>'from')::timestamptz),max((x->>'to')::timestamptz) into a,b from jsonb_array_elements(intervals) x;
   end if;
  end if;
  if s->>'status'='approved' then
   if jid is null or not(exists(select 1 from public.trip_jobs where trip_id=p_trip and job_id=jid) or exists(select 1 from public.trip_job_history where trip_id=p_trip and job_id=jid)) then raise exception 'Заявка не относится к выезду';end if;
   if cardinality(crew)=0 or exists(select 1 from unnest(crew) c where not exists(select 1 from public.profiles where id=c)) then raise exception 'Проверь состав команды';end if;
   if mins is null or mins::text in ('NaN','Infinity','-Infinity') or mins<0 or b is null or mins>extract(epoch from(b-a))/60+1 then raise exception 'Проверь длительность';end if;
  end if;
  update public.trip_stays set job_id=jid,minutes_mgr=mins,status=s->>'status',crew_ids=crew,crew_source='manager',mgr_by=auth.uid(),mgr_at=now(),note=p_reason,
   recovery_acceptance=acceptance,accepted_intervals=intervals,stay_from=a,stay_to=b where id=sid;
 end loop;
 if exists(select 1 from public.trip_stays a join public.trip_stays b on a.id<b.id and a.trip_id=b.trip_id where a.trip_id=p_trip and a.status='approved' and b.status='approved' and a.crew_ids && b.crew_ids
  and a.stay_from<b.stay_to and b.stay_from<a.stay_to) then raise exception 'Пересечение присутствия одного инженера';end if;
 update public.trips set workbench_revision=workbench_revision+1 where id=p_trip returning workbench_revision into result;return result;
end $$;
revoke all on function public.trip_presence_save(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.trip_presence_save(uuid,integer,jsonb,text) to authenticated;
CREATE OR REPLACE FUNCTION public.trip_detect_stays(p_trip uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rad numeric; minm numeric; t trips; r record; jp record; best uuid; bestd double precision; d double precision; fin timestamptz; mins integer; n integer:=0;
begin
  -- Service-trigger calls have no auth.uid(); client calls require a live role.
  if auth.uid() is not null and coalesce(public.user_role(),'') not in ('admin','logist','engineer') then raise exception 'Нет доступа'; end if;
  select * into t from trips where id=p_trip and deleted_at is null;
  if not found then return 0; end if;
  if auth.uid() is not null and coalesce(public.user_role(),'')='engineer'
    and not dlight_private.responsibility_manager('trip',p_trip) and not coalesce(auth.uid()=any(t.engineer_ids) or auth.uid()=t.lead_engineer,false) then raise exception 'Чужой выезд'; end if;
  select coalesce(stay_radius_m,300),coalesce(stay_min_minutes,10) into rad,minm from settings where id=true;
  -- Once rebuilt, the common operation owns observations and proposals.
  -- Legacy sparse-message detection must not reinsert a gap as measured GPS.
  if exists(select 1 from public.trip_tracks where trip_id=p_trip and data->'presence'->>'version'='1') then return 0; end if;
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
end $function$;


commit;
