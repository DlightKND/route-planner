-- A migrated, completed trip can have no recorded crew while its requests
-- have a real assigned engineer. Do not invent crew or open the full trip.
-- Expose only schedule metadata, scoped to that engineer's linked request.
create function dlight_private.legacy_personal_schedule_read(p_trips uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'status',t.status,'date_from',t.date_from,'date_to',t.date_to,
    'started_at',t.started_at,'finished_at',t.finished_at,
    'lead_engineer',null,'engineer_ids','[]'::jsonb,'schedule_only',true,
    'day_plan',t.day_plan,
    'route_stops',coalesce((select jsonb_agg(jsonb_build_object(
      'type',s->'type','lat',s->'lat','lng',s->'lng') order by n)
      from jsonb_array_elements(coalesce(t.route_stops,'[]')) with ordinality x(s,n)),'[]'),
    'econ_snapshot',jsonb_build_object('driveH',t.econ_snapshot->'driveH',
      'legs',coalesce((select jsonb_agg(jsonb_build_object(
        'a',l->'a','b',l->'b','h',l->'h') order by n)
        from jsonb_array_elements(coalesce(t.econ_snapshot->'legs','[]')) with ordinality x(l,n)),'[]'))
  ) order by t.id),'[]'::jsonb)
  from public.trips t
  where auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role='engineer')
    and t.id=any(coalesce(p_trips,'{}'::uuid[]))
    and t.deleted_at is null and t.status in ('finished','done')
    and t.lead_engineer is null and cardinality(coalesce(t.engineer_ids,'{}'::uuid[]))=0
    and exists(select 1 from public.service_orders o where o.legacy_trip_id=t.id)
    and exists(select 1 from public.trip_jobs l join public.jobs j on j.id=l.job_id
      where l.trip_id=t.id and j.deleted_at is null
        and (j.assigned_engineer=auth.uid() or auth.uid()=any(coalesce(j.engineer_ids,'{}'::uuid[]))))
$$;
revoke all on function dlight_private.legacy_personal_schedule_read(uuid[]) from public,anon,authenticated;
grant execute on function dlight_private.legacy_personal_schedule_read(uuid[]) to authenticated;

create function public.legacy_personal_schedule_read(p_trips uuid[])
returns jsonb language sql stable security invoker set search_path='' as $$
  select dlight_private.legacy_personal_schedule_read(p_trips)
$$;
revoke all on function public.legacy_personal_schedule_read(uuid[]) from public,anon,authenticated;
grant execute on function public.legacy_personal_schedule_read(uuid[]) to authenticated;
