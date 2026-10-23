import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {trackLineStyle,SPEED_RAMP,speedColor} from '../src/core/track-style.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const create=(source,ctx)=>new Function(...Object.keys(ctx),'return ('+source+');')(...Object.values(ctx));
const reachSource=app.slice(app.indexOf('function makeReach(){'),app.indexOf('// ORS кодирует причину'));
function reachSetup(post){return create(reachSource,{orsKeyMissing:()=>false,appSettings:{},orsPost:post,ORS_DIR:'route',orsSaysNoRoute:e=>e.status===400})();}
it.each([503,429,401,0])('does not turn routing failure %s into a successful GPS-only reconstruction',async status=>{
 const failure=Object.assign(Error('Routing unavailable'),{status});const reach=reachSetup(async()=>{throw failure;});await expect(reach({lat:1,lng:2},{lat:2,lng:3},3600000)).rejects.toBe(failure);
});
it('retains the no-route verdict without treating an infrastructure error as a bad GPS point',async()=>{const reach=reachSetup(async()=>{throw Object.assign(Error('No road'),{status:400});});expect(await reach({lat:1,lng:2},{lat:2,lng:3},3600000)).toEqual({ok:false,km:0});});
it('rejects missing configuration and malformed route responses',async()=>{
 expect(()=>create(reachSource,{orsKeyMissing:()=>true})()).toThrow('не настроена');
 await expect(reachSetup(async()=>({features:[]}))({lat:1,lng:2},{lat:2,lng:3},1000)).rejects.toThrow('неполный ответ');
});
const recalcSource=app.slice(app.indexOf('async function recalculateFactTrack('),app.indexOf('async function measureTripKm('));
it('both entry points use the same validation, durable save and economic refresh',async()=>{
 const measured={ok:true,km:120,note:'Проверено',measure:{rebuildContext:{trip:{status:'done'}}}},measureTripKm=vi.fn(async()=>measured),writeFactTrack=vi.fn(),loadFactHours=vi.fn(),refreshTripEcon=vi.fn(async()=>true);
 const recalc=create(recalcSource,{measureTripKm,writeFactTrack,loadFactHours,refreshTripEcon,busy:()=>{}});
 await recalc('trip');await recalc('trip',{replaceOdometer:true});expect(writeFactTrack.mock.calls).toEqual([['trip',measured.measure,null],['trip',measured.measure,{km:120,source:'track',note:'Проверено'}]]);expect(loadFactHours).toHaveBeenCalledWith('trip');expect(refreshTripEcon).toHaveBeenCalledTimes(2);
 expect(app).toContain('rebuild:async id=>{try{const measured=await recalculateFactTrack(id)');expect(app).toContain('m=await recalculateFactTrack(tid,{replaceOdometer:true})');
});
it('a rejected or failed calculation cannot replace a stored track',async()=>{
 const writeFactTrack=vi.fn();for(const failure of [false,true]){const recalc=create(recalcSource,{measureTripKm:async()=>{if(failure)throw Error('ORS 503');return {ok:false};},writeFactTrack});if(failure)await expect(recalc('trip')).rejects.toThrow('503');else expect(await recalc('trip')).toEqual({ok:false});}expect(writeFactTrack).not.toHaveBeenCalled();
});
it('shares the orange and gray dashed line styles while preserving the green speed ramp',()=>{
 expect(trackLineStyle('road')).toMatchObject({color:'#d87619',dashArray:'7 6',weight:4});expect(trackLineStyle('line')).toMatchObject({color:'#8b8e96',dashArray:'7 6'});
 expect(trackLineStyle('track',{speed:0}).color).toBe(SPEED_RAMP[0]);expect(trackLineStyle('track',{speed:110}).color).toBe(SPEED_RAMP.at(-1));expect(speedColor(20)).not.toBe(speedColor(90));expect(trackLineStyle('track').dashArray).toBeNull();
});

it('refreshes completed-trip economics when unreliable GPS requires an explicit odometer reading',async()=>{
 const source=app.slice(app.indexOf('async function settleFactKm('),app.indexOf('async function tripAction('));
 const writeFactKm=vi.fn(),loadFactHours=vi.fn(),refreshTripEcon=vi.fn(async()=>true);
 const settle=create(source,{recalculateFactTrack:async()=>({ok:false,why:'Нет трека'}),busy:()=>{},busyDone:()=>{},confirmDialog:async()=>true,askOdometer:async()=>({km:50,a:100,b:150}),writeFactKm,writeFactTrack:vi.fn(),trips:[{id:'t',status:'done'}],tripCache:{},loadFactHours,refreshTripEcon,notify:vi.fn(),showToast:vi.fn()});
 expect(await settle('t')).toBe(true);expect(writeFactKm).toHaveBeenCalledWith('t',50,'odometer',expect.any(String));expect(loadFactHours).toHaveBeenCalledWith('t');expect(refreshTripEcon).toHaveBeenCalledWith('t');
});
