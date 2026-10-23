import {journalIcon as icon} from './journal-icons.js';
import {presenceBounds} from './core/trip-presence-recovery.js';
import {decisionLabel,durationText,intervalText,personHours} from './core/journal-display.js';
import {decisionComment,numericText} from './core/gps-journal.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Render only canonical saved values, never the mutable form or a session draft.
export function savedPresenceHTML(stay,{jobs=[],profiles=[],taskTitle=()=> 'Задание',readonly=false}={}){
 const approved=stay.status==='approved',bounds=presenceBounds(stay),gps=bounds?.gps??stay.minutes_raw;
 const crew=[...new Set(stay.crew_ids||[])],known=!readonly||['snapshot','manager'].includes(stay.crew_source);
 const hours=approved?personHours(stay.minutes_mgr,crew,known):null;
 const extra=approved&&bounds&&stay.minutes_mgr!=null?Math.max(0,Number(stay.minutes_mgr)-bounds.gps):null;
 const zero=approved&&stay.minutes_mgr!=null&&Number(stay.minutes_mgr)===0;
 const job=jobs.find(j=>j.id===stay.job_id),allocations=stay.task_allocations||[];
 const share=allocations.reduce((sum,a)=>sum+Number(a.share||0),0);
 const actor=profiles.find(p=>p.id===stay.mgr_by)?.full_name||'Автор не указан';
 const time=stay.mgr_at?new Date(stay.mgr_at).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv'}):'';
 return `<header class="journal-saved-summary"><p class="journal-result-badge ${approved?(zero?'is-zero':'is-confirmed'):''}">${icon(approved?'check':'clock')}${approved?decisionLabel(stay,stay,false):'Присутствие не подтверждено'}</p>
 ${bounds?.gps===0?'<p class="journal-hypothesis">GPS не подтверждает присутствие. Место и время — предположение.</p>':''}
 ${approved?`<p class="journal-result-total">Учтено <strong>${hours==null?'не определено':numericText(hours)+' чел.-ч'}</strong></p>`:''}</header>
 <section class="journal-saved-body"><dl class="journal-result-evidence"><div><dt>${icon('lock')} По GPS · автомобиль</dt><dd>${durationText(gps)}</dd></div><div><dt>${icon('clock')} ${approved?'Принято дополнительно':'Восстановлено до'}</dt><dd>${approved?(extra==null?'Нет разложения':durationText(extra)):durationText(bounds?.extra??0)}</dd></div></dl>
 ${approved?`<p class="journal-time-equation">${bounds?`(GPS ${durationText(gps)} + принято ${durationText(extra)})`:durationText(stay.minutes_mgr)} × ${crew.length} чел. = ${hours==null?'не определено':numericText(hours)+' чел.-ч'}</p>`:'<p class="hint">Время не учтено в присутствии на объекте.</p>'}
 <p class="journal-decision-author">${approved||stay.mgr_at?'Решение: '+esc(actor)+(time?' · '+esc(time):''):'Подтверждённого решения нет.'}</p>${decisionComment(stay.note)?`<p class="journal-decision-comment">${esc(decisionComment(stay.note))}</p>`:''}
 <dl class="journal-result-links"><div><dt>${icon('file')} Заявка${job?.number?' №'+esc(job.number):' и объект'}</dt><dd>${esc(job?.clients?.name||'Заявка не указана')}</dd></div><div><dt>${icon('crew')} Команда · ${crew.length}</dt><dd>${esc(crew.map(id=>profiles.find(p=>p.id===id)?.full_name||'Инженер').join(', ')||'Состав не указан')}</dd></div></dl>
 ${approved?`<h3>Задания</h3><ul class="journal-result-tasks">${allocations.map(a=>`<li><span>${esc(taskTitle(a.order_id))}</span><b>${numericText(a.share*100)}% времени${hours==null?'':' · '+numericText(hours*a.share)+' чел.-ч'}</b><span class="journal-share-bar"><i style="width:${Math.min(100,Math.max(0,a.share*100))}%"></i></span></li>`).join('')||'<li>Задания не выбраны</li>'}</ul><p class="hint">Не распределено: ${numericText(Math.max(0,1-share)*100)}%${hours==null?'':' · '+numericText(hours*Math.max(0,1-share))+' чел.-ч'}</p>`:''}
 <details class="journal-saved-help"><summary>Данные присутствия</summary><p class="hint">Присутствие не подтверждает выполнение задания. Интервал: ${esc(intervalText(stay.stay_from,stay.stay_to))}.</p></details></section>`;
}
