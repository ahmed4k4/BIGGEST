/** سائق الاستضافة الذاتية: مكتبة pg (اختيارية: npm i pg). نفس واجهة db.rpc. */
import { DbError, JSON_SCALAR_PARAMS } from './errors.js';

export async function createPgDb({ connectionString, max = 5 }) {
  let pg;
  try { pg = (await import('pg')).default; } catch { throw new DbError('ثبّت مكتبة pg: npm i pg --workspace apps/api'); }
  const pool = new pg.Pool({ connectionString, max });
  return {
    async rpc(name, params = {}) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new DbError('اسم دالة غير صالح');
      const keys = Object.keys(params);
      // القيم المركّبة تُرسل JSON نصًا وتُحوَّل لـ jsonb في القاعدة (pg يحوّل المصفوفات لمصفوفات PG فنتجنب ذلك)
      const vals = keys.map((k) => ((params[k] !== null && typeof params[k] === 'object') || (JSON_SCALAR_PARAMS.has(k) && params[k] !== null) ? JSON.stringify(params[k]) : params[k]));
      try {
        const r = await pool.query(`select case when pg_typeof(r) = 'void'::regtype then 'null'::jsonb else to_jsonb(r) end as v from (select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r) s`, vals);
        return r.rows[0]?.v ?? null;
      } catch (e) { throw new DbError(e.message, e.code); }
    },
    close: () => pool.end(),
  };
}
