begin;

create function dlight_private.journal_road_split_preview(
  p_trip uuid,p_id text,p_revision integer,p_source jsonb,p_at bigint
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  model jsonb;
  leg jsonb;
  cuts jsonb;
  base text;
  quote jsonb;
begin
  if dlight_private.responsibility_manager('trip',p_trip) is not true then
    raise exception 'Участок изменяет куратор выезда';
  end if;
  model:=dlight_private.journal_road_model(p_trip);
  if (model->>'editable')::boolean is not true then raise exception 'Участок доступен только для просмотра'; end if;
  if (model->>'revision')::integer is distinct from p_revision or model->'source' is distinct from p_source then
    raise exception 'Маршрут изменился. Обновите участки' using errcode='40001';
  end if;
  select item into leg from jsonb_array_elements(model->'sections') item where item->>'id'=p_id;
  if leg is null or p_at is null or p_at%60<>0
    or p_at<=extract(epoch from (leg->>'start_at')::timestamptz)
    or p_at>=extract(epoch from (leg->>'end_at')::timestamptz) then
    raise exception 'Выберите минуту внутри участка';
  end if;
  base:=leg->>'base_id';
  select state.cuts into cuts from dlight_private.journal_road_state state where state.trip_id=p_trip;
  cuts:=jsonb_set(coalesce(cuts,'{}'),array[base],coalesce(cuts->base,'[]')||to_jsonb(p_at));
  select jsonb_build_object('left',max(km) filter(where id=p_id),'right',max(km) filter(where id=base||'~'||p_at))
    into quote from dlight_private.journal_road_sections(p_trip,cuts);
  return quote;
end $$;

create function public.journal_road_split_preview(
  p_trip uuid,p_id text,p_revision integer,p_source jsonb,p_at bigint
) returns jsonb language sql stable security invoker set search_path='' as $$
  select dlight_private.journal_road_split_preview(p_trip,p_id,p_revision,p_source,p_at)
$$;

revoke all on function dlight_private.journal_road_split_preview(uuid,text,integer,jsonb,bigint),
  public.journal_road_split_preview(uuid,text,integer,jsonb,bigint) from public,anon,authenticated;
grant execute on function dlight_private.journal_road_split_preview(uuid,text,integer,jsonb,bigint),
  public.journal_road_split_preview(uuid,text,integer,jsonb,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
