begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('order-result-photos','order-result-photos',false,8388608,array['image/jpeg']);

-- Once any report version references a photo, Storage cannot remove it.
create table dlight_private.order_result_photo_refs (
  object_id uuid primary key references storage.objects(id) on delete restrict,
  order_id uuid not null references public.service_orders(id) on delete cascade,
  trip_id uuid not null,
  work_id uuid not null
);
create index order_result_photo_refs_order_idx on dlight_private.order_result_photo_refs(order_id);
alter table dlight_private.order_result_photo_refs enable row level security;
revoke all on dlight_private.order_result_photo_refs from public,anon,authenticated;

create function dlight_private.order_photo_storage_access(p_path text,p_owner text,p_action text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  segments text[];
  task public.service_orders;
  visit uuid;
  work uuid;
  own boolean := coalesce(p_owner = auth.uid()::text,false);
  referenced boolean;
begin
  if auth.uid() is null or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  segments := string_to_array(p_path,'/');
  begin
    visit := segments[2]::uuid;
    work := segments[3]::uuid;
    select * into task from public.service_orders where id = segments[1]::uuid;
  exception when invalid_text_representation then return false;
  end;
  if task.id is null or dlight_private.order_access(task.id) is not true
    or dlight_private.responsibility_access('trip',visit) is not true then return false; end if;

  if p_action = 'read' then
    select exists(select 1 from dlight_private.order_result_photo_refs refs
      join storage.objects objects on objects.id = refs.object_id
      where refs.order_id = task.id and refs.trip_id = visit and refs.work_id = work
        and objects.bucket_id = 'order-result-photos' and objects.name = p_path) into referenced;
    return own or referenced;
  end if;

  return p_action = 'upload' and own and task.status in ('in_progress','paused','review')
    and (coalesce(dlight_private.responsibility_manager('order',task.id),false) or auth.uid() = any(task.engineer_ids))
    and exists(select 1 from public.trip_service_orders link join public.trips trip on trip.id = link.trip_id
      where link.order_id = task.id and link.trip_id = visit and trip.deleted_at is null and trip.status <> 'cancelled')
    and exists(select 1 from public.service_order_items item where item.id = work and item.order_id = task.id
      and item.kind = 'work' and item.request_finance_void_event_id is null
      and item.legacy_snapshot->>'request_finance_voided_at' is null);
end $$;
revoke all on function dlight_private.order_photo_storage_access(text,text,text) from public,anon,authenticated;
grant execute on function dlight_private.order_photo_storage_access(text,text,text) to authenticated;

create policy order_result_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'order-result-photos' and dlight_private.order_photo_storage_access(name,owner_id,'upload'));
create policy order_result_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'order-result-photos' and dlight_private.order_photo_storage_access(name,owner_id,'read'));

