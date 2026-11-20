export const orderResultPhotoPath=(order,trip,photo)=>`${order}/${trip}/${photo.work_id}/${photo.id}.jpg`;

export function orderPhotoDrafts(indexedDB){
 const open=()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('dlight-order-result-photos',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('photos');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
 async function access(mode,operate){
  const database=await open();
  try{
   return await new Promise((resolve,reject)=>{
    const transaction=database.transaction('photos',mode);
    const request=operate(transaction.objectStore('photos'));
    transaction.oncomplete=()=>resolve(request?.result);
    transaction.onabort=()=>reject(transaction.error||Error('Не удалось сохранить фотографии черновика'));
   });
  }finally{database.close();}
 }
 return {
  put:entries=>access('readwrite',store=>{for(const [key,blob] of entries)store.put(blob,key);}),
  get:key=>access('readonly',store=>store.get(key)),
  remove:keys=>access('readwrite',store=>{for(const key of keys)store.delete(key);})
 };
}
