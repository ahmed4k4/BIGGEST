import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPsqlDb } from '../src/db/psql.js';
import { createApp } from '../src/app.js';
import { hashSecret } from '../src/shared/index.js';

// مجلد قاعدة البيانات: بجوار هذا المجلد (1-database) أو عبر DB_DIR
const dbRoot = process.env.DB_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../../1-database');
export const COMPANY = '00000000-0000-4000-8000-000000000001';
export const MAIN = '00000000-0000-4000-8000-0000000000a1';
export const CAI = '00000000-0000-4000-8000-0000000000b1';
export const WEB = '00000000-0000-4000-8000-0000000000c1';
export const pgAvailable = () => !!(process.env.PGHOST || process.env.TEST_DATABASE_URL) && existsSync(join(dbRoot, 'migrations'));

const psqlArgs = (db) => (process.env.TEST_DATABASE_URL ? [process.env.TEST_DATABASE_URL.replace(/\/[^/]*$/, `/${db}`)] : ['-d', db]);
const sh = (db, args) => execFileSync('psql', [...psqlArgs(db), '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

/** قاعدة اختبار جديدة لكل ملف: كل الـ migrations + seed. */
export async function makeTestApp() {
  const name = `erp_t_${process.pid}_${Date.now() % 100000}`;
  sh('postgres', ['-c', `create database ${name}`]);
  const dir = join(dbRoot, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) sh(name, ['-f', join(dir, f)]);
  sh(name, ['-f', join(dbRoot, 'seed.sql')]);
  const db = createPsqlDb({ args: psqlArgs(name) });
  const config = { companyId: COMPANY, jwtSecret: 'test-secret-test-secret-test-secret-1234', sessionHours: 1, allowedOrigins: ['*'] };
  const store = new Map();
  const storage = { put: async (k, b) => store.set(k, b), get: async (k) => store.get(k) ?? null };
  const app = createApp({ db, config, storage });

  const mkUser = (username, role, password, branch_id = null) =>
    hashSecret(password, 1000).then((password_hash) => db.rpc('api_insert', { p_table: 'users', p_row: { company_id: COMPANY, username, display_name: username, role, branch_id, password_hash } }));

  async function call(method, path, { token, device, body, headers = {} } = {}) {
    const h = { 'content-type': 'application/json', ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (device) h.authorization = `Device ${device}`;
    const res = await app.fetch(new Request(`http://t${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  async function login(username, password) { const r = await call('POST', '/auth/login', { body: { username, password } }); return r.data.token; }
  return { app, db, name, call, login, mkUser, drop: () => { try { sh('postgres', ['-c', `drop database if exists ${name} with (force)`]); } catch {} } };
}
