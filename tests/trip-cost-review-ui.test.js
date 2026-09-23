import {it,expect} from 'vitest';
import {tripCostReviewHTML} from '../src/trip-workbench.js';

it('shows task shares, unallocated balances, freshness and approval reason',()=>{
  const html=tripCostReviewHTML({
    trip:{orders:[{id:'o1',number:15,title:'Диагностика'}]},
    canApprove:true,
    stale:true,
    run:{approved_at:'2026-09-23T12:00:00Z',approval_reason:'Сверено диспетчером'},
    preview:{components:{
      distance:{total:300,assigned:200,unallocated:100},
      labor:{total:80,assigned:60,unallocated:20},
      fixed:{total:25,assigned:0,unallocated:25},
      manual_adjustment:{total:5,assigned:0,unallocated:5}
    },rows:[{cost_type:'distance',service_order_id:'o1',amount:200,quantity:20},{cost_type:'labor',service_order_id:'o1',amount:60,quantity:3}],diagnostics:{fact_km:30,reliable_track_km:20,gps_variance_km:10,unknown_segments:1}}
  });
  expect(html).toContain('распределение устарело');
  expect(html).toContain('Диагностика');
  expect(html).toContain('Не распределено: 100');
  expect(html).toContain('tripAllocationReason');
  expect(html).toContain('Подтвердить распределение');
});

