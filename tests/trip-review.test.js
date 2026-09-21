import { describe, it, expect } from 'vitest';
import { presenceSummary, validatePresence, planMembership, remainingStops, presenceDaily, sameEditablePlan } from '../src/core/trip-review.js';

const stay = (extra = {}) => ({ id:'s', job_id:'job', status:'approved', crew_ids:['a','b'], crew_source:'snapshot',
  stay_from:'2026-09-21T09:00:00Z', stay_to:'2026-09-21T12:00:00Z', minutes_raw:180, minutes_mgr:180, ...extra });
describe('trip presence review', () => {
  it('counts presence of two people, including waiting, without altering norms', () => {
    expect(presenceSummary([stay()])).toMatchObject({approved:6, proposed:6, complete:true, byEngineer:{a:3,b:3}, byJob:{job:6}});
  });
  it('does not count duplicate crew twice', () => { expect(presenceSummary([stay({crew_ids:['a','a']})]).approved).toBe(3); });
  it('keeps unreviewed and legacy presence out of accepted totals', () => {
    expect(presenceSummary([stay(), stay({status:'detected'}), stay({crew_source:'legacy_unverified'})])).toMatchObject({approved:6, proposed:18, pending:2, complete:false});
  });
  it('requires review of unmatched stops, but excludes explicitly rejected stops', () => {
    expect(presenceSummary([stay({job_id:null}),stay({status:'rejected'})])).toMatchObject({approved:0,pending:1});
  });
  it('distinguishes accepted zero from missing minutes', () => {
    expect(presenceSummary([stay({minutes_mgr:0})])).toMatchObject({approved:0,complete:true});
    expect(presenceSummary([stay({minutes_mgr:null})])).toMatchObject({complete:false});
  });
  it('rejects duplicate attendance intervals of the same person', () => {
    expect(() => validatePresence([stay(),stay({id:'s2',job_id:'other'})])).toThrow('пересекается');
    expect(validatePresence([stay(),stay({crew_ids:['c']})])).toBe(true);
  });
  it('rejects hours beyond the interval and missing crew', () => {
    expect(() => validatePresence([stay({minutes_mgr:500})])).toThrow();
    expect(() => validatePresence([stay({crew_ids:[]})])).toThrow();
  });
  it('allows consecutive intervals without overlap', () => {
    expect(validatePresence([stay(),stay({stay_from:'2026-09-21T12:00:00Z',stay_to:'2026-09-21T15:00:00Z'})])).toBe(true);
  });
  it('removes a cancelled stop only from current membership', () => {
    expect(planMembership(['A','B'],['A','C'])).toEqual({added:['C'],removed:['B'],kept:['A']});
  });
  it('does not adopt a newer revision onto stale plan form values',()=>{
    const plan={notes:'старый',workbench_revision:1};
    expect(sameEditablePlan(plan,{...plan,workbench_revision:2,fact_km:120},['a'],['a'])).toBe(true);
    expect(sameEditablePlan(plan,{...plan,notes:'новый',workbench_revision:2},['a'],['a'])).toBe(false);
    expect(sameEditablePlan(plan,plan,['a'],['a','b'])).toBe(false);
  });
  it('keeps depot and unvisited stops in remaining route', () => {
    const a={type:'job',lat:1,lng:2}, b={type:'job',lat:3,lng:4}, depot={type:'place',lat:1,lng:2};
    expect(remainingStops([a,b,depot],new Set(['1.00000,2.00000']))).toEqual([b,depot]);
  });
  it('credits actual dates and each participant rather than the team lead',()=>{
    const rows=presenceDaily([stay({stay_from:'2026-09-21T20:00:00Z',stay_to:'2026-09-21T22:00:00Z',minutes_mgr:120})],'2026-09-21','2026-09-22');
    expect(rows).toHaveLength(4);expect(rows.map(x=>x.hours)).toEqual([1,1,1,1]);
    expect(rows.map(x=>x.date)).toEqual(['2026-09-21','2026-09-21','2026-09-22','2026-09-22']);
  });
  it('preserves elapsed time across Kyiv daylight saving change',()=>{
    const rows=presenceDaily([stay({stay_from:'2026-10-24T21:00:00Z',stay_to:'2026-10-25T22:00:00Z',minutes_mgr:1500})],'2026-10-25','2026-10-25',new Set(['a']));
    expect(rows).toHaveLength(1);expect(rows[0].hours).toBe(25);
  });
  it('clips to the selected period and respects manager minute corrections',()=>{
    const rows=presenceDaily([stay({stay_from:'2026-09-21T20:00:00Z',stay_to:'2026-09-21T22:00:00Z',minutes_mgr:60})],'2026-09-22','2026-09-22',new Set(['b']));
    expect(rows).toHaveLength(1);expect(rows[0].hours).toBe(.5);
  });
});
