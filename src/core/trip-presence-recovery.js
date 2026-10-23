import {measureTrip,haversineKm} from './track.js';
const MIN=60000,iso=t=>new Date(t).toISOString(),time=p=>Date.parse(p.ts),minutes=(a,b)=>Math.round((b-a)/MIN*1000)/1000;
const valid=p=>p&&!p.anchor&&Number.isFinite(time(p))&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)&&Math.abs(+p.lat)<=90&&Math.abs(+p.lng)<=180;
const interval=(from,to)=>({from:iso(from),to:iso(to)});
const sameSite=(a,b)=>a&&b&&a.key===b.key;
const routeKey=(a,b)=>[a.ts,b.ts,a.lat,a.lng,b.lat,b.lng].join('|');
const coords=p=>({lat:+p.lat,lng:+p.lng});
export function intervalMinutes(rows=[]){return Math.round(rows.reduce((n,r)=>n+Math.max(0,Date.parse(r.to)-Date.parse(r.from))/MIN,0)*1000)/1000;}
export function mergeIntervals(rows=[]){
 const result=[];for(const r of rows.filter(r=>Date.parse(r.to)>Date.parse(r.from)).sort((a,b)=>Date.parse(a.from)-Date.parse(b.from))){const last=result.at(-1);if(last&&Date.parse(r.from)<=Date.parse(last.to)){if(Date.parse(r.to)>Date.parse(last.to)){last.to=r.to;if(r.anchor_to)last.anchor_to=r.anchor_to;}}else result.push({...r});}return result;
}
export function acceptedPresenceIntervals(stay,acceptance=stay.recovery_acceptance||{}){
 const evidence=stay.presence_evidence;if(!evidence)return [{from:stay.stay_from,to:stay.stay_to}];
 const rows=[...(evidence.gps_intervals||[])];
 for(const p of evidence.recovery_parts||[]){const n=Number(acceptance[p.key]??0);if(!(n>0))continue;const a=Date.parse(p.from),b=Date.parse(p.to);rows.push(p.side==='before'?interval(Math.max(a,b-n*MIN),b):interval(a,Math.min(b,a+n*MIN)));}
 return mergeIntervals(rows);
}
export function presenceBounds(stay){
 const e=stay.presence_evidence;if(!e)return null;const gps=intervalMinutes(e.gps_intervals),extra=intervalMinutes((e.recovery_parts||[]).map(p=>({from:p.from,to:p.to})));
 return {gps,extra,min:gps,max:Math.round((gps+extra)*1000)/1000};
}
function sitesOf(stops){
 const sites=new Map();for(const s of stops||[]){if(!s||!Number.isFinite(+s.lat)||!Number.isFinite(+s.lng)||s.lat==null||s.lng==null)continue;const key=(+s.lat).toFixed(5)+','+(+s.lng).toFixed(5);const site=sites.get(key)||{key,...coords(s),name:s.name||'Объект',job_ids:[]};if(s.job_id&&!site.job_ids.includes(s.job_id))site.job_ids.push(s.job_id);sites.set(key,site);}return [...sites.values()];
}
function siteAt(p,sites,radius){const choices=sites.filter(s=>haversineKm(p,s)*1000<=radius);return choices.length===1?choices[0]:null;}
function witness(points,i,dir,gap,hard){const a=points[i],b=points[i+dir];if(!b)return false;const dt=Math.abs(time(b)-time(a));return dt>0&&dt<=gap&&haversineKm(a,b)/(dt/36e5)<=hard;}

