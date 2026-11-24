-- «Допуск» becomes «Сверхурочные»: approved overtime past the end of the working day.
-- By default nobody has approved overtime, so the company default is 0 h.
-- Individual days (staff_day.tol_h) keep the overtime already approved for them.

alter table public.settings alter column tolerance_h set default 0;
update public.settings set tolerance_h=0 where id;

do $patch$
declare source text; patched text;
begin
  source:=pg_get_functiondef('dlight_private.planner_window(uuid[],date,boolean)'::regprocedure);
  patched:=replace(source,'coalesce(staff.tol_h,(cfg->>''tolerance_h'')::numeric,1)','coalesce(staff.tol_h,(cfg->>''tolerance_h'')::numeric,0)');
  if patched=source then raise exception 'planner_window: overtime default patch did not apply'; end if;
  execute patched;
end $patch$;
