import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Window} from 'happy-dom';
import {afterEach, expect, it, vi} from 'vitest';
import {createEntityTabs} from '../src/entity-tabs.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const windows=[];
afterEach(async()=>{await Promise.all(windows.splice(0).map(win=>win.happyDOM.close()));});
function setup({writable=true}={}){
  const win=new Window();windows.push(win);win.document.body.innerHTML=html;
  const context=vm.createContext({document:win.document,window:win,createEntityTabs,
    $:id=>win.document.getElementById(id),canWriteJob:()=>writable});
  vm.runInContext(app.slice(app.indexOf('const requestTabs=createEntityTabs'),app.indexOf('async function openJob(')),context);
  return {win,context,root:win.document.querySelector('.view-job'),get:id=>win.document.getElementById(id)};
}
it('organizes the actual request DOM without dropping or duplicating financial and operational controls',()=>{
  const {get}=setup();
  const groups={jobOverviewPane:['jbClient','jbDue','jbNotes','jobResponsibilitySection'],
    jobEstimatePane:['jobHeadEcon','jbWorks','jbParts','jbPartTotals'],
    jobExecutionPane:['jobOrders','jbPhotoList'],jobHistoryPane:['jbFixes','jobActivity']};
  for(const [panel,ids] of Object.entries(groups))for(const id of ids){
    expect(get(panel).contains(get(id)),`${id} in ${panel}`).toBe(true);
    expect(get(panel).ownerDocument.querySelectorAll('#'+id)).toHaveLength(1);
  }
  expect(get('jobSave').closest('[data-request-pane]')).toBeNull();
  expect(get('jobErr').closest('.entity-toolbar')).not.toBeNull();
});
it('switches request sections while preserving unsaved values, permission flags and autosave state',()=>{
  const {get,root,context}=setup();vm.runInContext('configureRequestTabs(true)',context);
  const notes=get('jbNotes'),works=get('jbWorks');notes.value='Неотправленная заметка';
  const field=root.ownerDocument.createElement('input');field.value='1250';field.disabled=true;works.append(field);
  const autosave=vi.fn();root.addEventListener('input',autosave);root.addEventListener('change',autosave);
  get('jobTabEstimate').click();expect(get('jobEstimatePane').hidden).toBe(false);
  get('jobTabHistory').click();get('jobTabOverview').click();
  expect(get('jbNotes')).toBe(notes);expect(notes.value).toBe('Неотправленная заметка');
  expect(get('jbWorks').contains(field)).toBe(true);expect(field.value).toBe('1250');expect(field.disabled).toBe(true);
  expect(autosave).not.toHaveBeenCalled();
});
it('starts readonly engineers in execution and exposes plain request details in overview',()=>{
  const {get,context}=setup({writable:false});vm.runInContext('configureRequestTabs(true)',context);
  expect(get('jobExecutionPane').hidden).toBe(false);expect(get('jobRefRead').hidden).toBe(true);
  get('jobTabOverview').click();expect(get('jobRefRead').hidden).toBe(false);
  get('jobTabEstimate').click();expect(get('jobRefRead').hidden).toBe(true);
  vm.runInContext("configureRequestTabs(true,'estimate')",context);
  expect(get('jobEstimatePane').hidden).toBe(false);
});
it('keeps new requests on useful sections and keyboard navigation skips unsaved-only sections',()=>{
  const {get,context,win}=setup();vm.runInContext('configureRequestTabs(false)',context);
  expect(get('jobUnsavedPanelsNotice').hidden).toBe(false);
  expect(get('jobTabExecution').disabled).toBe(true);expect(get('jobTabHistory').disabled).toBe(true);
  get('jobTabOverview').dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));
  expect(get('jobTabEstimate').getAttribute('aria-selected')).toBe('true');
  expect(win.document.activeElement).toBe(get('jobTabEstimate'));
  vm.runInContext("configureRequestTabs(false,'history')",context);expect(get('jobOverviewPane').hidden).toBe(false);
  vm.runInContext('configureRequestTabs(true)',context);expect(get('jobTabHistory').disabled).toBe(false);
  expect(get('jobUnsavedPanelsNotice').hidden).toBe(true);
});
it('opens the separate trip presence panel from the review CTA without changing trip form or dirty flags',()=>{
  const {get,context}=setup();
  const start=app.indexOf('const tripTabs=createEntityTabs'),end=app.indexOf("document.querySelector('.view-trip')?.addEventListener",start);
  vm.runInContext(app.slice(start,end),context);
  const renderer=app.slice(app.indexOf('function renderTripReviewSummary()'),app.indexOf('function listLoadError(',app.indexOf('function renderTripReviewSummary()')));
  Object.assign(context,{tripWorkbench:{trip:{id:'t1',status:'assigned'},stays:[]},tripEditId:'t1',getTrip:()=>null,
    tripOrdersAll:[],curTripOrders:new Set(),ST_TRIP:{assigned:'назначен'},tripCostReviewState:'не проверены',
    plural:()=>'',esc:String,canWriteTrip:()=>false,tripPlanDirty:true,tripPresenceDirty:true});
  vm.runInContext(renderer,context);vm.runInContext('renderTripReviewSummary()',context);
  const notes=get('tpNotes');notes.value='Изменённый план';get('tpOvCost').value='725';get('tpOvCost').disabled=true;
  const changes=vi.fn();get('tpPresencePane').closest('.view-trip').addEventListener('change',changes);
  get('tpReviewPresence').click();expect(get('tpPresencePane').hidden).toBe(false);expect(get('tpPlanPane').hidden).toBe(true);
  expect(get('tpPresence').closest('details').open).toBe(true);
  expect(get('tpTabPresence').getAttribute('aria-selected')).toBe('true');
  get('tpTabEconomy').click();get('tpTabPlan').click();
  expect(notes.value).toBe('Изменённый план');expect(get('tpOvCost').value).toBe('725');expect(get('tpOvCost').disabled).toBe(true);
  expect(context.tripPlanDirty).toBe(true);expect(context.tripPresenceDirty).toBe(true);expect(changes).not.toHaveBeenCalled();
  expect(get('tpFactBox').closest('[data-trip-pane]').dataset.tripPane).toBe('presence');
});
it('keeps trip saving and errors in the common toolbar and preserves failed-load blocking',async()=>{
  const {get,context}=setup();
  expect(get('tpSave').closest('.entity-toolbar')).not.toBeNull();
  expect(get('tripErr').closest('.entity-toolbar')).not.toBeNull();
  expect(get('tpReviewState').closest('.entity-toolbar')).not.toBeNull();
  expect(get('tpRevisionInfo').closest('[data-trip-pane]').dataset.tripPane).toBe('history');
  const start=app.indexOf('async function loadWorkbench(id)'),end=app.indexOf("if($('tpRebuildRemaining'))",start);
  Object.assign(context,{tripWorkbench:null,tripPresenceDirty:false,tripCostReviewState:'',renderTripReviewSummary:vi.fn(),
    sb:{rpc:vi.fn(async()=>({error:new Error('server unavailable')}))}});
  vm.runInContext(app.slice(start,end),context);
  await vm.runInContext('loadWorkbench("trip-1")',context);
  expect(get('tpSave').disabled).toBe(true);expect(get('tpReviewState').hidden).toBe(false);
  expect(get('tpReviewState').textContent).toContain('Сохранение заблокировано');
  expect(get('tpPresence').textContent).toContain('server unavailable');
  await vm.runInContext('loadWorkbench(null)',context);
  expect(get('tpReviewState').hidden).toBe(false);expect(get('tpReviewState').textContent).toBe('Новый план');
  expect(get('tpRevisionInfo').textContent).toBe('');
});

