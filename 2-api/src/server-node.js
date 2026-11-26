#!/usr/bin/env node
/** تشغيل الـ API على Node (تطوير أو استضافة ذاتية). على Cloudflare استخدم worker.js. */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createDbFromEnv } from './db/index.js';
import { createLocalStorage } from './storage.js';

export async function startServer(env = process.env, port = Number(env.PORT ?? 8787)) {
  const config = readConfig(env);
  const app = createApp({ db: await createDbFromEnv(env), config, storage: createLocalStorage(env.UPLOAD_DIR ?? './data/uploads') });
  const server = createServer(async (nreq, nres) => {
    const url = `http://${nreq.headers.host ?? 'localhost'}${nreq.url}`;
    const hasBody = !['GET', 'HEAD'].includes(nreq.method);
    const req = new Request(url, { method: nreq.method, headers: nreq.headers, body: hasBody ? Readable.toWeb(nreq) : undefined, duplex: 'half' });
    const res = await app.fetch(req);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise((r) => server.listen(port, env.HOST ?? '127.0.0.1', r));
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  startServer().then((s) => console.log(`API على http://${s.address().address}:${s.address().port}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
