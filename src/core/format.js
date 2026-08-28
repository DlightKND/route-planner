// Форматирование и разбор. Чистые функции отображения.

// Денежная сумма в украинском формате с двумя знаками.
export function money(n) {
  return (+n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Время как ЧЧ:ММ, «—» если пусто.
export function hhmm(t) {
  if (!t) return '—';
  const d = new Date(t); const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

export function fmtDate(d) { return d ? d : ''; }

// Рабочие дни между датами (без суббот и воскресений), не включая начальную.
export function businessDays(from, to) {
  if (!from) return 0;
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  let n = 0; const d = new Date(a); d.setDate(d.getDate() + 1);
  while (d <= b) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

// Адрес ячейки таблицы: буква столбца → номер и обратно (для генерации xlsx).
export function colNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
export function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
export function cellRC(a1) { const m = a1.match(/([A-Z]+)(\d+)/); return { c: colNum(m[1]), r: +m[2] }; }

// Дата и месяц по МЕСТНОМУ календарю.
//
// toISOString() переводит момент в UTC, и восточнее Гринвича это ломает две
// вещи сразу. «Сегодня» с полуночи до трёх ночи по Киеву становится вчерашним
// числом. А местная полночь первого числа уезжает в предыдущий месяц —
// из-за этого корзины графика выручки были смещены на месяц назад, корзины
// текущего месяца не существовало вовсе, и график всегда оставался пустым.
//
// Обе величины нужны в календаре пользователя, а не в UTC, поэтому собираем
// их из местных частей даты.
const pad2 = n => String(n).padStart(2, '0');

// 'ГГГГ-ММ-ДД' для переданной даты (по умолчанию — сегодня).
export function todayISO(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

// 'ГГГГ-ММ' — ключ месяца для группировки.
export function monthKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
