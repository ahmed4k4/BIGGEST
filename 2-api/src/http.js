export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function corsHeaders(req, allowed) {
  const origin = req.headers.get('origin');
  const h = { vary: 'origin' };
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-headers'] = 'authorization, content-type';
    h['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    h['access-control-max-age'] = '86400';
  }
  return h;
}

export function compileRoute(pattern) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(.*)')}$`);
  if (pattern.endsWith('*')) keys.push('rest');
  return { re, keys };
}

/** حد معدل بسيط داخل الذاكرة (أفضل جهد لكل Isolate). الحماية الحقيقية: Cloudflare WAF Rate Limiting. */
export function makeRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.t > windowMs) { hits.set(key, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return true; }
    rec.n += 1;
    return rec.n <= max;
  };
}
