// The online editor and offline queue share one transaction boundary for the
// request record and its work plan.
export async function saveRequestAndWorks(db,{id,record,works}){
  const {data,error}=await db.rpc('job_request_save',{
    p_id:id??null,
    p_rec:record,
    p_works:works??null
  });
  if(error)throw error;
  return data;
}
