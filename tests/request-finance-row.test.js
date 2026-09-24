import {it,expect} from 'vitest';
import {canEditRequestFinanceRow,isImportedRequestFinanceRow} from '../src/core/request-finance-row.js';

it('keeps task-imported request finance rows read-only until audited correction exists',()=>{
  const imported={id:'legacy-row',legacy_task_item_id:'task-row'};
  expect(isImportedRequestFinanceRow(imported)).toBe(true);
  expect(canEditRequestFinanceRow(imported,true)).toBe(false);
  expect(canEditRequestFinanceRow({id:'new-row'},true)).toBe(true);
  expect(canEditRequestFinanceRow({id:'new-row'},false)).toBe(false);
});
