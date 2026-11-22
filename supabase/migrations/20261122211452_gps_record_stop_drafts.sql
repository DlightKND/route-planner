create table public.gps_record_stop_drafts (
 track_id uuid primary key references public.unassigned_tracks(id) on delete cascade,
 trip_id uuid references public.trips(id) on delete set null,
 revision integer not null check(revision>0),
 source_revision integer not null,
 source_points integer not null,
 source_current boolean not null default true,
 stops jsonb not null check(jsonb_typeof(stops)='array'),
 edited_by uuid not null references public.profiles(id),
 edited_at timestamptz not null default now()
);
create index gps_record_stop_drafts_trip_idx on public.gps_record_stop_drafts(trip_id) where trip_id is not null;
alter table public.gps_record_stop_drafts enable row level security;
revoke all on public.gps_record_stop_drafts from public,anon,authenticated;
grant select on public.gps_record_stop_drafts to authenticated;
create policy gps_record_stop_drafts_read on public.gps_record_stop_drafts for select to authenticated
 using ((select public.user_role()) in ('admin','logist') and (
  trip_id is null and exists(select 1 from public.unassigned_tracks s where s.id=gps_record_stop_drafts.track_id)
  or exists(select 1 from public.trips t where t.id=gps_record_stop_drafts.trip_id and t.deleted_at is null)
 ));

create function dlight_private.gps_record_stop_draft_save(
 p_track uuid,p_source_revision integer,p_source_points integer,p_expected integer,p_stops jsonb
) returns integer language plpgsql security definer set search_path='' as $$
declare
 source public.unassigned_tracks;
 prior public.gps_record_stop_drafts;
 checked_stops jsonb;
 current_points integer;
 next_revision integer;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'Стоянки GPS-записи готовит диспетчер';
 end if;
 select * into source from public.unassigned_tracks where id=p_track for update;
 if not found or source.state not in ('review','recording') or source.trip_id is not null
    or (source.state='recording' and source.last_ts>now()-interval '5 minutes') then
  raise exception 'Подготовка доступна для завершённой непривязанной записи';
 end if;
 if source.revision is distinct from p_source_revision then
  raise exception 'GPS-запись изменилась. Обновите трек';
 end if;
 select * into prior from public.gps_record_stop_drafts where track_id=p_track;
 if coalesce(prior.revision,0) is distinct from p_expected then
  raise exception 'Выбор стоянок уже изменён. Обновите запись';
 end if;
 if jsonb_typeof(p_stops) is distinct from 'array' then raise exception 'Укажите список стоянок'; end if;
 if jsonb_array_length(p_stops)>500 then raise exception 'Слишком много стоянок в одной записи'; end if;
 with points as materialized (
  select p.*, lag(ts) over(partition by part order by ts) as previous
  from dlight_private.unassigned_points(p_track) p
 ), requested as (
  select * from jsonb_to_recordset(p_stops)
   as s(stay_from timestamptz,stay_to timestamptz,decision text,note text)
 ), valid as (
  select s.stay_from,s.stay_to,s.decision,btrim(coalesce(s.note,'')) as note,a.lat,a.lng
  from requested s join points a on a.ts=s.stay_from
  join points b on b.ts=s.stay_to and a.part=b.part
  where s.stay_to-s.stay_from>=interval '10 minutes'
   and s.decision in ('include','exclude')
   and length(coalesce(s.note,''))<=500
   and a.lat between -90 and 90 and a.lng between -180 and 180
   and not exists (
    select 1 from points p where p.part=a.part and p.ts between a.ts and b.ts
      and (p.status is distinct from 'idle' or p.lat is null or p.lng is null
       or not (p.lat between -90 and 90 and p.lng between -180 and 180)
       or abs(p.lat-a.lat)>.001 or abs(p.lng-a.lng)>.001
       or (p.ts>a.ts and p.ts-p.previous>interval '5 minutes'))
   )
 )
 select (select count(*) from points),coalesce(jsonb_agg(to_jsonb(v) order by v.stay_from),'[]'::jsonb)
 into current_points,checked_stops from valid v;
 if current_points is distinct from p_source_points then raise exception 'GPS изменился. Обновите трек'; end if;
 if jsonb_array_length(checked_stops)<>jsonb_array_length(p_stops)
    or (select count(distinct item->>'stay_from') from jsonb_array_elements(checked_stops) item)<>jsonb_array_length(checked_stops) then
  raise exception 'Один из интервалов не совпадает с непрерывной GPS-стоянкой';
 end if;
 next_revision:=coalesce(prior.revision,0)+1;
 insert into public.gps_record_stop_drafts(track_id,revision,source_revision,source_points,stops,edited_by)
 values(p_track,next_revision,p_source_revision,p_source_points,checked_stops,auth.uid())
 on conflict(track_id) do update set revision=excluded.revision,source_revision=excluded.source_revision,
  source_points=excluded.source_points,stops=excluded.stops,edited_by=excluded.edited_by,edited_at=now();
 return next_revision;
end $$;

create function public.gps_record_stop_draft_save(
 p_track uuid,p_source_revision integer,p_source_points integer,p_expected integer,p_stops jsonb
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.gps_record_stop_draft_save(p_track,p_source_revision,p_source_points,p_expected,p_stops)
$$;
revoke all on function public.gps_record_stop_draft_save(uuid,integer,integer,integer,jsonb),
 dlight_private.gps_record_stop_draft_save(uuid,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.gps_record_stop_draft_save(uuid,integer,integer,integer,jsonb),
 dlight_private.gps_record_stop_draft_save(uuid,integer,integer,integer,jsonb) to authenticated;

create function dlight_private.gps_record_drafts_follow_link() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 update public.gps_record_stop_drafts set trip_id=new.trip_id,
  source_current=coalesce(source_revision=old.revision and source_points=(new.resolution->>'points')::integer,false)
 where track_id=new.id;
 return new;
end $$;
revoke all on function dlight_private.gps_record_drafts_follow_link() from public,anon,authenticated;
create trigger gps_record_drafts_follow_link after update of trip_id on public.unassigned_tracks
 for each row when (new.trip_id is not null and old.trip_id is distinct from new.trip_id)
 execute function dlight_private.gps_record_drafts_follow_link();
