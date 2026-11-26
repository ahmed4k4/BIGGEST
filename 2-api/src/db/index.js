import { createPsqlDb } from './psql.js';
import { createPostgrestDb } from './postgrest.js';
import { createPgDb } from './pg.js';

/**
 * يختار السائق من المتغيرات:
 *  SUPABASE_URL (+ SUPABASE_SERVICE_KEY) → PostgREST (Cloudflare Workers / الإنتاج)
 *  DATABASE_URL + مكتبة pg                → pg (استضافة ذاتية / تطوير)
 *  DATABASE_URL بدون pg                    → psql (اختبارات وتطوير بدون أي مكتبة)
 */
export async function createDbFromEnv(env) {
  if (env.SUPABASE_URL) return createPostgrestDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY });
  if (env.DATABASE_URL) {
    try { return await createPgDb({ connectionString: env.DATABASE_URL }); } catch { return createPsqlDb({ args: [env.DATABASE_URL] }); }
  }
  throw new Error('اضبط SUPABASE_URL+SUPABASE_SERVICE_KEY (إنتاج) أو DATABASE_URL (تطوير/استضافة ذاتية)');
}
export { createPsqlDb, createPostgrestDb, createPgDb };
