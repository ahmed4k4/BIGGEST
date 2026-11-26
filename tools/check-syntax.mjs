#!/usr/bin/env node
/** فحص صياغة كل ملفات JS في المشروع (node --check) وتطابق نسخ shared. */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { check } from './sync-shared.mjs';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { if (f === 'node_modules' || f === '.git') continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(m?js)$/.test(f) && files.push(p); } })(ROOT);
let bad = 0;
for (const f of files) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error('✖', f, '\n', e.stderr?.toString().split('\n').slice(0, 4).join('\n')); } }
const drift = check(); if (drift.length) { bad++; console.error('نسخ shared غير متزامنة:', drift.slice(0, 5)); }
console.log(bad ? `فشل: ${bad}` : `سليم ✔ (${files.length} ملف)`); process.exit(bad ? 1 : 0);
