import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
import {schedulePlacementIssue,piecesOf} from '../src/core/schedule.js';

const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const rights=section('function canWrite(){','\n')+section('function canWriteTrip(','\n')+section('function canWriteJob(','\n')+section('function engineerIds(row,legacyField){','function selectedEngineerIds(');
const own={id:'own',owner_id:'owner',curator_id:'curator',vehicle_id:'car',status:'assigned'};
const foreign={...own,id:'foreign',owner_id:'other',curator_id:'other'};
function schedule({user='curator',role='engineer',rows=[own,foreign],blocks=[]}={}){
  const writes=[],refresh=vi.fn(),undo=vi.fn();
  const sb={from:table=>({update:record=>({eq:async(key,id)=>{writes.push({table,id,record});return {error:null};}})})};
  const code=rights+section('function gtCanEditBlock(','function gtTripAction(')+section('async function gtSave(b,start){','async function renderFeedAgain(');
  const api=new Function('role','session','feedCtx','getTrip','tripCache','jobs','currentJobAuthority','sb','q4','showToast','notify','renderFeedAgain','schedulePlacementIssue','gtSettings','gtBlocks','gtPieces','piecesOf','undoToast',code+';return {gtCanEditBlock,gtSave,gtSaveCuts};')
    (role,{user:{id:user}},{recordOf:id=>rows.find(r=>r.id===id.slice(1))},()=>null,{},[],true,sb,n=>Math.round(n*4)/4,vi.fn(),vi.fn(),refresh,schedulePlacementIssue,()=>({}),()=>blocks,b=>b.pieces||[],piecesOf,undo);
  return {...api,writes,refresh,undo};
}
it('uses the scheduler row rather than authority from an unrelated open editor',()=>{
  const api=schedule();
  expect(api.gtCanEditBlock({id:'town',kind:'trip'})).toBe(true);
  expect(api.gtCanEditBlock({id:'tforeign',kind:'trip'})).toBe(false);
  expect(api.gtCanEditBlock({id:'jmissing',kind:'job'})).toBe(false);
  expect(api.gtCanEditBlock(null)).toBe(false);
  expect(api.gtCanEditBlock({id:'jown',kind:'job'})).toBe(true);
});
it('saves curator placement and cuts, rejecting foreign blocks before a database write',async()=>{
  const api=schedule(),start={iso:'2026-10-01',t:9.13},block={id:'town',kind:'trip',engineer:'crew',workH:4,start,from:start.iso,to:'2026-10-09'};
  await api.gtSave(block,start);
  expect(await api.gtSaveCuts(block,[{after:2,at:{d:'2026-10-02',t:10}}])).toBe(true);
  await api.gtSave({id:'tforeign',kind:'trip'},start);
  expect(await api.gtSaveCuts({id:'tforeign',kind:'trip',start},[])).toBe(false);
  expect(api.writes).toEqual([
    {table:'trips',id:'own',record:{day_plan:{start:{d:'2026-10-01',t:9.25}}}},
    {table:'trips',id:'own',record:{day_plan:{start:{d:'2026-10-01',t:9.25},cuts:[{after:2,at:{d:'2026-10-02',t:10}}]}}}
  ]);
  expect(api.refresh).toHaveBeenCalledTimes(2);
});
it('preserves owner and global manager scheduling rights without granting crew rights',()=>{
  const block={id:'town',kind:'trip'};
  expect(schedule({user:'owner'}).gtCanEditBlock(block)).toBe(true);
  expect(schedule({user:'crew'}).gtCanEditBlock(block)).toBe(false);
  expect(schedule({user:'manager',role:'logist'}).gtCanEditBlock(block)).toBe(true);
});
it('extends the stored calendar frame and restores its original bounds and plan on undo',async()=>{
  const row={...own,date_from:'2026-10-01',date_to:'2026-10-09',day_plan:null};
  const api=schedule({rows:[row]}),block={id:'town',kind:'trip',engineer:'crew',workH:4,start:{iso:'2026-10-12',t:9},from:'2026-10-12',to:'2026-10-12'};
  expect(await api.gtSaveCuts(block,[])).toBe(true);
  expect(api.writes[0].record).toMatchObject({date_from:'2026-10-01',date_to:'2026-10-12'});
  await api.undo.mock.calls[0][1]();
  expect(api.writes[1].record).toEqual({date_from:'2026-10-01',date_to:'2026-10-09',day_plan:null});
});
function vehicle({user='curator',trip=own,answer='target',reason='Перенос по решению владельца'}={}){
  const win=new Window(),doc=win.document;
  doc.body.innerHTML='<div id="vehTitle"></div><div id="vehBody"></div><div id="vehOverlay"></div>';
  const targets=[{...own,id:'target'},{...foreign},{...own,id:'wrong-car',vehicle_id:'other'},{...own,id:'finished',status:'finished'}];
  const rpc=vi.fn(async()=>({data:'reassigned_future',error:null})),prompt=vi.fn(async()=>({trip:answer}));
  const context={role:'engineer',session:{user:{id:user}},getTrip:()=>null,tripCache:{},currentJobAuthority:false,
    vehState:[{vehicle_id:'car',ts:'2026-09-30T12:00:00Z',lat:50,lng:30}],vehicles:[{id:'car',name:'Car'}],
    vehModalId:null,vehClass:()=> 'idle',vehAgeMin:()=>0,todayISO:()=> '2026-09-30',VEH_STALE_MIN:60,
    $:id=>doc.getElementById(id),esc:String,vehTitle:()=> 'Стоит',vehRow:(a,b)=>`<div>${a}: ${b}</div>`,vehAgeText:()=> 'сейчас',clients:[],
    vehTrackSessions:[{trip_id:trip.id,vehicle_id:'car',state:'armed',planned_start_at:'2026-10-01T09:00:00Z',trip}],vehActiveTrips:{},trips:[],ST_TRIP:{},appSettings:{},
    showToast:vi.fn(),notify:vi.fn(),promptDialog:prompt,sb:{rpc,from:()=>({select(){return this;},eq(){return this;},in(){return this;},is:async()=>({data:targets,error:null})})},loadVehicles:vi.fn(),tripAction:vi.fn(),confirmDialog:async()=>true,
    loadAll:vi.fn(),loadVehState:vi.fn(),tripPeriod:()=> '01.10',delegatedOwnerIntervenes:row=>row.owner_id===user&&row.curator_id!==user,askInterventionReason:vi.fn(()=>reason)};
  const show=new Function(...Object.keys(context),rights+section('function showVehModal(vid){',"if($('vehClose'))")+';return showVehModal;')(...Object.values(context));
  show('car');return {win,doc,rpc,prompt};
}
it('loads target trips from the map without an open board and only offers authorized pending trips of the same vehicle',async()=>{
  const api=vehicle();try{
    expect(api.doc.getElementById('vehTrackCancel')).not.toBeNull();
    expect(api.doc.getElementById('vehOdometer')).toBeNull();
    await api.doc.getElementById('vehTrackMove').onclick();
    expect(api.prompt.mock.calls[0][1][0].options.map(x=>x.value)).toEqual(['target']);
    expect(api.rpc).toHaveBeenCalledWith('trip_tracking_reassign_with_reason',{p_from:'own',p_to:'target',p_reason:null});
  }finally{await api.win.happyDOM.close();}
});
it('does not offer track controls on a foreign source and rejects an invalid selected target',async()=>{
  const foreignApi=vehicle({trip:foreign}),forged=vehicle({answer:'foreign'});
  try{
    expect(foreignApi.doc.getElementById('vehTrackMove')).toBeNull();
    expect(foreignApi.doc.getElementById('vehTrackCancel')).toBeNull();
    expect(foreignApi.doc.getElementById('vehTrackStart')).toBeNull();
    await forged.doc.getElementById('vehTrackMove').onclick();expect(forged.rpc).not.toHaveBeenCalled();
  }finally{await foreignApi.win.happyDOM.close();await forged.win.happyDOM.close();}
});
it('retains owner track cancellation after delegation',async()=>{
  const api=vehicle({user:'owner'});try{
    await api.doc.getElementById('vehTrackCancel').onclick();
    expect(api.rpc).toHaveBeenCalledWith('trip_tracking_cancel_with_reason',{p_trip:'own',p_reason:null});
  }finally{await api.win.happyDOM.close();}
});

