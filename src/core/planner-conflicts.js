// Schedule conflicts derived from the final layout. The server places work by task dates and SLA;
// manual placements win, so every rule is checked against the parts as they are now shown.
//
// order    — the route reaches the task after a task with a later date. The server books the
//            task's own date instead of placing it in the route (group.booking).
// overflow — work runs past the task end date: the day does not hold road and work together.
//            Resolved by approving overtime on that date or moving the task end date.
// early    — work is placed before the task start date (a manual move).
// sla      — work ends after the request SLA.

const CLOSED=new Set(['completed','cancelled','review']);
const hoursOf=parts=>parts.reduce((sum,part)=>sum+Math.max(0,Number(part.end)-Number(part.start)),0);
const quarter=hours=>Math.ceil(hours*4-1e-9)/4;
const dayLabel=iso=>iso?`${iso.slice(8,10)}.${iso.slice(5,7)}`:'';
export const plannerHoursLabel=hours=>String(Math.round(hours*100)/100).replace('.',',');

export function plannerGroupConflicts(group,data){
  if(!group||group.kind!=='work')return [];
  const order=data.orders?.find(o=>o.id===group.order_id);
  if(!order||CLOSED.has(order.status))return [];
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
  return result;
}

export function plannerConflicts(data){
  const conflicts=new Map();
  for(const group of data.groups||[]){const list=plannerGroupConflicts(group,data);if(list.length)conflicts.set(group.source_key,list);}
  return conflicts;
}

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
