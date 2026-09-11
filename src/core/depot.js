import { haversineKm } from './track.js';

export const DEPOT_DEFAULTS = Object.freeze({ radiusKm: 5, exitMarginKm: 0.3, outsideMinutes: 60, maxGapMinutes: 5, maxKmh: 300 });

export function validateDepotPair(previous, candidate, maxKmh = DEPOT_DEFAULTS.maxKmh) {
  if (!candidate || candidate.lat == null || candidate.lng == null || !candidate.ts) return { ok: false, reason: 'bad_point' };
  if (!previous) return { ok: true, km: 0, ms: 0, kmh: 0 };
  const ms = +new Date(candidate.ts) - +new Date(previous.ts);
  if (!(ms > 0)) return { ok: false, reason: 'bad_time' };
  const km = haversineKm(previous, candidate), kmh = km / (ms / 3600000);
  return kmh <= maxKmh ? { ok: true, km, ms, kmh } : { ok: false, reason: 'speed', km, ms, kmh };
}

export function depotPresence(previous, point, config = {}) {
  const o = { ...DEPOT_DEFAULTS, ...config }, before = previous || { state: 'unknown' };
  if (!point || point.valid === false || !Number.isFinite(+point.distanceKm)) return before;
  const at = +new Date(point.ts), distanceKm = +point.distanceKm;
  if (distanceKm <= o.radiusKm) {
    return { state: 'inside', insideSince: before.state === 'inside' ? before.insideSince : point.ts,
      outsideSince: null, distanceKm, updatedAt: point.ts };
  }
  if (distanceKm < o.radiusKm + o.exitMarginKm) return { ...before, distanceKm, updatedAt: point.ts };
  const gap = before.updatedAt ? at - +new Date(before.updatedAt) : 0;
  const outsideSince = gap > o.maxGapMinutes * 60000 ? point.ts : (before.outsideSince || point.ts);
  const confirmed = at - +new Date(outsideSince) >= o.outsideMinutes * 60000;
  return { state: confirmed ? 'outside' : 'outside_candidate', insideSince: before.insideSince || null,
    outsideSince, distanceKm, updatedAt: point.ts };
}
