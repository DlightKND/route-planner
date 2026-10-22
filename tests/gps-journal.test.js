import {it,expect} from 'vitest';
import {journalEntries,routeAmounts,presenceRoadConflicts,activityTimeline} from '../src/core/gps-journal.js';
it('combines trip and orphan records without duplicating a linked source or losing unlinked sources',()=>{
 const rows=journalEntries([{id:'orphan',state:'review',started_at:'2026-10-01'},{id:'source',state:'linked',trip_id:'trip',started_at:'2026-10-02'}],[{id:'trip',started_at:'2026-10-02'}]);expect(rows.map(r=>r.id)).toEqual(['trip:trip','orphan']);
});
it('excludes straight-line and unknown gap estimates from measured and restored mileage',()=>{
 expect(routeAmounts({segments:[{kind:'track',km:74.2},{kind:'road',km:13.2},{kind:'line',km:4.1}]})).toMatchObject({gps:74.2,restored:13.2,total:87.4});expect(routeAmounts(null).total).toBeNull();
});
it('checks the accepted recovery portion rather than the complete hypothetical stop',()=>{
 const stay={status:'approved',presence_evidence:{gps_intervals:[{from:'2026-10-21T08:00Z',to:'2026-10-21T11:00Z'}],recovery_parts:[{key:'r',side:'after',from:'2026-10-21T11:00Z',to:'2026-10-21T12:00Z'}]},recovery_acceptance:{r:30}};
 const track={presence:{motion_intervals:[{from:'2026-10-21T11:30Z',to:'2026-10-21T12:00Z'}]}};
 expect(presenceRoadConflicts(stay,track)).toHaveLength(0);expect(presenceRoadConflicts({...stay,recovery_acceptance:{r:60}},track)).toHaveLength(1);expect(presenceRoadConflicts({...stay,status:'rejected'},track)).toHaveLength(0);
});
it('keeps unknown time and source confidence distinct from stop or driving activity',()=>{
 const rows=activityTimeline({started_at:'2026-10-21T08:00Z',finished_at:'2026-10-21T12:00Z'},{presence:{motion_intervals:[{from:'2026-10-21T08:00Z',to:'2026-10-21T09:00Z',source:'ors'}]}},[{id:'s',stay_from:'2026-10-21T10:00Z',stay_to:'2026-10-21T12:00Z'}]);
 expect(rows.map(r=>[r.kind,r.width,r.recovery])).toEqual([['drive',25,true],['unknown',25,false],['stop',50,false]]);
});
it('hatches only the exact reconstructed interval and retains adjacent GPS evidence',()=>{
 const stays=[{id:'s',stay_from:'2026-10-21T08:00Z',stay_to:'2026-10-21T12:00Z',presence_evidence:{gps_intervals:[{from:'2026-10-21T08:00Z',to:'2026-10-21T11:00Z'}],recovery_parts:[{from:'2026-10-21T11:00Z',to:'2026-10-21T12:00Z'}]}}];
 const rows=activityTimeline({started_at:stays[0].stay_from,finished_at:stays[0].stay_to},null,stays);expect(rows.map(p=>[p.width,p.recovery])).toEqual([[75,false],[25,true]]);
});
it('deduplicates linked sources before a trip page is loaded and retains their history',()=>{
 const sources=Array.from({length:60},(_,i)=>({id:'source-'+i,state:'linked',trip_id:'t',started_at:'2026-10-21'}));expect(journalEntries(sources,[])).toHaveLength(1);expect(journalEntries(sources,[{id:'t',started_at:'2026-10-21'}])[0]._sources).toHaveLength(60);
});
it('retains the complete source evidence while a saved acceptance has a shorter interval',async()=>{const {evidenceExtent}=await import('../src/core/gps-journal.js'),{validatePresence}=await import('../src/core/trip-review.js');const stay={status:'approved',job_id:'j',crew_ids:['e'],stay_from:'2026-10-21T08:00Z',stay_to:'2026-10-21T11:30Z',minutes_mgr:240,presence_evidence:{gps_intervals:[{from:'2026-10-21T08:00Z',to:'2026-10-21T11:00Z'}],recovery_parts:[{key:'r',from:'2026-10-21T11:00Z',to:'2026-10-21T12:00Z',minutes:60,side:'after'}]},recovery_acceptance:{r:60}};expect(evidenceExtent(stay).to).toBe('2026-10-21T12:00:00.000Z');expect(validatePresence([stay])).toBe(true);expect(()=>validatePresence([{...stay,recovery_acceptance:{r:61},minutes_mgr:241}])).toThrow('GPS');});

it('finishes the attention queue after the last stop without treating restored evidence as unfinished work',async()=>{const {tripAttention,tripReviewIssues}=await import('../src/core/gps-journal.js');const trip={review:{total:5,done:5,recovery:true,gaps:0,conflicts:0,missingTrack:false}};expect(tripAttention(trip)).toBe(false);expect(tripReviewIssues(trip)).toEqual([]);expect(tripReviewIssues({review:{...trip.review,done:4}})).toEqual([{kind:'stops',count:1,label:'Остановки на проверке: 1'}]);for(const extra of [{gaps:true},{conflicts:2},{missingTrack:true}]){const issues=tripReviewIssues({review:{...trip.review,...extra}});expect(issues).toHaveLength(1);expect(issues[0].kind).toBe('route');expect(issues[0].label.length).toBeGreaterThan(10);}});
it('gives repeated visits of one client distinct place labels without inventing addresses',async()=>{const {stopPlace}=await import('../src/core/gps-journal.js');const jobs=[{id:'j',clients:{name:'Длинное одинаковое название клиента'}}],stays=[0,1,2].map(i=>({job_id:'j',status:'approved',lat:50+i*.1,lng:30}));expect(stays.map((s,i)=>stopPlace(s,jobs,i).title)).toEqual(['Остановка 1','Остановка 2','Остановка 3']);expect(stopPlace(stays[0],jobs).location).toBe('50.0000, 30.0000');expect(stopPlace(stays[0],jobs).fullTitle).toContain('Длинное');expect(stopPlace({display_name:'Склад',address:'Киев, ул. Полевая, 10'},[],0)).toMatchObject({title:'Склад',location:'Киев, ул. Полевая, 10'});expect(stopPlace({},[],2)).toMatchObject({title:'Остановка 3',location:'Адрес не указан'});});
