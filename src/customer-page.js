// Страница клиента (26.11.2026): клиент — организация, у неё точки, на точках
// техника, по технике заявки. Всё это — вкладки одной страницы, как у
// заявки, задания и выезда: шапка с действиями, обзор со статистикой,
// точки, техника с планом ТО, заявки и реквизиты.
import { journalIcon } from './journal-icons.js';
import { metadataList, metaDate, requestLabel } from './workflow-meta.js';
import { createEntityTabs } from './entity-tabs.js';
import { mountEntityActions } from './entity-actions.js';

export const NO_CUSTOMER = 'none';
const OPEN = new Set(['open', 'planned', 'in_progress']);
const JOB_STATUS = { open: 'открыта', planned: 'запланирована', in_progress: 'в работе', done: 'закрыта', cancelled: 'отменена' };
const PERIODS = [['quarter', 'Квартал', 91], ['year', '12 месяцев', 365], ['all', 'Всё время', null]];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const HOUR_UNITS = new Set(['ч', 'час', 'часа', 'часов', 'год', 'година', 'години', 'годин', 'h', 'hr', 'hour', 'hours']);
const num = v => { const n = Number(v); return Number.isFinite(n) ? String(Math.round(n * 10) / 10).replace('.', ',') : '—'; };
const money = v => Math.round(Number(v) || 0).toLocaleString('ru-RU');

// Чистые расчёты страницы — отдельно, чтобы их можно было проверить тестом.
export function customerSummary({ jobs = [], orders = [], visits = [], equipment = [], forecast = () => null, period = 'year', today }) {
  const now = today || new Date().toISOString().slice(0, 10);
  const days = PERIODS.find(p => p[0] === period)?.[2] ?? null;
  const from = days ? new Date(Date.parse(now + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10) : '';
  const inPeriod = d => !from || String(d || '').slice(0, 10) >= from;
  const scoped = jobs.filter(j => inPeriod(j.created_at));
  const ids = new Set(scoped.map(j => j.id));
  const seen = visits.filter(v => ids.has(v.job_id) && v.started_at).map(v => v.started_at).sort();
  const items = orders.filter(o => ids.has(o.job_id)).flatMap(o => o.service_order_items || []).filter(i => !i.request_finance_void_event_id);
  const done = i => Number(i.done_qty) > 0 ? Number(i.done_qty) : 0;
  const hours = items.filter(i => i.kind !== 'material' && HOUR_UNITS.has(String(i.unit || '').trim().toLowerCase())).reduce((s, i) => s + done(i), 0);
  const tally = (rows, key, amount) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!k) continue; const x = m.get(k) || { label: k, n: 0, unit: r.unit || '' }; x.n += amount(r); m.set(k, x); } return [...m.values()].filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'ru')); };
  const eqName = id => { const e = equipment.find(x => x.id === id); return e ? (e.model || 'Техника') + (e.serial ? ' № ' + e.serial : '') : null; };
  const months = [];
  const end = new Date(now + 'T12:00:00Z');
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)); months.push({ key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()], n: 0 }); }
  for (const j of jobs) { const m = months.find(x => x.key === String(j.created_at || '').slice(0, 7)); if (m) m.n++; }
  const plans = equipment.map(e => ({ e, f: forecast(e) }));
  return {
    jobs: scoped.length, open: jobs.filter(j => OPEN.has(j.status)).length,
    visits: seen.length, lastVisit: seen.at(-1) || null, hours,
    overdue: plans.filter(p => p.f?.state === 'overdue').length, soon: plans.filter(p => p.f?.state === 'soon').length,
    months, breakdowns: tally(scoped, j => eqName(j.equipment_id), () => 1).slice(0, 5),
    parts: tally(items.filter(i => i.kind === 'material'), i => String(i.title || '').trim(), i => done(i) || Number(i.planned_qty) || 0).slice(0, 5),
    openJobs: jobs.filter(j => OPEN.has(j.status)).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
  };
}
export function serviceLabel(f) {
  if (!f) return { text: 'нет интервала', state: 'unknown' };
  if (f.days < 0) return { text: 'просрочено ' + (-f.days) + ' дн', state: 'overdue' };
  if (f.days === 0) return { text: 'сегодня', state: 'soon' };
  return { text: metaDate(f.dueDate) + (f.state === 'soon' ? ' · через ' + f.days + ' дн' : ''), state: f.state };
}

