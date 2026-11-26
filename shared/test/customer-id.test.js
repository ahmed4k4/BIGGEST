import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { customerIdFor } from '../src/index.js';

test('customerIdFor ثابت وبصيغة UUID', async () => {
  const a = await customerIdFor('00000000-0000-4000-8000-000000000001', '+201012345678');
  assert.match(a, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(a, await customerIdFor('00000000-0000-4000-8000-000000000001', '+201012345678'));
  assert.notEqual(a, await customerIdFor('00000000-0000-4000-8000-000000000001', '+201012345679'));
});

test('يطابق دالة customer_id_for في PostgreSQL', async (t) => {
  if (!process.env.PGHOST) return t.skip('يحتاج PGHOST');
  const sql = `select customer_id_for('00000000-0000-4000-8000-000000000001', '+201012345678')`;
  const out = execFileSync('psql', ['-At', '-d', process.env.PGDATABASE ?? 'erp_dev', '-c', sql], { encoding: 'utf8' }).trim();
  assert.equal(out, await customerIdFor('00000000-0000-4000-8000-000000000001', '+201012345678'));
});
