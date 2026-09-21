// Presence is elapsed time per person, not billable norm hours.
// Unknown crew and unreviewed stops must never silently become zero fact.
export function presenceSummary(stays = []) {
  let proposed = 0, approved = 0, pending = 0, unknownCrew = 0;
  const byEngineer = {}, byJob = {};
  for (const stay of stays) {
    if (stay.status === 'rejected') continue;
    const crew = Array.isArray(stay.crew_ids) ? [...new Set(stay.crew_ids.filter(Boolean))] : [];
    const minutes = stay.status === 'approved' ? stay.minutes_mgr : stay.minutes_raw;
    const valid = minutes != null && Number.isFinite(+minutes) && +minutes >= 0;
    const knownCrew=['snapshot','manager'].includes(stay.crew_source);
    if (!crew.length || !knownCrew) unknownCrew++;
    if (!stay.job_id || !valid || !crew.length || stay.status !== 'approved' || !knownCrew) pending++;
    if (!stay.job_id || !valid || !crew.length) continue;
    const hours = +minutes / 60;
    proposed += hours * crew.length;
    if (stay.status !== 'approved' || !knownCrew) continue;
    approved += hours * crew.length;
    byJob[stay.job_id] = (byJob[stay.job_id] || 0) + hours * crew.length;
    crew.forEach(id => { byEngineer[id] = (byEngineer[id] || 0) + hours; });
  }
  return { proposed, approved, pending, unknownCrew, complete: pending === 0, byEngineer, byJob };
}

export function validatePresence(stays) {
  const intervals = new Map();
  for (const stay of stays) {
    if (stay.status !== 'approved') continue;
    const crew = [...new Set(stay.crew_ids || [])];
    if (!stay.job_id || !crew.length) throw new Error('Для присутствия нужны заявка и состав команды.');
    const from = Date.parse(stay.stay_from), to = Date.parse(stay.stay_to);
    const minutes = Number(stay.minutes_mgr);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || stay.minutes_mgr == null || !Number.isFinite(minutes) || minutes < 0 || minutes > (to - from) / 60000 + 1) {
      throw new Error('Проверь интервал и длительность присутствия.');
    }
    for (const id of crew) {
      const previous = intervals.get(id) || [];
      if (previous.some(p => from < p.to && to > p.from)) throw new Error('Присутствие одного инженера пересекается по времени.');
      previous.push({ from, to }); intervals.set(id, previous);
    }
  }
  return true;
}

// A plan-only removal changes membership, not GPS, stays or accepted results.
export function planMembership(previous, next) {
  const old = new Set(previous), current = new Set(next);
  return { added: [...current].filter(id => !old.has(id)), removed: [...old].filter(id => !current.has(id)), kept: [...current].filter(id => old.has(id)) };
}

// A background read may advance fact revision, but must not silently attach a
// newer plan revision to old form values (which would defeat optimistic locking).
export function sameEditablePlan(a,b,oldJobs,newJobs) {
  const fields=['date_from','date_to','vehicle_id','lead_engineer','engineer_ids','status','notes','route_stops','route_geometry','overrides','main_job_id','road_km_by_payer','tariffs_snapshot','remaining_route','plan_econ_snapshot'];
  return fields.every(k=>JSON.stringify(a?.[k]??null)===JSON.stringify(b?.[k]??null))
    && JSON.stringify([...oldJobs].sort())===JSON.stringify([...newJobs].sort());
}

export function remainingStops(stops, visitedKeys) {
  return stops.filter(s => s.type !== 'job' || !visitedKeys.has(`${(+s.lat).toFixed(5)},${(+s.lng).toFixed(5)}`));
}

// Split actual attendance at local midnights, including 23/25-hour DST days.
// Manager-adjusted minutes are distributed proportionally over the interval.
export function presenceDaily(stays, from, to, engineers = null, timeZone = 'Europe/Kyiv') {
  const dateFmt = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const partsFmt = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const iso = ts => {const p=Object.fromEntries(dateFmt.formatToParts(ts).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
  const midnight = date => {
    const target=Date.parse(date+'T00:00:00Z');let guess=target;
    for(let i=0;i<4;i++){
      const p=Object.fromEntries(partsFmt.formatToParts(guess).map(x=>[x.type,x.value]));
      const seen=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
      if(seen===target)break;guess+=target-seen;
    }
    return guess;
  };
  const nextDay = date => new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const entries=[];
  for(const s of stays){
    if(s.status!=='approved'||!s.job_id||!['snapshot','manager'].includes(s.crew_source)||s.minutes_mgr==null)continue;
    const crew=[...new Set(s.crew_ids||[])].filter(id=>!engineers||engineers.has(id));
    const a=Date.parse(s.stay_from),b=Date.parse(s.stay_to),minutes=+s.minutes_mgr;
    if(!crew.length||!Number.isFinite(a)||!Number.isFinite(b)||b<=a||!Number.isFinite(minutes)||minutes<0)continue;
    let cursor=Math.max(a,midnight(from));const end=Math.min(b,midnight(nextDay(to)));
    while(cursor<end){
      const day=iso(cursor),limit=Math.min(end,midnight(nextDay(day)));
      if(limit<=cursor)break;
      const hours=minutes/60*(limit-cursor)/(b-a);
      crew.forEach(engineer=>entries.push({engineer,date:day,hours,tripId:s.trip_id}));cursor=limit;
    }
  }
  return entries;
}
