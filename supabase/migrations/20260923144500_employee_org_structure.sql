-- Manager relationships and job titles for employees already represented by profiles.
begin;

create table public.employee_org (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  manager_id uuid references public.profiles(id) on delete restrict,
  job_title text not null default '' check (char_length(job_title)<=120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (manager_id is null or manager_id<>profile_id)
);
create index employee_org_manager_idx on public.employee_org(manager_id) where manager_id is not null;

insert into public.employee_org(profile_id)
select id from public.profiles
on conflict(profile_id) do nothing;

alter table public.employee_org enable row level security;
revoke all on public.employee_org from public,anon,authenticated;
grant select,insert,update on public.employee_org to authenticated;
create policy employee_org_manager_read on public.employee_org
  for select to authenticated
  using (coalesce(public.user_role() in ('admin','logist'),false));
create policy employee_org_admin_insert on public.employee_org
  for insert to authenticated with check (coalesce(public.user_role()='admin',false));
create policy employee_org_admin_update on public.employee_org
  for update to authenticated using (coalesce(public.user_role()='admin',false))
  with check (coalesce(public.user_role()='admin',false));

create function dlight_private.employee_org_validate() returns trigger
language plpgsql set search_path='' as $$
declare cyclic boolean;
begin
  new.job_title:=btrim(coalesce(new.job_title,''));
  if char_length(new.job_title)>120 then raise exception 'Должность не должна превышать 120 символов'; end if;
  if new.manager_id is not null then
    if new.manager_id=new.profile_id then raise exception 'Сотрудник не может быть руководителем самого себя'; end if;
    if not exists(select 1 from public.profiles p where p.id=new.manager_id and p.active) then
      raise exception 'Выбери активного руководителя';
    end if;
    with recursive chain(profile_id,manager_id,path) as (
      select e.profile_id,e.manager_id,array[e.profile_id]::uuid[]
      from public.employee_org e where e.profile_id=new.manager_id
      union all
      select e.profile_id,e.manager_id,c.path||e.profile_id
      from chain c join public.employee_org e on e.profile_id=c.manager_id
      where not e.profile_id=any(c.path)
    )
    select exists(select 1 from chain where profile_id=new.profile_id) into cyclic;
    if cyclic then raise exception 'Назначение создаёт цикл в структуре сотрудников'; end if;
  end if;
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  return new;
end $$;
revoke all on function dlight_private.employee_org_validate() from public,anon,authenticated;
create trigger employee_org_validate before insert or update on public.employee_org
for each row execute function dlight_private.employee_org_validate();

create function dlight_private.employee_org_seed_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.employee_org(profile_id) values(new.id) on conflict(profile_id) do nothing;
  return new;
end $$;
revoke all on function dlight_private.employee_org_seed_profile() from public,anon,authenticated;
create trigger profiles_employee_org_seed after insert on public.profiles
for each row execute function dlight_private.employee_org_seed_profile();

create function public.employee_org_save(
  p_profile uuid,p_full_name text,p_role public.user_role,p_job_title text,p_manager uuid
) returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.user_role()='admin',false) is not true then
    raise exception 'Только администратор изменяет структуру сотрудников';
  end if;
  if p_profile is null or nullif(btrim(coalesce(p_full_name,'')),'') is null then
    raise exception 'Укажи имя сотрудника';
  end if;
  if p_role::text not in ('admin','logist','engineer') then raise exception 'Недопустимая роль'; end if;
  if char_length(coalesce(p_job_title,''))>120 then raise exception 'Должность не должна превышать 120 символов'; end if;
  perform 1 from public.profiles where id=p_profile for update;
  if not found then raise exception 'Сотрудник не найден'; end if;
  insert into public.employee_org(profile_id,manager_id,job_title,updated_by)
  values(p_profile,p_manager,btrim(coalesce(p_job_title,'')),auth.uid())
  on conflict(profile_id) do update set manager_id=excluded.manager_id,job_title=excluded.job_title,updated_by=auth.uid();
  update public.profiles set full_name=btrim(p_full_name),role=p_role where id=p_profile;
end $$;
revoke all on function public.employee_org_save(uuid,text,public.user_role,text,uuid) from public,anon,authenticated;
grant execute on function public.employee_org_save(uuid,text,public.user_role,text,uuid) to authenticated;

commit;