export function createCustomerPage(ctx) {
  const { esc, $ } = ctx;
  const sb = { from: t => ctx.db().from(t) };
  let current = null, tabs = null, period = 'year', data = { jobs: [], orders: [], visits: [] }, loading = false, loadError = null, token = 0, formDirty = false;

  const host = () => $('customerPage');
  const points = () => (ctx.points() || []).filter(p => !p.is_base && !p.deleted_at && (current?.id === NO_CUSTOMER ? !p.customer_id : p.customer_id === current?.id));
  const equipment = () => { const ids = new Set(points().map(p => p.id)); return Object.values(ctx.eqByPoint() || {}).flat().filter(e => !e.deleted_at && ids.has(e.client_id)); };
  const pointName = id => (ctx.points() || []).find(p => p.id === id)?.name || '—';
  const eqLabel = e => (e.model || 'Техника') + (e.serial ? ' · № ' + e.serial : '');
  const may = () => ctx.canWrite() && current?.id !== NO_CUSTOMER;

  async function open(id, { pane } = {}) {
    if (!await leave()) return false;
    let customer = null;
    if (id === NO_CUSTOMER) customer = { id: NO_CUSTOMER, name: 'Точки без клиента' };
    else {
      try { await ctx.ensureCustomers(); } catch (e) { ctx.notify('Клиенты недоступны: ' + (e.message || e), 'err'); return false; }
      customer = ctx.customers().find(c => c.id === id) || null;
    }
    if (!customer) { ctx.notify('Клиент не найден.', 'warn'); ctx.goCatalog(); return false; }
    const same = current?.id === customer.id;
    current = customer; formDirty = false;
    if (!same) { data = { jobs: [], orders: [], visits: [] }; loadError = null; }
    render(pane || (same ? tabs?.value : null) || 'overview');
    await ctx.show();
    void load();
    return true;
  }

  async function load() {
    const ticket = ++token, ids = points().map(p => p.id);
    loading = true; paintData();
    try {
      let jobs = [];
      if (ids.length) {
        const r = await sb.from('jobs').select('id,number,status,client_id,equipment_id,due_date,created_at,scheduled_date,notes').in('client_id', ids).is('deleted_at', null).order('created_at', { ascending: false });
        if (r.error) throw r.error; jobs = r.data || [];
      }
      const jobIds = jobs.map(j => j.id);
      const [orders, visits] = jobIds.length ? await Promise.all([
        sb.from('service_orders').select('id,number,status,date_from,date_to,job_id,service_order_items(kind,title,unit,planned_qty,done_qty,request_finance_void_event_id)').in('job_id', jobIds),
        sb.from('job_visits').select('job_id,started_at').in('job_id', jobIds)
      ]) : [{ data: [] }, { data: [] }];
      if (orders.error) throw orders.error;
      if (ticket !== token) return;
      data = { jobs, orders: orders.data || [], visits: visits.error ? [] : visits.data || [] }; loadError = null;
    } catch (e) { if (ticket !== token) return; loadError = e; }
    loading = false; paintData();
  }

  function summary() { return customerSummary({ ...data, equipment: equipment(), forecast: ctx.forecast, period }); }

  function render(pane) {
    tabs?.destroy(); tabs = null;
    const c = current, real = c.id !== NO_CUSTOMER, tel = real && c.phone ? ctx.telHref(c.phone) : '';
    const pts = points(), eqs = equipment();
    const facts = real ? [c.tax_id && ['ЕДРПОУ', c.tax_id], ['Контакт', c.contact_person || 'Не указан'], ['Телефон', c.phone || 'Не указан'], ['Точки и техника', pts.length + ' · ' + eqs.length + ' ед.']] : [['Точки', String(pts.length)], ['Техника', eqs.length + ' ед.']];
    const tab = (key, label, count) => `<button type="button" id="customerTab-${key}" role="tab" data-entity-tab="${key}" aria-controls="customerPane-${key}" aria-label="${label}">${label}${count != null ? ` <span class="tab-count">${count}</span>` : ''}</button>`;
    host().innerHTML = `<header class="workspace-masthead"><div class="workspace-header-inner">
     <div class="crumbs"><button type="button" class="crumb btn workflow-back" id="customerBack" aria-label="К списку клиентов">${journalIcon('back')}</button><span>Справочник / Клиенты</span>
      <div class="acts entity-header-actions">${tel ? `<a class="btn" id="customerCall" href="${esc(tel)}">Позвонить</a>` : ''}${may() ? `<button type="button" class="btn workflow-edit" id="customerEdit" aria-label="Изменить реквизиты">${journalIcon('edit')}<span>Изменить</span></button><button type="button" class="btn" id="customerMore">⋯</button>` : ''}${ctx.canCreateJob() ? '<button type="button" class="btn amber" id="customerNewJob">Создать заявку</button>' : ''}</div></div>
     <div class="trip-head"><div><h2 id="customerTitle">${esc(c.name)}</h2>${real && c.legal_name && c.legal_name !== c.name ? `<div class="workflow-subject">${esc(c.legal_name)}</div>` : ''}<div class="entity-head-meta workflow-head-facts">${metadataList(facts.filter(Boolean))}</div></div></div>
     <div class="entity-toolbar customer-toolbar"><nav class="entity-tabs" role="tablist" aria-label="Разделы клиента">${tab('overview', 'Обзор')}${tab('points', 'Точки', pts.length)}${tab('equipment', 'Техника', eqs.length)}${tab('jobs', 'Заявки и задания', '…')}${real ? tab('details', 'Договор и реквизиты') : ''}</nav></div>
    </div></header>
    <main class="workspace-main customer-main">
     <section class="entity-tab-panel" id="customerPane-overview" data-entity-panel="overview" role="tabpanel" aria-labelledby="customerTab-overview"></section>
     <section class="entity-tab-panel" id="customerPane-points" data-entity-panel="points" role="tabpanel" aria-labelledby="customerTab-points" hidden></section>
     <section class="entity-tab-panel" id="customerPane-equipment" data-entity-panel="equipment" role="tabpanel" aria-labelledby="customerTab-equipment" hidden></section>
     <section class="entity-tab-panel" id="customerPane-jobs" data-entity-panel="jobs" role="tabpanel" aria-labelledby="customerTab-jobs" hidden></section>
     ${real ? '<section class="entity-tab-panel" id="customerPane-details" data-entity-panel="details" role="tabpanel" aria-labelledby="customerTab-details" hidden></section>' : ''}
    </main>`;
    host().closest('.view')?.classList.add('workspace-page', 'workflow-card');
    $('customerBack').onclick = async () => { if (await leave()) ctx.goCatalog(); };
    $('customerEdit') && ($('customerEdit').onclick = () => tabs.select('details', { focus: true }));
    $('customerNewJob') && ($('customerNewJob').onclick = () => createJob());
    if ($('customerMore')) mountEntityActions({ trigger: $('customerMore'), items: [
      { label: 'Позвонить · ' + (c.phone || ''), hidden: !tel, onSelect: () => { location.href = tel; } },
      { label: 'Поставить точку на карте', onSelect: () => ctx.goMap() },
      { label: 'Удалить клиента', danger: true, onSelect: () => remove() }
    ] });
    tabs = createEntityTabs(host(), { initial: pane, scrollOnChange: false, onChange: value => { ctx.route(path(value)); } });
    tabs.select(pane, { notify: false });
    paintPoints(); paintEquipment(); paintData(); if (real) paintDetails();
  }
  const path = pane => 'customer/' + encodeURIComponent(current.id) + (pane && pane !== 'overview' ? '/' + pane : '');

  function paintData() { if (!current || !host()) return; paintOverview(); paintJobs(); const count = host().querySelector('#customerTab-jobs .tab-count'); if (count) count.textContent = loading && !data.jobs.length ? '…' : String(data.jobs.length); }

  // ---------- Обзор ----------
  function paintOverview() {
    const box = $('customerPane-overview'); if (!box) return;
    const s = summary(), manager = ctx.canWrite(), stats = manager ? points().map(p => ctx.stats(p.id)).filter(Boolean) : [];
    const rev = stats.reduce((a, x) => a + (x.rev || 0), 0), profit = stats.reduce((a, x) => a + (x.profit || 0), 0);
    const tile = (label, value, note, action) => `<div class="customer-stat"><span>${label}</span><b>${value}</b>${note ? `<small>${action ? `<button type="button" class="ref-link inline" data-customer-go="${action}">${note}</button>` : note}</small>` : ''}</div>`;
    const max = Math.max(1, ...s.months.map(m => m.n));
    const list = (title, rows, render, empty) => `<section class="card customer-card"><h3>${title}</h3>${rows.length ? '<ol class="customer-rank">' + rows.map(render).join('') + '</ol>' : `<p class="hint">${empty}</p>`}</section>`;
    const status = loadError ? `<p class="err" role="alert">Заявки клиента не загрузились: ${esc(loadError.message || 'нет связи')} <button type="button" class="btn sm" data-customer-retry>Повторить</button></p>` : loading && !data.jobs.length ? '<p class="hint" role="status">Загружаем заявки клиента…</p>' : '';
    box.innerHTML = `${status}<div class="customer-overview-head"><h3>Сводка</h3><div class="seg customer-period" role="group" aria-label="Период сводки">${PERIODS.map(([k, l]) => `<button type="button" data-customer-period="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>
     <div class="customer-stats">${tile('Заявки', s.jobs, s.open ? s.open + ' ' + ctx.plural(s.open, 'открыта', 'открыты', 'открыто') + ' сейчас' : 'открытых нет')}${tile('Визиты', s.visits, s.lastVisit ? 'последний ' + metaDate(s.lastVisit) : 'визитов не было')}${tile('Часы работ', num(s.hours), 'по отчётам заданий')}${tile('ТО просрочено', s.overdue + ' ед.', s.overdue || s.soon ? (s.soon ? 'ещё ' + s.soon + ' в течение 30 дней' : 'открыть технику') : 'всё в срок', s.overdue || s.soon ? 'equipment' : '')}${manager && stats.length ? tile('Выручка · всё время', money(rev) + ' ' + esc(ctx.currency()), rev > 0 ? 'маржа ' + Math.round(profit / rev * 100) + '%' : 'выручки нет') : ''}</div>
     <section class="card customer-card customer-months"><h3>Заявки по месяцам</h3><div class="customer-bars" role="img" aria-label="Заявки по месяцам за год: ${s.months.map(m => m.label + ' ' + m.n).join(', ')}">${s.months.map((m, i) => `<div class="customer-bar${i === s.months.length - 1 ? ' is-current' : ''}"><span class="customer-bar-value">${m.n || ''}</span><i style="height:${m.n ? Math.max(6, m.n / max * 100) : 2}%"></i><span>${m.label}</span></div>`).join('')}</div></section>
     <div class="customer-columns">${list('Что ломается чаще', s.breakdowns, r => `<li><span>${esc(r.label)}</span><b>${r.n} ${ctx.plural(r.n, 'заявка', 'заявки', 'заявок')}</b></li>`, 'Заявок по технике за период нет.')}${list('Запчасти чаще всего', s.parts, r => `<li><span>${esc(r.label)}</span><b>${num(r.n)} ${esc(r.unit)}</b></li>`, 'Запчасти за период не ставились.')}</div>
     ${list('Открытые заявки', s.openJobs, j => `<li><button type="button" class="ref-link" data-customer-job="${esc(j.id)}"><b>${esc(requestLabel(j))}</b><small>${esc([pointName(j.client_id), j.due_date ? 'срок ' + metaDate(j.due_date) : '', JOB_STATUS[j.status] || j.status].filter(Boolean).join(' · '))}</small></button></li>`, 'Открытых заявок нет.')}`;
    box.querySelectorAll('[data-customer-period]').forEach(b => b.onclick = () => { period = b.dataset.customerPeriod; paintOverview(); });
    box.querySelectorAll('[data-customer-go]').forEach(b => b.onclick = () => tabs.select(b.dataset.customerGo, { focus: true }));
    box.querySelectorAll('[data-customer-job]').forEach(b => b.onclick = () => openJob(b.dataset.customerJob));
    box.querySelector('[data-customer-retry]')?.addEventListener('click', () => load());
  }

  // ---------- Точки ----------
  function paintPoints() {
    const box = $('customerPane-points'); if (!box) return;
    const real = current.id !== NO_CUSTOMER, rows = points().map(p => ({ ...p, equipment: equipment().filter(e => e.client_id === p.id).length, open: (ctx.stats(p.id)?.open) || 0 }));
    const free = real && may() ? (ctx.points() || []).filter(p => !p.is_base && !p.deleted_at && p.customer_id !== current.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')) : [];
    const others = id => ctx.customers().find(c => c.id === id)?.name;
    box.innerHTML = `<div class="customer-pane-head">${free.length ? `<label class="customer-attach"><span class="sr-only">Точка, которую привязать к клиенту</span><select id="customerAttachPoint"><option value="">Привязать существующую точку…</option>${free.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.customer_id ? ' · сейчас: ' + esc(others(p.customer_id) || 'другой клиент') : ' · без клиента'}</option>`).join('')}</select></label><button type="button" class="btn" id="customerAttach">Привязать</button>` : ''}<span class="grow"></span>${ctx.canWrite() ? '<button type="button" class="btn" id="customerPointMap">Поставить точку на карте</button>' : ''}</div><div id="customerPointList"></div>`;
    ctx.renderCatalogTable($('customerPointList'), { label: 'Точки клиента', scope: 'customer-points', rows, rowClass: 'emrow', rowLabel: p => p.name,
      empty: real ? 'Точек нет. Привяжите существующую или поставьте новую на карте.' : 'Все точки привязаны к клиентам.', columns: [
        { key: 'name', label: 'Точка', value: p => p.name, render: p => `<button type="button" class="catalog-record-link" data-cp-open="${esc(p.id)}">${esc(p.name)}</button>${p.address ? `<small class="ref-sub">${esc(p.address)}</small>` : ''}` },
        { key: 'contact', label: 'Контакт', value: p => [p.contact_person, p.phone].filter(Boolean).join(' · ') || null },
        { key: 'equipment', label: 'Техника', type: 'number', value: p => p.equipment },
        { key: 'open', label: 'Открытые заявки', type: 'number', value: p => p.open }
      ], actions: [{ attribute: 'data-cp-open', label: 'Открыть точку', run: id => ctx.openPoint(id) }, { attribute: 'data-cp-map', label: 'Показать на карте', run: id => ctx.showPoint(id) }, { attribute: 'data-cp-eq', label: 'Техника точки', run: id => ctx.openPointEquipment(id) }, ...(real && may() ? [{ attribute: 'data-cp-unlink', label: 'Отвязать от клиента', danger: true, run: id => link(id, null) }] : [])] });
    $('customerAttach') && ($('customerAttach').onclick = () => { const v = $('customerAttachPoint').value; if (v) link(v, current.id); });
    $('customerPointMap') && ($('customerPointMap').onclick = () => ctx.goMap());
  }
  async function link(pointId, customerId) {
    const { error } = await sb.from('clients').update({ customer_id: customerId }).eq('id', pointId);
    if (error) { ctx.notify('Ошибка: ' + error.message, 'err'); return; }
    const p = (ctx.points() || []).find(x => x.id === pointId); if (p) p.customer_id = customerId;
    ctx.showToast(customerId ? 'Точка привязана' : 'Точка отвязана');
    render(tabs?.value || 'points'); void load();
  }

  // ---------- Техника ----------
  function paintEquipment() {
    const box = $('customerPane-equipment'); if (!box) return;
    const rows = equipment().map(e => { const f = ctx.forecast(e), l = serviceLabel(f); return { ...e, point: pointName(e.client_id), next: f?.dueDate || null, nextDays: f ? f.days : null, nextText: l.text, nextState: l.state, warranty: ctx.warrantyUntil(e) }; })
      .sort((a, b) => (a.nextDays ?? 1e9) - (b.nextDays ?? 1e9));
    box.innerHTML = `<div class="customer-pane-head"><span class="grow"></span>${ctx.canWrite() && points().length ? '<button type="button" class="btn" id="customerAddEquipment">Добавить технику</button>' : ''}</div><div id="customerEquipmentList"></div>`;
    ctx.renderCatalogTable($('customerEquipmentList'), { label: 'Техника клиента', scope: 'customer-equipment', rows, rowClass: 'emrow', rowLabel: e => eqLabel(e),
      empty: 'Техники на точках клиента нет.', columns: [
        { key: 'model', label: 'Техника', value: e => e.model || null, render: e => `<button type="button" class="catalog-record-link" data-ce-open="${esc(e.id)}">${esc(e.model || 'Техника')}</button>${e.serial || e.kind ? `<small class="ref-sub">${esc([e.serial ? '№ ' + e.serial : '', e.kind].filter(Boolean).join(' · '))}</small>` : ''}` },
        { key: 'point', label: 'Точка', value: e => e.point },
        { key: 'next', label: 'Следующее ТО', type: 'date', value: e => e.next, render: e => `<span class="customer-service" data-state="${e.nextState}">${esc(e.nextText)}</span>` },
        { key: 'service', label: 'Последнее ТО', type: 'date', value: e => e.last_service || null, render: e => e.last_service ? esc(metaDate(e.last_service)) : '<span class="hint">не было</span>' },
        { key: 'warranty', label: 'Гарантия до', type: 'date', value: e => e.warranty || null, render: e => e.warranty ? esc(metaDate(e.warranty)) : '—' }
      ], actions: [{ attribute: 'data-ce-open', label: 'Карточка и сервисная история', run: id => ctx.openEquipmentCard(id) }, ...(ctx.canCreateJob() ? [{ attribute: 'data-ce-job', label: 'Заявка на ТО', run: id => { const e = equipment().find(x => x.id === id); if (e) ctx.newJob(e.client_id, e.id); } }] : [])] });
    $('customerAddEquipment') && ($('customerAddEquipment').onclick = async () => { const id = await pickPoint('Куда добавить технику?'); if (id) ctx.openPointEquipment(id); });
  }

  // ---------- Заявки и задания ----------
  function paintJobs() {
    const box = $('customerPane-jobs'); if (!box) return;
    if (loadError) { box.innerHTML = `<p class="err" role="alert">Заявки не загрузились: ${esc(loadError.message || 'нет связи')}</p>`; return; }
    if (loading && !data.jobs.length) { box.innerHTML = '<p class="hint" role="status">Загружаем заявки…</p>'; return; }
    const eqs = equipment(), byJob = new Map();
    for (const o of data.orders) { if (!byJob.has(o.job_id)) byJob.set(o.job_id, []); byJob.get(o.job_id).push(o); }
    const rows = data.jobs.map(j => ({ ...j, point: pointName(j.client_id), eq: eqs.find(e => e.id === j.equipment_id)?.model || null, statusText: JOB_STATUS[j.status] || j.status, tasks: (byJob.get(j.id) || []).length }));
    box.innerHTML = '<div id="customerJobList"></div>';
    ctx.renderCatalogTable($('customerJobList'), { label: 'Заявки клиента', scope: 'customer-jobs', rows, rowClass: 'emrow', rowLabel: j => requestLabel(j),
      empty: 'Заявок по точкам клиента нет.', columns: [
        { key: 'number', label: 'Заявка', value: j => requestLabel(j), render: j => `<button type="button" class="catalog-record-link" data-cj-open="${esc(j.id)}">${esc(requestLabel(j))}</button>${j.notes ? `<small class="ref-sub">${esc(String(j.notes).slice(0, 120))}</small>` : ''}` },
        { key: 'point', label: 'Точка', value: j => j.point },
        { key: 'eq', label: 'Техника', value: j => j.eq },
        { key: 'status', label: 'Статус', value: j => j.statusText },
        { key: 'due', label: 'Срок', type: 'date', value: j => j.due_date || null, render: j => j.due_date ? esc(metaDate(j.due_date)) : '—' },
        { key: 'tasks', label: 'Задания', type: 'number', value: j => j.tasks }
      ], actions: [{ attribute: 'data-cj-open', label: 'Открыть заявку', run: id => openJob(id) }] });
  }

  // ---------- Договор и реквизиты ----------
  const FIELDS = [['name', 'Название', 'text', 300], ['legal_name', 'Юридическое название', 'text', 300], ['tax_id', 'ЕДРПОУ / ИНН', 'text', 40], ['contact_person', 'Контактное лицо', 'text', 200], ['phone', 'Телефон', 'tel', 60], ['email', 'Эл. почта', 'email', 200], ['notes', 'Договор и заметки', 'textarea', 4000]];
  function paintDetails() {
    const box = $('customerPane-details'); if (!box) return;
    const c = current, edit = may();
    box.innerHTML = `<section class="card customer-details"><h3>Договор и реквизиты</h3><form id="customerForm" class="customer-form" novalidate>${FIELDS.map(([k, label, type, max]) => `<label class="customer-field${k === 'notes' ? ' is-wide' : ''}"><span>${label}</span>${type === 'textarea' ? `<textarea name="${k}" rows="4" maxlength="${max}" ${edit ? '' : 'disabled'}>${esc(c[k] || '')}</textarea>` : `<input name="${k}" type="${type}" maxlength="${max}" value="${esc(c[k] || '')}" ${k === 'name' ? 'required' : ''} ${edit ? '' : 'disabled'}>`}</label>`).join('')}
      <p class="err is-wide" id="customerFormError" role="alert"></p>${edit ? '<div class="customer-form-actions is-wide"><span class="hint" id="customerFormState" role="status">Сохранено</span><button type="button" class="btn" id="customerFormReset" hidden>Отменить</button><button type="submit" class="btn amber" id="customerFormSave" disabled>Сохранить</button></div>' : ''}</form></section>`;
    const form = $('customerForm');
    const sync = () => { formDirty = FIELDS.some(([k]) => (form.elements[k].value || '').trim() !== String(c[k] || '').trim()); if ($('customerFormSave')) { $('customerFormSave').disabled = !formDirty; $('customerFormReset').hidden = !formDirty; $('customerFormState').textContent = formDirty ? 'Есть несохранённые изменения' : 'Сохранено'; } };
    form.addEventListener('input', sync);
    form.onsubmit = event => { event.preventDefault(); void save(); };
    $('customerFormReset') && ($('customerFormReset').onclick = () => { formDirty = false; paintDetails(); });
  }
  async function save() {
    const form = $('customerForm'); if (!form || !may()) return false;
    const rec = Object.fromEntries(FIELDS.map(([k]) => [k, (form.elements[k].value || '').trim()]));
    const fail = text => { $('customerFormError').textContent = text; return false; };
    if (!rec.name) { form.elements.name.focus(); return fail('Укажите название клиента.'); }
    if (ctx.customers().some(x => x.id !== current.id && x.name.trim().toLowerCase() === rec.name.toLowerCase())) return fail('Клиент с таким названием уже есть.');
    $('customerFormSave').disabled = true; $('customerFormError').textContent = '';
    const { data: saved, error } = await sb.from('customers').update(rec).eq('id', current.id).select('*').single();
    if (error) { $('customerFormSave').disabled = false; return fail('Ошибка: ' + error.message); }
    current = { ...current, ...rec, ...(saved || {}) }; formDirty = false;
    await ctx.reloadCustomers(); ctx.showToast('Реквизиты сохранены');
    render('details'); return true;
  }
  async function remove() {
    const n = points().length;
    if (n) { ctx.notify('Удалить нельзя: у клиента ' + n + ' ' + ctx.plural(n, 'точка', 'точки', 'точек') + '. Перенесите их другому клиенту или отвяжите.', 'err'); return; }
    if (await ctx.deleteCustomer(current.id)) { current = null; formDirty = false; ctx.goCatalog(); }
  }

  // ---------- Действия ----------
  async function pickPoint(title) {
    const pts = points();
    if (!pts.length) { ctx.notify('У клиента нет точек. Сначала привяжите точку.', 'warn'); tabs?.select('points', { focus: true }); return null; }
    if (pts.length === 1) return pts[0].id;
    const r = await ctx.prompt(title, [{ key: 'point', label: 'Точка', type: 'select', value: pts[0].id, options: pts.map(p => ({ value: p.id, label: p.name })) }], { okText: 'Продолжить' });
    return r?.point || null;
  }
  async function createJob() { const id = await pickPoint('Для какой точки заявка?'); if (id && await leave()) ctx.newJob(id, null); }
  async function openJob(id) { if (await leave()) ctx.openJob(id); }
  async function leave() {
    if (!formDirty || !document.querySelector('.view-customer.active')) return true;
    if (!await ctx.confirmDialog('Реквизиты клиента изменены и не сохранены.', { title: 'Уйти без сохранения?', okText: 'Уйти без сохранения', cancelText: 'Остаться', danger: true })) return false;
    formDirty = false; return true;
  }
  function selectPane(pane) { if (tabs && current) tabs.select(pane || 'overview', { notify: false }); }
  // Данные карты (точки, техника, статистика) обновились — перерисовать без перезагрузки заявок.
  function refresh() { if (!current || !document.querySelector('.view-customer.active') || formDirty) return; if (current.id !== NO_CUSTOMER) { const c = ctx.customers().find(x => x.id === current.id); if (c) current = c; } render(tabs?.value || 'overview'); void load(); }

  return { open, load, leave, selectPane, refresh, currentId: () => current?.id || null, pane: () => tabs?.value || 'overview', isDirty: () => formDirty, path: () => current ? path(tabs?.value) : 'catalog' };
}
