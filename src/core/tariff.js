// Разбор тарифов и наработки. Чистые правила без обращения к базе.

// Кто платит за дорогу по заявке: сперва гарантийная работа с профилем,
// потом платная, потом любая. Совпадает с jobRoadPayer в приложении.
export function jobRoadPayer(j) {
  const works = j.job_works || [];
  const warr = works.find(w => w.billable === false && (w.tariff_profile || w.profile));
  if (warr) return warr.tariff_profile || warr.profile;
  const paid = works.find(w => w.billable !== false && (w.tariff_profile || w.profile));
  if (paid) return paid.tariff_profile || paid.profile;
  const any = works.find(w => w.tariff_profile || w.profile);
  return any ? (any.tariff_profile || any.profile) : null;
}

// Наработка моточасов в сутки по последним трём показаниям.
export function rateFrom(rs) {
  if (!rs || rs.length < 2) return 0;
  const use = rs.slice(-3); const a = use[0], b = use[use.length - 1];
  const d = (new Date(b.taken_on) - new Date(a.taken_on)) / 86400000;
  if (!(d > 0)) return 0;
  const r = (+b.moto_hours - +a.moto_hours) / d;
  return r > 0 ? r : 0;
}
