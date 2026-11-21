import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let tripLeaveFlight=null;'),source.indexOf('async function switchTab('));
function navigation(win,{dirty=true,confirm=false}={}){
 const orders={cardLocation:()=>({id:'task-1',scope:'request-1',pane:'scope',trip:'trip-1'}),open:vi.fn()},openJob=vi.fn(),openTrip=vi.fn(),switchTab=vi.fn();
 win.confirm=vi.fn(()=>confirm);
 const setup=`let tripPlanDirty=${dirty},tripPresenceDirty=false,plannerCur='orders',jobEditId='request-1',tripEditId='trip-1',tripResultRequest='request-1';
 const requestTabs={value:'trips'},tripTabs={value:'plan'};`;
 const nav=new Function('document','window','serviceOrders','openJob','openTrip','switchTab','restoreCardRoute','confirmDialog',setup+code+';return {leaveTripEditor,cardOrigin,returnToCard,dirty:()=>tripPlanDirty};')(win.document,win,orders,openJob,openTrip,switchTab,vi.fn(),async()=>win.confirm());
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
 const cases=[
  [{name:'order',id:'task-1',scope:'request-1',pane:'scope',trip:'trip-1'},a.orders.open,['task-1','request-1',{pane:'scope',trip:'trip-1',returning:true}]],
  [{name:'job',id:'request-1',pane:'trips'},a.openJob,['request-1',null,null,{pane:'trips',returning:true}]],
  [{name:'trip',id:'trip-1',pane:'plan',resultRequest:'request-1'},a.openTrip,['trip-1',{pane:'plan',resultRequest:'request-1',returning:true}]]
 ];
 for(const [expected,call,args] of cases){
  win.document.body.innerHTML='<section class="view view-'+expected.name+' active"></section>';
  const origin=a.nav.cardOrigin();expect(origin).toEqual(expected);
  await a.nav.returnToCard(origin);expect(call).toHaveBeenLastCalledWith(...args);
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
