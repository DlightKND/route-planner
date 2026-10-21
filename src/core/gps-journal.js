import {acceptedPresenceIntervals,presenceBounds} from './trip-presence-recovery.js';

export const reviewedStop=s=>['approved','rejected'].includes(s.status);
export function stopKind(stay){
 if(['visit','road','excluded','later'].includes(stay.stop_kind))return stay.stop_kind;
 if(stay.status==='rejected')return /^Остановка в пути(?:\s|[·:.—]|$)/u.test(stay.note||'')?'road':'excluded';
 return stay.status==='approved'||stay.job_id?'visit':'later';
}
export function decisionComment(note=''){return String(note).replace(/^(?:Остановка в пути|Исключено из присутствия|Посещение подтверждено)\s*[·:—]?\s*/u,'');}
export function decisionReason(stay,comment=''){
 const text=decisionComment(comment).trim();
 return (stopKind(stay)==='road'?'Остановка в пути':stay.status==='rejected'?'Исключено из присутствия':'Посещение подтверждено')+' · '+(text||'Проверено по данным поездки');
}
export function minutesText(value){
 if(value==null||!Number.isFinite(Number(value)))return 'Нет данных';
 const m=Math.round(Number(value));return [m>=60?Math.floor(m/60)+' ч':'',m%60||m<60?(m%60)+' мин':''].filter(Boolean).join(' ');
}
export const numericText=value=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
export const kmText=value=>value==null?'Нет данных':numericText(value)+' км';
export function stopTitle(stay,jobs=[],index=0){
 return stay.display_name||stay.address||((stopKind(stay)==='visit')&&jobs.find(j=>j.id===stay.job_id)?.clients?.name)||'Остановка '+(index+1);
}
export function stopState(stay){return stopKind(stay)==='road'?'Остановка в пути':stay.status==='approved'?'Посещение подтверждено':stay.status==='rejected'?'Исключено из присутствия':!stay.stay_to?'Запись продолжается':'Не проверено';}
export function journalEntries(unassigned,trips){
 const records=new Map();
 // Canonical keys are stable even before a linked trip page arrives.
 for(const source of unassigned){
  if(source.state==='linked'&&source.trip_id){const id='trip:'+source.trip_id,old=records.get(id);records.set(id,{...source,id,_trip:{id:source.trip_id,vehicle_id:source.vehicle_id,started_at:source.started_at,finished_at:source.ended_at||source.last_ts},_sources:[...(old?._sources||[]),source]});}
  else records.set(source.id,{...source});
 }
 for(const trip of trips){const id='trip:'+trip.id,old=records.get(id);records.set(id,{id,trip_id:trip.id,_trip:trip,_sources:old?._sources||[],vehicle_id:trip.vehicle_id,started_at:trip.started_at,last_ts:trip.finished_at||trip.updated_at||trip.started_at,ended_at:trip.finished_at,state:trip.finished_at?'linked':'recording'});}
 return [...records.values()].sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at)||String(a.id).localeCompare(String(b.id)));
}
export function routeAmounts(track){
 const data=track?.data||track||{},parts=data.segments||[],sum=kind=>parts.filter(s=>s.kind===kind).reduce((n,s)=>n+(Number(s.km)||0),0);
 const gps=Number.isFinite(data.trackKm)?data.trackKm:parts.length?sum('track'):null,restored=Number.isFinite(data.roadKm)?data.roadKm:parts.length?sum('road'):null;
 return {gps,restored,total:gps==null?null:gps+(restored||0),unknown:parts.filter(s=>!['track','road'].includes(s.kind))};
}
export function presenceRoadConflicts(stay,track){
 if(stay.status!=='approved')return [];
 return ((track?.data||track)?.presence?.motion_intervals||[]).filter(m=>acceptedPresenceIntervals(stay).some(p=>Date.parse(p.from)<Date.parse(m.to)&&Date.parse(p.to)>Date.parse(m.from)));
}
export function tripAttention(trip){const r=trip.review||{};return !!(r.done<r.total||r.recovery||r.gaps||r.conflicts||r.missingTrack);}
export function activityTimeline(trip,track,stays){
 const data=track?.data||track||{},from=Date.parse(trip.started_at),to=Date.parse(trip.finished_at||data.presence?.source_to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
 const motion=(data.presence?.motion_intervals||[]).map(m=>({...m,kind:'drive',recovery:m.source==='ors'}));
 const stopParts=stays.flatMap(s=>{
  const base={kind:'stop',id:s.id,from:s.stay_from,to:s.stay_to};if(!s.stay_to)return [];
  if(!presenceBounds(s))return [{...base,recovery:false}];
  return [...(s.presence_evidence.gps_intervals||[]).map(p=>({...base,...p,recovery:false})),...(s.presence_evidence.recovery_parts||[]).map(p=>({...base,...p,recovery:true}))];
 });
 const source=[...motion,...stopParts],cuts=[...new Set([from,to,...source.flatMap(s=>[Date.parse(s.from),Date.parse(s.to)]).filter(t=>t>from&&t<to)])].sort((a,b)=>a-b);
 return cuts.slice(1).map((b,i)=>{const a=cuts[i],items=source.filter(s=>Date.parse(s.from)<=a&&Date.parse(s.to)>=b),stop=items.find(s=>s.kind==='stop'),part=stop||items[0];return {from:a,to:b,left:(a-from)/(to-from)*100,width:(b-a)/(to-from)*100,kind:part?.kind||'unknown',recovery:!!part?.recovery,stopId:stop?.id,conflict:!!stop&&items.some(s=>s.kind==='drive')};});
}
