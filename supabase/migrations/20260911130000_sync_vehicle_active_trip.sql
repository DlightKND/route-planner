-- Keep the operational vehicle_state pointer in sync with the tracking
-- session. The session is authoritative, while vehicle_state is the cheap
-- read model used by the map and vehicle modal.

create or replace function public.sync_vehicle_active_trip()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.state in ('active','finish_candidate') then
    update public.vehicle_state
       set trip_id=new.trip_id
     where vehicle_id=new.vehicle_id
       and trip_id is distinct from new.trip_id;
  elsif old.state in ('active','finish_candidate')
        and new.state in ('closed','cancelled','reassigned') then
    update public.vehicle_state
       set trip_id=null
     where vehicle_id=new.vehicle_id
       and trip_id=new.trip_id;
  end if;
  return new;
end $$;

drop trigger if exists trip_tracking_vehicle_state_sync on public.trip_tracking_sessions;
create trigger trip_tracking_vehicle_state_sync
after insert or update of state,trip_id on public.trip_tracking_sessions
for each row execute function public.sync_vehicle_active_trip();

-- Repair sessions which were already active before this trigger existed.
with current_session as (
  select distinct on (vehicle_id) vehicle_id,trip_id
    from public.trip_tracking_sessions
   where state in ('active','finish_candidate')
   order by vehicle_id,actual_started_at desc nulls last,planned_start_at desc
)
update public.vehicle_state v
   set trip_id=s.trip_id
  from current_session s
 where s.vehicle_id=v.vehicle_id
   and v.trip_id is distinct from s.trip_id;
