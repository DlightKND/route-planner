// Отображение состояния машины. Чистые функции «как показать»: свежесть
// позиции, подпись, класс маркера, курс. Ни DOM, ни базы.
//
// Порог устаревания (VEH_STALE_MIN в приложении, 12 минут) передаётся
// аргументом staleMin со значением по умолчанию — места вызова менять
// не нужно, а тесты могут задать свой порог.

const STALE_MIN_DEFAULT = 12;

// Возраст позиции в минутах. Нет метки времени — считаем «очень старой».
export function vehAgeMin(r) {
  if (!r || !r.ts) return 1e9;
  return (Date.now() - new Date(r.ts).getTime()) / 60000;
}

// Человекочитаемый возраст.
export function vehAgeText(m) {
  if (m < 1) return 'только что';
  if (m < 60) return Math.round(m) + ' мин назад';
  const h = Math.floor(m / 60);
  return h + ' ч ' + Math.round(m - h * 60) + ' мин назад';
}

// Класс маркера: молчит/устарела → stale, иначе idle или moving.
export function vehClass(r, staleMin = STALE_MIN_DEFAULT) {
  const age = vehAgeMin(r);
  if (r.lost_since || age > staleMin) return 'stale';
  return (r.status === 'idle') ? 'idle' : 'moving';
}

// Подпись состояния. Порядок важен: сначала связь, потом занятие —
// «молчит» перебивает всё остальное, потому что всё остальное в этот
// момент уже догадка.
export function vehTitle(r, staleMin = STALE_MIN_DEFAULT) {
  if (r.lost_since) return 'связь потеряна · последние данные ' + vehAgeText(vehAgeMin(r));
  const age = vehAgeMin(r);
  if (age > staleMin) return 'данных нет ' + vehAgeText(age);
  if (r.status === 'idle') return 'стоит на месте';
  return 'в движении · ' + Math.round(+r.speed || 0) + ' км/ч';
}

// Курс по двум последним точкам: Wialon не отдаёт его ни одним тегом.
export function vehBearing(a, b) {
  if (!a || !b) return null;
  const d2r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * d2r) * Math.cos(b.lat * d2r);
  const x = Math.cos(a.lat * d2r) * Math.sin(b.lat * d2r)
          - Math.sin(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.cos((b.lng - a.lng) * d2r);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Короткая метка машины: номер, иначе имя.
export function vehLabel(v) { return v.plate || v.name || '—'; }
