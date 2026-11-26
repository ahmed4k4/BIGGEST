/** الحالة المشتركة: الإعدادات، الكتالوج، التوفر، والسلة. كل التخزين المحلي داخل try/catch مع بديل في الذاكرة. */
const cfg = window.SHOP_CONFIG ?? {};
export const apiUrl = (cfg.apiUrl ?? '').replace(/\/$/, '');
export const siteCfg = cfg;

const mem = new Map();
export const kv = {
  get(k) { try { const v = localStorage.getItem(k); if (v != null) return v; } catch { /* التخزين محجوب */ } return mem.get(k) ?? null; },
  set(k, v) { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* ممتلئ أو محجوب */ } },
  del(k) { mem.delete(k); try { localStorage.removeItem(k); } catch { /* تجاهل */ } },
};
const readJson = (k, d) => { try { return JSON.parse(kv.get(k)) ?? d; } catch { return d; } };

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(apiUrl + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error ?? 'تعذّر إتمام الطلب', data);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e.name === 'AbortError' ? 'الاتصال بطيء جدًا' : 'تعذّر الاتصال بالإنترنت', null);
  } finally { clearTimeout(t); }
}

export const state = { config: { open: true, paymentMethods: ['cod'], shipping: 0, whatsapp: '', storeName: 'BIGGEST' }, categories: [], models: [], avail: null, stale: false, byVariant: new Map(), byModel: new Map(), catName: new Map() };
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => f());

function indexCatalog(cat) {
  state.categories = cat.categories ?? [];
  state.models = cat.models ?? [];
  state.byVariant.clear(); state.byModel.clear(); state.catName.clear();
  for (const c of state.categories) state.catName.set(c.id, c.name);
  for (const m of state.models) { state.byModel.set(m.id, m); for (const v of m.variants) state.byVariant.set(v.id, { model: m, variant: v }); }
}

export async function loadAvailability() {
  try { state.avail = await api('/public/availability.json', { timeout: 12000 }); kv.set('shop.avail.v1', JSON.stringify(state.avail)); }
  catch { state.avail ??= readJson('shop.avail.v1', null); }
  const changes = reconcileCart();
  emit();
  return changes;
}

/** يحمّل الإعدادات والكتالوج والتوفر. عند فشل الشبكة يستخدم آخر نسخة محفوظة ويعلّم الحالة stale. */
export async function loadAll() {
  const [c, cat, av] = await Promise.allSettled([api('/public/config', { timeout: 12000 }), api('/public/catalog.json'), api('/public/availability.json', { timeout: 12000 })]);
  if (c.status === 'fulfilled') { state.config = { ...state.config, ...c.value }; kv.set('shop.config.v1', JSON.stringify(c.value)); }
  else Object.assign(state.config, readJson('shop.config.v1', {}));
  let catalog = cat.status === 'fulfilled' ? cat.value : null;
  if (catalog) { try { kv.set('shop.catalog.v1', JSON.stringify(catalog)); } catch { /* حجم كبير */ } }
  else { catalog = readJson('shop.catalog.v1', null); state.stale = !!catalog; }
  if (!catalog) throw cat.reason ?? new ApiError(0, 'تعذّر تحميل المنتجات');
  state.stale = state.stale || cat.status !== 'fulfilled';
  indexCatalog(catalog);
  state.avail = av.status === 'fulfilled' ? av.value : readJson('shop.avail.v1', null);
  if (av.status === 'fulfilled') kv.set('shop.avail.v1', JSON.stringify(av.value));
  reconcileCart();
  emit();
}

/** الكمية المتاحة للصنف. null = غير معروفة (لم يصل ملف التوفر). */
export const available = (vid) => (state.avail ? (state.avail[vid]?.a ?? 0) : null);
export const MAX_LINE_QTY = 20;
export const limitFor = (vid) => { const a = available(vid); return Math.max(0, Math.min(MAX_LINE_QTY, a ?? MAX_LINE_QTY)); };
export const LOW_STOCK = 3;

// ───────── السلة ─────────
let cart = readJson('shop.cart.v1', []).filter((l) => l && typeof l.v === 'string' && Number.isInteger(l.q) && l.q > 0);
const saveCart = () => { kv.set('shop.cart.v1', JSON.stringify(cart)); emit(); };
export const cartLines = () => cart.map((l) => { const x = state.byVariant.get(l.v); return x ? { ...x, vid: l.v, qty: l.q, unit: x.variant.price, total: x.variant.price * l.q } : null; }).filter(Boolean);
export const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);
export const cartTotal = () => cartLines().reduce((n, l) => n + l.total, 0);
export function cartAdd(vid, q = 1) {
  const max = limitFor(vid); const cur = cart.find((l) => l.v === vid);
  const next = Math.min(max, (cur?.q ?? 0) + q);
  if (next <= 0) return { ok: false, reason: 'out' };
  if (cur) cur.q = next; else cart.push({ v: vid, q: next });
  saveCart();
  return { ok: true, capped: (cur?.q ?? 0) + q > max, qty: next };
}
export function cartSet(vid, q) {
  const l = cart.find((x) => x.v === vid); if (!l) return;
  const max = limitFor(vid);
  if (q <= 0) cart = cart.filter((x) => x !== l); else l.q = Math.min(q, max);
  saveCart();
}
export const cartRemove = (vid) => { cart = cart.filter((l) => l.v !== vid); saveCart(); };
export function cartClear() { cart = []; kv.del('shop.token.v1'); saveCart(); }

/** يزيل ما اختفى من الكتالوج ويخفض الكميات لما هو متاح. يُرجع وصفًا بما تغيّر. */
export function reconcileCart() {
  if (!state.byVariant.size) return [];
  const changes = [];
  cart = cart.filter((l) => {
    const x = state.byVariant.get(l.v);
    if (!x) { changes.push('أُزيل صنف لم يعد معروضًا'); return false; }
    const name = `${x.model.name} (${x.variant.color}، ${x.variant.size})`;
    const max = limitFor(l.v);
    if (max <= 0) { changes.push(`نفدت الكمية: ${name}`); return false; }
    if (l.q > max) { l.q = max; changes.push(`خُفّضت الكمية إلى ${max}: ${name}`); }
    return true;
  });
  if (changes.length) kv.set('shop.cart.v1', JSON.stringify(cart));
  return changes;
}

// ───────── UTM: أول زيارة هي المنسوبة ─────────
export function captureUtm() {
  try {
    const p = new URLSearchParams(location.search);
    const found = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) if (p.get(`utm_${k}`)) found[k] = p.get(`utm_${k}`).slice(0, 100);
    if (p.get('fbclid')) found.fbclid = p.get('fbclid').slice(0, 100);
    if (Object.keys(found).length && !kv.get('shop.utm.v1')) kv.set('shop.utm.v1', JSON.stringify(found));
  } catch { /* تجاهل */ }
}
export const getUtm = () => readJson('shop.utm.v1', {});
