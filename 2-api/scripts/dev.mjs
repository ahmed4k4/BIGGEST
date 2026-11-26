#!/usr/bin/env node
/** يشغّل الـ API محليًا على Node (للتطوير أو لتشغيله على سيرفر خاص بدل Cloudflare).  node scripts/dev.mjs */
import { loadEnv } from './env.mjs';
import { startServer } from '../src/server-node.js';

const env = loadEnv();
const server = await startServer(env, Number(env.PORT ?? 8787));
console.log(`الـ API يعمل: http://127.0.0.1:${server.address().port}   (للفحص: /health)`);
