-- A closing moment only shortens the plan. Results are often entered days after the work
-- (task 42: work on 29.10, sent for review on 02.11), so a later closing moment says nothing
-- about when the crew was free and must not push the rest of the trip.

do $patch$
declare source text; patched text;
begin
  source:=pg_get_functiondef('dlight_private.planner_place(jsonb,date,numeric,uuid[],boolean,jsonb)'::regprocedure);
  patched:=replace(source,'and (finish_d,finish_h)>((parts->0->>''date'')::date,(parts->0->>''start'')::numeric) then',
    'and (finish_d,finish_h)>((parts->0->>''date'')::date,(parts->0->>''start'')::numeric)
     and (finish_d,finish_h)<((parts->(jsonb_array_length(parts)-1)->>''date'')::date,(parts->(jsonb_array_length(parts)-1)->>''end'')::numeric) then');
  if patched=source then raise exception 'planner_place: early-only patch did not apply'; end if;
  execute patched;
end $patch$;
