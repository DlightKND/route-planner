begin;
-- Raw point-to-point distance is not an approved fact. In the old SQL,
-- LEAST(1, SQRT(NULL)) became 1 for the first point and added 20,015 km.
-- A closing engineer leaves GPS mileage pending manager validation.
create or replace function public.trip_fact_km(p_trip uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select round(t.fact_km,1) from public.trips t
 where t.id=p_trip and t.deleted_at is null and t.fact_km>=0
 and t.fact_km::text not in ('NaN','Infinity','-Infinity')
 and t.fact_km_source in ('track','odometer')
 and (t.fact_km_source='odometer' or t.status in ('finished','done'))
 and auth.uid() is not null and public.user_role() is not null
 and (dlight_private.responsibility_manager('trip',p_trip) or public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids))
$$;
revoke all on function public.trip_fact_km(uuid) from public,anon;
grant execute on function public.trip_fact_km(uuid) to authenticated;

create or replace function public.trip_finish(p_trip uuid)
returns text language plpgsql security definer set search_path='' as $$
declare t public.trips;km numeric;
begin
 begin
  select * into t from public.trips where id=p_trip and deleted_at is null for update nowait;
 exception when lock_not_available then return 'busy';end;
 if not found then return 'not_found';end if;
 if not coalesce(public.user_role() is not null and (dlight_private.responsibility_manager('trip',p_trip) or public.is_owner_or_mgr(t.lead_engineer) or auth.uid()=any(t.engineer_ids)),false) then raise exception 'Это не ваш выезд';end if;
 if t.status<>'in_progress' then return 'wrong_status';end if;
 perform set_config('dlight.via_rpc','1',true);
 km:=public.trip_fact_km(p_trip);
 update public.trips set status='finished',finished_at=greatest(t.started_at,coalesce((select finish_candidate_at from public.trip_tracking_sessions where trip_id=p_trip and state='finish_candidate'),now())),
  fact_km=km,fact_km_source=case when km is not null then t.fact_km_source end,
  fact_km_note=case when km is not null then t.fact_km_note else 'Пробег ожидает проверки GPS-трека или ввода одометра' end where id=p_trip;
 perform public.trip_detect_stays(p_trip);
 return 'finished';
end $$;
revoke all on function public.trip_finish(uuid) from public,anon;
grant execute on function public.trip_finish(uuid) to authenticated;

-- Closing a trip must not send an unreviewed legacy total into the odometer.
create or replace function public.trip_confirm(p_trip uuid)
returns text language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
 if auth.uid() is null or not coalesce(dlight_private.responsibility_manager('trip',p_trip),false) then raise exception 'Подтверждает только менеджер';end if;
 select * into t from public.trips where id=p_trip and deleted_at is null for update;
 if not found then return 'not_found';end if;
 if t.status<>'finished' then return 'wrong_status';end if;
 if t.fact_km is null or t.fact_km<0 or t.fact_km::text in ('NaN','Infinity','-Infinity')
  or t.fact_km_source is null or t.fact_km_source not in ('track','odometer') then
  raise exception 'Сначала проверь и дострой GPS-трек либо укажи пробег по одометру';
 end if;
 perform set_config('dlight.via_rpc','1',true);
 update public.trips set status='done' where id=p_trip;
 return 'done';
end $$;
revoke all on function public.trip_confirm(uuid) from public,anon;
grant execute on function public.trip_confirm(uuid) to authenticated;

create or replace function dlight_private.track_rebuild_save(p_trip uuid,p_expected integer,p_to timestamptz,p_digest text,p_track jsonb,p_fact_km numeric,p_fact_source text,p_fact_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips;old_track public.trip_tracks;proposal jsonb;e jsonb;old_stay public.trip_stays;ids uuid[]:='{}';sid uuid;gps numeric;site_lat double precision;site_lng double precision;jid uuid;
 a timestamptz;b timestamptz;changed integer:=0;key text;first_ts timestamptz;known_job boolean;old_observation jsonb;observed_valid boolean;keep_review boolean;next_intervals jsonb;track_km numeric;segment_km numeric;fact_changed boolean:=false;
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then raise exception 'Проверяет трек только менеджер выезда';end if;
 select * into t from public.trips where id=p_trip and deleted_at is null for update;if not found then raise exception 'Выезд не найден';end if;
 if p_to is null or p_digest is distinct from dlight_private.trip_position_digest(p_trip,p_to) then raise exception 'GPS-данные обновились. Повтори проверку трека' using errcode='40001';end if;
 if jsonb_typeof(p_track) is distinct from 'object' or jsonb_typeof(p_track->'segments') is distinct from 'array' or (p_track->'presence'->>'version')::int is distinct from 1 then raise exception 'Некорректный разбор трека';end if;
 if p_track->'presence'->>'source_digest' is distinct from p_digest or (p_track->'presence'->>'source_to')::timestamptz is distinct from p_to then raise exception 'Разбор не относится к снимку GPS';end if;
 -- A track-only save from an older client must also refresh GPS mileage.
 -- Explicit odometer readings remain authoritative during attendance review.
 track_km:=(p_track->>'km')::numeric;
 if track_km is null or track_km::text in ('NaN','Infinity','-Infinity') or track_km<0 then raise exception 'Некорректный пробег трека';end if;
 if exists(select 1 from jsonb_array_elements(p_track->'segments') s where jsonb_typeof(s->'km') is distinct from 'number' or (s->>'km')::numeric<0 or coalesce(s->>'kind','') not in ('track','road','line')) then raise exception 'Некорректные отрезки трека';end if;
 select coalesce(sum((s->>'km')::numeric),0) into segment_km from jsonb_array_elements(p_track->'segments') s;
 if abs(track_km-segment_km)>0.000001 then raise exception 'Итог пробега не совпадает с отрезками трека';end if;
 if p_fact_km is null and t.fact_km_source is distinct from 'odometer'
  and coalesce((p_track->'presence'->>'usable')::boolean,false)
  and coalesce(p_track->>'verdict','')<>'' and p_track->>'verdict' not like 'трек недостоверен%' then
  p_fact_km:=round(track_km,1);p_fact_source:='track';p_fact_note:='Проверенный GPS-трек с достройкой по дорогам';
 end if;
 if p_fact_km is not null and (p_fact_km::text in ('NaN','Infinity','-Infinity') or p_fact_km<0 or p_fact_source is null or p_fact_source not in ('track','odometer')) then raise exception 'Некорректный факт-пробег';end if;
 if p_fact_source='track' and (not coalesce((p_track->'presence'->>'usable')::boolean,false)
  or coalesce(p_track->>'verdict','')='' or p_track->>'verdict' like 'трек недостоверен%'
  or p_fact_km is distinct from round(track_km,1)) then raise exception 'Факт-пробег должен совпадать с проверенным треком';end if;
 fact_changed:=p_fact_km is not null and (t.fact_km is distinct from p_fact_km or t.fact_km_source is distinct from p_fact_source);
 select * into old_track from public.trip_tracks where trip_id=p_trip;
 -- A network retry must not reset a manager's reviewed presence.
 if old_track.data-'at' is not distinct from p_track-'at' and (p_fact_km is null or (t.fact_km=p_fact_km and t.fact_km_source=p_fact_source)) then
  return jsonb_build_object('revision',t.workbench_revision,'stays_changed',0,'repeated',true,'fact_updated',false);
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
 return jsonb_build_object('revision',t.workbench_revision,'stays_changed',changed,'repeated',false,'fact_updated',fact_changed);
end $$;

commit;
