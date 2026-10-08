import {it,expect} from 'vitest';
import {calendarPeriodBounds} from '../src/core/calendar-period.js';
it('uses Kyiv midnight and an exclusive next day at a month boundary',()=>{
 expect(calendarPeriodBounds({from:'2026-10-01',to:'2026-10-31'})).toEqual({from:'2026-09-30T21:00:00.000Z',until:'2026-10-31T22:00:00.000Z'});
});
it('includes a 23-hour spring day and a 25-hour autumn day',()=>{
 const spring=calendarPeriodBounds({from:'2026-03-29',to:'2026-03-29'}),autumn=calendarPeriodBounds({from:'2026-10-25',to:'2026-10-25'});
 expect((Date.parse(spring.until)-Date.parse(spring.from))/3600000).toBe(23);
 expect((Date.parse(autumn.until)-Date.parse(autumn.from))/3600000).toBe(25);
});
it('handles leap day and rejects invalid dates or a reversed range',()=>{
 expect(calendarPeriodBounds({from:'2024-02-29',to:'2024-02-29'}).until).toBe('2024-02-29T22:00:00.000Z');
 for(const period of [{from:'2026-02-29',to:'2026-03-01'},{from:'2026-10-02',to:'2026-10-01'},{from:'',to:'2026-10-01'}])expect(()=>calendarPeriodBounds(period)).toThrow();
});