it('passes owner intervention reason on reassignment and stops if the reason is cancelled',async()=>{
  const api=vehicle({user:'owner'}),cancelled=vehicle({user:'owner',reason:null});
  try{
    await api.doc.getElementById('vehTrackMove').onclick();
    expect(api.rpc).toHaveBeenCalledWith('trip_tracking_reassign_with_reason',{p_from:'own',p_to:'target',p_reason:'Перенос по решению владельца'});
    await cancelled.doc.getElementById('vehTrackMove').onclick();expect(cancelled.rpc).not.toHaveBeenCalled();
  }finally{await api.win.happyDOM.close();await cancelled.win.happyDOM.close();}
});

it('keeps a curator trip on its actual crew lane in the personal schedule',()=>{
  const blocks=[
    {engineer:'crew',pieces:[{iso:'2026-10-06'}]},
    {engineer:null,pieces:[{iso:'2026-10-06'}]},
    {engineer:'outside-week',pieces:[{iso:'2026-10-20'}]}
  ];
  const ctx={weeks:{week:{}},mine:true,nameOf:id=>id==='crew'?'QA Engineer':id};
  const api=new Function('feedCtx','session','gtBlocks','gtPieces','gtWeekDays','profilesList',
    section('function gtBusyWeekLanes(key){','function gtWeekLanes(key){')+';return gtBusyWeekLanes;')
    (ctx,{user:{id:'curator'}},()=>blocks,b=>b.pieces,()=>['2026-10-06'],[]);
  expect(api('week')).toEqual([
    {id:'curator',name:'Мои работы'},
    {id:'crew',name:'QA Engineer'},
    {id:' free',name:'Без инженера'}
  ]);
  expect(blocks[0].engineer).toBe('crew');
  expect(api('week').some(l=>l.id==='outside-week')).toBe(false);
});

