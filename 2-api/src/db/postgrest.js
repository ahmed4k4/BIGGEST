/** سائق الإنتاج: Supabase PostgREST. كل شيء استدعاء دوال (RPC) بمفتاح الخدمة من الـ Backend فقط. */
import { DbError } from './errors.js';

export function createPostgrestDb({ url, serviceKey, fetchImpl = fetch }) {
  if (!url || !serviceKey) throw new Error('SUPABASE_URL و SUPABASE_SERVICE_KEY مطلوبان');
  return {
    async rpc(name, params = {}) {
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new DbError(data?.message ?? `db ${res.status}`, data?.code);
      return data;
    },
  };
}
