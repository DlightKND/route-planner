import {expect,it} from 'vitest';
import {sourceRoadSections} from '../src/journal-source-road.js';

const point=(minutes,lng)=>({lat:0,lng,ts:new Date(Date.UTC(2026,9,4,7,minutes)).toISOString()});

it('preserves measured distance through splits and shows unknown mileage across telemetry gaps',()=>{
 const [a,b,c,d]=[point(0,0),point(4,.01),point(8,.02),point(14,.03)];
 const shape={start:a.ts,end:d.ts,stays:[],parts:[[a,b,c],[d]]};
 expect(sourceRoadSections(shape)).toMatchObject([{km:null,measured_km:2.22}]);
 const cuts=[Date.parse(b.ts)/1000,Date.parse(c.ts)/1000];
 expect(sourceRoadSections(shape,cuts)).toMatchObject([
  {start_at:a.ts,end_at:b.ts,km:1.11},{start_at:b.ts,end_at:c.ts,km:1.11},{start_at:c.ts,end_at:d.ts,km:null,measured_km:0}
 ]);
 expect(sourceRoadSections({start:a.ts,end:c.ts,stays:[{stay_from:b.ts,stay_to:c.ts}],parts:[[a,b,c]]}))
  .toMatchObject([{start_at:a.ts,end_at:b.ts,km:1.11}]);
});
