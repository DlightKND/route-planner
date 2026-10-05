import {Window} from 'happy-dom';

it('requires preparation of an open request before task execution and keeps the source link available',async()=>{
 order.status='assigned';order.jobs.status='open';order.date_from='2026-10-04';order.date_to='2026-10-05';
 await ui.open('order1');const button=doc.querySelector('[data-order-next="in_progress"]');
 expect(button.disabled).toBe(true);expect(button.title).toContain('Сначала подготовь заявку');
 doc.getElementById('orderRequest').click();expect(ctx.openJob).toHaveBeenCalledWith(job);expect(rpcCalls).toHaveLength(0);
 for(const status of ['planned','in_progress']){order.jobs.status=status;await ui.open('order1');expect(doc.querySelector('[data-order-next="in_progress"]').disabled).toBe(false);}
});
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createServiceOrders,nextOrderStates,remainingQty,visibleTripCount,materialTotals,workTotals} from '../src/service-orders.js';
let win,doc,ui,ctx,rpcCalls,order,stock,works,taskProfiles,selectCalls,settingsCalls,tripChoices;
const person='00000000-0000-4000-8000-000000000003',job='00000000-0000-4000-8000-000000000010';
beforeEach(()=>{win=new Window();doc=win.document;stock=[];works=[];taskProfiles=[];tripChoices=[];selectCalls=[];settingsCalls=0;vi.stubGlobal('window',win);vi.stubGlobal('document',doc);doc.body.innerHTML='<input id="orderSearch"><select id="orderEngineer"></select><input id="orderClosed"><input id="orderHistorical" type="checkbox"><div id="orderHistoricalNote"></div><select id="orderViewMode"><option value="kanban">Канбан</option><option value="list">Список</option></select><button id="orderScopeClear"></button><button id="orderAdd"></button><div id="orderList"></div><div id="orderScope"></div><div id="orderScopeText"></div><div id="orderEditor"></div>';
 order={id:'order1',number:1,title:'Ремонт',status:'in_progress',work_mode:'onsite',job_id:job,seed_request_id:job,jobs:{clients:{name:'Клиент'}},engineer_ids:[person],lead_engineer:person,revision:2,service_order_items:[{id:'item1',job_id:job,title:'Насосы',unit:'шт',planned_qty:2,done_qty:0,transferred_qty:0}],trip_service_orders:[]};rpcCalls=[];
 const db={from:table=>{const data=table==='trips'?structuredClone(tripChoices):table==='jobs'?[{id:job,clients:{name:'Клиент'},at_depot:false}]:table==='service_orders'?[structuredClone(order)]:table==='stock_catalog'?structuredClone(stock):table==='work_catalog'?structuredClone(works):table==='settings'?[{tariff_profiles:structuredClone(taskProfiles)}]:[];const b={select:query=>{if(table==='service_orders')selectCalls.push(query);return b;},is:()=>b,order:()=>b,eq:()=>b,not:()=>b,limit:()=>b,single:()=>{if(table==='settings'){settingsCalls++;if(!ctx.canWrite())return Promise.resolve({data:null,error:{message:'Cannot coerce the result to a single JSON object'}});}return Promise.resolve({data:data[0],error:null});},then:(resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject)};return b;},rpc:async(fn,args)=>{rpcCalls.push({fn,args});return {data:fn==='service_order_save_one'?'order1':3,error:null};}};
 ctx={db:()=>db,canWrite:()=>true,role:()=>ctx.canWrite()?'admin':'engineer',userId:()=>person,profiles:()=>[{id:person,full_name:'Анна',role:'engineer',active:true}],ensureRefs:async()=>{},isPhone:()=>false,wireDrag:vi.fn(),notify:vi.fn(),showBoard:vi.fn(),showOrder:vi.fn(),openJob:vi.fn(),openTrip:vi.fn(),tripStatus:s=>s,confirmLeave:()=>false,reason:async()=>null};ui=createServiceOrders(ctx);ui.init();});
