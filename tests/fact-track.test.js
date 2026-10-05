import {it,expect,vi} from 'vitest';
import {resolveFactTrack} from '../src/core/fact-track.js';
const stored={km:316.3,stored:true,segments:[{kind:'road'}],points:[]};
it('renders retained review after raw GPS has expired without querying or measuring raw',async()=>{
  const readPositions=vi.fn(()=>{throw Error('raw unavailable');}),measure=vi.fn(),readStored=vi.fn(async()=>stored);
  const r=await resolveFactTrack({trip:{status:'done'},readStored,readPositions,measure});
  expect(r.measure).toBe(stored);expect(r.raw).toEqual([]);expect(readPositions).not.toHaveBeenCalled();expect(measure).not.toHaveBeenCalled();
});
it('uses the current reviewed result before stored data',async()=>{
  const readStored=vi.fn();expect((await resolveFactTrack({trip:{status:'finished'},cached:stored,readStored})).measure).toBe(stored);expect(readStored).not.toHaveBeenCalled();
});
it('keeps active tracks live instead of freezing a previous review',async()=>{
  const readStored=vi.fn(),raw=[{lat:1,lng:2}],live={segments:[]},measure=vi.fn(async()=>live);
  expect(await resolveFactTrack({trip:{status:'in_progress'},cached:stored,readStored,readPositions:async()=>raw,measure})).toEqual({raw,measure:live});expect(readStored).not.toHaveBeenCalled();
});
it('distinguishes no track from a failed retained data read',async()=>{
  expect(await resolveFactTrack({trip:{status:'done'},readStored:async()=>null,readPositions:async()=>[]})).toBeNull();
  await expect(resolveFactTrack({trip:{status:'done'},readStored:async()=>{throw Error('denied');},readPositions:vi.fn()})).rejects.toThrow('denied');
});
