import {Window} from 'happy-dom';
import {it, expect, vi, afterEach} from 'vitest';
import {createEntityTabs} from '../src/entity-tabs.js';
const windows=[];
afterEach(async()=>{await Promise.all(windows.splice(0).map(w=>w.happyDOM.close()));});
function setup(){
 const win=new Window();windows.push(win);
 win.document.body.innerHTML='<main><div role="tablist"><button role="tab" id="a" aria-controls="pa" data-entity-tab="a">План</button><button role="tab" id="b" aria-controls="pb" data-entity-tab="b">Результат</button><button role="tab" id="c" aria-controls="pc" data-entity-tab="c" disabled>История</button></div><section id="pa" data-entity-panel="a"><input value="draft"></section><section id="pb" data-entity-panel="b"><textarea>note</textarea></section><section id="pc" data-entity-panel="c"></section></main>';
 return {win,root:win.document.querySelector('main')};
}
it('switches mounted panels without losing edits or emitting input events',()=>{
 const {root}=setup(),onChange=vi.fn(),input=root.querySelector('input'),inputEvent=vi.fn();input.addEventListener('change',inputEvent);input.value='unsaved';
 const tabs=createEntityTabs(root,{initial:'a',onChange});expect(onChange).not.toHaveBeenCalled();
 root.querySelector('#b').click();expect(tabs.value).toBe('b');expect(root.querySelector('#pa').hidden).toBe(true);expect(root.querySelector('#pb').hidden).toBe(false);
 tabs.select('a');expect(root.querySelector('input')).toBe(input);expect(input.value).toBe('unsaved');expect(inputEvent).not.toHaveBeenCalled();expect(onChange).toHaveBeenCalledTimes(2);
});
it('uses roving keyboard focus, wraps arrows and skips disabled tabs',()=>{
 const {root,win}=setup(),tabs=createEntityTabs(root,{initial:'a'}),first=root.querySelector('#a');first.focus();
 first.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));expect(tabs.value).toBe('b');expect(win.document.activeElement.id).toBe('b');expect(first.tabIndex).toBe(-1);
 root.querySelector('#b').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Home',bubbles:true}));expect(tabs.value).toBe('a');
 first.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));expect(tabs.value).toBe('b');expect(root.querySelector('#c').tabIndex).toBe(-1);
});
it('rejects unavailable panels and removes old listeners when remounting',()=>{
 const {root}=setup(),oldChange=vi.fn(),newChange=vi.fn();createEntityTabs(root,{initial:'a',onChange:oldChange});const tabs=createEntityTabs(root,{initial:'a',onChange:newChange});
 tabs.select('c');expect(tabs.value).toBe('a');root.querySelector('#b').click();expect(oldChange).not.toHaveBeenCalled();expect(newChange).toHaveBeenCalledTimes(1);
 tabs.destroy();root.querySelector('#a').click();expect(tabs.value).toBe('b');
});
