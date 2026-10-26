import {plannerCapacity,plannerOrderMatches,plannerHasTaskFilter,uniquePeople} from './planner-workspace.js';
import {dashboardMetrics,roadPersonHours} from './dashboard-metrics.js';
import {presenceSummary,presenceDaily} from './trip-review.js';

// Task filters never apportion a whole trip's frozen money or GPS by guesswork.
export function plannerStatistics(data,state,people,rows){
 const period={from:state.from,to:state.to},selected=new Set(people),category=plannerHasTaskFilter(state),orders=data.orders.filter(o=>plannerOrderMatches(o,state,data)),orderIds=new Set(orders.map(o=>o.id));
 const trips=data.trips.filter(t=>!category||data.links.some(l=>l.trip_id===t.id&&orderIds.has(l.order_id))),tripIds=new Set(trips.map(t=>t.id)),mixed=new Set(category?trips.filter(t=>data.links.some(l=>l.trip_id===t.id&&!orderIds.has(l.order_id))).map(t=>t.id):[]);
 const stays=data.stays.filter(s=>tripIds.has(s.trip_id)&&(!category||orderIds.has(s.service_order_id))),confirmed=presenceDaily(stays,state.from,state.to,selected),road=roadPersonHours({trips:category?[]:trips,tracks:data.tracks,presence:stays,period,engineerIds:people}),capacity=plannerCapacity(people,state.from,state.to,data.settings),hours={};
 for(const trip of trips){const source=data.stays.filter(s=>s.trip_id===trip.id),summary=presenceSummary(source);if(source.length&&summary.complete)hours[trip.id]=summary.approved;}
 const metrics=dashboardMetrics({trips:trips.map(t=>mixed.has(t.id)?{...t,econ_snapshot:{},plan_econ_snapshot:{}}:t),orders,links:data.links,tracks:data.tracks,period,engineerIds:people,factHours:hours});
 const nonFieldUnknown=orders.filter(o=>['depot','remote'].includes(o.work_mode)&&['in_progress','paused','review','completed'].includes(o.status)&&o.date_from<=state.to&&(o.date_to||o.date_from)>=state.from&&uniquePeople(o).some(id=>selected.has(id))).length;
 const relevant=trips.filter(t=>['in_progress','finished','done'].includes(t.status)&&t.date_from<=state.to&&(t.date_to||t.date_from)>=state.from&&uniquePeople(t).some(id=>selected.has(id))),presenceUnknown=relevant.filter(t=>{const source=data.stays.filter(s=>s.trip_id===t.id);return !source.length||!presenceSummary(source).complete;}).length;
 const plan=rows.reduce((n,r)=>n+r.end-r.start,0),fact=confirmed.reduce((n,r)=>n+r.hours,0)+road.hours,known=confirmed.length>0||road.known>0,complete=known&&!category&&!presenceUnknown&&!nonFieldUnknown&&road.complete&&!data.notices?.length;
 const daily=capacity.daily.map(d=>({...d,key:d.date,label:d.date.slice(8),v:rows.filter(r=>r.date===d.date).reduce((n,r)=>n+r.end-r.start,0),f:confirmed.filter(r=>r.date===d.date).reduce((n,r)=>n+r.hours,0)+road.daily.filter(r=>r.date===d.date).reduce((n,r)=>n+r.hours,0),cap:d.capacity,known:confirmed.some(r=>r.date===d.date)||road.daily.some(r=>r.date===d.date)}));
 return {metrics,capacity,plan,fact,known,complete,daily,category,mixed:mixed.size,road,presenceUnknown,nonFieldUnknown,orders};
}
