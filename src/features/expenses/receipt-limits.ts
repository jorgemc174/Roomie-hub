export const RECEIPT_BUCKET = 'expense-receipts';
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);
export const RECEIPT_ACCEPT = [...extensions.keys()].join(',');

export function allowedReceiptExtension(type: string, size: number) {
  if (!Number.isInteger(size) || size < 1 || size > RECEIPT_MAX_BYTES) return;
  return extensions.get(type);
}

export function receiptStagingFolder(homeId: string, userId: string) {
  return `${homeId}/staging/${userId}/`;
}
