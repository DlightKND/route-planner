/** Pure, opt-in telemetry decisions. No database writes or inferred clock time.
 * Callers supply depot-calibrated policy and eligible trip IDs at each sample.
 * A server adapter must persist observations/events before applying decisions.
 */
export function lifecyclePolicy(policy) {
  const keys = ['radiusM', 'exitMarginM', 'exitDwellMs', 'returnDwellMs', 'maxGapMs'];
  if (!policy || keys.some(k => !Number.isFinite(policy[k]) || policy[k] <= 0)) {
    throw new Error('Explicit positive depot policy is required');
  }
  return Object.fromEntries(keys.map(k => [k, policy[k]]));
}

export function lifecycleInitial() {
  return { phase: 'waiting', lastTs: null, depotId: null, insideSeen: false,
    exitSince: null, returnSince: null, candidatesChanged: false, tripId: null, startedAt: null,
    finishedAt: null, candidateIds: [], reviewRequired: false };
}

export function lifecycleStep(previous, observation, policy) {
  const cfg = lifecyclePolicy(policy);
  const state = { ...previous, candidateIds: [...previous.candidateIds] };
  const events = [];
  const emit = (kind, extra = {}) => events.push({ kind, ts: observation.ts, ...extra });
  if (!Number.isFinite(observation.ts)) throw new Error('Observation timestamp is required');
  if (observation.kind === 'signal') {
    if (!['start', 'finish'].includes(observation.signal)) throw new Error('Unknown signal');
    emit('engineer_signal', { signal: observation.signal });
    return { state, events }; // A button cannot create or delete measured facts.
  }
  if (observation.kind !== 'position') throw new Error('Unknown observation');
  if (state.lastTs !== null && observation.ts <= state.lastTs) {
    if (observation.ts < state.lastTs) emit('late_observation');
    return { state, events }; // Duplicates are inert; caller retains raw late packets.
  }
  if (!observation.depotId || !Number.isFinite(observation.distanceM) || observation.distanceM < 0 || observation.valid === false) {
    state.exitSince = null; state.returnSince = null;
    if (state.startedAt === null) state.insideSeen = false;
    state.reviewRequired = true;
    emit('invalid_observation');
    return { state, events };
  }
  const gap = state.lastTs !== null && observation.ts - state.lastTs > cfg.maxGapMs;
  if (gap) {
    emit('telemetry_gap', { from: state.lastTs, to: observation.ts });
    state.exitSince = null; state.returnSince = null;
    if (state.startedAt === null) state.insideSeen = false;
    state.reviewRequired = true;
  }
  state.lastTs = observation.ts;
  if (state.phase === 'finished') return { state, events };
  if (state.depotId && state.depotId !== observation.depotId) {
    state.exitSince = null; state.returnSince = null;
    state.reviewRequired = true;
    emit('depot_mismatch');
    return { state, events };
  }
  state.depotId = observation.depotId;
  const inside = observation.distanceM <= cfg.radiusM;
  const outside = observation.distanceM >= cfg.radiusM + cfg.exitMarginM;
  if (state.startedAt === null) {
    if (inside) {
      state.insideSeen = true; state.exitSince = null;
      if (state.phase !== 'unassigned') state.phase = 'armed';
      return { state, events };
    }
    if (!outside) { state.exitSince = null; return { state, events }; }
    if (!state.insideSeen) {
      if (!state.reviewRequired) emit('outside_without_departure');
      state.reviewRequired = true;
      return { state, events };
    }
    if (state.phase === 'unassigned') return { state, events };
    if (state.exitSince === null) {
      state.exitSince = observation.ts;
      state.candidateIds = [...new Set(observation.candidateIds || [])].sort();
      state.candidatesChanged = false;
    }
    const currentIds = [...new Set(observation.candidateIds || [])].sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(state.candidateIds)) state.candidatesChanged = true;
    if (observation.ts - state.exitSince < cfg.exitDwellMs) return { state, events };
    // Membership changing during confirmation is also ambiguous. Do not silently
    // select a newly assigned trip for movement observed under another plan.
    if (state.candidateIds.length !== 1 || state.candidatesChanged) {
      state.phase = 'unassigned'; state.reviewRequired = true;
      emit('unassigned_departure', { observedAt: state.exitSince, candidateIds: [...state.candidateIds], currentIds });
      return { state, events };
    }
    state.tripId = state.candidateIds[0]; state.startedAt = state.exitSince;
    state.phase = 'active';
    emit('trip_started', { tripId: state.tripId, observedAt: state.startedAt });
    return { state, events };
  }
  if (!inside) {
    if (state.returnSince !== null) emit('return_cancelled', { tripId: state.tripId });
    state.returnSince = null; state.phase = 'active';
    return { state, events };
  }
  if (state.returnSince === null) {
    state.returnSince = observation.ts; state.phase = 'return_pending';
    emit('return_candidate', { tripId: state.tripId, observedAt: state.returnSince });
  }
  if (observation.ts - state.returnSince >= cfg.returnDwellMs) {
    state.finishedAt = state.returnSince; state.phase = 'finished';
    emit('trip_finished', { tripId: state.tripId, observedAt: state.finishedAt, reviewRequired: state.reviewRequired });
  }
  return { state, events };
}
