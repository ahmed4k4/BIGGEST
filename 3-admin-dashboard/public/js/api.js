/** طبقة الاتصال بالـ API: التوكن في sessionStorage (مع حماية من فشل التخزين)، وأخطاء عربية موحّدة. */
const base = () => (window.ERP_CONFIG?.apiUrl ?? '').replace(/\/$/, '');
const mem = {};
const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? mem[k] ?? null; } catch { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { sessionStorage.setItem(k, v); } catch { /* التخزين غير متاح: نكتفي بالذاكرة */ } },
  del(k) { delete mem[k]; try { sessionStorage.removeItem(k); } catch { /* تجاهل */ } },
};
export const lsGet = (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* تجاهل */ } };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error ?? 'تعذّر الاتصال بالخادم. تأكد من اتصال الإنترنت وحاول مرة أخرى.');
    this.status = status; this.code = data?.code; this.feature = data?.feature; this.data = data ?? {};
  }
}

export const session = {
  get token() { return store.get('erp.token'); },
  get user() { try { return JSON.parse(store.get('erp.user') ?? 'null'); } catch { return null; } },
  set(token, user) { store.set('erp.token', token); store.set('erp.user', JSON.stringify(user)); },
  clear() { store.del('erp.token'); store.del('erp.user'); },
};
export const fileUrl = (u) => (u && u.startsWith('/') ? base() + u : u);

async function request(method, path, { query, body, raw, contentType, text } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const headers = {};
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  let payload;
  if (raw) { payload = raw; headers['content-type'] = contentType; } else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(base() + path + qs, { method, headers, body: payload }); } catch { throw new ApiError(0, null); }
  const out = text ? await res.text() : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session.token) { session.clear(); window.dispatchEvent(new Event('erp:logout')); }
    throw new ApiError(res.status, out);
  }
  return out;
}

export const api = {
  get: (p, query) => request('GET', p, { query }),
  text: (p, query) => request('GET', p, { query, text: true }),
  post: (p, body) => request('POST', p, { body: body ?? {} }),
  put: (p, body) => request('PUT', p, { body }),
  patch: (p, body) => request('PATCH', p, { body }),
  del: (p) => request('DELETE', p),
  upload: (blob) => request('POST', '/uploads', { raw: blob, contentType: blob.type || 'application/octet-stream' }),
  async login(username, password) {
    const r = await request('POST', '/auth/login', { body: { username, password } });
    session.set(r.token, r.user);
    return r.user;
  },
};