it('makes request save neutral after confirmed saving and primary for unsaved/new requests',()=>{
  const {get,context}=setup();context.jobEditId='job-1';
  const start=app.indexOf('function jobSaveState(txt,cls)'),end=app.indexOf('// Строка работы',start);
  vm.runInContext(app.slice(start,end),context);
  vm.runInContext("jobSaveState('сохранено')",context);expect(get('jobSave').classList.contains('amber')).toBe(false);
  expect(get('jobSave').disabled).toBe(false);
  vm.runInContext("jobSaveState('изменено')",context);expect(get('jobSave').classList.contains('amber')).toBe(true);
  vm.runInContext("jobSaveState('сохраняю…','busy')",context);expect(get('jobSave').classList.contains('amber')).toBe(false);
  context.jobEditId=null;vm.runInContext("jobSaveState('сохранено')",context);expect(get('jobSave').classList.contains('amber')).toBe(true);
});

it('reveals the actual invalid field when saving from a different request section',async()=>{
  const {get,context,win}=setup();vm.runInContext('configureRequestTabs(true)',context);
  context.curWorks=[];context.folded=new Set();context.foldKey=card=>card.dataset.fold;
  const helpers=app.slice(app.indexOf('function jobProblem()'),app.indexOf('// Строка работы',app.indexOf('function jobProblem()')));
  vm.runInContext(helpers,context);
  const start=app.indexOf("$('jobSave').onclick=async"),end=app.indexOf('// Ловим правки',start);
  vm.runInContext(app.slice(start,end),context);
  get('jobTabHistory').click();await get('jobSave').onclick();
  expect(get('jobOverviewPane').hidden).toBe(false);expect(win.document.activeElement).toBe(get('jbClient'));
  expect(get('jobErr').textContent).toContain('не выбран клиент');
  get('jbClient').innerHTML='<option value="c1">Клиент</option>';
  context.curWorks=[{custom:true,name:'  '}];
  const field=win.document.createElement('input');field.dataset.wn='0';get('jbWorks').append(field);
  get('jbWorks').closest('.foldable').classList.add('folded');context.folded.add('jbWorks');
  await get('jobSave').onclick();
  expect(get('jobEstimatePane').hidden).toBe(false);expect(win.document.activeElement).toBe(field);
  expect(get('jbWorks').closest('.foldable').classList.contains('folded')).toBe(false);expect(context.folded.has('jbWorks')).toBe(false);
  expect(get('jobErr').textContent).toContain('у своей работы нет названия');
});

