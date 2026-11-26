#!/usr/bin/env node
/**
 * تشغيل تطبيق الفرع بدون Electron: خادم محلي + مزامنة + واجهة الكاشير.
 *   node apps/branch-agent/src/headless.js        ثم افتح http://127.0.0.1:7070 (يُفضَّل وضع التطبيق: chrome --app=...)
 * متغيرات: BRANCH_DATA_DIR, BRANCH_PORT, CLOUD_URL, DEVICE_TOKEN (اختياريان: يمكن التفعيل من الواجهة).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Pos } from './pos.js';
import { SyncEngine } from './sync.js';
import { Printer } from './printer.js';
import { createAgent } from './agent.js';
import { loadEnv } from '../scripts/env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function startBranchAgent({ dataDir = './data/branch', port = 7070, cloudUrl, deviceToken, fetchImpl = fetch, uiDir = join(HERE, '../ui'), autoSync = true, log = console.log } = {}) {
  const db = openDb(join(dataDir, 'branch.sqlite'));
  const stored = db.meta('device', {}) ?? {};
  if (cloudUrl && deviceToken && (stored.cloudUrl !== cloudUrl || stored.deviceToken !== deviceToken)) Object.assign(stored, { cloudUrl, deviceToken });

  const sync = new SyncEngine({ db, cloudUrl: stored.cloudUrl, deviceToken: stored.deviceToken, branchId: stored.branchId, fetchImpl, log });
  const pos = new Pos({ db, branchId: stored.branchId, deviceId: stored.deviceId, posNo: stored.posNo ?? 1, isOnline: () => sync.state.online !== false });
  const printer = new Printer(db.meta('printers', {}) ?? {}, { dryDir: join(dataDir, 'print-out') });

  /** التفعيل: نتحقق من التوكن عبر ping ونعرف الفرع والجهاز، ثم أول مزامنة (لقطة كاملة). */
  async function activate({ cloudUrl: url, deviceToken: token }) {
    if (!/^https?:\/\//.test(url) || !token.includes('.')) throw Object.assign(new Error('رابط السحابة أو توكن الجهاز غير صحيح'), { status: 400 });
    const probe = new SyncEngine({ db, cloudUrl: url, deviceToken: token, fetchImpl });
    let info;
    try { info = await probe.http('/sync/ping'); } catch (e) { throw Object.assign(new Error(`تعذّر التفعيل: ${e.message}`), { status: 400 }); }
    if (info.kind !== 'branch_agent' || !info.branchId) throw Object.assign(new Error('هذا التوكن ليس لجهاز فرع'), { status: 400 });
    const cfg = { cloudUrl: url, deviceToken: token, branchId: info.branchId, deviceId: info.deviceId, companyId: info.companyId };
    db.setMeta('device', cfg);
    Object.assign(sync, { cloudUrl: url.replace(/\/$/, ''), deviceToken: token, branchId: info.branchId });
    Object.assign(pos, { branchId: info.branchId, deviceId: info.deviceId });
    await sync.run();
    return { ok: true, branchId: info.branchId, status: sync.status() };
  }

  const agent = createAgent({ pos, db, sync, printer, uiDir, activate });
  const actualPort = await agent.listen(port);
  if (autoSync && sync.configured) sync.start(() => Number(pos.setting('sync.poll_seconds') ?? 300) * 1000);
  log(`تطبيق الفرع يعمل: http://127.0.0.1:${actualPort}`);
  return { db, pos, sync, printer, agent, port: actualPort, stop: async () => { sync.stop(); await agent.close(); db.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const env = loadEnv();
  startBranchAgent({ dataDir: env.BRANCH_DATA_DIR ?? './data', port: Number(env.BRANCH_PORT ?? 7070), cloudUrl: env.CLOUD_URL, deviceToken: env.DEVICE_TOKEN })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
