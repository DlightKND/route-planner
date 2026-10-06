import {it,expect,vi} from 'vitest';
import {readPersonalScheduleTrips} from '../src/personal-schedule.js';
it('requests only missing linked trip IDs and retains only scoped schedule projections',async()=>{
  const db={rpc:vi.fn(async()=>({data:[{id:'missing',schedule_only:true},{id:'foreign',schedule_only:true},{id:'visible'}]}))};
  expect(await readPersonalScheduleTrips(db,[{trip_id:'visible'},{trip_id:'missing'},{trip_id:'missing'}],{visible:{}})).toEqual([{id:'missing',schedule_only:true}]);
  expect(db.rpc).toHaveBeenCalledWith('legacy_personal_schedule_read',{p_trips:['missing']});
});
it('uses ordinary visible trips without an additional request and propagates read failures',async()=>{
  const db={rpc:vi.fn(async()=>({error:new Error('offline')}))};
  expect(await readPersonalScheduleTrips(db,[{trip_id:'visible'}],{visible:{}})).toEqual([]);
  expect(db.rpc).not.toHaveBeenCalled();
  await expect(readPersonalScheduleTrips(db,[{trip_id:'missing'}],{})).rejects.toThrow('offline');
});
