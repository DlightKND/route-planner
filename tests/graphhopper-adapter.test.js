import {it,expect,vi} from 'vitest';
import {graphhopperRequest,graphhopperResponse,testGraphhopperRoute} from '../supabase/functions/ors/graphhopper.ts';

const coordinates=[[11.539421,48.118477],[11.559023,48.12228]];
const input={coordinates,preference:'fastest'};
const at='2026-10-23T10:00:00.000Z';
const answer=()=>({paths:[{distance:2500,time:180000,points:{type:'LineString',coordinates},points_order:[0,1]}]});

it('preserves longitude/latitude and user order without optimization or custom weighting',()=>{
 expect(graphhopperRequest(input)).toEqual({points:coordinates,profile:'car',points_encoded:false,instructions:false,calc_points:true});
 expect(input.coordinates).toBe(coordinates);
});
it.each([
 {...input,options:{avoid_polygons:{type:'Polygon',coordinates:[]}}},
 {...input,options:{}},
 {...input,preference:'shortest'},
 {...input,preference:'recommended'},
 {...input,alternative_routes:{target_count:3}},
 {...input,optimize:true},
 {...input,profile:'truck'},
 {...input,url:'https://attacker.invalid'},
 {...input,coordinates:[...coordinates,coordinates[0]]},
 {...input,coordinates:[[181,48],coordinates[1]]},
 {...input,coordinates:[[11,-91],coordinates[1]]},
 {...input,coordinates:[['11',48],coordinates[1]]},
 {...input,coordinates:[[NaN,48],coordinates[1]]},
 {...input,coordinates:[[11,48,100],coordinates[1]]},
 null,[],{},
])('rejects unsupported or invalid input before spending a credit: %j',async body=>{
 const fetcher=vi.fn();await expect(testGraphhopperRoute(body,'fake-key',fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
it('normalizes meters and milliseconds into an ORS road leg with explicit development provenance',()=>{
 const result=graphhopperResponse(answer(),at),feature=result.features[0];
 expect(feature.geometry).toEqual({type:'LineString',coordinates});
 expect(feature.properties.summary).toEqual({distance:2500,duration:180});
 expect(feature.properties.segments).toEqual([{distance:2500,duration:180}]);
 expect(feature.properties.routing).toEqual({provider:'graphhopper',profile:'car',calculated_at:at,mode:'development',cached:false});
});
it.each([
 {distance:-1},{distance:NaN},{distance:'2500'},{time:Infinity},{time:0},
 {points:{type:'LineString',coordinates:'encoded-polyline'}},
 {points:{type:'LineString',coordinates:[[200,48],[11,48]]}},
 {points:{type:'Point',coordinates}},
 {points_order:[1,0]},
])('does not turn an invalid provider result into a road route: %j',patch=>{
 const data=answer();Object.assign(data.paths[0],patch);expect(()=>graphhopperResponse(data,at)).toThrow();
});
it.each([null,{}, {paths:[]}])('rejects a missing route instead of drawing a straight line: %j',data=>{
 expect(()=>graphhopperResponse(data,at)).toThrow();
});
it('copies only route data, never provider debug fields into a saved feature',()=>{
 const data=answer();data.debug='fake-secret';data.paths[0].points.debug='fake-secret';
 expect(JSON.stringify(graphhopperResponse(data,at))).not.toContain('fake-secret');
});
it('keeps the key at the fixed server endpoint, bounds runtime and makes no retry',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(answer())));
 const result=await testGraphhopperRoute(input,'fake-key',fetcher);
 expect(fetcher).toHaveBeenCalledTimes(1);const [url,options]=fetcher.mock.calls[0];
 expect(url).toBe('https://graphhopper.com/api/1/route?key=fake-key');
 expect(options).toMatchObject({method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'}});
 expect(options.headers).not.toHaveProperty('Authorization');
 expect(options.signal).toBeInstanceOf(AbortSignal);
 expect(JSON.parse(options.body)).toEqual(graphhopperRequest(input));
 expect(JSON.stringify(result)).not.toContain('fake-key');
});
it('does not call the provider without a key',async()=>{
 const fetcher=vi.fn();await expect(testGraphhopperRoute(input,'',fetcher)).rejects.toThrow('ключ');expect(fetcher).not.toHaveBeenCalled();
});
it.each([
 async()=>new Response('<html>fake-key</html>',{status:503}),
 async()=>new Response('{"message":"fake-key"}',{status:401}),
 async()=>new Response('<html>fake-key</html>',{status:200}),
 async()=>{throw Error('fetch failed https://example?key=fake-key');},
])('sanitizes HTTP, malformed response and transport failures without leaking the key',async fetcher=>{
 const call=vi.fn(fetcher);let error;try{await testGraphhopperRoute(input,'fake-key',call);}catch(e){error=e;}
 expect(error?.message).toContain('недоступен');expect(error?.message).not.toContain('fake-key');expect(call).toHaveBeenCalledTimes(1);
});
