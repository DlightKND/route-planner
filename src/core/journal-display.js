export function zeroPresenceSignature(stay) {
  if (stay.status !== 'approved' || stay.minutes_mgr == null ||
      stay.minutes_mgr === '' || Number(stay.minutes_mgr) !== 0) return null;
  return JSON.stringify([
    stay.id, stay.job_id,
    [...new Set(stay.crew_ids || [])].sort(),
    (stay.task_allocations || []).map(a => [a.order_id, Number(a.share)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  ]);
}

export function decisionLabel(original, current, editing) {
  if (editing) {
    if (current.status === 'rejected' && original.status === 'approved') {
      return 'Подтверждение будет снято';
    }
    return current.stop_kind === 'visit'
      ? 'Решение не сохранено'
      : 'Присутствие не подтверждено';
  }
  if (original.status !== 'approved') return 'Присутствие не подтверждено';
  if (original.minutes_mgr == null) return 'Посещение подтверждено · время не определено';
  return Number(original.minutes_mgr) === 0
    ? 'Посещение подтверждено · время не принято'
    : 'Присутствие подтверждено';
}

const TZ = 'Europe/Kyiv';
const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit'
});
const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ, day: 'numeric', month: 'short'
});
const keyFormat = new Intl.DateTimeFormat('en', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
});
const timestamp = v => typeof v === 'number' ? v : Date.parse(v);
const finiteValue = value => value == null || value === '' ||
  !Number.isFinite(Number(value)) ? null : Number(value);

export function durationText(value) {
  const n = finiteValue(value);
  if (n == null || n < 0) return 'Нет данных';
  const minutes = Math.round(n);
  return [minutes >= 60 ? `${Math.floor(minutes / 60)} ч` : '',
    minutes % 60 || minutes < 60 ? `${minutes % 60} мин` : '']
    .filter(Boolean).join(' ');
}

export function distanceText(value) {
  const n = finiteValue(value);
  return n == null ? 'Нет данных' : `${n.toLocaleString('ru-RU', {
    maximumFractionDigits: 1
  })} км`;
}

export function dayKey(value) {
  const ms = timestamp(value);
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(keyFormat.formatToParts(ms)
    .filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function intervalText(from, to) {
  const a = timestamp(from), b = timestamp(to);
  if (!Number.isFinite(a)) return 'Интервал не определён';
  const start = `${dayFormat.format(a)}, ${timeFormat.format(a)}`;
  if (!Number.isFinite(b)) return `${start} — продолжается`;
  return dayKey(a) === dayKey(b)
    ? `${start}–${timeFormat.format(b)}`
    : `${start} — ${dayFormat.format(b)}, ${timeFormat.format(b)}`;
}

// Реальные календарные дни Киева, включая дни перехода на зимнее/летнее время.
// Не использовать прибавление фиксированных 24 часов к локальной полуночи.
export function timelineDays(from, to) {
  const start = timestamp(from), end = timestamp(to), rows = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return rows;
  let cursor = start, segmentStart = start;
  while (cursor < end) {
    const probe = Math.min(cursor + 3600000, end);
    if (dayKey(cursor) !== dayKey(probe)) {
      let low = cursor, high = probe;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (dayKey(middle) === dayKey(cursor)) low = middle;
        else high = middle;
      }
      rows.push({from: segmentStart, to: high, label: dayFormat.format(segmentStart)});
      segmentStart = high;
    }
    cursor = probe;
  }
  if (segmentStart < end) rows.push({from: segmentStart, to: end,
    label: dayFormat.format(segmentStart)});
  return rows.map(r => ({...r, left: (r.from - start) / (end - start) * 100,
    width: (r.to - r.from) / (end - start) * 100}));
}

export function clusterScreenPoints(points, radius = 48) {
  const parent = points.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= radius) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  points.forEach((p, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return [...groups.values()];
}
export const dayText = value => Number.isFinite(timestamp(value)) ? dayFormat.format(timestamp(value)) : 'Дата не указана';
export function personHours(minutes, crewIds, known = true) {
 const n = finiteValue(minutes), count = new Set(crewIds || []).size;
 return n == null || !known || !count ? null : n * count / 60;
}
