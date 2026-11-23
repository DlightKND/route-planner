-- Files attached to card comments (approved workflow mockup v65: «Прикрепить файлы» in every comment form).
-- Visibility follows the comment itself: the checks run as the caller, so each comment table's RLS applies.
begin;

insert into storage.buckets(id,name,public,file_size_limit)
  values('comment-files','comment-files',false,20971520)
  on conflict (id) do nothing;

create table public.comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_kind text not null check (comment_kind in ('job','order','trip','gps')),
  comment_id uuid not null,
  path text not null unique,
  name text not null check (length(btrim(name)) between 1 and 255),
  size bigint not null check (size between 0 and 20971520),
  mime text check (mime is null or length(mime) <= 255),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint comment_attachments_path_owner check (path like comment_kind||'/'||comment_id::text||'/%')
);
create index comment_attachments_comment_idx on public.comment_attachments(comment_kind,comment_id);
alter table public.comment_attachments enable row level security;
revoke all on public.comment_attachments from public,anon,authenticated;
grant select,insert on public.comment_attachments to authenticated;

-- Invoker functions: the caller's comment RLS decides visibility and authorship.
create function dlight_private.comment_visible(p_kind text,p_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case p_kind
    when 'job' then exists(select 1 from public.job_comments c where c.id = p_id)
    when 'order' then exists(select 1 from public.service_order_comments c where c.id = p_id)
    when 'trip' then exists(select 1 from public.trip_comments c where c.id = p_id)
    when 'gps' then exists(select 1 from public.gps_record_comments c where c.id = p_id)
    else false end
$$;

create function dlight_private.comment_authored(p_kind text,p_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and case p_kind
    when 'job' then exists(select 1 from public.job_comments c where c.id = p_id and c.author_id = auth.uid())
    when 'order' then exists(select 1 from public.service_order_comments c where c.id = p_id and c.author_id = auth.uid())
    when 'trip' then exists(select 1 from public.trip_comments c where c.id = p_id and c.author_id = auth.uid())
    when 'gps' then exists(select 1 from public.gps_record_comments c where c.id = p_id and c.author_id = auth.uid())
    else false end
$$;

-- Storage path: <kind>/<comment id>/<file id>-<name>. Malformed paths are rejected before any cast.
create function dlight_private.comment_file_upload_allowed(p_path text) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare
  parts text[];
begin
  if p_path !~ '^(job|order|trip|gps)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,255}$' then return false; end if;
  parts := string_to_array(p_path,'/');
  return dlight_private.comment_authored(parts[1],parts[2]::uuid);
end $$;

revoke all on function dlight_private.comment_visible(text,uuid) from public,anon,authenticated;
revoke all on function dlight_private.comment_authored(text,uuid) from public,anon,authenticated;
revoke all on function dlight_private.comment_file_upload_allowed(text) from public,anon,authenticated;
grant execute on function dlight_private.comment_visible(text,uuid) to authenticated;
grant execute on function dlight_private.comment_authored(text,uuid) to authenticated;
grant execute on function dlight_private.comment_file_upload_allowed(text) to authenticated;

create policy comment_attachments_read on public.comment_attachments for select to authenticated
  using (dlight_private.comment_visible(comment_kind,comment_id));
create policy comment_attachments_add on public.comment_attachments for insert to authenticated
  with check (created_by = (select auth.uid()) and dlight_private.comment_authored(comment_kind,comment_id)
    and exists(select 1 from storage.objects o where o.bucket_id = 'comment-files' and o.name = comment_attachments.path));

create policy comment_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'comment-files' and dlight_private.comment_file_upload_allowed(name));
create policy comment_files_read on storage.objects for select to authenticated
  using (bucket_id = 'comment-files' and (owner_id = (select auth.uid())::text
    or exists(select 1 from public.comment_attachments a where a.path = objects.name)));

commit;
