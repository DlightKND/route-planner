import {plannerPixels,plannerHitClusters,plannerPlanHitsHTML,plannerFactHitsHTML} from './planner-view.js';
import {plannerClock} from './core/planner-workspace.js';

const models=new WeakMap(),density=h=>h<32?'short':h<65?'compact':h<100?'medium':'roomy';
const all=(node,selector)=>[...node.querySelectorAll(selector)];
const position=(node,top,height)=>{node.style.top=top+'px';if(height!=null)node.style.height=height+'px';};
function laneModel(lane,scale){
 const plans=all(lane,'.pw-plan').map(node=>({node,row:{id:node.dataset.part,source_key:node.dataset.key,person:node.dataset.person,start:Number(node.dataset.start),end:Number(node.dataset.end)}})),facts=all(lane,'.pw-fact-mark').map(node=>{const tone=node.dataset.factTone;return {node,row:{id:node.dataset.fact,source_id:node.dataset.parent,kind:node.classList.contains('pw-fact-road')?'road':'stop',source:tone==='estimated'?'estimated':'gps',track_kind:tone==='unknown'?'line':'track',start:Number(node.dataset.start),end:Number(node.dataset.end)}};});
 return {lane,plans,facts,zones:all(lane,'.pw-zone,.calendar-boundary').map(node=>({node,offset:parseFloat(node.style.top)/scale,span:node.classList.contains('pw-zone')?parseFloat(node.style.height)/scale:null})),planHits:null,factHits:null};
}
function hitGeometry(model,kind,clusters,html){
 const selector=kind==='planHits'?'.pw-plan-hit':'.pw-fact-hit',signature=JSON.stringify(clusters.map(c=>c.rows.map(r=>r.id)));
 if(model[kind]?.signature!==signature){all(model.lane,selector).forEach(n=>n.remove());const target=kind==='planHits'?model.lane.querySelector('.pw-plan-area'):model.lane;target.insertAdjacentHTML('beforeend',html());model[kind]={signature,nodes:all(model.lane,selector)};}
 model[kind].nodes.forEach((node,i)=>position(node,clusters[i].top,clusters[i].bottom-clusters[i].top));
}
export const invalidatePlannerZoom=root=>models.delete(root);
// Only temporal geometry changes within daily view. Keep source cards, selection and engineer headers mounted.
export function resizePlannerTimeline(root,state){
 let model=models.get(root);
 if(model?.head!==root.firstElementChild){model={head:root.firstElementChild,days:all(root,'.pw-day').map(day=>{const start=Number(day.dataset.start),end=Number(day.dataset.end),scale=Number(day.dataset.scale);return {day,frame:{start,end,span:end-start,scaleSpan:Number(day.dataset.scaleSpan),closed:day.dataset.closed==='true'},body:day.querySelector('.pw-day-body'),axis:day.querySelector('.pw-time-axis'),tickHours:null,lanes:all(day,'.pw-lane').map(lane=>laneModel(lane,scale))};})};models.set(root,model);}
 for(const [index,item] of model.days.entries()){
  const {day,frame,body,axis,lanes}=item,px=plannerPixels(state,frame),height=frame.span*px;
  if(Number(day.dataset.scale)===px)continue;
  day.dataset.scale=String(px);body.style.height=height+'px';body.style.setProperty('--pw-hour',px+'px');body.style.setProperty('--hour',px+'px');body.style.setProperty('--pw-grid-offset',-(frame.start%1)*px+'px');
  if(!frame.closed){const step=[1,2,4,6,12,24].find(h=>h*px>=24)||24,hours=new Set([frame.start]);if(height>=24)hours.add(frame.end);for(let h=Math.ceil(frame.start/step)*step;h<frame.end;h+=step)if((h-frame.start)*px>=24&&(frame.end-h)*px>=24)hours.add(h);if(index<model.days.length-1&&frame.end===24)hours.delete(24);const key=[...hours].join(',');
   if(item.tickHours!==key){const old=all(axis,'.pw-tick');if(old.map(n=>n.dataset.hour).join(',')!==key)axis.innerHTML=[...hours].map(h=>`<span data-hour="${h}" class="pw-tick tick${h===frame.start?' first':''}${h===frame.end?' last':''}">${plannerClock(h)}</span>`).join('');item.ticks=all(axis,'.pw-tick');item.tickHours=key;}item.ticks.forEach(node=>position(node,(Number(node.dataset.hour)-frame.start)*px));
  }
  for(const lane of lanes){
   lane.zones.forEach(({node,offset,span})=>position(node,offset*px,span==null?null:span*px));
   for(const {node,row} of [...lane.plans,...lane.facts]){const h=Math.max(1,(row.end-row.start)*px);position(node,(row.start-frame.start)*px,h);if(node.classList.contains('pw-plan')){const next=density(h);if(!node.classList.contains(next)){node.classList.remove('short','compact','medium','roomy');node.classList.add(next);}}}
   if(state.mobile){const rows=lane.plans.map(p=>p.row),clusters=plannerHitClusters(rows,frame,px);hitGeometry(lane,'planHits',clusters,()=>plannerPlanHitsHTML(rows,frame,px,clusters));}
   if(state.showFact&&lane.facts.length){const rows=lane.facts.map(f=>f.row),clusters=plannerHitClusters(rows,frame,px,state.mobile?44:18);hitGeometry(lane,'factHits',clusters,()=>plannerFactHitsHTML(rows,lane.lane.dataset.person,frame,px,state,clusters));}
  }
 }
}
