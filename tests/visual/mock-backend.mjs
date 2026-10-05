// Synthetic company. Never reuse real sessions, credentials, or customer data.
export function installMockBackend({ role = "logist", theme = "light" } = {}) {
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
    econ_snapshot: { km: 128, driveH: 2, legs: [] },
    plan_econ_snapshot: { km: 128, driveH: 2, legs: [] },
    notes: "Демонстрационный выезд",
    fact_km: null,
  };
  task.trip_service_orders = [{ trip_id: trip, trips: ride }];
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
  const tables = {
    profiles: people,
    settings: [settings],
    settings_public: [settings],
    clients: [client],
    equipment: [equipment],
    work_catalog: [work],
    stock_items: [
      {
        id: "stock-a",
        name: "Уплотнение насоса",
        sku: "DEMO-001",
        unit: "шт",
        price: 250,
        cost: 120,
        active: true,
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
    econ_snapshot: {
      km: 128,
      revenue: 1250000,
      cost_plan: 850000,
      cost_fact: 900000,
      profit_plan: 400000,
      profit_fact: 350000,
      cost_basis: "fact",
      presence_basis: "person_hours_v1",
    },
  };
  tables.trips.push(pastTrip);
  tables.trip_stays.push({
    ...stays[0],
    id: "stay-past",
    trip_id: pastTrip.id,
    stay_from: "2026-09-30T06:00:00Z",
    stay_to: "2026-09-30T10:00:00Z",
  });
  const audit = (window.__visualQA = {
    reads: [],
    blockedWrites: [],
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
  const db = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    from(table) {
      audit.reads.push(table);
      let rows = structuredClone(tables[table] || []),
        single = false,
        head = false;
      const result = () => ({
        data: head ? null : single ? rows[0] || null : rows,
        count: rows.length,
        error: null,
      });
      const b = {
        select: (_cols, opts) => {
          head = !!opts?.head;
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
        lte: (k, v) => {
          rows = rows.filter((r) => r[k] <= v);
          return b;
        },
        not: () => b,
        or: () => b,
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
      return b;
    },
    async rpc(name) {
      audit.reads.push("rpc:" + name);
      const reads = {
        entity_people: people,
        entity_finance_config: settings,
        service_order_trip_cost_summary: [],
        trip_cost_allocation_read: null,
        trip_workbench_read: {
          trip: ride,
          job_ids: [job],
          stays: stays.filter((s) => s.trip_id === trip),
          removed: [],
          history: [],
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
}
export const fixtureIDs = {
  job: "10000000-0000-4000-8000-000000000001",
  order: "20000000-0000-4000-8000-000000000001",
  trip: "30000000-0000-4000-8000-000000000001",
};
