/** عميل الخادم المحلي (/local/*). التوكن في الذاكرة + sessionStorage (يزول بإغلاق النافذة). */
export class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
let token = null;
try { token = sessionStorage.getItem('pos.token'); } catch { /* مسموح */ }
export const setToken = (t) => { token = t; try { t ? sessionStorage.setItem('pos.token', t) : sessionStorage.removeItem('pos.token'); } catch { /* مسموح */ } };
export const hasToken = () => Boolean(token);

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError('تعذّر الاتصال بتطبيق الفرع على هذا الجهاز. تأكد أنه يعمل.', 0, 'NETWORK'); }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) { setToken(null); location.reload(); }
  if (!res.ok) throw new ApiError(data?.error ?? `خطأ ${res.status}`, res.status, data?.code);
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
