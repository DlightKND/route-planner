create table public.gps_road_cut_drafts (
 track_id uuid primary key references public.unassigned_tracks(id) on delete cascade,
 trip_id uuid references public.trips(id) on delete set null,
 revision integer not null check(revision>0),
 source_revision integer not null,
 source_points integer not null,
 source_current boolean not null default true,
 supplemental boolean not null default false,
 cuts bigint[] not null,
 edited_by uuid not null references public.profiles(id),
 edited_at timestamptz not null default now()
);
create index gps_road_cut_drafts_trip_idx on public.gps_road_cut_drafts(trip_id) where trip_id is not null;
alter table public.gps_road_cut_drafts enable row level security;
revoke all on public.gps_road_cut_drafts from public,anon,authenticated;
grant select on public.gps_road_cut_drafts to authenticated;
create policy gps_road_cut_drafts_read on public.gps_road_cut_drafts for select to authenticated using (
 (select public.user_role()) in ('admin','logist') and (
  trip_id is null and exists(select 1 from public.unassigned_tracks s where s.id=gps_road_cut_drafts.track_id)
  or exists(select 1 from public.trips t where t.id=gps_road_cut_drafts.trip_id and t.deleted_at is null)
 )
);

create function dlight_private.gps_road_cut_draft_save(
 p_track uuid,p_source_revision integer,p_source_points integer,p_expected integer,p_cuts bigint[]
) returns integer language plpgsql security definer set search_path='' as $$
declare source public.unassigned_tracks; prior public.gps_road_cut_drafts; draft_cuts bigint[]; next_revision integer;
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'Участки GPS-записи готовит диспетчер';
 end if;
 select * into source from public.unassigned_tracks where id=p_track for update;
 if not found or source.trip_id is not null or source.state not in ('review','recording')
    or (source.state='recording' and source.last_ts>now()-interval '5 minutes') then
  raise exception 'Нужна завершённая непривязанная GPS-запись';
 end if;
 if source.revision is distinct from p_source_revision or
    (select count(*) from dlight_private.unassigned_points(p_track)) is distinct from p_source_points::bigint then
  raise exception 'GPS изменился. Обновите запись' using errcode='40001';
 end if;
 if p_cuts is null or cardinality(p_cuts)>100 or exists(select 1 from unnest(p_cuts) cut where cut is null
   or cut % 60<>0 or cut<=extract(epoch from source.started_at)
   or cut>=extract(epoch from coalesce(source.ended_at,source.last_ts))) then
  raise exception 'Точки разделения должны быть внутри GPS-записи с точностью до минуты';
 end if;
 select coalesce(array_agg(distinct cut order by cut),'{}') into draft_cuts from unnest(p_cuts) cut;
 select * into prior from public.gps_road_cut_drafts where track_id=p_track;
 if coalesce(prior.revision,0) is distinct from p_expected then
  if prior.revision=p_expected+1 and prior.edited_by=auth.uid() and prior.source_revision=p_source_revision
    and prior.source_points=p_source_points and prior.cuts=draft_cuts then return prior.revision; end if;
  raise exception 'Участки уже изменены. Обновите запись' using errcode='40001';
 end if;
 next_revision:=coalesce(prior.revision,0)+1;
 insert into public.gps_road_cut_drafts(track_id,revision,source_revision,source_points,cuts,edited_by)
 values(p_track,next_revision,p_source_revision,p_source_points,draft_cuts,auth.uid())
 on conflict(track_id) do update set revision=excluded.revision,source_revision=excluded.source_revision,
  source_points=excluded.source_points,cuts=excluded.cuts,edited_by=excluded.edited_by,edited_at=now();
 return next_revision;
end $$;

create function public.gps_road_cut_draft_save(
 p_track uuid,p_source_revision integer,p_source_points integer,p_expected integer,p_cuts bigint[]
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.gps_road_cut_draft_save(p_track,p_source_revision,p_source_points,p_expected,p_cuts)
$$;
revoke all on function public.gps_road_cut_draft_save(uuid,integer,integer,integer,bigint[]),
 dlight_private.gps_road_cut_draft_save(uuid,integer,integer,integer,bigint[]) from public,anon,authenticated;
grant execute on function public.gps_road_cut_draft_save(uuid,integer,integer,integer,bigint[]),
 dlight_private.gps_road_cut_draft_save(uuid,integer,integer,integer,bigint[]) to authenticated;

create function dlight_private.gps_road_cut_drafts_follow_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.gps_road_cut_drafts set trip_id=new.trip_id,
  source_current=coalesce(source_revision=old.revision and source_points=(new.resolution->>'points')::integer,false),
  supplemental=coalesce(new.resolution->>'link_mode'='supplement',false)
 where track_id=new.id;
 return new;
end $$;
revoke all on function dlight_private.gps_road_cut_drafts_follow_link() from public,anon,authenticated;
create trigger gps_road_cut_drafts_follow_link after update of trip_id on public.unassigned_tracks for each row
 when(new.trip_id is not null and old.trip_id is distinct from new.trip_id)
 execute function dlight_private.gps_road_cut_drafts_follow_link();
notify pgrst,'reload schema';
