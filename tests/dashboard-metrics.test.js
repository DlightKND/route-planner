import {describe,it,expect} from 'vitest';
import {dashboardMetrics,trackMotion,roadPersonHours,statisticsPlanBlocks} from '../src/core/dashboard-metrics.js';
import {dashboardSummaryHTML} from '../src/dashboard-summary.js';
import {Window} from 'happy-dom';
const period={from:'2026-09-01',to:'2026-09-30'};
const snapshot={workH:10,km:200,driveH:4,days:1,nights:0,revenue:15000,rWork:10000,rTravel:3000,rPerDiem:500,rParts:1500,cLabor:6000,cKm:2000,cDay:500,cNight:0,cParts:800,cost_basis:'fact',presence_basis:'person_hours_v1',cost_plan:9300,cost_fact:9300,profit_plan:5700,profit_fact:5700};
const trip={id:'t',status:'done',date_from:'2026-09-10',engineer_ids:['e'],fact_km:200,econ_snapshot:snapshot,tariffs_snapshot:{costs:{hour:600,km:10,day:500,night:1000}}};
const item={id:'i',kind:'work',unit:'ч',planned_qty:10,done_qty:10,transferred_qty:0,billable:false};
const order={id:'o',status:'completed',work_mode:'onsite',date_from:'2026-09-10',engineer_ids:['e'],service_order_items:[item]};
const data={trips:[trip],orders:[order],links:[{trip_id:'t',order_id:'o'}],period,engineerIds:['e'],factHours:{t:10}};
const compute=extra=>dashboardMetrics({...data,...extra});
describe('department statistics',()=>{
 it('uses accepted norm-hours for distance and warranty, independently of presence',()=>{const m=compute({factHours:{t:20}});expect(m.normFact).toBe(10);expect(m.presenceFact).toBe(20);expect(m.distancePerNorm).toBe(20);expect(m.averageTripKm).toBe(200);expect(m.warrantyPct).toBe(100);});
 it('counts one task only once across multiple trips and removes transferred plan quantities',()=>{const m=compute({trips:[trip,{...trip,id:'t2'}],orders:[{...order,service_order_items:[{...item,planned_qty:14,transferred_qty:4}]}],links:[{trip_id:'t',order_id:'o'},{trip_id:'t2',order_id:'o'}],factHours:{t:10,t2:10}});expect(m.normPlan).toBe(10);expect(m.normFact).toBe(10);expect(m.distancePerNorm).toBe(40);});
 it('does not fabricate a distance coefficient when a task spans outside the period',()=>{const m=compute({links:[...data.links,{trip_id:'outside',order_id:'o'}]});expect(m.normFact).toBe(10);expect(m.distancePerNorm).toBeNull();});
 it('requires all linked tasks to be accepted for a complete distance cohort',()=>{const m=compute({orders:[order,{...order,id:'pending',status:'review'}],links:[...data.links,{trip_id:'t',order_id:'pending'}]});expect(m.distancePerNorm).toBeNull();expect(m.accepted).toBe(1);});
 it('does not equate unaccepted result entries with accepted work',()=>{const m=compute({orders:[{...order,status:'in_progress'}]});expect(m.normFact).toBeNull();expect(m.warrantyPct).toBeNull();expect(m.distancePerNorm).toBeNull();});
 it('excludes cancelled, deleted, out-of-period and other-team trips',()=>{const m=compute({trips:[trip,{...trip,id:'cancel',status:'cancelled'},{...trip,id:'deleted',deleted_at:'x'},{...trip,id:'other',engineer_ids:['other']},{...trip,id:'old',date_from:'2026-08-31'}]});expect(m.trips).toBe(1);expect(m.kmPlan).toBe(200);});
 it('keeps an unknown fact distinct from a confirmed zero and requires complete km coverage',()=>{expect(compute({trips:[{...trip,fact_km:0}]}).averageTripKm).toBe(0);const m=compute({trips:[trip,{...trip,id:'unknown',fact_km:null}]});expect(m.kmFact).toBeNull();expect(m.averageTripKm).toBeNull();expect(m.distancePerNorm).toBeNull();expect(m.kmKnown).toBe(1);});
 it('excludes materials, voided work and non-hour quantities',()=>{const m=compute({orders:[{...order,service_order_items:[item,{...item,id:'part',kind:'material'},{...item,id:'void',request_finance_void_event_id:'v'},{...item,id:'count',unit:'шт'}]}]});expect(m.normFact).toBe(10);});
 it('includes selected depot/remote work but never uses it in the field-distance denominator',()=>{const m=compute({orders:[order,{...order,id:'depot',work_mode:'depot'},{...order,id:'remote',work_mode:'remote'}]});expect(m.normFact).toBe(30);expect(m.distancePerNorm).toBe(20);});
 it('shows full finance components and explicit overrides without losing the total',()=>{const m=compute({trips:[{...trip,econ_snapshot:{...snapshot,revenue:16000,cost_fact:9500,profit_fact:6500}}]});expect(m.financeFact.work+m.financeFact.road+m.financeFact.parts+m.financeFact.revenueAdjustment).toBe(16000);expect(m.financeFact.labor+m.financeFact.travelCost+m.financeFact.partsCost+m.financeFact.costAdjustment).toBe(9500);expect(m.financeFact.profit).toBe(6500);expect(m.financePlan.labor).toBe(6000);});
 it('preserves unknown components of old snapshots while retaining known totals',()=>{const m=compute({trips:[{...trip,econ_snapshot:{...snapshot,rParts:undefined}}]});expect(m.financeFact.parts).toBeNull();expect(m.financeFact.revenue).toBe(15000);expect(m.financeFact.revenueAdjustment).toBeNull();});
 it('does not present unverified economy as finance fact',()=>{const m=compute({trips:[{...trip,econ_snapshot:{...snapshot,cost_basis:'partial'}}]});expect(m.financeKnown).toBe(0);expect(m.financeFact.profit).toBeNull();});
 it('calculates weighted GPS speed from precise measured time, not rounded minutes or reconstructed gaps',()=>{const segments=[{kind:'track',km:1,ms:60000,minutes:0},{kind:'track',km:2,fromTs:'2026-09-10T00:00:00Z',toTs:'2026-09-10T00:04:00Z'},{kind:'road',km:100,ms:60000},{kind:'line',km:50,ms:60000},{kind:'track',km:100,ms:1}];expect(trackMotion(segments).speed).toBeCloseTo(36);const m=compute({tracks:[{trip_id:'t',segments}]});expect(m.speed).toBeCloseTo(36);expect(m.motionTrips).toBe(1);expect(compute().speed).toBeNull();});
 it('renders a stable reading order, exact units and safe unknowns',()=>{const w=new Window();w.document.body.innerHTML=dashboardSummaryHTML(compute(),{planPercent:40,factPercent:null,body:'',chart:'',fund:100,totalPlan:50,totalPlanPercent:50},{currency:'<script>'});expect([...w.document.querySelectorAll('section')].map(e=>e.dataset.dcard)).toEqual(['work','fin','load']);expect(w.document.querySelector('script')).toBeNull();expect(w.document.body.textContent).toContain('нормо-ч');expect(w.document.body.textContent).toContain('км/нормо-ч');expect(w.document.body.textContent).toContain('«—»');expect(w.document.querySelectorAll('.summary-controls')).toHaveLength(0);});
});
describe('driving in actual department load',()=>{
 const presence=[{trip_id:'t',job_id:'j',status:'approved',crew_ids:['e','second'],crew_source:'snapshot',minutes_mgr:60,stay_from:'2026-09-10T10:00:00Z',stay_to:'2026-09-10T11:00:00Z'}];
 const tracks=[{trip_id:'t',segments:[{kind:'track',km:200,fromTs:'2026-09-10T06:00:00Z',toTs:'2026-09-10T10:00:00Z'}]}];
 const input={trips:[trip],tracks,presence,period,engineerIds:['e']};
 it('adds travel per real reviewed participant and selected engineer',()=>{expect(roadPersonHours(input)).toMatchObject({hours:4,known:1,unknown:0,complete:true});expect(roadPersonHours({...input,engineerIds:['e','second']}).hours).toBe(8);});
 it('does not use the editable trip crew in place of the frozen actual crew',()=>{expect(roadPersonHours({...input,trips:[{...trip,engineer_ids:['other']}]}).hours).toBe(4);});
 it('refuses incomplete GPS, reconstructed travel or ambiguous crew rather than showing a low actual percentage',()=>{
   expect(roadPersonHours({...input,tracks:[]})).toMatchObject({complete:false,unknown:1});
   expect(roadPersonHours({...input,tracks:[{...tracks[0],segments:[{...tracks[0].segments[0],kind:'road'}]}]}).complete).toBe(false);
   expect(roadPersonHours({...input,presence:[...presence,{...presence[0],crew_ids:['e']}]}).complete).toBe(false);
   expect(roadPersonHours({...input,trips:[{...trip,fact_km:300}]}).complete).toBe(false);
 });
 it('refuses intervals that overlap approved attendance or one another',()=>{
   expect(roadPersonHours({...input,tracks:[{...tracks[0],segments:[{...tracks[0].segments[0],toTs:'2026-09-10T10:30:00Z'}]}]}).complete).toBe(false);
   expect(roadPersonHours({...input,tracks:[{...tracks[0],segments:[{...tracks[0].segments[0],km:100},{...tracks[0].segments[0],km:100}]}]}).complete).toBe(false);
 });
 it('splits travel at Kyiv midnight and respects the selected period',()=>{
   const t={...trip,fact_km:100,date_from:'2026-09-30'};
   const track={trip_id:'t',segments:[{kind:'track',km:100,fromTs:'2026-09-30T20:00:00Z',toTs:'2026-09-30T22:00:00Z'}]};
   expect(roadPersonHours({...input,trips:[t],tracks:[track]}).hours).toBeCloseTo(1);
 });
 it('recognizes an explicit zero kilometre completed trip without inventing motion',()=>{expect(roadPersonHours({...input,trips:[{...trip,fact_km:0}],tracks:[]})).toMatchObject({known:1,unknown:0,hours:0});});
});
describe('saved monthly plan',()=>{
 it('retains finished trips, divides norm work and counts travel for each planned participant',()=>{const p=statisticsPlanBlocks([{...trip,engineer_ids:['e','second']}],[],period);expect(p.unknown).toBe(0);expect(p.blocks).toHaveLength(2);expect(p.blocks.reduce((n,b)=>n+b.workH,0)).toBe(10);expect(p.blocks.reduce((n,b)=>n+b.driveToH+b.driveBackH,0)).toBe(8);});
 it('keeps the snapshot plan independent of later edits to the request and excludes cancelled trips',()=>{const p=statisticsPlanBlocks([trip,{...trip,id:'cancel',status:'cancelled'}],[{...order,service_order_items:[{...item,planned_qty:100}]}],period);expect(p.blocks[0].workH).toBe(10);});
 it('counts transferred non-field quantities only once and does not fabricate missing snapshot hours',()=>{const p=statisticsPlanBlocks([{...trip,econ_snapshot:{km:200}}],[{...order,work_mode:'depot',service_order_items:[{...item,planned_qty:14,transferred_qty:4}]}],period);expect(p.unknown).toBe(1);expect(p.blocks).toHaveLength(1);expect(p.blocks[0].workH).toBe(10);});
});
