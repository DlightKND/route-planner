Warning: truncated output (original token count: 545)
Total output lines: 47

import {expect,it} from 'vitest';
import {diffJobWorks,hasStableJobWorkIds} from '../src/core/job-work-diff.js';

const base={id:'work-1',work_id:'catalog-1',title:'Диагностика',hours:4,
  billable:true,billable_reason:'',revenue:3000,revenue_override:null,
  tariff_profile:'client',approved_at:'2026-09-01T10:00:00Z',approved_by:'manager-1',
  created_at:'2026-08-31T10:00:00Z'};

it('allows work reconciliation only when the cached list has stable IDs',()=>{
  expect(hasStableJobWorkIds([base])).toBe(true);
  expect(hasStableJobWorkIds([{hours:4,billable:true}])).toBe(false);
  expect(hasStableJobWorkIds([])).toBe(true);
  expect(hasStableJobWorkIds(null)).toBe(false);
});

it('keeps an unchanged approved work row untouched, including its historical price and ID',()=>{
  const {upserts,deleteIds}=diffJobWorks([base],[{...base,hours:'4'}]);
  expect(upserts).toEqual([]);
  expect(deleteIds).toEqual([]);
});

it('updates a changed row in place and clears approval for manager re…45 tokens truncated…0]).toMatchObject({id:'work-1',hours:5,approved_at:null,approved_by:null});
});

it('stamps a manager edit as the new approval when the editor is a manager',()=>{
  const {upserts}=diffJobWorks([base],[{...base,hours:5,revenue:3750}],
    {approvedAt:'2026-09-23T12:00:00Z',approvedBy:'manager-2'});
  expect(upserts[0]).toMatchObject({approved_at:'2026-09-23T12:00:00Z',approved_by:'manager-2'});
});

it('inserts new rows without client supplied provenance and deletes only removed IDs',()=>{
  const {upserts,deleteIds}=diffJobWorks([base],[{...base,id:undefined,created_at:undefined}]);
  expect(upserts).toHaveLength(1);
  expect(upserts[0]).not.toHaveProperty('id');
  expect(upserts[0]).not.toHaveProperty('approved_at');
  expect(deleteIds).toEqual(['work-1']);
});

it('does not resurrect a stale row ID that is no longer present in the database',()=>{
  const {upserts,deleteIds}=diffJobWorks([], [base]);
  expect(upserts[0]).not.toHaveProperty('id');
  expect(deleteIds).toEqual([]);
});
