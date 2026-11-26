/**
 * عقد المزامنة بين Branch Agent والـ API (مشترك حتى لا يختلف الطرفان).
 *
 * الرفع (Outbox):  POST /sync/push  { ops: Op[] }  ->  { results: [{opId, status, error?}] }
 * التنزيل:        GET  /sync/pull?after=<seq>&limit=500  ->  { changes: Change[], nextSeq, hasMore, serverTime }
 */

export const OP_TYPES = Object.freeze({
  SALE_CREATE: 'sale.create',
  CUSTOMER_UPSERT: 'customer.upsert',
  ATTENDANCE_RECORD: 'attendance.record',
  STOCK_COUNT: 'stock.count',
  TRANSFER_RECEIVE: 'transfer.receive',
  SHIFT_CLOSE: 'shift.close',
});

export const OP_STATUS = Object.freeze({ PENDING: 'pending', SYNCED: 'synced', FAILED: 'failed' });

export const MAX_PUSH_BATCH = 100;
export const MAX_PULL_LIMIT = 500;

/**
 * @typedef {{opId:string, type:string, payload:object, deviceTime:string}} Op
 * @typedef {{seq:number, table:string, rowId:string, op:'upsert'|'delete', data:object|null}} Change
 */

/** جداول يستقبلها الفرع من السحابة في اتجاه واحد (قراءة فقط). */
export const PULL_TABLES = Object.freeze([
  'branches', 'categories', 'models', 'variants', 'model_images', 'code_templates',
  'customers', 'settings', 'branch_users', 'stock_movements', 'transfers', 'transfer_lines', 'shift_templates', 'schedules',
]);

export function validateOp(op) {
  if (!op || typeof op !== 'object') return 'عملية غير صالحة';
  if (!/^[0-9a-f-]{36}$/i.test(op.opId ?? '')) return 'opId يجب أن يكون UUID';
  if (!Object.values(OP_TYPES).includes(op.type)) return `نوع عملية غير معروف: ${op.type}`;
  if (!op.payload || typeof op.payload !== 'object') return 'payload مفقود';
  if (Number.isNaN(Date.parse(op.deviceTime))) return 'deviceTime غير صالح';
  return null;
}