// The standard write-side operation: mileage validation and presence proposals
// share one bounded ORS cache. Plain map reads continue to use measureTrip.
export async function rebuildTripTrack(points,opts={},ctx={},reach=null){
 const limit=opts.maxOrsCalls??40,cache=new Map();let calls=0;
 const road=async(a,b,ms)=>{const key=routeKey(a,b);if(cache.has(key))return cache.get(key);if(!reach||calls>=limit)return null;calls++;const r=await reach(a,b,ms);if(r)cache.set(key,r);return r;};
 const actualStart=Date.parse(ctx.started_at),actualFinish=Date.parse(ctx.finished_at);
 const captured=(points||[]).filter(p=>(!Number.isFinite(actualStart)||time(p)>=actualStart)&&(!Number.isFinite(actualFinish)||time(p)<=actualFinish));
 const m=await measureTrip(captured,{...opts,validateGaps:true},ctx,road),real=m.points.filter(valid),sites=sitesOf(ctx.stops),gap=(opts.presenceGapMinutes??5)*MIN,rad=opts.stayRadiusM??300,minStay=opts.stayMinMinutes??10,hard=opts.hardSpeedKmh??300,slack=opts.slack??1.5;
 const skipped=[],components=[],motion=[],parts=[],replacement=new Map(),proposalSites=[...sites];
 const usable=!m.verdict.startsWith('трек недостоверен');
 const locate=p=>siteAt(p,sites,rad);
 const component=(site,from,to,kind,payload)=>components.push({site,from,to,kind,...payload});
 const drive=(a,b,from,to,r)=>{if(to>from)motion.push({...interval(from,to),minutes:minutes(from,to),source:'ors'});return {kind:'road',km:r.km,line:r.line||null,fromTs:iso(from),toTs:iso(to),fromPt:coords(a),toPt:coords(b),minutes:minutes(from,to),ms:to-from,driveSeconds:(to-from)/1000,driveSource:'ors',why:'достроено при потере навигации',gapFromTs:a.gapFromTs||a.ts,gapToTs:b.gapToTs||b.ts};};
 const addPart=(site,a,b,from,to,side)=>{if(to<=from)return;const p={key:[a.ts,b.ts,site.key,side].join('|'),...interval(from,to),side,minutes:minutes(from,to),gap_from:a.ts,gap_to:b.ts,anchor_from:{...coords(a),ts:a.ts},anchor_to:{...coords(b),ts:b.ts}};parts.push(p);component(site,from,to,'recovery',{part:p});};
 // Only adjacent, regularly observed samples lock GPS time. A long gap, even
 // between identical coordinates, never becomes immutable observed presence.
 for(let i=1;i<real.length;i++){
  const a=real[i-1],b=real[i],from=time(a),to=time(b),dt=to-from;if(!(dt>0&&dt<=gap))continue;
  const sa=locate(a),sb=locate(b);
  if(sameSite(sa,sb))component(sa,from,to,'gps',{gps:{...interval(from,to),anchor_from:{...coords(a),ts:a.ts},anchor_to:{...coords(b),ts:b.ts}}});
  else if(haversineKm(a,b)*1000>=30)motion.push({...interval(from,to),minutes:minutes(from,to),source:'gps'});
 }
 if(usable)for(let i=1;i<real.length;i++){
  const a=real[i-1],b=real[i],from=time(a),to=time(b),dt=to-from;if(dt<=gap)continue;
  const skip=reason=>skipped.push({from:a.ts,to:b.ts,reason});
  if(!witness(real,i-1,-1,gap,hard)||!witness(real,i,1,gap,hard)){skip('Недостаточно соседних GPS-точек для проверки опор');continue;}
  const sa=locate(a),sb=locate(b);let site,mode;
  // An observed idle fix is already a location anchor. It must not require
  // a request or an invented detour through a different linked object.
  if(!sa&&!sb&&a.status==='idle'&&b.status!=='idle'){
   site={key:'gps-idle:'+a.ts+'|'+(+a.lat).toFixed(5)+','+(+a.lng).toFixed(5),...coords(a),job_ids:[],origin:{kind:'gps_idle',ts:a.ts,...coords(a)}};mode='after';
  }
  if(!site&&sameSite(sa,sb)){site=sa;mode='between';}
  else if(sa&&!sb){site=sa;mode='after';}
  else if(sb&&!sa){site=sb;mode='before';}
  else if(sa&&sb){skip('Провал между разными объектами: время не распределяется автоматически');continue;}
  if(mode==='between'){addPart(site,a,b,from,to,mode);replacement.set(routeKey(a,b),[]);continue;}
  let inbound,outbound;
  if(!site){
   const feasible=[];
   for(const candidate of sites){
    // A full missing visit is a hypothesis; never choose among multiple
    // feasible objects or invent a visit to an unrelated location.
    const c={...candidate,ts:a.ts};const x=await road(a,c,dt),y=await road({...c,ts:b.ts},b,dt);
    if(x&&y&&Number.isFinite(x.sec)&&Number.isFinite(y.sec)&&x.sec>=0&&y.sec>=0&&(x.sec+y.sec)*1000<=dt)feasible.push({site:candidate,x,y});
   }
   if(feasible.length!==1){skip(feasible.length?'Несколько возможных объектов внутри провала':'Нет однозначного объекта и маршрута для восстановления');continue;}
   ({site,inbound,outbound}={site:feasible[0].site,inbound:feasible[0].x,outbound:feasible[0].y});mode='island';
  }else{
   const r=site.origin&&haversineKm(a,b)*1000<30?{ok:true,sec:0,km:0,line:null}:await road(a,b,dt);if(!r||!Number.isFinite(r.sec)||r.sec<0){skip('Длительность дороги ORS недоступна');continue;}
   if(r.sec*1000>dt*slack){skip('Опоры не проходят дорожную проверку достижимости');continue;}
   if(r.sec*1000>dt){skip('Расчётная дорога занимает весь промежуток');continue;}
   if(mode==='before')inbound=r;else outbound=r;
  }
  const arrival=mode==='after'?from:from+(inbound?.sec||0)*1000,departure=mode==='before'?to:to-(outbound?.sec||0)*1000;
  if(departure-arrival<minStay*MIN){skip('Остаток времени меньше минимальной стоянки');continue;}
  if(site.origin){proposalSites.push(site);site.origin.road_seconds=outbound.sec;}
  addPart(site,a,b,arrival,departure,mode);
  const c={...site,gapFromTs:a.ts,gapToTs:b.ts},legs=[];
  if(inbound)legs.push(drive(a,mode==='island'?c:b,from,arrival,inbound));
  if(outbound&&(outbound.sec>0||outbound.km>0))legs.push(drive(mode==='island'?c:a,b,departure,to,outbound));
  replacement.set(routeKey(a,b),legs);
 }
 const stays=[];
 for(const site of proposalSites){
  const entries=components.filter(x=>x.site.key===site.key).sort((a,b)=>a.from-b.from);let visit=[];
  const finish=()=>{if(!visit.length)return;const gps=mergeIntervals(visit.filter(x=>x.kind==='gps').map(x=>x.gps)),recovery=visit.filter(x=>x.kind==='recovery').map(x=>x.part);const start=Math.min(...visit.map(x=>x.from)),end=Math.max(...visit.map(x=>x.to));
   if(intervalMinutes(gps)+intervalMinutes(recovery)<minStay){visit=[];return;}
   const evidence={version:1,site_key:site.key,job_ids:site.job_ids,gps_intervals:gps,recovery_parts:recovery,...(site.origin?{origin:site.origin}:{})};
   stays.push({key:site.key+'|'+iso(start),job_id:site.job_ids.length===1?site.job_ids[0]:null,lat:site.lat,lng:site.lng,stay_from:iso(start),stay_to:iso(end),gps_minutes:intervalMinutes(gps),recovered_minutes:intervalMinutes(recovery),presence_evidence:evidence});visit=[];};
  for(const entry of entries){if(visit.length&&entry.from>Math.max(...visit.map(x=>x.to)))finish();visit.push(entry);}finish();
 }
 const segments=[];for(const g of m.segments){const a={...g.fromPt,ts:g.fromTs},b={...g.toPt,ts:g.toTs},key=routeKey(a,b);if(replacement.has(key)){segments.push(...replacement.get(key));replacement.delete(key);}else{const r=cache.get(key);segments.push({...g,...(Number.isFinite(r?.sec)?{driveSeconds:r.sec,driveSource:'ors'}:{})});}}
 // Near-identical endpoints are suppressed as jitter by mileage validation;
 // a full missing visit can still have two real road legs through the object.
 for(const legs of replacement.values())segments.push(...legs);segments.sort((a,b)=>Date.parse(a.fromTs)-Date.parse(b.fromTs));
 const start=Date.parse(ctx.started_at),end=Date.parse(ctx.finished_at)||time(real.at(-1)||{});const total=Number.isFinite(start)&&end>=start?minutes(start,end):null;
 const driving=motion.reduce((n,x)=>n+x.minutes,0),observed=stays.reduce((n,x)=>n+x.gps_minutes,0);
 const presence={version:1,idle_stop_version:1,total_minutes:total,drive_minutes:Math.round(driving*1000)/1000,drive_complete:skipped.length===0,observed_minutes:observed,motion_intervals:motion,stays,skipped,usable,input_points:real.map(p=>({ts:p.ts,...coords(p)}))};
 const sums={trackKm:0,roadKm:0,lineKm:0};segments.forEach(g=>{const key={track:'trackKm',road:'roadKm',line:'lineKm'}[g.kind];if(key)sums[key]+=Number(g.km)||0;});
 return {...m,...sums,km:sums.trackKm+sums.roadKm+sums.lineKm,segments,checks:calls,presence};
}

export function tripTimeSummary(trip,track,stays=[]){
 const data=track?.data||track,p=data?.presence;
 const start=Date.parse(trip?.started_at),end=Date.parse(trip?.finished_at)||Date.parse(p?.source_to);
 const total=Number.isFinite(start)&&end>=start?(end-start)/MIN:null;
 const road=p?.version===1&&p.usable&&p.drive_complete!==false&&Number.isFinite(p.drive_minutes)?p.drive_minutes:null;
 const approved=stays.filter(s=>s.status==='approved'&&s.job_id&&s.minutes_mgr!=null);
 const stopped=approved.reduce((n,s)=>n+Number(s.minutes_mgr),0);
 const pending=stays.filter(s=>!['approved','rejected'].includes(s.status)).reduce((n,s)=>n+(presenceBounds(s)?.extra||0),0);
 const unallocated=total!=null&&road!=null?Math.max(0,total-road-stopped):null;
 return {total,road,stopped:approved.length?stopped:null,pending,unallocated,estimatedRoad:!!p?.motion_intervals?.some(x=>x.source==='ors'),sourceTo:p?.source_to,skipped:p?.skipped||[]};
}
