// Редактор плана ТО модели техники (26.11.2026): уровни ТО по моточасам,
// необязательный календарный срок, работы из справочника и материалы.
import { openEntityPanel } from './entity-actions.js';
import { attachStockPicker } from './stock-picker.js';

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

// Сводка плана одной строкой: «ТО-1 · 250 · ТО-2 · 500 мч».
export function planSummary(levels, model) {
  if (levels?.length) return levels.map(l => l.name + ' · ' + Number(l.interval_hours)).join(' / ') + ' мч';
  return +model?.service_interval_hours > 0 ? 'каждые ' + Number(model.service_interval_hours) + ' мч' : '';
}

// Проверка и нормализация строк редактора; ошибка — текст для человека.
export function normalizeLevels(rows) {
  const out = [];
  for (const [i, r] of rows.entries()) {
    const name = String(r.name || '').trim(), hours = num(r.interval_hours), months = String(r.interval_months ?? '').trim() === '' ? null : num(r.interval_months);
    const where = 'Строка ' + (i + 1) + ': ';
    if (!name) return { error: where + 'укажите название уровня.' };
    if (!(hours > 0)) return { error: where + 'интервал в моточасах — число больше нуля.' };
    if (months !== null && !(Number.isInteger(months) && months >= 1 && months <= 120)) return { error: where + 'срок в месяцах — целое число от 1 до 120.' };
    if (out.some(x => x.interval_hours === hours)) return { error: where + 'уровень с интервалом ' + hours + ' мч уже есть.' };
    const materials = (r.materials || []).map(m => ({ ...m, name: String(m.name || '').trim(), qty: num(m.qty) })).filter(m => m.name);
    const bad = materials.find(m => !(m.qty > 0));
    if (bad) return { error: where + 'количество «' + bad.name + '» — число больше нуля.' };
    out.push({ id: r.id || null, name, interval_hours: hours, interval_months: months, works: (r.works || []).map(w => ({ work_id: w.work_id, name: w.name })), materials: materials.map(m => ({ stock_id: m.stock_id || null, name: m.name, unit: m.unit || '', qty: m.qty })), notes: String(r.notes || '').trim() || null });
  }
  return { levels: out.sort((a, b) => a.interval_hours - b.interval_hours) };
}

