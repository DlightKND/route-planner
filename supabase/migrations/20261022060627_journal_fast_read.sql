-- Same responsibility gate and snapshot as trip_workbench_read, without revision
-- history. Keep the privileged reader outside the exposed API schema.
create or replace function dlight_private.trip_journal_snapshot_read(p_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.trips;
begin
  if auth.uid() is null or not dlight_private.responsibility_manager('trip',p_trip) then
    raise exception 'Доступ только менеджеру';
  end if;
  select * into t from public.trips where id=p_trip and deleted_at is null;
  if not found then raise exception 'Выезд не найден'; end if;
  return jsonb_build_object('trip',to_jsonb(t),
    'job_ids',coalesce((select jsonb_agg(job_id order by ord,job_id) from public.trip_jobs where trip_id=p_trip),'[]'::jsonb),
    'stays',coalesce((select jsonb_agg(to_jsonb(s) order by s.stay_from) from public.trip_stays s where trip_id=p_trip),'[]'::jsonb),
    'removed',coalesce((select jsonb_agg(to_jsonb(h)) from public.trip_job_history h where h.trip_id=p_trip
       and not exists(select 1 from public.trip_jobs j where j.trip_id=p_trip and j.job_id=h.job_id)),'[]'::jsonb),
    'history','[]'::jsonb,'history_deferred',true);
end $$;
revoke all on function dlight_private.trip_journal_snapshot_read(uuid) from public,anon,authenticated;
grant execute on function dlight_private.trip_journal_snapshot_read(uuid) to authenticated;

create or replace function public.trip_journal_read(p_trip uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select dlight_private.trip_journal_snapshot_read(p_trip)
$$;
revoke all on function public.trip_journal_read(uuid) from public,anon,authenticated;
grant execute on function public.trip_journal_read(uuid) to authenticated;
