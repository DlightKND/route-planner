// Pending edits take precedence over both a cached request and a fresh server
// response until the queue has actually acknowledged them.
import {mergePendingRequestFinance} from './request-finance-row.js';

export function pendingJobState(items, jobId, serverParts = [], serverWorks = []) {
  const pending = (items || []).filter(it => it.payload?.jobId === jobId)
    .sort((a, b) => a.id - b.id);
  const latest = [...pending].reverse().find(it => it.kind === 'job');
  const payload = latest?.payload || null;
  let parts = payload?.parts_complete && Array.isArray(payload.parts)
    ? payload.parts.map(p => ({...p, id: p.id, local_only: !!p.local_only}))
    : serverParts.map(p => ({...p}));
  const works = payload?.works_complete && Array.isArray(payload.works)
    ? (payload.canonical_generation === 1 ? mergePendingRequestFinance(serverWorks, payload.works) : payload.works)
    : serverWorks;
  if (payload?.canonical_generation === 1 && payload.parts_complete)
    parts = mergePendingRequestFinance(serverParts, parts);
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
  return {payload, works, parts, hasPendingParts: pending.some(it => it.kind === 'part') || !!payload?.parts_complete};
}

export function queuedJobDraftIssue(payload) {
  for (const work of payload?.works_complete ? payload.works || [] : []) {
    if (!String(work.title || '').trim() && !work.work_id) return 'Укажи название работы';
    if (!(Number(work.hours)>0) || !Number.isFinite(Number(work.hours))) return 'Укажи часы у работы «'+(work.title||'без названия')+'»';
    if (work.billable === false && !String(work.billable_reason || '').trim()) return 'Укажи причину гарантийной работы «'+(work.title||'без названия')+'»';
  }
  for (const part of payload?.parts_complete ? payload.parts || [] : []) {
    if (!String(part.name || '').trim()) return 'Укажи название запчасти';
    if (!(Number(part.qty)>0) || !Number.isFinite(Number(part.qty))) return 'Укажи количество запчасти «'+part.name+'»';
    if (!String(part.unit || '').trim()) return 'Укажи единицу запчасти «'+part.name+'»';
  }
  return '';
}
