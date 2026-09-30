import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';

// Exercise the real monolithic app functions without booting its map/GPS.
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
function actions({role='engineer',user='curator',trips=[]}={}){
  const functions=section('function canWrite(){','\n',)+
    section('function canWriteTrip(','\n')+
    section('function gtTripAction(','function gtVerticalHtml(')+
    section('function tripActs(t){','// «График»');
  return new Function('role','session','getTrip','tripCache','reschedByTrip','todayISO',functions+';return {gtTripAction,tripActs};')
    (role,{user:{id:user}},id=>trips.find(t=>t.id===id),{}, {},()=> '2026-09-30');
}
it('shows confirmation and the full trip controls to an engineer curator without crew membership',()=>{
  const trip={id:'own',status:'finished',owner_id:'owner',curator_id:'curator'};
  const api=actions({trips:[trip]});
  expect(api.gtTripAction({kind:'trip',tripId:'own',status:'finished',engineerIds:[]},true)?.kind).toBe('confirm');
  const html=api.tripActs(trip);
  for(const control of ['data-tconf','data-tstaymap','data-tkm','data-topen'])expect(html).toContain(control);
});
it('uses the target trip assignment and excludes unrelated trips even when another trip is editable',()=>{
  const own={id:'own',owner_id:'owner',curator_id:'curator'},other={id:'other',status:'finished',owner_id:'stranger',curator_id:'stranger'};
  const api=actions({trips:[own,other]});
  expect(api.gtTripAction({kind:'trip',tripId:'other',status:'finished',engineerIds:[]},true)).toBeNull();
  expect(api.tripActs(other)).not.toContain('data-tconf');expect(api.tripActs(other)).not.toContain('data-topen');
  expect(api.gtTripAction({kind:'trip',tripId:'missing',status:'finished'},true)).toBeNull();
});
it('retains owner and global manager authority, while a crew engineer waits for confirmation',()=>{
  const trip={id:'trip',status:'finished',owner_id:'owner',curator_id:'curator'};
  const block={kind:'trip',tripId:'trip',status:'finished',engineerIds:['crew']};
  expect(actions({user:'owner',trips:[trip]}).gtTripAction(block,true)?.kind).toBe('confirm');
  expect(actions({role:'logist',user:'manager',trips:[trip]}).gtTripAction(block,true)?.kind).toBe('confirm');
  expect(actions({user:'crew',trips:[trip]}).gtTripAction(block,true)).toMatchObject({kind:'wait',passive:true});
});
it('enables kanban drag only for authorized cards and rejects a forged drop id',async()=>{
  const win=new Window();
  try{
    const box=win.document.createElement('div');
    box.innerHTML='<article class="kcard" data-kid="own"></article><article class="kcard" data-kid="foreign"></article><section class="kcol" data-kst="planned"></section>';
    const wire=new Function(section('function wireKanbanDrag(','async function dropJob(')+';return wireKanbanDrag;')();
    const drop=vi.fn(),allowed=vi.fn(id=>id==='own');wire(box,drop,allowed);
    expect(box.querySelector('[data-kid="own"]').getAttribute('draggable')).toBe('true');
    expect(box.querySelector('[data-kid="foreign"]').hasAttribute('draggable')).toBe(false);
    for(const id of ['foreign','own']){
      const event=new win.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={getData:()=>id};
      box.querySelector('.kcol').dispatchEvent(event);await Promise.resolve();
    }
    expect(drop.mock.calls).toEqual([['own','planned']]);
  }finally{await win.happyDOM.close();}
});
