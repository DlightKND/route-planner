// Presentational only: callers provide the existing plan/presence/capacity totals.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1});
export function loadChartHTML(cells,{weekly=false}={}){
  const max=Math.max(1,...cells.map(c=>Math.max(c.v,c.f||0,c.cap)));
  const bars=cells.map(c=>{
    const over=c.v>c.cap+1e-6;
    const label=(c.periodLabel||c.key)+' · план '+num(c.v)+' ч · проверенное присутствие '+(c.known?num(c.f)+' чел.-ч':'не подтверждено')+' · фонд '+num(c.cap)+' ч';
    return '<div class="revbar'+(c.we?' we':'')+'" title="'+esc(label)+'"><div class="rb-c"><div class="rb-cap" style="height:'+Math.round(c.cap/max*100)+'%"></div><div class="rb-f data-fill vertical'+(over?' bad':'')+'" style="height:'+(c.v?Math.max(3,Math.round(c.v/max*100)):0)+'%"></div>'+(c.known&&c.f>0?'<div class="rb-fact data-fill vertical" style="height:'+(c.f?Math.max(3,Math.round(c.f/max*100)):0)+'%"></div>':'')+'</div><div class="rb-l">'+esc(c.label)+'</div></div>';
  }).join('');
  const rows=cells.map(c=>'<tr><th scope="row">'+esc(c.periodLabel||c.key)+'</th><td>'+num(c.v)+'</td><td>'+num(c.cap)+'</td><td>'+(c.known?num(c.f):'—')+'</td><td>'+(c.v>c.cap+1e-6?'Перегрузка':'В пределах фонда')+'</td></tr>').join('');
  return '<figure class="load-chart"><figcaption>Загрузка '+(weekly?'по неделям':'по дням')+'</figcaption><div class="load-chart-scroll"><div class="revbars loadbars novals" aria-hidden="true" style="--chart-count:'+cells.length+'">'+bars+'</div></div><div class="chart-legend"><span><i class="legend-plan"></i>План: работы и дорога, ч</span><span><i class="legend-presence"></i>Проверенное присутствие, чел.-ч</span><span><i class="legend-capacity"></i>Фонд команды, ч</span><span><i class="legend-over"></i>Перегрузка</span></div><p class="cap-note">Присутствие включает только подтверждённые записи; покрытие периода может быть неполным. Присутствие не означает выполнение работ. «—» — нет подтверждённых данных. Каждая отметка фонда рассчитана для своего '+(weekly?'периода':'дня')+'.</p><details class="chart-data"><summary>Данные '+(weekly?'по неделям':'по дням')+'</summary><div class="chart-table-scroll"><table><caption>План, фонд и проверенное присутствие выбранной команды</caption><thead><tr><th scope="col">Период</th><th scope="col">План, ч</th><th scope="col">Фонд, ч</th><th scope="col">Присутствие, чел.-ч</th><th scope="col">Загрузка</th></tr></thead><tbody>'+rows+'</tbody></table></div></details></figure>';
}
