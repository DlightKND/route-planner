// Canonical planner: assignments own work, trips own roads and measurements.
// This module has no DOM, database client, legacy request scheduling or fake facts.
import {dayWindow,dayMs,dayIso} from './schedule.js';

export const PLANNER_STEP=.25;
export const uniquePeople=row=>[...new Set([row?.lead_engineer,...(row?.engineer_ids||[])].filter(Boolean))];
export const plannerClock=value=>{const n=Math.round(Number(value)*60);return Number.isFinite(n)?`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:'—';};
export const plannerDate=(date,days=0)=>dayIso(dayMs(date)+days*86400000);
export const partHours=part=>Number(part.end)-Number(part.start);
export const groupHours=group=>(group.parts||[]).reduce((n,p)=>n+partHours(p),0);
export const plannerStamp=p=>dayMs(p.date)/3600000+Number(p.start);
export const plannerSnap=value=>Math.round(Number(value)/PLANNER_STEP)*PLANNER_STEP;
const clone=value=>JSON.parse(JSON.stringify(value));
const byId=rows=>new Map(rows.map(r=>[String(r.id),r]));
const intersects=(a,b)=>a.date===b.date&&a.start<b.end-1e-7&&b.start<a.end-1e-7;

export function plannerCanManage(row,actor){
  return !!row&&!!actor?.id&&actor.active!==false&&(['admin','logist'].includes(actor.role)||[row.owner_id,row.curator_id].includes(actor.id));
}
export function plannerEditIssue(group,data,actor){
  const order=data.orders.find(o=>o.id===group.order_id),trip=data.trips.find(t=>t.id===group.trip_id);
  if(group.trip_id&&!trip)return 'Контекст выезда доступен только для просмотра. Откройте задание для проверки размещения.';
  if(group.schedule_only)return 'Исторический план без подтверждённого экипажа доступен только для просмотра.';
  if(!plannerCanManage(group.kind==='road'?trip:order,actor))return 'Нет права изменять размещение этой сущности.';
  if(order?.status==='cancelled')return 'Отменённое задание недоступно для размещения.';
  if(trip?.status==='cancelled')return 'Отменённый выезд недоступен для размещения.';
  if(group.stale&&JSON.stringify([...group.people].sort())!==JSON.stringify([...(group.auto_people||[])].sort()))return 'Состав или команда изменились. Обновите автоматическое размещение перед переносом.';
  return '';
}
export function normalizePlannerData(input={}){
  const orders=(input.orders||[]).filter(o=>!o.deleted_at),trips=(input.trips||[]).filter(t=>!t.deleted_at),orderIds=new Set(orders.map(o=>o.id)),tripIds=new Set(trips.map(t=>t.id));
  const links=(input.links||[]).filter(l=>orderIds.has(l.order_id));
  const groups=(input.groups||[]).filter(g=>g.kind==='work'?orderIds.has(g.order_id):tripIds.has(g.trip_id)).map(g=>({...g,people:[...new Set(g.people||[])],parts:clone(g.parts||[]).sort((a,b)=>a.offset-b.offset)}));
  for(const g of groups)if(g.order_id&&g.trip_id&&!links.some(l=>l.order_id===g.order_id&&l.trip_id===g.trip_id))links.push({order_id:g.order_id,trip_id:g.trip_id});
  return {...input,orders,trips,links,groups,requests:input.requests||[],profiles:input.profiles||[],stays:input.stays||[],tracks:input.tracks||[],settings:input.settings||{dayStart:7,dayEnd:16,toleranceH:1,weekend:[0,6],staffDay:{}}};
}
export function plannerAssignments(data){
  const orders=byId(data.orders),trips=byId(data.trips);
  return data.groups.flatMap(g=>g.parts.flatMap(part=>g.people.map(person=>({...part,person,source_key:g.source_key,kind:g.kind,order_id:g.order_id,trip_id:g.trip_id,group:g,order:orders.get(g.order_id),trip:trips.get(g.trip_id)}))));
}
export function plannerRelations(selection,data){
  if(!selection)return {groups:new Set(),people:new Set()};
  let orderIds=new Set(),tripIds=new Set();
  if(selection.kind==='order')orderIds.add(selection.id);
  if(selection.kind==='request')data.orders.filter(o=>o.job_id===selection.id).forEach(o=>orderIds.add(o.id));
  if(['trip','fact'].includes(selection.kind))tripIds.add(selection.trip_id||selection.id);
  if(orderIds.size)data.links.filter(l=>orderIds.has(l.order_id)).forEach(l=>tripIds.add(l.trip_id));
  const groups=data.groups.filter(g=>selection.kind==='trip'||selection.kind==='fact'?tripIds.has(g.trip_id):g.order_id&&orderIds.has(g.order_id)||g.kind==='road'&&tripIds.has(g.trip_id));
  return {groups:new Set(groups.map(g=>g.source_key)),people:new Set(groups.flatMap(g=>g.people))};
}
export function plannerSelectionState(row,selection,data){
  if(!selection)return '';
  if(selection.source_key===row.source_key&&selection.part_id===row.id)return selection.person===row.person?'primary':'shared';
  if(selection.source_key===row.source_key)return 'part';
  return plannerRelations(selection,data).groups.has(row.source_key)?'related':'muted';
}
export function plannerFilter(data,filter,actor){
  const own=actor.role==='engineer',ownOrders=new Set(data.orders.filter(o=>uniquePeople(o).includes(actor.id)||plannerCanManage(o,actor)).map(o=>o.id)),ownTrips=new Set(data.trips.filter(t=>uniquePeople(t).includes(actor.id)||plannerCanManage(t,actor)).map(t=>t.id));
  const groups=data.groups.filter(g=>!own||g.people.includes(actor.id)||g.order_id&&ownOrders.has(g.order_id)||g.trip_id&&ownTrips.has(g.trip_id));
  const rows=plannerAssignments({...data,groups}).filter(r=>r.date>=filter.from&&r.date<=filter.to&&(!own||filter.colleagues||r.person===actor.id)&&(!filter.people?.length||filter.people.includes(r.person)));
  return rows.filter(r=>{
    const o=r.order,taskFilter=plannerHasTaskFilter(filter);
    if(r.kind==='road'&&taskFilter)return data.links.filter(l=>l.trip_id===r.trip_id).some(l=>{const task=data.orders.find(t=>t.id===l.order_id);return task&&plannerOrderMatches(task,filter,data);});
    return !o||plannerOrderMatches(o,filter,data);
  });
}
export const plannerHasTaskFilter=f=>!!(f.status||f.workMode||f.warranty&&f.warranty!=='any'||['durationMin','durationMax','profitMin','profitMax'].some(k=>f[k]!=null));
export function plannerOrderFinance(order,source='plan'){
 const rows=(order.service_order_items||[]).filter(i=>!i.request_finance_void_event_id&&!i.legacy_snapshot?.request_finance_voided_at);if(!rows.length||source==='fact'&&order.status!=='completed')return null;
 let revenue=0,cost=0;
 for(const i of rows){const qty=source==='fact'?i.done_qty:Math.max(0,Number(i.planned_qty||0)-Number(i.transferred_qty||0));if(qty==null||!Number.isFinite(+qty))return null;
  const r=i.kind==='material'?i.unit_price_snapshot:i.financial_revenue_snapshot,c=i.kind==='material'?i.unit_cost_snapshot:i.financial_cost_snapshot;
  if(r==null||c==null||!Number.isFinite(+r)||!Number.isFinite(+c)||i.kind!=='material'&&!(Number(i.planned_qty)>0))return null;
  const factor=i.kind==='material'?Number(qty):Number(qty)/Number(i.planned_qty);revenue+=(i.kind==='material'&&i.billable===false?0:Number(r))*factor;cost+=Number(c)*factor;
 }return {revenue,cost,profit:revenue-cost,margin:revenue>0?(revenue-cost)/revenue*100:null};
}
export function plannerOrderMatches(order,filter,data){
  const items=order.service_order_items||[],warranty=items.some(i=>i.kind==='work'&&i.billable===false&&!i.request_finance_void_event_id&&!i.legacy_snapshot?.request_finance_voided_at);
  if(filter.durationMin!=null||filter.durationMax!=null){const groups=data?.groups.filter(g=>g.order_id===order.id),total=data?.orderPlanHours?.[order.id];if(total==null&&!groups?.length)return false;const hours=total??groups.reduce((n,g)=>n+groupHours(g),0);if(filter.durationMin!=null&&hours<filter.durationMin||filter.durationMax!=null&&hours>filter.durationMax)return false;}
  if(filter.profitMin!=null||filter.profitMax!=null){const value=plannerOrderFinance(order,filter.profitSource)?.[filter.profitMetric||'margin'];if(value==null||filter.profitMin!=null&&value<filter.profitMin||filter.profitMax!=null&&value>filter.profitMax)return false;}
  return (!filter.status||order.status===filter.status)&&(!filter.workMode||order.work_mode===filter.workMode)&&(filter.warranty==null||filter.warranty==='any'||warranty===(filter.warranty==='yes'));
}
export function plannerJointWindow(people,date,settings){
  const windows=people.map(id=>dayWindow(id,date,settings));if(!windows.length||windows.some(w=>!w))return null;
  const start=Math.max(...windows.map(w=>w.start)),end=Math.min(...windows.map(w=>w.end)),ceiling=Math.min(...windows.map(w=>w.ceiling));return ceiling>start?{start,end,ceiling}:null;
}
export function plannerCapacity(people,from,to,settings){
  let hours=0;const daily=[];
  for(let date=from;date<=to;date=plannerDate(date,1)){let capacity=0;for(const person of people){const window=dayWindow(person,date,settings);if(window)capacity+=Math.max(0,window.end-window.start);}daily.push({date,capacity});hours+=capacity;}
  return {hours,daily};
}
export function plannerWorkload(data,person,from,to){
 const rows=plannerAssignments(data).filter(p=>p.person===person&&p.date>=from&&p.date<=to),union=parts=>{let end=-Infinity,total=0;for(const p of [...parts].sort((a,b)=>a.start-b.start)){total+=Math.max(0,p.end-Math.max(p.start,end));end=Math.max(end,p.end);}return total;};
 let busy=0,overlap=0,outside=0,excess=0;
 for(let date=from;date<=to;date=plannerDate(date,1)){const parts=rows.filter(p=>p.date===date),hours=union(parts),w=dayWindow(person,date,data.settings),inside=w?union(parts.map(p=>({...p,start:Math.max(w.start,p.start),end:Math.min(w.end,p.end)})).filter(p=>p.end>p.start)):0;busy+=hours;overlap+=parts.reduce((n,p)=>n+partHours(p),0)-hours;outside+=hours-inside;excess+=Math.max(0,hours-(w?w.end-w.start:0));}
 const capacity=plannerCapacity([person],from,to,data.settings).hours;return {busy,overlap,outside,excess,capacity,free:Math.max(0,capacity-(busy-outside)),percent:capacity?busy/capacity*100:null,work:rows.filter(p=>p.kind==='work').reduce((n,p)=>n+partHours(p),0),road:rows.filter(p=>p.kind==='road').reduce((n,p)=>n+partHours(p),0)};
}
export function plannerDayFrame(date,data,actor,facts=[],view={}){
  const personal=actor.role==='engineer';
  if(!personal&&!view.hideOffHours)return {start:0,end:24,span:24,closed:false};
  const people=personal?[actor.id]:(view.people||[...new Set(plannerAssignments(data).map(p=>p.person))]);
  const windows=people.map(id=>dayWindow(id,date,data.settings)).filter(Boolean),rows=plannerAssignments(data).filter(p=>p.date===date&&people.includes(p.person)),actual=facts.filter(f=>f.date===date&&f.people.some(id=>people.includes(id)));
  // Keep every booking and measurement in the selected columns, even outside a shift.
  const starts=[...windows.map(w=>w.start),...rows.map(p=>p.start),...actual.map(p=>p.start)],ends=[...windows.map(w=>w.ceiling),...rows.map(p=>p.end),...actual.map(p=>p.end)];
  if(!starts.length)return {start:0,end:24,span:24,closed:true};
  const start=Math.max(0,Math.floor(Math.min(...starts)*4)/4),end=Math.min(24,Math.ceil(Math.max(...ends)*4)/4),frame={start,end,span:Math.max(.25,end-start),closed:false};
  // A personal override changes that window, not the zoom of every other column/day.
  if(!personal)frame.scaleSpan=Math.max(.25,Number(data.settings.dayEnd??16)+Number(data.settings.toleranceH??1)-Number(data.settings.dayStart??7));
  return frame;
}
export function plannerWorkDayValues({start,end,tolerance,closed=false,propose=false}){
 if(closed)return {start:0,end:0,tolerance:0};
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>24||end<=start||start*4%1||end*4%1||!Number.isFinite(tolerance)||tolerance<0||tolerance>8||tolerance*4%1||!propose&&end+tolerance>24)throw Error('Укажите корректное рабочее время с шагом 15 минут.');
 return {start,end,tolerance};
}
export const plannerWorkDayFields=['start_h','end_h','tol_h','proposed_end_h','proposed_by','proposed_at'];
export function plannerWorkDayReceipt(row){return Object.fromEntries(plannerWorkDayFields.map(k=>[k,row?.[k]??null]));}
export function plannerWorkWindowChange(window,boundary,value){
  if(!window||!Number.isFinite(value))throw Error('Рабочее окно недоступно.');
  if(boundary==='start'){
    const length=window.end-window.start,max=Math.max(0,24-length-window.tol),start=Math.max(0,Math.min(max,plannerSnap(value)));
    return {start,end:start+length,tolerance:window.tol};
  }
  if(boundary==='tolerance')return {start:window.start,end:window.end,tolerance:Math.max(0,Math.min(8,24-window.end,plannerSnap(value)-window.end))};
  throw Error('Неизвестная граница рабочего дня.');
}

export function plannerGeometry(part,frame,pxPerHour){return {top:(part.start-frame.start)*pxPerHour,height:Math.max(1,(part.end-part.start)*pxPerHour)};}

export function splitPlannerPart(group,partId,cut,newId){
  const result={...clone(group),manual:true},index=result.parts.findIndex(p=>p.id===partId),part=result.parts[index];
  if(group.manual===false&&result.parts.length>1)for(const p of result.parts)p.carry_root=result.parts[0].id;
  if(!part||!Number.isFinite(cut)||Math.abs(cut*4-Math.round(cut*4))>1e-7||cut<part.start+.25||cut>part.end-.25)throw Error('Разрез должен оставить с каждой стороны хотя бы 15 минут.');
  result.parts.splice(index,1,{...part,end:cut},{...part,id:newId,start:cut,offset:part.offset+cut-part.start});
  if(part.carry_root){const offset=part.offset+cut-part.start;for(const p of result.parts)if(p.carry_root===part.carry_root)p.carry_root=p.offset<offset-1e-8?part.carry_root:newId;}
  return result;
}
export function plannerPartChain(group,partId){
 const part=group.parts.find(p=>p.id===partId);if(!part)throw Error('Участок не найден.');
 return (group.manual===false?group.parts:part.carry_root?group.parts.filter(p=>p.carry_root===part.carry_root):[part]).slice().sort((a,b)=>a.offset-b.offset);
}
function plannerCarryStart(people,date,clock,before,settings){
 let window;
 for(let guard=0;guard<400;guard++,date=plannerDate(date,1),clock=0){window=plannerJointWindow(people,date,settings);if(window&&clock<window.ceiling-1e-8){clock=Math.max(clock,window.start);break;}window=null;}
 if(!window)throw Error('Не найден общий рабочий день команды.');
 for(let guard=0;guard<400;guard++){
  const room=clock-window.start;if(before<=room+1e-8)return {date,start:plannerSnap(clock-before)};
  before-=room;window=null;
  for(let skipped=0;skipped<400;skipped++){date=plannerDate(date,-1);window=plannerJointWindow(people,date,settings);if(window)break;}
  if(!window)break;clock=window.ceiling;
 }
 throw Error('Не удалось найти начало переносимой части в рабочем календаре.');
}
export function movePlannerPart(group,partId,date,start,settings){
  const result={...clone(group),manual:true},index=result.parts.findIndex(p=>p.id===partId),part=result.parts[index];if(!part)throw Error('Участок не найден.');
  let length=partHours(part);
  // Without calendar context this remains a clock translation for geometry callers.
  if(!settings){Object.assign(part,{date,start,end:start+length});return result;}
  if(!Number.isFinite(start)||start<0||start>24||plannerDate(date)!==date||!(length>0))throw Error('Укажите корректные дату и время переноса.');
  if(!group.people.length)throw Error('Для переноса по рабочим часам нужна назначенная команда.');
  const chain=plannerPartChain(group,partId).map(p=>result.parts.find(q=>q.id===p.id)),first=chain[0],moving=new Set(chain.map(p=>p.id));length=groupHours({parts:chain});
  ({date,start}=plannerCarryStart(group.people,date,start,part.offset-first.offset,settings));
  const round=value=>Math.round(value*1e8)/1e8,parts=[],ids=new Set(result.parts.filter(p=>!moving.has(p.id)).map(p=>p.id));let left=length,used=0,clock=start;
  for(let guard=0;left>1e-8&&guard<400;guard++,date=plannerDate(date,1),clock=0){
    const window=plannerJointWindow(group.people,date,settings);if(!window)continue;
    clock=Math.max(window.start,clock);const room=round(window.ceiling-clock);if(room<=1e-8)continue;
    let take=Math.min(left,room);
    // Preserve minute-precision durations while respecting the RPC's 15-minute minimum for new fragments.
    if(left-take>1e-8&&left-take<PLANNER_STEP)take=round(left-PLANNER_STEP);
    if(take<PLANNER_STEP-1e-8&&(parts.length||Math.abs(take-partHours(first))>1e-8))continue;
    let id=first.id;if(parts.length){const base=first.id.slice(0,120)+':carry:'+round(used);id=base;for(let suffix=2;ids.has(id);suffix++)id=base+':'+suffix;}
    ids.add(id);parts.push({...first,id,date,start:clock,end:round(clock+take),offset:round(first.offset+used),carry_root:first.carry_root||first.id});used=round(used+take);left=round(length-used);
  }
  if(left>1e-8)throw Error('Не удалось найти достаточно общих рабочих часов команды в ближайшие 400 дней.');
  result.parts=result.parts.filter(p=>!moving.has(p.id)).concat(parts).sort((a,b)=>a.offset-b.offset);return result;
}
export function joinPlannerParts(group,aId,bId,settings){
  const result={...clone(group),manual:true},a=result.parts.find(p=>p.id===aId),b=result.parts.find(p=>p.id===bId);if(!a||!b||a===b)throw Error('Выберите две части одного исходного бруска.');
  if(settings){
   const left=plannerPartChain(group,aId),right=plannerPartChain(group,bId);if(left.some(p=>right.some(q=>p.id===q.id)))return clone(group);
   const [first,last]=left[0].offset<right[0].offset?[left,right]:[right,left],hours=groupHours({parts:first}),firstPart=first[0];
   if(Math.abs(firstPart.offset+hours-last[0].offset)>1e-7)throw Error('Можно сцепить только соседние части.');
   const anchor=plannerCarryStart(group.people,b.date,b.start,b.offset-firstPart.offset,settings),removed=new Set([...first,...last].map(p=>p.id));
   const joined={...firstPart,date:anchor.date,start:anchor.start,end:anchor.start+hours+groupHours({parts:last}),carry_root:firstPart.id};
   result.parts=result.parts.filter(p=>!removed.has(p.id)).concat(joined).sort((p,q)=>p.offset-q.offset);
   return movePlannerPart(result,joined.id,joined.date,joined.start,settings);
  }
  const [first,last]=a.offset<b.offset?[a,b]:[b,a];if(Math.abs(first.offset+partHours(first)-last.offset)>1e-7)throw Error('Можно сцепить только соседние части.');
  // Preserve the target half's clock. Joining an untouched split restores its original span.
  let start=b===last?b.start-partHours(first):b.start;
  if(b.date!==first.date||Math.abs(start-first.start)>1e-7)start=plannerSnap(start);
  const joined={...first,date:b.date,start,end:start+partHours(first)+partHours(last)};result.parts=result.parts.filter(p=>p!==first&&p!==last);result.parts.push(joined);result.parts.sort((p,q)=>p.offset-q.offset);return result;
}
// One logical selection can contain work, road and deliberately split pieces.
export function plannerSelectionParts(groups,selection){
 const result=[],seen=new Set();
 for(const pick of selection){const group=groups.find(g=>g.source_key===(pick.source_key||pick.key)),part=group?.parts.find(p=>p.id===(pick.part_id||pick.part));if(!part)continue;const chain=plannerPartChain(group,part.id),root=chain[0],key=group.source_key+'|'+root.id;if(seen.has(key))continue;seen.add(key);result.push({group,part:root,chain});}
 return result.sort((a,b)=>plannerStamp(a.part)-plannerStamp(b.part)||a.part.offset-b.part.offset);
}
export function movePlannerSelection(groups,selection,anchor,date,start,settings){
 const entries=plannerSelectionParts(groups,selection),source=groups.find(g=>g.source_key===anchor.source_key),part=source?.parts.find(p=>p.id===anchor.part_id);if(!entries.length||!part)throw Error('Выберите переносимые бруски.');
 const delta=(dayMs(date)-dayMs(part.date))/3600000+start-part.start,changed=new Map(),placed=[];
 for(const entry of entries){const base=changed.get(entry.group.source_key)||entry.group,stamp=plannerStamp(entry.part)+delta,day=dayIso(Math.floor(stamp/24)*86400000),clock=plannerSnap(stamp-Math.floor(stamp/24)*24);let moved=movePlannerPart(base,entry.part.id,day,clock,settings);
  // Carrying an earlier selected part may consume the next working morning.
  // Keep selected neighbours in order for their shared engineers.
  const prior=placed.filter(x=>x.people.some(id=>base.people.includes(id))).flatMap(x=>x.parts),chain=plannerPartChain(moved,entry.part.id),last=prior.sort((a,b)=>plannerStamp(a)+partHours(a)-plannerStamp(b)-partHours(b)).at(-1);
  if(last&&plannerStamp(chain[0])<plannerStamp(last)+partHours(last)-1e-7)moved=movePlannerPart(base,entry.part.id,last.date,last.end,settings);
  placed.push({people:base.people,parts:plannerPartChain(moved,entry.part.id)});
  changed.set(base.source_key,moved);
 }
 return [...changed.values()];
}
export function resetPlannerTrip(groups,tripId){const selected=groups.filter(g=>g.trip_id===tripId);if(!selected.length)throw Error('В выезде нет плановых брусков.');return selected.map(g=>({...clone(g),parts:clone(g.trip_auto_parts||g.auto_parts),people:clone(g.auto_people),manual:false,stale:false,reset_trip:true,clock_reset:true}));}
export function shiftPlannerTrip(groups,tripId,days,hours=0){return groups.filter(g=>g.trip_id===tripId).map(g=>({...clone(g),manual:true,parts:g.parts.map(p=>({...p,date:plannerDate(p.date,days),start:p.start+hours,end:p.end+hours}))}));}
export function plannerChangeIssue(changes,data,actor){
  const changed=new Map(changes.map(g=>[g.source_key,g]));
  for(const group of changes){const old=data.groups.find(g=>g.source_key===group.source_key),issue=plannerEditIssue(group,data,actor);if(issue)return issue;
    if(old&&Math.abs(groupHours(old)-groupHours(group))>1e-6)return 'Общая длительность исходного бруска должна сохраниться.';
    let offset=0,previous=null;const ids=new Set();
    for(const p of [...group.parts].sort((a,b)=>a.offset-b.offset)){
      const original=old?.parts.find(q=>q.id===p.id),sameStart=original&&original.date===p.date&&Math.abs(original.start-p.start)<1e-7;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||plannerDate(p.date)!==p.date||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end>24||partHours(p)<=0||partHours(p)<.25&&!original||!sameStart&&Math.abs(p.start*4-Math.round(p.start*4))>1e-7||ids.has(p.id))return 'Укажите корректные дату и время с шагом 15 минут в пределах суток.';
      if(Math.abs(p.offset-offset)>1e-6)return 'Нарушен порядок частей бруска.';
      if(previous&&plannerStamp(p)<plannerStamp(previous)+partHours(previous)-1e-7)return 'Продолжение должно идти после предыдущей части.';
      ids.add(p.id);offset+=partHours(p);previous=p;
    }
  }
  const next=data.groups.map(g=>changed.get(g.source_key)||g),parts=next.flatMap(g=>g.parts.map(p=>({...p,group:g})));
  for(const g of changes)for(const p of g.parts){const conflict=parts.find(q=>q.group.source_key!==g.source_key&&intersects(p,q)&&g.people.some(id=>q.group.people.includes(id)));if(conflict)return 'В это время у участника уже есть работа или дорога. Учитываются и скрытые назначения.';}
  return '';
}

const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function plannerLocalTime(value){const parts=Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:+parts.hour+(+parts.minute)/60+(+parts.second)/3600};}
function localMidnight(date){let time=dayMs(date);for(let i=0;i<4;i++){const local=plannerLocalTime(time),difference=dayMs(local.date)-dayMs(date)+local.hour*3600000;if(Math.abs(difference)<1)return time;time-=difference;}return time;}
export function splitPlannerFact(from,to){
  let start=Date.parse(from),end=Date.parse(to);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return [];
  const rows=[];for(let guard=0;start<end&&guard<400;guard++){const local=plannerLocalTime(start),midnight=localMidnight(plannerDate(local.date,1)),finish=Math.min(end,midnight),last=finish===midnight?24:plannerLocalTime(finish).hour;
    if(finish<=start)break;
    // Retain UTC endpoints and real elapsed minutes across DST; clock geometry is a projection.
    rows.push({date:local.date,start:local.hour,end:last>local.hour?last:Math.min(24,local.hour+(finish-start)/3600000),from:new Date(start).toISOString(),to:new Date(finish).toISOString(),minutes:(finish-start)/60000});start=finish;
  }return rows;
}
export function plannerFacts(data){
  const facts=[],trips=byId(data.trips),add=(id,tripId,kind,from,to,source,people,extra={})=>{
    const trip=trips.get(tripId);if(!trip||trip.status==='cancelled')return;
    for(const part of splitPlannerFact(from,to))facts.push({...part,id:`${id}:${part.from}:${part.to}`,source_id:id,trip_id:tripId,kind,source,people:[...new Set(people)],...extra});
  };
  for(const stay of data.stays){if(stay.status==='rejected')continue;const trip=trips.get(stay.trip_id);if(!trip)continue;const people=['snapshot','manager'].includes(stay.crew_source)?stay.crew_ids||[]:uniquePeople(trip),evidence=stay.presence_evidence,extra={stay_id:stay.id,confirmed:stay.status==='approved',order_id:stay.service_order_id||null,crew_known:['snapshot','manager'].includes(stay.crew_source)};
    if(evidence){for(const [i,p] of (evidence.gps_intervals||[]).entries())add(`${stay.id}:gps:${i}`,stay.trip_id,'stop',p.from,p.to,'gps',people,extra);
      for(const [i,p] of (evidence.recovery_parts||[]).entries()){const raw=stay.recovery_acceptance?.[p.key],approved=raw==null?NaN:Number(raw),end=Date.parse(p.to),start=Date.parse(p.from),accepted=Number.isFinite(approved)&&approved>=0?Math.min(end-start,approved*60000):null;const from=accepted!=null&&p.side==='before'?new Date(end-accepted).toISOString():p.from,to=accepted!=null&&p.side!=='before'?new Date(start+accepted).toISOString():p.to;add(`${stay.id}:estimated:${i}`,stay.trip_id,'stop',from,to,'estimated',people,{...extra,confirmed:extra.confirmed&&accepted!=null});}
    }else add(stay.id,stay.trip_id,'stop',stay.stay_from,stay.stay_to,'gps',people,extra);
  }
  for(const track of data.tracks){const trip=trips.get(track.trip_id);if(!trip)continue;const content=track.data||track,people=uniquePeople(trip),motion=content.presence?.usable?content.presence.motion_intervals:[],blocked=data.stays.filter(s=>s.trip_id===trip.id&&s.status!=='rejected').map(s=>[Date.parse(s.stay_from),Date.parse(s.stay_to)]).filter(([a,b])=>Number.isFinite(a)&&b>a);
    const addRoad=(p,i,measured)=>{let intervals=[[Date.parse(p.from??p.fromTs),Date.parse(p.to??p.toTs)]];for(const [a,b] of blocked)intervals=intervals.flatMap(([x,y])=>y<=a||x>=b?[[x,y]]:[[x,Math.min(y,a)],[Math.max(x,b),y]].filter(([u,v])=>v>u));for(const [a,b] of intervals)if(Number.isFinite(a)&&b>a){add(`${track.trip_id}:road:${i}`,track.trip_id,'road',new Date(a).toISOString(),new Date(b).toISOString(),measured?'gps':'estimated',people,{confirmed:false,crew_known:false,track_kind:measured?'track':p.kind==='line'?'line':'road'});blocked.push([a,b]);}};
    if(motion?.length)motion.forEach((p,i)=>addRoad(p,i,p.source==='gps'));
    else (content.segments||[]).filter(p=>['track','road','line'].includes(p.kind)&&Number(p.km)>0).forEach((p,i)=>addRoad(p,i,p.kind==='track'));
  }
  return facts.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
}
