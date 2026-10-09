import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {mountEntityActivity,loadEntityActivity} from '../src/entity-activity.js';

let win,root,rows,writes,db;
const user='00000000-0000-4000-8000-000000000003';
beforeEach(()=>{
  win=new Window();vi.stubGlobal('window',win);vi.stubGlobal('document',win.document);
  document.body.innerHTML='<section id="activity"></section>';root=document.getElementById('activity');
  rows={job_comments:[],job_history:[]};writes=[];
  db={from:table=>{const q={select:()=>q,eq:()=>q,not:()=>q,order:()=>q,limit:async()=>({data:rows[table]||[],error:null}),insert:async data=>{writes.push({table,data});rows[table].unshift({...data,id:'new',author_id:user,created_at:new Date().toISOString()});return {error:null};}};return q;},rpc:async()=>({data:[],error:null})};
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

it('preserves comment drafts across remounts and filters typed result events',async()=>{
  db.rpc=async()=>({data:[{id:'result-1',recorded_at:'2026-10-09T12:00:00Z',actual_date:'2026-10-08',actor_id:user,snapshot:{title:'Проверка оборудования',note:'Результат сохранён',items:[{title:'Диагностика',planned_qty:5,done_qty:3,unit:'ч'}]}}],error:null});
  rows.job_comments=[{id:'comment-1',author_id:user,created_at:'2026-10-09T11:00:00Z',body:'Обычный комментарий'}];
  const opts={root,db,entity:'job',id:'draft-job',userId:()=>user,people:()=>[{id:user,full_name:'Анна'}]};
  let mounted=mountEntityActivity(opts);await mounted.refresh();
  const input=root.querySelector('textarea');input.value='Неотправленный текст';input.dispatchEvent(new win.Event('input'));
  mounted=mountEntityActivity(opts);await mounted.refresh();
  expect(root.querySelector('textarea').value).toBe('Неотправленный текст');
  expect(root.textContent).toContain('08.10.2026');expect(root.textContent).toContain('3 / 5 ч');expect(root.textContent).toContain('Анна');
  root.querySelector('[data-activity-filter=comment]').click();
  expect(root.querySelector('.entity-activity-feed').textContent).toContain('Обычный комментарий');
  expect(root.querySelector('.entity-activity-feed').textContent).not.toContain('Результат сохранён');
  expect(writes).toEqual([]);mounted.destroy();
});

it('keeps a failed comment draft and refuses submission after account change',async()=>{
  let uid=user;db.from=()=>({select(){return this;},eq(){return this;},not(){return this;},order(){return this;},limit:async()=>({data:[],error:null}),insert:async()=>({error:new Error('Нет связи')})});
  const mounted=mountEntityActivity({root,db,entity:'job',id:'failed-job',userId:()=>uid});await mounted.refresh();
  const input=root.querySelector('textarea');input.value='Сохранить черновик';
  root.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));
  expect(input.value).toBe('Сохранить черновик');expect(root.textContent).toContain('Нет связи');
  uid='other-account';root.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));
  expect(root.textContent).toContain('Аккаунт изменился');expect(input.value).toBe('Сохранить черновик');mounted.destroy();
});
