import { presenceSummary } from './core/trip-review.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = v => v == null ? '—' : (+v).toLocaleString('ru-RU',{maximumFractionDigits:2});
const time = v => v ? new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Kyiv'}) : '—';

export function presenceHTML(data, jobs, profiles) {
  const summary = presenceSummary(data.stays), t = data.trip;
  const jobName = id => jobs.find(j=>j.id===id)?.clients?.name || data.removed.find(j=>j.job_id===id)?.snapshot?.client_name || 'Заявка '+String(id).slice(0,8);
  const candidateJobs = [...jobs.filter(j => data.jobIds.includes(j.id)).map(j=>({id:j.id,name:jobName(j.id)})),
    ...data.removed.map(j=>({id:j.job_id,name:jobName(j.job_id)+' · исключена из плана'}))];
  const rows = data.stays.map(s => {
    const crew = s.crew_ids || [];
    const mins = s.minutes_mgr ?? s.minutes_raw;
    const hrs = mins != null && crew.length ? mins*crew.length/60 : null;
    const suggested=s.status==='detected'&&s.job_id&&s.stay_to&&crew.length&&s.crew_source==='snapshot';
    return `<tr data-presence-id="${esc(s.id)}"><td data-label="Интервал">${time(s.stay_from)}<br>${time(s.stay_to)}<div class="hint">GPS: ${n(s.minutes_raw)} мин</div></td>
      <td data-label="Объект / заявка"><select data-presence="job_id" aria-label="Заявка стоянки"><option value="">Не привязана</option>${candidateJobs.map(j=>`<option value="${esc(j.id)}" ${j.id===s.job_id?'selected':''}>${esc(j.name)}</option>`).join('')}</select></td>
      <td data-label="Команда"><select data-presence="crew_ids" multiple aria-label="Присутствовавшие инженеры">${profiles.filter(p=>p.role==='engineer'||crew.includes(p.id)).map(p=>`<option value="${esc(p.id)}" ${crew.includes(p.id)?'selected':''}>${esc(p.full_name||'Инженер')}</option>`).join('')}</select>${s.crew_source==='legacy_unverified'?'<div class="hint">Исторический состав не подтверждён</div>':''}</td>
      <td data-label="Минуты на человека"><input data-presence="minutes_mgr" aria-label="Минуты присутствия" type="number" min="0" step="1" value="${esc(mins??'')}"><div class="hint">${n(hrs)} чел.-ч</div></td>
      <td data-label="Проверка"><select data-presence="status" aria-label="Результат проверки"><option value="" ${!suggested&&!['approved','rejected'].includes(s.status)?'selected':''}>Проверить позже</option><option value="approved" ${suggested||s.status==='approved'?'selected':''}>${suggested?'Присутствие · предложено':'Присутствие'}</option><option value="rejected" ${s.status==='rejected'?'selected':''}>Не учитывать</option></select></td></tr>`;
  }).join('');
  return `<div class="wb-metrics"><div><span>Присутствие · проверено</span><b>${n(summary.approved)} чел.-ч</b></div><div><span>Стоянки на проверке</span><b>${summary.pending}</b></div><div><span>Факт-пробег</span><b>${n(t.fact_km)} км</b></div></div>
    <p class="hint">Всё время на объекте × присутствовавшие инженеры. Ожидание включено. Нормочасы работ не изменяются. Время указано по Киеву.</p>
    ${rows?`<div class="wb-table-scroll"><table class="wb-table"><thead><tr><th>Интервал</th><th>Объект / заявка</th><th>Команда</th><th>Минуты на человека</th><th>Проверка</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="hint">Стоянок пока нет. Отсутствие данных не означает нулевое присутствие.</p>'}
    <div class="row"><button type="button" class="btn" id="wbDetect">Обновить стоянки по треку</button>${rows?'<button type="button" class="btn amber" id="wbPresenceSave">Сохранить проверку присутствия</button>':''}</div>
    <div class="hint" id="wbPresenceMessage" role="status"></div>`;
}

export function historyHTML(data, profiles = []) {
  const baseline = data.trip.plan_baseline;
  const grouped=new Map();
  for(const h of data.history){
    const key=JSON.stringify([h.recorded_at,h.actor_id,h.reason]);
    const previous=grouped.get(key);
    if(!previous)grouped.set(key,{...h});
    else {previous.revision=Math.min(previous.revision,h.revision);if(h.snapshot.stays||!previous.snapshot.stays)previous.snapshot=h.snapshot;}
  }
  return `<h3>История выезда</h3><p class="hint">${baseline ? (baseline.source==='legacy_at_first_edit'?'Для старого выезда сохранён план на момент первого изменения. Первоначальный план неизвестен.':'Сохранена исходная версия плана.') : 'Исходная версия будет сохранена при первом изменении.'}</p>`+
    (grouped.size?[...grouped.values()].map(h=>`<details class="wb-history"><summary>${time(h.recorded_at)} · ${esc(h.reason)} <span class="hint">${esc(h.actor_id?(profiles.find(p=>p.id===h.actor_id)?.full_name||'Менеджер'):'Автоматически')} · версия ${h.revision}</span></summary>
      ${h.snapshot.stays?`<p>Сохранено предыдущее состояние ${h.snapshot.stays.length} стоянок.</p>`:`<p>План: ${n(h.snapshot.econ_snapshot?.km)} км · ${(h.snapshot.job_ids||[]).length} заявок · ${esc(h.snapshot.date_from||'дата не задана')}</p><p>${esc((h.snapshot.route_stops||[]).map(s=>s.name).filter(Boolean).join(' → '))}</p>`}</details>`).join(''):'<p class="hint">Изменений пока нет.</p>');
}

export function removedHTML(data,jobs) {
  if (!data.removed.length) return '';
  return `<details class="wb-history"><summary>Исключены из плана · ${data.removed.length}</summary><p class="hint">Посещения и трек сохранены. Исключение из выезда не отменяет саму заявку.</p>${data.removed.map(h=>`<p>${esc(jobs.find(j=>j.id===h.job_id)?.clients?.name||h.snapshot.client_name||('Заявка '+h.job_id.slice(0,8)))} · ${time(h.removed_at)}</p>`).join('')}</details>`;
}

export function readPresenceForm(root, originals) {
  return [...root.querySelectorAll('[data-presence-id]')].map(row => {
    const s = originals.find(x=>x.id===row.dataset.presenceId);
    const get = key => row.querySelector(`[data-presence="${key}"]`);
    return {...s,job_id:get('job_id').value||null,minutes_mgr:get('minutes_mgr').value===''?null:Number(get('minutes_mgr').value),
      crew_ids:[...get('crew_ids').selectedOptions].map(o=>o.value),status:get('status').value};
  });
}
