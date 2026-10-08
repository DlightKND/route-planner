-- Ordered composite tracks retain their original ranges and audit history.
alter table public.unassigned_tracks drop constraint unassigned_tracks_state_check;
alter table public.unassigned_tracks add constraint unassigned_tracks_state_check check(state in ('recording','review','linked','charged','merged'));
alter table public.unassigned_tracks add column source_ranges jsonb;
alter table public.unassigned_tracks add column merged_into uuid references public.unassigned_tracks(id) on delete restrict;
alter table public.unassigned_tracks add constraint unassigned_source_ranges_array check(source_ranges is null or jsonb_typeof(source_ranges)='array');

create function dlight_private.unassigned_points(p_track uuid)
returns table(vehicle_id uuid,ts timestamptz,lat double precision,lng double precision,speed numeric,status text,part integer)
language sql stable security invoker set search_path='' as $$
 select a.vehicle_id,a.ts,a.lat,a.lng,a.speed,a.status,r.n::integer
 from public.unassigned_tracks q
 cross join lateral jsonb_array_elements(coalesce(q.source_ranges,jsonb_build_array(jsonb_build_object('id',q.id,'from',q.started_at,'to',coalesce(q.ended_at,q.last_ts))))) with ordinality r(v,n)
 join public.vehicle_telemetry_archive a on a.vehicle_id=q.vehicle_id and a.ts between (r.v->>'from')::timestamptz and (r.v->>'to')::timestamptz and a.trip_id is null
 where q.id=p_track
$$;
revoke all on function dlight_private.unassigned_points(uuid) from public,anon,authenticated;

create function dlight_private.unassigned_points_read(p_track uuid,p_offset integer,p_limit integer)
returns table(ts timestamptz,lat double precision,lng double precision,speed numeric,status text,part integer)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер разбирает непривязанные поездки'; end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 1000 then raise exception 'Некорректная страница GPS'; end if;
 return query select p.ts,p.lat,p.lng,p.speed,p.status,p.part from dlight_private.unassigned_points(p_track) p order by p.part,p.ts offset p_offset limit p_limit;
end $$;
revoke all on function dlight_private.unassigned_points_read(uuid,integer,integer) from public,anon,authenticated;
grant execute on function dlight_private.unassigned_points_read(uuid,integer,integer) to authenticated;
create function public.unassigned_track_points(p_track uuid,p_offset integer default 0,p_limit integer default 1000)
returns table(ts timestamptz,lat double precision,lng double precision,speed numeric,status text,part integer)
language sql stable security invoker set search_path='' as $$select * from dlight_private.unassigned_points_read(p_track,p_offset,p_limit)$$;
revoke all on function public.unassigned_track_points(uuid,integer,integer) from public,anon;
grant execute on function public.unassigned_track_points(uuid,integer,integer) to authenticated;

