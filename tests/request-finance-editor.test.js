import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {canEditRequestFinanceRow} from '../src/core/request-finance-row.js';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const approval=source.slice(source.indexOf('async function worksApprove(){'),source.indexOf('async function voidRequestFinanceRow('));

it('does not misidentify an incomplete new work as historical when confirmation is pressed',async()=>{
  const notify=vi.fn(),save=vi.fn(),rpc=vi.fn();
  const run=new Function('notify','saveJobNow','sb',`const canWriteJob=()=>true,jobEditId='request';
    const jobProblem=()=>'',jobDraftIssue=()=> 'Укажи часы у работы «Ремонт»',revealRequestProblem=()=>{};
    ${approval};return worksApprove();`);
  await run(notify,save,{rpc});
  expect(notify).toHaveBeenCalledWith('Сначала заполни работы: Укажи часы у работы «Ремонт»','warn');
  expect(save).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
it('saves a new work before confirming it, retaining the approval returned by the canonical writer',async()=>{
  const notify=vi.fn(),rpc=vi.fn(),work={name:'Ремонт',hours:2,approved:false};
  const save=vi.fn(async()=>Object.assign(work,{canonical_task_item_id:'saved-work',approved:true}));
  const run=new Function('notify','saveJobNow','sb','work',`const canWriteJob=()=>true,jobEditId='request',curWorks=[work],jobEditorDirty=false;
    const jobProblem=()=>'',jobDraftIssue=()=>'',renderJobWorks=()=>{},$=()=>({classList:{contains:()=>false}});
    ${approval};return worksApprove();`);
  await run(notify,save,{rpc},work);
  expect(save).toHaveBeenCalledOnce();expect(rpc).not.toHaveBeenCalled();
  expect(work.canonical_task_item_id).toBe('saved-work');expect(notify).toHaveBeenCalledWith('Работы уже подтверждены.');
});
it('locks material fields as well as adding when a task is already executing',()=>{
  const edit=source.slice(source.indexOf('function canEditPart(p){'),source.indexOf('function personName(',source.indexOf('function canEditPart(p){')));
  const row={id:'part',name:'Фильтр'};
  const run=new Function('canEditRequestFinanceRow','canEditParts',`const canWriteJob=()=>true,jobRO=false;${edit};return canEditPart;`);
  expect(run(canEditRequestFinanceRow,()=>false)(row)).toBe(false);
  expect(run(canEditRequestFinanceRow,()=>true)(row)).toBe(true);
  expect(run(canEditRequestFinanceRow,()=>true)({...row,legacy_task_item_id:'legacy'})).toBe(false);
});