afterEach(async()=>{await win.happyDOM.close();vi.unstubAllGlobals();});
it('explains stage prerequisites before calling the server and prevents closing over an active shared trip',async()=>{
 order.status='draft';order.engineer_ids=[];order.lead_engineer=null;await ui.open('order1');
 expect(doc.querySelector('[data-order-next="assigned"]').disabled).toBe(true);
 expect(doc.querySelector('[data-order-next="assigned"]').title).toContain('команда');
 order.status='review';order.service_order_items[0].done_qty=2;
 order.trip_service_orders=[{trips:{id:'shared-trip',status:'in_progress',deleted_at:null}}];
 await ui.open('order1');expect(doc.querySelector('[data-order-next="completed"]').disabled).toBe(true);
 expect(doc.querySelector('[data-order-next="completed"]').title).toContain('связанные выезды');
 order.trip_service_orders[0].trips.status='done';await ui.open('order1');
 expect(doc.querySelector('[data-order-next="completed"]').disabled).toBe(false);
});
it('does not count transferred or voided work and material lines as completed work',async()=>{
 order.service_order_items=[
  {id:'full',kind:'work',title:'Full',planned_qty:2,done_qty:2,transferred_qty:0},
  {id:'carry',kind:'work',title:'Carry',planned_qty:2,done_qty:0,transferred_qty:2},
  {id:'partial',kind:'work',title:'Partial',planned_qty:2,done_qty:1,transferred_qty:1},
  {id:'material',kind:'material',planned_qty:4,done_qty:4},
  {id:'void',kind:'work',planned_qty:1,done_qty:0,request_finance_void_event_id:'void'}
 ];await ui.board();
 const text=doc.querySelector('.kcard').textContent;
 expect(text).toContain('1 из 3 работ выполнено');expect(text).toContain('частично 1');
 expect(text).toContain('остаток перенесён по 2 работам');expect(text).toContain('материалов использовано 1 из 1');
});
it('opens the source request even from the global task board and clears a stale request scope',async()=>{
 await ui.open('order1',job);await ui.open('order1');
 expect(doc.getElementById('orderBack').textContent).toBe('Диспетчер → задания');
 doc.getElementById('orderRequest').click();expect(ctx.openJob).toHaveBeenCalledWith(job);
});
it('keeps the request filter when opening a task from its filtered board',async()=>{
 await ui.open('order1',job);await ui.board();
 await doc.querySelector('[data-order-open]').onclick({stopPropagation(){}});
 expect(doc.getElementById('orderBack').textContent).toBe('Заявка → задания');
});
it('shows task children immediately inside a request while keeping kanban children collapsed',async()=>{
 doc.body.insertAdjacentHTML('beforeend','<section id="jobOrders"></section>');
 await ui.requestPanel(job);expect(doc.querySelector('#jobOrders details').open).toBe(true);
 expect(doc.querySelector('#jobOrders [data-order-new]').textContent).toContain('Создать задание');
});
it('does not open a task or load its data when the trip leave guard is declined',async()=>{
 await ui.open('order1');ctx.beforeOpen=vi.fn(()=>false);ctx.ensureRefs=vi.fn();
 await ui.open(null,job);expect(ctx.beforeOpen).toHaveBeenCalledOnce();
 expect(ctx.ensureRefs).not.toHaveBeenCalled();expect(doc.querySelector('h2').textContent).toBe('Задание №1');
});
it('guards expense links and disables stage actions while the task result is unsaved',async()=>{
 ctx.tripCostSummary=vi.fn(async()=>[{trip_id:'trip1',distance_cost:120}]);ctx.confirmLeave=vi.fn(()=>false);
 await ui.open('order1');await new Promise(r=>setTimeout(r,0));
 doc.querySelector('[data-result-qty]').value='1';doc.querySelector('[data-result-qty]').dispatchEvent(new win.Event('input',{bubbles:true}));
 expect(doc.querySelector('[data-order-next="review"]').disabled).toBe(true);
 expect(doc.querySelector('[data-order-next="review"]').textContent).toBe('Передать на проверку');
 doc.querySelector('#orderTripCostAllocation [data-order-trip]').click();
 expect(ctx.confirmLeave).toHaveBeenCalledOnce();expect(ctx.openTrip).not.toHaveBeenCalled();expect(ui.isDirty()).toBe(true);
});
it('keeps unavailable plan controls disabled after a failed save',async()=>{
 await ui.open(null);expect(doc.getElementById('orderItemAdd').disabled).toBe(true);
 await doc.getElementById('orderSave').onclick();
 expect(doc.getElementById('orderError').textContent).toContain('Выбери одну заявку');
 expect(doc.getElementById('orderItemAdd').disabled).toBe(true);expect(doc.getElementById('orderMaterialAdd').disabled).toBe(true);
});
it('does not offer a carry when there is no available remaining work',async()=>{
 order.service_order_items[0].done_qty=2;await ui.open('order1');
 expect(doc.getElementById('orderCarry').disabled).toBe(true);
});
it('keeps kanban columns and shows the originating request name',async()=>{await ui.board();expect(doc.querySelectorAll('.kcol')).toHaveLength(5);expect(doc.querySelector('.kcard').dataset.kid).toBe('order1');expect(doc.querySelector('.kcard').textContent).toContain('Заявка: Клиент');expect(ctx.wireDrag).toHaveBeenCalledOnce();});
it('counts only visible, non-deleted linked trips on engineer task cards',()=>{expect(visibleTripCount({trip_service_orders:[{trip_id:'hidden',trips:null},{trip_id:'deleted',trips:{id:'deleted',deleted_at:'2026-09-01'}},{trip_id:'visible',trips:{id:'visible',deleted_at:null}}]})).toBe(1);});
it('loads optional provenance columns without coupling the screen to a specific schema version',async()=>{order.service_order_items[0].legacy_job_work_id='legacy-work';await ui.board();expect(selectCalls[0]).toContain('service_order_items(*)');expect(doc.querySelector('.kcard').textContent).toContain('1 исторических строк, факт не переносился');});
it('shows migrated source scope as read-only with a request correction path',async()=>{order.service_order_items[0].legacy_job_work_id='legacy-work';await ui.open('order1');expect(doc.querySelector('.order-item-row').disabled).toBe(true);expect(doc.querySelector('.order-item-fields').hidden).toBe(true);expect(doc.querySelector('.order-item-row').textContent).toContain('корректировку заявки');});
it('preserves imported finance fields when saving assignment details',async()=>{order.status='draft';order.engineer_ids=[person];order.lead_engineer=person;order.service_order_items=[{id:'item1',job_id:job,kind:'work',title:'Осмотр',unit:'ч',planned_qty:2,done_qty:0,transferred_qty:0,legacy_job_work_id:'legacy-work',billable:false,billable_reason:'Гарантия',tariff_profile:'retired-profile'}];await ui.open('order1');doc.getElementById('orderFrom').value='2026-09-25';doc.getElementById('orderTo').value='2026-09-25';await doc.getElementById('orderSave').onclick();expect(rpcCalls[0].args.p_items).toEqual([{id:'item1',job_id:job,kind:'work',stock_catalog_id:null,work_catalog_id:null,billable:false,billable_reason:'Гарантия',tariff_profile:'retired-profile',title:'Осмотр',unit:'ч',planned_qty:2}]);});
it('locks request-owned finance rows in the task editor and points to the request',async()=>{order.service_order_items[0].legacy_snapshot={request_finance_generation:1};await ui.open('order1');expect(doc.querySelector('.order-item-row').disabled).toBe(true);expect(doc.querySelector('.order-item-row').textContent).toContain('Финансовая строка редактируется в заявке');});
it('uses the direct request foreign key when embedding jobs on the task board and editor',async()=>{await ui.board();expect(selectCalls[0]).toContain('jobs!service_orders_job_id_fkey');selectCalls=[];await ui.open('order1');expect(selectCalls.some(q=>q.includes('jobs!service_orders_job_id_fkey'))).toBe(true);});
it('uses a flat mobile list while preserving the status control',async()=>{ctx.isPhone=()=>true;await ui.board();expect(doc.querySelectorAll('.kcol')).toHaveLength(0);expect(doc.querySelector('[data-order-status]')).not.toBeNull();});
it('creates a task against exactly one originating request',async()=>{await ui.open(null,job);doc.getElementById('orderTitle').value='Проверка';await doc.getElementById('orderSave').onclick();expect(rpcCalls[0]).toEqual({fn:'service_order_save_one',args:{p_id:null,p_expected:null,p_data:{title:'Проверка',work_mode:'onsite',date_from:'',date_to:'',engineer_ids:[],lead_engineer:null,instructions:''},p_job:job,p_items:[]}});});
it('adds a selected stock item with a frozen catalog ID and quantity',async()=>{stock=[{id:'stock1',name:'Прокладка',sku:'S-1',unit:'шт',price:50,cost:30,active:true,current_since:'2026-09-23T00:00:00Z'}];await ui.open(null,job);doc.getElementById('orderTitle').value='Замена';await doc.getElementById('orderMaterialAdd').onclick();const select=doc.querySelector('[data-i-stock]');select.value='stock1';select.dispatchEvent(new win.Event('change',{bubbles:true}));const qty=doc.querySelector('[data-i-qty]');qty.value='2';qty.dispatchEvent(new win.Event('input',{bubbles:true}));expect(doc.getElementById('orderMaterialTotals').textContent).toContain('100');expect(doc.getElementById('orderMaterialTotals').textContent).toContain('60');await doc.getElementById('orderSave').onclick();expect(rpcCalls[0].args.p_items).toEqual([{id:null,job_id:job,kind:'material',stock_catalog_id:'stock1',work_catalog_id:null,billable:true,billable_reason:'',tariff_profile:null,title:'Прокладка',unit:'шт',planned_qty:2}]);});
it('saves reported quantities with optimistic revision and never writes to trips/jobs',async()=>{await ui.open('order1');const el=doc.querySelector('[data-result-qty]');el.value='1';el.dispatchEvent(new win.Event('input',{bubbles:true}));expect(ui.isDirty()).toBe(true);await doc.getElementById('orderResultSave').onclick();expect(rpcCalls).toHaveLength(1);expect(rpcCalls[0]).toEqual({fn:'service_order_result',args:{p_id:'order1',p_expected:2,p_items:[{id:'item1',done_qty:1,result_note:''}],p_note:''}});});
it('blocks leaving a dirty task when discard is declined',async()=>{await ui.open('order1');doc.querySelector('[data-result-qty]').dispatchEvent(new win.Event('input',{bubbles:true}));expect(ui.leave()).toBe(false);expect(ui.isDirty()).toBe(true);});
it('preserves entered result on a revision failure',async()=>{ctx.db().rpc=async()=>({error:{message:'Задание изменено другим пользователем'}});await ui.open('order1');const el=doc.querySelector('[data-result-qty]');el.value='1';el.dispatchEvent(new win.Event('input',{bubbles:true}));await doc.getElementById('orderResultSave').onclick();expect(el.value).toBe('1');expect(ui.isDirty()).toBe(true);expect(doc.getElementById('orderError').textContent).toContain('изменено');});
it('engineers cannot confirm and transferred scope is excluded from the remainder',()=>{expect(nextOrderStates('review',false)).toEqual([]);expect(remainingQty({planned_qty:5,done_qty:2,transferred_qty:1})).toBe(2);});
it('calculates material plan and fact only from the saved price snapshots',()=>{expect(materialTotals([{kind:'material',planned_qty:4,done_qty:2,unit_price_snapshot:100,unit_cost_snapshot:60},{kind:'work',planned_qty:9,done_qty:9,unit_price_snapshot:999,unit_cost_snapshot:999}])).toEqual({planRevenue:400,planCost:240,factRevenue:200,factCost:120});});
it('counts transferred material only on the carrying task, not on both tasks',()=>{expect(materialTotals([{kind:'material',planned_qty:5,done_qty:1,transferred_qty:4,unit_price_snapshot:100,unit_cost_snapshot:60},{kind:'material',planned_qty:4,done_qty:0,transferred_qty:0,unit_price_snapshot:100,unit_cost_snapshot:60}])).toEqual({planRevenue:500,planCost:300,factRevenue:100,factCost:60});});
it('keeps warranty material cost while excluding it from sales',()=>{expect(materialTotals([{kind:'material',planned_qty:2,done_qty:1,billable:false,unit_price_snapshot:100,unit_cost_snapshot:60}])).toEqual({planRevenue:0,planCost:120,factRevenue:0,factCost:60});});
it('calculates work plan and fact from frozen financial snapshots without double-counting a carry',()=>{expect(workTotals([{kind:'work',planned_qty:5,done_qty:1,transferred_qty:4,financial_revenue_snapshot:900,financial_cost_snapshot:3750},{kind:'work',planned_qty:4,done_qty:0,transferred_qty:0,financial_revenue_snapshot:720,financial_cost_snapshot:3000}])).toEqual({planRevenue:900,planCost:3750,factRevenue:180,factCost:750,unpriced:0});});
it('excludes audited voided finance from task economics and remaining quantities',()=>{const voided={kind:'material',planned_qty:4,done_qty:0,transferred_qty:0,unit_price_snapshot:100,unit_cost_snapshot:60,request_finance_void_event_id:'event-1',legacy_snapshot:{request_finance_generation:1}};expect(materialTotals([voided])).toEqual({planRevenue:0,planCost:0,factRevenue:0,factCost:0});expect(remainingQty(voided)).toBe(0);expect(workTotals([{kind:'work',planned_qty:2,financial_revenue_snapshot:500,financial_cost_snapshot:200,request_finance_void_event_id:'event-2'}]).planRevenue).toBe(0);});
it('limits cancelled task plan to completed work',()=>{expect(workTotals([{kind:'work',planned_qty:5,done_qty:1,transferred_qty:0,financial_revenue_snapshot:900,financial_cost_snapshot:3750}],'cancelled')).toEqual({planRevenue:180,planCost:750,factRevenue:180,factCost:750,unpriced:0});expect(materialTotals([{kind:'material',planned_qty:5,done_qty:1,unit_price_snapshot:100,unit_cost_snapshot:60}],'cancelled')).toEqual({planRevenue:100,planCost:60,factRevenue:100,factCost:60});});
it('reports missing work snapshots without treating the work as free',()=>{expect(workTotals([{kind:'work',planned_qty:3,done_qty:1,financial_revenue_snapshot:null,financial_cost_snapshot:240}])).toEqual({planRevenue:0,planCost:0,factRevenue:0,factCost:0,unpriced:1});expect(workTotals([{kind:'work',planned_qty:1,done_qty:1,financial_revenue_snapshot:0,financial_cost_snapshot:0}])).toEqual({planRevenue:0,planCost:0,factRevenue:0,factCost:0,unpriced:0});});
it('labels unpriced work rows and shows the missing snapshot count in the task editor',async()=>{order.service_order_items=[{...order.service_order_items[0],kind:'work',financial_revenue_snapshot:null,financial_cost_snapshot:null}];await ui.open('order1');expect(doc.querySelector('[data-order-item="0"]').textContent).toContain('Нет финансового снимка');expect(doc.getElementById('orderMaterialTotals').textContent).toContain('Без финансового снимка: 1 работа');});
it('shows saved work revenue and cost snapshots beside priced task rows',async()=>{order.service_order_items=[{...order.service_order_items[0],kind:'work',financial_revenue_snapshot:3000,financial_cost_snapshot:1500}];await ui.open('order1');expect(doc.querySelector('[data-order-item="0"]').textContent.replace(/\s/g,' ')).toContain('План 3 000 ₴');expect(doc.querySelector('[data-order-item="0"]').textContent.replace(/\s/g,' ')).toContain('себестоимость 1 500 ₴');});
it('does not request manager-only tariff settings while an engineer opens a task',async()=>{ctx.canWrite=()=>false;await ui.open('order1');expect(settingsCalls).toBe(0);expect(ctx.notify.mock.calls.some(([message])=>String(message).includes('Каталог работ временно недоступен'))).toBe(false);expect(doc.querySelector('[data-result-qty]')?.disabled).toBe(false);});
it('defaults new work rows to hourly units required by the tariff model',async()=>{await ui.open(null,job);doc.getElementById('orderItemAdd').click();expect(doc.querySelector('[data-i-unit]').value).toBe('ч');});
it('saves catalog work, warranty reason and selected tariff profile into the canonical task row',async()=>{works=[{id:'work1',name:'Проверка насоса',norm_hours:2,warranty_eligible:true}];taskProfiles=[{id:'standard',name:'Обычный',work_paid:{rate:1000},work_warr:{rate:250}}];await ui.open(null,job);doc.getElementById('orderTitle').value='Проверка';doc.getElementById('orderItemAdd').click();const row=doc.querySelector('[data-order-item="0"]');const catalog=row.querySelector('[data-i-work]');catalog.value='work1';catalog.dispatchEvent(new win.Event('change',{bubbles:true}));let billable=doc.querySelector('[data-i-billable]');billable.checked=false;billable.dispatchEvent(new win.Event('change',{bubbles:true}));const profile=doc.querySelector('[data-i-profile]');profile.value='standard';profile.dispatchEvent(new win.Event('change',{bubbles:true}));await doc.getElementById('orderSave').onclick();expect(rpcCalls[0].args.p_items).toEqual([{id:null,job_id:job,kind:'work',stock_catalog_id:null,work_catalog_id:'work1',billable:false,billable_reason:'Гарантийный ремонт',tariff_profile:'standard',title:'Проверка насоса',unit:'ч',planned_qty:2}]);});
it('shows only confirmed trip expense shares on the task',async()=>{ctx.tripCostSummary=vi.fn(async()=>[{trip_id:'trip1',date_from:'2026-09-23',vehicle_label:'Авто 1',distance_km:12,distance_cost:120,labor_hours:2,labor_cost:80}]);await ui.open('order1');await new Promise(resolve=>setTimeout(resolve,0));expect(ctx.tripCostSummary).toHaveBeenCalledWith('order1');expect(doc.getElementById('orderTripCostAllocation').textContent).toContain('200');expect(doc.getElementById('orderTripCostAllocation').textContent).toContain('12');});
it('rolls confirmed task trip costs up to the originating request',async()=>{doc.body.insertAdjacentHTML('beforeend','<section id="jobOrders"></section>');ctx.tripCostSummary=vi.fn(async()=>[{trip_id:'trip1',distance_km:12,distance_cost:120,labor_hours:2,labor_cost:80}]);await ui.requestPanel(job);expect(doc.getElementById('jobOrders').textContent).toContain('Выездные затраты заданий');expect(doc.getElementById('jobOrders').textContent).toContain('200');expect(ctx.tripCostSummary).toHaveBeenCalledWith('order1');});
it('explains a closed historical request with an unconfirmed task on the board and in the task',async()=>{order.status='draft';order.created_by=null;order.jobs.status='done';ctx.isPhone=()=>true;await ui.board();expect(selectCalls[0]).toContain('created_by');expect(selectCalls[0]).toContain('status,clients(name)');expect(doc.querySelector('.order-history-note')).toBeNull();expect(doc.getElementById('orderHistoricalNote').textContent).toContain('1');doc.getElementById('orderHistorical').checked=true;await doc.getElementById('orderHistorical').onchange({target:doc.getElementById('orderHistorical')});expect(doc.querySelector('.order-history-note').textContent).toContain('подтверждённый результат работ не переносился');await ui.open('order1');expect(doc.querySelector('#orderEditor [role="note"]').textContent).toContain('Заявка закрыта в старой системе');});
it('does not mark a newly created draft as historical even when its request is closed',async()=>{order.status='draft';order.created_by=person;order.jobs.status='done';await ui.board();expect(doc.querySelector('.order-history-note')).toBeNull();await ui.open('order1');expect(doc.querySelector('#orderEditor [role="note"]')).toBeNull();});
it('allows a manager to record historical task fact with an explicit basis while keeping the draft',async()=>{order.status='draft';order.created_by=null;order.jobs.status='done';await ui.open('order1');expect(doc.querySelector('[data-result-qty]').disabled).toBe(false);expect(doc.getElementById('orderResultBasis')).not.toBeNull();doc.querySelector('[data-result-qty]').value='1';await doc.getElementById('orderResultSave').onclick();expect(rpcCalls).toHaveLength(0);expect(doc.getElementById('orderError').textContent).toContain('основание');doc.getElementById('orderResultBasis').value='Акт №42';await doc.getElementById('orderResultSave').onclick();expect(rpcCalls[0]).toEqual({fn:'service_order_historical_result',args:{p_id:'order1',p_expected:2,p_items:[{id:'item1',done_qty:1,result_note:''}],p_note:'',p_basis:'Акт №42'}});expect(order.status).toBe('draft');});
it('does not offer historical fact entry to an engineer or a new closed-request draft',async()=>{order.status='draft';order.created_by=null;order.jobs.status='done';ctx.canWrite=()=>false;await ui.open('order1');expect(doc.getElementById('orderResultBasis')).toBeNull();expect(doc.querySelector('[data-result-qty]').disabled).toBe(true);order.created_by=person;ctx.canWrite=()=>true;await ui.open('order1');expect(doc.getElementById('orderResultBasis')).toBeNull();});

