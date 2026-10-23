import {acceptedPresenceIntervals,presenceBounds} from './trip-presence-recovery.js';

export const reviewedStop=s=>['approved','rejected'].includes(s.status);
export function stopKind(stay){
 if(['visit','road','excluded','later'].includes(stay.stop_kind))return stay.stop_kind;
 if(stay.status==='rejected')return /^Остановка в пути(?:\s|[·:.—]|$)/u.test(stay.note||'')?'road':'excluded';
 return stay.status==='approved'||stay.job_id?'visit':'later';
}
export function decisionComment(note=''){return String(note??'').replace(/^(?:Остановка в пути|Исключено из присутствия|Посещение подтверждено)\s*[·:—]?\s*/u,'');}
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
export function evidenceExtent(stay){
 const intervals=[...(stay.presence_evidence?.gps_intervals||[]),...(stay.presence_evidence?.recovery_parts||[])],from=[stay.stay_from,...intervals.map(p=>p.from)].map(Date.parse).filter(Number.isFinite),to=[stay.stay_to,...intervals.map(p=>p.to)].map(Date.parse).filter(Number.isFinite);
 return {from:from.length?new Date(Math.min(...from)).toISOString():stay.stay_from,to:to.length?new Date(Math.max(...to)).toISOString():stay.stay_to};
}
export function stopTitle(stay,jobs=[],index=0){
 return stay.display_name||stay.address||((stopKind(stay)==='visit')&&jobs.find(j=>j.id===stay.job_id)?.clients?.name)||'Остановка '+(index+1);
}
export function stopPlace(stay,jobs=[],index=0){
 const job=jobs.find(j=>j.id===stay.job_id),place=stay.display_name||stay.site_name||stay.object_name;
 const coordinates=stay.lat!=null&&stay.lng!=null&&Number.isFinite(Number(stay.lat))&&Number.isFinite(Number(stay.lng));
 return {title:place||'Остановка '+(index+1),location:stay.address||job?.clients?.address||job?.clients?.addr||(coordinates?Number(stay.lat).toFixed(4)+', '+Number(stay.lng).toFixed(4):'Адрес не указан'),fullTitle:stopTitle(stay,jobs,index)};
}
export function stopState(stay){return stay.status==='approved'?'Присутствие подтверждено':'Присутствие не подтверждено';}
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
 const accepted=acceptedPresenceIntervals(stay).map(p=>[Date.parse(p.from),Date.parse(p.to)]);
 return ((track?.data||track)?.presence?.motion_intervals||[]).filter(m=>{const from=Date.parse(m.from),to=Date.parse(m.to);return accepted.some(([a,b])=>a<to&&b>from);});
}
export function tripReviewIssues(trip){
 const r=trip.review||{},issues=[];
 if(r.conflicts)issues.push({kind:'route',count:Number(r.conflicts),label:'Конфликты времени: '+Number(r.conflicts)});
 if(r.gaps)issues.push({kind:'route',count:typeof r.gaps==='number'?r.gaps:null,label:typeof r.gaps==='number'?'Участки без дорожного подтверждения: '+r.gaps:'Есть неизмеренные разрывы GPS'});
 if(r.missingTrack)issues.push({kind:'route',count:1,label:'Трек отсутствует · нужна проверка'});
 return issues;
}
export const tripAttention=trip=>tripReviewIssues(trip).length>0;
export function activityTimeline(trip,track,stays){
 const data=track?.data||track||{},from=Date.parse(trip.started_at),to=Date.parse(trip.finished_at||data.presence?.source_to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
 const motion=[...(data.segments||[]).filter(s=>s.kind==='track'&&s.fromTs&&s.toTs).map(s=>({from:s.fromTs,to:s.toTs,source:'gps'})),...(data.presence?.motion_intervals||[])].map(m=>({...m,kind:'drive',recovery:m.source==='ors'}));
 const stopParts=stays.flatMap(s=>{
  const base={kind:'stop',id:s.id,from:s.stay_from,to:s.stay_to};if(!s.stay_to)return [];
  if(!presenceBounds(s))return [{...base,recovery:false}];
  return [...(s.presence_evidence.gps_intervals||[]).map(p=>({...base,...p,recovery:false})),...(s.presence_evidence.recovery_parts||[]).map(p=>({...base,...p,recovery:true}))];
 });
 // Sweep interval boundaries once; keep original source order for overlapping evidence.
 const source=[...motion,...stopParts].map(s=>({...s,start:Date.parse(s.from),end:Date.parse(s.to)}));
 const cuts=[...new Set([from,to,...source.flatMap(s=>[s.start,s.end]).filter(t=>t>from&&t<to)])].sort((a,b)=>a-b);
 const events=source.flatMap((s,index)=>s.end>s.start&&s.start<to&&s.end>from?[{time:Math.max(from,s.start),index,open:true},{time:Math.min(to,s.end),index,open:false}]:[]).sort((a,b)=>a.time-b.time);
 const active=new Set(),stops=[],drives=[];
 function push(heap,index){let i=heap.length;heap.push(index);while(i){const parent=(i-1)>>1;if(heap[parent]<=index)break;heap[i]=heap[parent];i=parent;}heap[i]=index;}
 function first(heap){while(heap.length&&!active.has(heap[0])){const last=heap.pop();if(!heap.length)break;let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1]<heap[child])child++;if(heap[child]>=last)break;heap[i]=heap[child];i=child;}heap[i]=last;}return heap.length?source[heap[0]]:null;}
 let cursor=0;
 return cuts.slice(1).map((b,i)=>{const a=cuts[i];while(cursor<events.length&&events[cursor].time<=a){const event=events[cursor++];if(event.open){active.add(event.index);push(source[event.index].kind==='stop'?stops:drives,event.index);}else active.delete(event.index);}const stop=first(stops),drive=first(drives),part=stop||drive;return {from:a,to:b,left:(a-from)/(to-from)*100,width:(b-a)/(to-from)*100,kind:part?.kind||'unknown',recovery:!!part?.recovery,stopId:stop?.id,conflict:!!stop&&!!drive};});
}
