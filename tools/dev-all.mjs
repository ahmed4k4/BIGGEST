#!/usr/bin/env node
/** تشغيل "السحابة" كلها محليًا للتجربة: API + لوحة الإدارة + المتجر.  node tools/dev-all.mjs  (يحتاج 2-api/.env) */
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './lib/env.mjs';

const run = (name, cwd, args) => { const p = spawn(process.execPath, args, { cwd: join(ROOT, cwd), stdio: 'inherit' }); p.on('exit', (c) => { console.log(`${name} توقف (${c})`); }); return p; };
run('API', '2-api', ['scripts/dev.mjs']);
run('الإدارة', '3-admin-dashboard', ['scripts/serve.mjs']);
run('المتجر', '4-online-shop', ['scripts/serve.mjs']);
console.log('\nالـ API http://127.0.0.1:8787  •  الإدارة http://127.0.0.1:5173  •  المتجر http://127.0.0.1:5174\n');
