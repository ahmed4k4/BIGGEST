/** تشفير كلمات السر والتوكنات بـ Web Crypto فقط (يعمل في Cloudflare Workers وNode 22 والمتصفح). */

const enc = new TextEncoder();
// حد Cloudflare Workers لـ PBKDF2 هو 100,000 تكرار، فنثبّته على هذا الرقم.
export const PBKDF2_ITERATIONS = 100_000;

export const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toB64u = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** @returns {Promise<string>} pbkdf2$iterations$salt$hash */
export async function hashSecret(secret, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(await pbkdf2(secret, salt, iterations))}`;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifySecret(secret, stored) {
  const [alg, it, salt, hash] = String(stored ?? '').split('$');
  if (alg !== 'pbkdf2' || !it || !salt || !hash) return false;
  const got = new Uint8Array(await pbkdf2(secret, fromB64(salt), Number(it)));
  return safeEqual(got, fromB64(hash));
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const randomToken = (bytes = 32) => toB64u(crypto.getRandomValues(new Uint8Array(bytes)));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** JWT (HS256) مبسّط. */
export async function signJwt(payload, secret, ttlSeconds = 8 * 3600) {
  const head = toB64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = toB64u(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const sig = toB64u(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${sig}`;
}

export async function verifyJwt(token, secret) {
  const [h, b, s] = String(token ?? '').split('.');
  if (!h || !b || !s) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64u(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromB64u(b)));
  return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
}
