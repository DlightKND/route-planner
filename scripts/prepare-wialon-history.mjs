import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseWialonMessages,filterTeleportPoints,historicalJourneys,uncoveredJourneys,historyTime,historyDistance} from '../src/core/wialon-history.js';
import {historyArchiveSQL,historyJournalSQL} from './wialon-history-sql.mjs';
const [file,inventoryFile,existingFile,out]=process.argv.slice(2);
if(!file||!inventoryFile||!existingFile||!out)throw new Error('Usage: node scripts/prepare-wialon-history.mjs file.wln inventory.json existing.json output-directory');
const input=readFileSync(file),inventory=JSON.parse(readFileSync(inventoryFile)),existing=JSON.parse(readFileSync(existingFile));
const parsed=parseWialonMessages(input.toString('utf8'));if(parsed.errors.length)throw new Error(JSON.stringify(parsed.errors));
const vehicle=inventory.vehicles.find(v=>file.toUpperCase().includes(v.plate.toUpperCase()));
if(!vehicle||inventory.vehicles.filter(v=>file.toUpperCase().includes(v.plate.toUpperCase())).length!==1)throw new Error('Ambiguous vehicle mapping');
const matched={vehicleId:vehicle.id,wialonId:vehicle.wialon_id,plate:vehicle.plate};
const archived=new Map((existing.archive||[]).map(r=>[Math.round(r[0]*1e6),r]));
const conflicts=parsed.points.filter(p=>{const r=archived.get(p.us);return r&&(Math.abs(p.lat-r[1])>1e-6||Math.abs(p.lng-r[2])>1e-6);});
// Preserve the canonical stored fix at a colliding timestamp, never overwrite it.
// Older receivers can round WLNTMNS to a second; include the collision in audit.
const canonical=parsed.points.map(p=>{const r=archived.get(p.us);return r?{...p,lat:r[1],lng:r[2],speed:r[3]??p.speed}:p;});
const quality=filterTeleportPoints(canonical,{maxKmh:inventory.settings.track_max_kmh});
const masks=(existing.journal||[]).filter(t=>t.vehicle_id===vehicle.id).map(t=>({from:historyTime(t.from),to:t.state==='recording'?Infinity:historyTime(t.to)}));
for(const t of existing.trips||[])if(t.started_at)masks.push({from:historyTime(t.started_at),to:t.finished_at?historyTime(t.finished_at):Infinity});
const journeys=historicalJourneys(quality.points,{depots:inventory.depots,radiusKm:inventory.settings.depot_radius_m/1000,idleMinutes:inventory.settings.depot_outside_minutes});
const ranges=uncoveredJourneys(quality.points,journeys,masks);
const source={source:'wialon_wln',filename:file.split('/').at(-1),sha256:createHash('sha256').update(input).digest('hex'),raw_points:parsed.points.length,rejected_points:quality.rejected.length};
const summary={...source,vehicle:vehicle.plate,first:parsed.points[0].ts,last:parsed.points.at(-1).ts,accepted:quality.points.length,duplicates:parsed.duplicates,existing_conflicts_preserved:conflicts.map(p=>p.line),already_archived:quality.points.filter(p=>archived.has(p.us)).length,new_archive_points:quality.points.filter(p=>!archived.has(p.us)).length,quarantine:quality.rejected.map(p=>({line:p.line,ts:p.ts,reason:p.reason})),journeys,ranges:ranges.map(r=>{
 const ps=quality.points.filter(p=>p.us>=r.from&&p.us<=r.to);let km=0,gaps=0;
 for(let i=1;i<ps.length;i++){const dt=(ps[i].us-ps[i-1].us)/1e6,d=historyDistance(ps[i-1],ps[i]);if(dt>0&&dt<=300&&d/(dt/3600)<=inventory.settings.track_max_kmh)km+=d;else if(dt>300)gaps++;}
 return {...r,km:Math.round(km*100)/100,gaps};
})};
mkdirSync(out,{recursive:true});writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));writeFileSync(out+'/normalized.json',JSON.stringify(quality.points));
for(let i=0;i<quality.points.length;i+=1000)writeFileSync(out+'/archive-'+String(i/1000).padStart(2,'0')+'.sql',historyArchiveSQL(quality.points.slice(i,i+1000),matched));
writeFileSync(out+'/journal.sql',historyJournalSQL(ranges,matched,source));
console.log(JSON.stringify({...summary,quarantine:{count:quality.rejected.length,first:quality.rejected[0]?.ts,last:quality.rejected.at(-1)?.ts}},null,2));
