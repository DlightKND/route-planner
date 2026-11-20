begin;

-- Route accounting is versioned independently of GPS and accepted presence.
create table dlight_private.journal_road_state (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  revision integer not null,
  sections jsonb not null,
  cuts jsonb not null
);
create table dlight_private.journal_road_events (
  trip_id uuid not null references public.trips(id) on delete cascade,
  revision integer not null,
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  section_id text not null,
  action text not null,
  previous jsonb not null,
  current_value jsonb not null,
  primary key(trip_id,revision)
);
alter table dlight_private.journal_road_state enable row level security;
alter table dlight_private.journal_road_events enable row level security;
revoke all on dlight_private.journal_road_state,dlight_private.journal_road_events from public,anon,authenticated;

create function dlight_private.journal_road_sections(p_trip uuid,p_cuts jsonb)
returns table(id text,base_id text,title text,start_at timestamptz,end_at timestamptz,
  km numeric,measured_km numeric,request_id uuid,"returning" boolean)
language sql stable set search_path='' as $$
  with related as materialized (
    select dlight_private.payment_trip_jobs(p_trip) as job_id
  ), track as (
    select tt.data from public.trip_tracks tt where trip_id=p_trip
  ), segments as materialized (
    select s.n, (s.value->>'fromTs')::timestamptz as a,(s.value->>'toTs')::timestamptz as b,
      case when s.value->>'kind' in ('track','road') and jsonb_typeof(s.value->'km')='number'
           and (s.value->>'km')::numeric>=0 then (s.value->>'km')::numeric end as distance,
      s.value->>'why' like 'возвращение на финиш%' as finish
    from track cross join lateral jsonb_array_elements(
      case when jsonb_typeof(track.data->'segments')='array' then track.data->'segments' else '[]'::jsonb end
    ) with ordinality s(value,n)
    where pg_input_is_valid(s.value->>'fromTs','timestamp with time zone')
      and pg_input_is_valid(s.value->>'toTs','timestamp with time zone')
  ), extent as (
    select min(a) as start_at,max(b) as end_at,bool_or(finish) as depot,
      sum(distance) filter(where finish and a=b) as finish_km,
      bool_or(distance is null) filter(where finish and a=b) as finish_missing
    from segments where b>=a and isfinite(a) and isfinite(b)
  ), observed as (
    select stay.id,coalesce(gps.first,stay.stay_from) as a,coalesce(gps.last,stay.stay_to) as b,
      coalesce(nullif(client.name,''),'Остановка '||row_number() over(order by stay.stay_from,stay.id)) as name,
      case when stay.status='approved' then job.id end as request,
      stay.status='rejected' and stay.note ~ '^Остановка в пути([[:space:]·:.—]|$)' as technical
    from public.trip_stays stay
    left join public.jobs job on job.id=stay.job_id and job.id in (select job_id from related)
    left join public.clients client on client.id=job.client_id
    left join lateral (
      select min((part->>'from')::timestamptz) as first,max((part->>'to')::timestamptz) as last
      from jsonb_array_elements(case when jsonb_typeof(stay.presence_evidence->'gps_intervals')='array'
        then stay.presence_evidence->'gps_intervals' else '[]'::jsonb end) part
      where pg_input_is_valid(part->>'from','timestamp with time zone') and pg_input_is_valid(part->>'to','timestamp with time zone')
    ) gps on true
    where stay.trip_id=p_trip and stay.stay_to>stay.stay_from
      and (gps.first is not null or not (coalesce(stay.presence_evidence,'{}')?'gps_intervals'))
  ), stops as (
    select 'start' as key,start_at as a,start_at as b,'Начало записи' as name,null::uuid as request,false as technical,false as depot
    from extent where start_at is not null
    union all
    select id::text,greatest(a,e.start_at),least(b,e.end_at),name,request,coalesce(technical,false),false
    from observed cross join extent e where a<b and a<e.end_at and b>e.start_at
    union all
    select 'finish',end_at,end_at,case when depot then 'Депо' else 'Конец записи' end,null,false,coalesce(depot,false)
    from extent where end_at is not null
  ), linked as (
    select *,lag(key) over route as origin,lag(name) over route as origin_name,
      max(b) over (order by a,(key='finish'),b,key rows between unbounded preceding and 1 preceding) as depart
    from stops window route as (order by a,(key='finish'),b,key)
  ), bases as (
    select origin||'~'||key as base,depart as first,a as last,key='finish' as terminal,
      case when l.depot then 'Возврат в депо' else origin_name||' → '||name end as label,
      case when technical then (select s.request from stops s where not s.technical and s.a>=l.b order by s.a,(s.key='finish'),s.key limit 1) else request end as request,
      case when technical then (select s.depot from stops s where not s.technical and s.a>=l.b order by s.a,(s.key='finish'),s.key limit 1) else l.depot end as is_return
    from linked l cross join extent e
    where depart<a or (key='finish' and depart=a and (e.finish_km is not null or e.finish_missing))
  ), edges as (
    select base,first as at,false as cut from bases
    union all
    select base,to_timestamp(value::numeric),true from bases cross join lateral jsonb_array_elements_text(coalesce(p_cuts->base,'[]')) value
    where to_timestamp(value::numeric)>first and to_timestamp(value::numeric)<last
  ), spans as (
    select b.*,e.at as a,coalesce(lead(e.at) over(partition by b.base order by e.at),b.last) as z,
      e.cut from bases b join edges e using(base)
  ), intersections as (
    select r.base,r.a,greatest(r.a,s.a) as lo,least(r.z,s.b) as hi,s.a as sa,s.b as sb,s.distance,s.n
    from spans r join segments s on s.b>s.a and s.a<r.z and s.b>r.a
  ), coverage as (
    select *,greatest(lo,coalesce(max(hi) over(partition by base,a order by lo,n rows between unbounded preceding and 1 preceding),lo)) as used_from
    from intersections
  ), totals as (
    select base,a,sum(extract(epoch from (hi-used_from))) as seconds,
      sum(extract(epoch from (hi-used_from))) filter(where distance is not null) as known_seconds,
      sum(distance*extract(epoch from (hi-used_from))/extract(epoch from (sb-sa))) as distance
    from coverage where hi>used_from group by base,a
  ), distances as (
    select r.*,
      coalesce(t.known_seconds,0)=extract(epoch from (r.z-r.a))
        and not (r.terminal and r.z=r.last and coalesce(e.finish_missing,false)) as complete,
      coalesce(t.distance,0)+case when r.terminal and r.z=r.last then coalesce(e.finish_km,0) else 0 end as distance
    from spans r left join totals t on t.base=r.base and t.a=r.a cross join extent e
  ), rounded as (
    select *,round(sum(distance) over section,2)
      -coalesce(round(sum(distance) over preceding_sections,2),0) as measured
    from distances window section as (partition by base order by a rows unbounded preceding),
      preceding_sections as (partition by base order by a rows between unbounded preceding and 1 preceding)
  )
  select base||case when cut then '~'||extract(epoch from a)::bigint::text else '' end,
    base,label,a,z,case when complete then measured end,measured,request,coalesce(is_return,false)
  from rounded order by a,base;
