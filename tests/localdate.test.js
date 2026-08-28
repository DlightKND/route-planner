// Местный календарь против UTC.
//
// Эти две функции существуют потому, что toISOString() восточнее Гринвича
// сдвигает и день, и месяц. График выручки из-за этого был пуст всегда:
// корзины строились на месяц назад, а корзины текущего месяца не было вовсе.
// Тесты гоняются с TZ=Europe/Kiev (см. vite/vitest env ниже) и фиксируют
// именно то поведение, ради которого функции написаны.

import { describe, it, expect } from 'vitest';
import { todayISO, monthKey } from '../src/core/format.js';

// Даты строим из местных частей — new Date(2026, 7, 1) это 1 августа
// местной полуночи в той зоне, где идут тесты.
describe('todayISO', () => {
  it('отдаёт местную дату, а не UTC', () => {
    expect(todayISO(new Date(2026, 7, 28, 1, 30))).toBe('2026-08-28');
  });
  it('в полночь остаётся текущим днём', () => {
    expect(todayISO(new Date(2026, 7, 28, 0, 0, 0))).toBe('2026-08-28');
  });
  it('за минуту до полуночи не перескакивает вперёд', () => {
    expect(todayISO(new Date(2026, 7, 28, 23, 59, 59))).toBe('2026-08-28');
  });
  it('дополняет месяц и день нулями', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('без аргумента берёт сейчас', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('monthKey', () => {
  it('первое число остаётся в своём месяце', () => {
    // Ровно этот случай ломал график: new Date(2026,7,1).toISOString()
    // даёт 2026-07-31T21:00Z, то есть июль.
    expect(monthKey(new Date(2026, 7, 1))).toBe('2026-08');
  });
  it('последнее число тоже', () => {
    expect(monthKey(new Date(2026, 7, 31, 23, 0))).toBe('2026-08');
  });
  it('январь дополняется нулём', () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });
  it('шесть корзин назад содержат текущий месяц', () => {
    const now = new Date(2026, 7, 28);
    const keys = [];
    for (let i = 5; i >= 0; i--) {
      keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    expect(keys).toEqual(['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']);
    expect(keys).toContain(monthKey(new Date(2026, 7, 14)));   // выезд 14 августа
  });
  it('переход через год считается верно', () => {
    const d = new Date(2026, 0, 1);
    expect(monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1))).toBe('2025-12');
  });
});
