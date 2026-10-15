import {it,expect,afterEach} from 'vitest';
import {Window} from 'happy-dom';
import {presenceHTML,readPresenceForm,wirePresenceRecovery} from '../src/trip-workbench.js';
import {validatePresence,presenceDaily,presenceSummary} from '../src/core/trip-review.js';
import {tripTimeSummary} from '../src/core/trip-presence-recovery.js';
const wins=[];afterEach(async()=>await Promise.all(wins.splice(0).map(w=>w.happyDOM.close())));
const gps={from:'2026-10-12T09:00:00Z',to:'2026-10-12T12:00:00Z'},part={key:'arrival',side:'before',from:'2026-10-12T06:00:00Z',to:gps.from,minutes:180};
const fixture=()=>({id:'s1',trip_id:'t1',job_id:'j1',crew_ids:['e1'],crew_source:'snapshot',minutes_raw:180,minutes_mgr:null,status:'detected',stay_from:part.from,stay_to:gps.to,presence_evidence:{version:1,gps_intervals:[gps],recovery_parts:[part]},recovery_acceptance:{}});
function render(readonly=false){const win=new Window();wins.push(win);const s=fixture();win.document.body.innerHTML=presenceHTML({trip:{id:'t1'},stays:[s],jobIds:['j1'],removed:[]},[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}],{editor:!readonly,readonly});wirePresenceRecovery(win.document.body);return {win,s,root:win.document.body};}
it('locks observed duration and edits only bounded recovered minutes, with an immediate total',()=>{
 const {win,s,root}=render(),total=root.querySelector('[data-presence="minutes_mgr"]'),extra=root.querySelector('[data-recovery-part]');
 expect(total.readOnly).toBe(true);expect(total.min).toBe('180');expect(total.max).toBe('360');expect(total.value).toBe('360');expect(extra.min).toBe('0');expect(extra.max).toBe('180');
 extra.value='0';extra.dispatchEvent(new win.Event('input',{bubbles:true}));expect(total.value).toBe('180');const rows=readPresenceForm(root,[s]);expect(rows[0].recovery_acceptance).toEqual({arrival:0});expect(rows[0].minutes_mgr).toBe(180);expect(()=>validatePresence(rows)).not.toThrow();
 extra.value='60';extra.dispatchEvent(new win.Event('input',{bubbles:true}));expect(total.value).toBe('240');expect(readPresenceForm(root,[s])[0].minutes_mgr).toBe(240);
});
it('refuses negative or excessive additions and ignores a forged readonly total',()=>{
 const {win,s,root}=render(),extra=root.querySelector('[data-recovery-part]'),total=root.querySelector('[data-presence="minutes_mgr"]');
 total.value='1';expect(readPresenceForm(root,[s])[0].minutes_mgr).toBe(360);
 for(const value of ['-1','181']){extra.value=value;extra.dispatchEvent(new win.Event('input',{bubbles:true}));expect(total.value).toBe('');expect(()=>validatePresence(readPresenceForm(root,[s]))).toThrow();}
});
it('does not count a proposal as accepted attendance or expose engineer editing',()=>{
 const {s,root}=render(true);expect(root.querySelectorAll('input,select,textarea')).toHaveLength(0);expect(root.textContent).toContain('неизменяемая часть');expect(root.textContent).toContain('Предложено после потери навигации');expect(presenceSummary([s]).approved).toBe(0);
 const summary=tripTimeSummary({started_at:'2026-10-12T03:00Z',finished_at:'2026-10-12T12:00Z'},{presence:{version:1,usable:true,drive_complete:true,drive_minutes:180,motion_intervals:[{source:'ors'}]}},[s]);expect(summary).toMatchObject({total:540,road:180,stopped:null,pending:180,unallocated:360,estimatedRoad:true});
});
it('keeps proposed recovered minutes when the editor defaults a new review to approval',()=>{
 const s={...fixture(),status:'approved'},win=new Window();wins.push(win);
 win.document.body.innerHTML=presenceHTML({trip:{id:'t1'},stays:[s],jobIds:['j1'],removed:[]},[{id:'j1',clients:{name:'Объект'}}],[],{editor:true});
 expect(win.document.querySelector('[data-recovery-part]').value).toBe('180');
 expect(readPresenceForm(win.document.body,[s])[0].minutes_mgr).toBe(360);
});
it('allocates accepted recovered intervals to the right local day rather than spreading over the whole proposal',()=>{
 const s=fixture();s.status='approved';s.minutes_mgr=240;s.recovery_acceptance={arrival:60};s.stay_from='2026-10-11T19:00Z';s.stay_to='2026-10-12T01:00Z';s.presence_evidence={version:1,gps_intervals:[{from:'2026-10-11T22:00Z',to:'2026-10-12T01:00Z'}],recovery_parts:[{key:'arrival',side:'before',from:'2026-10-11T19:00Z',to:'2026-10-11T22:00Z',minutes:180}]};
 const daily=presenceDaily([s],'2026-10-11','2026-10-12');expect(daily).toHaveLength(1);expect(daily.every(x=>x.date==='2026-10-12')).toBe(true);expect(daily.reduce((n,x)=>n+x.hours,0)).toBe(4);
});
