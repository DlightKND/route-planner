import {it,expect,vi} from 'vitest';
import {saveRequestAndWorks} from '../src/core/request-save.js';

it('sends online and replay saves through the atomic request work and material RPC',async()=>{
  const rpc=vi.fn(async()=>({data:{job_id:'job-1',works:[]},error:null}));
  const db={rpc};
  const record={status:'in_progress',notes:'field note'};
  const works=[{id:'work-1',hours:2}];
  const parts=[{id:'part-1',name:'Filter',qty:2}];
  const result=await saveRequestAndWorks(db,{id:'job-1',record,works,parts});
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('job_request_save',{p_id:'job-1',p_rec:record,p_works:works,p_parts:parts});
  expect(result.job_id).toBe('job-1');
});

it('can replay a header-only legacy queue item without replacing work rows',async()=>{
  const rpc=vi.fn(async()=>({data:{job_id:'job-1',works:[]},error:null}));
  await saveRequestAndWorks({rpc},{id:'job-1',record:{status:'done'},works:null});
  expect(rpc).toHaveBeenCalledWith('job_request_save',{p_id:'job-1',p_rec:{status:'done'},p_works:null,p_parts:null});
});

it('leaves materials unchanged for an older queue item that only has a work snapshot',async()=>{
  const rpc=vi.fn(async()=>({data:{job_id:'job-1',works:[]},error:null}));
  await saveRequestAndWorks({rpc},{id:'job-1',record:{notes:'legacy'},works:[{id:'work-1'}]});
  expect(rpc).toHaveBeenCalledWith('job_request_save',{p_id:'job-1',p_rec:{notes:'legacy'},p_works:[{id:'work-1'}],p_parts:null});
});

it('surfaces server rejection without pretending the queue item was saved',async()=>{
  const rpc=vi.fn(async()=>({data:null,error:new Error('revision conflict')}));
  await expect(saveRequestAndWorks({rpc},{id:'job-1',record:{},works:[]})).rejects.toThrow('revision conflict');
});
