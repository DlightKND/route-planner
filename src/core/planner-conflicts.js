// Schedule conflicts derived from the final layout. The server places work by task dates and SLA;
// manual placements win, so every rule is checked against the parts as they are now shown.
//
// Task dates (stage 1)
// order    — the route reaches the task after a task with a later date. The server books the
//            task's own date instead of placing it in the route (group.booking).
// overflow — work runs past the task end date: the day does not hold road and work together.
//            Resolved by approving overtime on that date or moving the task end date.
// early    — work is placed before the task start date (a manual move).
// sla      — work ends after the request SLA.
// Resources (stage 2)
// busy     — one engineer has two blocks at the same time.
// vehicle  — one vehicle is in two trips whose spans overlap.
// crew     — a task engineer is not in the crew of the trip that carries the task.
// closed   — the task dates contain no working day for an engineer of its crew.

import {dayWindow} from './schedule.js';

const CLOSED_ORDERS=new Set(['completed','cancelled','review']);
const CLOSED_TRIPS=new Set(['finished','done','cancelled']);
const EPS=1/120;
const hoursOf=parts=>parts.reduce((sum,part)=>sum+Math.max(0,Number(part.end)-Number(part.start)),0);
const quarter=hours=>Math.ceil(hours*4-1e-9)/4;
const dayLabel=iso=>iso?`${iso.slice(8,10)}.${iso.slice(5,7)}`:'';
const clock=hours=>{const minutes=Math.round(hours*60);return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;};
const dayNumber=iso=>Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))/864e5;
const nextDay=iso=>new Date((dayNumber(iso)+1)*864e5).toISOString().slice(0,10);
export const plannerHoursLabel=hours=>String(Math.round(hours*100)/100).replace('.',',');

function personName(data,id){const p=data.profiles?.find(x=>x.id===id);return p?.full_name||p?.name||p?.email||'Сотрудник';}
function groupTitle(data,group){
  if(group.kind==='road'){const trip=data.trips?.find(t=>t.id===group.trip_id);return `дорога выезда №${trip?.number||'—'}`;}
  const order=data.orders?.find(o=>o.id===group.order_id);return `задание №${order?.number||'—'}`;
}
function active(group,data){
  if(group.schedule_only)return false;
  const order=group.order_id&&data.orders?.find(o=>o.id===group.order_id),trip=group.trip_id&&data.trips?.find(t=>t.id===group.trip_id);
  return !(order&&CLOSED_ORDERS.has(order.status))&&!(trip&&CLOSED_TRIPS.has(trip.status));
}

function dateConflicts(group,data){
  if(group.kind!=='work')return [];
  const order=data.orders?.find(o=>o.id===group.order_id);if(!order)return [];
  const request=data.requests?.find(r=>r.id===order.job_id),parts=group.parts||[],result=[];
  if(group.booking){
    result.push({type:'order',label:'Порядок маршрута противоречит датам',
      detail:'Маршрут приходит к заданию после задания с более поздней датой. Время забронировано, пока не изменён порядок маршрута или даты задания.'});
    return result;
  }
  const late=order.date_to?parts.filter(p=>p.date>order.date_to):[];
  if(late.length){
    const hours=quarter(hoursOf(late)),until=late.map(p=>p.date).sort().at(-1);
    result.push({type:'overflow',label:`Не помещается в срок · +${plannerHoursLabel(hours)} ч`,date:order.date_to,until,hours,
      detail:`До ${dayLabel(order.date_to)} не хватает ${plannerHoursLabel(hours)} ч рабочего времени. Одобрите сверхурочные на ${dayLabel(order.date_to)} или перенесите срок задания на ${dayLabel(until)}.`});
  }
  const early=order.date_from?parts.filter(p=>p.date<order.date_from):[];
  if(early.length)result.push({type:'early',label:'Раньше даты начала задания',date:order.date_from,
    detail:`Работа стоит раньше ${dayLabel(order.date_from)} — даты начала задания.`});
  const last=parts.map(p=>p.date).sort().at(-1);
  if(request?.due_date&&last&&last>request.due_date)result.push({type:'sla',label:'Позже SLA заявки',date:request.due_date,
    detail:`Работа заканчивается ${dayLabel(last)}, а SLA заявки — ${dayLabel(request.due_date)}.`});
  if(order.date_from){
    const last=order.date_to&&order.date_to>=order.date_from?order.date_to:order.date_from,days=[];
    for(let day=order.date_from;day<=last&&days.length<31;day=nextDay(day))days.push(day);
    const person=(group.people||[]).find(id=>days.every(day=>!dayWindow(id,day,data.settings)));
    if(person)result.push({type:'closed',label:'Нерабочий день в датах задания',date:order.date_from,person,
      detail:`${days.length>1?`${dayLabel(days[0])}–${dayLabel(days.at(-1))}`:dayLabel(days[0])} — нерабочее время у ${personName(data,person)}. Откройте день в рабочих часах или перенесите даты задания.`});
  }
  const trip=group.trip_id&&data.trips?.find(t=>t.id===group.trip_id);
  if(trip){
    const crew=new Set([trip.lead_engineer,...(trip.engineer_ids||[])].filter(Boolean));
    const missing=crew.size?[...new Set([order.lead_engineer,...(order.engineer_ids||[])].filter(Boolean))].filter(id=>!crew.has(id)):[];
    if(missing.length)result.push({type:'crew',label:'Исполнитель не едет в выезде',entity:{kind:'trip',id:trip.id},
      detail:`${missing.map(id=>personName(data,id)).join(', ')} ${missing.length>1?'назначены':'назначен(а)'} на задание, но не ${missing.length>1?'входят':'входит'} в экипаж выезда №${trip.number||'—'}.`});
  }
  return result;
}

