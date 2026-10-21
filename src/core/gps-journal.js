import {acceptedPresenceIntervals} from './trip-presence-recovery.js';

export const reviewedStop=s=>['approved','rejected'].includes(s.status);
export function journalEntries(unassigned,trips){
 const ids=new Set(trips.map(t=>t.id));
 return [...unassigned.filter(r=>!(r.state==='linked'&&ids.has(r.trip_id))),...trips.map(t=>({id:'trip:'+t.id,trip_id:t.id,_trip:t,vehicle_id:t.vehicle_id,started_at:t.started_at,last_ts:t.finished_at||t.updated_at||t.started_at,ended_at:t.finished_at,state:t.finished_at?'linked':'recording'}))].sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at));
}
export function routeAmounts(track){
 const data=track?.data||track||{},parts=data.segments||[];
 const sum=kind=>parts.filter(s=>s.kind===kind).reduce((n,s)=>n+(Number(s.km)||0),0);
 const gps=Number.isFinite(data.trackKm)?data.trackKm:parts.length?sum('track'):null;
 const restored=Number.isFinite(data.roadKm)?data.roadKm:parts.length?sum('road'):null;
 // Straight-line estimates and unknown gaps are never labelled measured mileage.
 return {gps,restored,total:gps==null?null:gps+(restored||0),unknown:parts.filter(s=>!['track','road'].includes(s.kind))};
}
export function presenceRoadConflicts(stay,track){
 if(stay.status!=='approved')return [];
 const motion=(track?.data||track)?.presence?.motion_intervals||[];
 return motion.filter(m=>acceptedPresenceIntervals(stay).some(p=>Date.parse(p.from)<Date.parse(m.to)&&Date.parse(p.to)>Date.parse(m.from)));
}
export function activityTimeline(trip,track,stays){
 const data=track?.data||track||{},from=Date.parse(trip.started_at),to=Date.parse(trip.finished_at||data.presence?.source_to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
 const source=[...(data.presence?.motion_intervals||[]).map(x=>({...x,kind:'drive',recovery:x.source==='ors'})),...stays.filter(s=>s.stay_to).map(s=>({from:s.stay_from,to:s.stay_to,kind:'stop',id:s.id,recovery:!!s.presence_evidence?.recovery_parts?.length}))];
 const cuts=[...new Set([from,to,...source.flatMap(s=>[Date.parse(s.from),Date.parse(s.to)]).filter(t=>t>from&&t<to)])].sort((a,b)=>a-b);
 return cuts.slice(1).map((b,i)=>{const a=cuts[i],items=source.filter(s=>Date.parse(s.from)<=a&&Date.parse(s.to)>=b),stop=items.find(s=>s.kind==='stop'),part=stop||items[0];return {from:a,to:b,left:(a-from)/(to-from)*100,width:(b-a)/(to-from)*100,kind:part?.kind||'unknown',recovery:items.some(s=>s.recovery),stopId:stop?.id,conflict:!!stop&&items.some(s=>s.kind==='drive')};});
}
