/** نسخ احتياطي: pg_dump → ملف مضغوط، تدوير 7 يومية + 4 أسبوعية + 12 شهرية، والتحقق بالاستعادة في قاعدة مؤقتة. */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const FILE_RE = /^backup-(\d{4})-(\d{2})-(\d{2})\.dump$/;
const run = (cmd, args, env = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.once('error', (e) => reject(new Error(`تعذّر تشغيل ${cmd}: ${e.message}`)));
  p.once('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(`${cmd} فشل (${c}): ${err.trim().slice(0, 300)}`))));
});

export const dayKey = (d = new Date(), tz = 'Africa/Cairo') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

function isoWeek(dateStr) { const d = new Date(`${dateStr}T00:00:00Z`); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const first = new Date(Date.UTC(y, 0, 4)); return `${y}-W${1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)}`; }

/** دالة نقية: من قائمة تواريخ (YYYY-MM-DD) تُرجع ما يُحتفظ به. */
export function selectRetention(days, { daily = 7, weekly = 4, monthly = 12 } = {}) {
  const sorted = [...new Set(days)].sort().reverse(); const keep = new Set(sorted.slice(0, daily));
  const take = (keyFn, n) => { const seen = new Set(); for (const d of sorted) { const k = keyFn(d); if (!seen.has(k)) { seen.add(k); if (seen.size <= n) keep.add(d); } } };
  take(isoWeek, weekly); take((d) => d.slice(0, 7), monthly);
  return keep;
}

export function listBackups(dir) {
  try { return readdirSync(dir).map((f) => ({ f, m: FILE_RE.exec(f) })).filter((x) => x.m).map((x) => ({ file: join(dir, x.f), day: `${x.m[1]}-${x.m[2]}-${x.m[3]}`, size: statSync(join(dir, x.f)).size })).sort((a, b) => a.day.localeCompare(b.day)); } catch { return []; }
}

export function rotate(dir, policy) {
  const all = listBackups(dir); const keep = selectRetention(all.map((b) => b.day), policy); const removed = [];
  for (const b of all) if (!keep.has(b.day)) { unlinkSync(b.file); removed.push(b.file); }
  return removed;
}

/** @param {{sourceUrl:string, dir:string, now?:Date, policy?:object}} o */
export async function runBackup({ sourceUrl, dir, now = new Date(), policy }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `backup-${dayKey(now)}.dump`); const tmp = `${file}.partial`;
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--compress=6', '--file', tmp, sourceUrl]);
  if (statSync(tmp).size < 1024) { unlinkSync(tmp); throw new Error('ملف النسخة صغير جدًا، يبدو أن النسخ فشل'); }
  renameSync(tmp, file);
  return { file, size: statSync(file).size, removed: rotate(dir, policy) };
}

/**
 * تحقق: استعادة النسخة في قاعدة مؤقتة وعدّ الجداول الرئيسية.
 * @param {{file:string, adminUrl:string, tables?:string[]}} o  adminUrl اتصال بقاعدة postgres بصلاحية create database
 */
export async function verifyBackup({ file, adminUrl, tables = ['invoices', 'stock_movements', 'variants'] }) {
  await run('pg_restore', ['--list', file]);
  const name = `verify_${Date.now()}`; const base = adminUrl.replace(/\/[^/?]*(\?.*)?$/, '');
  await run('psql', [adminUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`]);
  try {
    await run('pg_restore', ['--no-owner', '--no-privileges', '--dbname', `${base}/${name}`, file]);
    const counts = {};
    for (const t of tables) counts[t] = Number((await run('psql', [`${base}/${name}`, '-X', '-At', '-c', `select count(*) from public.${t}`])).trim());
    return { ok: true, counts };
  } finally { await run('psql', [adminUrl, '-X', '-q', '-c', `drop database if exists ${name} with (force)`]).catch(() => {}); }
}