export function createMaintenancePlanEditor(ctx) {
  const { esc } = ctx;
  let rows = [];

  function rowHTML(r, i) {
    const works = ctx.works();
    return `<fieldset class="mp-level" data-mp-row="${i}"><legend>${esc(r.name || 'Новый уровень')}</legend>
     <div class="mp-grid"><label>Название<input data-mp="name" maxlength="60" value="${esc(r.name || '')}" placeholder="ТО-1"></label>
      <label>Каждые, моточасов<input data-mp="interval_hours" type="number" inputmode="decimal" min="1" value="${esc(r.interval_hours ?? '')}" placeholder="250"></label>
      <label>Или раз в, месяцев<input data-mp="interval_months" type="number" inputmode="numeric" min="1" max="120" value="${esc(r.interval_months ?? '')}" placeholder="не задано"></label></div>
     <div class="mp-part"><span class="mp-caption">Работы</span><ul class="mp-chips">${(r.works || []).map((w, k) => `<li>${esc(works.find(x => x.id === w.work_id)?.name || w.name || 'Работа')}<button type="button" class="btn ghost" data-mp-work-del="${k}" aria-label="Убрать работу ${esc(w.name || '')}">×</button></li>`).join('')}</ul>
      <label class="mp-add"><span class="sr-only">Добавить работу</span><select data-mp-work-add><option value="">+ работа из справочника…</option>${works.filter(w => !(r.works || []).some(x => x.work_id === w.id)).map(w => `<option value="${esc(w.id)}">${esc(w.name)}${w.is_maintenance ? ' · ТО' : ''}</option>`).join('')}</select></label></div>
     <div class="mp-part"><span class="mp-caption">Материалы</span><ul class="mp-materials">${(r.materials || []).map((m, k) => `<li><span>${esc(m.name)}</span><label><span class="sr-only">Количество ${esc(m.name)}</span><input data-mp-qty="${k}" type="number" inputmode="decimal" min="0" step="any" value="${esc(m.qty ?? 1)}"></label><span class="hint">${esc(m.unit || '')}</span><button type="button" class="btn ghost" data-mp-mat-del="${k}" aria-label="Убрать ${esc(m.name)}">×</button></li>`).join('')}</ul>
      <label class="mp-add"><span class="sr-only">Добавить материал</span><input data-mp-mat-add placeholder="+ материал: название или артикул"></label></div>
     <div class="mp-row-foot"><button type="button" class="btn ghost mp-remove" data-mp-remove>Удалить уровень</button></div></fieldset>`;
  }
  function paint(panel) {
    panel.querySelector('.mp-levels').innerHTML = rows.length ? rows.map(rowHTML).join('') : '<p class="hint">Уровней пока нет. Без плана ТО считается по базовому интервалу модели.</p>';
    panel.querySelectorAll('[data-mp-row]').forEach(box => {
      const i = Number(box.dataset.mpRow), r = rows[i];
      box.querySelectorAll('[data-mp]').forEach(input => input.addEventListener('input', () => { r[input.dataset.mp] = input.value; if (input.dataset.mp === 'name') box.querySelector('legend').textContent = input.value || 'Новый уровень'; }));
      box.querySelector('[data-mp-work-add]').onchange = e => { const w = ctx.works().find(x => x.id === e.target.value); if (!w) return; r.works = [...(r.works || []), { work_id: w.id, name: w.name }]; paint(panel); };
      box.querySelectorAll('[data-mp-work-del]').forEach(b => b.onclick = () => { r.works.splice(Number(b.dataset.mpWorkDel), 1); paint(panel); });
      box.querySelectorAll('[data-mp-qty]').forEach(input => input.addEventListener('input', () => { r.materials[Number(input.dataset.mpQty)].qty = input.value; }));
      box.querySelectorAll('[data-mp-mat-del]').forEach(b => b.onclick = () => { r.materials.splice(Number(b.dataset.mpMatDel), 1); paint(panel); });
      const add = box.querySelector('[data-mp-mat-add]');
      attachStockPicker(add, { items: () => ctx.stock().filter(s => s.active !== false), esc, onPick: item => { r.materials = [...(r.materials || []), { stock_id: item.id, name: item.name, unit: item.unit || '', qty: 1 }]; paint(panel); } });
      box.querySelector('[data-mp-remove]').onclick = () => { rows.splice(i, 1); paint(panel); };
    });
  }

  async function open(model, trigger) {
    if (!model) return;
    rows = JSON.parse(JSON.stringify(ctx.levels(model.id) || [])).map(l => ({ ...l, works: l.works || [], materials: l.materials || [] }));
    const panel = document.createElement('section');
    panel.className = 'mp-editor';
    panel.innerHTML = `<p class="hint">Отметки считаются от нуля счётчика: на отметке делается старший уровень, интервал которого её делит (на 1000 мч — ТО-3, а не ТО-1). Календарный срок — если ТО нужно и при малой наработке; считается то, что наступит раньше.</p>
     <div class="mp-levels"></div><button type="button" class="btn" data-mp-new>+ Уровень ТО</button><p class="err" data-mp-error role="alert"></p>`;
    document.body.append(panel);
    paint(panel);
    panel.querySelector('[data-mp-new]').onclick = () => { const top = rows.reduce((m, r) => Math.max(m, num(r.interval_hours) || 0), 0); rows.push({ name: 'ТО-' + (rows.length + 1), interval_hours: top ? top * 2 : '', interval_months: '', works: [], materials: [] }); paint(panel); panel.querySelector('[data-mp-row]:last-of-type [data-mp="interval_hours"]')?.focus(); };
    return openEntityPanel({ title: 'План ТО · ' + ctx.label(model), panel, trigger, dispose: true, saveLabel: 'Сохранить план', saveHint: 'Следующее ТО техники этой модели пересчитается сразу.',
      confirmDiscard: () => ctx.confirm('Закрыть без сохранения плана ТО?', { okText: 'Закрыть', cancelText: 'Продолжить' }),
      onSave: async () => {
        const res = normalizeLevels(rows);
        if (res.error) { panel.querySelector('[data-mp-error]').textContent = res.error; throw Error(res.error); }
        await ctx.save(model.id, res.levels);
        return true;
      },
      onSaved: () => ctx.saved(model) });
  }
  return { open };
}
