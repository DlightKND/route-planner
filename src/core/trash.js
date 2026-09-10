const DAY = 86400000;

export const TRASH_KEEP_DAYS = 7;

export function trashExpiresAt(deletedAt, keepDays = TRASH_KEEP_DAYS) {
  const ts = Date.parse(deletedAt || '');
  return Number.isFinite(ts) ? new Date(ts + Math.max(0, +keepDays || 0) * DAY) : null;
}

export function trashDaysLeft(deletedAt, now = new Date(), keepDays = TRASH_KEEP_DAYS) {
  const expires = trashExpiresAt(deletedAt, keepDays);
  if (!expires) return null;
  return Math.max(0, Math.ceil((expires.getTime() - new Date(now).getTime()) / DAY));
}
