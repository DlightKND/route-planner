import {it,expect,vi,afterEach} from 'vitest';
import {Window} from 'happy-dom';
import {presenceLocationHTML,mountPresenceMaps} from '../src/presence-maps.js';
import {presenceHTML} from '../src/trip-workbench.js';
const windows=[];afterEach(async()=>Promise.all(windows.splice(0).map(w=>w.happyDOM.close())));
const stay={id:'s1',lat:50.123,lng:30.456,stay_from:'2026-10-19T06:00:00Z',stay_to:'2026-10-19T07:00:00Z',status:'detected',minutes_raw:60};
function page(){const win=new Window();windows.push(win);win.document.body.innerHTML=presenceLocationHTML(stay,0,'t1');return win.document.body;}
it.each([false,true])('shows the GPS location for manager and readonly=%s without adding review permissions',readonly=>{
 const html=presenceHTML({trip:{id:'t1'},stays:[stay],jobIds:[],removed:[]},[],[],{readonly});const win=new Window();windows.push(win);win.document.body.innerHTML=html;
 expect(win.document.querySelector('[data-presence-location="s1"]')).not.toBeNull();expect(win.document.body.textContent).toContain('50.12300, 30.45600');
 if(readonly)expect(win.document.querySelectorAll('input,select,button:not(.qm)')).toHaveLength(0);
});
it.each([{lat:null},{lat:''},{lat:91},{lng:181},{lng:'bad'}])('does not invent a place for invalid GPS %j',patch=>{
 const html=presenceLocationHTML({...stay,...patch},0,'t1');expect(html).toContain('Координаты стоянки не записаны');expect(html).not.toContain('data-presence-location');
});
it('accepts real zero coordinates and escapes identifiers',()=>{
 const html=presenceLocationHTML({...stay,id:'"<x>',lat:0,lng:0},0,'t1');expect(html).toContain('0.00000, 0.00000');expect(html).toContain('&quot;&lt;x&gt;');
});
it('loads only visible stops and releases observers and maps on a rerender',()=>{
 const root=page(),mount=vi.fn(()=>({destroy:vi.fn()}));let report;const observer={observe:vi.fn(),unobserve:vi.fn(),disconnect:vi.fn()};
 const observe=function(callback){report=callback;return observer;};
 const controller=mountPresenceMaps(root,[stay],{mount,observe});expect(mount).not.toHaveBeenCalled();
 const target=root.querySelector('[data-presence-location]');report([{target,isIntersecting:true}]);
 expect(mount).toHaveBeenCalledOnce();expect(mount.mock.calls[0][1]).toEqual([{lat:50.123,lng:30.456,ts:stay.stay_from}]);expect(mount.mock.calls[0][2].endpoints).toBe(false);expect(observer.unobserve).toHaveBeenCalledWith(target);
 controller.destroy();expect(observer.disconnect).toHaveBeenCalledOnce();expect(mount.mock.results[0].value.destroy).toHaveBeenCalledOnce();
 report([{target,isIntersecting:true}]);expect(mount).toHaveBeenCalledOnce();
});
it('retains coordinates and the full-map link when the basemap is unavailable',()=>{
 const root=page();mountPresenceMaps(root,[stay],{observe:null,mount:()=>null});
 expect(root.textContent).toContain('Подложка карты недоступна');expect(root.textContent).toContain('50.12300, 30.45600');expect(root.querySelector('a').getAttribute('href')).toBe('#/trip/t1/map');
});
