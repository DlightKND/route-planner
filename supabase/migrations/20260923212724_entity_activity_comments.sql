begin;

-- Separate immutable comments from editable request/task/trip notes. Each
-- table keeps a real foreign key to its owning business entity.
create table public.job_comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  author_id uuid,
  created_at timestamptz not null default now(),
  body text not null check (length(trim(body)) between 1 and 4000)
);
create index job_comments_timeline_idx on public.job_comments(job_id,created_at desc,id desc);

create table public.service_order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  author_id uuid,
  created_at timestamptz not null default now(),
  body text not null check (length(trim(body)) between 1 and 4000)
);
create index service_order_comments_timeline_idx on public.service_order_comments(order_id,created_at desc,id desc);

create table public.trip_comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid,
  created_at timestamptz not null default now(),
  body text not null check (length(trim(body)) between 1 and 4000)
);
create index trip_comments_timeline_idx on public.trip_comments(trip_id,created_at desc,id desc);

-- The database supplies comment identity and time; a client cannot post in
-- another user's name or backdate an entry.
create function dlight_private.stamp_activity_comment() returns trigger
language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Войдите, чтобы оставить комментарий'; end if;
  new.author_id:=auth.uid();
  new.created_at:=now();
  new.body:=trim(new.body);
  return new;
end $$;
revoke all on function dlight_private.stamp_activity_comment() from public,anon,authenticated;

create trigger job_comments_stamp before insert on public.job_comments
for each row execute function dlight_private.stamp_activity_comment();
create trigger service_order_comments_stamp before insert on public.service_order_comments
for each row execute function dlight_private.stamp_activity_comment();
create trigger trip_comments_stamp before insert on public.trip_comments
for each row execute function dlight_private.stamp_activity_comment();

alter table public.job_comments enable row level security;
alter table public.service_order_comments enable row level security;
alter table public.trip_comments enable row level security;
revoke all on public.job_comments,public.service_order_comments,public.trip_comments from public,anon,authenticated;
grant select,insert on public.job_comments,public.service_order_comments,public.trip_comments to authenticated;

create policy job_comments_read on public.job_comments for select to authenticated
  using (coalesce(public.user_role() in ('admin','logist','engineer'),false));
create policy job_comments_add on public.job_comments for insert to authenticated
  with check (auth.uid() is not null and coalesce(public.user_role() in ('admin','logist','engineer'),false));

create policy service_order_comments_read on public.service_order_comments for select to authenticated
  using (dlight_private.order_access(order_id));
create policy service_order_comments_add on public.service_order_comments for insert to authenticated
  with check (dlight_private.order_access(order_id) and auth.uid() is not null);

create policy trip_comments_read on public.trip_comments for select to authenticated
  using (exists(select 1 from public.trips t where t.id=trip_id and coalesce(
    public.user_role() in ('admin','logist') or t.lead_engineer=auth.uid()
    or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])),false)));
create policy trip_comments_add on public.trip_comments for insert to authenticated
  with check (auth.uid() is not null and exists(select 1 from public.trips t where t.id=trip_id and coalesce(
    public.user_role() in ('admin','logist') or t.lead_engineer=auth.uid()
    or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])),false)));

-- Requests previously had no audit history. Store changed values as well as
-- the new snapshot; never invent an initial history for data predating this
-- trigger.
create table public.job_history (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  actor_id uuid,
  recorded_at timestamptz not null default now(),
  event text not null,
  changed_fields jsonb not null default '{}',
  snapshot jsonb not null
);
create index job_history_timeline_idx on public.job_history(job_id,recorded_at desc,id desc);
alter table public.job_history enable row level security;
revoke all on public.job_history from public,anon,authenticated;
grant select on public.job_history to authenticated;
create policy job_history_read on public.job_history for select to authenticated
  using (coalesce(public.user_role() in ('admin','logist','engineer'),false));
revoke all on sequence public.job_history_id_seq from public,anon,authenticated;

create function dlight_private.audit_job_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_data jsonb; new_data jsonb; delta jsonb:='{}'::jsonb; k text; event_text text;
begin
  new_data:=to_jsonb(new)-array['updated_at'];
  if tg_op='INSERT' then
    event_text:='Создана заявка';
  else
    old_data:=to_jsonb(old)-array['updated_at'];
    if old_data is not distinct from new_data then return new; end if;
    for k in select jsonb_object_keys(new_data) loop
      if old_data->k is distinct from new_data->k then
        delta:=delta||jsonb_build_object(k,jsonb_build_object('from',old_data->k,'to',new_data->k));
      end if;
    end loop;
    event_text:=case when old.status is distinct from new.status
      then 'Статус: '||old.status::text||' → '||new.status::text
      else 'Обновлены данные заявки' end;
  end if;
  insert into public.job_history(job_id,actor_id,event,changed_fields,snapshot)
    values(new.id,auth.uid(),event_text,delta,new_data);
  return new;
end $$;
revoke all on function dlight_private.audit_job_activity() from public,anon,authenticated;
create trigger jobs_activity_history after insert or update on public.jobs
for each row execute function dlight_private.audit_job_activity();

-- Assigned engineers can see the trip's version timeline just as they can
-- read the trip. The route's RPC still decides who may edit the plan.
drop policy if exists trip_history_manager on public.trip_revision_history;
create policy trip_history_read on public.trip_revision_history for select to authenticated
  using (exists(select 1 from public.trips t where t.id=trip_id and coalesce(
    public.user_role() in ('admin','logist') or t.lead_engineer=auth.uid()
    or auth.uid()=any(coalesce(t.engineer_ids,'{}'::uuid[])),false)));

commit;