it('offers only editable planned trips that do not already include this task, without writing the plan',async()=>{
 tripChoices=[{id:'editable',status:'planned',date_from:'2026-10-08',vehicle_label:'Auto',engineer_ids:[person],trip_service_orders:[{service_orders:{number:7,title:'Обслуживание',jobs:{clients:{name:'Второй клиент'}}}}]},{id:'other',status:'assigned'},{id:'active',status:'in_progress'},{id:'linked',status:'planned'}];
 order.trip_service_orders=[{trip_id:'linked',trips:{id:'linked',status:'planned'}}];ctx.canManageTrip=t=>t.id!=='other';await ui.open('order1');await doc.getElementById('orderTripExisting').onclick();
 expect([...doc.querySelectorAll('[data-existing-trip]')].map(x=>x.dataset.existingTrip)).toEqual(['editable']);expect(doc.getElementById('orderTripPicker').textContent).toContain('Второй клиент');
 await doc.querySelector('[data-existing-trip]').onclick();expect(ctx.openTrip).toHaveBeenCalledWith('editable',{includeOrderId:'order1'});expect(rpcCalls).toHaveLength(0);
});
it('keeps result edits before adding a task to an existing trip',async()=>{
 await ui.open('order1');doc.querySelector('[data-result-qty]').dispatchEvent(new win.Event('input',{bubbles:true}));expect(doc.getElementById('orderTripExisting').disabled).toBe(true);await doc.getElementById('orderTripExisting').onclick();expect(doc.getElementById('orderTripPicker').hidden).toBe(true);expect(ctx.openTrip).not.toHaveBeenCalled();expect(ui.isDirty()).toBe(true);
});
it('shows execution before administrative fields for engineers and keeps a readable brief',async()=>{
 ctx.canWrite=()=>false;order.instructions='Проверить насос';await ui.open('order1');expect(doc.getElementById('orderOrganization').hidden).toBe(true);expect(doc.querySelector('.order-brief').textContent).toContain('Проверить насос');expect(doc.getElementById('orderPane-result').hidden).toBe(false);expect(doc.getElementById('orderPane-scope').hidden).toBe(true);expect(doc.getElementById('orderTab-result').getAttribute('aria-selected')).toBe('true');
});
it('waits for the request navigation guard and keeps the current task when it refuses',async()=>{
 ctx.beforeOpen=vi.fn(async()=>true);await ui.open('order1');const previous=doc.getElementById('orderTitle');const result=doc.querySelector('[data-result-qty]');ctx.beforeOpen=vi.fn(async()=>false);await ui.open(null,job);expect(doc.getElementById('orderTitle')).toBe(previous);expect(doc.querySelector('[data-result-qty]')).toBe(result);expect(ui.currentId()).toBe('order1');
});

