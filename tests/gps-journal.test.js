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

it('finishes the attention queue after the last stop without treating restored evidence as unfinished work',async()=>{const {tripAttention,tripReviewIssues}=await import('../src/core/gps-journal.js');const trip={review:{total:5,done:5,recovery:true,gaps:0,conflicts:0,missingTrack:false}};expect(tripAttention(trip)).toBe(false);expect(tripReviewIssues(trip)).toEqual([]);expect(tripReviewIssues({review:{...trip.review,done:0}})).toEqual([]);for(const extra of [{gaps:true},{conflicts:2},{missingTrack:true}]){const issues=tripReviewIssues({review:{...trip.review,...extra}});expect(issues).toHaveLength(1);expect(issues[0].kind).toBe('route');expect(issues[0].label.length).toBeGreaterThan(10);}});
it('uses available client names with separate visit numbers and honest address fallbacks',async()=>{const {stopPlace}=await import('../src/core/gps-journal.js');const jobs=[{id:'j',clients:{name:'Длинное одинаковое название клиента'}}],stays=[0,1,2].map(i=>({job_id:'j',status:'approved',lat:50+i*.1,lng:30}));expect(stays.map((s,i)=>stopPlace(s,jobs,i).title)).toEqual(Array(3).fill('Длинное одинаковое название клиента'));expect(stopPlace(stays[0],jobs).location).toBe('50.0000, 30.0000');expect(stopPlace(stays[0],jobs).fullTitle).toContain('Длинное');expect(stopPlace({display_name:'Склад',address:'Киев, ул. Полевая, 10'},[],0)).toMatchObject({title:'Склад',location:'Киев, ул. Полевая, 10'});expect(stopPlace({},[],2)).toMatchObject({title:'Остановка 3',location:'Адрес не указан'});});

it('retains interval precedence and conflicts while sweeping overlapping, clipped and invalid evidence',()=>{
 const start=Date.parse('2026-10-21T08:00Z'),iso=m=>new Date(start+m*60000).toISOString(),trip={started_at:iso(0),finished_at:iso(240)};
 let seed=42;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let run=0;run<30;run++){
  const intervals=Array.from({length:45},()=>{const a=Math.floor(random()*300)-30;return {from:iso(a),to:iso(a+Math.floor(random()*80)-5),source:random()>.5?'ors':'gps'};});
  const stays=Array.from({length:8},(_,i)=>{const a=Math.floor(random()*260)-10;return {id:'s'+i,stay_from:iso(a),stay_to:iso(a+30),...(i%2?{presence_evidence:{gps_intervals:[{from:iso(a),to:iso(a+20)}],recovery_parts:[{from:iso(a+20),to:iso(a+30)}]}}:{})};});
  const source=[...intervals.map(m=>({...m,kind:'drive',recovery:m.source==='ors'})),...stays.flatMap(s=>{const base={kind:'stop',id:s.id};return s.presence_evidence?[...s.presence_evidence.gps_intervals.map(p=>({...base,...p,recovery:false})),...s.presence_evidence.recovery_parts.map(p=>({...base,...p,recovery:true}))]:[{...base,from:s.stay_from,to:s.stay_to,recovery:false}];})];
  const from=start,to=start+240*60000,cuts=[...new Set([from,to,...source.flatMap(s=>[Date.parse(s.from),Date.parse(s.to)]).filter(t=>t>from&&t<to)])].sort((a,b)=>a-b);
  const expected=cuts.slice(1).map((b,i)=>{const a=cuts[i],items=source.filter(s=>Date.parse(s.from)<=a&&Date.parse(s.to)>=b),stop=items.find(s=>s.kind==='stop'),part=stop||items[0];return {from:a,to:b,left:(a-from)/(to-from)*100,width:(b-a)/(to-from)*100,kind:part?.kind||'unknown',recovery:!!part?.recovery,stopId:stop?.id,conflict:!!stop&&items.some(s=>s.kind==='drive')};});
  expect(activityTimeline(trip,{presence:{motion_intervals:intervals}},stays)).toEqual(expected);
 }
});
it('parses a large track linearly rather than reparsing every interval at every boundary',async()=>{
 const {vi}=await import('vitest'),start=Date.parse('2026-10-13T04:00Z'),iso=m=>new Date(start+m*60000).toISOString(),intervals=Array.from({length:5000},(_,i)=>({from:iso(i*2),to:iso(i*2+1),source:'gps'}));const parse=vi.spyOn(Date,'parse');try{expect(activityTimeline({started_at:iso(0),finished_at:iso(10000)},{presence:{motion_intervals:intervals}},[])).toHaveLength(10000);expect(parse.mock.calls.length).toBeLessThan(5000*5);}finally{parse.mockRestore();}
});
it('coalesces visually identical GPS intervals without merging across gaps, stops or confidence changes',async()=>{
 const {timelineHTML}=await import('../src/journal-route.js');const trip={started_at:'2026-10-21T08:00Z',finished_at:'2026-10-21T12:00Z'},motion_intervals=[{from:'2026-10-21T08:00Z',to:'2026-10-21T09:00Z',source:'gps'},{from:'2026-10-21T09:00Z',to:'2026-10-21T10:00Z',source:'gps'},{from:'2026-10-21T11:00Z',to:'2026-10-21T12:00Z',source:'ors'}];const html=timelineHTML(trip,{presence:{motion_intervals}},[]);expect((html.match(/class="journal-time-part /g)||[])).toHaveLength(3);expect(html).toContain('drive recovery');expect(html).toContain('unknown');
});
