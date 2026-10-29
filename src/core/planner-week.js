// Read-only projection: a day's trip facts stay linked to their original records.
export const plannerFactTone=fact=>fact.track_kind==='line'?'unknown':fact.source==='estimated'?'estimated':fact.kind==='stop'?'stop':'gps';
const key=(date,person,trip)=>JSON.stringify([date,person,trip]);
const priority=fact=>plannerFactTone(fact)==='unknown'?0:fact.source==='estimated'?(fact.kind==='stop'?2:1):(fact.kind==='stop'?4:3);

export function summarizePlannerFactDay(facts,person){
 const rows=facts.filter(f=>f.people.includes(person)).map(f=>{
  const base=Date.parse(f.date+'T00:00:00Z'),a=Date.parse(f.from),b=Date.parse(f.to);
  return {...f,a:Number.isFinite(a)?a:base+f.start*3600000,b:Number.isFinite(b)?b:base+f.end*3600000};
 }).filter(f=>Number.isFinite(f.a)&&Number.isFinite(f.b)&&f.b>f.a).sort((a,b)=>a.a-b.a||a.b-b.b||String(a.id).localeCompare(String(b.id)));
 if(!rows.length)return null;
 const first=rows[0];if(rows.some(f=>f.date!==first.date||f.trip_id!==first.trip_id))throw Error('Сводка факта должна относиться к одному выезду и дню.');
 const events=new Map(),hours=new Map(),active=new Set(),episodes=[];
 for(const f of rows){for(const [time,action,hour] of [[f.a,'start',f.start],[f.b,'end',f.end]]){if(!events.has(time))events.set(time,{start:[],end:[]});events.get(time)[action].push(f);hours.set(time,hour);}}
 const times=[...events.keys()].sort((a,b)=>a-b);
 for(let i=0;i<times.length-1;i++){
  const a=times[i],b=times[i+1],event=events.get(a);event.end.forEach(f=>active.delete(f));event.start.forEach(f=>active.add(f));
  const sources=[...active].sort((x,y)=>priority(y)-priority(x)||String(x.id).localeCompare(String(y.id))),f=sources[0],tone=f?plannerFactTone(f):'unknown';
  const kind=tone==='unknown'?'gap':f.kind,stay=f?.stay_id||null,order=f?.order_id||null,confirmed=!!f?.confirmed,inferred=!f;
  const identity=JSON.stringify([kind,tone,stay,order,confirmed,inferred]),previous=episodes.at(-1),ids=sources.map(s=>s.id);
  if(previous?.identity===identity&&previous.b===a){previous.b=b;previous.end=hours.get(b);previous.to=new Date(b).toISOString();previous.minutes+=(b-a)/60000;previous.ids.push(...ids);}
  else episodes.push({identity,a,b,from:new Date(a).toISOString(),to:new Date(b).toISOString(),start:hours.get(a),end:hours.get(b),minutes:(b-a)/60000,kind,tone,stay_id:stay,order_id:order,confirmed,inferred,ids});
 }
 const tones={gps:0,stop:0,estimated:0,unknown:0};let roadMinutes=0,stopMinutes=0;
 for(const e of episodes){e.ids=[...new Set(e.ids)];tones[e.tone]+=e.minutes;if(e.kind==='road')roadMinutes+=e.minutes;else if(e.kind==='stop')stopMinutes+=e.minutes;}
 const last=times.at(-1);
 return {key:key(first.date,person,first.trip_id),date:first.date,person,trip_id:first.trip_id,start:hours.get(times[0]),end:hours.get(last),minutes:(last-times[0])/60000,roadMinutes,stopMinutes,tones,episodes,ids:[...new Set(rows.map(r=>r.id))]};
}

export function plannerFactDays(facts,people){
 const allowed=people?new Set(people):null,groups=new Map();
 for(const fact of facts)for(const person of new Set(fact.people)){if(allowed&&!allowed.has(person))continue;const id=key(fact.date,person,fact.trip_id);if(!groups.has(id))groups.set(id,{person,facts:[]});groups.get(id).facts.push(fact);}
 return [...groups.values()].map(g=>summarizePlannerFactDay(g.facts,g.person)).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.person.localeCompare(b.person)||String(a.trip_id).localeCompare(String(b.trip_id)));
}
