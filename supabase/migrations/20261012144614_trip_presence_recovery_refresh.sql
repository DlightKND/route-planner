begin;
-- Preserve unchanged manager decisions and reject GPS disguised as a gap.
create or replace function dlight_private.validate_presence_evidence(p_trip uuid,p_to timestamptz,p_lat double precision,p_lng double precision,p_e jsonb) returns numeric
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
  if exists(select 1 from (
    select ts,lead(ts) over(order by ts) next_ts from public.vehicle_positions
    where trip_id=p_trip and ts between a and b and public.km_between(lat,lng,p_lat,p_lng)*1000<=rad
   ) samples where next_ts>ts and next_ts-ts<=interval '5 minutes') then
    raise exception 'Достройка перекрывает наблюдаемые GPS-интервалы';
  end if;
 end loop;
 previous_to:=null;
 for r in select x from (select value x from jsonb_array_elements(p_e->'gps_intervals') union all select value x from jsonb_array_elements(p_e->'recovery_parts')) q order by (x->>'from')::timestamptz loop
  a:=(r->>'from')::timestamptz;b:=(r->>'to')::timestamptz;if previous_to is not null and a<previous_to then raise exception 'Интервалы присутствия пересекаются';end if;previous_to:=b;
 end loop;
 return dlight_private.interval_minutes(p_e->'gps_intervals');
end $$;
create or replace function dlight_private.track_rebuild_save(p_trip uuid,p_expected integer,p_to timestamptz,p_digest text,p_track jsonb,p_fact_km numeric,p_fact_source text,p_fact_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips;old_track public.trip_tracks;proposal jsonb;e jsonb;old_stay public.trip_stays;ids uuid[]:='{}';sid uuid;gps numeric;site_lat double precision;site_lng double precision;jid uuid;
 a timestamptz;b timestamptz;changed integer:=0;key text;first_ts timestamptz;known_job boolean;old_observation jsonb;observed_valid boolean;keep_review boolean;next_intervals jsonb;
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
     -- A manager cannot reduce an already protected GPS observation by
     -- submitting a different reconstruction payload. Real corrected GPS may
     -- invalidate it; that change is audited and sent back to review.
     for old_observation in select value from jsonb_array_elements(coalesce(old_stay.presence_evidence->'gps_intervals','[]')) loop
      observed_valid:=true;
      begin
       perform dlight_private.validate_presence_evidence(p_trip,p_to,old_stay.lat,old_stay.lng,
        jsonb_build_object('version',1,'gps_intervals',jsonb_build_array(old_observation),'recovery_parts','[]'::jsonb));
      exception when others then observed_valid:=false;end;
      if observed_valid and not exists(select 1 from jsonb_array_elements(e->'gps_intervals') g
       where (g->>'from')::timestamptz<=(old_observation->>'from')::timestamptz and (g->>'to')::timestamptz>=(old_observation->>'to')::timestamptz) then
       raise exception 'Повторная достройка не может удалить достоверную GPS-часть';
      end if;
     end loop;
     keep_review:=false;
     if old_stay.status='approved' and old_stay.presence_evidence->'gps_intervals' is not distinct from e->'gps_intervals' then
      begin
       next_intervals:=dlight_private.presence_intervals(e,old_stay.recovery_acceptance);
       keep_review:=next_intervals is not distinct from old_stay.accepted_intervals;
      exception when others then keep_review:=false;end;
     end if;
     if keep_review then
      update public.trip_stays set presence_evidence=e,recovery_key=key where id=sid;changed:=changed+1;
     else
     insert into public.trip_revision_history(trip_id,revision,actor_id,reason,snapshot) values(p_trip,t.workbench_revision,auth.uid(),'Новые GPS-данные: нужна повторная проверка присутствия',jsonb_build_object('stays',jsonb_build_array(to_jsonb(old_stay))));
     update public.trip_stays set stay_from=a,stay_to=b,minutes_raw=round(gps)::int,presence_evidence=e,recovery_acceptance='{}',accepted_intervals=null,recovery_key=key,
      minutes_mgr=null,status='detected',note='Обновлён разбор трека; проверь восстановленное присутствие',mgr_at=null,mgr_by=null where id=sid;changed:=changed+1;
     end if;
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
commit;
