import {it,expect} from 'vitest';
import {distanceCost,trackPreview} from '../src/unassigned-tracks.js';
it('matches decimal half-up cost rounding instead of binary floating point ties',()=>{
 expect(distanceCost('0.29','0.5')).toBe(.15);
 expect(distanceCost('120','12.5')).toBe(1500);
 expect(distanceCost('0.01','1e-7')).toBe(0);
 expect(()=>distanceCost('-2',12.5)).toThrow();expect(()=>distanceCost(1,Infinity)).toThrow();
});
it('breaks the GPS line across radio gaps and safely handles a large raw archive',()=>{
 const points=Array.from({length:150000},(_,i)=>({lat:50+i/10000000,lng:30,ts:new Date(Date.UTC(2026,9,1)+i*1000).toISOString()}));
 points.at(-1).ts=new Date(Date.UTC(2026,9,1)+200000000).toISOString();
 const preview=trackPreview(points);expect(preview.match(/<polyline/g)).toHaveLength(2);
 expect(preview).not.toContain('NaN');expect(preview).not.toContain('Infinity');
});

it('shows an explicit break between selected parts even when timestamps are close',()=>{
 const points=[{lat:50,lng:30,ts:'2026-10-01T07:00:00Z',part:1},{lat:50.001,lng:30,ts:'2026-10-01T07:01:00Z',part:1},{lat:51,lng:30,ts:'2026-10-01T07:02:00Z',part:2}];
 expect(trackPreview(points).match(/<polyline/g)).toHaveLength(2);
});
