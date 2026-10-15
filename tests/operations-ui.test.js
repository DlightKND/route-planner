import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
import {installOperationsUI} from '../src/operations-ui.js';

it('preserves existing dispatcher handlers and clears a visible engineer filter through its established change event',async()=>{
 const win=new Window(),doc=win.document;
 try{
  doc.body.innerHTML=readFileSync('index.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const engineer=doc.getElementById('jobEngFilter'),mode=doc.getElementById('jobLayout'),change=vi.fn();
  engineer.innerHTML='<option value="">Все инженеры</option><option value="one" selected>Анна</option>';engineer.onchange=change;
  mode.value='list';const modeChange=vi.fn();mode.onchange=modeChange;
  installOperationsUI(doc);
  expect(doc.getElementById('jobLayout')).toBe(mode);expect(mode.value).toBe('list');
  mode.dispatchEvent(new win.Event('change'));expect(modeChange).toHaveBeenCalledOnce();
  const chip=doc.querySelector('#plJobs .design-filter-chips button');expect(chip.textContent).toContain('Анна');chip.click();
  expect(engineer.value).toBe('');expect(change).toHaveBeenCalledOnce();expect(chip.closest('.design-filter-chips')).toBeNull();
  expect(doc.querySelector('#plJobs .design-filter-chips').hidden).toBe(true);
  expect(doc.querySelectorAll('#jobLayout')).toHaveLength(1);
 }finally{await win.happyDOM.close();}
});

it('keeps the moved trip controls in the board-only scope so they cannot leak into the GPS journal',async()=>{
 const win=new Window(),doc=win.document;
 try{
  doc.body.innerHTML=readFileSync('index.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];installOperationsUI(doc);
  expect(doc.getElementById('tripLayout').closest('[data-trip-board-only]')).not.toBeNull();
  expect(doc.getElementById('tripEngFilter').closest('[data-trip-board-only]')).not.toBeNull();
  expect(doc.querySelector('#plTrips .design-filter-chips').hasAttribute('data-trip-board-only')).toBe(true);
  expect(doc.querySelector('[data-trip-section=tracking]')).not.toBeNull();expect(doc.getElementById('tripAdd')).not.toBeNull();
 }finally{await win.happyDOM.close();}
});
