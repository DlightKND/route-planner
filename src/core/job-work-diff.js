const FIELDS = [
  'work_id', 'title', 'hours', 'billable', 'billable_reason',
  'revenue', 'revenue_override', 'tariff_profile'
];

function value(row, field) {
  const v = row?.[field];
  if (field === 'hours' || field === 'revenue' || field === 'revenue_override')
    return v == null || v === '' ? null : Number(v);
  if (field === 'billable') return v !== false;
  if (field === 'title' || field === 'billable_reason') return String(v || '');
  return v ?? null;
}

function sameScope(a, b) {
  return FIELDS.every(field => Object.is(value(a, field), value(b, field)));
}

export function hasStableJobWorkIds(rows) {
  return Array.isArray(rows) && rows.every(row => !!row?.id);
}

// Reconcile the complete editor state without replacing every persisted row.
// A row's ID is durable provenance for downstream task migration. Unchanged
// rows are omitted from writes; edited rows keep their ID and are re-approved
// by a manager; new rows receive a database ID; removed rows are deleted.
export function diffJobWorks(existingRows, proposedRows, approval = {}) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const proposed = Array.isArray(proposedRows) ? proposedRows : [];
  const byId = new Map(existing.map(row => [String(row.id), row]));
  const retained = new Set();
  const upserts = [];
  const upsertIndexes = [];

  for (const [index, source] of proposed.entries()) {
    const row = { ...source };
    const prior = row.id == null ? null : byId.get(String(row.id));
    if (prior) {
      retained.add(String(prior.id));
      if (sameScope(prior, row)) continue;
      row.id = prior.id;
      row.approved_at = approval.approvedBy ? (approval.approvedAt || new Date().toISOString()) : null;
      row.approved_by = approval.approvedBy || null;
    } else {
      // Do not recreate a row that disappeared since the editor was loaded.
      delete row.id;
      delete row.approved_at;
      delete row.approved_by;
      delete row.created_at;
    }
    upserts.push(row);
    upsertIndexes.push(index);
  }

  return {
    upserts,
    upsertIndexes,
    deleteIds: existing
      .filter(row => !retained.has(String(row.id)))
      .map(row => row.id)
  };
}
