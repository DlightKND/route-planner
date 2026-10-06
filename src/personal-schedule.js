// Only supplement historical trips that the ordinary RLS read did not return.
// The RPC supplies clock/route metadata, never an inferred crew or write access.
export async function readPersonalScheduleTrips(db,links,visible){
  const ids=[...new Set((links||[]).map(x=>x.trip_id).filter(id=>id&&!visible[id]))];
  if(!ids.length)return [];
  const {data,error}=await db.rpc('legacy_personal_schedule_read',{p_trips:ids});
  if(error)throw error;
  const wanted=new Set(ids);
  return (Array.isArray(data)?data:[]).filter(t=>wanted.has(t.id)&&t.schedule_only===true);
}
