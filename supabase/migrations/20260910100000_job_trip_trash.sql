-- Seven-day recycle bin for jobs and trips.
create index if not exists jobs_deleted_at_idx on public.jobs (deleted_at) where deleted_at is not null;
create index if not exists trips_deleted_at_idx on public.trips (deleted_at) where deleted_at is not null;

create or replace function public.trash_restore(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для восстановления';
  end if;
  if p_kind = 'jobs' then
    update public.jobs set deleted_at = null where id = p_id and deleted_at is not null;
  elsif p_kind = 'trips' then
    update public.trips set deleted_at = null where id = p_id and deleted_at is not null;
  else
    raise exception 'Неизвестный раздел корзины: %', p_kind;
  end if;
end;
$$;

create or replace function public.trash_delete_forever(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.user_role() not in ('admin','logist') then
    raise exception 'Недостаточно прав для окончательного удаления';
  end if;
  if p_kind = 'jobs' then
    delete from public.jobs where id = p_id and deleted_at is not null;
  elsif p_kind = 'trips' then
    -- Исторические точки принадлежат выезду, хотя FK раньше только отвязывал
    -- их. При окончательном удалении корзина не оставляет анонимный трек.
    delete from public.vehicle_positions where trip_id = p_id;
    update public.vehicle_state set trip_id = null where trip_id = p_id;
    delete from public.trips where id = p_id and deleted_at is not null;
  else
    raise exception 'Неизвестный раздел корзины: %', p_kind;
  end if;
end;
$$;

-- Called only by the scheduled Edge Function after it removes physical
-- objects from Storage. Keeping storage cleanup outside SQL prevents orphaned
-- files: deleting storage.objects directly removes metadata, not the object.
create or replace function public.trash_purge_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_jobs integer := 0;
  n_trips integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trash_purge_due вызывается только служебной функцией';
  end if;
  delete from public.vehicle_positions vp using public.trips t
    where vp.trip_id = t.id and t.deleted_at <= now() - interval '7 days';
  update public.vehicle_state vs set trip_id = null
    from public.trips t where vs.trip_id = t.id and t.deleted_at <= now() - interval '7 days';
  delete from public.trips where deleted_at <= now() - interval '7 days';
  get diagnostics n_trips = row_count;
  delete from public.jobs where deleted_at <= now() - interval '7 days';
  get diagnostics n_jobs = row_count;
  return jsonb_build_object('jobs',n_jobs,'trips',n_trips);
end;
$$;

revoke all on function public.trash_restore(text,uuid) from public;
revoke all on function public.trash_delete_forever(text,uuid) from public;
revoke all on function public.trash_purge_due() from public;
grant execute on function public.trash_restore(text,uuid) to authenticated;
grant execute on function public.trash_delete_forever(text,uuid) to authenticated;
grant execute on function public.trash_purge_due() to service_role;

do $$
declare old_job bigint;
begin
  select jobid into old_job from cron.job where jobname = 'trash-purge-daily';
  if old_job is not null then perform cron.unschedule(old_job); end if;
  perform cron.schedule(
    'trash-purge-daily', '10 3 * * *',
    $cron$select net.http_post(
      url := 'https://anqfbljgfimoaziztdxe.supabase.co/functions/v1/trash-purge',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-trash-secret',(select decrypted_secret from vault.decrypted_secrets where name='trash_purge_secret' limit 1)
      ),
      body := '{}'::jsonb
    )$cron$
  );
end $$;
