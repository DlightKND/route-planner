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
