// Synthetic company. Never reuse real sessions, credentials, or customer data.
export function installMockBackend({ role = "logist", theme = "light", legacyCrewMissing = false, unassignedJourney = false, unassignedCount = 1, preserveRanges = false, scheduleJourney = false, tinySchedulePiece = false, roadSliverJourney = false, lateScheduleCut = false, signedOut = false, financeJourney = false, entityAudit = false, entityJourney = false, presenceRecoveryJourney = false, unifiedJournalJourney = false, decisionQueue = false, reviewOrder = false, designTripChoices = false, mapTrackDesign = false, summaryOrphans = false, runningSchedule = false, managerJourney = false, canonicalPlanner = false } = {}) {
  if(managerJourney){financeJourney=true;entityAudit=true;}
  const manager = "00000000-0000-4000-8000-000000000001",
    engineer = "00000000-0000-4000-8000-000000000002",
    other = "00000000-0000-4000-8000-000000000003";
  const job = "10000000-0000-4000-8000-000000000001",
    order = "20000000-0000-4000-8000-000000000001",
    trip = "30000000-0000-4000-8000-000000000001";
  const stamp = "2026-10-05T07:00:00Z";
  const people = [
    {
      id: manager,
      full_name: "Демо · диспетчер",
      role: "logist",
      active: true,
      theme: { mode: theme },
    },
    {
      id: engineer,
      full_name: "Анна Смирнова",
      role: "engineer",
      active: true,
      color: "#3286be",
      theme: { mode: theme },
    },
    {
      id: other,
      full_name: "Иван Коваленко",
      role: "engineer",
      active: true,
      color: "#8069b6",
    },
  ];
  const client = {
    id: "client-a",
    name: "Коммунальное предприятие · обслуживание насосной станции на удалённом объекте",
    lat: 49.99,
    lng: 36.23,
    phone: "+00000000000",
    address: "Демонстрационный адрес",
    deleted_at: null,
  };
  const equipment = {
    id: "equipment-a",
    client_id: client.id,
    model: "Насосная станция · демонстрация",
    kind: "насос",
    lat: 49.99,
    lng: 36.23,
    deleted_at: null,
  };
  const work = {
    id: "work-a",
    name: "Диагностика гидросистемы",
    norm_hours: 6,
    warranty_eligible: true,
    applicable_kinds: [],
    unit: "ч",
  };
  const request = {
    id: job,
    client_id: client.id,
    equipment_id: equipment.id,
    clients: client,
    equipment,
    title: "Диагностика и замена уплотнений",
    status: "planned",
    scheduled_date: "2026-10-05",
    due_date: "2026-10-09",
    created_at: stamp,
    deleted_at: null,
    assigned_engineer: engineer,
    engineer_ids: [engineer, other],
    owner_id: manager,
    curator_id: manager,
    at_depot: false,
    notes: "Согласовать доступ к оборудованию.",
    job_works: [
      {
        id: "request-work",
        job_id: job,
        work_id: work.id,
        title: work.name,
        hours: 6,
        revenue: 7500,
        billable: true,
        approved_at: stamp,
        materials: [],
      },
    ],
    job_parts: [],
    day_plan: {},
  };
  const item = {
    id: "task-item",
    order_id: order,
    job_id: job,
    kind: "work",
    title: work.name,
    work_catalog_id: work.id,
    unit: "ч",
    planned_qty: 6,
    done_qty: 0,
    transferred_qty: 0,
    billable: true,
    unit_price_snapshot: 1250,
    unit_cost_snapshot: 750,
  };
  const task = {
    id: order,
    number: 101,
    title: "Диагностика насоса и замена уплотнений",
    job_id: job,
    seed_request_id: job,
    status: "assigned",
    work_mode: "onsite",
    date_from: "2026-10-05",
    date_to: "2026-10-06",
    engineer_ids: [engineer, other],
    lead_engineer: engineer,
    owner_id: manager,
    curator_id: manager,
    created_at: stamp,
    deleted_at: null,
    revision: 0,
    jobs: request,
    instructions:
      "Перед началом согласовать безопасную остановку оборудования.",
    service_order_items: [item],
    service_order_jobs: [
      { job_id: job, snapshot: { client_name: client.name } },
    ],
  };
  const ride = {
    id: trip,
    status: "planned",
    date_from: "2026-10-05",
    date_to: "2026-10-06",
    lead_engineer: engineer,
    engineer_ids: [engineer, other],
    owner_id: manager,
    curator_id: manager,
    created_at: stamp,
    deleted_at: null,
    vehicle_id: "vehicle-a",
    workbench_revision: 0,
    day_plan: {},
    route_stops: [
      { type: "start", name: "Депо", lat: 49.98, lng: 36.2 },
      {
        type: "job",
        name: client.name,
        job_id: job,
        lat: client.lat,
        lng: client.lng,
      },
    ],
    econ_snapshot: { km:128,driveH:2,workH:6,legs:[],days:1,nights:0,revenue:10000,rWork:7500,rParts:500,rTravel:1600,rPerDiem:400,cLabor:4500,cKm:1280,cDay:400,cNight:0,cParts:240,cost_plan:6420,profit_plan:3580,cost_basis:"plan" },
    plan_econ_snapshot: { km:128,driveH:2,workH:6,legs:[],days:1,nights:0,revenue:10000,rWork:7500,rParts:500,rTravel:1600,rPerDiem:400,cLabor:4500,cKm:1280,cDay:400,cNight:0,cParts:240,cost_plan:6420,profit_plan:3580,cost_basis:"plan" },
    notes: "Демонстрационный выезд",
    fact_km: null,
  };
  if(tinySchedulePiece)ride.day_plan={start:{d:'2026-10-05',t:7},cuts:[{after:2.1,at:{d:'2026-10-05',t:9.5}}]};
  if(roadSliverJourney){
    // A quarter-hour cut can leave a 1.56-minute work tail before the return road.
    ride.day_plan={start:{d:'2026-10-05',t:7.5},cuts:[{after:8.25,at:{d:'2026-10-05',t:15.75}}]};
    ride.route_stops.push({type:'end',name:'Депо',lat:49.98,lng:36.2});
    for(const snapshot of [ride.econ_snapshot,ride.plan_econ_snapshot]){
      snapshot.driveH=5.5;
      snapshot.legs=[{a:'49.98000,36.20000',b:'49.99000,36.23000',h:2.276,km:64},{a:'49.99000,36.23000',b:'49.98000,36.20000',h:3.224,km:64}];
    }
  }
  if(lateScheduleCut)ride.day_plan={start:{d:'2026-10-05',t:7},cuts:[{after:2,at:{d:'2026-10-05',t:18}}]};
  task.trip_service_orders = [{ trip_id: trip, trips: ride }];
  if(runningSchedule){ride.status='in_progress';ride.started_at='2026-10-05T04:00:00Z';request.job_works[0].hours=24;ride.econ_snapshot.workH=ride.plan_econ_snapshot.workH=24;ride.day_plan={start:{d:'2026-10-05',t:7},cuts:[{after:9,at:{d:'2026-10-06',t:7}}]};}
  if(legacyCrewMissing){ride.lead_engineer=null;ride.engineer_ids=[];ride.status='done';}
  const stays = [
    {
      id: "stay-a",
      lat:49.99,lng:36.23,
      trip_id: trip,
      job_id: job,
      stay_from: "2026-10-05T06:00:00Z",
      stay_to: "2026-10-05T10:00:00Z",
      minutes_raw: 240,
      minutes_mgr: 240,
      status: "approved",
      crew_ids: [engineer, other],
      crew_source: "manager",
    },
    {
      id: "stay-b",
      lat:50.01,lng:36.24,
      trip_id: trip,
      job_id: job,
      stay_from: "2026-10-06T06:00:00Z",
      stay_to: "2026-10-06T07:00:00Z",
      minutes_raw: 60,
      status: "detected",
      crew_ids: [engineer],
      crew_source: "snapshot",
    },
  ];
  const settings = {
    id: true,
    currency: "грн",
    day_start: 7,
    day_end: 16,
    tolerance_h: 1,
    shift_hours: 9,
    deviation_pct: 25,
    costs: { km: 12.5, hour: 750, day: 600, night: 1500 },
    tariffs: { km: 15, hour: 1250, day: 600, night: 1500 },
    default_theme: { mode: theme },
    tariff_profiles: [],
    avoid_zones: [],
    ors_proxy: "",
    stay_radius_m: 300,
    stay_min_minutes: 10,
  };
  if(roadSliverJourney)Object.assign(settings,{day_start:7.5,day_end:17,tolerance_h:2});
  const tables = {
    profiles: people,
    settings: [settings],
    settings_public: [settings],
    clients: [client],
    equipment: [equipment],
    work_catalog: [work],
    equipment_models: [{id:"model-a", manufacturer:"Демонстрационный производитель", kind:"насос", model:"Сервисная насосная станция с длинным названием модели", warranty_months:24, service_interval_hours:1500}],
    employee_org: [{profile_id:engineer,manager_id:manager,job_title:"Выездной инженер"},{profile_id:other,manager_id:manager,job_title:"Сервисный инженер"}],
    stock_catalog: [
      {
        id: "stock-a",
        name: "Уплотнение насоса",
        sku: "DEMO-001",
        unit: "шт",
        price: 250,
        cost: 120,
        active: true,
        current_since: stamp,
      },
    ],
    jobs: [request],
    job_works: request.job_works,
    job_parts: [],
    service_orders: [task],
    service_order_items: [item],
    trips: [ride],
    trip_jobs: [{ trip_id: trip, job_id: job, ord: 0, jobs: request }],
    trip_service_orders: [
      { trip_id: trip, order_id: order, trips: ride, service_orders: task },
    ],
    trip_stays: stays,
    trip_stay_task_allocations: [
      { stay_id: "stay-a", service_order_id: order, share: 1 },
    ],
    vehicles: [
      {
        id: "vehicle-a",
        name: "Сервисный автомобиль",
        plate: "DEMO",
        active: true,
        deleted_at: null,
      },
    ],
    job_change_requests: [],
  };
  const pastTrip = {
    ...ride,
    id: "30000000-0000-4000-8000-000000000002",
    status: "done",
    date_from: "2026-09-30",
    date_to: "2026-09-30",
    fact_km: 128,
    fact_km_source: "track",
    econ_snapshot: {
      km: 128,
      revenue: 1250000,rWork:850000,rParts:200000,rTravel:200000,rPerDiem:0,workH:6,driveH:2,days:1,nights:0,cLabor:500000,cKm:300000,cDay:0,cNight:0,cParts:100000,
      cost_plan: 850000,
      cost_fact: 900000,
      profit_plan: 400000,
      profit_fact: 350000,
      cost_basis: "fact",
      presence_basis: "person_hours_v1",
    },
  };
  pastTrip.plan_econ_snapshot={...pastTrip.econ_snapshot,cLabor:450000,cost_basis:'plan'};
  const completedTask={...task,id:'task-completed',status:'completed',date_from:'2026-09-30',date_to:'2026-09-30',service_order_items:[{...item,id:'item-completed',order_id:'task-completed',done_qty:6,billable:false}]};
  tables.service_orders.push(completedTask);tables.service_order_items.push(...completedTask.service_order_items);
  tables.trip_service_orders.push({trip_id:pastTrip.id,order_id:completedTask.id,service_orders:completedTask});
  tables.trip_tracks=[{trip_id:pastTrip.id,segments:[{kind:'track',km:128,fromTs:'2026-09-30T03:00:00Z',toTs:'2026-09-30T05:00:00Z',ms:7200000,fromPt:{lat:49.99,lng:36.23},toPt:{lat:50.4,lng:36.8},line:[[36.23,49.99],[36.8,50.4]]}],data:{km:128,trackKm:128,roadKm:0,lineKm:0,jitterKm:0,at:stamp,points:[],dropped:[],segments:[{kind:'track',km:128,fromTs:'2026-09-30T03:00:00Z',toTs:'2026-09-30T05:00:00Z',ms:7200000,fromPt:{lat:49.99,lng:36.23},toPt:{lat:50.4,lng:36.8},line:[[36.23,49.99],[36.8,50.4]]}]}}];
  if(mapTrackDesign){
    pastTrip.date_to='2026-10-02';
    const track=tables.trip_tracks[0],data=track.data;
    data.segments.push(
      {kind:'track',km:12,fromTs:'2026-10-01T10:00:00Z',toTs:'2026-10-01T11:00:00Z',ms:3600000,fromPt:{lat:50.4,lng:36.8},toPt:{lat:50.5,lng:36.9}},
      {kind:'road',km:25,fromTs:'2026-10-01T11:00:00Z',toTs:'2026-10-01T12:00:00Z',ms:3600000,fromPt:{lat:50.5,lng:36.9},toPt:{lat:50.6,lng:37}},
      {kind:'line',km:8,fromTs:'2026-10-02T04:00:00Z',toTs:'2026-10-02T05:00:00Z',ms:3600000,fromPt:{lat:50.6,lng:37},toPt:{lat:50.7,lng:37.1}}
    );
    Object.assign(data,{km:173,trackKm:140,roadKm:25,lineKm:8,
      points:[{lat:50.5,lng:36.9,ts:'2026-10-01T11:00:00Z',status:'idle'}],
      dropped:[{lat:51,lng:37,ts:'2026-10-01T10:30:00Z',why:'скачок координат'}]});
    track.segments=data.segments;
  }
  tables.trips.push(pastTrip);
  tables.trip_stays.push({
    ...stays[0],
    id: "stay-past",
    trip_id: pastTrip.id,
    stay_from: "2026-09-30T06:00:00Z",
    stay_to: "2026-09-30T10:00:00Z",
  });
  const activeTask = {...task,id:"20000000-0000-4000-8000-000000000002",number:102,status:"in_progress",service_order_items:[{...item,id:"task-active-item",order_id:"20000000-0000-4000-8000-000000000002",done_qty:2,financial_revenue_snapshot:7500,financial_cost_snapshot:4500,result_note:"Выполнена диагностика; замена уплотнения запланирована."},{...item,id:"task-active-material",order_id:"20000000-0000-4000-8000-000000000002",kind:"material",title:"Уплотнение насоса и комплект монтажных материалов",work_catalog_id:null,stock_catalog_id:"stock-a",unit:"шт",planned_qty:2,done_qty:1,unit_price_snapshot:250,unit_cost_snapshot:120,result_note:"Использовано одно уплотнение."}],trip_service_orders:[]};
  tables.service_orders.push(activeTask);
  tables.service_order_items.push(...activeTask.service_order_items);
  const history=[{id:"history-a",trip_id:trip,revision:0,recorded_at:stamp,actor_id:manager,reason:"Уточнён порядок посещения объектов",snapshot:{date_from:ride.date_from,job_ids:[job],route_stops:ride.route_stops,econ_snapshot:ride.econ_snapshot}}];
  tables.trip_revision_history=history;
  // Dense read fixtures and synthetic writes are deliberately separate options.
  // Ordinary visual audits remain read-only, including when entityAudit is enabled.
  const activityConfig={job:{table:'job_comments',key:'job_id',rows:tables.jobs},order:{table:'service_order_comments',key:'order_id',rows:tables.service_orders},trip:{table:'trip_comments',key:'trip_id',rows:tables.trips}};
  const resultSnapshot=target=>({number:target.number,title:target.title,status:target.status,note:target.result_note||'',items:target.service_order_items.map(i=>({id:i.id,kind:i.kind,title:i.title,unit:i.unit,planned_qty:i.planned_qty,done_qty:i.done_qty,transferred_qty:i.transferred_qty,result_note:i.result_note||''}))});
  const resultEvents=[],resultOperations=new Map();
  if(entityAudit||entityJourney){
    const comments=[
      {body:'Доступ к оборудованию согласован. На проходной назвать номер задания и связаться с ответственным заказчика.',author_id:manager},
      {body:'Диагностика выполнена. Для замены уплотнения потребуется остановка оборудования.\nПросьба подтвердить время остановки.',author_id:engineer},
      {body:'Комплект уплотнений подготовлен на складе. Забрать перед следующим выездом.',author_id:other},
    ];
    for(const [kind,c] of Object.entries(activityConfig))tables[c.table]=c.rows.flatMap((target,index)=>comments.map((comment,n)=>({...comment,id:`70000000-0000-4000-8000-${String(Object.keys(activityConfig).indexOf(kind)*100+index*10+n+1).padStart(12,'0')}`,[c.key]:target.id,created_at:new Date(Date.UTC(2026,9,5,6,n*10)).toISOString(),pinned_at:null,pinned_by:null})));
    tables.job_history=[{id:'job-history-a',job_id:job,actor_id:manager,recorded_at:'2026-10-04T16:00:00Z',event:'Заявка согласована',changed_fields:{status:['new','planned']}},{id:'job-history-b',job_id:job,actor_id:manager,recorded_at:'2026-10-05T06:05:00Z',event:'Уточнён состав работ',changed_fields:{notes:['','Согласовать остановку оборудования']}}];
    tables.service_order_history=[task,activeTask].flatMap(target=>[{id:'order-history-'+target.id,order_id:target.id,actor_id:manager,recorded_at:'2026-10-04T16:10:00Z',reason:'Назначены исполнитель и срок выполнения'},{id:'order-history-start-'+target.id,order_id:target.id,actor_id:engineer,recorded_at:'2026-10-05T06:15:00Z',reason:target.status==='in_progress'?'Выполнение задания начато':'Исполнитель ознакомился с заданием'}]);
    tables.entity_responsibility_events=Object.entries(activityConfig).map(([kind,c],index)=>({id:'responsibility-'+kind,entity_kind:kind,entity_id:kind==='order'?activeTask.id:c.rows[0].id,actor_id:manager,owner_id:manager,curator_id:manager,previous_owner_id:null,previous_curator_id:null,created_at:'2026-10-04T15:00:00Z',reason:'Назначены владелец и куратор'}));
    resultEvents.push({id:'80000000-0000-4000-8000-000000000001',order_id:activeTask.id,actor_id:engineer,recorded_at:'2026-10-05T06:25:00Z',actual_date:'2026-10-04',snapshot:{...resultSnapshot(activeTask),note:'Диагностика завершена. Замена уплотнения запланирована на следующий этап.'}});
    activeTask.trip_service_orders=[{trip_id:trip,trips:ride}];
    tables.trip_service_orders.push({trip_id:trip,order_id:activeTask.id,service_orders:activeTask,trips:ride});
  }
  if(summaryOrphans)tables.trip_jobs.push({trip_id:'removed-trip',job_id:job,ord:0,jobs:request});
  if(decisionQueue)tables.trip_stays.find(s=>s.id==='stay-past').status='detected';
  if(reviewOrder||decisionQueue){activeTask.status='review';activeTask.result_note='Диагностика завершена. Осталась замена уплотнения.';}
  if(designTripChoices){tables.trips.push({...ride,id:'30000000-0000-4000-8000-000000000010',vehicle_label:'Выезд с ответственным инженером',engineer_ids:[engineer],trip_service_orders:[]},{...ride,id:'30000000-0000-4000-8000-000000000011',vehicle_label:'Выезд с другой командой',engineer_ids:[other],trip_service_orders:[]});}
  const audit = (window.__visualQA = {
    reads: [],
    queryErrors: [],
    blockedWrites: [],
    scheduleWrites: [],
    financeWrites: [],
    entityWrites: [],
    entityResults: structuredClone(resultEvents),
    ready: true,
  });
  const reject = (name) => {
    audit.blockedWrites.push(name);
    return {
      data: null,
      error: { message: "Visual QA: writes disabled", code: "QA_READ_ONLY" },
    };
  };
  if (role === "admin") people[0].role = "admin";
  const session = {
    user: {
      id: role === "engineer" ? engineer : manager,
      email: role + "@example.invalid",
    },
  };
  tables.notification_inbox=[
    {id:'event:demo-1',recipient_id:session.user.id,entity_kind:'trip',entity_id:trip,title:'Выезд требует внимания',body:'Изменена дата начала выезда. Проверьте план и маршрут.',created_at:stamp,source:'event',read_at:null},
    {id:'event:demo-2',recipient_id:session.user.id,entity_kind:'order',entity_id:order,title:'Изменение задания',body:'Обновлены сроки выполнения задания и состав команды. Подробности доступны в карточке.',created_at:'2026-10-04T16:00:00Z',source:'event',read_at:null},
    {id:'push:demo-3',recipient_id:session.user.id,entity_kind:'trip',entity_id:trip,title:'Выезд сегодня',body:'Отправлено напоминание на 05.10.2026.',created_at:'2026-10-04T12:00:00Z',source:'push',read_at:stamp},
    {id:'event:foreign',recipient_id:other,entity_kind:'job',entity_id:job,title:'Чужое уведомление',body:'Не показывать',created_at:stamp,source:'event',read_at:null},
  ].map(n=>({...n,search_text:n.title+' '+n.body}));
  const unassignedID='60000000-0000-4000-8000-000000000001';
  const unknownVehicle=tables.vehicles[0]?.id||'vehicle-a';
  tables.unassigned_tracks=unassignedJourney?[{id:unassignedID,vehicle_id:unknownVehicle,started_at:'2026-10-04T07:00:00Z',last_ts:'2026-10-04T09:00:00Z',ended_at:'2026-10-04T09:00:00Z',state:role==='engineer'?'charged':'review',revision:0,review_note:'Историческая поездка: проверь границы и пробег',engineer_id:engineer,resolution:{cost:1500,km:120,rate:12.5,currency:'грн',reason:'Подтверждённая личная поездка'}}]:[];
  if(unassignedJourney&&unassignedCount>1)tables.unassigned_tracks=Array.from({length:unassignedCount},(_,i)=>({...tables.unassigned_tracks[0],started_at:new Date(Date.UTC(2026,9,4+i,7)).toISOString(),last_ts:new Date(Date.UTC(2026,9,4+i,9)).toISOString(),ended_at:new Date(Date.UTC(2026,9,4+i,9)).toISOString(),id:i?`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`:unassignedID}));
  tables.vehicle_telemetry_archive=unassignedJourney?[{vehicle_id:unknownVehicle,trip_id:null,ts:'2026-10-04T07:00:00Z',lat:49.99,lng:36.23},{vehicle_id:unknownVehicle,trip_id:null,ts:'2026-10-04T07:01:00Z',lat:50.01,lng:36.25},{vehicle_id:unknownVehicle,trip_id:null,ts:'2026-10-04T09:00:00Z',lat:49.99,lng:36.23}]:[];
  tables.unassigned_track_events=[];
  if(financeJourney){
    task.service_order_items=[
      {...item,id:'50000000-0000-4000-8000-000000000001',legacy_job_work_id:'60000000-0000-4000-8000-000000000001',approved_at:stamp,financial_revenue_snapshot:7500,financial_cost_snapshot:4500,created_at:stamp,legacy_snapshot:{title:'Историческая работа'}},
      {...item,id:'50000000-0000-4000-8000-000000000002',kind:'material',legacy_job_part_id:'60000000-0000-4000-8000-000000000002',work_catalog_id:null,title:'Историческая запчасть',unit:'шт',planned_qty:1,sku_snapshot:'OLD',unit_price_snapshot:300,unit_cost_snapshot:100,approved_at:stamp,created_at:stamp,legacy_snapshot:{}},
      {...item,id:'50000000-0000-4000-8000-000000000003',kind:'material',work_catalog_id:null,title:'Редактируемая запчасть',unit:'шт',planned_qty:1,sku_snapshot:'NEW',unit_price_snapshot:50,unit_cost_snapshot:20,approved_at:null,created_at:'2026-10-06T07:00:00Z',legacy_snapshot:{request_finance_generation:1,created_by:manager}},
    ];
    request.service_orders=[task];
    audit.financeRows=structuredClone(task.service_order_items);
  }
  if(presenceRecoveryJourney){
    const point=(km,min)=>({trip_id:trip,vehicle_id:ride.vehicle_id,lat:client.lat,lng:client.lng+(km-100)/(111.32*Math.cos(client.lat*Math.PI/180)),ts:new Date(Date.UTC(2026,9,5,7,min)).toISOString()});
    tables.vehicle_positions=[point(0,-1),point(1,0),...Array.from({length:181},(_,i)=>point(100,360+i))];
    if(presenceRecoveryJourney==='unbound'){tables.vehicle_positions=[point(0,-1),{...point(1,0),status:'idle'}, {...point(26,137),status:'moving'},point(27,138)];const finish=tables.vehicle_positions.at(-1);ride.route_stops.push({type:'end',name:'Финиш',lat:finish.lat,lng:finish.lng});}
    Object.assign(ride.route_stops[0],{lat:tables.vehicle_positions[0].lat,lng:tables.vehicle_positions[0].lng});
    Object.assign(ride,{status:'finished',started_at:tables.vehicle_positions[0].ts,finished_at:tables.vehicle_positions.at(-1).ts});
    stays.splice(0,stays.length);tables.trip_stays=stays;
    settings.ors_proxy='https://anqfbljgfimoaziztdxe.supabase.co/functions/v1/ors';
    session.access_token='synthetic-token';audit.recoveryWrites=[];
    if(role==='engineer'){
      const p=tables.vehicle_positions,a=p[1],b=p[2],end=p.at(-1),from=new Date(Date.parse(b.ts)-180*60000).toISOString();
      stays.push({id:'recovery-0',trip_id:trip,job_id:job,lat:b.lat,lng:b.lng,stay_from:from,stay_to:end.ts,status:'detected',crew_ids:[engineer],crew_source:'snapshot',minutes_raw:180,minutes_mgr:null,recovery_acceptance:{},presence_evidence:{version:1,gps_intervals:[{from:b.ts,to:end.ts}],recovery_parts:[{key:'arrival',from,to:b.ts,minutes:180,side:'before',gap_from:a.ts,gap_to:b.ts}]}});
    }
  }

  if(unifiedJournalJourney){tables.vehicles.push({id:'vehicle-empty',name:'Автомобиль без поездок',plate:'TEST',deleted_at:null});
    audit.recoveryWrites=[];
    Object.assign(ride,{status:'finished',started_at:'2026-10-05T05:12:00Z',finished_at:'2026-10-05T14:46:00Z'});
    const span=(from,to)=>({from:'2026-10-05T'+from+':00Z',to:'2026-10-05T'+to+':00Z'});
    const base={trip_id:trip,job_id:job,crew_ids:[engineer,other],crew_source:'snapshot',lat:client.lat,lng:client.lng,minutes_raw:60,note:null};
    stays.splice(0,stays.length,...[
      {...base,id:'journal-stay-1',stay_from:span('05:28','05:46').from,stay_to:span('05:28','05:46').to,minutes_raw:18,minutes_mgr:18,status:'approved'},
      {...base,id:'journal-stay-2',stay_from:span('06:30','07:20').from,stay_to:span('06:30','07:20').to,minutes_raw:50,minutes_mgr:50,status:'approved'},
      {...base,id:'journal-stay-3',stay_from:span('08:20','12:20').from,stay_to:span('08:20','12:20').to,minutes_raw:180,minutes_mgr:null,status:'detected',presence_evidence:{gps_intervals:unifiedJournalJourney==='hypothesis'?[]:[span('08:20','11:20')],recovery_parts:[{key:'restored-1',...span(unifiedJournalJourney==='hypothesis'?'08:20':'11:20','12:20'),minutes:unifiedJournalJourney==='hypothesis'?240:60,side:'after'}]}},
      {...base,id:'journal-stay-4',job_id:null,crew_ids:[],stay_from:span('13:05','13:28').from,stay_to:span('13:05','13:28').to,minutes_mgr:23,status:'rejected',note:'Остановка в пути'},
      {...base,id:'journal-stay-5',job_id:null,crew_ids:[],stay_from:span('13:50','14:10').from,stay_to:span('13:50','14:10').to,minutes_mgr:20,status:'rejected',note:'Остановка в пути'}
    ]);tables.trip_stays=stays;
    const second={...task,id:'journal-second-task',number:472,title:'Настройка сети'};tables.service_orders.push(second);tables.trip_service_orders.push({trip_id:trip,order_id:second.id,service_orders:second});
    tables.trip_stay_task_allocations=[{stay_id:'journal-stay-3',service_order_id:task.id,share:.5},{stay_id:'journal-stay-3',service_order_id:second.id,share:.3}];
    const segments=[{kind:'track',km:74.2,fromTs:ride.started_at,toTs:'2026-10-05T07:50:00Z',line:[[36.2,49.98],[36.23,49.99],[36.25,50.01]],fromPt:{lat:49.98,lng:36.2},toPt:{lat:50.01,lng:36.25}},{kind:'road',km:13.2,fromTs:'2026-10-05T07:50:00Z',toTs:'2026-10-05T08:20:00Z',line:[[36.25,50.01],[36.24,50.015],[36.23,50.01]],fromPt:{lat:50.01,lng:36.25},toPt:{lat:50.01,lng:36.23}}];
    tables.trip_tracks.push({trip_id:trip,km:87.4,updated_at:stamp,data:{trackKm:74.2,roadKm:13.2,segments,presence:{source_to:ride.finished_at,motion_intervals:[{...span('07:50','08:20'),source:'ors'}]}}});
  }
  if(unifiedJournalJourney==='long'){
    const baseTime=Date.parse('2026-10-05T04:00Z'),iso=m=>new Date(baseTime+m*60000).toISOString();ride.started_at=iso(0);ride.finished_at=iso(6000);
    const base=stays[2];stays.splice(0,stays.length,...Array.from({length:29},(_,i)=>({...base,id:'long-stay-'+i,stay_from:iso(i*200+20),stay_to:iso(i*200+50),minutes_raw:30,minutes_mgr:null,status:'detected',presence_evidence:null})));
    const segments=Array.from({length:2200},(_,i)=>({kind:'track',km:.1,fromTs:iso(i*2),toTs:iso(i*2+2),line:[[36.2+i*.00001,49.98],[36.2+(i+1)*.00001,49.98001]]}));
    const saved=tables.trip_tracks.find(t=>t.trip_id===trip);saved.data={trackKm:220,roadKm:0,segments,presence:{source_to:ride.finished_at,motion_intervals:segments.map(s=>({from:s.fromTs,to:s.toTs,source:'gps'}))}};
    history.splice(0,history.length,...Array.from({length:100},(_,i)=>({id:'long-history-'+i,revision:i,recorded_at:iso(i),actor_id:manager,reason:'Синтетическое изменение '+i,snapshot:{stays:stays.map(s=>({...s,note:'x'.repeat(1500)}))}})));
  }
  const managerState=()=>({request:{due_date:request.due_date,status:request.status,engineer_ids:[...(request.engineer_ids||[])]},order:{status:task.status,date_from:task.date_from,date_to:task.date_to,engineer_ids:[...task.engineer_ids],lead_engineer:task.lead_engineer,revision:task.revision,items:task.service_order_items.map(i=>({id:i.id,done_qty:i.done_qty,planned_qty:i.planned_qty}))},trip:{date_from:ride.date_from,date_to:ride.date_to,engineer_ids:[...ride.engineer_ids]}});
  if(managerJourney){for(const row of task.service_order_items)if(row.kind==='material'&&!row.stock_catalog_id)row.stock_catalog_id='stock-a';task.status=typeof managerJourney==='string'?managerJourney:managerJourney.stage||'assigned';audit.managerWrites=[];audit.managerState=managerState();}
  const plannerGroups=[
    {source_key:'road:'+trip+':0',kind:'road',trip_id:trip,order_id:null,people:[engineer,other],parts:[{id:'road-first',date:'2026-10-05',start:7,end:9,offset:0}]},
    {source_key:'work:'+order+':'+trip,kind:'work',trip_id:trip,order_id:order,people:[engineer,other],parts:[{id:'work-first',date:'2026-10-05',start:9,end:15,offset:0}]},
    {source_key:'road:'+trip+':1',kind:'road',trip_id:trip,order_id:null,people:[engineer,other],parts:[{id:'road-last',date:'2026-10-05',start:15,end:17,offset:0}]}
  ].filter(g=>canonicalPlanner!=='carryover'||g.kind==='work').map(g=>canonicalPlanner==='carryover'?{...g,parts:[{id:'work-first',date:'2026-10-05',start:12,end:17,offset:0}]}:g).map(g=>({...g,revision:0,order_revision:g.order_id?task.revision:null,trip_revision:ride.workbench_revision,manual:false,stale:false,basis:'synthetic',auto_parts:structuredClone(g.parts),auto_people:[...g.people]}));
  const plannerReceipts=new Map();audit.plannerWrites=[];tables.planner_layout_history=[];
  if(canonicalPlanner==='historical'){task.status='completed';ride.status='done';}
  if(canonicalPlanner){
    tables.staff_day=JSON.parse(localStorage.getItem('qa:planner-staff-days')||'[]');audit.staffDayRows=tables.staff_day;audit.staffDayWrites=[];
    if(canonicalPlanner==='palette')tables.trip_tracks.push({trip_id:trip,data:{segments:[{kind:'track',km:20,fromTs:'2026-10-05T04:00Z',toTs:'2026-10-05T05:00Z'},{kind:'road',km:20,fromTs:'2026-10-05T05:00Z',toTs:'2026-10-05T06:00Z'},{kind:'line',km:20,fromTs:'2026-10-05T06:00Z',toTs:'2026-10-05T07:00Z'}]}});
    stays.splice(0,stays.length);stays.push({id:'planner-stay',trip_id:trip,job_id:job,service_order_id:order,status:'detected',crew_source:'snapshot',crew_ids:[engineer,other],minutes_raw:120,stay_from:'2026-10-05T07:30:00Z',stay_to:'2026-10-05T10:30:00Z',presence_evidence:{gps_intervals:[{from:'2026-10-05T07:30:00Z',to:'2026-10-05T09:30:00Z'}],recovery_parts:[{key:'extension',from:'2026-10-05T09:30:00Z',to:'2026-10-05T10:30:00Z',side:'after',minutes:60}]}});
  }
  const db = {
    auth: {
      getSession: async () => ({ data: { session: signedOut?null:session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    from(table) {
      audit.reads.push(table);
      let rows = structuredClone(tables[table] || []), queryError = null,
        single = false,
        head = false;
      if(legacyCrewMissing&&role==='engineer'&&table==='trips')rows=rows.filter(t=>t.id!==trip);
      const result = () => ({
        data: queryError || head ? null : single ? rows[0] || null : rows,
        count: rows.length,
        error: queryError,
      });
      const b = {
        select: (_cols, opts) => {
          head = !!opts?.head;
          if(table==='service_orders'&&_cols){
            // Canonical task columns, verified against production schema.
            // Embedded relationships have their own fields; do not treat them as task columns.
            const columns=new Set('id,number,title,status,work_mode,date_from,date_to,lead_engineer,engineer_ids,instructions,result_note,revision,legacy_trip_id,legacy_snapshot,created_by,created_at,updated_at,job_id,seed_request_id,curator_id,owner_id'.split(','));
            let depth=0,part='',parts=[];
            for(const char of _cols){if(char==='(')depth++;if(char===')')depth--;if(char===','&&!depth){parts.push(part);part='';}else part+=char;}parts.push(part);
            const missing=parts.filter(p=>!p.includes('(')).map(p=>p.trim().split(':').at(-1).split('->')[0]).find(p=>p!=='*'&&!columns.has(p));
            if(missing){queryError={code:'42703',message:`column ${table}.${missing} does not exist`};audit.queryErrors.push(queryError.message);}
          }
          return b;
        },
        eq: (k, v) => {
          rows = rows.filter((r) => r[k] === v);
          return b;
        },
        neq: (k, v) => {
          rows = rows.filter((r) => r[k] !== v);
          return b;
        },
        is: (k, v) => {
          rows = rows.filter((r) => (r[k] ?? null) === v);
          return b;
        },
        in: (k, v) => {
          rows = rows.filter((r) => v.includes(r[k]));
          return b;
        },
        gte: (k, v) => {
          rows = rows.filter((r) => r[k] >= v);
          return b;
        },
        lt: (k,v) => {rows=rows.filter(r=>r[k]<v);return b;},
        lte: (k, v) => {
          rows = rows.filter((r) => r[k] <= v);
          return b;
        },
        not: (key, operator, value) => {
          if(operator==='is')rows=rows.filter(row=>(row[key]??null)!==value);
          else if(operator==='eq')rows=rows.filter(row=>row[key]!==value);
          else if(operator==='in'){
            const values=String(value).replace(/^\(|\)$/g,'').split(',').map(x=>x.trim().replace(/^"|"$/g,''));
            rows=rows.filter(row=>!values.includes(String(row[key])));
          }else throw Error('Visual QA: unsupported not operator '+operator);
          return b;
        },
        or: () => b,
        ilike: (key,value) => {const text=value.slice(1,-1).replace(/\\([%_\\])/g,'$1').toLocaleLowerCase();rows=rows.filter(r=>String(r[key]||'').toLocaleLowerCase().includes(text));return b;},
        contains: () => b,
        order: () => b,
        limit: (n) => {
          rows = rows.slice(0, n);
          return b;
        },
        range: (a, z) => {
          rows = rows.slice(a, z + 1);
          return b;
        },
        single: () => {
          single = true;
          return b;
        },
        maybeSingle: () => {
          single = true;
          return b;
        },
        then: (resolve, reject) =>
          Promise.resolve(result()).then(resolve, reject),
      };
      for (const action of ["insert", "upsert", "update", "delete"])
        b[action] = () => {
          const out = reject(table + "." + action);
          return {
            then: (a, z) => Promise.resolve(out).then(a, z),
            select() {
              return this;
            },
            eq() {
              return this;
            },
          };
        };
      if(canonicalPlanner&&table==='staff_day')b.upsert=row=>{
        const allowed=['admin','logist'].includes(role)&&[engineer,other].includes(row.engineer)&&/^\d{4}-\d{2}-\d{2}$/.test(row.date),valid=allowed&&Number.isFinite(row.start_h)&&Number.isFinite(row.end_h)&&row.start_h>=0&&row.end_h>row.start_h&&row.end_h+row.tol_h<=24;
        if(!valid)return Promise.resolve(reject('staff_day.upsert'));
        audit.staffDayWrites.push(structuredClone(row));const prior=tables.staff_day.find(r=>r.engineer===row.engineer&&r.date===row.date);if(prior)Object.assign(prior,structuredClone(row));else tables.staff_day.push(structuredClone(row));
        localStorage.setItem('qa:planner-staff-days',JSON.stringify(tables.staff_day));return Promise.resolve({data:[structuredClone(row)],error:null});
      };
      if(entityJourney&&Object.values(activityConfig).some(c=>c.table===table))b.insert=record=>{
        const config=Object.values(activityConfig).find(c=>c.table===table),target=config.rows.find(r=>r.id===record[config.key]);
        const allowed=target&&(role!=='engineer'||target.engineer_ids?.includes(session.user.id)||[target.owner_id,target.curator_id].includes(session.user.id));
        const valid=allowed&&record.author_id===session.user.id&&typeof record.body==='string'&&record.body.trim().length>0&&record.body.length<=4000;
        const out=valid?{data:[{...structuredClone(record),id:crypto.randomUUID(),created_at:stamp,pinned_at:null,pinned_by:null}],error:null}:{data:null,error:{message:'Комментарий недоступен или не заполнен',code:'42501'}};
        if(valid){(tables[table]??=[]).push(out.data[0]);audit.entityWrites.push({table,action:'insert',record:structuredClone(record)});}
        return {then:(a,z)=>Promise.resolve(out).then(a,z),select(){return this;},single(){return this;}};
      };
      if(scheduleJourney&&['trips','jobs'].includes(table))b.update=record=>{
        if(Object.keys(record).some(k=>!['day_plan','date_from','date_to'].includes(k)))return {eq:()=>Promise.resolve(reject(table+'.update'))};
        return {eq:async(key,id)=>{const target=tables[table].find(row=>row[key]===id);if(!target)return {error:{message:'Missing synthetic row'}};
          Object.assign(target,structuredClone(record));audit.scheduleWrites.push({table,id,record:structuredClone(record)});return {data:null,error:null};}};
      };
      return b;
    },
    async rpc(name,args={}) {
      audit.reads.push("rpc:" + name);
      if(name==='planner_snapshot')return {data:{groups:structuredClone(plannerGroups.filter(g=>g.parts.some(p=>p.date>=args.p_from&&p.date<=args.p_to)))},error:null};
      if(name==='planner_apply'&&canonicalPlanner){
        if(plannerReceipts.has(args.p_operation))return {data:structuredClone(plannerReceipts.get(args.p_operation)),error:null};
        if(role==='engineer')return {data:null,error:{message:'Нет права изменять это задание'}};
        const layouts=[];
        for(const c of args.p_changes){const g=plannerGroups.find(g=>g.source_key===c.source_key);if(!g||g.revision!==c.expected_revision)return {data:null,error:{message:'Размещение изменено другим пользователем'}};}
        for(const c of args.p_changes){const g=plannerGroups.find(g=>g.source_key===c.source_key);Object.assign(g,{parts:structuredClone(c.manual===false?g.auto_parts:c.parts),manual:c.manual,revision:g.revision+1});layouts.push(structuredClone(g));tables.planner_layout_history.push({source_key:g.source_key,reason:args.p_reason,actor_id:session.user.id,created_at:stamp});}
        audit.plannerWrites.push(structuredClone(args));const receipt={layouts,restore_windows:[]};plannerReceipts.set(args.p_operation,receipt);return {data:structuredClone(receipt),error:null};
      }
      if(presenceRecoveryJourney&&name==='trip_track_rebuild_save'){
        if(role==='engineer')return reject(name);
        const previous=tables.trip_tracks.find(t=>t.trip_id===trip),same=JSON.stringify(previous?.data.presence)===JSON.stringify(args.p_track.presence);
        if(!same){
          stays.splice(0,stays.length,...args.p_track.presence.stays.map((s,i)=>({...s,id:'recovery-'+i,trip_id:trip,status:'detected',crew_ids:[engineer],crew_source:'snapshot',minutes_raw:s.gps_minutes,minutes_mgr:null,recovery_acceptance:{}})));
          tables.trip_tracks=tables.trip_tracks.filter(t=>t.trip_id!==trip);tables.trip_tracks.push({trip_id:trip,km:args.p_track.km,data:structuredClone(args.p_track),updated_at:stamp});ride.workbench_revision++;
        }
        const factUpdated=args.p_fact_km!=null&&(ride.fact_km!==args.p_fact_km||ride.fact_km_source!==args.p_fact_source);
        if(args.p_fact_km!=null)Object.assign(ride,{fact_km:args.p_fact_km,fact_km_source:args.p_fact_source,fact_km_note:args.p_fact_note});
        audit.recoveryWrites.push({name,args:structuredClone(args)});return {data:{revision:ride.workbench_revision,repeated:same,fact_updated:factUpdated},error:null};
      }
      if((presenceRecoveryJourney||unifiedJournalJourney)&&name==='trip_presence_save_tasks'){
        if(role==='engineer')return reject(name);
        if(args.p_expected!==ride.workbench_revision)return {data:null,error:{message:'Выезд изменён. Обновите поездку.'}};
        for(const input of args.p_stays){const s=stays.find(s=>s.id===input.id);if(!s)return reject('missing stay');Object.assign(s,structuredClone(input),{crew_source:'manager',mgr_by:session.user.id,mgr_at:new Date().toISOString(),note:args.p_reason});if(input.task_allocations){tables.trip_stay_task_allocations=tables.trip_stay_task_allocations.filter(a=>a.stay_id!==s.id).concat(input.task_allocations.map(a=>({stay_id:s.id,service_order_id:a.order_id,share:a.share})));}}
        ride.workbench_revision++;audit.recoveryWrites.push({name,args:structuredClone(args)});return {data:ride.workbench_revision,error:null};
      }
      // This read RPC is supported even by the default read-only fixture.
      if(name==='entity_activity_results'){
        const results=resultEvents.filter(event=>{
          if(args.p_kind==='order')return event.order_id===args.p_id;
          if(args.p_kind==='job')return tables.service_orders.some(o=>o.id===event.order_id&&o.job_id===args.p_id);
          if(args.p_kind==='trip')return tables.trip_service_orders.some(link=>link.order_id===event.order_id&&link.trip_id===args.p_id);
          return false;
        });
        return {data:structuredClone(results),error:null};
      }
      if(entityJourney&&name==='service_order_record_result'){
        const target=tables.service_orders.find(o=>o.id===args.p_id),bad=message=>({data:null,error:{message,code:'QA_ENTITY_VALIDATION'}});
        if(!target||role==='engineer'&&!target.engineer_ids.includes(session.user.id))return bad('Задание недоступно');
        const signature=JSON.stringify({actor:session.user.id,order:args.p_id,items:args.p_items,note:args.p_note,date:args.p_actual_date,basis:args.p_basis??null});
        const previous=resultOperations.get(args.p_operation_id);
        if(previous)return previous.signature===signature?{data:structuredClone(previous.data),error:null}:bad('Операция уже использована для другого результата');
        if(target.revision!==args.p_expected)return bad('Задание изменилось. Открой текущую версию');
        if(!['in_progress','paused','review'].includes(target.status)||target.status==='review'&&role==='engineer')return bad('Ввод результата недоступен');
        if(!/^[0-9a-f-]{36}$/i.test(args.p_operation_id||'')||!/^\d{4}-\d{2}-\d{2}$/.test(args.p_actual_date||'')||!Array.isArray(args.p_items))return bad('Не заполнены параметры результата');
        if(new Set(args.p_items.map(i=>i.id)).size!==args.p_items.length||args.p_items.some(i=>!target.service_order_items.some(r=>r.id===i.id)||!Number.isFinite(i.done_qty)||i.done_qty<0||i.done_qty>Number(target.service_order_items.find(r=>r.id===i.id).planned_qty)-Number(target.service_order_items.find(r=>r.id===i.id).transferred_qty||0)))return bad('Некорректный объём выполнения');
        for(const result of args.p_items){const row=target.service_order_items.find(i=>i.id===result.id);row.done_qty=result.done_qty;row.result_note=result.result_note||'';}
        target.result_note=args.p_note||'';target.revision++;
        const event={id:crypto.randomUUID(),order_id:target.id,actor_id:session.user.id,recorded_at:stamp,actual_date:args.p_actual_date,snapshot:resultSnapshot(target)};
        resultEvents.push(event);const data={revision:target.revision,event_id:event.id};resultOperations.set(args.p_operation_id,{signature,data});
        audit.entityWrites.push({name,args:structuredClone(args)});audit.entityResults=structuredClone(resultEvents);
        return {data:structuredClone(data),error:null};
      }
      if(entityJourney&&name==='entity_activity_pin'){
        const config=activityConfig[args.p_kind],target=config?.rows.find(r=>r.id===args.p_id),comment=config&&(tables[config.table]||[]).find(r=>r.id===args.p_comment&&r[config.key]===args.p_id);
        if(!target||!comment||!(role==='admin'||role==='logist'||[target.owner_id,target.curator_id].includes(session.user.id)))return {data:null,error:{message:'Нет права закреплять этот комментарий',code:'42501'}};
        comment.pinned_at=args.p_pinned?stamp:null;comment.pinned_by=args.p_pinned?session.user.id:null;
        audit.entityWrites.push({name,args:structuredClone(args)});
        return {data:{id:comment.id,pinned_at:comment.pinned_at,pinned_by:comment.pinned_by},error:null};
      }
      if(managerJourney&&['service_order_organization_save','service_order_save_one','entity_responsibility_assign','service_order_deadline_propose','trip_reschedule_request'].includes(name)){
        const bad=message=>({data:null,error:{message,code:'QA_MANAGER_VALIDATION'}}),target=name==='entity_responsibility_assign'?(args.p_kind==='order'?tables.service_orders.find(o=>o.id===args.p_id):args.p_kind==='job'?request:ride):tables.service_orders.find(o=>o.id===(args.p_id||args.p_order));
        if(name==='trip_reschedule_request'){audit.managerWrites.push({name,args:structuredClone(args)});return {data:'requested',error:null};}
        if(!target)return bad('Запись не найдена');
        if(name==='service_order_deadline_propose'){if(role!=='engineer')return bad('В этом сценарии предложение отправляет инженер');const row={id:'deadline-new',order_id:target.id,order_revision:target.revision,proposed_date_to:args.p_date_to,reason:args.p_reason,status:'open',created_by:session.user.id,created_at:stamp};tables.service_order_deadline_requests=[...(tables.service_order_deadline_requests||[]),row];audit.managerWrites.push({name,args:structuredClone(args)});return {data:row.id,error:null};}
        if(role==='engineer'&&![target.owner_id,target.curator_id].includes(session.user.id))return bad('Нет прав менеджера');
        if(args.p_expected!=null&&target.revision!==args.p_expected)return bad('Задание изменено другим пользователем');
        if(name==='entity_responsibility_assign'){
          if(managerJourney.failAssignment)return bad('Передача отклонена сервером');target[args.p_field+'_id']=args.p_person;if(args.p_kind==='order')target.revision++;audit.managerWrites.push({name,args:structuredClone(args)});audit.managerState=managerState();return {data:{owner_id:target.owner_id,curator_id:target.curator_id},error:null};
        }
        if(name==='service_order_organization_save')Object.assign(target,{date_from:args.p_date_from,date_to:args.p_date_to,engineer_ids:[...args.p_engineer_ids],lead_engineer:args.p_lead_engineer});else Object.assign(target,structuredClone(args.p_data));target.revision++;audit.managerWrites.push({name,args:structuredClone(args)});audit.managerState=managerState();return {data:name==='service_order_save_one'?target.id:target.revision,error:null};
      }
      if(financeJourney&&name==='job_request_save_canonical'){
        const target=args.p_id?tables.jobs.find(j=>j.id===args.p_id):{...request,id:crypto.randomUUID(),service_orders:[]};
        if(!target)return {data:null,error:{message:'Заявка не найдена'}};
        let seed=target.service_orders.find(o=>o.seed_request_id===target.id);
        if(!seed){seed={...task,id:crypto.randomUUID(),job_id:target.id,seed_request_id:target.id,status:'draft',service_order_items:[]};target.service_orders=[seed];}
        const saved={job_id:target.id,works:null,parts:null};
        for(const [kind,key] of [['work','works'],['material','parts']]){
          const incoming=args['p_'+key];if(incoming==null)continue;
          if(!['draft','assigned','paused'].includes(seed.status))return {data:null,error:{message:'Финансовый состав нельзя менять после начала выполнения задания'}};
          if(incoming.some(r=>seed.service_order_items.some(i=>i.id===r.id&&(i.legacy_job_work_id||i.legacy_job_part_id))))return {data:null,error:{message:'Историческую строку заявки нельзя менять обычным сохранением'}};
          const rows=incoming.map(r=>({...item,id:r.id,job_id:target.id,order_id:seed.id,kind,title:r.title||r.name,work_catalog_id:r.work_id||null,unit:r.unit,planned_qty:r.hours??r.qty,sku_snapshot:r.sku||'',unit_price_snapshot:r.price||0,unit_cost_snapshot:r.cost||0,approved_at:stamp,approved_by:manager,billable:r.billable,billable_reason:r.billable_reason||'',legacy_snapshot:{request_finance_generation:1,created_by:manager}}));
          seed.service_order_items=[...seed.service_order_items.filter(i=>i.kind!==kind||i.legacy_job_work_id||i.legacy_job_part_id),...rows];
          saved[key]=incoming.map(r=>({index:r.index,id:r.id,revenue:0,price:r.price||0,cost:r.cost||0,approved_at:stamp,approved_by:manager}));
        }
        Object.assign(target,structuredClone(args.p_rec));
        if(!args.p_id)tables.jobs.push(target);
        audit.financeWrites.push(structuredClone({name,args}));audit.financeRows=structuredClone(seed.service_order_items);if(managerJourney)audit.managerState=managerState();
        return {data:saved,error:null};
      }
      if(financeJourney&&name==='service_order_trip'){
        const created={...ride,id:crypto.randomUUID(),status:'planned',started_at:null,workbench_revision:1,route_stops:[ride.route_stops.at(-1)],route_geometry:null};
        tables.trips.push(created);tables.trip_service_orders.push({trip_id:created.id,order_id:order,service_orders:task,trips:created});
        tables.trip_jobs.push({trip_id:created.id,job_id:job,jobs:request});return {data:created.id,error:null};
      }
      if(financeJourney&&name==='trip_plan_save_tasks'){
        const target=tables.trips.find(t=>t.id===args.p_trip);if(!target)return reject('missing trip');
        Object.assign(target,structuredClone(args.p_plan));target.workbench_revision++;
        audit.financeWrites.push(structuredClone({name,args}));if(managerJourney)audit.managerState=managerState();return {data:target.id,error:null};
      }
      if(name==='notification_set_read'){
        const row=tables.notification_inbox.find(n=>n.id===args.p_id&&n.recipient_id===session.user.id);
        if(!row)return {data:null,error:{message:'Уведомление недоступно'}};
        row.read_at=args.p_read?stamp:null;return {data:null,error:null};
      }
      if(name==='notification_mark_all_read'){
        let count=0;tables.notification_inbox.forEach(n=>{if(n.recipient_id===session.user.id&&!n.read_at&&n.created_at<=args.p_before){n.read_at=stamp;count++;}});return {data:count,error:null};
      }
      const reads = {
        unassigned_track_points:(tables.vehicle_telemetry_archive||[]).map(p=>({...p,part:1})),
        unassigned_track_quote:{track_id:unassignedID,revision:0,km:120,points:3,gaps:1,rejected:0,rate:12.5,cost:1500},
        legacy_personal_schedule_read:legacyCrewMissing&&role==='engineer'&&(args.p_trips||[]).includes(trip)?[{id:trip,status:'done',date_from:ride.date_from,date_to:ride.date_to,day_plan:ride.day_plan,engineer_ids:[],lead_engineer:null,schedule_only:true,route_stops:ride.route_stops.map(s=>({type:s.type,lat:s.lat,lng:s.lng})),econ_snapshot:{driveH:ride.econ_snapshot.driveH,legs:[]}}]:[],
        account_org_read: {job_title:role==='engineer'?'Выездной инженер':'Руководитель сервиса',manager:role==='engineer'?{...people[0],job_title:'Руководитель сервиса'}:null,reports:role==='engineer'?[]:people.slice(1).map(p=>({...p,job_title:'Сервисный инженер'}))},
        entity_people: people,
        entity_finance_config: settings,
        service_order_trip_cost_summary: [],
        trip_cost_allocation_read: null,
        trip_track_rebuild_context: presenceRecoveryJourney?{trip:ride,source_from:ride.started_at,source_to:ride.finished_at,source_digest:'synthetic-source',stops:[{job_id:job,name:client.name,lat:client.lat,lng:client.lng}]}:null,
        trip_workbench_read: {
          trip:financeJourney?(tables.trips.find(t=>t.id===args.p_trip)||ride):ride,
          job_ids: [job],
          stays: stays.filter((s) => s.trip_id === trip),
          removed: [],
          history,
        },
      };
      reads.trip_journal_read={...reads.trip_workbench_read,history:[],history_deferred:true};
      return Object.hasOwn(reads, name)
        ? { data: structuredClone(reads[name]), error: null }
        : reject("rpc:" + name);
    },
    channel() {
      const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} };
      return c;
    },
    removeChannel: async () => {},
    functions: { invoke: async (name) => reject("function:" + name) },
  };
  window.supabase = { createClient: () => db };
  const savedRanges=preserveRanges?Object.fromEntries(['gt','load','rev','journal','summary'].map(k=>[k,localStorage.getItem('dl_range_'+k)])):{};
  const savedPlanner=canonicalPlanner?Object.fromEntries(['dlight:planner-view:https://anqfbljgfimoaziztdxe.supabase.co:'+session.user.id,'qa:planner-staff-days'].map(k=>[k,localStorage.getItem(k)])):{};
  localStorage.clear();
  for(const [key,value] of Object.entries(savedPlanner))if(value!==null)localStorage.setItem(key,value);
  if(!canonicalPlanner||!localStorage.getItem('dlight:planner-view:https://anqfbljgfimoaziztdxe.supabase.co:'+session.user.id))localStorage.setItem('dlight:planner-view:https://anqfbljgfimoaziztdxe.supabase.co:'+session.user.id,JSON.stringify({from:'2026-10-05',to:'2026-10-06',people:[engineer,other]}));
  localStorage.setItem(
    "dl_range_gt",
    JSON.stringify({ from: "2026-10-05", to: "2026-10-18" }),
  );
  localStorage.setItem(
    "dl_range_load",
    JSON.stringify({ from: "2026-10-05", to: "2026-10-18" }),
  );
  localStorage.setItem(
    "dl_range_rev",
    JSON.stringify({ from: "2026-09-21", to: "2026-10-05" }),
  );
  localStorage.setItem('dl_range_journal',JSON.stringify({from:'2026-10-01',to:'2026-10-31'}));
  for(const [k,v] of Object.entries(savedRanges))if(v)localStorage.setItem('dl_range_'+k,v);
}
export const fixtureIDs = {
  job: "10000000-0000-4000-8000-000000000001",
  order: "20000000-0000-4000-8000-000000000001",
  trip: "30000000-0000-4000-8000-000000000001",
  activeOrder: "20000000-0000-4000-8000-000000000002",
};
