import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
import {installOperationsUI} from '../src/operations-ui.js';
import {installWorkspaceStructure,presentRequestWorkspace,frameGpsResolutionPrompt,restoreGpsResolutionPrompt} from '../src/workspace-ui.js';

it('retains live inputs, selected filters and create handlers when composing the workspace',async()=>{
 const win=new Window(),doc=win.document;
 try{
  doc.body.innerHTML=readFileSync('index.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const create=doc.getElementById('orderAdd'),click=vi.fn(),input=doc.getElementById('tpNotes');create.onclick=click;input.value='Несохранённый план';
  const mode=doc.getElementById('orderViewMode');mode.value='list';
  installOperationsUI(doc);installWorkspaceStructure(doc);create.click();
  expect(click).toHaveBeenCalledOnce();expect(doc.getElementById('orderViewMode')).toBe(mode);expect(mode.value).toBe('list');
  expect(doc.getElementById('tpNotes')).toBe(input);expect(input.value).toBe('Несохранённый план');
  expect(create.closest('header')).not.toBeNull();expect(input.closest('.trip-planning-sidebar')).not.toBeNull();
  expect(doc.querySelectorAll('#tpNotes,#orderAdd')).toHaveLength(2);
 }finally{await win.happyDOM.close();}
});

it('keeps actual GPS fields and drafts while framing and unframing the shared prompt',async()=>{
 const win=new Window(),doc=win.document;
 try{
  doc.body.innerHTML='<div id="promptOverlay"><div class="modal"><div id="promptFields"><input data-pf="title" value="Черновик"><select data-pf="engineer"><option>Анна</option></select></div></div></div>';
  const overlay=doc.getElementById('promptOverlay'),input=overlay.querySelector('input'),switchAction=vi.fn();
  frameGpsResolutionPrompt(overlay,{action:'chain',vehicle:'<script>car</script>',period:'16 октября',km:'120',points:10,gaps:1,canCharge:true},switchAction);
  expect(overlay.querySelector('input')).toBe(input);expect(input.value).toBe('Черновик');expect(overlay.querySelector('script')).toBeNull();
  overlay.querySelector('[data-gps-choice=link]').click();expect(switchAction).toHaveBeenCalledWith('link');
  restoreGpsResolutionPrompt(overlay);expect(overlay.querySelector('.gps-resolution-workspace')).toBeNull();expect(overlay.querySelector('input')).toBe(input);
 }finally{await win.happyDOM.close();}
});

it('renders actual request context as escaped text and keeps editing unavailable to readers',async()=>{
 const win=new Window(),doc=win.document;
 try{
  doc.body.innerHTML=readFileSync('index.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];installOperationsUI(doc);installWorkspaceStructure(doc);
  const form=doc.getElementById('requestContextFields');
  presentRequestWorkspace({saved:true,editable:false,client:'<script>client</script>',equipment:'Насос',status:'В работе',notes:'Проверить уплотнение',engineers:'Анна',due:'18 октября'},doc);
  expect(doc.getElementById('requestContext').textContent).toContain('<script>client</script>');expect(doc.querySelector('#requestContext script')).toBeNull();
  expect(doc.getElementById('requestEditContext').hidden).toBe(true);expect(form.hidden).toBe(true);
  presentRequestWorkspace({saved:false,editable:true,client:'Новый клиент'},doc);expect(form.hidden).toBe(false);expect(doc.getElementById('requestContext').hidden).toBe(true);
 }finally{await win.happyDOM.close();}
});
