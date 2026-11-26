import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackup, verifyBackup, listBackups } from '../../6-backup-server/src/backup.js';
import { weeklyExport } from '../../6-backup-server/src/export.js';
import { checkHealth } from '../../6-backup-server/src/monitor.js';
import { makeTestApp, pgAvailable, MAIN, CAI } from '../../2-api/test/helpers.js';

const skip = pgAvailable() ? false : 'يحتاج PostgreSQL: اضبط PGHOST (راجع tools/README.md)';
const tmp = () => mkdtempSync(join(tmpdir(), 'sa-'));

test('التكامل: نسخة احتياطية حقيقية + تحقق بالاستعادة + تصدير أسبوعي + مراقبة', { skip }, async () => {
  const t = await makeTestApp(); const dir = tmp();
  try {
    await t.mkUser('owner', 'super_admin', 'Owner#12345');
    const owner = await t.login('owner', 'Owner#12345');
    const m = await t.call('POST', '/models', { token: owner, body: { name: 'قميص', pricePiasters: 10000, costPiasters: 5000 } });
    await t.call('POST', `/models/${m.data.id}/variants`, { token: owner, body: { colors: ['01'], sizes: ['M'] } });
    const v = (await t.call('GET', `/models/${m.data.id}`, { token: owner })).data.variants[0];
    await t.call('POST', '/receipts', { token: owner, body: { branchId: MAIN, lines: [{ variantId: v.id, qty: 5 }] } });
    const dev = (await t.call('POST', '/devices', { token: owner, body: { name: 'SRV', kind: 'server_agent' } }));
    assert.equal(dev.status, 200, JSON.stringify(dev.data)); const token = dev.data.deviceToken;
    const branchTok = (await t.call('POST', '/devices', { token: owner, body: { name: 'POS', branchId: CAI } })).data.deviceToken;
    assert.equal((await t.call('GET', '/sync/weekly-export?from=2026-01-01&to=2026-12-31', { device: branchTok })).status, 403, 'جهاز الفرع لا يصدّر');

    const dbName = t.name;
    const sourceUrl = `postgres://${process.env.PGUSER ?? 'postgres'}@${encodeURIComponent(process.env.PGHOST)}:${process.env.PGPORT ?? 5432}/${dbName}`;
    const adminUrl = sourceUrl.replace(/\/[^/]*$/, '/postgres');
    const bdir = join(dir, 'backups');
    const b = await runBackup({ sourceUrl, dir: bdir, now: new Date('2026-11-24T10:00:00Z') });
    assert.ok(existsSync(b.file) && b.size > 1024);
    const ver = await verifyBackup({ file: b.file, adminUrl });
    assert.equal(ver.counts.variants, 1); assert.equal(ver.counts.stock_movements, 1);
    await runBackup({ sourceUrl, dir: bdir, now: new Date('2026-11-25T10:00:00Z') });
    assert.equal(listBackups(bdir).length, 2);
    assert.equal(readdirSync(bdir).filter((x) => x.endsWith('.partial')).length, 0);

    const cloud = (url, init) => t.app.fetch(new Request(url, init));
    const ex = await weeklyExport({ cloudUrl: 'http://t', deviceToken: token, outDir: join(dir, 'ex'), from: '2026-01-01', to: '2027-12-31', fetchImpl: cloud });
    assert.equal(ex.counts['stock-movements'], 1); assert.ok(existsSync(ex.xlsx)); assert.ok(readFileSync(ex.csv.find((c) => c.includes('stock-movements')), 'utf8').includes(v.sku));

    const h = await checkHealth({ cloudUrl: 'http://t', deviceToken: token, dir: bdir, fetchImpl: cloud, now: new Date('2026-11-25T12:00:00Z') });
    assert.equal(h.cloud.ok, true); assert.equal(h.lastBackup.day, '2026-11-25'); assert.equal(h.ok, true, h.warnings.join());
    const stale = await checkHealth({ cloudUrl: 'http://t', deviceToken: token, dir: bdir, fetchImpl: cloud, now: new Date('2026-12-30T12:00:00Z') });
    assert.ok(stale.warnings.some((w) => /قديمة/.test(w)));
    const down = await checkHealth({ cloudUrl: 'http://t', deviceToken: token, dir: bdir, fetchImpl: () => Promise.reject(new Error('offline')), now: new Date('2026-11-25T12:00:00Z') });
    assert.equal(down.cloud.ok, false);
  } finally { t.drop(); rmSync(dir, { recursive: true, force: true }); }
});
