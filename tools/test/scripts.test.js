import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../sync-shared.mjs';
import { collectFiles, makeZip } from '../make-zip.mjs';
import { ROOT } from '../lib/env.mjs';

test('نسخ الحزمة المشتركة متطابقة مع المصدر في كل التطبيقات', () => { assert.deepEqual(check(), []); });

test('ملف التسليم لا يحوي أسرارًا ولا بيانات محلية، ويحوي الأجزاء الرئيسية', () => {
  const rels = collectFiles(ROOT).map((f) => f.rel);
  assert.ok(!rels.some((r) => r === '.env' || r.includes('node_modules/') || /(^|\/)data\//.test(r) || /\.(sqlite|dump)$/.test(r)));
  for (const must of ['README.md', '1-database/migrations/001_core.sql', '1-database/scripts/migrate.mjs', '2-api/src/app.js', '2-api/.env.example', '3-admin-dashboard/public/index.html', '4-online-shop/public/index.html', '5-branch-pos/src/headless.js', '5-branch-pos/README.md', '6-backup-server/src/index.js', '6-backup-server/README.md', 'shared/src/index.js']) assert.ok(rels.includes(must), `ناقص: ${must}`);
});

test('ZIP صالح (يفتحه python)، ويحافظ على الأسماء العربية والمحتوى', () => {
  const root = mkdtempSync(join(tmpdir(), 'zp-')); mkdirSync(join(root, 'data')); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, '.env'), 'SECRET=1'); writeFileSync(join(root, 'data/x.txt'), 'x'); writeFileSync(join(root, 'docs/دليل.md'), '# مرحبًا'.repeat(500)); writeFileSync(join(root, 'a.js'), 'console.log(1)');
  const out = join(root, 'o.zip'); const r = makeZip(out, root, 'pkg'); assert.equal(r.files, 2);
  const py = spawnSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(sorted(z.namelist())));print(z.read("pkg/docs/دليل.md").decode()[:8])', out], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr); assert.equal(py.stdout.trim().split('\n')[0], 'pkg/a.js|pkg/docs/دليل.md'); assert.match(py.stdout, /# مرحبًا/);
  rmSync(root, { recursive: true, force: true });
});
