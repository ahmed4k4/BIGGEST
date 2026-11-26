/** نقطة دخول Cloudflare Workers. الإعدادات والأسرار من wrangler (vars / secrets). */
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPostgrestDb } from './db/postgrest.js';
import { createR2Storage } from './storage.js';

let app;
export default {
  async fetch(request, env) {
    app ??= createApp({
      db: createPostgrestDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY }),
      config: readConfig(env), storage: createR2Storage(env.IMAGES),
    });
    return app.fetch(request);
  },
  /** Cron: إلغاء الطلبات المعلّقة بعد مهلة وإفراج حجزها، وإنهاء التصاريح، وقص change_log. */
  async scheduled(_event, env) {
    const db = createPostgrestDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY });
    await db.rpc('release_stale_orders', { p_company: env.COMPANY_ID, p_minutes: Number(env.ORDER_HOLD_MINUTES ?? 120) });
    await db.rpc('expire_grants', { p_company: env.COMPANY_ID });
    await db.rpc('prune_change_log', { p_company: env.COMPANY_ID, p_days: 30 });
  },
};