$$;

-- Allocate cents-of-a-kilometre by cumulative boundaries to conserve the total.
create function dlight_private.journal_road_proportions(p_km numeric,p_weights jsonb)
returns jsonb language sql immutable set search_path='' as $$
  with sizes as (
    select key,round(p_km*sum(value::numeric) over(order by key)/nullif(sum(value::numeric) over(),0),2) as stop
    from jsonb_each_text(p_weights) where value::numeric>0
  ), pieces as (
    select key,stop-coalesce(lag(stop) over(order by key),0) as km from sizes
  )
  select coalesce(jsonb_object_agg(key,km) filter(where km>0),'{}') from pieces;
$$;

create function dlight_private.journal_road_model(p_trip uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  state dlight_private.journal_road_state;
  trip public.trips;
  track_at timestamptz;
  model jsonb;
  jobs jsonb;
  rows jsonb := '[]';
  weights jsonb := '{}';
  suggested jsonb;
  shares jsonb;
  stored jsonb;
  leg record;
  share record;
  total numeric;
  manager boolean;
  config jsonb;
begin
  select * into trip from public.trips where id=p_trip and deleted_at is null;
  if not found then raise exception 'Выезд недоступен'; end if;
  select updated_at into track_at from public.trip_tracks where trip_id=p_trip;
  select * into state from dlight_private.journal_road_state where trip_id=p_trip;
  model:=dlight_private.payment_trip_model(p_trip);
  jobs:=model->'jobs';
  manager:=dlight_private.responsibility_manager('trip',p_trip);
  if manager then
    config:=trip.tariffs_snapshot;
    if coalesce(config,'{}')='{}' then
      select jsonb_build_object('tariffs',tariffs,'costs',costs,'tariff_profiles',tariff_profiles) into config
      from public.settings where id=true;
    end if;
    select coalesce(jsonb_agg(job.value||jsonb_build_object('profiles',jsonb_build_object('paid',profiles.paid,'warranty',profiles.warranty))
        order by job.ordinality),'[]') into jobs
    from jsonb_array_elements(jobs) with ordinality job
    cross join lateral (
      select (array_agg(item.tariff_profile order by item.created_at,item.id) filter(where item.billable))[1] as paid,
        (array_agg(item.tariff_profile order by item.created_at,item.id) filter(where not item.billable))[1] as warranty
      from public.service_order_items item
      where item.job_id=(job.value->>'id')::uuid and item.kind='work' and nullif(item.tariff_profile,'') is not null
        and item.request_finance_void_event_id is null and item.legacy_snapshot->>'request_finance_voided_at' is null
    ) profiles;
    model:=jsonb_set(model,'{jobs}',jobs);
  end if;
  for leg in select * from dlight_private.journal_road_sections(p_trip,coalesce(state.cuts,'{}')) loop
    stored:=coalesce(state.sections->leg.id,'{}');
    suggested:='{}';
    if leg.km is not null then
      if leg."returning" then
        suggested:=case when jsonb_array_length(jobs)=1 and leg.km>0 then
          jsonb_build_object(jobs->0->>'id',leg.km) else dlight_private.journal_road_proportions(leg.km,weights) end;
      elsif leg.request_id is not null and leg.km>0 then
        suggested:=jsonb_build_object(leg.request_id::text,leg.km);
      end if;
    end if;
    select coalesce(jsonb_object_agg(allocated.key,allocated.value),'{}'),coalesce(sum(allocated.value::numeric),0)
      into shares,total from jsonb_each(coalesce(stored->'shares',suggested)) allocated
      where exists(select 1 from jsonb_array_elements(jobs) job where job->>'id'=allocated.key);
    if leg.km is null then shares:='{}';
    elsif total>leg.km then shares:=dlight_private.journal_road_proportions(leg.km,shares);
    end if;
    if not leg."returning" then
      for share in select key,value::numeric km from jsonb_each(shares) loop
        weights:=weights||jsonb_build_object(share.key,coalesce((weights->>share.key)::numeric,0)+share.km);
      end loop;
    end if;
    rows:=rows||jsonb_build_array(to_jsonb(leg)||jsonb_build_object(
      'shares',shares,'manual',stored?'shares','local',coalesce(stored->'terms','{}'),
      'rates',case when manager then coalesce(stored->'rates','{}') end));
  end loop;
  return jsonb_build_object('item',model,'scope','trip','sections',rows,
    'source',jsonb_build_array(trip.workbench_revision,extract(epoch from track_at)),'revision',coalesce(state.revision,0),
    'tariffs',config,'editable',trip.status<>'cancelled' and manager);
end $$;

create function dlight_private.journal_road_read(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if dlight_private.responsibility_access('trip',p_trip) is not true then raise exception 'Маршрут недоступен'; end if;
  return dlight_private.journal_road_model(p_trip);
end $$;

create function dlight_private.journal_road_exceptions(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  candidate record;
  model jsonb;
  rows jsonb:='[]';
  sections jsonb;
begin
  if p_scope is null or p_scope not in ('job','trip')
    or dlight_private.responsibility_access(p_scope,p_id) is not true then raise exception 'Условия оплаты недоступны'; end if;
  for candidate in
    select t.id from dlight_private.journal_road_state state join public.trips t on t.id=state.trip_id
    where t.deleted_at is null and (p_scope='trip' and t.id=p_id or p_scope='job'
      and p_id in (select dlight_private.payment_trip_jobs(t.id))) and dlight_private.responsibility_access('trip',t.id)
      and exists(select 1 from jsonb_each(state.sections) section where section.value?'terms')
  loop
    model:=dlight_private.journal_road_model(candidate.id);
    select coalesce(jsonb_agg(section-'rates'),'[]') into sections from jsonb_array_elements(model->'sections') section
    where section->'local'<>'{}' and (p_scope='trip' or (section->'shares')?p_id::text);
    if sections<>'[]' then
      rows:=rows||jsonb_build_array(jsonb_build_object('item',dlight_private.payment_trip_model(candidate.id),'sections',sections));
    end if;
  end loop;
  return rows;
end $$;

create function dlight_private.journal_road_save(p_trip uuid,p_id text,p_revision integer,p_source jsonb,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  trip public.trips;
  model jsonb;
  leg jsonb;
  state dlight_private.journal_road_state;
  prior jsonb;
  shares jsonb;
  next_shares jsonb;
  left_shares jsonb;
  right_id text;
  section_km numeric;
  left_km numeric;
  total numeric;
  cut bigint;
  member record;
  payer text;
begin
  if dlight_private.responsibility_manager('trip',p_trip) is not true then raise exception 'Участок изменяет куратор выезда'; end if;
  select * into trip from public.trips where id=p_trip and deleted_at is null for update;
  if not found or trip.status='cancelled' or dlight_private.responsibility_manager('trip',p_trip) is not true then
    raise exception 'Участок доступен только для просмотра';
  end if;
  perform 1 from public.trip_tracks where trip_id=p_trip for share;
  model:=dlight_private.journal_road_model(p_trip);
  if (model->>'revision')::integer is distinct from p_revision or model->'source' is distinct from p_source then
    raise exception 'Маршрут изменился. Обновите участки' using errcode='40001';
  end if;
  select item into leg from jsonb_array_elements(model->'sections') item where item->>'id'=p_id;
  if leg is null then raise exception 'Участок отсутствует в сохранённом маршруте'; end if;
  select * into state from dlight_private.journal_road_state where trip_id=p_trip;
  state.sections:=coalesce(state.sections,'{}');
  state.cuts:=coalesce(state.cuts,'{}');
  prior:=coalesce(state.sections->p_id,'{}');
  section_km:=(leg->>'km')::numeric;
  if p_action='terms' then
    if jsonb_typeof(p_value) is distinct from 'object' or (p_value-'payer'-'warranty')<>'{}'
      or (p_value?'warranty' and coalesce(p_value->>'warranty','') not in ('paid','warranty')) then
      raise exception 'Проверьте условия оплаты';
    end if;
    payer:=p_value->>'payer';
    if p_value?'payer' and coalesce(payer,'') not in ('warranty-dept','service') and not exists(
      select 1 from dlight_private.payment_trip_jobs(p_trip) job where payer='client:'||job::text
    ) then raise exception 'Выберите плательщика из связанных заявок'; end if;
    state.sections:=jsonb_set(state.sections,array[p_id],
      case when p_value='{}' then prior-'terms' else prior||jsonb_build_object('terms',p_value) end);
  elsif p_action='shares' then
    if section_km is null or jsonb_typeof(p_value) is distinct from 'object' then raise exception 'Пробег участка неизвестен'; end if;
    for member in select key,value from jsonb_each(p_value) loop
      if not exists(select 1 from dlight_private.payment_trip_jobs(p_trip) job where job::text=member.key)
        or jsonb_typeof(member.value)<>'number' or member.value::numeric<=0
        or member.value::numeric<>round(member.value::numeric,2) then raise exception 'Проверьте километры по заявкам'; end if;
    end loop;
    select coalesce(sum(value::numeric),0) into total from jsonb_each(p_value);
    if total>section_km then raise exception 'Распределено больше длины участка'; end if;
    state.sections:=jsonb_set(state.sections,array[p_id],prior||jsonb_build_object('shares',p_value));
  elsif p_action='rates' then
    if jsonb_typeof(p_value) is distinct from 'object' or (p_value-'cost'-'revenue')<>'{}' then
      raise exception 'Проверьте тарифы участка';
    end if;
    for member in select value from jsonb_each(p_value) loop
      if jsonb_typeof(member.value) is distinct from 'number' or member.value::numeric not between 0 and 1000000
        or member.value::numeric<>round(member.value::numeric,2) then raise exception 'Проверьте тарифы участка'; end if;
    end loop;
    state.sections:=jsonb_set(state.sections,array[p_id],
      case when p_value='{}' then prior-'rates' else prior||jsonb_build_object('rates',p_value) end);
  elsif p_action='split' then
    if jsonb_typeof(p_value) is distinct from 'number' or p_value::numeric<>trunc(p_value::numeric)
      or p_value::numeric<=extract(epoch from (leg->>'start_at')::timestamptz)
      or p_value::numeric>=extract(epoch from (leg->>'end_at')::timestamptz)
      or p_value::numeric%60<>0 then raise exception 'Выберите минуту внутри участка'; end if;
    cut:=p_value::bigint;
    right_id:=(leg->>'base_id')||'~'||cut;
    state.cuts:=jsonb_set(state.cuts,array[leg->>'base_id'],coalesce(state.cuts->(leg->>'base_id'),'[]')||to_jsonb(cut));
    state.sections:=jsonb_set(state.sections,array[right_id],prior);
    shares:=leg->'shares';
    if prior?'shares' and section_km>0 then
      select km into left_km from dlight_private.journal_road_sections(p_trip,state.cuts) where id=p_id;
      select coalesce(sum(value::numeric),0) into total from jsonb_each(shares);
      left_shares:=dlight_private.journal_road_proportions(round(total*left_km/section_km,2),shares);
      select coalesce(jsonb_object_agg(key,value::numeric-coalesce((left_shares->>key)::numeric,0))
        filter(where value::numeric>coalesce((left_shares->>key)::numeric,0)),'{}') into next_shares from jsonb_each(shares);
      state.sections:=jsonb_set(state.sections,array[p_id],prior||jsonb_build_object('shares',left_shares));
      state.sections:=jsonb_set(state.sections,array[right_id],prior||jsonb_build_object('shares',next_shares));
    end if;
  else raise exception 'Неизвестное изменение маршрута';
  end if;
  if p_action<>'split' and state.sections->p_id=prior then return model; end if;
  if state.sections->p_id='{}' then state.sections:=state.sections-p_id; end if;
  if right_id is not null and state.sections->right_id='{}' then state.sections:=state.sections-right_id; end if;
  state.revision:=p_revision+1;
  insert into dlight_private.journal_road_state values(p_trip,state.revision,state.sections,state.cuts)
    on conflict(trip_id) do update set revision=excluded.revision,sections=excluded.sections,cuts=excluded.cuts;
  insert into dlight_private.journal_road_events(trip_id,revision,actor_id,section_id,action,previous,current_value)
    values(p_trip,state.revision,auth.uid(),p_id,p_action,prior,
      jsonb_build_object('section',state.sections->p_id,'next',state.sections->right_id,'cut',cut));
  return dlight_private.journal_road_model(p_trip);
end $$;

create function public.journal_road_read(p_trip uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select dlight_private.journal_road_read(p_trip)
$$;
create function public.journal_road_save(p_trip uuid,p_id text,p_revision integer,p_source jsonb,p_action text,p_value jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select dlight_private.journal_road_save(p_trip,p_id,p_revision,p_source,p_action,p_value)
$$;
create function public.journal_road_exceptions(p_scope text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select dlight_private.journal_road_exceptions(p_scope,p_id)
$$;
revoke all on function dlight_private.journal_road_sections(uuid,jsonb),
  dlight_private.journal_road_proportions(numeric,jsonb),dlight_private.journal_road_model(uuid),
  dlight_private.journal_road_read(uuid),public.journal_road_read(uuid),
  dlight_private.journal_road_exceptions(text,uuid),public.journal_road_exceptions(text,uuid),
  dlight_private.journal_road_save(uuid,text,integer,jsonb,text,jsonb),public.journal_road_save(uuid,text,integer,jsonb,text,jsonb)
  from public,anon,authenticated;
grant execute on function dlight_private.journal_road_read(uuid),public.journal_road_read(uuid),
  dlight_private.journal_road_exceptions(text,uuid),public.journal_road_exceptions(text,uuid),
  dlight_private.journal_road_save(uuid,text,integer,jsonb,text,jsonb),public.journal_road_save(uuid,text,integer,jsonb,text,jsonb)
  to authenticated;

notify pgrst,'reload schema';
commit;
