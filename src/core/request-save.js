// The online editor and offline queue share one transaction boundary for the
// request record and its work/material plan. Older queue payloads omit parts.
export async function saveRequestAndWorks(db,{id,record,works,parts}){
  const {data,error}=await db.rpc('job_request_save',{
    p_id:id??null,
    p_rec:record,
    p_works:works??null,
    p_parts:parts??null
  });
  if(error)throw error;
  return data;
}

// Versioned writer for the canonical seed-task source of truth. Older offline
// queue entries intentionally keep using saveRequestAndWorks above.
export async function saveCanonicalRequest(db,{id,record,works,parts}){
  const {data,error}=await db.rpc('job_request_save_canonical',{
    p_id:id??null,
    p_rec:record,
    p_works:works??null,
    p_parts:parts??null
  });
  if(error)throw error;
  return data;
}
