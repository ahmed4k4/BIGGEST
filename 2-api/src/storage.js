/** تخزين الصور: R2 على Cloudflare، أو مجلد محلي في التطوير. الواجهة: put / get. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';

export const MIME = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

/** فحص الملف قبل الرفع: النوع من البايتات الأولى (وليس من الاسم) والحجم. */
export function sniffImage(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

export function createLocalStorage(dir) {
  const root = resolve(dir);
  const safe = (key) => { const p = resolve(join(root, key)); if (!p.startsWith(root + sep)) throw new Error('مسار غير آمن'); return p; };
  return {
    async put(key, bytes) { const p = safe(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, bytes); },
    async get(key) { try { return await readFile(safe(key)); } catch { return null; } },
  };
}

export function createR2Storage(bucket) {
  return {
    async put(key, bytes, type) { await bucket.put(key, bytes, { httpMetadata: { contentType: type } }); },
    async get(key) { const o = await bucket.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; },
  };
}
