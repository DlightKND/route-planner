export const isImportedRequestFinanceRow = row => !!row?.legacy_task_item_id;
export const canEditRequestFinanceRow = (row, allowed) => !!allowed && !isImportedRequestFinanceRow(row);