it('keeps crew start rights without granting crew track reassignment or cancellation',async()=>{
  const api=vehicle({user:'crew',trip:{...foreign,lead_engineer:'other',engineer_ids:['crew']}});
  try{
    expect(api.doc.getElementById('vehTrackStart')).not.toBeNull();
    expect(api.doc.getElementById('vehTrackMove')).toBeNull();
    expect(api.doc.getElementById('vehTrackCancel')).toBeNull();
  }finally{await api.win.happyDOM.close();}
});


it('rejects overlapping continuation before writing and preserves the existing placement',async()=>{
 const start={iso:'2026-10-08',t:7},block={id:'town',kind:'trip',engineer:'crew',workH:4,start,from:start.iso,to:'2026-10-09'};
 const api=schedule({blocks:[{id:'tother',engineer:'crew',pieces:[{iso:start.iso,from:10,to:12}]}]});
 expect(await api.gtSaveCuts(block,[{after:2,at:{d:start.iso,t:8}}])).toBe(false);
 expect(await api.gtSaveCuts(block,[{after:2,at:{d:start.iso,t:10}}])).toBe(false);
 expect(api.writes).toEqual([]);expect(block.start).toEqual(start);
 expect(await api.gtSaveCuts(block,[{after:2,at:{d:start.iso,t:12}}])).toBe(true);expect(api.writes).toHaveLength(1);
});
