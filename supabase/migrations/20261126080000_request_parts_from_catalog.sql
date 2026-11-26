-- Request parts picked from the materials catalog (26.11.2026).
--
-- A part row in a request may now carry stock_catalog_id: the catalog position the
-- user picked. Such a row links to that position instead of creating a new one,
-- never rewrites the shared position, and engineers get the catalog price and cost
-- (they cannot set money themselves). Rows typed by hand keep the old behaviour:
-- their own catalog row is created and kept in step with the request.
--
-- The function body is patched in place so the many unrelated branches of
-- request_finance_save stay byte-for-byte what is running now; every replacement
-- must match exactly once or the migration fails.
do $migration$
declare
  def text := pg_get_functiondef('dlight_private.request_finance_save'::regproc);
  patch text[][] := array[
    array[
      'part_name text; part_sku text; part_unit text; part_qty numeric; part_price numeric; part_cost numeric;
begin',
      'part_name text; part_sku text; part_unit text; part_qty numeric; part_price numeric; part_cost numeric;
  pick_id uuid; picked boolean; repick boolean;
begin'
    ],
    array[
      'if item_id=any(kept) then raise exception ''Повтор строки материала''; end if;',
      'if item_id=any(kept) then raise exception ''Повтор строки материала''; end if;
      -- A position picked from the catalog: link it, take its money for engineers.
      pick_id:=nullif(item->>''stock_catalog_id'','''')::uuid; picked:=pick_id is not null; repick:=false;
      if picked then
        select * into stock from public.stock_catalog where id=pick_id;
        if not found then raise exception ''Позиция каталога не найдена''; end if;
        repick:=prior.id is null or prior.stock_catalog_id is distinct from pick_id;
        if repick and not stock.active then raise exception ''Позиция каталога в архиве''; end if;
        if repick and prior.id is not null and (prior.done_qty>0 or prior.transferred_qty>0 or prior.source_item_id is not null) then
          raise exception ''Нельзя менять номенклатуру строки с зафиксированным фактом'';
        end if;
        if not manager and repick then part_price:=coalesce(stock.price,0); part_cost:=coalesce(stock.cost,0); end if;
        catalog_id:=pick_id;
      end if;'
    ],
    array[
      '      if prior.id is null then
        insert into public.stock_catalog(name,sku,unit,price,cost,created_by,updated_by)',
      '      if picked then
        null;
      elsif prior.id is null or prior.legacy_snapshot->>''catalog_pick''=''true'' then
        insert into public.stock_catalog(name,sku,unit,price,cost,created_by,updated_by)'
    ],
    array[
      'billable,case when manager then now() else null end,case when manager then auth.uid() else null end,
          jsonb_build_object(''request_finance_generation'',1,''created_by'',auth.uid()));',
      'billable,case when manager then now() else null end,case when manager then auth.uid() else null end,
          jsonb_build_object(''request_finance_generation'',1,''created_by'',auth.uid(),''catalog_pick'',picked));'
    ],
    array[
      'unit_price_snapshot=case when manager then part_price else prior.unit_price_snapshot end,
          unit_cost_snapshot=case when manager then part_cost else prior.unit_cost_snapshot end,',
      'unit_price_snapshot=case when manager or repick then part_price else prior.unit_price_snapshot end,
          unit_cost_snapshot=case when manager or repick then part_cost else prior.unit_cost_snapshot end,'
    ],
    array[
      '||jsonb_build_object(''request_finance_generation'',1)
        where id=item_id;',
      '||jsonb_build_object(''request_finance_generation'',1,''catalog_pick'',picked)
        where id=item_id;'
    ]
  ];
  i int; hits int;
begin
  if position('pick_id uuid' in def)>0 then return; end if; -- already applied
  for i in 1..array_length(patch,1) loop
    hits := (length(def)-length(replace(def,patch[i][1],'')))/length(patch[i][1]);
    if hits<>1 then raise exception 'request_finance_save patch % matched % times',i,hits; end if;
    def := replace(def,patch[i][1],patch[i][2]);
  end loop;
  execute def;
end
$migration$;
