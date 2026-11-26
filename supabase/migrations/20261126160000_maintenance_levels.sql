-- План ТО модели техники (26.11.2026).
-- Уровни ТО по моточасам: ТО-1 каждые 250 мч, ТО-2 каждые 500, ТО-3 каждые 1000.
-- Отметки считаются от нуля счётчика; на отметке делается старший уровень,
-- интервал которого её делит. У уровня может быть и календарный срок — что
-- наступит раньше. Работы и материалы уровня подставляются в заявку на ТО.

create table public.maintenance_levels (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.equipment_models(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  interval_hours numeric not null check (interval_hours > 0 and interval_hours <= 100000),
  interval_months integer check (interval_months between 1 and 120),
  works jsonb not null default '[]' check (jsonb_typeof(works) = 'array'),
  materials jsonb not null default '[]' check (jsonb_typeof(materials) = 'array'),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_id, interval_hours)
);
create index maintenance_levels_model on public.maintenance_levels(model_id);
alter table public.maintenance_levels enable row level security;
create policy maintenance_levels_read on public.maintenance_levels for select to authenticated using (public.is_staff());
create policy maintenance_levels_write on public.maintenance_levels for all to authenticated
  using (public.user_role() = any (array['admin','logist']))
  with check (public.user_role() = any (array['admin','logist']));
grant select, insert, update, delete on public.maintenance_levels to authenticated;

-- Какой уровень ТО сделан при этом замере (для замеров kind = 'service').
alter table public.equipment_readings
  add column maintenance_level_id uuid references public.maintenance_levels(id) on delete set null;
create index equipment_readings_level on public.equipment_readings(maintenance_level_id) where maintenance_level_id is not null;

-- Отметить проведённое ТО: замер моточасов с уровнем и дата ТО у техники.
-- Дату ТО напрямую менять нельзя (guard_equipment_service_dates), поэтому —
-- через эту функцию; доступна сотрудникам, инженер отмечает ТО по отчёту.
create or replace function public.record_equipment_service(
  p_equipment uuid, p_date date, p_moto_hours numeric, p_level uuid default null, p_job uuid default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare model uuid; rid uuid; prev numeric;
begin
  if not public.is_staff() then raise exception 'Нужен вход в систему'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Дата ТО не может быть в будущем'; end if;
  if p_moto_hours is null or p_moto_hours < 0 or p_moto_hours > 1000000 then raise exception 'Моточасы — число от 0'; end if;
  select e.model_id into model from equipment e where e.id = p_equipment and e.deleted_at is null;
  if not found then raise exception 'Техника не найдена'; end if;
  if p_level is not null and not exists(select 1 from maintenance_levels l where l.id = p_level and l.model_id = model) then
    raise exception 'Уровень ТО не относится к модели этой техники';
  end if;
  if p_job is not null and not exists(select 1 from jobs j where j.id = p_job and j.equipment_id = p_equipment) then
    raise exception 'Заявка относится к другой технике';
  end if;
  select r.moto_hours into prev from equipment_readings r
   where r.equipment_id = p_equipment and r.taken_on <= p_date order by r.taken_on desc, r.created_at desc limit 1;
  if prev is not null and p_moto_hours < prev then
    raise exception 'Моточасы % меньше прошлого замера (%)', p_moto_hours, prev;
  end if;
  insert into equipment_readings(equipment_id, taken_on, moto_hours, kind, note, job_id, created_by, maintenance_level_id)
  values (p_equipment, p_date, p_moto_hours, 'service', nullif(btrim(coalesce(p_note,'')),''), p_job, auth.uid(), p_level)
  on conflict (equipment_id, taken_on) do update
    set moto_hours = excluded.moto_hours, kind = 'service', note = coalesce(excluded.note, equipment_readings.note),
        job_id = coalesce(excluded.job_id, equipment_readings.job_id), maintenance_level_id = excluded.maintenance_level_id
  returning id into rid;
  update equipment set last_service = greatest(coalesce(last_service, '1900-01-01'::date), p_date) where id = p_equipment;
  return rid;
end; $function$;
revoke all on function public.record_equipment_service(uuid, date, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.record_equipment_service(uuid, date, numeric, uuid, uuid, text) to authenticated;
