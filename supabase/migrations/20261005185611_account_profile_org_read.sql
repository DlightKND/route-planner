-- A self-only read endpoint. Engineers do not gain the employee directory or writes.
create or replace function public.account_org_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid(); own public.employee_org; result jsonb;
begin
  if caller is null or not exists(select 1 from public.profiles p where p.id=caller and p.active) then
    raise exception 'Требуется активная учётная запись' using errcode='42501';
  end if;
  select * into own from public.employee_org where profile_id=caller;
  select jsonb_build_object(
    'job_title',coalesce(own.job_title,''),
    'manager',(select jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,'job_title',coalesce(o.job_title,''))
      from public.profiles p left join public.employee_org o on o.profile_id=p.id
      where p.id=own.manager_id and p.active),
    'reports',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,'job_title',o.job_title) order by p.full_name,p.id)
      from public.employee_org o join public.profiles p on p.id=o.profile_id
      where o.manager_id=caller and p.active),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.account_org_read() from public,anon,authenticated;
grant execute on function public.account_org_read() to authenticated;
comment on function public.account_org_read() is 'Read only the authenticated active employee job title, direct manager and direct reports. No caller-supplied employee ID.';
