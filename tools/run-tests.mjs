#!/usr/bin/env node
/** يشغّل اختبارات كل المشاريع + اختبارات التكامل بينها.  node tools/run-tests.mjs  (اضبط PGHOST/PGUSER لاختبارات PostgreSQL) */
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/env.mjs';

const globs = ['shared/test/*.test.js', '2-api/test/*.test.js', '5-branch-pos/test/*.test.js', '6-backup-server/test/*.test.js', 'tools/integration/*.test.js', 'tools/test/*.test.js'];
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...globs], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
