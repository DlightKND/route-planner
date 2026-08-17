// Экономика выезда. Вынесено из app.js без изменения формулы.
//
// Что изменилось при выносе — только устранены скрытые обращения к глобалям,
// чтобы модуль стал чистым и тестируемым:
//   • workCost(w) был отдельной функцией, читавшей appSettings.costs.hour;
//     здесь себестоимость труда считается инлайн по c.hour, а costs (c) и так
//     приходят в параметре T — глобаль не нужна;
//   • appSettings.tariff_profiles как запасной источник профилей заменён
//     параметром fallbackProfiles (передаётся из приложения);
//   • turf и circuitKm приходят аргументами (см. roadByPayer ниже).
//
// Формула не тронута: выручка по плану, себестоимость по факту — обоснование
// в комментариях внутри. Совпадение с прежним поведением закреплено тестами.

import { circuitKm } from './geo.js';
import { jobRoadPayer } from './tariff.js';

// Точка заявки: сперва координаты техники, иначе клиента.
export function jobPoint(j) {
  const eq = j.equipment;
  const lat = (eq && eq.lat != null) ? eq.lat : (j.clients ? j.clients.lat : null);
  const lng = (eq && eq.lng != null) ? eq.lng : (j.clients ? j.clients.lng : null);
  return (lat != null && lng != null) ? { lat: +lat, lng: +lng } : null;
}

// Разбивка дороги по плательщикам. turf передаётся аргументом (нужен circuitKm),
// profs — список тарифных профилей, gKm — плоская ставка км из tariffs.
export function roadByPayer(start, jobs, profs, gKm, turf) {
  if (!start || !turf) return null;
  const P = profs || [];
  const groups = {};
  (jobs || []).forEach(j => {
    const pt = jobPoint(j); if (!pt) return;
    const pid = jobRoadPayer(j) || '__none';
    (groups[pid] = groups[pid] || { payer: pid, points: [] }).points.push(pt);
  });
  const keys = Object.keys(groups);
  if (!keys.length) return null;
  let kmRev = 0, maxKm = -1, dom = null; const out = [];
  keys.forEach(pid => {
    const g = groups[pid];
    const km = circuitKm(start, g.points, turf);
    const p = (pid === '__none') ? null : (P.find(x => x.id === pid) || null);
    const rate = p ? (+((p.road || {}).km_rate) || 0) : (gKm || 0);
    const rev = km * rate; kmRev += rev;
    if (km > maxKm) { maxKm = km; dom = p; }
    out.push({ payer: pid, name: p ? p.name : 'без профиля', km, rate, rev, count: g.points.length });
  });
  return { kmRev, dom, groups: out };
}

