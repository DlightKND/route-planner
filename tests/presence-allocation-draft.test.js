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
