import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {mountEntityActivity,loadEntityActivity} from '../src/entity-activity.js';

let win,root,rows,writes,db;
const user='00000000-0000-4000-8000-000000000003';
beforeEach(()=>{
  win=new Window();vi.stubGlobal('window',win);vi.stubGlobal('document',win.document);
  document.body.innerHTML='<section id="activity"></section>';root=document.getElementById('activity');
  rows={job_comments:[],job_history:[]};writes=[];
  db={from:table=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:rows[table]||[],error:null})})})}),insert:async data=>{writes.push({table,data});rows[table].unshift({...data,id:'new',author_id:user,created_at:new Date().toISOString()});return {error:null};}})};
});
afterEach(async()=>{await win.happyDOM.close();vi.unstubAllGlobals();});

it('renders request history with escaped comments and posts to the owning entity',async()=>{
  rows.job_history=[{id:'h1',event:'Статус изменён',recorded_at:'2026-09-23T10:00:00Z',actor_id:user}];
  mountEntityActivity({root,db,entity:'job',id:'job-1',userId:()=>user,people:()=>[{id:user,full_name:'Анна'}]});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(root.textContent).toContain('Статус изменён');
  const input=root.querySelector('textarea');input.value='<script>alert(1)</script>';
  root.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({table:'job_comments',data:{job_id:'job-1',body:'<script>alert(1)</script>',author_id:user}});
  expect(root.querySelector('.activity-entry.is-comment').innerHTML).not.toContain('<script>');
  expect(root.textContent).toContain('<script>alert(1)</script>');
});

it('shows archived shadow-task events in trip history with their source labelled',async()=>{
  rows.trip_comments=[];
  rows.trip_revision_history=[{id:1,reason:'Изменён маршрут',recorded_at:'2026-09-23T11:00:00Z'}];
  rows.trip_legacy_task_events=[{source_history_id:2,reason:'Изменён <план> задания',recorded_at:'2026-09-23T10:00:00Z'}];
  const html=await loadEntityActivity(db,'trip','trip-1');
  expect(html).toContain('Архив задания по выезду · Изменён &lt;план&gt; задания');
  expect(html.indexOf('Изменён маршрут')).toBeLessThan(html.indexOf('Архив задания'));
  expect(html).not.toContain('<план>');
});
