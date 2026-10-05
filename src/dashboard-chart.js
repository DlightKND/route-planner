import { infoHint } from './info-hints.js';
// Presentation only: plan, capacity and verified presence are provided by the caller.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => Number(v).toLocaleString('ru-RU', {maximumFractionDigits:1});
function scaleMaximum(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return [1, 2, 5, 10].map(step => step * power).find(step => step >= value) || power * 10;
}
function periodText(cells) {
  if (!cells.length) return 'Нет данных за выбранный период';
  const first = cells[0], last = cells.at(-1);
  const start = first.from || first.key, end = last.to || last.key;
  return start === end ? start : start + ' — ' + end;
}
export function loadChartHTML(cells, {weekly = false, withDriving = false} = {}) {
  const max = scaleMaximum(Math.max(1, ...cells.map(c => Math.max(c.v, c.f || 0, c.cap))));
  const bars = cells.map(c => {
    const over = c.v > c.cap + 1e-6;
    const label = (c.periodLabel || c.key) + ' · план ' + num(c.v) + ' ч · проверенное присутствие ' + (c.known ? num(c.f) + ' чел.-ч' : 'не подтверждено') + ' · фонд ' + num(c.cap) + ' ч';
    const height = value => value > 0 ? Math.max(1, value / max * 100) : 0;
    return '<div class="revbar' + (c.we ? ' we' : '') + '" title="' + esc(label) + '"><div class="rb-c"><div class="rb-cap" style="height:' + c.cap / max * 100 + '%"></div><div class="rb-f data-fill vertical' + (over ? ' bad' : '') + '" style="height:' + height(c.v) + '%"></div>' + (c.known && c.f > 0 ? '<div class="rb-fact data-fill vertical" style="height:' + height(c.f) + '%"></div>' : '<div class="rb-presence-empty"></div>') + '</div><div class="rb-l">' + esc(c.label) + '</div></div>';
  }).join('');
  const rows = cells.map(c => '<tr><th scope="row">' + esc(c.periodLabel || c.key) + '</th><td>' + num(c.v) + '</td><td>' + num(c.cap) + '</td><td>' + (c.known ? num(c.f) : '—') + '</td><td>' + (c.v > c.cap + 1e-6 ? 'Перегрузка' : 'В пределах фонда') + '</td></tr>').join('');
  let html = '<figure class="load-chart"><figcaption>Загрузка ' + (weekly ? 'по неделям' : 'по дням') + '<span class="chart-period">' + esc(periodText(cells)) + '</span>' + infoHint('План и присутствие показаны соседними столбцами с общей числовой шкалой. Присутствие не означает выполнение работ. Присутствие включает только подтверждённые записи; покрытие периода может быть неполным. Фонд команды рассчитан отдельно для каждого дня или недели. «—» — нет подтверждённых данных. Точные значения доступны в таблице.', 'Как читать загрузку') + '</figcaption><div class="chart-axis-unit" aria-hidden="true">ч / чел.-ч</div><div class="chart-plot"><div class="chart-y-axis" aria-hidden="true"><span>' + num(max) + '</span><span>' + num(max / 2) + '</span><span>0</span></div><div class="load-chart-scroll"><div class="revbars loadbars novals" aria-hidden="true" style="--chart-count:' + cells.length + '">' + bars + '</div></div></div><div class="chart-legend"><span><i class="legend-plan"></i>План: работы и дорога, ч</span><span><i class="legend-presence"></i>Проверенное присутствие, чел.-ч</span><span><i class="legend-capacity"></i>Фонд команды, ч</span><span><i class="legend-over"></i>Перегрузка</span></div><details class="chart-data"><summary>Данные ' + (weekly ? 'по неделям' : 'по дням') + '</summary><p class="chart-table-hint">Все столбцы — прокрутка по горизонтали →</p><div class="chart-table-scroll" role="region" aria-label="Данные загрузки: таблица с горизонтальной прокруткой" tabindex="0"><table aria-label="План, фонд и проверенное присутствие выбранной команды"><thead><tr><th scope="col">Период</th><th scope="col">План, ч</th><th scope="col">Фонд, ч</th><th scope="col">Присутствие, чел.-ч</th><th scope="col">Загрузка</th></tr></thead><tbody>' + rows + '</tbody></table></div></details></figure>';
  if(withDriving)html=html.replaceAll('проверенное присутствие','занятость на объектах и в дороге').replaceAll('Проверенное присутствие','Занятость: объекты и дорога').replaceAll('Присутствие, чел.-ч','Занятость, чел.-ч').replace('Присутствие не означает выполнение работ.','Занятость не означает выполнение работ.').replace('Присутствие включает только подтверждённые записи; покрытие периода может быть неполным.','Факт включает проверенное присутствие и доступные измеренные интервалы дороги; при пропусках трека покрытие периода может быть неполным.').replace('План и присутствие','План и занятость');
  return html;
}
