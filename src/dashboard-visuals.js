const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = v => v == null || v === '' || !Number.isFinite(+v) ? null : +v;
const fmt = v => v == null ? '—' : v.toLocaleString('ru-RU', {maximumFractionDigits:1});

// Separate scales for mixed units; a shared zero axis for finance components.
export function comparisonChartHTML(rows, {label = 'План и факт', commonScale = false} = {}) {
  const all = rows.flatMap(r => [number(r.plan),number(r.fact)]).filter(v => v != null);
  return `<figure class="summary-chart" aria-label="${esc(label)}"><figcaption><span><i class="plan"></i>План</span><span><i class="fact"></i>Факт</span></figcaption>${rows.map(r => {
    const values = commonScale ? all : [number(r.plan),number(r.fact)].filter(v => v != null);
    const min = Math.min(0,...values), max = Math.max(r.unit === '%' ? 100 : 0,...values), span = max-min || 1;
    const zero = -min/span*100;
    const bar = (value,kind) => {
      value = number(value);
      const end = value == null ? zero : (value-min)/span*100;
      return `<div class="comparison-line"><div class="comparison-track"><b class="comparison-zero" style="left:${zero}%"></b>${value == null ? '' : `<i class="${kind}" style="left:${Math.min(zero,end)}%;width:${Math.abs(value)/span*100}%"></i>`}</div><span><span class="sr-only">${kind === 'plan' ? 'План' : 'Факт'}: </span>${fmt(value)}</span></div>`;
    };
    return `<div class="comparison-group"><div class="comparison-label">${esc(r.label)}<small>${esc(r.unit)}</small></div><div class="comparison-bars">${bar(r.plan,'plan')}${bar(r.fact,'fact')}<div class="comparison-scale"><span>${fmt(min)}</span><span>${fmt(max)}</span></div></div></div>`;
  }).join('')}<p class="summary-note">${commonScale ? 'Общая шкала для всех составляющих.' : 'У каждого показателя своя шкала.'} «—» — нет полного источника факта.</p></figure>`;
}
