import {it,expect,vi} from 'vitest';
import {rebuildTripTrack,presenceBounds,acceptedPresenceIntervals,intervalMinutes} from '../src/core/trip-presence-recovery.js';
const base={lat:49.07,lng:33.42};
const p=(km,min)=>({...base,lng:base.lng+km/(111.32*Math.cos(base.lat*Math.PI/180)),ts:new Date(Date.UTC(2026,9,12,6,min)).toISOString()});
const run=(km,from,to)=>Array.from({length:to-from+1},(_,i)=>p(km,from+i));
const stop=km=>({...p(km,0),job_id:'job-'+km,name:'Объект '+km});
const reach=sec=>vi.fn(async(a,b,dt)=>({sec:typeof sec==='function'?sec(a,b):sec,ok:true,km:Math.abs((a.lng-b.lng))*111,line:[[a.lng,a.lat],[b.lng,b.lat]]}));
const context=(stops,points)=>({stops,started_at:points[0].ts,finished_at:points.at(-1).ts});
it('restores missing arrival using the same ORS response and locks three observed hours',async()=>{
 const points=[p(0,-1),p(1,0),...run(100,360,540)],road=reach(3*3600);
 const m=await rebuildTripTrack(points,{},context([stop(100)],points),road);
 expect(road).toHaveBeenCalledTimes(1);expect(m.presence.stays).toHaveLength(1);
 const s=m.presence.stays[0];expect(s.gps_minutes).toBe(180);expect(s.recovered_minutes).toBe(180);expect(s.presence_evidence.recovery_parts[0].side).toBe('before');
 expect(presenceBounds(s)).toEqual({gps:180,extra:180,min:180,max:360});
 const key=s.presence_evidence.recovery_parts[0].key;
 expect(intervalMinutes(acceptedPresenceIntervals(s,{[key]:0}))).toBe(180);
 expect(intervalMinutes(acceptedPresenceIntervals(s,{[key]:60}))).toBe(240);
 expect(m.presence.total_minutes).toBe(541);expect(m.presence.drive_minutes).toBe(181);
});
it('restores missing departure after observed GPS without editing those observations',async()=>{
 const points=[...run(100,0,180),p(1,540),p(0,541)],m=await rebuildTripTrack(points,{},context([stop(100)],points),reach(3*3600));
 const s=m.presence.stays[0];expect(s.gps_minutes).toBe(180);expect(s.recovered_minutes).toBe(180);
 const part=s.presence_evidence.recovery_parts[0];expect(part.side).toBe('after');expect(part.from).toBe(p(100,180).ts);expect(part.to).toBe(p(100,360).ts);
 expect(intervalMinutes(acceptedPresenceIntervals(s,{[part.key]:30}))).toBe(210);
});
it('reconstructs a complete island through the object even when A and B have identical coordinates',async()=>{
 const points=[p(0,-1),p(1,0),p(1,360),p(2,361)],m=await rebuildTripTrack(points,{},context([stop(100)],points),reach(3600));
 expect(m.presence.stays[0]).toMatchObject({gps_minutes:0,recovered_minutes:240});
 expect(m.segments.filter(s=>s.why==='достроено при потере навигации')).toHaveLength(2);expect(m.presence.drive_minutes).toBe(122);
 expect(m.roadKm).toBeGreaterThan(0);expect(m.km).toBeCloseTo(m.segments.reduce((n,s)=>n+s.km,0));
});
it('keeps a three-hour hole between observed blocks editable rather than locking it as GPS',async()=>{
 const points=[...run(100,0,90),...run(100,270,360)],m=await rebuildTripTrack(points,{},context([stop(100)],points),reach(0));
 const s=m.presence.stays[0];expect(s.gps_minutes).toBe(180);expect(s.recovered_minutes).toBe(180);expect(s.presence_evidence.gps_intervals).toHaveLength(2);
 expect(intervalMinutes(acceptedPresenceIntervals(s,{}))).toBe(180);expect(m.presence.drive_minutes).toBe(0);
});
it('does not treat a small ETA excess as proof of bad GPS or create negative presence',async()=>{
 const points=[p(0,-1),p(1,0),p(20,6),...run(20,7,18)],m=await rebuildTripTrack(points,{},context([stop(20)],points),reach(7*60));
 expect(m.dropped).toHaveLength(0);expect(m.presence.stays[0].recovered_minutes).toBe(0);expect(m.presence.skipped[0].reason).toContain('весь промежуток');
});
it('does not recover without corroborating samples, routes or a unique object',async()=>{
 const points=[p(0,-1),p(1,0),p(1,360),p(2,361)];
 const ambiguous=await rebuildTripTrack(points,{},context([stop(100),stop(200)],points),reach(3600));
 expect(ambiguous.presence.stays).toEqual([]);expect(ambiguous.presence.skipped[0].reason).toContain('Несколько');
 const isolated=await rebuildTripTrack(points.slice(1,3),{},context([stop(100)],points),reach(3600));expect(isolated.presence.stays).toEqual([]);
 const unavailable=await rebuildTripTrack(points,{},context([stop(100)],points),null);expect(unavailable.presence.stays).toEqual([]);
});
it('bounds ORS calls and leaves exhausted or unavailable calculations unresolved',async()=>{
 const points=[p(0,-1),p(1,0),p(1,360),p(2,361)],road=reach(3600);
 const m=await rebuildTripTrack(points,{maxOrsCalls:1},context([stop(100)],points),road);
 expect(road).toHaveBeenCalledTimes(1);expect(m.presence.stays).toEqual([]);
});
it('is deterministic on repeated rebuilding and does not add inferred points to trusted GPS',async()=>{
 const points=[p(0,-1),p(1,0),...run(100,360,540)];const a=await rebuildTripTrack(points,{},context([stop(100)],points),reach(10800)),b=await rebuildTripTrack(points,{},context([stop(100)],points),reach(10800));
 expect(a.presence).toEqual(b.presence);expect(a.points).toHaveLength(points.length);
});
