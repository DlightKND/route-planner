import { describe, expect, it } from 'vitest';
import { depotPresence, validateDepotPair } from '../src/core/depot.js';

describe('depot geofence', () => {
  it('ignores impossible pair jumps', () => {
    const a={lat:49,lng:33,ts:'2026-09-11T08:00:00Z'};
    const b={lat:50,lng:34,ts:'2026-09-11T08:01:00Z'};
    expect(validateDepotPair(a,b,300).ok).toBe(false);
  });
  it('confirms departure only after a continuous hour outside the margin', () => {
    const first=depotPresence({state:'inside',insideSince:'2026-09-11T06:00:00Z'},
      {valid:true,distanceKm:5.4,ts:'2026-09-11T08:00:00Z'});
    expect(first.state).toBe('outside_candidate');
    let almost=first;
    for(let m=4;m<60;m+=4) almost=depotPresence(almost,{valid:true,distanceKm:7,ts:`2026-09-11T08:${String(m).padStart(2,'0')}:00Z`});
    expect(almost.state).toBe('outside_candidate');
    const done=depotPresence(almost,{valid:true,distanceKm:8,ts:'2026-09-11T09:00:00Z'});
    expect(done.state).toBe('outside');
    expect(done.outsideSince).toBe('2026-09-11T08:00:00Z');
  });
  it('resets the candidate after returning inside', () => {
    const candidate={state:'outside_candidate',outsideSince:'2026-09-11T08:00:00Z'};
    const inside=depotPresence(candidate,{valid:true,distanceKm:4.9,ts:'2026-09-11T08:30:00Z'});
    expect(inside.state).toBe('inside');
    expect(inside.outsideSince).toBeNull();
  });
  it('keeps state inside the neutral margin', () => {
    const inside={state:'inside',insideSince:'2026-09-11T06:00:00Z'};
    expect(depotPresence(inside,{valid:true,distanceKm:5.2,ts:'2026-09-11T08:00:00Z'}).state).toBe('inside');
  });
  it('does not count a telemetry outage as continuous time outside', () => {
    const first=depotPresence({state:'inside'},{valid:true,distanceKm:6,ts:'2026-09-11T08:00:00Z'});
    const afterGap=depotPresence(first,{valid:true,distanceKm:8,ts:'2026-09-11T09:10:00Z'});
    expect(afterGap.state).toBe('outside_candidate');
    expect(afterGap.outsideSince).toBe('2026-09-11T09:10:00Z');
  });
});
