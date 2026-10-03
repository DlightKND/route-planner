import {it,expect} from 'vitest';
import {Window} from 'happy-dom';
import {configureTripPlanStatus} from '../src/trip-plan-status.js';

it('offers only editable plan stages and preserves execution stages as read-only',async()=>{
  const win=new Window();
  try{
    const select=win.document.createElement('select');
    configureTripPlanStatus(select,{status:'assigned'},true);
    expect([...select.options].map(x=>x.value)).toEqual(['planned','assigned']);
    expect(select.disabled).toBe(false);
    for(const status of ['in_progress','finished','done','cancelled']){
      configureTripPlanStatus(select,{status},true);
      expect(select.value).toBe(status);
      expect(select.disabled).toBe(true);
    }
    configureTripPlanStatus(select,{status:'assigned',started_at:'2026-10-03T07:00:00Z'},true);
    expect(select.disabled).toBe(true);
    configureTripPlanStatus(select,{status:'planned'},false);
    expect(select.disabled).toBe(true);
  }finally{await win.happyDOM.close();}
});
