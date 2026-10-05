import { comparisonChartHTML } from './dashboard-visuals.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, digits = 1) => v == null ? '—' : Number(v).toLocaleString('ru-RU', {maximumFractionDigits: digits});
function row(name, plan, fact, unit = '', emphasis = false) {
  const delta = plan > 0 && fact != null ? (fact-plan)/plan*100 : null;
  return `<tr${emphasis?' class="summary-total"':''}><th scope="row">${esc(name)}${unit?`<small>${esc(unit)}</small>`:''}</th><td>${fmt(plan)}</td><td class="summary-fact">${fmt(fact)}</td><td class="summary-delta">${delta == null?'—':`${delta>0?'+':''}${fmt(delta)}%`}</td></tr>`;
}
function table(rows, label) {
  return `<table class="summary-table" aria-label="${esc(label)}"><thead><tr><th scope="col">Показатель</th><th scope="col">План</th><th scope="col">Факт</th><th scope="col">Δ</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const kpi = (label, value, unit, note) => `<div class="summary-kpi"><dt>${esc(label)}</dt><dd>${fmt(value)}${value == null?'':` <small>${esc(unit)}</small>`}</dd><div>${esc(note)}</div></div>`;

export function dashboardSummaryHTML(metrics, load, {currency = 'грн', mode = 'charts'} = {}) {
  const m=metrics, p=m.financePlan, f=m.financeFact;
  const operations = row('Выполненные работы',m.normPlan,m.normFact,'нормо-ч')
    +row('Присутствие на объектах',m.presencePlan,m.presenceFact,'чел.-ч')
    +row('Пробег',m.kmPlan,m.kmFact,'км')
    +row('Загрузка с дорогой',load.planPercent,load.factPercent,'% рабочего фонда');
  const revenue = row('Работы',p.work,f.work,currency)+row('Дорога и суточные',p.road,f.road,currency)+row('Запчасти',p.parts,f.parts,currency)
    +((Math.abs(p.revenueAdjustment || 0)>0.01||Math.abs(f.revenueAdjustment || 0)>0.01)?row('Корректировка выручки',p.revenueAdjustment,f.revenueAdjustment,currency):'')
    +row('Выручка',p.revenue,f.revenue,currency,true)+row('Себестоимость',p.cost,f.cost,currency)+row('Прибыль',p.profit,f.profit,currency,true)+row('Маржа',p.margin,f.margin,'%');
  const costs = row('Работы · труд',p.labor,f.labor,currency)+row('Дорога, суточные, ночлег',p.travelCost,f.travelCost,currency)+row('Запчасти',p.partsCost,f.partsCost,currency)
    +((Math.abs(p.costAdjustment || 0)>0.01||Math.abs(f.costAdjustment || 0)>0.01)?row('Корректировка затрат',p.costAdjustment,f.costAdjustment,currency):'');
  const chart = (rows,label,commonScale=false) => comparisonChartHTML(rows,{label,commonScale});
  const panel = (kind,html) => `<div data-summary-mode="${kind}"${mode===kind?'':' hidden'}>${html}</div>`;
  const workChart = chart([{label:'Выполненные работы',unit:'нормо-ч',plan:m.normPlan,fact:m.normFact},{label:'Присутствие на объектах',unit:'чел.-ч',plan:m.presencePlan,fact:m.presenceFact},{label:'Пробег',unit:'км',plan:m.kmPlan,fact:m.kmFact},{label:'Загрузка с дорогой',unit:'%',plan:load.planPercent,fact:load.factPercent}],'План и факт работ, пробега и загрузки');
  const financeChart = chart([{label:'Работы',unit:currency,plan:p.work,fact:f.work},{label:'Дорога и суточные',unit:currency,plan:p.road,fact:f.road},{label:'Запчасти',unit:currency,plan:p.parts,fact:f.parts}],'План и факт выручки по составляющим',true);
  return `<section class="card summary-section" data-dcard="work"><header><span class="summary-step">01</span><h3>План–факт</h3></header>
    ${panel('charts',workChart)}${panel('tables',table(operations,'План и факт работ, пробега и загрузки'))}
    <p class="summary-note">Принято ${m.accepted} из ${m.tasks} заданий · подтверждено ${m.completed} из ${m.trips} выездов. Присутствие — ${m.hoursKnown}/${m.completed}, пробег — ${m.kmKnown}/${m.completed}.</p>
    <details class="summary-details"><summary>Как читать показатели</summary><p>Работы — нормочасы принятых заданий, присутствие — проверенное время команды на объектах. Загрузка — работы и дорога / рабочий фонд выбранных инженеров. План берётся из сохранённых снимков выездов; нормочасы распределяются поровну между плановыми участниками, дорога считается для каждого. В факте используются проверенное присутствие и измеренные GPS-интервалы без достроек; экипаж берётся из согласованных стоянок. При пропусках трека, изменении состава экипажа или пересечении движения со стоянками процент факта не рассчитывается. «—» означает, что полного источника факта пока нет.</p><p>Выезды сгруппированы по дате начала; задания на объектах — по связи с этими выездами, задания в депо и удалённые — по дате начала. Факт отражает текущее подтверждённое состояние, а не исторический снимок на конец периода.</p></details>
    </section>
    <section class="card summary-section" data-dcard="fin"><header><span class="summary-step">02</span><h3>Финансы</h3><span class="summary-unit">${esc(currency)}</span></header>
    <div class="finance-scope-summary">подтверждено ${m.financeKnown} из ${m.trips} выездов · договорная выручка и подтверждённые затраты</div>
    ${panel('charts',financeChart+table(row('Выручка',p.revenue,f.revenue,currency,true)+row('Себестоимость',p.cost,f.cost,currency)+row('Прибыль',p.profit,f.profit,currency,true)+row('Маржа',p.margin,f.margin,'%'),'Итоги финансов'))}${panel('tables',table(revenue,'План и факт финансов по работам, дороге и запчастям'))}
    <details class="summary-details"><summary>Себестоимость по составляющим</summary>${table(costs,'Разбивка себестоимости')}<p>План — все выезды периода; факт — выезды с подтверждённой экономикой. Выручка берётся из согласованного снимка выезда. Неизвестные компоненты старых снимков не подменяются нулём.</p></details>
    ${m.financeKnown<m.trips?'<button type="button" class="btn sm ghost summary-review" data-review-trips>Выезды для проверки</button>':''}
    </section>
    <section class="card summary-section" data-dcard="load"><header><span class="summary-step">03</span><h3>Выездная работа</h3></header>
    <dl class="summary-kpis">${kpi('Км на нормочас',m.distancePerNorm,'км/нормо-ч','Пробег подтверждённых выездов / принятый объём работ')}${kpi('Средний выезд',m.averageTripKm,'км','Суммарный факт-пробег / подтверждённые выезды')}${kpi('Средняя скорость GPS',m.speed,'км/ч',`Измеренные участки ${m.motionTrips} выездов; без достроек`)}${kpi('Гарантийность',m.warrantyPct,'%','Гарантийные нормочасы / принятые нормочасы')}</dl>
    <details class="summary-details summary-load-details"><summary>Загрузка по инженерам и дням</summary><p class="summary-note">Фонд: ${fmt(load.fund)} чел.-ч. План с дорогой: ${fmt(load.totalPlan)} чел.-ч (${fmt(load.totalPlanPercent)}%). Факт на графике — проверенное присутствие и доступные измерения дороги; полная дорога: ${load.roadKnown} выездов, неполная: ${load.roadUnknown}. Отсутствует полное время присутствия: ${load.presenceUnknown || 0} выездов; нет источника времени для ${load.nonFieldUnknown || 0} невыездных заданий; неполных снимков плана: ${load.planUnknown || 0}. По дням план раскладывается по сохранённому началу и рабочим окнам команды.</p>${load.body}${load.chart}</details>
    </section>`;
}
