import {it,expect} from 'vitest';
import {summaryPreset,summaryUnit,shiftSummaryPeriod,summaryPeriodLabel} from '../src/core/summary-period.js';
it('uses Monday weeks across month and year boundaries',()=>{
 expect(summaryPreset('2027-01-01','week')).toEqual({from:'2026-12-28',to:'2027-01-03'});
 expect(summaryPreset('2026-10-11','fortnight')).toEqual({from:'2026-10-05',to:'2026-10-18'});
});
it('steps calendar months without drifting or truncating leap February',()=>{
 const jan=summaryPreset('2024-01-31','month'),feb=shiftSummaryPeriod(jan,1);
 expect(feb).toEqual({from:'2024-02-01',to:'2024-02-29'});
 expect(shiftSummaryPeriod(feb,1)).toEqual({from:'2024-03-01',to:'2024-03-31'});
 expect(shiftSummaryPeriod(jan,-1)).toEqual({from:'2023-12-01',to:'2023-12-31'});
});
it('preserves an inclusive custom duration when stepping',()=>{
 expect(shiftSummaryPeriod({from:'2026-10-24',to:'2026-10-26'},1)).toEqual({from:'2026-10-27',to:'2026-10-29'});
 expect(shiftSummaryPeriod({from:'2026-10-24',to:'2026-10-26'},-1)).toEqual({from:'2026-10-21',to:'2026-10-23'});
 expect(summaryUnit({from:'2026-10-06',to:'2026-10-12'})).toBe('custom');
 expect(summaryUnit({from:'2026-10-01',to:'2026-10-31'})).toBe('month');
});
it('labels both years when a range crosses New Year',()=>{
 expect(summaryPeriodLabel({from:'2026-12-28',to:'2027-01-03'})).toBe('28.12.2026 — 03.01.2027');
});
