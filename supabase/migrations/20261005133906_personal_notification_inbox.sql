-- Personal inbox, independent of delivery subscriptions. Preserve source RLS.
create table public.notification_read_state (
  recipient_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  notice_id text not null check (length(notice_id) between 1 and 100),
  read_at timestamptz not null default now(),
  primary key (recipient_id,notice_id)
);
alter table public.notification_read_state enable row level security;
revoke all on public.notification_read_state from public,anon,authenticated;
grant select,delete on public.notification_read_state to authenticated;
grant insert(recipient_id,notice_id,read_at),update(read_at) on public.notification_read_state to authenticated;
create policy notification_read_own on public.notification_read_state for select to authenticated
using (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));
create policy notification_insert_own on public.notification_read_state for insert to authenticated
with check (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active)
  and (exists(select 1 from public.entity_push_events e where 'event:'||e.id::text=notice_id and e.recipient_id=(select auth.uid()))
    or exists(select 1 from public.push_log l where 'push:'||l.id::text=notice_id and l.user_id=(select auth.uid()) and l.ok)));
create policy notification_update_own on public.notification_read_state for update to authenticated
using (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active))
with check (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));
create policy notification_delete_own on public.notification_read_state for delete to authenticated
using (recipient_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));

create index push_log_personal_inbox_idx on public.push_log(user_id,sent_at desc,id) where ok;
create view public.notification_inbox with (security_invoker=true) as
select n.*,r.read_at,n.title||' '||n.body as search_text
from (
 select 'event:'||e.id::text as id,e.recipient_id,e.entity_kind,e.entity_id,e.title,e.body,e.created_at,'event'::text as source
 from public.entity_push_events e where e.recipient_id=(select auth.uid())
 union all
 select 'push:'||l.id::text,l.user_id,'trip'::text,l.trip_id,
 case l.kind when 'trip_today' then 'Выезд сегодня' when 'trip_move' then 'Изменение даты выезда'
 when 'trip_late' then 'Задержка выезда' when 'trip_start_late' then 'Выезд не начат вовремя'
 when 'trip_escalated' then 'Выезд требует внимания' when 'trip_auto_started' then 'Выезд начат автоматически'
 when 'trip_finish_candidate' then 'Проверьте завершение выезда' else 'Напоминание о выезде' end,
 'Отправлено напоминание'||case when l.on_date is null then '.' else ' на '||to_char(l.on_date,'DD.MM.YYYY')||'.' end,
 l.sent_at,'push'::text from public.push_log l where l.user_id=(select auth.uid()) and l.ok
) n left join public.notification_read_state r on r.recipient_id=n.recipient_id and r.notice_id=n.id
where exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active);
revoke all on public.notification_inbox from public,anon;
grant select on public.notification_inbox to authenticated;

create function public.notification_set_read(p_id text,p_read boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.notification_inbox where id=p_id) then
    raise exception 'Уведомление недоступно' using errcode='42501';
  end if;
  if p_read then
    insert into public.notification_read_state(recipient_id,notice_id,read_at) values(auth.uid(),p_id,now())
    on conflict(recipient_id,notice_id) do update set read_at=excluded.read_at;
  else
    delete from public.notification_read_state where recipient_id=auth.uid() and notice_id=p_id;
  end if;
end $$;
create function public.notification_mark_all_read(p_before timestamptz default now())
returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
  insert into public.notification_read_state(recipient_id,notice_id,read_at)
  select recipient_id,id,now() from public.notification_inbox where read_at is null and created_at<=least(now(),p_before)
  on conflict(recipient_id,notice_id) do update set read_at=excluded.read_at;
  get diagnostics affected=row_count;
  return affected;
end $$;
revoke all on function public.notification_set_read(text,boolean),public.notification_mark_all_read(timestamptz) from public,anon;
grant execute on function public.notification_set_read(text,boolean),public.notification_mark_all_read(timestamptz) to authenticated;
