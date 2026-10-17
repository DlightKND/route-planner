import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {validatedTrackFact} from '../src/core/fact-track.js';

const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function writeFactTrack('),source.indexOf('// Читаем сохранённый разбор.'));
const measure=(trip={})=>({km:1601.26,trackKm:1300,roadKm:301.26,lineKm:0,verdict:'трек достоверен',points:[],dropped:[],
  rebuildUser:'manager',rebuildContext:{trip:{id:'trip',workbench_revision:35,fact_km:21747,fact_km_source:null,...trip},source_to:'2026-10-16T20:00Z',source_digest:'gps-snapshot'}});
function writer(error=null){
  const old={km:21747},cache={trip:old},rpc=vi.fn(async()=>({data:{revision:36,fact_updated:true},error}));
  const save=new Function('sb','session','slimMeasure','validatedTrackFact','lastMeasure',code+';return writeFactTrack;')
    ({rpc},{user:{id:'manager'}},m=>({km:m.km}),validatedTrackFact,cache);
  return {save,rpc,cache,old};
}
it('saves reconstructed geometry and corrected mileage in the same RPC, replacing the legacy unlabelled fact',async()=>{
  const {save,rpc,cache}=writer(),m=measure();await save('trip',m);
  expect(rpc).toHaveBeenCalledWith('trip_track_rebuild_save',expect.objectContaining({p_trip:'trip',p_expected:35,p_track:{km:1601.26},p_fact_km:1601.3,p_fact_source:'track'}));
  expect(cache.trip).toMatchObject({km:m.km,stored:true});
});
it('keeps the last persisted map when saving reconstruction fails',async()=>{
  const {save,rpc,cache,old}=writer(new Error('GPS changed'));await expect(save('trip',measure())).rejects.toThrow('GPS changed');
  expect(rpc).toHaveBeenCalledOnce();expect(cache.trip).toBe(old);
});
it('preserves explicitly entered odometer mileage during attendance review',async()=>{
  const {save,rpc}=writer();await save('trip',measure({fact_km:1700,fact_km_source:'odometer'}));
  expect(rpc.mock.calls[0][1]).toMatchObject({p_fact_km:null,p_fact_source:null});
});
it('allows an explicit mileage recalculation to replace the odometer, unlike attendance review',async()=>{
  const {save,rpc}=writer(),m=measure({fact_km_source:'odometer'});await save('trip',m,validatedTrackFact(m));
  expect(rpc.mock.calls[0][1]).toMatchObject({p_fact_km:1601.3,p_fact_source:'track'});
});
it('does not send another users reconstruction or one without its source snapshot',async()=>{
  const {save,rpc}=writer(),m=measure();m.rebuildUser='other';await expect(save('trip',m)).rejects.toThrow('Аккаунт');
  delete m.rebuildContext;await expect(save('trip',m)).rejects.toThrow('снимка');expect(rpc).not.toHaveBeenCalled();
});
it.each([NaN,Infinity,-1])('does not promote invalid mileage %s to financial fact',km=>{
  expect(validatedTrackFact({...measure(),km})).toBeNull();
});
it('does not promote a rejected GPS track to financial fact',()=>{
  expect(validatedTrackFact({...measure(),verdict:'трек недостоверен: ошибки GPS'})).toBeNull();
});
