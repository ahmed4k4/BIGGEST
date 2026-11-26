#!/usr/bin/env node
/** يجمع كل الـ migrations + البيانات الأولية في ملف واحد all-in-one.sql ليُلصق في Supabase ← SQL Editor (بدون تثبيت أي شيء).  node scripts/build-single-sql.mjs */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const dir = join(ROOT, 'migrations');
const parts = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => `-- ===== ${f} =====\n${readFileSync(join(dir, f), 'utf8')}`);
parts.push(`-- ===== seed.sql =====\n${readFileSync(join(ROOT, 'seed.sql'), 'utf8')}`);
writeFileSync(join(ROOT, 'all-in-one.sql'), parts.join('\n\n'));
console.log('تم إنشاء all-in-one.sql — الصقه كله في Supabase SQL Editor ثم Run (مرة واحدة فقط على قاعدة جديدة).');