create function dlight_private.register_order_result_photos(p_order uuid,p_trip uuid,p_photos jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  photo jsonb;
  photo_id uuid;
  work uuid;
  file_name text;
  object_id uuid;
  photos jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos) > 100 then
    raise exception 'Проверьте список фотографий';
  end if;
  for photo in select value from jsonb_array_elements(p_photos) loop
    if coalesce(photo->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or coalesce(photo->>'work_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or jsonb_typeof(photo->'name') is distinct from 'string' then raise exception 'Проверьте данные фотографии'; end if;
    photo_id := (photo->>'id')::uuid;
    work := (photo->>'work_id')::uuid;
    file_name := btrim(photo->>'name');
    if length(file_name) not between 1 and 160 or exists (
      select 1 from jsonb_array_elements(photos) existing where existing->>'id' = photo_id::text
    ) then raise exception 'Проверьте название и список фотографий'; end if;
    if not exists(select 1 from public.service_order_items item where item.id = work and item.order_id = p_order
      and item.kind = 'work' and item.request_finance_void_event_id is null
      and item.legacy_snapshot->>'request_finance_voided_at' is null) then
      raise exception 'Работа для фотографии отсутствует в задании';
    end if;
    select objects.id into object_id from storage.objects objects
      where objects.bucket_id = 'order-result-photos'
        and objects.name = p_order::text || '/' || p_trip::text || '/' || work::text || '/' || photo_id::text || '.jpg'
        and ((objects.owner_id = auth.uid()::text and objects.created_at >= now() - interval '6 days')
          or exists(select 1 from dlight_private.order_result_photo_refs refs
          where refs.object_id = objects.id and refs.order_id = p_order and refs.trip_id = p_trip and refs.work_id = work))
      for key share;
    if not found then raise exception 'Фотография не загружена или недоступна'; end if;
    insert into dlight_private.order_result_photo_refs values(object_id,p_order,p_trip,work) on conflict do nothing;
    photos := photos || jsonb_build_array(jsonb_build_object('id',photo_id,'work_id',work,'name',file_name));
  end loop;
  return photos;
end $$;
revoke all on function dlight_private.register_order_result_photos(uuid,uuid,jsonb) from public,anon,authenticated;

alter function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  rename to order_trip_result_write_with_parts;
revoke all on function dlight_private.order_trip_result_write_with_parts(uuid,uuid,integer,integer,uuid,uuid,text,jsonb)
  from public,anon,authenticated;

create function dlight_private.order_trip_result_write(
  p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,p_expected_event uuid,
  p_operation uuid,p_action text,p_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt jsonb;
  photos jsonb;
  already_recorded boolean;
begin
  if dlight_private.order_access(p_order) is not true or dlight_private.responsibility_access('trip',p_trip) is not true then
    raise exception 'Нет доступа к заданию или выезду';
  end if;
  perform 1 from public.trips where id = p_trip for update;
  select exists(select 1 from dlight_private.order_trip_result_versions where operation_id = p_operation)
    into already_recorded;
  receipt := dlight_private.order_trip_result_write_with_parts(p_order,p_trip,p_order_revision,p_trip_revision,
    p_expected_event,p_operation,p_action,p_result);
  if already_recorded or p_action = 'returned' then return receipt; end if;
  if p_result ? 'photos' then
    photos := dlight_private.register_order_result_photos(p_order,p_trip,p_result->'photos');
  else
    select payload->'photos' into photos from dlight_private.order_trip_result_versions
      where operation_id = p_expected_event and order_id = p_order and trip_id = p_trip;
    if photos is null then return receipt; end if;
  end if;
  update dlight_private.order_trip_result_versions set payload = payload || jsonb_build_object('photos',photos)
    where operation_id = p_operation;
  return receipt;
end $$;

create or replace function public.service_order_trip_result_write(
  p_order uuid,p_trip uuid,p_order_revision integer,p_trip_revision integer,p_expected_event uuid,
  p_operation uuid,p_action text,p_result jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select dlight_private.order_trip_result_write(p_order,p_trip,p_order_revision,p_trip_revision,
    p_expected_event,p_operation,p_action,p_result)
$$;
revoke all on function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function dlight_private.order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb),
  public.service_order_trip_result_write(uuid,uuid,integer,integer,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.service_order_trip_results(p_order uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select dlight_private.order_trip_result_read(p_order) || jsonb_build_object('extra_parts_supported',true,
    'photos_supported',true,
    'extra_part_cost',coalesce((select sum(cost) from public.service_order_extra_part_costs where order_id = p_order),0))
$$;

create function public.order_result_photo_orphans() returns setof text
language sql stable security definer set search_path = '' as $$
  select object.name from storage.objects object
  where object.bucket_id = 'order-result-photos' and object.created_at < now() - interval '7 days'
    and not exists(select 1 from dlight_private.order_result_photo_refs refs where refs.object_id = object.id)
  order by object.created_at,object.id limit 500
$$;
revoke all on function public.order_result_photo_orphans() from public,anon,authenticated;
grant execute on function public.order_result_photo_orphans() to service_role;

notify pgrst, 'reload schema';
commit;
