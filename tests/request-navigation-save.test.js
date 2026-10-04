import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const state=source.slice(source.indexOf('let jobSaveT=null,'),source.indexOf("window.addEventListener('beforeunload',e=>{",source.indexOf('let jobSaveT=null,')));
const save=source.slice(source.indexOf('function saveJobNow(){'),source.indexOf("$('jobSave').onclick",source.indexOf('function saveJobNow(){')));
function editor(win,{persist=async()=>{},online=true,queue=async()=>({}),id='request-1'}={}){
 win.document.body.innerHTML='<section class="view-job active"><select id="jbStatus"><option value="planned">planned</option></select><div id="jobSaveState"></div></section>';
 win.confirm=vi.fn(()=>false);const restore=vi.fn(),notify=vi.fn();
 const code=state.replace(/function restoreCardRoute\(\)\{[^\n]+\}/,'')+save;
 const api=new Function('document','window','$','navigator','persistJob','queueCurrentJobSnapshot','restoreCardRoute','notify',`
 let jobEditId=${JSON.stringify(id)},partT={},jobParts=[],jobDelegatedOwner=false,jobSavedStatus='planned',jobReasonTarget=null,jobInterventionReason='',curWorks=[];
 const qAll=async()=>[],qFlush=async()=>{},jobProblem=()=>'',jobRec=()=>({generation:jobEditGeneration}),jobHead=()=>{},isNetErr=()=>false;
 const jobSaveState=(txt,cls)=>{const el=$('jobSaveState');el.textContent=txt;el.className=cls||'';};const queuedJobDraftIssue=()=> 'черновик';
 `+code+`;return {saveJobNow,leaveJobEditor,edit:()=>{jobEditorDirty=true;jobEditGeneration++;if(jobSaving)jobSaveAgain=true;},dirty:()=>jobEditorDirty};`)(win.document,win,id=>win.document.getElementById(id),{onLine:online},persist,queue,restore,notify);
 return {...api,restore,notify};
}
it('waits for an in-flight request save before navigating',async()=>{
 const win=new Window();try{let complete;const persist=vi.fn(()=>new Promise(resolve=>complete=resolve));const e=editor(win,{persist});e.edit();const saving=e.saveJobNow();await Promise.resolve();await Promise.resolve();const leaving=e.leaveJobEditor();let finished=false;leaving.then(()=>finished=true);await Promise.resolve();expect(finished).toBe(false);complete();await saving;expect(await leaving).toBe(true);expect(e.dirty()).toBe(false);expect(persist).toHaveBeenCalledTimes(1);}finally{await win.happyDOM.close();}
});
it('saves edits made during an in-flight write before allowing navigation',async()=>{
 const win=new Window();try{let complete;const persist=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>complete=resolve)).mockResolvedValue(undefined);const e=editor(win,{persist});e.edit();const saving=e.saveJobNow();await Promise.resolve();await Promise.resolve();e.edit();complete();await saving;expect(persist.mock.calls.map(([rec])=>rec.generation)).toEqual([1,2]);expect(await e.leaveJobEditor()).toBe(true);expect(e.dirty()).toBe(false);}finally{await win.happyDOM.close();}
});
it('keeps a failed request save and restores the card route',async()=>{
 const win=new Window();try{const e=editor(win,{persist:async()=>{throw Error('revision conflict');}});e.edit();expect(await e.leaveJobEditor()).toBe(false);expect(e.dirty()).toBe(true);expect(e.restore).toHaveBeenCalledOnce();expect(win.document.getElementById('jobSaveState').textContent).toContain('revision conflict');}finally{await win.happyDOM.close();}
});
it('allows navigation after an offline edit is durably queued, but blocks storage failures',async()=>{
 const win=new Window();try{const queue=vi.fn(async()=>({}));const e=editor(win,{online:false,queue});e.edit();expect(await e.leaveJobEditor()).toBe(true);expect(queue).toHaveBeenCalledOnce();const bad=editor(win,{online:false,queue:async()=>null});bad.edit();expect(await bad.leaveJobEditor()).toBe(false);expect(bad.dirty()).toBe(true);}finally{await win.happyDOM.close();}
});
it('keeps a new request draft until discard is explicitly confirmed',async()=>{
 const win=new Window();try{const e=editor(win,{id:null});e.edit();expect(await e.leaveJobEditor()).toBe(false);expect(e.dirty()).toBe(true);win.confirm=()=>true;expect(await e.leaveJobEditor()).toBe(true);expect(e.dirty()).toBe(false);}finally{await win.happyDOM.close();}
});
