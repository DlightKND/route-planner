import {describe, it, expect} from 'vitest';
import {pendingJobState} from '../src/core/offline-job.js';

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
});
