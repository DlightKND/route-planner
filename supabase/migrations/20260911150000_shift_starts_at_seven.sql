-- The operational shift starts at 07:00. The expanded day Gantt uses this
-- value for planning coordinates; its visible end remains independently
-- adjustable in the client.
update public.settings
set day_start = 7,
    updated_at = now()
where id = true
  and day_start is distinct from 7;
