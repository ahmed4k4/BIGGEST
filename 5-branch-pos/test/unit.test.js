import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Printer } from '../src/printer.js';
import { openDb } from '../src/db.js';

test('الطابعة: tcp وfile وdryrun', async () => {
  const got = []; const srv = net.createServer((s) => { const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => got.push(Buffer.concat(c))); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const d = mkdtempSync(join(tmpdir(), 'pr-'));
  const p = new Printer({ receipt: { type: 'tcp', host: '127.0.0.1', port: srv.address().port }, label: { type: 'file', path: join(d, 'lbl.bin') } }, { dryDir: d });
  await p.send('receipt', Uint8Array.of(1, 2, 3)); await p.send('label', Uint8Array.of(9, 9));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([...got[0]], [1, 2, 3]); assert.deepEqual([...readFileSync(join(d, 'lbl.bin'))], [9, 9]);
  p.setConfig({}); const r = await p.send('receipt', Uint8Array.of(7)); assert.ok(r.dryrun);
  srv.close(); rmSync(d, { recursive: true, force: true });
});

test('اللقطة تحتفظ بالحركات المحلية غير المؤكدة', () => {
  const db = openDb();
  db.addLocalMovement({ id: 'm1', variantId: 'v1', qtyDelta: -2, kind: 'sale', createdAt: new Date().toISOString() });
  db.applySnapshot({ seq: 5, tables: { stock_movements: [{ id: 'm0', variant_id: 'v1', qty_delta: 10, kind: 'receipt', branch_id: 'b' }] } }, 'b');
  assert.equal(db.stockOf('v1'), 8);
});
