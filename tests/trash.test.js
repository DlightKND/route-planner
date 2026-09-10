import { describe, expect, it } from 'vitest';
import { TRASH_KEEP_DAYS, trashDaysLeft, trashExpiresAt } from '../src/core/trash.js';

describe('корзина', () => {
  it('хранит запись семь суток', () => {
    expect(TRASH_KEEP_DAYS).toBe(7);
    expect(trashExpiresAt('2026-09-10T12:00:00Z')?.toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });

  it('показывает оставшиеся дни с округлением вверх', () => {
    expect(trashDaysLeft('2026-09-10T12:00:00Z', '2026-09-10T13:00:00Z')).toBe(7);
    expect(trashDaysLeft('2026-09-10T12:00:00Z', '2026-09-16T13:00:00Z')).toBe(1);
    expect(trashDaysLeft('2026-09-10T12:00:00Z', '2026-09-18T00:00:00Z')).toBe(0);
  });
});
