import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
/** جذر هذا المجلد (المجلد الذي فيه package.json و .env). */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** يقرأ ملف .env في هذا المجلد (KEY=VALUE) ويدمجه مع process.env دون استبدال الموجود. */
export function loadEnv() {
  const p = join(ROOT, '.env');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return process.env;
}
