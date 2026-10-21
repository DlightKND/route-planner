import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {presenceHTML,readPresenceForm} from '../src/trip-workbench.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const windows=[];afterEach(async()=>{await Promise.all(windows.splice(0).map(w=>w.happyDOM.close()));});
it('routes the legacy map and schedule entrypoints to the canonical journal, without another save handler',async()=>{
 const openJournalTrip=vi.fn(async()=>{});
 const body=app.slice(app.indexOf('async function openPresenceEditor('),app.indexOf('function renderTripReviewSummary('));
 await new Function('openJournalTrip','return ('+body+');')(openJournalTrip)('trip','stop');
 expect(openJournalTrip).toHaveBeenCalledWith('trip',{stopId:'stop'});
 expect(body).not.toContain('trip_presence_save');expect(body).not.toContain('dialog');
});
it('edits explicit task-hour shares only among tasks for the selected request',async()=>{
 const win=new Window();windows.push(win);const stay={id:'s1',job_id:'j1',status:'approved',crew_source:'manager',crew_ids:['e1'],minutes_mgr:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',task_allocations:[{order_id:'o1',share:.65},{order_id:'o2',share:.35}]};
 const data={trip:{id:'t1'},stays:[stay],jobIds:['j1'],removed:[]};const orders=[{id:'o1',number:1,title:'Ремонт',job_id:'j1'},{id:'o2',number:2,title:'Пуск',job_id:'j1'},{id:'o3',number:3,title:'Чужое задание',job_id:'j2'}];
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}],{editor:true,orders});
 const parsed=readPresenceForm(win.document,[stay]);expect(parsed[0].task_allocations).toEqual([{order_id:'o1',share:.65},{order_id:'o2',share:.35}]);expect(win.document.body.textContent).not.toContain('Чужое задание');
});

it('renders readonly presence as recorded values and statuses without suggesting approval or editing',()=>{
 const win=new Window();windows.push(win);
 const base={job_id:'j1',crew_ids:['e1','e2'],crew_source:'manager',stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z',minutes_raw:60};
 const stays=[{...base,id:'approved',status:'approved',minutes_mgr:30,task_allocations:[{order_id:'o1',share:1}]},{...base,id:'pending',status:'detected',crew_source:'snapshot',minutes_raw:20},{...base,id:'rejected',status:'rejected',minutes_mgr:0}];
 win.document.body.innerHTML=presenceHTML({trip:{id:'t1',fact_km:0},stays,jobIds:['j1'],removed:[]},[{id:'j1',clients:{name:'<Объект>'}}],[{id:'e1',role:'engineer',full_name:'Анна'},{id:'e2',role:'engineer',full_name:'Иван'}],{readonly:true,orders:[{id:'o1',number:7,title:'Работа <насос>',job_id:'j1'}]});
 expect(win.document.querySelectorAll('input,select,textarea,button:not(.qm)')).toHaveLength(0);
 const rows=win.document.querySelectorAll('tbody tr');
 expect(rows[0].querySelector('[data-label="Команда"]').textContent).toBe('Анна, Иван');
 expect(rows[0].querySelector('[data-label="Минуты на человека"]').textContent).toContain('30');
 expect(rows[0].querySelector('[data-label="Минуты на человека"]').textContent).toContain('1 чел.-ч');
 expect(rows[0].querySelector('[data-label="Проверка"]').textContent).toBe('Проверено · присутствие');
 expect(rows[1].querySelector('[data-label="Проверка"]').textContent).toBe('Ожидает проверки');
 expect(rows[1].querySelector('[data-label="Минуты на человека"]').textContent).toContain('20');
 expect(rows[2].querySelector('[data-label="Проверка"]').textContent).toBe('Не учитывается');
 expect(rows[2].querySelector('[data-label="Минуты на человека"]').textContent).toContain('0');
 expect(rows[0].querySelector('.wb-task-share').textContent).toContain('Работа <насос>');
 expect(rows[0].querySelector('.wb-task-share b').textContent).toBe('100%');
 expect(win.document.querySelector('насос')).toBeNull();
 expect(win.document.querySelector('#wbDetect')).toBeNull();expect(win.document.querySelector('#wbPresenceSave')).toBeNull();
});
it('preserves unknown confirmed minutes and crew instead of turning raw GPS data into accepted hours',()=>{
 const win=new Window();windows.push(win);
 const stays=[{id:'unknown',job_id:null,status:'approved',crew_ids:[],crew_source:'legacy_unverified',minutes_mgr:null,minutes_raw:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z'}];
 win.document.body.innerHTML=presenceHTML({trip:{id:'t1'},stays,jobIds:[],removed:[]},[],[],{readonly:true,editor:true});
 expect(win.document.querySelectorAll('input,select,button')).toHaveLength(0);
 const row=win.document.querySelector('tr[data-presence-id="unknown"]');
 expect(row.querySelector('[data-label="Объект / заявка"]').textContent).toBe('Не привязана');
 expect(row.querySelector('[data-label="Команда"]').textContent).toContain('Состав не подтверждён');
 const minutes=row.querySelector('[data-label="Минуты на человека"]');expect(minutes.firstChild.textContent.trim()).toBe('—');expect(minutes.querySelector('.hint').textContent).toContain('— чел.-ч');expect(minutes.textContent).not.toContain('60');
 expect(row.querySelector('[data-label="Интервал"]').textContent).toContain('GPS: 60 мин');
});
it('keeps the default manager editor and proposed approval available',()=>{
 const win=new Window();windows.push(win);
 const stay={id:'s1',job_id:'j1',status:'detected',crew_ids:['e1'],crew_source:'snapshot',minutes_raw:60,stay_from:'2026-09-22T08:00Z',stay_to:'2026-09-22T09:00Z'};
 const data={trip:{id:'t1'},stays:[stay],jobIds:['j1'],removed:[]};
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}],{editor:true});
 expect(win.document.querySelector('[data-presence="status"]').value).toBe('approved');
 expect(win.document.querySelector('[data-presence="minutes_mgr"]').value).toBe('60');
 win.document.body.innerHTML=presenceHTML(data,[{id:'j1',clients:{name:'Объект'}}],[{id:'e1',role:'engineer',full_name:'Анна'}]);
 expect(win.document.querySelector('[data-presence-edit]')).not.toBeNull();expect(win.document.querySelector('#wbDetect')).not.toBeNull();expect(win.document.querySelector('#wbPresenceSave')).not.toBeNull();
});

