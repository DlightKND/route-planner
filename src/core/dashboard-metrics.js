// Read models only: unknown measurements stay null, and linked work is counted once.
import {presenceSummary,presenceDaily} from './trip-review.js';
const number = v => v == null || v === '' || !Number.isFinite(+v) ? null : +v;
const sum = (rows, get) => {
  if (!rows.length) return null;
  const values = rows.map(get).map(number);
  return values.some(v => v == null) ? null : values.reduce((a, b) => a + b, 0);
};
const ratio = (a, b, scale = 1) => a != null && b > 0 ? a / b * scale : null;
const hourUnits = new Set(['ч','час','часа','часов','год','година','години','годин','h','hr','hour','hours']);
const validItem = i => i.kind === 'work' && !i.request_finance_void_event_id && !i.legacy_snapshot?.request_finance_voided_at && hourUnits.has(String(i.unit || '').trim().toLowerCase());
const planQty = i => Math.max(0, (+i.planned_qty || 0) - (+i.transferred_qty || 0));
const inPeriod = (d, period) => d && d >= period.from && d <= period.to;

export function statisticsPlanBlocks(trips=[],orders=[],period) {
  const blocks=[];let unknown=0;
  const crew=row=>[...new Set([row.lead_engineer,...(row.engineer_ids||[])].filter(Boolean))];
  for(const t of trips){
    if(t.deleted_at||t.status==='cancelled'||!inPeriod(t.date_from,period))continue;
    const e=t.econ_snapshot||{},people=crew(t);
    if(number(e.workH)==null||number(e.driveH)==null||!people.length){unknown++;continue;}
    people.forEach(engineer=>blocks.push({id:`stats:${t.id}:${engineer}`,kind:'trip',tripId:t.id,engineer,from:t.date_from,to:t.date_to||t.date_from,workH:+e.workH/people.length,driveToH:+e.driveH/2,driveBackH:+e.driveH/2,jobIds:[t.id],plan:t.day_plan?.start?{start:t.day_plan.start}:null}));
  }
  for(const o of orders){
    if(o.deleted_at||o.status==='cancelled'||!['depot','remote'].includes(o.work_mode)||!inPeriod(o.date_from,period))continue;
    const people=crew(o),items=(o.service_order_items||[]).filter(validItem);
    if(!people.length||!items.length){unknown++;continue;}
    const hours=items.reduce((n,i)=>n+planQty(i),0);
    people.forEach(engineer=>blocks.push({id:`stats:${o.id}:${engineer}`,kind:'job',engineer,from:o.date_from,to:o.date_to||o.date_from,workH:hours/people.length,jobIds:[o.id]}));
  }
  return {blocks,unknown};
}

export function trackMotion(segments = []) {
  let km = 0, hours = 0;
  for (const segment of segments) {
    // Reconstructed road gaps can contain stops; they are not measured driving time.
    if (segment.kind !== 'track' || !(number(segment.km) > 0)) continue;
    const ms = number(segment.ms) ?? (Date.parse(segment.toTs) - Date.parse(segment.fromTs));
    if (!(ms > 0) || segment.km / (ms / 36e5) > 300) continue;
    km += +segment.km; hours += ms / 36e5;
  }
  return { km, hours, speed: ratio(km, hours) };
}

export function roadPersonHours({trips=[],tracks=[],presence=[],period,engineerIds=[]}) {
  const selected=new Set(engineerIds),daily=[];
  let known=0,unknown=0;
  for(const trip of trips){
    if(!['done','finished','in_progress'].includes(trip.status)||!inPeriod(trip.date_from,period))continue;
    const stays=presence.filter(s=>s.trip_id===trip.id),summary=presenceSummary(stays);
    const segments=tracks.find(t=>t.trip_id===trip.id)?.segments||tracks.find(t=>t.trip_id===trip.id)?.data?.segments;
    const km=number(trip.fact_km);
    if(km===0&&trip.status==='done'){known++;continue;}
    const crews=stays.filter(s=>s.status==='approved'&&s.job_id&&['snapshot','manager'].includes(s.crew_source)).map(s=>[...new Set(s.crew_ids||[])].sort());
    if(km==null||!Array.isArray(segments)||!segments.length||!crews.length||!summary.complete||crews.some(c=>JSON.stringify(c)!==JSON.stringify(crews[0]))){unknown++;continue;}
    const motion=trackMotion(segments);
    if(!motion.hours||Math.abs(motion.km-km)>Math.max(.1,km*.005)||segments.some(s=>s.kind!=='track'||!(number(s.km)>0))){unknown++;continue;}
    const intervals=segments.map(s=>({from:Date.parse(s.fromTs),to:Date.parse(s.toTs)})).sort((a,b)=>a.from-b.from);
    if(intervals.some((s,i)=>!Number.isFinite(s.from)||!Number.isFinite(s.to)||s.to<=s.from||(i&&s.from<intervals[i-1].to)||stays.some(p=>p.status==='approved'&&s.from<Date.parse(p.stay_to)&&s.to>Date.parse(p.stay_from)))){unknown++;continue;}
    // Frozen, reviewed crew rather than today's editable trip assignment.
    const roadStays=intervals.map(s=>({trip_id:trip.id,job_id:'road',status:'approved',crew_ids:crews[0],crew_source:'snapshot',stay_from:new Date(s.from).toISOString(),stay_to:new Date(s.to).toISOString(),minutes_mgr:(s.to-s.from)/60000}));
    daily.push(...presenceDaily(roadStays,period.from,period.to,selected));known++;
  }
  return {daily,hours:daily.reduce((n,r)=>n+r.hours,0),known,unknown,complete:unknown===0};
}

