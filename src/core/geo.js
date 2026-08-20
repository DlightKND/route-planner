// Геометрия и обход точек. Чистый модуль: без DOM, без сети, без глобалей.
// Единственная внешняя зависимость — turf, передаётся аргументом, чтобы
// модуль оставался тестируемым без браузера.

// Расстояние между двумя точками {lat,lng} в километрах.
// turf передаётся снаружи; при сбое возвращаем 0 — как в оригинале.
export function kmBetween(a, b, turf) {
  // turf необязателен: если не передан, берём глобальный (мост на время
  // переноса — старые вызовы kmBetween(a,b) продолжают работать).
  const t = turf || (typeof globalThis !== 'undefined' && globalThis.turf);
  try { return t.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'kilometers' }); }
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

// Прореживание линии маршрута (Дуглас–Пекер).
//
// ORS отдаёт точку каждые 20–50 метров. На маршруте в 1700 км это под сотню
// тысяч точек и до 2 МБ JSON — такую геометрию нельзя ни сохранить одним
// запросом, ни быстро отрисовать. Для карты такая подробность не нужна:
// точки, лежащие почти на прямой между соседями, форму линии не меняют.
//
// tolerance — в градусах. 0.0001 ≈ 11 м на экваторе: на глаз неотличимо,
// а точек остаётся в 10–20 раз меньше.
//
// Вход и выход — массив [lng, lat] (порядок GeoJSON).
export function simplifyLine(line, tolerance = 0.0001) {
  if (!Array.isArray(line) || line.length <= 2) return line || [];

  // Расстояние от точки p до отрезка a–b (в градусах, плоское приближение —
  // на масштабе соседних точек искажение проекции пренебрежимо).
  const segDist = (p, a, b) => {
    let x = a[0], y = a[1];
    let dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;          // квадрат — корень не нужен для сравнения
  };

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;

  // Итеративно, без рекурсии: на длинных линиях рекурсия переполняет стек.
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = segDist(line[i], line[first], line[last]);
      if (sq > maxSq) { maxSq = sq; idx = i; }
    }
    if (maxSq > sqTol && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }

  const out = [];
  for (let i = 0; i < line.length; i++) if (keep[i]) out.push(line[i]);
  return out;
}
