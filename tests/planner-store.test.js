import {it,expect} from 'vitest';
import {createPlannerStore} from '../src/planner-store.js';
import {plannerFixture,actor,day} from './planner-fixture.mjs';
import {movePlannerPart,plannerCapacity,resetPlannerTrip} from '../src/core/planner-workspace.js';
const period={from:day,to:day};
function make(){const f=plannerFixture();let person={...actor};const s=createPlannerStore({db:()=>f.db,actor:()=>person,storage:()=>f.storage,profiles:()=>f.profiles,settings:()=>f.settings,period:()=>period});return {...f,s,person:p=>person=p};}
it('saves through the canonical RPC and undoes against its returned revision',async()=>{const f=make();await f.s.load(period);await f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,12)],'Перенос');expect(f.s.data.groups[0].parts[0].start).toBe(12);expect(f.s.state.canUndo).toBe(true);await f.s.undoLast();expect(f.s.data.groups[0].parts[0].start).toBe(9);expect(f.calls.filter(c=>c.name==='planner_apply').map(c=>c.args.p_changes[0].expected_revision)).toEqual([0,1]);expect(f.s.state.canUndo).toBe(false);});
it('queues durably on lost response and retries the same operation ID',async()=>{const f=make();await f.s.load(period);f.fail(new TypeError('Failed to fetch'));await f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,12)],'Перенос');expect(f.s.state.pending).toHaveLength(1);const first=f.calls.find(c=>c.name==='planner_apply');expect(f.s.data.groups[0].pending).toBe(true);await expect(f.s.save([f.s.data.groups[0]],'Ещё')).rejects.toThrow(/Дождитесь/);f.fail(null);await f.s.flush();expect(f.calls.filter(c=>c.name==='planner_apply').map(c=>c.args.p_operation)).toEqual([first.args.p_operation,first.args.p_operation]);expect(f.s.state.pending).toHaveLength(0);});
it('retains rejected offline edits for correction instead of dropping them',async()=>{const f=make();await f.s.load(period);f.fail(new TypeError('offline'));await f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,12)],'Перенос');f.fail({message:'Размещение изменено другим пользователем'});await f.s.flush();expect(f.s.state.pending[0].blocked_error).toMatch(/другим/);});
it('does not treat a missing migration as successful empty data or offline fallback',async()=>{const f=make();await f.s.load(period);f.fail({code:'PGRST202',message:'planner_snapshot function not found'});await expect(f.s.load(period)).rejects.toBeTruthy();expect(f.s.state.status).toBe('error');expect(f.s.state.error).toMatch(/схемы/);});
it('isolates cached edits and late save receipts when switching accounts',async()=>{const f=make();await f.s.load(period);let release;f.hold(new Promise(r=>release=r));const pending=f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,12)],'Перенос');f.person({id:'another',role:'engineer'});f.hold(null);await f.s.load(period);release();await expect(pending).rejects.toThrow(/запись изменилась/);expect(f.s.state.canUndo).toBe(false);expect(f.s.state.pending).toHaveLength(0);});

it('keeps weekend bookings separate from the configured working fund',async()=>{const f=make(),saturday='2026-10-31',weekend={from:saturday,to:saturday};f.tables.trips[0].date_from=saturday;f.tables.trips[0].date_to=saturday;f.groups[0].parts[0].date=saturday;await f.s.load(weekend);expect(f.s.data.groups).toHaveLength(1);expect(plannerCapacity(['a'],saturday,saturday,f.s.data.settings).hours).toBe(0);f.tables.staff_day.push({engineer:'a',date:saturday,start_h:7,end_h:12,tol_h:1});await f.s.load(weekend);expect(plannerCapacity(['a'],saturday,saturday,f.s.data.settings).hours).toBe(5);});
it('sends automatic carryover as a manual layout, reloads it and undoes without changing working hours',async()=>{
 const f=make();f.groups[0].manual=false;f.groups[0].parts=[{id:'p',date:day,start:12,end:17,offset:0}];f.groups[0].auto_parts=structuredClone(f.groups[0].parts);await f.s.load({from:day,to:'2026-10-27'});
 const moved=movePlannerPart(f.s.data.groups[0],'p',day,13,f.s.data.settings);await f.s.save([moved],'Перенос с остатком');
 expect(f.calls.find(c=>c.name==='planner_apply').args.p_changes[0].manual).toBe(true);expect(f.s.data.groups[0].parts).toHaveLength(2);
 await f.s.load({from:day,to:'2026-10-27'});expect(f.s.data.groups[0].parts[1]).toMatchObject({date:'2026-10-27',start:7,end:8,offset:4,carry_root:'p'});
 await f.s.undoLast();expect(f.s.data.groups[0].parts).toEqual([{id:'p',date:day,start:12,end:17,offset:0}]);expect(f.tables.staff_day).toEqual([]);
});
it('undoes repeated carryover moves without treating its own undo as another actor edit',async()=>{
 const f=make();f.groups[0].parts=[{id:'p',date:day,start:12,end:17,offset:0}];f.groups[0].auto_parts=structuredClone(f.groups[0].parts);await f.s.load({from:day,to:'2026-10-27'});
 for(const hour of [12.25,12.5,12.75,13])await f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,hour,f.s.data.settings)],'Перенос');
 for(let i=0;i<4;i++)await f.s.undoLast();expect(f.s.data.groups[0].parts).toEqual([{id:'p',date:day,start:12,end:17,offset:0}]);expect(f.s.state.canUndo).toBe(false);
});
it('still rejects an external revision after a local undo has rebased the earlier entry',async()=>{
 const f=make();await f.s.load(period);for(const hour of [10,11])await f.s.save([movePlannerPart(f.s.data.groups[0],'p',day,hour,f.s.data.settings)],'Перенос');await f.s.undoLast();
 f.groups[0].revision++;await f.s.load(period);await expect(f.s.undoLast()).rejects.toThrow(/график уже обновился/);
});

it('carries the complete trip clock choice through reset, refresh and undo',async()=>{const f=make();f.groups[0].clock_reset=false;f.groups[0].manual=true;await f.s.load(period);await f.s.save(resetPlannerTrip(f.s.data.groups,'t'),'Сброс всего выезда');expect(f.s.data.groups[0].clock_reset).toBe(true);await f.s.undoLast();expect(f.calls.filter(c=>c.name==='planner_apply').map(c=>c.args.p_changes[0].clock_reset)).toEqual([true,false]);expect(f.s.data.groups[0].clock_reset).toBe(false);});
