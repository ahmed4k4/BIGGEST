export class DbError extends Error {
  constructor(message, code) { super(message); this.name = 'DbError'; this.code = code; }
}

/** معاملات jsonb التي قد تحمل قيمة بسيطة (نص/رقم/منطقي): تُرمَّز JSON في سائقي psql وpg. PostgREST يفعلها تلقائيًا. */
export const JSON_SCALAR_PARAMS = new Set(['p_value']);
