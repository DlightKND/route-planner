// Synthetic company. Never reuse real sessions, credentials, or customer data.
export function installMockBackend({ role = "logist", theme = "light", legacyCrewMissing = false, unassignedJourney = false, unassignedCount = 1, preserveRanges = false, scheduleJourney = false, tinySchedulePiece = false, roadSliverJourney = false, lateScheduleCut = false, signedOut = false, financeJourney = false } = {}) {
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
  if(legacyCrewMissing){ride.lead_engineer=null;ride.engineer_ids=[];ride.status='done';}
  const stays = [
    {
      id: "stay-a",
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
  const audit = (window.__visualQA = {
    reads: [],
    queryErrors: [],
    blockedWrites: [],
    scheduleWrites: [],
    financeWrites: [],
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
      if(scheduleJourney&&['trips','jobs'].includes(table))b.update=record=>{
        if(Object.keys(record).some(k=>!['day_plan','date_from','date_to'].includes(k)))return {eq:()=>Promise.resolve(reject(table+'.update'))};
        return {eq:async(key,id)=>{const target=tables[table].find(row=>row[key]===id);if(!target)return {error:{message:'Missing synthetic row'}};
          Object.assign(target,structuredClone(record));audit.scheduleWrites.push({table,id,record:structuredClone(record)});return {data:null,error:null};}};
      };
      return b;
    },
    async rpc(name,args={}) {
      audit.reads.push("rpc:" + name);
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
        audit.financeWrites.push(structuredClone({name,args}));audit.financeRows=structuredClone(seed.service_order_items);
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
        audit.financeWrites.push(structuredClone({name,args}));return {data:target.id,error:null};
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
        trip_workbench_read: {
          trip:financeJourney?(tables.trips.find(t=>t.id===args.p_trip)||ride):ride,
          job_ids: [job],
          stays: stays.filter((s) => s.trip_id === trip),
          removed: [],
          history,
        },
      };
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
  const savedRanges=preserveRanges?Object.fromEntries(['gt','load','rev','journal'].map(k=>[k,localStorage.getItem('dl_range_'+k)])):{};
  localStorage.clear();
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
