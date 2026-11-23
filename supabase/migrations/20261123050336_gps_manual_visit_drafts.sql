create table public.gps_manual_visit_drafts (
 id uuid primary key,
 track_id uuid not null references public.unassigned_tracks(id) on delete cascade,
 trip_id uuid references public.trips(id) on delete set null,
 revision integer not null default 1,
 stay_from timestamptz not null,
 stay_to timestamptz not null check(stay_from<stay_to),
 job_id uuid references public.jobs(id) on delete set null,
 crew_ids uuid[] not null,
 reason text not null check(length(reason) between 3 and 1000),
 edited_by uuid not null references public.profiles(id),
 edited_at timestamptz not null default now(),
 discarded_at timestamptz,
 confirmed_at timestamptz
);
create index gps_manual_visit_drafts_track_idx on public.gps_manual_visit_drafts(track_id);
create index gps_manual_visit_drafts_trip_idx on public.gps_manual_visit_drafts(trip_id) where trip_id is not null;
alter table public.gps_manual_visit_drafts enable row level security;
revoke all on public.gps_manual_visit_drafts from public,anon,authenticated;
grant select on public.gps_manual_visit_drafts to authenticated;
create policy gps_manual_visit_drafts_read on public.gps_manual_visit_drafts for select to authenticated using(
 discarded_at is null and ((select public.user_role()) in ('admin','logist') or
  (trip_id is not null and dlight_private.responsibility_manager('trip',trip_id)))
 and (exists(select 1 from public.trips t where t.id=gps_manual_visit_drafts.trip_id and t.deleted_at is null)
  or (trip_id is null and exists(select 1 from public.unassigned_tracks s where s.id=gps_manual_visit_drafts.track_id)))
);

create function dlight_private.gps_manual_visit_draft_save(
 p_track uuid,p_id uuid,p_expected integer,p_from timestamp,p_to timestamp,
 p_job uuid,p_crew uuid[],p_reason text,p_remove boolean
) returns integer language plpgsql security definer set search_path='' as $$
declare
 source public.unassigned_tracks;
 draft public.gps_manual_visit_drafts;
 starts timestamptz:=p_from at time zone 'Europe/Kyiv';
 finishes timestamptz:=p_to at time zone 'Europe/Kyiv';
 personnel uuid[];
 note text:=btrim(coalesce(p_reason,''));
begin
 if auth.uid() is null or coalesce(public.user_role(),'') not in ('admin','logist') then
  raise exception 'Ручное посещение готовит диспетчер';
 end if;
 select * into source from public.unassigned_tracks where id=p_track for update;
 if not found or source.trip_id is not null or source.state not in ('review','recording')
    or (source.state='recording' and source.last_ts>now()-interval '5 minutes') then
  raise exception 'Нужна завершённая непривязанная GPS-запись';
 end if;
 select * into draft from public.gps_manual_visit_drafts where id=p_id and track_id=p_track;
 if draft.discarded_at is not null then raise exception 'Черновик удалён'; end if;
 if p_remove then
  if draft.id is null then raise exception 'Черновик не найден'; end if;
  if draft.revision is distinct from p_expected then
   raise exception 'Черновик изменился. Обновите запись' using errcode='40001';
  end if;
  update public.gps_manual_visit_drafts set discarded_at=now() where id=draft.id;
  return draft.revision;
 end if;
 if not coalesce(isfinite(starts) and isfinite(finishes) and starts<finishes and finishes<=now()
     and starts>=source.started_at and finishes<=coalesce(source.ended_at,source.last_ts)
     and p_from=(starts at time zone 'Europe/Kyiv') and p_to=(finishes at time zone 'Europe/Kyiv'),false) then
  raise exception 'Укажите прошедший интервал внутри GPS-записи по Киеву';
 end if;
 if length(note) not between 3 and 1000 then raise exception 'Укажите основание ручного учёта'; end if;
 if not exists(select 1 from public.jobs where id=p_job and deleted_at is null) then
  raise exception 'Выберите действующую заявку';
 end if;
 select array_agg(distinct p order by p) into personnel from unnest(p_crew) p;
 if coalesce(cardinality(personnel),0)=0 or exists(select 1 from unnest(personnel) p
   where not exists(select 1 from public.profiles where id=p and role='engineer' and active)) then
  raise exception 'Укажите присутствовавших инженеров';
 end if;
 if coalesce(draft.revision,0) is distinct from p_expected then
  if draft.revision=p_expected+1 and draft.edited_by=auth.uid()
     and (draft.stay_from,draft.stay_to,draft.job_id,draft.crew_ids,draft.reason)
         is not distinct from (starts,finishes,p_job,personnel,note) then
   return draft.revision;
  end if;
  raise exception 'Черновик изменился. Обновите запись' using errcode='40001';
 end if;
 if draft.id is null then
  insert into public.gps_manual_visit_drafts(id,track_id,stay_from,stay_to,job_id,crew_ids,reason,edited_by)
  values(p_id,p_track,starts,finishes,p_job,personnel,note,auth.uid());
  return 1;
 end if;
 update public.gps_manual_visit_drafts set stay_from=starts,stay_to=finishes,job_id=p_job,crew_ids=personnel,
  reason=note,edited_by=auth.uid(),edited_at=now(),revision=draft.revision+1 where id=draft.id;
 return draft.revision+1;
