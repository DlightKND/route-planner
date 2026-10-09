import {describe, it, expect} from 'vitest';
import {pendingJobState,queuedJobDraftIssue} from '../src/core/offline-job.js';

describe('request after an offline reload', () => {
  const jobId='job-1';
  it('restores a queued work and material even when the server still has neither', () => {
    const pending=[{id:3,kind:'job',payload:{jobId,rec:{status:'open'},
      works_complete:true,works:[{id:'work-1',title:'Ремонт',hours:1}],
      parts_complete:true,parts:[{id:'part-1',name:'Фильтр',qty:1,local_only:true}]}}];
    const state=pendingJobState(pending,jobId,[]);
    expect(state.payload.works.map(w=>w.title)).toEqual(['Ремонт']);
    expect(state.parts.map(p=>p.name)).toEqual(['Фильтр']);
    expect(state.hasPendingParts).toBe(true);
  });

  it('restores an older material event when the full request cache is absent', () => {
    const state=pendingJobState([{id:4,kind:'part',payload:{jobId,op:'add',localId:'local-1',
      row:{job_id:jobId,name:'Уплотнение',qty:2}}}],jobId,[]);
    expect(state.parts).toEqual([{job_id:jobId,name:'Уплотнение',qty:2,id:'local-1',local_only:true}]);
  });

  it('uses the newest complete snapshot and applies later material edits', () => {
    const pending=[
      {id:1,kind:'part',payload:{jobId,op:'add',localId:'old',row:{name:'old'}}},
      {id:2,kind:'job',payload:{jobId,parts_complete:true,parts:[{id:'part-1',name:'new'}]}},
      {id:3,kind:'part',payload:{jobId,op:'edit',localId:'part-1',row:{name:'corrected'}}},
    ];
    expect(pendingJobState(pending,jobId,[{id:'server',name:'server'}]).parts)
      .toEqual([{id:'part-1',name:'corrected',local_only:false}]);
  });

  it('keeps a zero-hour draft local until the hours are corrected', () => {
    const original={works_complete:true,works:[{id:'work-1',title:'Ремонт',hours:0}]};
    expect(queuedJobDraftIssue(original)).toContain('Укажи часы');
    expect(queuedJobDraftIssue({...original,works:[{...original.works[0],hours:0.25}]})).toBe('');
  });

  it('restores a canonical draft alongside protected history and preserves its provenance',()=>{
    const historicalPart={id:'old-part',canonical_task_item_id:'protected-part',legacy_task_item_id:'protected-part',name:'Старая деталь',price:50};
    const historicalWork={id:'old-work',canonical_task_item_id:'protected-work',legacy_task_item_id:'protected-work',title:'Старая работа',hours:2};
    const queued={jobId,canonical_generation:1,works_complete:true,works:[{id:'new-work',title:'Новая работа',hours:1}],parts_complete:true,parts:[{id:'new-part',name:'Новая деталь',qty:1,unit:'шт'}]};
    const state=pendingJobState([{id:1,kind:'job',payload:queued}],jobId,[historicalPart],[historicalWork]);
    expect(state.parts).toEqual([historicalPart,{...queued.parts[0],local_only:false}]);
    expect(state.works).toEqual([historicalWork,queued.works[0]]);
    expect(queued.parts).toHaveLength(1);
    const alias={...queued,parts:[{id:'protected-part',name:'Старая деталь',qty:1,unit:'шт'}]};
    expect(pendingJobState([{id:1,kind:'job',payload:alias}],jobId,[historicalPart]).parts).toEqual([historicalPart]);
  });

  it.each([
    [{name:'',qty:1,unit:'шт'},'название'],
    [{name:'Фильтр',qty:0,unit:'шт'},'количество'],
    [{name:'Фильтр',qty:-1,unit:'шт'},'количество'],
    [{name:'Фильтр',qty:1,unit:''},'единицу'],
  ])('keeps an incomplete material draft rather than deleting its stored row (%j)',(part,message)=>{
    const payload={parts_complete:true,parts:[{id:'existing-part',...part}]};
    expect(queuedJobDraftIssue(payload)).toContain(message);
    expect(payload.parts).toHaveLength(1);
    expect(queuedJobDraftIssue({...payload,parts:[{...payload.parts[0],name:'Фильтр',qty:2,unit:'шт'}]})).toBe('');
  });
});
