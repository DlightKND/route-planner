import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let tripLeaveFlight=null;'),source.indexOf('async function switchTab(name, sub){'));
function navigation(win,{dirty=true,confirm=false}={}){
 const orders={currentId:()=> 'task-1',open:vi.fn()},openJob=vi.fn(),openTrip=vi.fn(),switchTab=vi.fn();
 win.confirm=vi.fn(()=>confirm);
 const nav=new Function('document','window','serviceOrders','openJob','openTrip','switchTab','restoreCardRoute','confirmDialog',`let tripPlanDirty=${dirty},tripPresenceDirty=false,plannerCur='orders',jobEditId='request-1',tripEditId='trip-1';`+code+';return {leaveTripEditor,cardOrigin,returnToCard,dirty:()=>tripPlanDirty};')(win.document,win,orders,openJob,openTrip,switchTab,vi.fn(),async()=>win.confirm());
 return {nav,orders,openJob,openTrip,switchTab};
}
it('preserves trip edits when navigation is cancelled, and clears them only on confirmed discard',async()=>{
 const win=new Window();
 try{win.document.body.innerHTML='<section class="view view-trip active"></section>';
 const a=navigation(win);expect(await a.nav.leaveTripEditor()).toBe(false);expect(a.nav.dirty()).toBe(true);
 win.confirm=()=>true;expect(await a.nav.leaveTripEditor()).toBe(true);expect(a.nav.dirty()).toBe(false);
 }finally{await win.happyDOM.close();}
});
it('returns to the actual source entity and to the remembered dispatcher subsection',async()=>{
 const win=new Window();
 try{const a=navigation(win,{dirty:false});
 for(const [name,id,call] of [['order','task-1',a.orders.open],['job','request-1',a.openJob],['trip','trip-1',a.openTrip]]){
  win.document.body.innerHTML='<section class="view view-'+name+' active"></section>';
  const origin=a.nav.cardOrigin();expect(origin).toEqual({name,sub:null,id});
  await a.nav.returnToCard(origin);expect(call).toHaveBeenLastCalledWith(id);
 }
 win.document.body.innerHTML='<section class="view view-planner active"></section>';
 await a.nav.returnToCard(a.nav.cardOrigin());expect(a.switchTab).toHaveBeenLastCalledWith('planner','orders');
 }finally{await win.happyDOM.close();}
});
it('does not prompt to discard a trip when another screen is active',async()=>{
 const win=new Window();
 try{win.document.body.innerHTML='<section class="view view-job active"></section>';const a=navigation(win);
 expect(await a.nav.leaveTripEditor()).toBe(true);expect(win.confirm).not.toHaveBeenCalled();expect(a.nav.dirty()).toBe(true);
 }finally{await win.happyDOM.close();}
});
