begin;
-- API float serialization with extra_float_digits=0 loses a few ulps.
-- Keep exact trip/timestamp matching; allow only sub-micrometre coordinate
-- serialization noise (1e-12 degrees), never a different GPS anchor.
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
  if not exists(select 1 from public.vehicle_positions p where p.trip_id=p_trip and p.ts=g_from and abs(p.lat-(r->'anchor_from'->>'lat')::float8)<=1e-12 and abs(p.lng-(r->'anchor_from'->>'lng')::float8)<=1e-12)
   or not exists(select 1 from public.vehicle_positions p where p.trip_id=p_trip and p.ts=g_to and abs(p.lat-(r->'anchor_to'->>'lat')::float8)<=1e-12 and abs(p.lng-(r->'anchor_to'->>'lng')::float8)<=1e-12) then raise exception 'Опоры достройки не подтверждены GPS';end if;
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
commit;
