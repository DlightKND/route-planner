import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(network,cached){
 const handlers={},cache={put:vi.fn(async(_req,res)=>{cached=res;})};
 const fetch=vi.fn(network),caches={open:async()=>cache,match:async()=>cached?.clone()};
 vm.runInNewContext(source,{URL,Response,fetch,caches,self:{location:{origin:'https://app.example'},registration:{scope:'https://app.example/route-planner/'},addEventListener:(type,fn)=>{handlers[type]=fn;}}});
 return {fetch,cache,request:async(path='manifest.json',destination='manifest')=>{
  let response;handlers.fetch({request:{url:'https://app.example/route-planner/'+path,method:'GET',destination,mode:'cors'},respondWith:r=>{response=r;}});return response;
 }};
}
it('returns the new launch artwork manifest even when the old icon manifest is cached',async()=>{
 const w=worker(async()=>new Response('{"icons":[{"src":"new-wordmark.png"}]}'),new Response('{"icons":[{"src":"favicon.png"}]}'));
 expect((await (await w.request()).json()).icons[0].src).toBe('new-wordmark.png');
 expect(w.fetch.mock.calls[0][1]).toEqual({cache:'no-cache'});expect(w.cache.put).toHaveBeenCalledOnce();
});
it('revalidates the scoped manifest for clients without a manifest destination',async()=>{
 const w=worker(async()=>new Response('new'),new Response('old'));
 expect(await (await w.request('manifest.json?check=1','')).text()).toBe('new');
});
it('keeps the last working install manifest when offline',async()=>{
 const w=worker(async()=>{throw new Error('offline');},new Response('last-good'));
 expect(await (await w.request()).text()).toBe('last-good');expect(w.cache.put).not.toHaveBeenCalled();
});
it('does not replace a working manifest with an HTTP failure',async()=>{
 const w=worker(async()=>new Response('error',{status:503}),new Response('last-good'));
 expect(await (await w.request()).text()).toBe('last-good');expect(w.cache.put).not.toHaveBeenCalled();
});
it('reports a network error when no offline manifest exists',async()=>{
 const w=worker(async()=>{throw new Error('offline');});
 expect((await w.request()).type).toBe('error');
});
