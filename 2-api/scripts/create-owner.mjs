#!/usr/bin/env node
/**
 * ينشئ (أو يحدّث كلمة سر) مستخدم سوبر أدمن للإنتاج — بدل بيانات seed-dev التجريبية.
 *   node scripts/create-owner.mjs --username owner --password "كلمة-سر-قوية-12+"
 */
import { loadEnv } from './env.mjs';
import { readConfig } from '../src/config.js';
import { createDbFromEnv } from '../src/db/index.js';
import { hashSecret } from '../src/shared/index.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const username = arg('username'); const password = arg('password');
if (!username || !password || password.length < 12) { console.error('الاستخدام: node scripts/create-owner.mjs --username owner --password "<12 حرفًا على الأقل>"'); process.exit(1); }
const env = loadEnv(); const config = readConfig(env); const db = await createDbFromEnv(env);
const [ex] = await db.rpc('api_list', { p_table: 'users', p_company: config.companyId, p_where: { username }, p_q: null, p_limit: 1, p_offset: 0 });
const password_hash = await hashSecret(password);
if (ex) { await db.rpc('api_update', { p_table: 'users', p_id: ex.id, p_company: config.companyId, p_patch: { password_hash, role: 'super_admin', is_active: true } }); console.log(`تم تحديث ${username}`); }
else { await db.rpc('api_insert', { p_table: 'users', p_row: { company_id: config.companyId, username, display_name: username, role: 'super_admin', password_hash } }); console.log(`تم إنشاء السوبر أدمن ${username}`); }
process.exit(0);
