#!/usr/bin/env node
/**
 * ينسخ الحزمة المشتركة (shared/src) إلى كل تطبيق في مجلد shared/ داخله.
 * لماذا النسخ؟ حتى يعمل المشروع بدون npm install، وحتى تستورد واجهات المتصفح (الإدارة والمتجر) نفس الكود بمسار نسبي.
 * المصدر الوحيد للتعديل: shared/src.   التحقق: node scripts/sync-shared.mjs --check
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'shared/src');
export const TARGETS = ['2-api/src/shared', '3-admin-dashboard/public/js/shared', '4-online-shop/public/js/shared', '5-branch-pos/src/shared', '5-branch-pos/ui/js/shared'];
const files = readdirSync(src).filter((f) => f.endsWith('.js'));

export function check() {
  const bad = [];
  for (const t of TARGETS) for (const f of files) {
    const p = join(root, t, f);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== readFileSync(join(src, f), 'utf8')) bad.push(`${t}/${f}`);
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = check();
    if (bad.length) { console.error('نسخ غير متزامنة (شغّل node tools/sync-shared.mjs):\n' + bad.join('\n')); process.exit(1); }
    console.log('كل نسخ shared متطابقة ✔');
  } else {
    for (const t of TARGETS) { rmSync(join(root, t), { recursive: true, force: true }); mkdirSync(join(root, t), { recursive: true }); cpSync(src, join(root, t), { recursive: true }); }
    console.log(`نُسخت ${files.length} ملفات إلى ${TARGETS.length} أماكن`);
  }
}