export function dashboardMetrics({trips = [], orders = [], links = [], tracks = [], period, engineerIds = [], factHours = {}}) {
  const ids = new Set(engineerIds.map(String));
  const team = row => [row.lead_engineer, ...(row.engineer_ids || [])].some(id => ids.has(String(id)));
  const scoped = trips.filter(t => !t.deleted_at && t.status !== 'cancelled' && inPeriod(t.date_from, period) && team(t));
  const tripIds = new Set(scoped.map(t => t.id));
  const completed = scoped.filter(t => t.status === 'done');
  const completedIds = new Set(completed.map(t => t.id));
  const linked = new Set(links.filter(l => tripIds.has(l.trip_id)).map(l => l.order_id));
  const fieldDone = new Set(links.filter(l => completedIds.has(l.trip_id)).map(l => l.order_id));
  const outside = new Set(links.filter(l => !tripIds.has(l.trip_id)).map(l => l.order_id));
  const tasks = orders.filter(o => !o.deleted_at && o.status !== 'cancelled' && (linked.has(o.id) || (['depot','remote'].includes(o.work_mode) && inPeriod(o.date_from, period) && team(o))));
  const accepted = tasks.filter(o => o.status === 'completed');
  const items = tasks.flatMap(o => o.service_order_items || []).filter(validItem);
  const doneItems = accepted.flatMap(o => o.service_order_items || []).filter(validItem);
  const fieldItems = accepted.filter(o => fieldDone.has(o.id) && !outside.has(o.id)).flatMap(o => o.service_order_items || []).filter(validItem);
  const doneNorm = sum(doneItems, i => i.done_qty);
  const fieldNorm = sum(fieldItems, i => i.done_qty);
  const warranty = sum(doneItems, i => i.billable === false ? i.done_qty : 0);
  const kmDone = completed.filter(t => number(t.fact_km) != null);
  const motion = tracks.filter(t => completedIds.has(t.trip_id)).map(t => trackMotion(t.segments || t.data?.segments));
  const motionKm = motion.reduce((n, m) => n + m.km, 0), motionHours = motion.reduce((n, m) => n + m.hours, 0);
  const financial = completed.filter(t => t.econ_snapshot?.cost_basis === 'fact' && t.econ_snapshot?.presence_basis === 'person_hours_v1' && number(factHours[t.id]) != null && number(t.econ_snapshot?.cost_fact) != null && number(t.econ_snapshot?.profit_fact) != null);
  const components = (row, fact) => {
    const e = row.econ_snapshot || {}, p = row.plan_econ_snapshot || e, rates = row.tariffs_snapshot?.costs;
    const base = fact ? e : p;
    const labor = fact || base.cost_basis === 'plan' ? number(base.cLabor) : rates && number(base.workH) != null ? base.workH * rates.hour : null;
    const road = fact || base.cost_basis === 'plan' ? sum([base.cKm, base.cDay, base.cNight], x => x) : rates ? sum([number(base.km) == null ? null : base.km * rates.km, number(base.days) == null ? null : base.days * rates.day, number(base.nights) == null ? null : base.nights * rates.night], x => x) : null;
    return { revenue: number(base.revenue), work: number(base.rWork), road: sum([base.rTravel, base.rPerDiem], x => x), parts: number(base.rParts), labor, travelCost: road, partsCost: number(base.cParts), cost: number(fact ? e.cost_fact : e.cost_plan), profit: number(fact ? e.profit_fact : e.profit_plan) };
  };
  const totals = (rows, fact) => {
    const values = rows.map(t => components(t, fact));
    const out = Object.fromEntries(['revenue','work','road','parts','labor','travelCost','partsCost','cost','profit'].map(key => [key, sum(values, v => v[key])]));
    out.revenueAdjustment = out.revenue != null && [out.work,out.road,out.parts].every(v => v != null) ? out.revenue-out.work-out.road-out.parts : null;
    out.costAdjustment = out.cost != null && [out.labor,out.travelCost,out.partsCost].every(v => v != null) ? out.cost-out.labor-out.travelCost-out.partsCost : null;
    out.margin = ratio(out.profit, out.revenue, 100);
    return out;
  };
  const normCoverage = completed.every(t => {
    const taskIds=[...new Set(links.filter(l=>l.trip_id===t.id).map(l=>l.order_id))];
    return taskIds.length>0 && taskIds.every(id => accepted.some(o => o.id===id && !outside.has(id) && (o.service_order_items||[]).filter(validItem).length>0));
  });
  return {
    trips: scoped.length, completed: completed.length, hoursKnown: completed.filter(t => number(factHours[t.id]) != null).length,
    kmKnown: kmDone.length, tasks: tasks.length, accepted: accepted.length,
    normPlan: sum(items, planQty), normFact: doneNorm,
    presencePlan: sum(scoped, t => t.econ_snapshot?.workH), presenceFact: sum(completed, t => factHours[t.id]),
    kmPlan: sum(scoped, t => t.econ_snapshot?.km), kmFact: sum(completed, t => t.fact_km),
    // The distance cohort and the work cohort must both be complete; no partial ratio.
    distancePerNorm: normCoverage && fieldNorm > 0 ? ratio(sum(completed, t => t.fact_km), fieldNorm) : null,
    averageTripKm: ratio(sum(completed, t => t.fact_km), completed.length),
    speed: ratio(motionKm, motionHours), motionTrips: motion.filter(m => m.hours > 0).length,
    warrantyPct: ratio(warranty, doneNorm, 100),
    financePlan: totals(scoped, false), financeFact: totals(financial, true), financeKnown: financial.length,
  };
}
