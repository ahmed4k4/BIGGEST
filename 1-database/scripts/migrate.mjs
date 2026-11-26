#!/usr/bin/env node
/** يطبّق migrations/ بالترتيب (مرة واحدة لكل ملف) عبر psql ويسجّل في schema_migrations.  الاستخدام: node scripts/migrate.mjs [--seed] */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, ROOT } from './env.mjs';

const env = loadEnv();
if (!env.DATABASE_URL) { console.error('اضبط DATABASE_URL في ملف .env'); process.exit(1); }
const psql = (args, opts = {}) => execFileSync('psql', [env.DATABASE_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', ...opts });
try { psql(['-c', 'select 1']); } catch (e) { console.error('تعذّر الاتصال بقاعدة البيانات. تأكد أنها تعمل وأن أداة psql مثبتة.\n' + (e.stderr ?? e.message)); process.exit(1); }

psql(['-c', 'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())']);
const done = new Set(psql(['-c', 'select name from schema_migrations']).split('\n').filter(Boolean));
const dir = join(ROOT, 'migrations');
let n = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  psql(['-f', join(dir, f)]);
  psql(['-c', `insert into schema_migrations(name) values ('${f}')`]);
  console.log('طُبّق', f); n++;
}
console.log(n ? `تم تطبيق ${n} ملف` : 'القاعدة محدّثة');
if (process.argv.includes('--seed')) { psql(['-f', join(ROOT, 'seed.sql')]); console.log('تم تحميل البيانات الأولية'); }
