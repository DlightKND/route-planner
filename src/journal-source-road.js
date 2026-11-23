import {haversineKm} from './core/track.js';

export function sourceRoadSections({start,end,stays,parts,maxSpeed=300},cuts=[]){
 const bounds=[{a:Date.parse(start),b:Date.parse(start),label:'Начало записи'},
  ...stays.map((stay,index)=>({a:Date.parse(stay.stay_from),b:Date.parse(stay.stay_to),label:'Стоянка '+(index+1)})),
  {a:Date.parse(end),b:Date.parse(end),label:'Конец записи'}].sort((a,b)=>a.a-b.a);
 const edges=parts.flatMap(points=>points.slice(1).flatMap((point,i)=>{
  const previous=points[i],a=Date.parse(previous.ts),b=Date.parse(point.ts),km=haversineKm(previous,point);
  return b>a&&b-a<=300000&&km*3600000/(b-a)<=maxSpeed?[{a,b,km}]:[];
 })).sort((a,b)=>a.a-b.a);
 const cutMillis=[...new Set(cuts.map(cut=>Number(cut)*1000))].sort((a,b)=>a-b);
 const sections=[];
 let cursor=0,depart=bounds[0]?.b;
 for(let index=1;index<bounds.length;index++){
  const target=bounds[index],first=depart,last=target.a;
  depart=Math.max(depart,target.b);
  if(!(first<last))continue;
  const limits=[first,...cutMillis.filter(at=>at>first&&at<last),last];
  let cumulative=0,previousKm=0;
  for(let j=1;j<limits.length;j++){
   const a=limits[j-1],b=limits[j];
   while(edges[cursor]?.b<=a)cursor++;
   let covered=0,coveredUntil=a;
   for(let i=cursor;edges[i]?.a<b;i++){
    const edge=edges[i],lo=Math.max(a,edge.a,coveredUntil),hi=Math.min(b,edge.b);
    if(hi<=lo)continue;
    covered+=hi-lo;
    coveredUntil=hi;
    cumulative+=edge.km*(hi-lo)/(edge.b-edge.a);
   }
   const rounded=Math.round(cumulative*100),measured=(rounded-previousKm)/100;
   previousKm=rounded;
   const id=String(a);
   sections.push({id,base_id:String(first),title:bounds[index-1].label+' → '+target.label,
    start_at:new Date(a).toISOString(),end_at:new Date(b).toISOString(),
    km:covered===b-a?measured:null,measured_km:measured,shares:{}});
  }
 }
 return sections;
}

export function createSourceRoadAdapter({db,trip,parts,stays,quote,maxSpeed,editable}){
 const track=trip.id,geometry={start:trip.started_at,end:trip.finished_at,parts,stays,maxSpeed};
 const source=[quote.revision,quote.points];
 const model=(draft,cuts)=>{
  const stale=!!draft&&(draft.source_revision!==source[0]||draft.source_points!==source[1]);
  return {item:{id:track},source,revision:draft?.revision??0,editable,preview:true,stale,cuts,
   sections:sourceRoadSections(geometry,cuts)};
 };
 async function read(){
  const reply=await db().from('gps_road_cut_drafts').select('revision,source_revision,source_points,cuts').eq('track_id',track).maybeSingle();
  if(reply.error)throw reply.error;
  return model(reply.data,(reply.data?.cuts||[]).map(Number));
 }
 async function save(before,row,action,at){
  if(action!=='split')throw Error('Действие доступно после привязки к выезду');
  const cuts=[...new Set([...before.cuts,at])].sort((a,b)=>a-b);
  const reply=await db().rpc('gps_road_cut_draft_save',{p_track:track,p_source_revision:source[0],p_source_points:source[1],
   p_expected:before.revision,p_cuts:cuts});
  if(reply.error)throw reply.error;
  return model({revision:reply.data,source_revision:source[0],source_points:source[1]},cuts);
 }
 function preview(before,row,at){
  const sections=sourceRoadSections(geometry,[...before.cuts,at]);
  return {left:sections.find(s=>s.id===row.id)?.km,right:sections.find(s=>s.id===String(at*1000))?.km};
 }
 return {read,save,preview};
}
