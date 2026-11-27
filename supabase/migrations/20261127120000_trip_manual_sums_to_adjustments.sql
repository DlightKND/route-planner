-- The old trip card kept a manual revenue in trips.overrides. The plan/fact
-- card reads only finance_adjustments, so move each manual revenue into the
-- revenue corrections of the trip. The old field stays as it is: the
-- dashboard snapshot already includes it.
with manual as (
  select t.id, round((t.overrides->>'revenue')::numeric, 2) as amount,
         coalesce(t.curator_id, t.owner_id) as actor
  from public.trips t
  where t.deleted_at is null and t.status <> 'cancelled'
    and nullif(t.overrides->>'revenue', '') is not null
), subjects as (
  select m.*, s.subject from manual m cross join (values ('plan:revenue'), ('fact:revenue')) s(subject)
  where not exists (select 1 from dlight_private.finance_adjustments a
                    where a.scope = 'trip' and a.owner_id = m.id and a.subject = s.subject)
), added as (
  insert into dlight_private.finance_adjustments(scope, owner_id, subject, value)
  select 'trip', id, subject, jsonb_build_object('value', amount, 'reason', 'Договорная сумма из старой карточки выезда')
  from subjects
  returning owner_id, subject, value
)
insert into dlight_private.finance_adjustment_events(scope, owner_id, subject, actor_id, previous, new_value)
select 'trip', a.owner_id, a.subject, s.actor, '{}'::jsonb, a.value
from added a join subjects s on s.id = a.owner_id and s.subject = a.subject
where s.actor is not null;