create or replace function dlight_private.unassigned_quote(p_track uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.unassigned_tracks; km numeric; cnt integer; gaps integer; rejected integer; rate numeric;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер разбирает непривязанные поездки'; end if;
 select * into q from public.unassigned_tracks where id=p_track;
 if not found then raise exception 'Поездка не найдена'; end if;
 with points as (select ts,lat,lng,lag(ts) over w prev_ts,lag(lat) over w prev_lat,lag(lng) over w prev_lng
  from dlight_private.unassigned_points(p_track) window w as(partition by part order by ts)),
 segments as(select *,extract(epoch from ts-prev_ts) dt,public.depot_distance_km(prev_lat,prev_lng,lat,lng) distance from points)
 select round(coalesce(sum(distance) filter(where dt>0 and dt<=300 and distance/(dt/3600)<=coalesce((select track_max_kmh from public.settings where id=true),300)),0),2),count(*),
  count(*) filter(where dt>300),count(*) filter(where dt>0 and distance/(dt/3600)>coalesce((select track_max_kmh from public.settings where id=true),300))
 into km,cnt,gaps,rejected from segments;
 select coalesce(v.cost_per_km,nullif(s.costs->>'km','')::numeric) into rate from public.vehicles v cross join public.settings s where v.id=q.vehicle_id and s.id=true;
 return jsonb_build_object('track_id',q.id,'revision',q.revision,'km',km,'points',cnt,'gaps',gaps,'rejected',rejected,'rate',rate,
  'cost',case when rate is not null then round(km*rate,2) end,'source_ranges',q.source_ranges,'started_at',q.started_at,'ended_at',coalesce(q.ended_at,q.last_ts));
end $$;

create function dlight_private.unassigned_merge(p_tracks uuid[],p_expected jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.unassigned_tracks; first_vehicle uuid; previous_end timestamptz; ranges jsonb:='[]'; item jsonb; track_key uuid; result_id uuid; quote jsonb; start_ts timestamptz; end_ts timestamptz;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер объединяет поездки'; end if;
 if cardinality(p_tracks) is null or cardinality(p_tracks) not between 2 and 20 or exists(select 1 from unnest(p_tracks) t group by t having count(*)>1) or array_position(p_tracks,null) is not null then raise exception 'Выберите от 2 до 20 разных треков'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Укажи основание объединения'; end if;
 -- Stable lock order serializes overlapping selections and avoids deadlocks.
 perform 1 from public.unassigned_tracks where id=any(p_tracks) order by id for update;
 foreach track_key in array p_tracks loop
  select * into q from public.unassigned_tracks where unassigned_tracks.id=track_key;
  if not found or not (q.state='review' and q.ended_at is not null or q.state='recording' and q.last_ts<=now()-interval '5 minutes') then raise exception 'Можно объединить только завершённые треки на разборе'; end if;
  q.ended_at:=coalesce(q.ended_at,q.last_ts);
  if first_vehicle is null then first_vehicle:=q.vehicle_id;start_ts:=q.started_at;end if;
  if q.vehicle_id<>first_vehicle then raise exception 'Выберите треки одной машины'; end if;
  if previous_end is not null and q.started_at<=previous_end then raise exception 'Расположите треки по времени без пересечений'; end if;
  quote:=dlight_private.unassigned_quote(q.id);
  item:=p_expected->q.id::text;
  if (item->>'revision')::integer is distinct from q.revision or (item->>'points')::integer is distinct from (quote->>'points')::integer then raise exception 'GPS или поездка изменились. Повторите просмотр'; end if;
  if (quote->>'points')::integer=0 then raise exception 'У выбранного трека нет GPS-точек'; end if;
  if exists(select 1 from public.vehicle_positions v join dlight_private.unassigned_points(q.id) p on p.vehicle_id=v.vehicle_id and p.ts=v.ts where v.trip_id is not null) then raise exception 'GPS уже привязан к выезду'; end if;
  ranges:=ranges||coalesce(q.source_ranges,jsonb_build_array(jsonb_build_object('id',q.id,'from',q.started_at,'to',q.ended_at)));
  previous_end:=q.ended_at;end_ts:=q.ended_at;
 end loop;
 insert into public.unassigned_tracks(vehicle_id,started_at,last_ts,ended_at,state,review_note,source_ranges)
 values(first_vehicle,start_ts,end_ts,end_ts,'review','Объединены треки: '||cardinality(p_tracks)||'. '||trim(p_reason),ranges) returning id into result_id;
 foreach track_key in array p_tracks loop
  update public.unassigned_tracks set state='merged',ended_at=coalesce(ended_at,last_ts),merged_into=result_id,revision=revision+1 where unassigned_tracks.id=track_key;
  insert into public.unassigned_track_events(track_id,action,actor_id,reason,snapshot) values(track_key,'merge_source',auth.uid(),trim(p_reason),jsonb_build_object('merged_into',result_id));
 end loop;
 insert into public.unassigned_track_events(track_id,action,actor_id,reason,snapshot) values(result_id,'merge',auth.uid(),trim(p_reason),jsonb_build_object('ordered_tracks',p_tracks,'source_ranges',ranges));
 return jsonb_build_object('track_id',result_id,'source_ranges',ranges);
end $$;
revoke all on function dlight_private.unassigned_merge(uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function dlight_private.unassigned_merge(uuid[],jsonb,text) to authenticated;
create function public.unassigned_track_merge(p_tracks uuid[],p_expected jsonb,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select dlight_private.unassigned_merge(p_tracks,p_expected,p_reason)$$;
revoke all on function public.unassigned_track_merge(uuid[],jsonb,text) from public,anon;
grant execute on function public.unassigned_track_merge(uuid[],jsonb,text) to authenticated;

create or replace function dlight_private.unassigned_resolve(p_track uuid,p_expected integer,p_action text,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare q public.unassigned_tracks; quote jsonb; km numeric; rate numeric; cost numeric; reason text; engineer uuid; client uuid;
 jid uuid; oid uuid; tid uuid; title text; zone text; start_day date; end_day date; result jsonb;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then raise exception 'Только диспетчер разбирает непривязанные поездки'; end if;
 select * into q from public.unassigned_tracks where id=p_track for update;
 if not found then raise exception 'Поездка не найдена'; end if;
 if q.revision is distinct from p_expected then raise exception 'Поездка изменилась. Обнови данные'; end if;
 if q.state not in ('recording','review') then raise exception 'Поездка уже разобрана'; end if;
 if q.state='recording' then
  if q.last_ts>now()-interval '5 minutes' then raise exception 'Поездка ещё записывается'; end if;
  q.ended_at:=q.last_ts;
  update public.unassigned_tracks set ended_at=q.last_ts,state='review',review_note='Нет свежего GPS: окончание подтверждено диспетчером' where id=q.id;
 end if;
 reason:=trim(coalesce(p_data->>'reason',''));
 if length(reason)<3 then raise exception 'Укажи причину решения'; end if;
 if p_action not in ('chain','charge','link') then raise exception 'Неизвестное действие'; end if;
 quote:=dlight_private.unassigned_quote(p_track);
 if (p_data->>'points')::integer is distinct from (quote->>'points')::integer then raise exception 'GPS изменился. Обнови расчёт'; end if;
 km:=coalesce(nullif(p_data->>'km','')::numeric,(quote->>'km')::numeric);
 if km<0 or km='NaN'::numeric or km>'1000000'::numeric then raise exception 'Некорректный пробег'; end if;
 if p_action in ('chain','charge') then
  engineer:=nullif(p_data->>'engineer','')::uuid;
  if not exists(select 1 from public.profiles where id=engineer and active and role='engineer') then raise exception 'Выбери активного инженера'; end if;
 end if;
 if p_action='charge' then
  if exists(select 1 from public.vehicle_positions v join dlight_private.unassigned_points(q.id) p on p.vehicle_id=v.vehicle_id and p.ts=v.ts where v.trip_id is not null) then raise exception 'GPS уже привязан к выезду. Повторное списание этой поездки запрещено'; end if;
  rate:=(quote->>'rate')::numeric;cost:=round(km*rate,2);
  if rate is null or rate<=0 or rate='NaN'::numeric or rate='Infinity'::numeric or km<=0 then raise exception 'Для списания нужны положительные конечные пробег и себестоимость километра'; end if;
  if cost is distinct from (p_data->>'cost')::numeric then raise exception 'Себестоимость изменилась. Обнови расчёт'; end if;
  result:=quote||jsonb_build_object('km',km,'cost',cost,'engineer_id',engineer,'reason',reason,'basis','distance_cost','gps_km',quote->'km','km_source',case when km=(quote->>'km')::numeric then 'gps' else 'manager' end,'currency',(select currency from public.settings where id=true));
 else
  if p_action='chain' then
   client:=nullif(p_data->>'client','')::uuid;title:=trim(coalesce(p_data->>'title',''));
   if not exists(select 1 from public.clients where id=client and deleted_at is null) then raise exception 'Выбери клиента'; end if;
   if length(title) not between 1 and 200 then raise exception 'Укажи название задания до 200 символов'; end if;
   zone:=coalesce((select company_timezone from public.settings where id=true),'Europe/Kyiv');
   start_day:=(q.started_at at time zone zone)::date;end_day:=(q.ended_at at time zone zone)::date;
   insert into public.jobs(client_id,notes,created_by,assigned_engineer,engineer_ids,owner_id,curator_id)
    values(client,reason,auth.uid(),engineer,array[engineer],auth.uid(),auth.uid()) returning id into jid;
   oid:=public.service_order_save_one(null,0,jsonb_build_object('title',title,'work_mode','onsite','date_from',start_day,'date_to',end_day,'lead_engineer',engineer,'engineer_ids',jsonb_build_array(engineer),'instructions',reason),jid,'[]'::jsonb);
   insert into public.trips(date_from,date_to,vehicle_id,lead_engineer,engineer_ids,status,notes,created_by,owner_id,curator_id,service_order_id)
    values(start_day,end_day,q.vehicle_id,engineer,array[engineer],'planned',reason,auth.uid(),auth.uid(),auth.uid(),oid) returning id into tid;
   insert into public.trip_service_orders(trip_id,order_id,ordinal,link_source,created_by) values(tid,oid,0,'dispatcher',auth.uid()) on conflict do nothing;
   insert into public.trip_jobs(trip_id,job_id,ord) values(tid,jid,0);
   update public.trips set main_job_id=jid where id=tid;
  else
   tid:=nullif(p_data->>'trip','')::uuid;
   if not dlight_private.responsibility_manager('trip',tid) then raise exception 'Нет права управлять целевым выездом'; end if;
   if not exists(select 1 from public.trips where id=tid and vehicle_id=q.vehicle_id and deleted_at is null and status in ('planned','assigned') and started_at is null and finished_at is null and fact_km is null) then raise exception 'Выбери ещё не начатый выезд той же машины'; end if;
   -- Never merge two measured journeys silently.
   if exists(select 1 from public.vehicle_positions where trip_id=tid) then raise exception 'У выезда уже есть GPS. Автоматическое объединение запрещено'; end if;
   if exists(select 1 from public.trip_tracks where trip_id=tid) or exists(select 1 from public.trip_stays where trip_id=tid) then raise exception 'У выезда уже есть фактический трек или стоянки'; end if;
  end if;
  if km is distinct from (quote->>'km')::numeric then raise exception 'Для импорта используется рассчитанный GPS-пробег. Корректировку одометра внеси в карточке выезда'; end if;
  if exists(select 1 from public.vehicle_positions v join dlight_private.unassigned_points(q.id) p on p.vehicle_id=v.vehicle_id and p.ts=v.ts where v.trip_id is not null and v.trip_id<>tid) then raise exception 'Часть GPS уже привязана к другому выезду'; end if;
  perform set_config('dlight.via_rpc','1',true);
  insert into public.vehicle_positions(vehicle_id,trip_id,ts,lat,lng,speed,status,moving,mileage)
   select vehicle_id,tid,ts,lat,lng,speed,status,status='moving',null from dlight_private.unassigned_points(q.id)
   on conflict(vehicle_id,ts) do update set trip_id=excluded.trip_id;
  update public.trips set status='finished',started_at=q.started_at,finished_at=q.ended_at,fact_km=km,fact_km_source='track' where id=tid;
  if q.source_ranges is not null then
   insert into public.trip_tracks(trip_id,km,data,updated_at)
   with p as(select *,lag(ts) over w prev_ts,lag(lat) over w prev_lat,lag(lng) over w prev_lng from dlight_private.unassigned_points(q.id) window w as(partition by part order by ts)),
   g as(select *,extract(epoch from ts-prev_ts) dt,public.depot_distance_km(prev_lat,prev_lng,lat,lng) distance from p)
   select tid,km,jsonb_build_object('km',km,'trackKm',km,'roadKm',0,'lineKm',0,'jitterKm',0,'checks',0,'weakChecks',0,'verdict','Объединённые GPS-участки без достройки','reasons','{}'::jsonb,'source_ranges',q.source_ranges,
    'points',coalesce((select jsonb_agg(jsonb_build_object('ts',ts,'lat',lat,'lng',lng,'status',status,'part',part) order by part,ts) from p),'[]'::jsonb),
    'segments',coalesce(jsonb_agg(jsonb_build_object('kind','track','km',distance,'minutes',dt/60,'ms',dt*1000,'fromTs',prev_ts,'toTs',ts,'fromPt',jsonb_build_object('lat',prev_lat,'lng',prev_lng),'toPt',jsonb_build_object('lat',lat,'lng',lng))) filter(where dt>0 and dt<=300 and distance/(dt/3600)<=coalesce((select track_max_kmh from public.settings where id=true),300)),'[]'::jsonb)),now() from g;
  end if;
  perform public.trip_detect_stays(tid);
  result:=quote||jsonb_build_object('km',km,'trip_id',tid,'job_id',jid,'order_id',oid,'reason',reason);
 end if;
 update public.unassigned_tracks set state=case when p_action='charge' then 'charged' else 'linked' end,trip_id=tid,engineer_id=engineer,
  resolution=result,resolved_by=auth.uid(),resolved_at=now(),revision=revision+1 where id=q.id;
 insert into public.unassigned_track_events(track_id,action,actor_id,reason,snapshot) values(q.id,p_action,auth.uid(),reason,result);
 return result;
end $$;