it('routes changes to the base request scope through the estimate and leaves additions to separate tasks',async()=>{order.status='draft';await ui.open('order1');expect(doc.getElementById('orderItemAdd')).toBeNull();expect(doc.getElementById('orderMaterialAdd')).toBeNull();expect(doc.querySelector('.order-item-fields').hidden).toBe(true);expect(doc.getElementById('orderExtra')).not.toBeNull();order.seed_request_id=null;await ui.open('order1');expect(doc.getElementById('orderItemAdd')).not.toBeNull();expect(doc.querySelector('.order-item-fields').hidden).toBe(false);});

it('shows assigned scope first and keeps active engineers on the result',async()=>{
 ctx.canWrite=()=>false;order.status='assigned';await ui.open('order1');expect(doc.getElementById('orderPane-scope').hidden).toBe(false);expect(doc.querySelector('[data-result-qty]').disabled).toBe(true);
 order.id='active-other';order.status='in_progress';await ui.open(order.id);expect(doc.getElementById('orderPane-result').hidden).toBe(false);expect(doc.querySelector('[data-result-qty]').disabled).toBe(false);
});
it('switches mounted panels without writes, leave checks or loss of unsaved result values',async()=>{
 ctx.canWrite=()=>false;ctx.confirmLeave=vi.fn(()=>false);await ui.open('order1');const qty=doc.querySelector('[data-result-qty]');qty.value='1.5';qty.dispatchEvent(new win.Event('input',{bubbles:true}));
 doc.getElementById('orderTab-scope').click();doc.getElementById('orderTab-travel').click();doc.getElementById('orderTab-history').click();doc.getElementById('orderTab-result').click();
 expect(doc.querySelector('[data-result-qty]')).toBe(qty);expect(qty.value).toBe('1.5');expect(ui.isDirty()).toBe(true);expect(ctx.confirmLeave).not.toHaveBeenCalled();expect(rpcCalls).toHaveLength(0);
});
it('saves mounted result values while another panel is selected and retains that tab after save',async()=>{
 await ui.open('order1');const qty=doc.querySelector('[data-result-qty]');qty.value='1';qty.dispatchEvent(new win.Event('input',{bubbles:true}));doc.getElementById('orderTab-travel').click();ctx.confirmLeave=()=>true;
 await doc.getElementById('orderResultSave').onclick();expect(rpcCalls[0].args.p_items[0].done_qty).toBe(1);expect(doc.getElementById('orderPane-travel').hidden).toBe(false);expect(ui.isDirty()).toBe(false);
});
it('retains the initial result tab after saving without any tab navigation',async()=>{
 ctx.canWrite=()=>false;await ui.open('order1');
 expect(doc.getElementById('orderPane-result').hidden).toBe(false);
 const qty=doc.querySelector('[data-result-qty]');qty.value='1';qty.dispatchEvent(new win.Event('input',{bubbles:true}));ctx.confirmLeave=()=>true;
 await doc.getElementById('orderResultSave').onclick();
 expect(doc.getElementById('orderPane-result').hidden).toBe(false);expect(doc.getElementById('orderTab-result').getAttribute('aria-selected')).toBe('true');expect(ui.isDirty()).toBe(false);
});
it('routes invalid hidden plan fields back to scope without discarding other values',async()=>{
 order.status='assigned';await ui.open('order1');doc.getElementById('orderTitle').value='';doc.getElementById('orderInstructions').value='Сохранить инструкцию';doc.getElementById('orderTab-history').click();
 await doc.getElementById('orderSave').onclick();expect(doc.getElementById('orderPane-scope').hidden).toBe(false);expect(doc.activeElement.id).toBe('orderTitle');expect(doc.getElementById('orderInstructions').value).toBe('Сохранить инструкцию');expect(rpcCalls).toHaveLength(0);
});
it('uses one mounted scope for creating a task and gives an unchanged assigned task a neutral save',async()=>{
 order.status='assigned';await ui.open('order1');expect(doc.getElementById('orderSave').classList.contains('amber')).toBe(false);doc.getElementById('orderTitle').dispatchEvent(new win.Event('input',{bubbles:true}));expect(doc.getElementById('orderSave').classList.contains('amber')).toBe(true);
 ctx.confirmLeave=()=>true;await ui.open(null,job);expect(doc.querySelectorAll('[data-entity-tab]')).toHaveLength(1);expect(doc.getElementById('orderSave').classList.contains('amber')).toBe(true);
});

