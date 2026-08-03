// Геометрия и обход точек. Чистый модуль: без DOM, без сети, без глобалей.
// Единственная внешняя зависимость — turf, передаётся аргументом, чтобы
// модуль оставался тестируемым без браузера.

// Расстояние между двумя точками {lat,lng} в километрах.
// turf передаётся снаружи; при сбое возвращаем 0 — как в оригинале.
export function kmBetween(a, b, turf) {
  try { return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'kilometers' }); }
  catch { return 0; }
}

// Длина обхода точек по ближайшему соседу с возвратом в начало.
// Одна точка — особый случай: путь туда и обратно, а не ноль.
export function circuitKm(start, pts, turf) {
  if (!pts || !pts.length) return 0;
  if (pts.length === 1) return 2 * kmBetween(start, pts[0], turf);
  let rem = pts.slice(), cur = start, total = 0;
  while (rem.length) {
    let bi = 0, bd = Infinity;
    rem.forEach((p, i) => { const d = kmBetween(cur, p, turf); if (d < bd) { bd = d; bi = i; } });
    total += bd; cur = rem[bi]; rem.splice(bi, 1);
  }
  total += kmBetween(cur, start, turf);
  return total;
}

// Порядок объезда: жадный ближайший сосед по матрице расстояний M,
// со стартом в 0 и фиксированным концом endIdx.
export function tspOrder(M, endIdx) {
  const n = M.length; const rest = [];
  for (let i = 1; i < n; i++) if (i !== endIdx) rest.push(i);
  let order = [0], cur = 0, left = rest.slice();
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((k, idx) => { if (M[cur][k] < bd) { bd = M[cur][k]; bi = idx; } });
    cur = left[bi]; order.push(cur); left.splice(bi, 1);
  }
  if (endIdx != null) order.push(endIdx);
  return order;
}

// Убрать подряд идущие точки-дубли (в пределах ~10 см).
export function dedupeStops(stops) {
  const out = [];
  stops.forEach(s => {
    const p = out[out.length - 1];
    if (p && Math.abs(p.lat - s.lat) < 1e-6 && Math.abs(p.lng - s.lng) < 1e-6) return;
    out.push(s);
  });
  return out;
}
