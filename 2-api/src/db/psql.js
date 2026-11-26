/**
 * سائق قاعدة بيانات للتطوير والاختبار: ينفّذ دوال SQL عبر أداة psql (لا يحتاج أي مكتبة npm).
 * الإنتاج على Cloudflare يستخدم postgrest.js (Supabase RPC) بنفس الواجهة: db.rpc(name, namedArgs).
 */
import { spawn } from 'node:child_process';
import { DbError, JSON_SCALAR_PARAMS } from './errors.js';

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replaceAll("'", "''")}'`;   // standard_conforming_strings = on
};

export function createPsqlDb({ psql = 'psql', args = [], env = {} } = {}) {
  const run = (sql) => new Promise((resolve, reject) => {
    const p = spawn(psql, [...args, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env: { ...process.env, ...env } });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve(out.trim());
      const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(err);
      reject(new DbError(m ? m[2].trim() : err.trim() || 'db error', m?.[1]));
    });
    p.stdin.end(`${sql}\n`);
  });

  return {
    async rpc(name, params = {}) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new DbError('اسم دالة غير صالح');
      const argSql = Object.entries(params).map(([k, v]) => `${k} => ${lit(JSON_SCALAR_PARAMS.has(k) && v !== null ? JSON.stringify(v) : v)}`).join(', ');
      const out = await run(`select case when pg_typeof(r) = 'void'::regtype then 'null'::jsonb else to_jsonb(r) end from (select ${name}(${argSql}) as r) s;`);
      return out ? JSON.parse(out) : null;
    },
    close() {},
  };
}