it('opens the request estimate through its explicit helper and leaves the source link on overview',async()=>{
 ctx.openJobEstimate=vi.fn();await ui.open('order1');doc.querySelector('[data-job-estimate]').click();expect(ctx.openJobEstimate).toHaveBeenCalledWith(job);expect(ctx.openJob).not.toHaveBeenCalled();doc.getElementById('orderRequest').click();expect(ctx.openJob).toHaveBeenCalledWith(job);
});
it('collects edited plan values from a mounted hidden scope',async()=>{
 order.status='assigned';order.seed_request_id=null;await ui.open('order1');doc.getElementById('orderTitle').value='Новая задача';doc.getElementById('orderTitle').dispatchEvent(new win.Event('input',{bubbles:true}));doc.querySelector('[data-i-qty]').value='3';doc.getElementById('orderTab-history').click();ctx.confirmLeave=()=>true;
 await doc.getElementById('orderSave').onclick();expect(rpcCalls[0].args.p_data.title).toBe('Новая задача');expect(rpcCalls[0].args.p_items[0].planned_qty).toBe(3);expect(doc.getElementById('orderPane-history').hidden).toBe(false);
});

it('keeps unchanged result save neutral and promotes it only after edits without disabling the workflow',async()=>{
 await ui.open('order1');let save=doc.getElementById('orderResultSave');expect(save.classList.contains('amber')).toBe(false);expect(save.disabled).toBe(false);
 doc.querySelector('[data-result-qty]').dispatchEvent(new win.Event('input',{bubbles:true}));expect(save.classList.contains('amber')).toBe(true);expect(save.disabled).toBe(false);
 ctx.confirmLeave=()=>true;await save.onclick();save=doc.getElementById('orderResultSave');expect(save.classList.contains('amber')).toBe(false);expect(save.disabled).toBe(false);
});
