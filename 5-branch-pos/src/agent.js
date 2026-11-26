/**
 * الخادم المحلي للفرع: يقدّم واجهة الكاشير ويعرض /local/* للواجهة.
 * الأمان: يستمع على 127.0.0.1 فقط، ويرفض أي Host غريب (حماية من DNS-rebinding)،
 * وكل المسارات (عدا الحالة والدخول والتفعيل) تحتاج توكن جلسة يُمنح بعد الدخول.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PosError } from './pos.js';
import { can } from './shared/index.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const SESSION_MS = 12 * 3600_000;

/**
 * @param {{pos:import('./pos.js').Pos, db:import('./db.js').BranchDb, sync:import('./sync.js').SyncEngine, printer:import('./printer.js').Printer, uiDir:string,
 *          activate?:(o:{cloudUrl:string, deviceToken:string})=>Promise<object>}} o
 */
export function createAgent({ pos, db, sync, printer, uiDir, activate }) {
  const sessions = new Map();
  const root = resolve(uiDir);
  let port = 0;

  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
  const readBody = async (req) => { const c = []; let n = 0; for await (const ch of req) { n += ch.length; if (n > 2_000_000) throw new PosError('الطلب كبير', 'TOO_LARGE', 413); c.push(ch); } const t = Buffer.concat(c).toString('utf8'); return t ? JSON.parse(t) : {}; };

  function sessionOf(req) {
    const h = req.headers.authorization ?? '';
    const s = sessions.get(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!s || s.exp < Date.now()) return null;
    return s.user;
  }

  /** جدول المسارات: [method, regex, handler(ctx)] */
  const routes = [];
  const add = (method, path, opts, fn) => routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), opts, fn });
  const U = { auth: true }; const PUB = { auth: false };

  add('GET', '/local/status', PUB, () => ({
    ...sync.status(), branch: pos.branch ? { id: pos.branch.id, name: pos.branch.name, code: pos.branch.code } : null, ready: Boolean(pos.branch && db.meta('snapshot_at')),
    config: { shopName: pos.config().shopName ?? null }, printers: Object.fromEntries(Object.entries(printer.cfg).map(([k, v]) => [k, v.type])), now: new Date().toISOString(),
  }));
  add('POST', '/local/activate', PUB, async ({ body }) => {
    if (sync.configured) throw new PosError('الجهاز مفعّل بالفعل', 'CONFLICT', 409);
    if (!activate) throw new PosError('التفعيل غير متاح', 'NOT_SUPPORTED', 400);
    return activate({ cloudUrl: String(body.cloudUrl ?? ''), deviceToken: String(body.deviceToken ?? '') });
  });
  add('POST', '/local/login', PUB, async ({ body }) => {
    const user = await pos.login(body.username, body.secret ?? body.password, { pin: Boolean(body.pin) });
    const token = randomBytes(24).toString('base64url');
    sessions.set(token, { user, exp: Date.now() + SESSION_MS });
    return { token, user, shift: pos.currentShift() };
  });
  add('POST', '/local/logout', U, ({ req }) => { sessions.delete((req.headers.authorization ?? '').slice(7)); return { ok: true }; });
  add('GET', '/local/me', U, ({ user }) => ({ user, shift: pos.currentShift(), summary: pos.todaySummary(), settings: { taxEnabled: Boolean(pos.setting('tax.enabled')), cashierMaxDiscountPct: pos.setting('discount.cashier_max_pct') } }));

  add('GET', '/local/search', U, ({ query }) => pos.search(query.q));
  add('GET', '/local/customers', U, ({ query, user }) => pos.searchCustomers(query.q, user));
  add('POST', '/local/customers', U, async ({ body, user }) => { const r = await pos.upsertCustomer(body, user); sync.nudge(); return r; });
  add('POST', '/local/quote', U, ({ body }) => pos.quote(body));
  add('POST', '/local/sales', U, ({ body, user }) => { const r = pos.createSale(body, user); sync.nudge(); return r; });
  add('POST', '/local/returns', U, ({ body, user }) => { const r = pos.createReturn(body, user); sync.nudge(); return r; });
  add('GET', '/local/invoices', U, ({ query }) => pos.listInvoices({ q: query.q, limit: Number(query.limit ?? 50) }));
  add('GET', '/local/invoices/:id', U, ({ params }) => pos.getInvoice(params.id));
  add('GET', '/local/invoices/:id/receipt', U, ({ params, query, user }) => pos.receiptData(params.id, { reprint: query.reprint === '1', user }));

  add('GET', '/local/shift', U, () => { const s = pos.currentShift(); return s ? pos.shiftSummary(s.id) : null; });
  add('POST', '/local/shift/open', U, ({ body, user }) => pos.openShift(user, Number(body.openingCash ?? 0)));
  add('POST', '/local/shift/close', U, ({ body, user }) => { const r = pos.closeShift(user, Number(body.closingCash)); sync.nudge(); return r; });

  add('POST', '/local/counts', U, ({ body, user }) => { const r = pos.submitCount(body.lines, body.note, user); sync.nudge(); return r; });
  add('GET', '/local/transfers/incoming', U, () => pos.incomingTransfers());
  add('POST', '/local/transfers/:id/receive', U, ({ params, body, user }) => { const r = pos.receiveTransfer(params.id, body.lines, user); sync.nudge(); return r; });
  add('POST', '/local/attendance', U, ({ user }) => { const r = pos.recordAttendance(user); sync.nudge(); return r; });
  add('GET', '/local/attendance/me', U, ({ user }) => pos.lastAttendance(user.id));

  add('POST', '/local/sync', U, () => sync.run());
  add('GET', '/local/outbox', U, ({ user }) => {
    if (!can(user.role, 'attendance.manage.branch') && !can(user.role, 'settings.manage')) throw new PosError('للمدير فقط', 'FORBIDDEN', 403);
    return { stats: db.outboxStats(), failed: db.all(`SELECT op_id, type, error, attempts, device_time FROM outbox WHERE status='failed' ORDER BY seq DESC LIMIT 50`) };
  });
  add('POST', '/local/outbox/retry', U, ({ user }) => { if (!can(user.role, 'discount.high')) throw new PosError('للمدير فقط', 'FORBIDDEN', 403); const n = db.retryFailed(); sync.nudge(100); return { retried: n }; });

  add('POST', '/local/print', U, async ({ body }) => {
    if (!['receipt', 'label'].includes(body.target)) throw new PosError('هدف الطباعة غير معروف', 'VALIDATION');
    return printer.send(body.target, Buffer.from(String(body.data ?? ''), 'base64'));
  });
  add('GET', '/local/printers', U, ({ user }) => { if (!can(user.role, 'discount.high')) throw new PosError('للمدير فقط', 'FORBIDDEN', 403); return printer.cfg; });
  add('PUT', '/local/printers', U, async ({ body, user }) => {
    if (!can(user.role, 'discount.high')) throw new PosError('للمدير فقط', 'FORBIDDEN', 403);
    printer.setConfig(body); db.setMeta('printers', body); return body;
  });

  async function serveUi(req, res, pathname) {
    let p = decodeURIComponent(pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(join(root, p));
    if (!file.startsWith(root + sep)) return res.writeHead(403).end('forbidden');
    try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(await readFile(file)); }
    catch { res.writeHead(404).end('not found'); }
  }

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 421, { error: 'Host غير مسموح' });
      const url = new URL(req.url, `http://${host}`);
      if (!url.pathname.startsWith('/local/')) return serveUi(req, res, url.pathname);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return json(res, 403, { error: 'Origin غير مسموح' });
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return json(res, 404, { error: 'المسار غير موجود' });
      const user = sessionOf(req);
      if (r.opts.auth && !user) return json(res, 401, { error: 'سجّل الدخول', code: 'AUTH' });
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const out = await r.fn({ req, user, body, query: Object.fromEntries(url.searchParams), params: r.re.exec(url.pathname).groups ?? {} });
      return json(res, 200, out ?? null);
    } catch (e) {
      if (e instanceof PosError) return json(res, e.status, { error: e.message, code: e.code });
      if (e.status >= 400 && e.status < 500) return json(res, e.status, { error: e.message });
      if (e instanceof SyntaxError) return json(res, 400, { error: 'JSON غير صالح' });
      console.error(e);
      return json(res, 500, { error: 'خطأ داخلي في تطبيق الفرع' });
    }
  });

  return {
    server,
    listen: (p = 7070, host = '127.0.0.1') => new Promise((r) => { port = p; server.listen(p, host, () => { port = server.address().port; r(port); }); }),
    close: () => new Promise((r) => server.close(r)),
  };
}