end $$;

create function dlight_private.gps_manual_visit_draft_confirm(
 p_trip uuid,p_expected integer,p_draft uuid,p_draft_revision integer,
 p_job uuid,p_crew uuid[]
) returns integer language plpgsql security definer set search_path='' as $$
declare draft public.gps_manual_visit_drafts; trip public.trips; next_revision integer; personnel uuid[];
begin
 if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then
  raise exception 'Посещение подтверждает куратор выезда';
 end if;
 select * into trip from public.trips where id=p_trip and deleted_at is null for update;
 if not found then raise exception 'Выезд не найден'; end if;
 select * into draft from public.gps_manual_visit_drafts where id=p_draft and trip_id=p_trip and discarded_at is null for update;
 if not found then raise exception 'Черновик не относится к выезду'; end if;
 if draft.confirmed_at is not null then return trip.workbench_revision; end if;
 if draft.revision is distinct from p_draft_revision then raise exception 'Черновик изменился. Обновите запись' using errcode='40001'; end if;
 if exists(select 1 from public.trip_stays where id=draft.id) then
  raise exception 'Это посещение уже учтено вне черновика. Обновите журнал';
 end if;
 if exists(select 1 from public.vehicle_positions p where p.trip_id=p_trip and p.ts>=draft.stay_from
    and p.ts<draft.stay_to and (p.moving or p.status='moving')) then
  raise exception 'Посещение пересекается с движением по GPS';
 end if;
 select array_agg(distinct p order by p) into personnel from unnest(p_crew) p;
 next_revision:=dlight_private.gps_record_manual_visit(p_trip,p_expected,draft.id,p_job,
  draft.stay_from at time zone 'Europe/Kyiv',draft.stay_to at time zone 'Europe/Kyiv',personnel,draft.reason);
 update public.gps_manual_visit_drafts set confirmed_at=now() where id=draft.id;
 return next_revision;
end $$;

create function public.gps_manual_visit_draft_save(
 p_track uuid,p_id uuid,p_expected integer,p_from timestamp,p_to timestamp,
 p_job uuid,p_crew uuid[],p_reason text,p_remove boolean
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.gps_manual_visit_draft_save(p_track,p_id,p_expected,p_from,p_to,p_job,p_crew,p_reason,p_remove)
$$;
create function public.gps_manual_visit_draft_confirm(
 p_trip uuid,p_expected integer,p_draft uuid,p_draft_revision integer,p_job uuid,p_crew uuid[]
) returns integer language sql security invoker set search_path='' as $$
 select dlight_private.gps_manual_visit_draft_confirm(p_trip,p_expected,p_draft,p_draft_revision,p_job,p_crew)
$$;
revoke all on function public.gps_manual_visit_draft_save(uuid,uuid,integer,timestamp,timestamp,uuid,uuid[],text,boolean),
 dlight_private.gps_manual_visit_draft_save(uuid,uuid,integer,timestamp,timestamp,uuid,uuid[],text,boolean),
 public.gps_manual_visit_draft_confirm(uuid,integer,uuid,integer,uuid,uuid[]),
 dlight_private.gps_manual_visit_draft_confirm(uuid,integer,uuid,integer,uuid,uuid[])
 from public,anon,authenticated;
grant execute on function public.gps_manual_visit_draft_save(uuid,uuid,integer,timestamp,timestamp,uuid,uuid[],text,boolean),
 dlight_private.gps_manual_visit_draft_save(uuid,uuid,integer,timestamp,timestamp,uuid,uuid[],text,boolean),
 public.gps_manual_visit_draft_confirm(uuid,integer,uuid,integer,uuid,uuid[]),
 dlight_private.gps_manual_visit_draft_confirm(uuid,integer,uuid,integer,uuid,uuid[])
 to authenticated;

create function dlight_private.gps_manual_visit_drafts_follow_link() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 update public.gps_manual_visit_drafts set trip_id=new.trip_id where track_id=new.id and discarded_at is null;
 return new;
end $$;
revoke all on function dlight_private.gps_manual_visit_drafts_follow_link() from public,anon,authenticated;
create trigger gps_manual_visit_drafts_follow_link after update of trip_id on public.unassigned_tracks
 for each row when (new.trip_id is not null and old.trip_id is distinct from new.trip_id)
 execute function dlight_private.gps_manual_visit_drafts_follow_link();
notify pgrst,'reload schema';
