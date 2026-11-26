import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildXlsx, toCsv } from '../src/xlsx.js';
import { selectRetention } from '../src/backup.js';
import { lastWeekRange } from '../src/export.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sa-'));

test('تدوير النسخ: 7 يومية + 4 أسبوعية + 12 شهرية', () => {
  const days = []; for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 10, 24) - i * 86400000); days.push(d.toISOString().slice(0, 10)); }
  const keep = selectRetention(days);
  assert.ok(days.slice(0, 7).every((d) => keep.has(d)), 'آخر 7 أيام كلها');
  assert.ok(keep.size >= 7 + 3 && keep.size <= 7 + 4 + 12, `العدد ${keep.size}`);
  assert.ok(!keep.has(days[300]), 'قديم جدًا يُحذف');
  assert.deepEqual([...selectRetention(['2026-11-01'])], ['2026-11-01']);
});

test('الأسبوع الماضي: من الأحد إلى السبت', () => {
  assert.deepEqual(lastWeekRange(new Date('2026-11-24T10:00:00Z')), { from: '2026-11-15', to: '2026-11-21' }); // الثلاثاء 24
  assert.deepEqual(lastWeekRange(new Date('2026-11-22T10:00:00Z')), { from: '2026-11-15', to: '2026-11-21' }); // الأحد 22
});

test('XLSX يفتحه openpyxl بنفس البيانات العربية، وCSV بـ BOM', () => {
  const dir = tmp(); const f = join(dir, 't.xlsx');
  writeFileSync(f, buildXlsx({ 'المبيعات': [{ 'الرقم': 'CAI-1', 'الإجمالي': 120.5, 'ملاحظة': 'a<b & "c"' }, { 'الرقم': 'CAI-2', 'الإجمالي': 80 }], 'فارغة': [] }));
  const py = spawnSync('python3', ['-I', '-c', `import openpyxl,json,sys;wb=openpyxl.load_workbook(sys.argv[1]);ws=wb['المبيعات'];print(json.dumps([wb.sheetnames,[[c.value for c in r] for r in ws.iter_rows()],ws.sheet_view.rightToLeft],ensure_ascii=False))`, f], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const [names, rows, rtl] = JSON.parse(py.stdout);
  assert.deepEqual(names, ['المبيعات', 'فارغة']); assert.equal(rtl, true);
  assert.deepEqual(rows, [['الرقم', 'الإجمالي', 'ملاحظة'], ['CAI-1', 120.5, 'a<b & "c"'], ['CAI-2', 80, null]]);
  assert.ok(toCsv([{ a: 'x,y' }]).startsWith('﻿a\r\n"x,y"'));
  rmSync(dir, { recursive: true, force: true });
});
