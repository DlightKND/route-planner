// Срочность заявки по сроку (SLA). Чистые функции: на входе заявка и «сегодня»,
// на выходе — уровень остроты. Ни DOM, ни базы.
//
// Правило (календарные дни):
//   нет due_date            → cold      (холодная: потребность есть, срока нет)
//   осталось < 0            → overdue   (просрочено)
//   полный_срок ≤ 0         → acute     (срок в день создания или раньше)
//   порог = max(полный_срок × 0.2, 2)
//   осталось ≤ порог        → acute     (острая)
//   иначе                   → calm      (спокойная)
//
// Порог в процентах от полного срока заявки: заявка на месяц и заявка на три
// дня начинают гореть пропорционально своему сроку, а не в один и тот же
// абсолютный момент. Нижняя отсечка 2 дня закрывает совсем короткие сроки.

const MIN_ACUTE_DAYS = 2;
const ACUTE_FRACTION = 0.2;

const DAY = 86400000;

// Разница в календарных днях между двумя датами (b − a), округлённая.
// Приведение к полуночи, чтобы часть суток не искажала счёт дней.
function dayDiff(a, b) {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / DAY);
}

// Уровень остроты заявки. now по умолчанию — сейчас; передаётся аргументом,
// чтобы логику можно было тестировать на фиксированной дате.
//   → { level, left, span, threshold }
//     level: 'cold' | 'overdue' | 'acute' | 'calm'
//     left:  дней до срока (отрицательное — просрочка), null для cold
export function jobUrgency(job, now = new Date()) {
  const due = job && job.due_date ? new Date(job.due_date + 'T00:00:00') : null;
  if (!due || isNaN(due)) return { level: 'cold', left: null, span: null, threshold: null };

  const left = dayDiff(now, due);
  if (left < 0) return { level: 'overdue', left, span: null, threshold: null };

  // created_at может отсутствовать — тогда процент считать не от чего,
  // откатываемся на абсолютный минимум.
  const created = job.created_at ? new Date(job.created_at) : null;
  const span = (created && !isNaN(created)) ? dayDiff(created, due) : null;

  if (span == null) {
    return { level: left <= MIN_ACUTE_DAYS ? 'acute' : 'calm', left, span: null, threshold: MIN_ACUTE_DAYS };
  }
  if (span <= 0) return { level: 'acute', left, span, threshold: null };

  const threshold = Math.max(span * ACUTE_FRACTION, MIN_ACUTE_DAYS);
  return { level: left <= threshold ? 'acute' : 'calm', left, span, threshold };
}

// Холодная ли заявка: открыта и без срока. Именно open — planned означает,
// что заявкой уже занялись. done/cancelled/in_progress — не холодные.
export function isCold(job) {
  return job && job.status === 'open' && !job.due_date;
}

// Нужен ли инженер: активная заявка без назначенного.
export function needsEngineer(job) {
  return job
    && ['open', 'planned', 'in_progress'].includes(job.status)
    && !job.assigned_engineer;
}

// Порядок сортировки ленты внимания: чем острее, тем выше.
const RANK = { overdue: 0, acute: 1, calm: 2, cold: 3 };
export function urgencyRank(level) {
  return RANK[level] != null ? RANK[level] : 9;
}

// Готовая раскладка списка заявок для ленты «Требует внимания»:
//   dated — заявки со сроком, отсортированные по остроте (и по left внутри);
//   cold  — холодные (open без due_date).
// Заявки в статусах done/cancelled отфильтровываются — им не место в ленте.
export function attentionBuckets(jobs, now = new Date()) {
  const dated = [];
  const cold = [];
  (jobs || []).forEach(j => {
    if (j.status === 'done' || j.status === 'cancelled') return;
    if (isCold(j)) { cold.push(j); return; }
    const u = jobUrgency(j, now);
    if (u.level === 'cold') { cold.push(j); return; }  // без срока, но не open
    dated.push({ job: j, u });
  });
  dated.sort((a, b) => {
    const r = urgencyRank(a.u.level) - urgencyRank(b.u.level);
    if (r !== 0) return r;
    return (a.u.left ?? 1e9) - (b.u.left ?? 1e9);   // внутри уровня — по близости срока
  });
  return { dated, cold };
}
