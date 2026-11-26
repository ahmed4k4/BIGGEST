#!/usr/bin/env node
/**
 * السيرفر المحلي (Server Agent): نسخ احتياطي يومي + تصدير أسبوعي + مراقبة.
 *   node apps/server-agent/src/index.js run        جدولة دائمة (للتشغيل كخدمة)
 *   node apps/server-agent/src/index.js backup     نسخة الآن        | verify [file]  تحقق بالاستعادة
 *   node apps/server-agent/src/index.js export     تصدير الأسبوع الماضي | health  فحص
 * متغيرات: SOURCE_DATABASE_URL (اتصال Supabase المباشر)، CLOUD_URL، DEVICE_TOKEN، BACKUP_DIR، ADMIN_DATABASE_URL (للتحقق)،
 *          BACKUP_HOUR (افتراضي 3)، EXPORT_DAY (5 = الجمعة)، ALERT_WEBHOOK.
 */
import { join } from 'node:path';
import { runBackup, verifyBackup, listBackups } from './backup.js';
import { weeklyExport, lastWeekRange } from './export.js';
import { checkHealth, notify } from './monitor.js';
import { loadEnv } from '../scripts/env.mjs';

export function readEnv(env = process.env) {
  return { sourceUrl: env.SOURCE_DATABASE_URL, adminUrl: env.ADMIN_DATABASE_URL, cloudUrl: env.CLOUD_URL, deviceToken: env.DEVICE_TOKEN, dir: env.BACKUP_DIR ?? './data',
    backupHour: Number(env.BACKUP_HOUR ?? 3), exportDay: Number(env.EXPORT_DAY ?? 5), webhook: env.ALERT_WEBHOOK };
}
const need = (c, ...keys) => { const m = keys.filter((k) => !c[k]); if (m.length) throw new Error(`إعدادات ناقصة: ${m.join(', ')}`); };
const cairo = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((p) => [p.type, p.value]));

export async function doBackup(c, log = console.log) {
  need(c, 'sourceUrl');
  const r = await runBackup({ sourceUrl: c.sourceUrl, dir: join(c.dir, 'backups') });
  log(`نسخة جاهزة: ${r.file} (${(r.size / 1e6).toFixed(1)} MB)، حُذف ${r.removed.length} قديمة`);
  if (c.adminUrl) { const v = await verifyBackup({ file: r.file, adminUrl: c.adminUrl }); log('تحقق الاستعادة:', JSON.stringify(v.counts)); r.verified = v; }
  return r;
}
export async function doExport(c, log = console.log) {
  need(c, 'cloudUrl', 'deviceToken');
  const { from, to } = lastWeekRange(); const r = await weeklyExport({ cloudUrl: c.cloudUrl, deviceToken: c.deviceToken, outDir: join(c.dir, 'exports'), from, to });
  log(`تصدير ${from} → ${to}: ${r.xlsx}`, JSON.stringify(r.counts)); return r;
}
export const doHealth = (c) => { need(c, 'cloudUrl', 'deviceToken'); return checkHealth({ cloudUrl: c.cloudUrl, deviceToken: c.deviceToken, dir: join(c.dir, 'backups') }); };

/** حلقة الجدولة: تفحص كل دقيقة، وتنفّذ كل مهمة مرة واحدة في اليوم. */
export function startScheduler(c, log = console.log) {
  const done = new Set(); let lastWarn = '';
  const tick = async () => {
    const t = cairo(); const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const once = async (name, fn) => { const k = `${name}:${day}`; if (done.has(k)) return; done.add(k); try { await fn(); } catch (e) { log(`فشل ${name}: ${e.message}`); await notify(c.webhook, `⚠️ فشل ${name}: ${e.message}`); } };
    if (Number(t.hour) >= c.backupHour) await once('backup', () => doBackup(c, log));
    if (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(t.weekday) === c.exportDay && Number(t.hour) >= c.backupHour) await once('export', () => doExport(c, log));
    if (Number(t.minute) % 5 === 0) { const h = await doHealth(c).catch((e) => ({ warnings: [e.message] })); const w = h.warnings.join(' | '); if (w && w !== lastWarn) await notify(c.webhook, `⚠️ ${w}`); lastWarn = w; }
  };
  tick(); const timer = setInterval(tick, 60_000); return () => clearInterval(timer);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const c = readEnv(loadEnv()); const cmd = process.argv[2] ?? 'run';
  const go = { run: async () => { startScheduler(c); await new Promise(() => {}); }, backup: () => doBackup(c), export: () => doExport(c),
    health: async () => console.log(JSON.stringify(await doHealth(c), null, 2)),
    verify: async () => { need(c, 'adminUrl'); const f = process.argv[3] ?? listBackups(join(c.dir, 'backups')).at(-1)?.file; if (!f) throw new Error('لا توجد نسخة'); console.log(await verifyBackup({ file: f, adminUrl: c.adminUrl })); } }[cmd];
  if (!go) { console.error('الأوامر: run | backup | export | verify | health'); process.exit(2); }
  go().catch((e) => { console.error(e.message); process.exit(1); });
}
