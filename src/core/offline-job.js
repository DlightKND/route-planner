// Pending edits take precedence over both a cached request and a fresh server
// response until the queue has actually acknowledged them.
export function pendingJobState(items, jobId, serverParts = []) {
  const pending = (items || []).filter(it => it.payload?.jobId === jobId)
    .sort((a, b) => a.id - b.id);
  const latest = [...pending].reverse().find(it => it.kind === 'job');
  const payload = latest?.payload || null;
  let parts = payload?.parts_complete && Array.isArray(payload.parts)
    ? payload.parts.map(p => ({...p, id: p.id, local_only: !!p.local_only}))
    : serverParts.map(p => ({...p}));
  for (const it of pending) {
    if (it.kind !== 'part' || (latest && it.id < latest.id && payload?.parts_complete)) continue;
    const p = it.payload;
    const id = String(p.localId);
    const index = parts.findIndex(row => String(row.id) === id);
    if (p.op === 'del') { if (index >= 0) parts.splice(index, 1); continue; }
    const row = {...p.row, id: p.partId || id, local_only: p.op === 'add'};
    if (index >= 0) parts[index] = {...parts[index], ...row};
    else parts.push(row);
  }
  return {payload, parts, hasPendingParts: pending.some(it => it.kind === 'part') || !!payload?.parts_complete};
}

export function queuedJobDraftIssue(payload) {
  if (!payload?.works_complete || !Array.isArray(payload.works)) return '';
  const work=payload.works.find(w=>!(Number(w.hours)>0));
  return work ? 'Укажи часы у работы «'+(work.title||'без названия')+'»' : '';
}
