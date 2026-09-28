// Stop at the first rejected action: later actions may depend on its result.
// A server rejection stays on the device so the user can correct or retry it.
export async function flushQueueItems(items,{send,drop,block,isNetworkError,isSuperseded=()=>false}){
  let sent=0,blocked=0;
  for(const item of items){
    if(isSuperseded(item))continue;
    if(item.blocked_error){blocked++;break;}
    try{await send(item);}
    catch(error){
      if(isNetworkError(error))break;
      await block(item,error);blocked++;break;
    }
    // Deleting the receipt is separate from sending: a storage failure must
    // never be mistaken for a server rejection of an already accepted action.
    await drop(item.id);sent++;
  }
  return {sent,blocked};
}

// An older offline snapshot can contain edits without stable row IDs. Saving
// only its request header would silently discard its work or material edits.
export function assertReplayableJobSnapshot(snapshot){
  if(Array.isArray(snapshot.works)&&snapshot.works.length&&!snapshot.works_complete)
    throw new Error('Старые офлайн-работы без стабильных ID: откройте заявку с сетью и сохраните правку заново');
  if(Array.isArray(snapshot.parts)&&snapshot.parts.length&&!snapshot.parts_complete)
    throw new Error('Старые офлайн-материалы без полного снимка: откройте заявку с сетью и сохраните правку заново');
}
