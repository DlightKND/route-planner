export const isImportedRequestFinanceRow = row => !!row?.legacy_task_item_id;
export const canEditRequestFinanceRow = (row, allowed) => !!allowed && !isImportedRequestFinanceRow(row);

// A canonical snapshot replaces only request-owned editable rows. Imported
// rows are omitted from writes but must remain visible after an offline reload.
export function mergePendingRequestFinance(serverRows = [], pendingRows = []) {
  const imported = serverRows.filter(isImportedRequestFinanceRow);
  const protectedIds = new Set(imported.flatMap(row => [row.id, row.canonical_task_item_id, row.legacy_task_item_id]).filter(Boolean));
  return [...imported, ...pendingRows.filter(row => !isImportedRequestFinanceRow(row) &&
    !protectedIds.has(row.id) && !protectedIds.has(row.canonical_task_item_id))];
}
