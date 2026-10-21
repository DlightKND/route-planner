// Persist field choices in this browser session, never raw telemetry or auth.
const memory=new Map();
const signature=stay=>{let hash=14695981039346656037n;for(const c of JSON.stringify(stay))hash=BigInt.asUintN(64,(hash^BigInt(c.codePointAt(0)))*1099511628211n);return hash.toString(16);};
const key=(owner,trip,stay)=>'dlight.journal.draft.v3:'+owner+':'+trip+':'+stay;
export function journalDrafts(storage,owner,trip){
 const read=stay=>{const k=key(owner,trip,stay.id);try{const v=JSON.parse(storage?.getItem(k)||'null')||memory.get(k);return v?.signature===signature(stay)?v:null;}catch{const v=memory.get(k);return v?.signature===signature(stay)?v:null;}};
 const write=(stay,value)=>{const k=key(owner,trip,stay.id),v={...value,signature:signature(stay)};memory.set(k,v);try{storage?.setItem(k,JSON.stringify(v));}catch{/* Current page memory remains available. */}};
 const remove=stay=>{const k=key(owner,trip,stay.id);memory.delete(k);try{storage?.removeItem(k);}catch{/* Storage may be disabled. */}};
 return {read,write,remove};
}