// Экономика выезда. Сигнатура как в приложении плюс два явных аргумента в конце:
//   fallbackProfiles — профили, если их нет в снапшоте T (приложение передаёт
//                      appSettings.tariff_profiles);
//   turf             — для разбивки дороги по плательщикам.
export function econCompute(jobs, routeKm, driveH, T, ov, ctx, fallbackProfiles, turf) {
  ov = ov || {}; ctx = ctx || {};
  let rWork = 0, wh = 0, workH = 0, cLabor = 0; const perJob = [];
  const c = (T.costs) || {};
  (jobs || []).forEach(j => {
    let jr = 0, jh = 0, jwh = 0;
    (j.job_works || []).forEach(w => {
      const h = +w.hours || 0; workH += h; jh += h;
      cLabor += h * ((c.hour) || 0);            // было workCost(w)
      // Выручка есть ВСЕГДА — и у платной, и у гарантийной работы. Разница
      // только в тарифе: платная по work_paid, гарантийная по work_warr.
      // Обе ставки уже применены в workRevenue и лежат в w.revenue. Сервис —
      // отдельная бизнес-единица и выставляет счёт всегда: клиенту или
      // внутреннему подразделению по гарантийному тарифу. Поэтому суммируем
      // revenue независимо от billable.
      rWork += (+w.revenue || 0); jr += (+w.revenue || 0);
      // Гарантийные часы копим отдельно — для показателя «доля гарантии».
      // Это уже не «бесплатно», а «оплачено по гарантийному тарифу».
      if (!w.billable) { wh += h; jwh += h; }
    });
    // Разложение по заявке — ТОЛЬКО работы. Транспортные расходы (дорога,
    // сутки, ночлег) на заявки не раскладываются: они уже распределены по
    // плательщикам через roadByPayer, и дробить их ещё и по заявкам значило
    // бы делить одно и то же дважды по разным основаниям.
    //
    // Факт часов по заявке приходит снаружи (ctx.factHoursByJob) — это сумма
    // утверждённых стоянок, привязанных именно к этой заявке. Если факта нет,
    // fact* остаются null, и потребитель показывает только план.
    const fh = (ctx.factHoursByJob && j.id != null) ? ctx.factHoursByJob[j.id] : null;
    const factHours = (fh != null && fh > 0) ? +fh : null;
    const costPlan = jh * ((c.hour) || 0);
    const costFact = (factHours != null) ? factHours * ((c.hour) || 0) : null;
    perJob.push({
      id: j.id ?? null,
      name: (j.clients && j.clients.name) || 'заявка',
      revenue: jr, hours: jh, warrantyHours: jwh,
      factHours,                                  // null = факта нет
      costPlan, costFact,
      cost: (costFact != null) ? costFact : costPlan,
      profit: jr - ((costFact != null) ? costFact : costPlan)
    });
  });
  const t = (T.tariffs) || {};
  const km = routeKm || 0; const dH = driveH || 0; const totalH = workH + dH;
  const eff = (T.shift_hours || 8) * (1 + ((T.deviation_pct || 0) / 100));

  // Выручка — по плану, себестоимость — по факту. Выручка по маршруту
  // согласована с плательщиком заранее и от того, что водитель заплутал,
  // расти не должна. Затраты объективны: бензин сожжён на реально пройденные
  // километры. Поэтому km остаётся плановым везде, кроме cKm.
  const factKm = (ctx.factKm != null && ctx.factKm > 0) ? (+ctx.factKm) : null;
  const costKm = (factKm != null) ? factKm : km;

  // То же и с трудом: выручка по нормочасам из job_works (их ставит человек,
  // они уходят в акт), себестоимость — по утверждённым часам стоянок.
  const factWorkH = (ctx.factWorkH != null && ctx.factWorkH > 0) ? (+ctx.factWorkH) : null;
  const costWorkH = (factWorkH != null) ? factWorkH : workH;

  const days = (function () {
    if (ctx.dateFrom) {
      const a = new Date(ctx.dateFrom + 'T00:00:00'), b = new Date((ctx.dateTo || ctx.dateFrom) + 'T00:00:00');
      const n = Math.round((b - a) / 86400000) + 1;
      if (isFinite(n) && n > 0) return n;
    }
    return totalH > 0 ? Math.max(1, Math.ceil(totalH / eff)) : 0;
  })();
  const daysByCal = !!(ctx.dateFrom && days > 0); const nights = Math.max(0, days - 1);

  // Профили — из снапшота выезда, если он их содержит; иначе запасные.
  const P = (T.tariff_profiles && T.tariff_profiles.length) ? T.tariff_profiles : (fallbackProfiles || []);
  const rb = (ctx.start && P.length) ? roadByPayer(ctx.start, jobs, P, (t.km || 0), turf) : null;

  let rTravel, rPerDiem, roadGroups = null;
  if (rb) {
    const rd = ov.road || {}; let sum = 0;
    roadGroups = rb.groups.map(g => {
      const has = (rd[g.payer] != null && rd[g.payer] !== '');
      const rev = has ? (+rd[g.payer] || 0) : g.rev;
      sum += rev;
      return { payer: g.payer, name: g.name, km: g.km, rate: g.rate, rev, ov: has, count: g.count };
    });
    rTravel = sum;
    const dr = (rb.dom && rb.dom.road) ? rb.dom.road : null;
    rPerDiem = dr ? (days * (+dr.day_rate || 0) + nights * (+dr.night_rate || 0))
                  : (days * (t.day || 0) + nights * (t.night || 0));
  } else {
    rTravel = km * (t.km || 0);
    rPerDiem = days * (t.day || 0) + nights * (t.night || 0);
  }

  const cRev = rWork + rTravel + rPerDiem;
  const cKm = costKm * (c.km || 0), cDay = days * (c.day || 0), cNight = nights * (c.night || 0);
  if (factWorkH != null) cLabor = costWorkH * (c.hour || 0);
  const cCost = cLabor + cKm + cDay + cNight;

  const revOv = (ov.revenue != null && ov.revenue !== ''), costOv = (ov.cost != null && ov.cost !== '');
  const rev = revOv ? (+ov.revenue || 0) : cRev;
  const cost = costOv ? (+ov.cost || 0) : cCost;
  const profit = rev - cost; const margin = rev > 0 ? profit / rev * 100 : 0;
  const share = workH ? Math.round(wh / workH * 100) : 0;

  return {
    rWork, rTravel, rPerDiem, revComputed: cRev, rev, revOv, perJob,
    workH, driveH: dH, totalH, days, daysByCal, nights, km,
    factKm, costKm, factWorkH, costWorkH,
    cLabor, cKm, cDay, cNight, costComputed: cCost, cost, costOv,
    profit, margin, wh, share, cur: T.currency || '',
    jobCount: (jobs || []).length, roadGroups
  };
}
