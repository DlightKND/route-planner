import {it,expect} from 'vitest';
import {Window} from 'happy-dom';
import {presenceHTML,readPresenceForm} from '../src/trip-workbench.js';
import {mountPresenceReview} from '../src/presence-review-workspace.js';
it('applies allocations to the same draft without confirming and restores cancelled changes',async()=>{
 const win=new Window();try{
  const s={id:'s',status:'detected',job_id:'j',crew_ids:['e'],crew_source:'snapshot',stay_from:'2026-10-21T08:00Z',stay_to:'2026-10-21T09:00Z',minutes_raw:60,task_allocations:[{order_id:'o',share:.5}]},data={trip:{id:'t'},jobIds:['j'],removed:[],stays:[s]},root=win.document.body;
  root.innerHTML=presenceHTML(data,[{id:'j',clients:{name:'Объект'}}],[{id:'e',role:'engineer',full_name:'Анна'}],{workspace:true,orders:[{id:'o',number:1,title:'Проверка',job_id:'j'}]});mountPresenceReview(root,data);
  root.querySelector('[data-allocation-edit]').click();const share=root.querySelector('dialog [data-task-allocation-share]');share.value='70';share.dispatchEvent(new win.Event('input',{bubbles:true}));root.querySelector('[data-allocation-cancel]').click();expect(readPresenceForm(root,[s])[0].task_allocations[0].share).toBe(.5);
  root.querySelector('[data-allocation-edit]').click();const next=root.querySelector('dialog [data-task-allocation-share]');next.value='80';next.dispatchEvent(new win.Event('input',{bubbles:true}));root.querySelector('[data-allocation-apply]').click();expect(readPresenceForm(root,[s])[0].task_allocations[0].share).toBe(.8);expect(s.status).toBe('detected');expect(s.task_allocations[0].share).toBe(.5);
 }finally{await win.happyDOM.close();}
});
it('keeps other stop drafts dirty when one decision is saved and clears explicitly discarded drafts',async()=>{
 const win=new Window();try{
  const data={trip:{id:'draft-trip'},jobIds:['j'],removed:[],stays:['a','b'].map(id=>({id,status:'detected',job_id:'j',crew_ids:['e'],crew_source:'snapshot',stay_from:'2026-10-21T08:00Z',stay_to:'2026-10-21T09:00Z',minutes_raw:60}))},jobs=[{id:'j',clients:{name:'Объект'}}],people=[{id:'e',role:'engineer',full_name:'Анна'}],root=win.document.body;
  const mount=()=>{root.innerHTML=presenceHTML(data,jobs,people,{workspace:true});return mountPresenceReview(root,data,{owner:'draft-user',profiles:people,initialMode:'all'});};
  let review=mount();review.select('a');const field=root.querySelector('[data-presence-id="a"] [data-presence=job_id]');field.value='';field.dispatchEvent(new win.Event('change',{bubbles:true}));
  review.select('b');const comment=root.querySelector('.journal-review-note');comment.value='Проверить место';comment.dispatchEvent(new win.Event('input',{bubbles:true}));review.markSaved();expect(review.isDirty()).toBe(true);review.destroy();
  review=mount();expect(review.isDirty()).toBe(true);expect(readPresenceForm(root,data.stays).find(s=>s.id==='a').job_id).toBe(null);review.discard();review.destroy();
  review=mount();expect(review.isDirty()).toBe(false);expect(readPresenceForm(root,data.stays).find(s=>s.id==='a').job_id).toBe('j');review.destroy();
 }finally{await win.happyDOM.close();}
});
it('restores an explicitly saved session draft without treating it as unsaved attendance',async()=>{const win=new Window();try{const stay={id:'draft-saved',status:'detected',job_id:'j',crew_ids:['e'],crew_source:'snapshot',stay_from:'2026-10-21T08:00Z',stay_to:'2026-10-21T09:00Z',minutes_raw:60},data={trip:{id:'saved-draft-trip'},jobIds:['j'],removed:[],stays:[stay]},root=win.document.body,jobs=[{id:'j',clients:{name:'Объект'}}],people=[{id:'e',role:'engineer',full_name:'Анна'}];const mount=()=>{root.innerHTML=presenceHTML(data,jobs,people,{workspace:true});return mountPresenceReview(root,data,{owner:'u',initialMode:'all'});};let review=mount();const note=root.querySelector('.journal-review-note');note.value='Проверить адрес';note.dispatchEvent(new win.Event('input',{bubbles:true}));root.querySelector('[data-review-draft]').click();expect(review.isDirty()).toBe(false);review.destroy();review=mount();expect(root.querySelector('.journal-review-note').value).toBe('Проверить адрес');expect(review.isDirty()).toBe(false);expect(stay.status).toBe('detected');review.destroy();}finally{await win.happyDOM.close();}});
