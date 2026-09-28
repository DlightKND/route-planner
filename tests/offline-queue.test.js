import {describe,it,expect} from 'vitest';
import {flushQueueItems} from '../src/core/offline-queue.js';

describe('offline queue delivery',()=>{
  it('keeps the rejected action and later dependent actions until retry',async()=>{
    const queue=[{id:1},{id:2},{id:3}],delivered=[];
    let rejectSecond=true;
    const callbacks={
      send:async item=>{
        if(item.id===2&&rejectSecond)throw new Error('status changed');
        delivered.push(item.id);
      },
      drop:async id=>{queue.splice(queue.findIndex(item=>item.id===id),1);},
      block:async(item,error)=>{item.blocked_error=error.message;},
      isNetworkError:()=>false,
    };
    expect(await flushQueueItems([...queue],callbacks)).toEqual({sent:1,blocked:1});
    expect(queue.map(item=>[item.id,item.blocked_error])).toEqual([[2,'status changed'],[3,undefined]]);
    expect(await flushQueueItems([...queue],callbacks)).toEqual({sent:0,blocked:1});
    expect(delivered).toEqual([1]);
    delete queue[0].blocked_error;rejectSecond=false;
    expect(await flushQueueItems([...queue],callbacks)).toEqual({sent:2,blocked:0});
    expect(queue).toEqual([]);
    expect(delivered).toEqual([1,2,3]);
  });

  it('retains the queue after a network failure',async()=>{
    const queue=[{id:1},{id:2}];
    const result=await flushQueueItems(queue,{
      send:async()=>{throw new Error('network disconnected');},
      drop:async()=>{throw new Error('unexpected deletion');},
      block:async()=>{throw new Error('unexpected block');},
      isNetworkError:error=>error.message.startsWith('network'),
    });
    expect(result).toEqual({sent:0,blocked:0});
    expect(queue).toEqual([{id:1},{id:2}]);
  });

  it('does not mark an accepted action as rejected when local deletion fails',async()=>{
    let blocked=false;
    await expect(flushQueueItems([{id:1}],{
      send:async()=>{},drop:async()=>{throw new Error('storage full');},
      block:async()=>{blocked=true;},isNetworkError:()=>false,
    })).rejects.toThrow('storage full');
    expect(blocked).toBe(false);
  });
});