it('reveals trip validation in its own section before any write and keeps the unsaved plan',async()=>{
  const {get,context,win}=setup();
  const start=app.indexOf('const tripTabs=createEntityTabs'),end=app.indexOf("document.querySelector('.view-trip')?.addEventListener",start);
  vm.runInContext(app.slice(start,end),context);
  const rpc=vi.fn();Object.assign(context,{curTripJobs:new Set(),routeAll:()=>[],vehicles:[],canWriteTrip:()=>true,
    tripPresenceDirty:false,tripPlanDirty:true,tripEditId:'trip-1',tripNewPlanId:null,sb:{rpc},tripWorkbench:{stays:[]},readPresenceForm:()=>[]});
  const saveStart=app.indexOf("$('tpSave').onclick=async"),saveEnd=app.indexOf('async function delTrip(',saveStart);
  vm.runInContext(app.slice(saveStart,saveEnd),context);
  get('tpNotes').value='Новый маршрут';get('tpTabEconomy').click();await get('tpSave').onclick();
  expect(get('tpPlanPane').hidden).toBe(false);expect(win.document.activeElement).toBe(get('tpChangeReason'));
  expect(get('tpChangeReason').closest('.wb-plan-card')).not.toBeNull();
  expect(get('tripErr').textContent).toContain('причину');expect(rpc).not.toHaveBeenCalled();
  context.tripPresenceDirty=true;get('tpTabPlan').click();await get('tpSave').onclick();
  expect(get('tpPresencePane').hidden).toBe(false);expect(get('tpPresence').closest('details').open).toBe(true);
  expect(get('tripErr').textContent).toContain('результат проверки');expect(rpc).not.toHaveBeenCalled();
  expect(get('tpNotes').value).toBe('Новый маршрут');expect(context.tripPlanDirty).toBe(true);expect(context.tripPresenceDirty).toBe(true);
});
