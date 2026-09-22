import {Window} from 'happy-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {installEngineerPickers} from '../src/engineer-picker.js';
let win,doc;
const tick=()=>new Promise(r=>setTimeout(r,5));
beforeEach(()=>{win=new Window();doc=win.document;vi.stubGlobal('window',win);vi.stubGlobal('document',doc);doc.body.innerHTML='<select id="crew" multiple aria-label="Команда"><option value="a" selected>Анна</option><option value="b">Богдан</option></select>';});
afterEach(async()=>{await win.happyDOM.close();vi.unstubAllGlobals();});
it('shows selected names and keeps the native selection contract on checkbox change',async()=>{
 installEngineerPickers();const button=doc.querySelector('.engineer-picker');expect(button.textContent).toContain('Анна');button.click();
 const changes=vi.fn();doc.querySelector('select').addEventListener('change',changes);const check=doc.querySelectorAll('.engineer-options input')[1];check.checked=true;check.dispatchEvent(new win.Event('change',{bubbles:true}));
 expect([...doc.querySelector('select').selectedOptions].map(o=>o.value)).toEqual(['a','b']);expect(changes).toHaveBeenCalledOnce();expect(button.textContent).toBe('Анна +1 ▾');expect(button.title).toBe('Анна, Богдан');
 await tick();expect(doc.querySelectorAll('.engineer-picker')).toHaveLength(1);
});
it('updates after programmatic form hydration and dynamically inserted presence forms',async()=>{
 installEngineerPickers();doc.querySelectorAll('option')[1].selected=true;doc.querySelector('select').dispatchEvent(new win.Event('crew-sync',{bubbles:true}));expect(doc.querySelector('.engineer-picker').textContent).toBe('Анна +1 ▾');
 const dialog=doc.createElement('dialog');dialog.innerHTML='<select multiple><option selected>Вера</option></select>';doc.body.append(dialog);await tick();expect(dialog.querySelector('.engineer-picker').textContent).toContain('Вера');dialog.querySelector('button').click();expect(dialog.querySelector('.engineer-options')).not.toBeNull();
});
it('closes on Escape and when the underlying control becomes disabled',async()=>{
 installEngineerPickers();const button=doc.querySelector('.engineer-picker');button.click();doc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(doc.querySelector('.engineer-options')).toBeNull();expect(button.getAttribute('aria-expanded')).toBe('false');
 button.click();doc.querySelector('select').disabled=true;await tick();expect(button.disabled).toBe(true);expect(doc.querySelector('.engineer-options')).toBeNull();
});
it('removes an orphan overlay when the form is replaced',async()=>{
 installEngineerPickers();doc.querySelector('button').click();doc.querySelector('select').remove();await tick();expect(doc.querySelector('.engineer-options')).toBeNull();expect(doc.querySelector('.engineer-picker')).toBeNull();
});
