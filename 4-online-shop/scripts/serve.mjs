#!/usr/bin/env node
/** خادم ملفات ثابتة صغير لهذا الموقع (للتجربة أو الاستضافة الذاتية).  node scripts/serve.mjs [المنفذ]  أو  PORT=8080 node scripts/serve.mjs */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '../public'));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5174);
const host = process.env.HOST ?? '127.0.0.1';

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, p));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end('forbidden');
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(await readFile(file)); }
  catch { res.writeHead(404).end('not found'); }
}).listen(port, host, () => console.log(`http://${host}:${port}`));
