import {describe,it,expect} from 'vitest';
import {calculateTripCostAllocation} from '../src/core/trip-cost-allocation.js';

const trip={id:'t1',status:'done',fact_km:60,workbench_revision:8,tariffs_snapshot:{costs:{km:10,hour:20}},
  econ_snapshot:{cost_basis:'fact',presence_basis:'person_hours_v1',cKm:600,cLabor:40,cDay:20,cNight:0,costComputed:660,cost:680},
  overrides:{cost:680,cost_reason:'Проверено по первичным документам'}};
const stays=[{id:'s1',status:'approved',crew_source:'manager',job_id:'j1',service_order_id:null,stay_from:'2026-09-20T09:00:00Z',stay_to:'2026-09-20T10:00:00Z',
  minutes_mgr:60,crew_ids:['e1','e2'],task_allocations:[{order_id:'o1',share:.75},{order_id:'o2',share:.25}]}];
const track={at:'2026-09-20T12:00:00Z',segments:[
  {kind:'road',km:20,fromTs:'2026-09-20T08:00:00Z',toTs:'2026-09-20T09:00:00Z'},
  {kind:'road',km:10,fromTs:'2026-09-20T10:00:00Z',toTs:'2026-09-20T11:00:00Z'},
  {kind:'line',km:20,fromTs:'2026-09-20T11:00:00Z',toTs:'2026-09-20T12:00:00Z',why:'маршрут не строился'}
]};

describe('trip cost allocation',()=>{
  it('splits confirmed route sections and person-hours by explicit task shares',()=>{
    const result=calculateTripCostAllocation({trip,track,stays,taskOrderIds:['o1','o2']});
    expect(result.components).toEqual({
      distance:{total:600,assigned:300,unallocated:300},
      labor:{total:40,assigned:40,unallocated:0},
      fixed:{total:20,assigned:0,unallocated:20},
      manual_adjustment:{total:20,assigned:0,unallocated:20}
    });
    expect(result.rows.filter(x=>x.cost_type==='distance'&&x.service_order_id==='o1').reduce((n,x)=>n+x.amount,0)).toBe(225);
    expect(result.rows.filter(x=>x.cost_type==='distance'&&x.service_order_id==='o2').reduce((n,x)=>n+x.amount,0)).toBe(75);
    expect(result.rows.filter(x=>x.cost_type==='labor'&&x.service_order_id==='o1')[0].amount).toBe(30);
    expect(result.diagnostics).toMatchObject({fact_km:60,reliable_track_km:30,gps_variance_km:30,unknown_segments:1});
    expect(result.confirmed_total).toBe(680);
  });

  it('keeps unmatched tasks, weak geometry, and odometer difference unallocated',()=>{
    const result=calculateTripCostAllocation({trip,track:{segments:[
      {kind:'track',km:10,fromTs:'2026-09-20T07:00:00Z',toTs:'2026-09-20T08:00:00Z'},
      {kind:'line',km:10,fromTs:'2026-09-20T08:00:00Z',toTs:'2026-09-20T09:00:00Z'}
    ]},stays:[{...stays[0],task_allocations:[]}],taskOrderIds:['o1','o2']});
    expect(result.components.distance.assigned).toBe(0);
    expect(result.components.distance.unallocated).toBe(600);
    expect(result.rows.filter(x=>x.cost_type==='distance_unallocated').length).toBeGreaterThan(1);
    expect(result.components.labor.assigned).toBe(0);
    expect(result.components.labor.unallocated).toBe(40);
  });

  it('caps overlong GPS mileage at verified odometer total and reports variance',()=>{
    const result=calculateTripCostAllocation({trip:{...trip,fact_km:25,econ_snapshot:{...trip.econ_snapshot,cKm:250,costComputed:310,cost:310}},
      track,stays,taskOrderIds:['o1','o2']});
    expect(result.components.distance).toEqual({total:250,assigned:250,unallocated:0});
    expect(result.diagnostics.gps_variance_km).toBe(-5);
  });

  it('rejects a stay share linked to a task outside the trip',()=>{
    expect(()=>calculateTripCostAllocation({trip,track,stays,taskOrderIds:['o1']})).toThrow('вне этого выезда');
  });

  it('preserves an explicit fully unallocated choice over the legacy singular link',()=>{
    const result=calculateTripCostAllocation({trip,track,stays:[{...stays[0],service_order_id:'o1',task_allocations:[]}],taskOrderIds:['o1']});
    expect(result.components.distance.assigned).toBe(0);
    expect(result.components.labor.assigned).toBe(0);
  });

  it('does not turn a planned estimate into confirmed task cost',()=>{
    expect(()=>calculateTripCostAllocation({trip:{...trip,econ_snapshot:{...trip.econ_snapshot,cost_basis:'plan'}},track,stays,taskOrderIds:['o1','o2']})).toThrow('подтверждённого факта');
  });
});
