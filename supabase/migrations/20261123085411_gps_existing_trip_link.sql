create function dlight_private.gps_existing_trip_mode(p_trip public.trips)
returns text language sql stable security invoker set search_path='' as $$
 select case when p_trip.status in ('planned','assigned')
  and p_trip.started_at is null and p_trip.finished_at is null and p_trip.fact_km is null
  and not exists(select 1 from public.vehicle_positions where trip_id=p_trip.id)
  and not exists(select 1 from public.trip_tracks where trip_id=p_trip.id)
  and not exists(select 1 from public.trip_stays where trip_id=p_trip.id)
  and not exists(select 1 from public.unassigned_tracks where trip_id=p_trip.id)
 then 'import' else 'supplement' end
$$;

create function dlight_private.gps_existing_trip_options(p_track uuid)
returns table(id uuid,date_from date,date_to date,status text,link_mode text)
language plpgsql stable security definer set search_path='' as $$
declare source public.unassigned_tracks; zone text;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'GPS-запись привязывает диспетчер';
 end if;
 select * into source from public.unassigned_tracks where unassigned_tracks.id=p_track;
 if not found or source.state not in ('review','recording') then return; end if;
 zone:=coalesce((select company_timezone from public.settings where settings.id=true),'Europe/Kyiv');
 return query select t.id,t.date_from,t.date_to,t.status::text,dlight_private.gps_existing_trip_mode(t)
  from public.trips t where t.vehicle_id=source.vehicle_id and t.deleted_at is null
  and t.status in ('planned','assigned','in_progress','finished','done')
  and t.date_from<=(source.started_at at time zone zone)::date
  and t.date_to>=(coalesce(source.ended_at,source.last_ts) at time zone zone)::date
  and dlight_private.responsibility_manager('trip',t.id)
  order by t.date_from desc,t.id;
end $$;

create function dlight_private.gps_existing_trip_link(
 p_track uuid,p_expected integer,p_points integer,p_trip uuid,p_mode text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.unassigned_tracks; target public.trips; preview jsonb; result jsonb; mode text; reason text;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'GPS-запись привязывает диспетчер';
 end if;
 select * into source from public.unassigned_tracks where id=p_track for update;
 if not found then raise exception 'GPS-запись не найдена'; end if;
 if not coalesce(dlight_private.responsibility_manager('trip',p_trip),false) then
  raise exception 'Нет права управлять целевым выездом';
 end if;
 if source.state='linked' and source.trip_id=p_trip and source.resolved_by=auth.uid()
  and source.revision=p_expected+1 then return source.resolution; end if;
 if source.revision is distinct from p_expected or source.state not in ('review','recording') then
  raise exception 'GPS-запись изменилась. Обновите журнал' using errcode='40001';
 end if;
 if source.state='recording' and source.last_ts>now()-interval '5 minutes' then
  raise exception 'GPS-запись ещё продолжается';
 end if;
 select * into target from public.trips where id=p_trip for update;
 select options.link_mode into mode from dlight_private.gps_existing_trip_options(p_track) options where options.id=target.id;
 if mode is null then raise exception 'Выберите выезд той же машины, который покрывает даты GPS-записи'; end if;
 if mode is distinct from p_mode then
  raise exception 'В выезде изменились фактические данные. Откройте выбор выезда заново' using errcode='40001';
 end if;
 reason:=btrim(coalesce(p_reason,''));
 if length(reason) not between 3 and 1000 then raise exception 'Укажите основание привязки'; end if;
 preview:=dlight_private.unassigned_quote(p_track);
 if p_points is distinct from (preview->>'points')::integer or coalesce(p_points,0)<1 then
  raise exception 'GPS изменился или в записи нет точек. Обновите журнал';
 end if;
 if mode='import' then
  return dlight_private.unassigned_resolve(p_track,p_expected,'link',
   jsonb_build_object('trip',p_trip,'points',p_points,'reason',reason));
 end if;
 if exists(
  select 1 from dlight_private.unassigned_points(p_track) p
  join public.vehicle_positions v on v.vehicle_id=p.vehicle_id and v.ts=p.ts
  where v.trip_id is not null and v.trip_id<>p_trip
 ) then raise exception 'Часть GPS уже относится к другому выезду'; end if;
 result:=preview||jsonb_build_object('trip_id',p_trip,'reason',reason,'link_mode','supplement');
 update public.unassigned_tracks set state='linked',trip_id=p_trip,ended_at=coalesce(ended_at,last_ts),
  resolution=result,resolved_by=auth.uid(),resolved_at=now(),revision=revision+1 where id=p_track;
 insert into public.unassigned_track_events(track_id,action,actor_id,reason,snapshot)
  values(p_track,'link',auth.uid(),reason,result);
 return result;
end $$;

create function public.gps_existing_trip_options(p_track uuid)
returns table(id uuid,date_from date,date_to date,status text,link_mode text)
language sql stable security invoker set search_path='' as $$
 select * from dlight_private.gps_existing_trip_options(p_track)
$$;
create function public.gps_existing_trip_link(
 p_track uuid,p_expected integer,p_points integer,p_trip uuid,p_mode text,p_reason text
) returns jsonb language sql security invoker set search_path='' as $$
 select dlight_private.gps_existing_trip_link(p_track,p_expected,p_points,p_trip,p_mode,p_reason)
$$;
revoke all on function dlight_private.gps_existing_trip_mode(public.trips),
 dlight_private.gps_existing_trip_options(uuid),public.gps_existing_trip_options(uuid),
 dlight_private.gps_existing_trip_link(uuid,integer,integer,uuid,text,text),
 public.gps_existing_trip_link(uuid,integer,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function dlight_private.gps_existing_trip_options(uuid),public.gps_existing_trip_options(uuid),
 dlight_private.gps_existing_trip_link(uuid,integer,integer,uuid,text,text),
 public.gps_existing_trip_link(uuid,integer,integer,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