function busyConflicts(groups,data,add){
  const byPerson=new Map();
  for(const group of groups)for(const person of new Set(group.people||[]))for(const part of group.parts||[]){
    if(!byPerson.has(person))byPerson.set(person,[]);byPerson.get(person).push({group,part});
  }
  for(const [person,rows] of byPerson){
    rows.sort((a,b)=>a.part.date.localeCompare(b.part.date)||a.part.start-b.part.start);
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length&&rows[j].part.date===rows[i].part.date&&rows[j].part.start<rows[i].part.end-EPS;j++){
      const a=rows[i],b=rows[j];if(a.group===b.group)continue;
      // A booking of the same trip already explains the overlap with its own route.
      if(a.group.trip_id&&a.group.trip_id===b.group.trip_id&&(a.group.booking||b.group.booking))continue;
      const date=a.part.date,from=Math.max(a.part.start,b.part.start),to=Math.min(a.part.end,b.part.end),key='busy:'+person+':'+date+':'+[a.group.source_key,b.group.source_key].sort().join('|');
      for(const [own,other] of [[a.group,b.group],[b.group,a.group]])add(own,{type:'busy',key,person,date,label:`Двойная занятость · ${personName(data,person)}`,
        entity:{kind:other.kind==='road'?'trip':'order',id:other.kind==='road'?other.trip_id:other.order_id},
        detail:`${dayLabel(date)} ${clock(from)}–${clock(to)} у ${personName(data,person)} уже стоит ${groupTitle(data,other)}.`});
    }
  }
}

function vehicleConflicts(groups,data,add){
  const spans=new Map();
  for(const group of groups){
    if(!group.trip_id||group.booking)continue;
    for(const part of group.parts||[]){
      const from=dayNumber(part.date)*24+part.start,to=dayNumber(part.date)*24+part.end,span=spans.get(group.trip_id)||{from,to,groups:[]};
      span.from=Math.min(span.from,from);span.to=Math.max(span.to,to);if(!span.groups.includes(group))span.groups.push(group);spans.set(group.trip_id,span);
    }
  }
  const trips=(data.trips||[]).filter(t=>t.vehicle_id&&spans.has(t.id));
  for(let i=0;i<trips.length;i++)for(let j=i+1;j<trips.length;j++){
    const a=trips[i],b=trips[j];if(a.vehicle_id!==b.vehicle_id)continue;
    const sa=spans.get(a.id),sb=spans.get(b.id);if(!(sa.from<sb.to-EPS&&sb.from<sa.to-EPS))continue;
    const key='vehicle:'+[a.id,b.id].sort().join('|');
    for(const [own,other,span] of [[a,b,sb],[b,a,sa]]){
      const vehicle=own.vehicle_label||[own.vehicles?.name,own.vehicles?.plate].filter(Boolean).join(' ')||'Машина';
      const range=`${dayLabel(new Date(Math.floor(span.from/24)*864e5).toISOString().slice(0,10))}–${dayLabel(new Date(Math.floor((span.to-EPS)/24)*864e5).toISOString().slice(0,10))}`;
      const targets=spans.get(own.id).groups.filter(g=>g.kind==='road');
      for(const group of targets.length?targets:spans.get(own.id).groups)add(group,{type:'vehicle',key,label:'Машина занята другим выездом',entity:{kind:'trip',id:other.id},
        detail:`${vehicle} в это время в выезде №${other.number||'—'} (${range}).`});
    }
  }
}

function compute(data){
  const conflicts=new Map(),groups=(data.groups||[]).filter(g=>active(g,data));
  const add=(group,conflict)=>{const list=conflicts.get(group.source_key)||[];const key=conflict.key||group.source_key+':'+conflict.type+':'+(conflict.person||'');if(!list.some(c=>c.key===key))list.push({...conflict,key});conflicts.set(group.source_key,list);};
  for(const group of groups)for(const conflict of dateConflicts(group,data))add(group,conflict);
  busyConflicts(groups,data,add);
  vehicleConflicts(groups,data,add);
  return conflicts;
}

// One computation per layout: the view asks for every block, the overview and the cards.
const memo=new WeakMap();
function signature(data){let sum=(data.groups||[]).length;for(const g of data.groups||[])for(const p of g.parts||[])sum=(sum*31+dayNumber(p.date)+p.start*7+p.end*13)%1e9;return sum+':'+(data.orders||[]).length+':'+(data.trips||[]).length;}
export function plannerConflicts(data){
  const sign=signature(data),hit=memo.get(data);
  if(hit&&hit.groups===data.groups&&hit.sign===sign)return hit.map;
  const map=compute(data);memo.set(data,{groups:data.groups,sign,map});return map;
}
export function plannerGroupConflicts(group,data){return group?plannerConflicts(data).get(group.source_key)||[]:[];}

// Overtime that makes the overflow fit: added to each crew member's day at the task end date.
export function plannerOvertimeChanges(group,conflict,data,windowOf){
  return [...new Set(group.people||[])].map(person=>{
    const window=windowOf(person,conflict.date,data.settings);
    if(!window)return {person,issue:`${dayLabel(conflict.date)} — нерабочий день. Сначала откройте этот день в рабочих часах.`};
    const tolerance=quarter((window.tol||0)+conflict.hours);
    if(tolerance>8||window.end+tolerance>24)return {person,issue:`Сверхурочные на ${dayLabel(conflict.date)} не помещаются в сутки (нужно ${plannerHoursLabel(tolerance)} ч).`};
    return {person,date:conflict.date,start:window.start,end:window.end,tolerance};
  });
}
