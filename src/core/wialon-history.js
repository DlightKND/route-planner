// Wialon WLN: REG;seconds;longitude;latitude;speed;course;...;WLNTMNS:ns;...
// https://help.wialon.com/en/api/user-guide/data-format/messages
const stamp=us=>new Date(Math.floor(us/1e6)*1000).toISOString().slice(0,19)+'.'+String(us%1e6).padStart(6,'0')+'Z';
export function historyTime(ts){
 const ms=Date.parse(ts);if(!Number.isFinite(ms))throw new Error('Invalid timestamp');
 const fraction=String(ts).match(/:\d\d\.(\d+)/)?.[1]||'';
 return Math.floor(ms/1000)*1e6+Number(fraction.padEnd(6,'0').slice(0,6));
}
export function parseWialonMessages(text){
 const points=[],errors=[],seen=new Map();let duplicates=0;
 for(const [i,line] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  if(!line.trim())continue;
  try{
   const f=line.split(';');if(f[0]!=='REG')throw new Error('Unsupported message type');
   if(!/^\d+$/.test(f[1]))throw new Error('Invalid timestamp');
   const seconds=BigInt(f[1]),ns=line.match(/(?:^|[;,])WLNTMNS:(\d+)(?=[;,]|$)/)?.[1];
   const nanos=ns?BigInt(ns):seconds*1000000000n;
   if(nanos<0n||nanos/1000000000n!==seconds)throw new Error('Inconsistent WLNTMNS');
   const us=Number(nanos/1000n);if(!Number.isSafeInteger(us))throw new Error('Unsupported timestamp precision');
   if(f.slice(2,5).some(x=>x==null||!x.trim()))throw new Error('Missing coordinates or speed');
   const lng=Number(f[2]),lat=Number(f[3]),speed=Number(f[4]);
   if(![lat,lng,speed].every(Number.isFinite)||lat<-90||lat>90||lng<-180||lng>180||speed<0||(lat===0&&lng===0))throw new Error('Invalid GPS');
   const p={us,ts:stamp(us),lat,lng,speed,line:i+1},old=seen.get(us);
   if(old){if(old.lat!==lat||old.lng!==lng||old.speed!==speed)throw new Error('Conflicting messages at the same precise time');duplicates++;continue;}
   seen.set(us,p);points.push(p);
  }catch(e){errors.push({line:i+1,error:e.message});}
 }
 points.sort((a,b)=>a.us-b.us);return {points,errors,duplicates};
}
export function historyDistance(a,b){
 const rad=n=>n*Math.PI/180,x=rad(b.lat-a.lat),y=rad(b.lng-a.lng);
 const z=Math.sin(x/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(y/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(z),Math.sqrt(Math.max(0,1-z)));
}
// Anchor at the last accepted fix. Quarantine impossible excursions until a
// physically reachable fix returns; a short burst cannot relocate the anchor.
export function filterTeleportPoints(points,{maxKmh=300,jitterKm=.1,jumpFloorKm=100}={}){
 if(!(maxKmh>0&&jitterKm>=0))throw new Error('Invalid GPS quality settings');
 const accepted=[],rejected=[];let anchor=null;
 for(const p of points){
  const dt=anchor?(p.us-anchor.us)/1e6:0;
  if(anchor&&(dt<=0||historyDistance(anchor,p)>Math.max(jumpFloorKm,jitterKm+maxKmh*dt/3600))){rejected.push({...p,reason:'unreachable_from_last_valid_fix'});continue;}
  accepted.push(p);anchor=p;
 }
 return {points:accepted,rejected};
}
// Keep stops outside a depot in the same journey, including overnight stops.
// A confirmed idle period at a depot or a GPS gap closes the previous journey.
export function historicalJourneys(points,{depots=[],radiusKm=5,idleMinutes=61,gapSeconds=300}={}){
 const result=[];let active=null,idleAt=null,previous=null;
 const close=(end,why)=>{if(active){result.push({...active,to:end,reason:why});active=null;}idleAt=null;};
 for(const p of points){
  if(previous&&(p.us-previous.us)/1e6>gapSeconds)close(previous.us,'gps_gap');
  const moving=p.speed>3,inside=depots.some(d=>historyDistance(d,p)<=radiusKm);
  if(moving){if(!active)active={from:previous&&(p.us-previous.us)/1e6<=gapSeconds?previous.us:p.us};idleAt=null;}
  else if(active&&inside){idleAt??=p.us;if(p.us-idleAt>=idleMinutes*60*1e6)close(idleAt,'depot_return');}
  else idleAt=null;
  previous=p;
 }
 if(active)close(previous.us,'file_end_unconfirmed');return result;
}
// Existing journal decisions and actual trip intervals are exclusion masks.
// Keep only uncovered intervals that contain movement, with their local stops.
export function uncoveredJourneys(points,journeys,masks,{minMovementPoints=2}={}){
 const sorted=masks.map(m=>({from:m.from,to:m.to})).sort((a,b)=>a.from-b.from),merged=[];
 for(const m of sorted){const last=merged.at(-1);if(last&&m.from<=last.to+1)last.to=Math.max(last.to,m.to);else merged.push({...m});}
 const out=[];
 for(const j of journeys){let intervals=[{...j}];
  for(const m of merged){intervals=intervals.flatMap(r=>m.to<r.from||m.from>r.to?[r]:[{...r,to:Math.min(r.to,m.from-1)},{...r,from:Math.max(r.from,m.to+1)}].filter(x=>x.to>=x.from));}
  for(const r of intervals){const ps=points.filter(p=>p.us>=r.from&&p.us<=r.to);if(ps.filter(p=>p.speed>3).length<minMovementPoints)continue;
   out.push({...r,from:ps[0].us,to:ps.at(-1).us,started_at:ps[0].ts,ended_at:ps.at(-1).ts,points:ps.length});
  }
 }
 return out;
}
