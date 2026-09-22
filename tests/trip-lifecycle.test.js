import {describe,it,expect} from 'vitest';
import {lifecycleInitial,lifecyclePolicy,lifecycleStep} from '../src/core/trip-lifecycle.js';
const policy={radiusM:100,exitMarginM:20,exitDwellMs:120000,returnDwellMs:180000,maxGapMs:65000};
const point=(ts,distanceM=200,candidateIds=['trip-a'])=>({kind:'position',ts,distanceM,depotId:'depot-a',candidateIds});
const replay=(points,p=policy)=>{let state=lifecycleInitial(),events=[];for(const obs of points){const next=lifecycleStep(state,obs,p);state=next.state;events.push(...next.events);}return {state,events};};
const departure=[point(0,0),point(60000),point(120000),point(180000)];
describe('telemetry lifecycle decisions',()=>{
 it('requires explicit positive policy rather than silently adopting global thresholds',()=>{
  expect(()=>lifecyclePolicy()).toThrow();for(const k of Object.keys(policy))expect(()=>lifecyclePolicy({...policy,[k]:0})).toThrow();
 });
 it('starts at first observed exit after sustained evidence',()=>{const {state,events}=replay(departure);expect(state).toMatchObject({phase:'active',startedAt:60000,tripId:'trip-a'});expect(events.filter(e=>e.kind==='trip_started')).toHaveLength(1);});
 it('does not infer departure from first observation already outside',()=>{const {state}=replay([point(0),point(60000),point(120000)]);expect(state.startedAt).toBeNull();expect(state.reviewRequired).toBe(true);});
 it('retains ambiguous and unassigned departures for review',()=>{for(const candidates of [[],['a','b']]){const {state,events}=replay(departure.map(o=>({...o,candidateIds:candidates})));expect(state.phase).toBe('unassigned');expect(state.tripId).toBeNull();expect(events.at(-1).kind).toBe('unassigned_departure');}});
 it('does not choose a trip when assignments change during dwell',()=>{const {state}=replay([...departure.slice(0,3),point(180000,200,['trip-b'])]);expect(state.phase).toBe('unassigned');});
 it('remembers temporary ambiguity even when original assignment returns',()=>{const {state}=replay([point(0,0),point(60000),point(120000,200,['trip-a','trip-b']),point(180000)]);expect(state.phase).toBe('unassigned');});
 it('never resolves an ambiguous departure implicitly on later samples',()=>{const {state}=replay([...departure.map(o=>({...o,candidateIds:['a','b']})),point(240000,200,['a'])]);expect(state.tripId).toBeNull();});
 it('uses actual arrival time after a sustained return, not confirmation time',()=>{const {state}=replay([...departure,point(240000,0),point(300000,0),point(360000,0),point(420000,0)]);expect(state).toMatchObject({phase:'finished',finishedAt:240000});});
 it('keeps one trip when vehicle leaves again during return dwell',()=>{const {state,events}=replay([...departure,point(240000,0),point(300000),point(360000)]);expect(state).toMatchObject({phase:'active',tripId:'trip-a',finishedAt:null});expect(events.some(e=>e.kind==='return_cancelled')).toBe(true);});
 it('a telemetry gap cannot prove continuous return',()=>{const {state,events}=replay([...departure,point(240000,0),point(600000,0)]);expect(state.finishedAt).toBeNull();expect(state.returnSince).toBe(600000);expect(events.some(e=>e.kind==='telemetry_gap')).toBe(true);});
 it('a telemetry gap cannot prove continuous exit',()=>{const {state}=replay([point(0,0),point(60000),point(600000)]);expect(state.startedAt).toBeNull();expect(state.exitSince).toBeNull();expect(state.insideSeen).toBe(false);});
 it('hysteresis neutral band breaks dwell without inventing a return',()=>{const {state}=replay([point(0,0),point(60000),point(120000,110),point(180000)]);expect(state.startedAt).toBeNull();expect(state.exitSince).toBe(180000);});
 it('buttons record signals without altering measured start and end',()=>{const {state}=replay([...departure,{kind:'signal',ts:200000,signal:'finish'}]);expect(state.phase).toBe('active');expect(state.finishedAt).toBeNull();});
 it('duplicates are inert and late packets do not rewind state',()=>{const {state}=replay(departure);expect(lifecycleStep(state,point(180000),policy)).toEqual({state,events:[]});const next=lifecycleStep(state,point(120000,0),policy);expect(next.state).toEqual(state);expect(next.events[0].kind).toBe('late_observation');});
 it('does not mutate the input state or raw observation',()=>{const state=Object.freeze({...lifecycleInitial(),candidateIds:Object.freeze([])}),obs=Object.freeze(point(0,0));expect(()=>lifecycleStep(state,obs,policy)).not.toThrow();expect(state.lastTs).toBeNull();});
 it('invalid positions and changed depots cannot finish a trip',()=>{for(const invalid of [{valid:false},{distanceM:NaN},{depotId:'other'}]){const {state}=replay([...departure,point(240000,0),{...point(300000,0),...invalid},point(360000,0)]);expect(state.finishedAt).toBeNull();expect(state.reviewRequired).toBe(true);}});
 it('completion is emitted once even if later depot points arrive',()=>{const {events}=replay([...departure,point(240000,0),point(300000,0),point(360000,0),point(420000,0),point(480000,0)]);expect(events.filter(e=>e.kind==='trip_finished')).toHaveLength(1);});
});
