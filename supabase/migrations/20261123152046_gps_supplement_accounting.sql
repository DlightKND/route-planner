create function dlight_private.gps_supplement_preview(p_track uuid,p_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.unassigned_tracks; trip public.trips; snapshot jsonb; additions jsonb; excluded integer; digest text;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist')
    or dlight_private.responsibility_manager('trip',p_trip) is not true then
  raise exception 'Трек проверяет диспетчер выезда';
 end if;
 select * into source from public.unassigned_tracks where id=p_track and trip_id=p_trip and state='linked'
  and resolution->>'link_mode'='supplement';
 if not found then raise exception 'Дополнительная GPS-запись не относится к выезду'; end if;
 select * into trip from public.trips where id=p_trip and deleted_at is null;
 if not found or trip.status not in ('finished','done') or trip.vehicle_id is distinct from source.vehicle_id
    or trip.started_at is null or trip.finished_at is null or trip.started_at>=trip.finished_at then
  raise exception 'Учитывать дополнительный GPS можно после завершения выезда с указанными фактическими датами';
 end if;
 if source.resolution?'accounting' then return jsonb_build_object('already',true); end if;
 if dlight_private.trip_gps_no_work_current(p_trip) then
  raise exception 'Для выезда подтверждено отсутствие работ. Сначала уточните это решение';
 end if;
 snapshot:=dlight_private.track_rebuild_context(p_trip);
 if exists(select 1 from dlight_private.unassigned_points(p_track) p
    join public.vehicle_positions v on v.vehicle_id=p.vehicle_id and v.ts=p.ts
    where p.ts between trip.started_at and trip.finished_at and v.trip_id is not null and v.trip_id<>p_trip) then
  raise exception 'Часть GPS уже относится к другому выезду';
 end if;
 with input as materialized (
  select p.*,v.id as present_id,v.trip_id as current_trip
  from dlight_private.unassigned_points(p_track) p
  left join public.vehicle_positions v on v.vehicle_id=p.vehicle_id and v.ts=p.ts
 ), valid as (
  select * from input p where p.ts between trip.started_at and trip.finished_at
   and p.lat between -90 and 90 and p.lng between -180 and 180 and p.current_trip is null
 )
 select coalesce((select jsonb_agg(jsonb_build_object('ts',ts,'lat',lat,'lng',lng,'status',status,'speed',speed)
                          order by ts,part) from valid),'[]'::jsonb),
  (select count(*) from input where ts<trip.started_at or ts>trip.finished_at)
 into additions,excluded;
 if jsonb_array_length(additions)=0 then raise exception 'В этой записи нет новых GPS-точек в пределах выезда'; end if;
 select md5(coalesce(jsonb_agg(jsonb_build_array(ts,lat,lng,status) order by ts,id),'[]'::jsonb)::text)
 into digest from public.vehicle_positions where trip_id=p_trip;
 return snapshot||jsonb_build_object('id',p_track,'extra',additions,'outside',excluded,
   'extra_digest',md5(additions::text),'before_digest',digest,'source_revision',source.revision);
end $$;

create function dlight_private.gps_supplement_apply(
 p_track uuid,p_trip uuid,p_trip_revision integer,p_source_revision integer,p_before_digest text,p_extra_digest text,p_track_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.unassigned_tracks; trip public.trips; preview jsonb; answer jsonb; receipt jsonb;
 points_added integer; first_ts timestamptz; last_ts timestamptz; new_digest text;
 old_approved jsonb; new_approved jsonb; road_before jsonb; road_after jsonb;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist')
    or dlight_private.responsibility_manager('trip',p_trip) is not true then
  raise exception 'Трек проверяет диспетчер выезда';
 end if;
 select * into source from public.unassigned_tracks where id=p_track and trip_id=p_trip and state='linked'
  and resolution->>'link_mode'='supplement' for update;
 if not found then raise exception 'Дополнительная GPS-запись не относится к выезду'; end if;
 select * into trip from public.trips where id=p_trip and deleted_at is null for update;
 if not found then raise exception 'Выезд не найден'; end if;
 if source.resolution?'accounting' then return source.resolution->'accounting'; end if;
 if trip.workbench_revision is distinct from p_trip_revision or source.revision is distinct from p_source_revision then
  raise exception 'Выезд или GPS-запись изменились. Повторите проверку' using errcode='40001';
 end if;
 preview:=dlight_private.gps_supplement_preview(p_track,p_trip);
 if preview->>'before_digest' is distinct from p_before_digest or preview->>'extra_digest' is distinct from p_extra_digest then
  raise exception 'Появились новые GPS-данные. Повторите проверку' using errcode='40001';
 end if;
 if not coalesce((p_track_data#>>'{presence,usable}')::boolean,false)
  or coalesce(p_track_data->>'verdict','')='' or p_track_data->>'verdict' like 'трек недостоверен%' then
  raise exception 'Объединённый трек не прошёл проверку';
 end if;
 select coalesce(jsonb_agg(jsonb_build_array(s.id,s.job_id,s.minutes_mgr,s.crew_ids,
   coalesce(s.accepted_intervals,jsonb_build_array(jsonb_build_object('from',s.stay_from,'to',s.stay_to)))) order by s.id),'[]'::jsonb)
 into old_approved from public.trip_stays s where s.trip_id=p_trip and s.status='approved';
 if exists(select 1 from dlight_private.journal_road_state
     where trip_id=p_trip and (sections<>'{}'::jsonb or cuts<>'{}'::jsonb)) then
  road_before:=dlight_private.journal_road_model(p_trip)->'sections';
 end if;
 insert into public.vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status,moving,mileage)
 select source.vehicle_id,p_trip,p.ts,p.lat,p.lng,p.speed,p.status,coalesce(p.status='moving',false),null
 from jsonb_to_recordset(preview->'extra') p(ts timestamptz,lat float8,lng float8,speed numeric,status text)
 on conflict(vehicle_id,ts) do update set trip_id=excluded.trip_id
  where vehicle_positions.trip_id is null and vehicle_positions.lat=excluded.lat and vehicle_positions.lng=excluded.lng
    and vehicle_positions.status is not distinct from excluded.status;
 get diagnostics points_added=row_count;
 if points_added<>jsonb_array_length(preview->'extra') then
  raise exception 'Часть GPS уже была изменена или привязана. Повторите проверку' using errcode='40001';
 end if;
 select min(ts),max(ts) into first_ts,last_ts from public.vehicle_positions
 where trip_id=p_trip and lat is not null and lng is not null;
 new_digest:=dlight_private.trip_position_digest(p_trip,last_ts);
 p_track_data:=jsonb_set(p_track_data,'{presence}',p_track_data->'presence'||
  jsonb_build_object('source_digest',new_digest,'source_from',first_ts,'source_to',last_ts));
 answer:=dlight_private.track_rebuild_save(p_trip,p_trip_revision,last_ts,new_digest,p_track_data,null,null,null);
 select coalesce(jsonb_agg(jsonb_build_array(s.id,s.job_id,s.minutes_mgr,s.crew_ids,
   coalesce(s.accepted_intervals,jsonb_build_array(jsonb_build_object('from',s.stay_from,'to',s.stay_to)))) order by s.id),'[]'::jsonb)
 into new_approved from public.trip_stays s where s.trip_id=p_trip and s.status='approved';
 if new_approved is distinct from old_approved or exists (
  select 1 from jsonb_array_elements(new_approved) s
  cross join lateral jsonb_array_elements(s->4) a
  cross join lateral jsonb_array_elements(coalesce(p_track_data#>'{presence,motion_intervals}','[]')) m
  where (a->>'from')::timestamptz<(m->>'to')::timestamptz and (a->>'to')::timestamptz>(m->>'from')::timestamptz
 ) then raise exception 'Новый трек затрагивает подтверждённое присутствие. Сначала проверьте конфликтующие посещения'; end if;
 if road_before is not null then
  road_after:=dlight_private.journal_road_model(p_trip)->'sections';
  if road_after is distinct from road_before then
   raise exception 'Новый трек изменил бы уже исправленные участки дороги. Требуется отдельная сверка распределения';
  end if;
 end if;
 receipt:=answer||jsonb_build_object('points_added',points_added,'outside',preview->'outside','actor',auth.uid(),
  'at',now(),'km_before',trip.fact_km,'km_after',(select fact_km from public.trips where id=p_trip));
 update public.unassigned_tracks set resolution=resolution||jsonb_build_object('accounting',receipt),
  revision=revision+1 where id=p_track;
 update public.gps_road_cut_drafts set supplemental=false
  where track_id=p_track and trip_id=p_trip;
 return receipt;
end $$;

create function public.gps_supplement_preview(p_track uuid,p_trip uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select dlight_private.gps_supplement_preview(p_track,p_trip)
$$;
create function public.gps_supplement_apply(
 p_track uuid,p_trip uuid,p_trip_revision integer,p_source_revision integer,p_before_digest text,p_extra_digest text,p_track_data jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select dlight_private.gps_supplement_apply(p_track,p_trip,p_trip_revision,p_source_revision,p_before_digest,p_extra_digest,p_track_data)
$$;
revoke all on function dlight_private.gps_supplement_preview(uuid,uuid),public.gps_supplement_preview(uuid,uuid),
 dlight_private.gps_supplement_apply(uuid,uuid,integer,integer,text,text,jsonb),public.gps_supplement_apply(uuid,uuid,integer,integer,text,text,jsonb)
 from public,anon,authenticated;
grant execute on function dlight_private.gps_supplement_preview(uuid,uuid),public.gps_supplement_preview(uuid,uuid),
 dlight_private.gps_supplement_apply(uuid,uuid,integer,integer,text,text,jsonb),public.gps_supplement_apply(uuid,uuid,integer,integer,text,text,jsonb)
 to authenticated;
notify pgrst,'reload schema';
