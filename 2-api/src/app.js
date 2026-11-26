/**
 * الـ Backend: معالج fetch قياسي (Request → Response) يعمل كما هو على Cloudflare Workers وعلى Node 22.
 * كل العمليات الثقيلة دوال SQL واحدة (Transaction)، والـ Worker يتحقق من الصلاحيات والتصاريح فقط.
 */
import {
  can, DEFAULT_SETTINGS, levelOf, SETTING_LEVELS, normalizePhone, maskPhone, validateTemplate, diffTemplates, generateCodes,
  parseCode, validateOp, MAX_PUSH_BATCH, MAX_PULL_LIMIT, hashSecret, verifySecret, sha256Hex, randomToken, signJwt, verifyJwt,
  DEFAULT_RULES, scorePeriod, evaluateThresholds, nextSequence, SITE_MODES,
} from './shared/index.js';
import { HttpError, json, corsHeaders, compileRoute, isUuid, makeRateLimiter } from './http.js';
import { sniffImage, MIME } from './storage.js';

const WEB_PAYMENTS = ['cod', 'transfer', 'instapay'];
const SETTING_PREFIXES = ['shop.', 'kill.', 'attendance.', 'invoice.', 'printer.', 'site_stock.', 'tax.', 'discount.', 'returns.',
  'offline.', 'customers.', 'general.', 'sync.', 'usage.', 'code_template.', 'settings.'];
const GRANTABLE = Object.keys(SETTING_LEVELS).filter((k) => SETTING_LEVELS[k] === 'grant');

export function createApp({ db, config, storage }) {
  const { companyId } = config;
  const routes = [];
  const allowedOrigins = config.allowedOrigins ?? ['*'];
  const loginLimiter = makeRateLimiter({ max: 20 });
  const orderLimiter = makeRateLimiter({ max: 6 });
  let settingsCache = { at: 0, map: new Map() };

  const rpc = (name, params = {}) => db.rpc(name, params);
  const list = (table, where = {}, o = {}) =>
    rpc('api_list', { p_table: table, p_company: companyId, p_where: where, p_q: o.q ?? null, p_limit: o.limit ?? 100, p_offset: o.offset ?? 0 });
  const insert = (table, row) => rpc('api_insert', { p_table: table, p_row: { company_id: companyId, ...row } });
  const update = (table, id, patch) => rpc('api_update', { p_table: table, p_id: id, p_company: companyId, p_patch: patch });
  const audit = (actor, action, entity, entityId, extra = {}) =>
    insert('audit_log', { actor_id: actor?.id ?? null, action, entity, entity_id: String(entityId ?? ''), ...extra }).catch(() => {});

  // ───────── الإعدادات (مع كاش 30 ثانية لتقليل استدعاءات القاعدة) ─────────
  async function settingsMap(force = false) {
    if (!force && Date.now() - settingsCache.at < 30_000) return settingsCache.map;
    const rows = await list('settings', {}, { limit: 500 });
    settingsCache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r])) };
    return settingsCache.map;
  }
  const settingValue = async (key) => (await settingsMap()).get(key)?.value ?? DEFAULT_SETTINGS[key];
  const invalidateSettings = () => { settingsCache.at = 0; };

  /** مستوى الإعداد: حر / يحتاج تصريحًا / للسوبر أدمن فقط. السوبر أدمن وحده يغيّر المستويات. */
  async function requireLevel(user, key) {
    const overrides = (await settingValue('settings.levels')) ?? {};
    const level = levelOf(key, overrides);
    if (level === 'free' || user.role === 'super_admin') return;
    if (level === 'super') throw new HttpError(403, 'هذه العملية للسوبر أدمن فقط', { code: 'SUPER_ONLY', feature: key });
    const grant = await rpc('consume_grant', { p_company: companyId, p_feature: key, p_user: user.id });
    if (!grant) throw new HttpError(403, 'هذه العملية تحتاج تصريحًا من السوبر أدمن. اطلب فتحها ثم أعد المحاولة.', { code: 'NEEDS_GRANT', feature: key });
  }

  // ───────── التسجيل في الراوتر ─────────
  function route(method, pattern, opts, handler) { routes.push({ method, ...compileRoute(pattern), opts, handler }); }
  const R = {
    get: (p, o, h) => route('GET', p, o, h), post: (p, o, h) => route('POST', p, o, h),
    put: (p, o, h) => route('PUT', p, o, h), patch: (p, o, h) => route('PATCH', p, o, h), del: (p, o, h) => route('DELETE', p, o, h),
  };
  const U = (perm) => ({ auth: 'user', perm });
  const need = (user, ...perms) => { if (!perms.some((p) => can(user.role, p))) throw new HttpError(403, 'ليس لديك صلاحية لهذه العملية'); };

  async function body(req) {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > 1_000_000) throw new HttpError(413, 'الطلب كبير جدًا');
    try { return await req.json(); } catch { throw new HttpError(400, 'JSON غير صالح'); }
  }
  const need_id = (v, label = 'المعرّف') => { if (!isUuid(v)) throw new HttpError(400, `${label} غير صالح`); return v; };
  const str = (v, label, { min = 1, max = 200 } = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min || s.length > max) throw new HttpError(400, `${label} مطلوب (${min}-${max} حرفًا)`);
    return s;
  };
  const int = (v, label, { min = 0, max = 1e9 } = {}) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} يجب أن يكون عددًا صحيحًا بين ${min} و${max}`);
    return n;
  };
  const strip = (row, ...keys) => { if (row) for (const k of keys) delete row[k]; return row; };
  const branchScope = (user, requested) => (user.role === 'branch_manager' ? user.branchId : requested ?? null);

  // ═════════ عام ═════════
  R.get('/health', { auth: 'public' }, async () => ({ ok: true, time: new Date().toISOString() }));

  // ═════════ الدخول ═════════
  R.post('/auth/login', { auth: 'public' }, async ({ req, ip }) => {
    if (!loginLimiter(`login:${ip}`)) throw new HttpError(429, 'محاولات كثيرة، انتظر دقيقة');
    const b = await body(req);
    const username = str(b.username, 'اسم المستخدم', { max: 60 }).toLowerCase();
    const [u] = await list('users', { username });
    const fail = new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة');
    if (!u || !u.is_active) { await hashSecret('x'); throw fail; }   // نفس الزمن تقريبًا حتى لا يُكشف وجود المستخدم
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'الحساب مقفل مؤقتًا بعد محاولات فاشلة');
    if (!(await verifySecret(String(b.password ?? ''), u.password_hash))) {
      const n = u.failed_logins + 1;
      await update('users', u.id, { failed_logins: n, ...(n >= 5 ? { locked_until: new Date(Date.now() + 15 * 60_000).toISOString(), failed_logins: 0 } : {}) });
      await audit(u, 'auth.login_failed', 'users', u.id);
      throw fail;
    }
    if (u.failed_logins) await update('users', u.id, { failed_logins: 0 });
    await audit(u, 'auth.login', 'users', u.id);
    const token = await signJwt({ sub: u.id, role: u.role, branchId: u.branch_id, name: u.display_name }, config.jwtSecret, config.sessionHours * 3600);
    return { token, user: { id: u.id, name: u.display_name, role: u.role, branchId: u.branch_id } };
  });
  R.get('/auth/me', U(), async ({ user }) => user);

  // ═════════ الإعدادات والتصاريح ═════════
  R.get('/settings', U(), async ({ user }) => {
    const map = await settingsMap(true);
    const merged = { ...DEFAULT_SETTINGS };
    for (const [k, v] of map) merged[k] = v.value;
    const overrides = merged['settings.levels'] ?? {};
    const levels = Object.fromEntries(Object.keys(merged).map((k) => [k, levelOf(k, overrides)]));
    for (const k of Object.keys(SETTING_LEVELS)) levels[k] = levelOf(k, overrides);
    return { settings: merged, levels, canEditLevels: user.role === 'super_admin' };
  });

  R.put('/settings/:key', U('settings.manage'), async ({ user, params, req }) => {
    const key = decodeURIComponent(params.key);
    if (!SETTING_PREFIXES.some((p) => key.startsWith(p))) throw new HttpError(400, 'مفتاح إعداد غير معروف');
    if (key === 'settings.levels' && user.role !== 'super_admin') throw new HttpError(403, 'المستويات للسوبر أدمن فقط');
    const { value } = await body(req);
    if (value === undefined) throw new HttpError(400, 'القيمة مطلوبة');
    if (key === 'site_stock.mode' && !Object.values(SITE_MODES).includes(value)) throw new HttpError(400, 'وضع مخزون غير صالح');
    await requireLevel(user, key);
    const s = await rpc('set_setting', { p_company: companyId, p_key: key, p_value: value, p_actor: user.id, p_level: null });
    invalidateSettings();
    return s;
  });

  R.get('/settings/:key/history', U('settings.manage'), async ({ params }) =>
    list('settings_history', { key: decodeURIComponent(params.key) }, { limit: 50 }));

  R.post('/settings/:key/restore', U('settings.manage'), async ({ user, params, req }) => {
    const key = decodeURIComponent(params.key);
    const { version } = await body(req);
    await requireLevel(user, 'settings.restore_version');
    const [h] = await list('settings_history', { key, version: int(version, 'النسخة', { min: 1 }) });
    if (!h) throw new HttpError(404, 'النسخة غير موجودة');
    const s = await rpc('set_setting', { p_company: companyId, p_key: key, p_value: h.value, p_actor: user.id, p_level: null });
    invalidateSettings();
    return s;
  });

  R.put('/settings-levels/:key', U(), async ({ user, params, req }) => {
    if (user.role !== 'super_admin') throw new HttpError(403, 'المستويات للسوبر أدمن فقط');
    const { level } = await body(req);
    if (!['free', 'grant', 'super'].includes(level)) throw new HttpError(400, 'مستوى غير صالح');
    const overrides = { ...((await settingValue('settings.levels')) ?? {}), [params.key]: level };
    await rpc('set_setting', { p_company: companyId, p_key: 'settings.levels', p_value: overrides, p_actor: user.id, p_level: 'super' });
    invalidateSettings();
    return { overrides };
  });

  R.post('/grants', U('grants.request'), async ({ user, req }) => {
    const b = await body(req);
    if (!GRANTABLE.includes(b.feature)) throw new HttpError(400, 'هذه الميزة لا تحتاج تصريحًا');
    const g = await insert('permission_grants', { feature: b.feature, scope: b.scope ?? {}, reason: str(b.reason, 'السبب', { min: 3, max: 500 }), requested_by: user.id });
    await audit(user, 'grant.request', 'permission_grants', g.id, { reason: b.reason });
    return g;
  });
  R.get('/grants', U(), async ({ user }) => {
    await rpc('expire_grants', { p_company: companyId });
    return user.role === 'super_admin' ? list('permission_grants', {}, { limit: 100 }) : list('permission_grants', { requested_by: user.id }, { limit: 50 });
  });
  R.post('/grants/:id/decide', U(), async ({ user, params, req }) => {
    if (user.role !== 'super_admin') throw new HttpError(403, 'الموافقة للسوبر أدمن فقط');
    const b = await body(req);
    const id = need_id(params.id);
    const [g] = await list('permission_grants', { id });
    if (!g || g.status !== 'pending') throw new HttpError(409, 'الطلب غير معلّق');
    const patch = b.approve
      ? { status: 'approved', uses_left: int(b.uses ?? 1, 'عدد المرات', { min: 1, max: 20 }),
          expires_at: new Date(Date.now() + int(b.minutes ?? 60, 'المدة بالدقائق', { min: 1, max: 1440 }) * 60_000).toISOString(),
          decided_by: user.id, decided_at: new Date().toISOString() }
      : { status: 'rejected', decided_by: user.id, decided_at: new Date().toISOString() };
    await audit(user, b.approve ? 'grant.approve' : 'grant.reject', 'permission_grants', id, { after: patch });
    return update('permission_grants', id, patch);
  });

  // ═════════ المستخدمون ═════════
  const publicUser = (u) => strip(u, 'password_hash', 'pin_hash');
  R.get('/users', U('users.manage'), async () => (await list('users', {}, { limit: 300 })).map(publicUser));
  R.post('/users', U('users.manage'), async ({ user, req }) => {
    const b = await body(req);
    if (!['super_admin', 'admin', 'branch_manager', 'storekeeper', 'accountant', 'cashier'].includes(b.role)) throw new HttpError(400, 'الدور غير صالح');
    if (b.role === 'super_admin' && user.role !== 'super_admin') throw new HttpError(403, 'إنشاء سوبر أدمن للسوبر أدمن فقط');
    if (['admin'].includes(b.role)) await requireLevel(user, 'users.change_admin');
    const password = str(b.password, 'كلمة السر', { min: 8, max: 100 });
    const row = await insert('users', {
      username: str(b.username, 'اسم المستخدم', { min: 3, max: 60 }).toLowerCase(), display_name: str(b.displayName, 'الاسم', { max: 100 }),
      role: b.role, branch_id: b.branchId ? need_id(b.branchId) : null, password_hash: await hashSecret(password),
      pin_hash: b.pin ? await hashSecret(String(b.pin)) : null,
    });
    await audit(user, 'user.create', 'users', row.id, { after: { role: b.role } });
    return publicUser(row);
  });
  R.patch('/users/:id', U('users.manage'), async ({ user, params, req }) => {
    const id = need_id(params.id);
    const b = await body(req);
    const [cur] = await list('users', { id });
    if (!cur) throw new HttpError(404, 'المستخدم غير موجود');
    if (cur.role === 'super_admin' && user.role !== 'super_admin') throw new HttpError(403, 'لا يمكن تعديل السوبر أدمن');
    const patch = {};
    if (b.displayName) patch.display_name = str(b.displayName, 'الاسم', { max: 100 });
    if (b.branchId !== undefined) patch.branch_id = b.branchId ? need_id(b.branchId) : null;
    if (b.isActive !== undefined) { patch.is_active = !!b.isActive; if (cur.role === 'super_admin' && !b.isActive) throw new HttpError(403, 'لا يمكن إيقاف السوبر أدمن'); }
    if (b.role && b.role !== cur.role) {
      if (b.role === 'super_admin' || cur.role === 'super_admin') throw new HttpError(403, 'تغيير دور السوبر أدمن غير مسموح');
      if (b.role === 'admin' || cur.role === 'admin') await requireLevel(user, 'users.change_admin');
      patch.role = b.role;
    }
    if (b.password) patch.password_hash = await hashSecret(str(b.password, 'كلمة السر', { min: 8, max: 100 }));
    if (b.pin) patch.pin_hash = await hashSecret(String(b.pin));
    if (!Object.keys(patch).length) throw new HttpError(400, 'لا توجد تغييرات');
    await audit(user, 'user.update', 'users', id, { after: { ...patch, password_hash: undefined, pin_hash: undefined } });
    return publicUser(await update('users', id, patch));
  });

  // ═════════ الفروع والأجهزة ═════════
  R.get('/branches', U(), async () => list('branches', {}, { limit: 200 }));
  R.post('/branches', U('settings.manage'), async ({ user, req }) => {
    const b = await body(req);
    if (!['main_warehouse', 'branch', 'web_stock'].includes(b.kind)) throw new HttpError(400, 'نوع الموقع غير صالح');
    const code = str(b.code, 'الكود', { min: 2, max: 8 }).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) throw new HttpError(400, 'كود الفرع حروف إنجليزية وأرقام فقط');
    const row = await insert('branches', { code, name: str(b.name, 'الاسم'), kind: b.kind, address: b.address ?? null, phone: b.phone ?? null });
    await audit(user, 'branch.create', 'branches', row.id);
    return row;
  });
  R.patch('/branches/:id', U('settings.manage'), async ({ user, params, req }) => {
    const b = await body(req); const patch = {};
    for (const [k, c] of [['name', 'name'], ['address', 'address'], ['phone', 'phone'], ['isActive', 'is_active']]) if (b[k] !== undefined) patch[c] = b[k];
    await audit(user, 'branch.update', 'branches', params.id, { after: patch });
    return update('branches', need_id(params.id), patch);
  });

  R.get('/devices', U('devices.manage'), async () => (await list('devices', {}, { limit: 200 })).map((d) => strip(d, 'token_hash')));
  R.post('/devices', U('devices.manage'), async ({ user, req }) => {
    await requireLevel(user, 'device.register');
    const b = await body(req);
    const kind = b.kind === 'server_agent' ? 'server_agent' : 'branch_agent';
    if (kind === 'branch_agent' && !b.branchId) throw new HttpError(400, 'الفرع مطلوب لجهاز الفرع');
    const id = crypto.randomUUID();
    const secret = randomToken(32);
    const row = await insert('devices', { id, name: str(b.name, 'اسم الجهاز'), kind, branch_id: b.branchId ? need_id(b.branchId) : null, token_hash: await sha256Hex(secret) });
    await audit(user, 'device.register', 'devices', id);
    // التوكن يظهر هنا مرة واحدة فقط ولا يُحفظ إلا مجزّأً
    return { ...strip(row, 'token_hash'), deviceToken: `${id}.${secret}` };
  });
  R.post('/devices/:id/revoke', U('devices.manage'), async ({ user, params }) => {
    await audit(user, 'device.revoke', 'devices', params.id);
    return strip(await update('devices', need_id(params.id), { status: 'revoked' }), 'token_hash');
  });

  // ═════════ قالب الكود ═════════
  R.get('/code-template', U(), async () => (await list('code_templates', { is_current: true }))[0] ?? null);
  R.get('/code-template/versions', U('codes.manage'), async () => list('code_templates', {}, { limit: 50 }));
  R.post('/code-template/preview', U('codes.manage'), async ({ req }) => {
    const { definition } = await body(req);
    const v = validateTemplate(definition);
    if (!v.ok) return v;
    const sample = generateCodes(definition, 1, {}).slice(0, 8).map((c) => c.code);
    return { ...v, samples: sample, perModel: v.perModel ?? undefined };
  });
  R.post('/code-template', U('codes.manage'), async ({ user, req }) => {
    const { definition } = await body(req);
    const v = validateTemplate(definition);
    if (!v.ok) throw new HttpError(422, 'القالب غير صالح', { errors: v.errors });
    const [cur] = await list('code_templates', { is_current: true });
    if (cur) {
      const [usedValues, hasPrintedCodes] = await Promise.all([rpc('used_template_values', { p_company: companyId }), rpc('has_printed_codes', { p_company: companyId })]);
      const diff = diffTemplates(cur.definition, definition, { usedValues, hasPrintedCodes });
      if (!diff.ok) throw new HttpError(422, 'تعديل غير مسموح على قيم مستخدمة', { errors: diff.errors });
      if (diff.needsGrant) await requireLevel(user, 'code_template.structure');
    }
    return rpc('create_code_template', { p_company: companyId, p_definition: definition, p_actor: user.id });
  });
  R.get('/code-template/decode', U(), async ({ query }) => {
    const [cur] = await list('code_templates', { is_current: true });
    if (!cur) throw new HttpError(404, 'لا يوجد قالب كود');
    const parsed = parseCode(cur.definition, query.code ?? '');
    const [variant] = parsed.ok ? await list('variants', { sku: parsed.normalized }) : [];
    return { ...parsed, variant: variant ?? null };
  });

  // ═════════ التصنيفات والموديلات والقطع ═════════
  R.get('/categories', U(), async () => list('categories', {}, { limit: 300 }));
  R.post('/categories', U('models.manage'), async ({ req }) => { const b = await body(req); return insert('categories', { name: str(b.name, 'الاسم'), sort: b.sort ?? 0 }); });
  R.patch('/categories/:id', U('models.manage'), async ({ params, req }) => {
    const b = await body(req); const p = {};
    if (b.name) p.name = str(b.name, 'الاسم'); if (b.sort !== undefined) p.sort = int(b.sort, 'الترتيب'); if (b.isActive !== undefined) p.is_active = !!b.isActive;
    return update('categories', need_id(params.id), p);
  });

  const modelOut = (m, user) => (can(user.role, 'finance.view') || user.role === 'admin' ? m : strip(m, 'cost_piasters'));
  R.get('/models', U(['models.manage', 'sales.view', 'stock.receive', 'stock.transfer']), async ({ user, query }) =>
    (await list('models', query.category ? { category_id: query.category } : {}, { q: query.q, limit: Number(query.limit ?? 100), offset: Number(query.offset ?? 0) })).map((m) => modelOut(m, user)));

  R.post('/models', U('models.manage'), async ({ user, req }) => {
    const b = await body(req);
    const [tpl] = await list('code_templates', { is_current: true });
    if (!tpl) throw new HttpError(409, 'أنشئ قالب الكود أولًا');
    const seq = tpl.definition.parts.find((p) => p.kind === 'sequence');
    const num = Number(String(await rpc('next_doc_number', { p_company: companyId, p_type: 'model', p_prefix: 'M' })).split('-').pop());
    const code = nextSequence(num - 1, seq.length ?? seq.maxLength);
    if (code.length > (seq.length ?? seq.maxLength)) throw new HttpError(409, 'نفدت أرقام الموديلات في هذا القالب');
    const row = await insert('models', {
      code, name: str(b.name, 'اسم الموديل'), category_id: b.categoryId ? need_id(b.categoryId) : null,
      price_piasters: int(b.pricePiasters, 'السعر', { max: 1e9 }), cost_piasters: b.costPiasters != null ? int(b.costPiasters, 'التكلفة', { max: 1e9 }) : null,
      description: b.description ?? null, show_on_web: b.showOnWeb ?? true, template_version: tpl.version,
    });
    await audit(user, 'model.create', 'models', row.id, { after: { code } });
    return modelOut(row, user);
  });
  R.get('/models/:id', U(), async ({ user, params }) => {
    const id = need_id(params.id);
    const [m] = await list('models', { id });
    if (!m) throw new HttpError(404, 'الموديل غير موجود');
    const [variants, images] = await Promise.all([list('variants', { model_id: id }, { limit: 500 }), rpc('model_images_of', { p_company: companyId, p_model: id })]);
    return { ...modelOut(m, user), variants, images };
  });
  R.patch('/models/:id', U('models.manage'), async ({ user, params, req }) => {
    const id = need_id(params.id); const b = await body(req); const p = {};
    if (b.name) p.name = str(b.name, 'الاسم');
    if (b.pricePiasters !== undefined) {
      p.price_piasters = int(b.pricePiasters, 'السعر', { max: 1e9 });
      const [cur] = await list('models', { id });
      if (cur && Math.abs(p.price_piasters - cur.price_piasters) / Math.max(1, cur.price_piasters) > 0.5) await requireLevel(user, 'discount.over_limit');
    }
    if (b.costPiasters !== undefined) p.cost_piasters = b.costPiasters == null ? null : int(b.costPiasters, 'التكلفة', { max: 1e9 });
    if (b.categoryId !== undefined) p.category_id = b.categoryId ? need_id(b.categoryId) : null;
    if (b.description !== undefined) p.description = b.description;
    if (b.showOnWeb !== undefined) p.show_on_web = !!b.showOnWeb;
    if (b.isActive !== undefined) p.is_active = !!b.isActive;
    await audit(user, 'model.update', 'models', id, { after: p });
    return modelOut(await update('models', id, p), user);
  });
  R.post('/models/:id/variants', U('codes.manage'), async ({ user, params, req }) => {
    const id = need_id(params.id); const b = await body(req);
    const [m] = await list('models', { id });
    const [tpl] = await list('code_templates', { is_current: true });
    if (!m || !tpl) throw new HttpError(404, 'الموديل أو القالب غير موجود');
    const t = tpl.definition;
    const codes = generateCodes(t, m.code, { color: b.colors, size: b.sizes });
    if (!codes.length) throw new HttpError(400, 'لا توجد قيم فعّالة للتوليد');
    const rows = codes.map(({ code, values }) => {
      const nameOf = (key) => t.parts.find((p) => p.key === key).values.find((v) => v.code === values[key]).name;
      const attrs = {};
      for (const p of t.parts.filter((x) => x.kind === 'enum' && !['color', 'size'].includes(x.key))) attrs[p.key] = values[p.key];
      return { sku: code, colorCode: values.color, colorName: nameOf('color'), sizeCode: values.size, sizeName: nameOf('size'), attrs };
    });
    const n = await rpc('create_variants_bulk', { p_company: companyId, p_model: id, p_version: tpl.version, p_rows: rows });
    await audit(user, 'variants.generate', 'models', id, { after: { count: rows.length } });
    return { created: n, skus: rows.map((r) => r.sku) };
  });
  R.post('/models/:id/images', U('models.manage'), async ({ params, req }) => {
    const b = await body(req);
    return rpc('add_model_image', { p_company: companyId, p_model: need_id(params.id), p_thumb: str(b.thumb, 'thumb', { max: 500 }), p_card: str(b.card, 'card', { max: 500 }), p_full: str(b.full, 'full', { max: 500 }) });
  });
  R.del('/model-images/:id', U('models.manage'), async ({ params }) => rpc('delete_model_image', { p_company: companyId, p_image: need_id(params.id) }));

  R.get('/variants', U(), async ({ query }) => list('variants', {}, { q: query.q, limit: Number(query.limit ?? 50) }));
  R.post('/labels/printed', U('codes.manage'), async ({ req }) => {
    const { skus } = await body(req);
    if (!Array.isArray(skus) || skus.length > 2000) throw new HttpError(400, 'قائمة الأكواد غير صالحة');
    return { marked: await rpc('mark_printed', { p_company: companyId, p_skus: skus }) };
  });

  // ═════════ الصور ═════════
  R.post('/uploads', U('models.manage'), async ({ req }) => {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > 1_500_000) throw new HttpError(413, 'حجم الصورة يجب ألا يتجاوز 1.5 ميجابايت');
    const ext = sniffImage(buf);
    if (!ext) throw new HttpError(415, 'نوع الملف غير مسموح. المسموح: WebP أو JPG أو PNG');
    const key = `img/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    await storage.put(key, buf, MIME[ext]);
    return { url: `${config.publicApiUrl ?? ''}/files/${key}` };
  });
  R.get('/files/*', { auth: 'public' }, async ({ params }) => {
    const bytes = await storage.get(params.rest);
    if (!bytes) throw new HttpError(404, 'غير موجود');
    const ext = params.rest.split('.').pop();
    return new Response(bytes, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' } });
  });

  // ═════════ المخزون والتوزيع ═════════
  R.get('/stock', U(['stock.receive', 'stock.count', 'reports.view', 'reports.view.branch', 'reports.view.stock']), async ({ user, query }) =>
    rpc('stock_report', { p_company: companyId, p_branch: branchScope(user, query.branch), p_q: query.q ?? null, p_limit: Math.min(Number(query.limit ?? 100), 500), p_offset: Number(query.offset ?? 0) }));
  R.post('/stock/adjust', U('stock.count'), async ({ user, req }) => {
    const b = await body(req);
    await rpc('manual_adjust', { p_company: companyId, p_actor: user.id, p_branch: need_id(b.branchId), p_variant: need_id(b.variantId), p_delta: int(b.delta, 'الفرق', { min: -100000, max: 100000 }), p_reason: str(b.reason, 'السبب', { min: 3, max: 300 }) });
    return { ok: true };
  });
  R.post('/stock/min', U('stock.count'), async ({ req }) => {
    const b = await body(req);
    await rpc('set_min_qty', { p_company: companyId, p_branch: need_id(b.branchId), p_variant: need_id(b.variantId), p_min: int(b.min, 'الحد الأدنى', { max: 10000 }) });
    return { ok: true };
  });

  const lines = (arr, label = 'الأصناف') => {
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 500) throw new HttpError(400, `${label} مطلوبة (حتى 500 سطر)`);
    return arr.map((l) => ({ variantId: need_id(l.variantId, 'الصنف'), qty: int(l.qty, 'الكمية', { min: 1, max: 100000 }) }));
  };
  R.post('/receipts', U('stock.receive'), async ({ user, req }) => {
    const b = await body(req);
    const id = await rpc('create_receipt', { p_company: companyId, p_actor: user.id, p_branch: need_id(b.branchId, 'المخزن'), p_note: b.note ?? null, p_lines: lines(b.lines) });
    return { id };
  });
  R.get('/receipts', U('stock.receive'), async ({ query }) => list('stock_receipts', {}, { limit: Number(query.limit ?? 50), offset: Number(query.offset ?? 0) }));

  R.get('/transfers', U(['stock.transfer', 'stock.transfer.receive']), async ({ user, query }) => {
    const rows = await list('transfers', query.status ? { status: query.status } : {}, { limit: Number(query.limit ?? 100) });
    return user.role === 'branch_manager' ? rows.filter((t) => [t.from_branch_id, t.to_branch_id].includes(user.branchId)) : rows;
  });
  R.post('/transfers', U('stock.transfer'), async ({ user, req }) => {
    const b = await body(req);
    const id = await rpc('create_transfer', { p_company: companyId, p_actor: user.id, p_from: need_id(b.fromBranchId), p_to: need_id(b.toBranchId), p_note: b.note ?? null, p_lines: lines(b.lines) });
    return rpc('transfer_detail', { p_company: companyId, p_transfer: id });
  });
  R.get('/transfers/:id', U(['stock.transfer', 'stock.transfer.receive']), async ({ params }) => rpc('transfer_detail', { p_company: companyId, p_transfer: need_id(params.id) }));
  R.post('/transfers/:id/transition', U('stock.transfer'), async ({ user, params, req }) => {
    const { to } = await body(req);
    if (!['approved', 'preparing', 'in_transit', 'cancelled'].includes(to)) throw new HttpError(400, 'حالة غير صالحة');
    await rpc('transition_transfer', { p_company: companyId, p_transfer: need_id(params.id), p_to: to, p_actor: user.id });
    return rpc('transfer_detail', { p_company: companyId, p_transfer: params.id });
  });
  R.post('/transfers/:id/receive', U(['stock.transfer', 'stock.transfer.receive']), async ({ user, params, req }) => {
    const b = await body(req);
    const ls = (b.lines ?? []).map((l) => ({ variantId: need_id(l.variantId), qtyReceived: int(l.qtyReceived, 'الكمية المستلمة', { max: 100000 }), movementId: crypto.randomUUID() }));
    await rpc('receive_transfer', { p_company: companyId, p_transfer: need_id(params.id), p_lines: ls, p_actor: user.id });
    return rpc('transfer_detail', { p_company: companyId, p_transfer: params.id });
  });

  // ═════════ العملاء ═════════
  const custOut = async (c, user) => {
    if (can(user.role, 'customers.full')) return c;
    const digits = Number(await settingValue('customers.cashier_visible_digits')) || 4;
    return { id: c.id, name: c.name, phone_e164: maskPhone(c.phone_e164, digits) };
  };
  R.get('/customers', U('customers.view'), async ({ user, query }) =>
    Promise.all((await list('customers', {}, { q: query.q, limit: Math.min(Number(query.limit ?? 50), 200), offset: Number(query.offset ?? 0) })).filter((c) => !c.deleted_at).map((c) => custOut(c, user))));
  R.post('/customers', U('customers.create'), async ({ req }) => {
    const b = await body(req);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, 'رقم الهاتف غير صالح');
    const id = await rpc('apply_customer', { p_company: companyId, p_branch: null, p: { name: str(b.name, 'الاسم', { max: 100 }), phone, address: b.address, governorate: b.governorate, notes: b.notes, tags: b.tags ?? [], source: 'branch', marketingConsent: !!b.marketingConsent } });
    return { id, phone };
  });
  R.patch('/customers/:id', U('customers.full'), async ({ user, params, req }) => {
    const b = await body(req); const p = {};
    for (const [k, c] of [['name', 'name'], ['address', 'address'], ['governorate', 'governorate'], ['notes', 'notes'], ['tags', 'tags'], ['marketingConsent', 'marketing_consent']]) if (b[k] !== undefined) p[c] = b[k];
    await audit(user, 'customer.update', 'customers', params.id, { after: p });
    return update('customers', need_id(params.id), p);
  });
  R.get('/customers/export', U('customers.export'), async ({ user }) => {
    await requireLevel(user, 'customers.export');
    const rows = await list('customers', {}, { limit: 500 });
    await audit(user, 'customers.export', 'customers', '*', { after: { count: rows.length } });
    const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = ['الاسم,الهاتف,المحافظة,المصدر', ...rows.map((c) => [c.name, c.phone_e164, c.governorate, c.source].map(esc).join(','))].join('\n');
    return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="customers.csv"' } });
  });

  // ═════════ المبيعات والفواتير والتقارير ═════════
  R.get('/invoices', U(['sales.view', 'reports.view', 'reports.view.branch']), async ({ user, query }) => {
    const b = branchScope(user, query.branch);
    return list('invoices', { ...(b ? { branch_id: b } : {}) }, { q: query.q, limit: Math.min(Number(query.limit ?? 50), 200), offset: Number(query.offset ?? 0) });
  });
  R.get('/invoices/:id', U(['sales.view', 'reports.view', 'reports.view.branch']), async ({ user, params }) => {
    const inv = await rpc('invoice_detail', { p_company: companyId, p_invoice: need_id(params.id) });
    if (!inv) throw new HttpError(404, 'الفاتورة غير موجودة');
    if (user.role === 'branch_manager' && inv.branch_id !== user.branchId) throw new HttpError(403, 'فاتورة فرع آخر');
    return inv;
  });

  const dateRange = (q) => {
    // «اليوم» بتوقيت القاهرة (نفس أساس daily_summaries) وإلا اختفت مبيعات أول ساعتين من اليوم
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '') ? q.from : today.slice(0, 8) + '01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? '') ? q.to : today;
    return { from, to };
  };
  R.get('/reports/dashboard', U(['reports.view', 'reports.view.branch']), async ({ query }) => { const r = dateRange(query); return rpc('dashboard', { p_company: companyId, p_from: r.from, p_to: r.to }); });
  R.get('/reports/sales', U(['reports.view', 'reports.view.branch']), async ({ user, query }) => {
    const r = dateRange(query);
    return rpc('sales_report', { p_company: companyId, p_from: r.from, p_to: r.to, p_branch: branchScope(user, query.branch) });
  });
  R.get('/reports/top-models', U(['reports.view']), async ({ query }) => { const r = dateRange(query); return rpc('top_models_report', { p_company: companyId, p_from: r.from, p_to: r.to, p_limit: Math.min(Number(query.limit ?? 20), 100) }); });
  R.get('/reports/cash', U(['finance.view']), async ({ query }) => { const r = dateRange(query); return rpc('cash_summary', { p_company: companyId, p_from: r.from, p_to: r.to }); });

  // لوحة استهلاك الخدمات المجانية (السوبر أدمن): تنبيه عند 70% و90%
  R.get('/reports/usage', U(), async ({ user }) => {
    if (user.role !== 'super_admin') throw new HttpError(403, 'للسوبر أدمن فقط');
    const u = await rpc('usage_report', { p_company: companyId });
    const warn = Number(await settingValue('usage.warn_pct')); const crit = Number(await settingValue('usage.critical_pct'));
    const limits = { db_bytes: 500 * 1024 * 1024 };
    const pct = (u.db_bytes / limits.db_bytes) * 100;
    return { ...u, limits, db_pct: Math.round(pct * 10) / 10, level: pct >= crit ? 'critical' : pct >= warn ? 'warning' : 'ok', note: 'طلبات Workers وR2 تُقرأ من لوحة Cloudflare (لا تتوفر عبر API القاعدة).' };
  });

  // ═════════ الحضور ═════════
  R.get('/shift-templates', U(), async () => list('shift_templates', {}, { limit: 100 }));
  R.post('/shift-templates', U('attendance.manage'), async ({ req }) => {
    const b = await body(req);
    return insert('shift_templates', { name: str(b.name, 'الاسم'), start_min: int(b.startMin, 'البداية', { max: 1439 }), end_min: int(b.endMin, 'النهاية', { max: 1439 }),
      grace_late_min: int(b.graceLateMin ?? 10, 'سماح التأخير', { max: 120 }), grace_early_leave_min: int(b.graceEarlyLeaveMin ?? 10, 'سماح الانصراف المبكر', { max: 120 }), grace_late_leave_min: int(b.graceLateLeaveMin ?? 10, 'سماح الانصراف المتأخر', { max: 240 }) });
  });
  R.patch('/shift-templates/:id', U('attendance.manage'), async ({ params, req }) => {
    const b = await body(req); const p = {};
    const map = { name: 'name', startMin: 'start_min', endMin: 'end_min', graceLateMin: 'grace_late_min', graceEarlyLeaveMin: 'grace_early_leave_min', graceLateLeaveMin: 'grace_late_leave_min', isActive: 'is_active' };
    for (const [k, c] of Object.entries(map)) if (b[k] !== undefined) p[c] = b[k];
    return update('shift_templates', need_id(params.id), p);
  });
  R.get('/schedules', U('attendance.manage'), async ({ query }) => list('schedules', query.branch ? { branch_id: query.branch } : {}, { limit: 500 }));
  R.put('/schedules', U('attendance.manage'), async ({ req }) => {
    const b = await body(req);
    const w = { user_id: need_id(b.userId), weekday: int(b.weekday, 'اليوم', { max: 6 }) };
    const [cur] = await list('schedules', w);
    if (b.templateId == null) return cur ? { removed: await rpc('api_delete_schedule', { p_company: companyId, p_id: cur.id }) } : { removed: false };
    const row = { ...w, branch_id: need_id(b.branchId), template_id: need_id(b.templateId) };
    return cur ? update('schedules', cur.id, row) : insert('schedules', row);
  });
  R.get('/attendance', U(['attendance.manage', 'attendance.manage.branch']), async ({ user, query }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month : new Date().toISOString().slice(0, 7);
    const from = new Date(`${month}-01T00:00:00+02:00`); const to = new Date(from); to.setMonth(to.getMonth() + 1);
    const events = await rpc('attendance_report', { p_company: companyId, p_from: from.toISOString(), p_to: to.toISOString(), p_branch: branchScope(user, query.branch) });
    const rules = (await settingValue('attendance.rules')) ?? DEFAULT_RULES;
    const byUser = new Map();
    for (const e of events) { if (e.corrects_event_id) continue; (byUser.get(e.user_id) ?? byUser.set(e.user_id, { userId: e.user_id, name: e.name, events: [] }).get(e.user_id)).events.push(e); }
    const summary = [...byUser.values()].map((u) => { const score = scorePeriod({ events: u.events }, rules); return { userId: u.userId, name: u.name, score, action: evaluateThresholds(score, rules), green: u.events.filter((e) => e.color === 'green').length, blue: u.events.filter((e) => e.color === 'blue').length, red: u.events.filter((e) => e.color === 'red').length }; });
    return { month, rules, summary, events };
  });
  R.post('/attendance/correct', U('attendance.manage'), async ({ user, req }) => {
    const b = await body(req);
    if (!['in', 'out'].includes(b.kind) || !['green', 'blue', 'red'].includes(b.color)) throw new HttpError(400, 'نوع أو لون غير صالح');
    const when = new Date(b.time);
    const monthStart = new Date(when.getFullYear(), when.getMonth() + 1, 1);
    if (monthStart < new Date()) await requireLevel(user, 'attendance.edit_closed_month');   // تعديل شهر مغلق يحتاج تصريحًا
    const rules = (await settingValue('attendance.rules')) ?? DEFAULT_RULES;
    const id = await rpc('correct_attendance', { p_company: companyId, p_actor: user.id, p_user: need_id(b.userId), p_branch: need_id(b.branchId), p_kind: b.kind, p_color: b.color,
      p_points: rules.colors[b.color].points, p_time: when.toISOString(), p_corrects: b.correctsEventId ? need_id(b.correctsEventId) : null, p_reason: b.reason });
    return { id };
  });

  // ═════════ الحسابات ═════════
  R.get('/cashboxes', U('finance.view'), async () => list('cashboxes', {}, { limit: 100 }));
  R.post('/cashboxes', U('finance.manage'), async ({ req }) => { const b = await body(req); return insert('cashboxes', { name: str(b.name, 'الاسم'), branch_id: b.branchId ? need_id(b.branchId) : null }); });
  R.get('/cash-entries', U('finance.view'), async ({ query }) => list('cash_entries', query.cashbox ? { cashbox_id: query.cashbox } : {}, { limit: Number(query.limit ?? 100), offset: Number(query.offset ?? 0) }));
  R.post('/cash-entries', U('finance.manage'), async ({ user, req }) => {
    const b = await body(req);
    if (!['expense', 'income', 'payment', 'adjustment'].includes(b.kind)) throw new HttpError(400, 'نوع القيد غير صالح');
    const row = await insert('cash_entries', { cashbox_id: need_id(b.cashboxId), kind: b.kind, amount: int(b.amountPiasters, 'المبلغ', { min: 1, max: 1e11 }), category: b.category ?? null, note: b.note ?? null, created_by: user.id });
    await audit(user, 'cash.entry', 'cash_entries', row.id, { after: { kind: b.kind, amount: row.amount } });
    return row;   // القيود لا تُحذف ولا تُعدَّل: التصحيح بقيد تسوية
  });

  R.get('/audit', U('audit.view'), async ({ query }) =>
    list('audit_log', query.entity ? { entity: query.entity } : {}, { limit: Math.min(Number(query.limit ?? 100), 300), offset: Number(query.offset ?? 0) }));

  // ═════════ الطلبات الإلكترونية (للموظفين) ═════════
  R.get('/orders', U('orders.manage'), async ({ query }) => list('orders', query.status ? { status: query.status } : {}, { q: query.q, limit: Math.min(Number(query.limit ?? 50), 200), offset: Number(query.offset ?? 0) }));
  R.get('/orders/:id', U('orders.manage'), async ({ params }) => rpc('order_detail', { p_company: companyId, p_order: need_id(params.id) }));
  R.post('/orders/:id/status', U('orders.manage'), async ({ user, params, req }) => {
    const b = await body(req);
    if (!['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'].includes(b.to)) throw new HttpError(400, 'حالة غير صالحة');
    if (b.paymentStatus && !['unpaid', 'paid', 'refunded'].includes(b.paymentStatus)) throw new HttpError(400, 'حالة دفع غير صالحة');
    await rpc('set_order_status', { p_company: companyId, p_order: need_id(params.id), p_to: b.to, p_actor: user.id, p_payment_status: b.paymentStatus ?? null });
    return rpc('order_detail', { p_company: companyId, p_order: params.id });
  });
  R.post('/orders/:id/payment', U('orders.manage'), async ({ user, params, req }) => {
    const b = await body(req);
    if (!['unpaid', 'paid', 'refunded'].includes(b.paymentStatus)) throw new HttpError(400, 'حالة دفع غير صالحة');
    await audit(user, 'order.payment', 'orders', params.id, { after: { paymentStatus: b.paymentStatus } });
    return update('orders', need_id(params.id), { payment_status: b.paymentStatus, updated_at: new Date().toISOString() });
  });

  // ═════════ المتجر (عام) ═════════
  const killed = async (key) => (await settingValue(key)) === true;
  R.get('/public/config', { auth: 'public' }, async () => ({
    whatsapp: (await settingValue('shop.whatsapp')) ?? config.whatsapp ?? '', storeName: (await settingValue('shop.name')) ?? 'BIGGEST',
    paymentMethods: (await settingValue('shop.payment_methods')) ?? WEB_PAYMENTS, shipping: (await settingValue('shop.shipping_piasters')) ?? 0,
    open: !(await killed('kill.shop')),
  }));
  R.get('/public/catalog.json', { auth: 'public' }, async () =>
    new Response(JSON.stringify(await rpc('catalog_snapshot', { p_company: companyId })), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=300' } }));
  R.get('/public/availability.json', { auth: 'public' }, async () =>
    new Response(JSON.stringify(await rpc('availability_snapshot', { p_company: companyId })), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=60' } }));

  R.post('/public/orders', { auth: 'public' }, async ({ req, ip }) => {
    if (await killed('kill.shop')) throw new HttpError(503, 'المتجر متوقف مؤقتًا');
    if (!orderLimiter(`order:${ip}`)) throw new HttpError(429, 'طلبات كثيرة، حاول بعد دقيقة');
    const b = await body(req);
    if (b.website) return { ok: true, number: 'WEB-000000', total: 0 };   // فخ للروبوتات (حقل مخفي): نتجاهل بصمت
    const phone = normalizePhone(b.customer?.phone);
    if (!phone) throw new HttpError(400, 'رقم الهاتف غير صالح');
    if (!isUuid(b.clientToken)) throw new HttpError(400, 'رمز الطلب مفقود');
    if (!WEB_PAYMENTS.includes(b.paymentMethod)) throw new HttpError(400, 'طريقة دفع غير صالحة');
    const ls = (b.lines ?? []).slice(0, 30).map((l) => ({ variantId: need_id(l.variantId, 'الصنف'), qty: int(l.qty, 'الكمية', { min: 1, max: 20 }) }));
    if (!ls.length) throw new HttpError(400, 'السلة فارغة');
    const utm = {}; for (const k of ['source', 'medium', 'campaign', 'content', 'fbclid']) if (b.utm?.[k]) utm[k] = String(b.utm[k]).slice(0, 100);
    return rpc('create_online_order', { p_company: companyId, p: {
      clientToken: b.clientToken, paymentMethod: b.paymentMethod, note: b.note ? String(b.note).slice(0, 300) : null, utm, lines: ls,
      customer: { name: str(b.customer?.name, 'الاسم', { max: 100 }), phone, address: str(b.customer?.address, 'العنوان', { max: 300 }), governorate: str(b.customer?.governorate, 'المحافظة', { max: 60 }), marketingConsent: !!b.customer?.marketingConsent } } });
  });
  R.get('/public/orders/:number', { auth: 'public' }, async ({ params, query, ip }) => {
    if (!orderLimiter(`track:${ip}`)) throw new HttpError(429, 'محاولات كثيرة');
    const tail = String(query.phone ?? '').replace(/\D/g, '').slice(-4);
    const o = tail.length === 4 ? await rpc('public_order_status', { p_company: companyId, p_number: params.number, p_phone_tail: tail }) : null;
    if (!o) throw new HttpError(404, 'لم نجد الطلب. تأكد من الرقم وآخر 4 أرقام من الهاتف');
    return o;
  });

  // ═════════ المزامنة (أجهزة الفروع والسيرفر المحلي) ═════════
  R.post('/sync/push', { auth: 'device' }, async ({ device, req }) => {
    if (device.branch_id && (await killed(`kill.branch.${device.branch_id}`))) throw new HttpError(423, 'الفرع موقوف من الإدارة');
    const { ops } = await body(req);
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_PUSH_BATCH) throw new HttpError(400, `الدفعة من 1 إلى ${MAX_PUSH_BATCH} عملية`);
    const bad = ops.map(validateOp).find(Boolean);
    if (bad) throw new HttpError(400, bad);
    return { results: await rpc('apply_ops', { p_company: companyId, p_device: device.id, p_ops: ops }), serverTime: new Date().toISOString() };
  });
  R.get('/sync/pull', { auth: 'device' }, async ({ device, query }) =>
    rpc('pull_changes', { p_company: companyId, p_device: device.id, p_after: Number(query.after ?? 0), p_limit: Math.min(Number(query.limit ?? MAX_PULL_LIMIT), MAX_PULL_LIMIT) }));
  R.get('/sync/snapshot', { auth: 'device' }, async ({ device }) => rpc('device_snapshot', { p_company: companyId, p_branch: device.branch_id }));
  R.get('/sync/ping', { auth: 'device' }, async ({ device }) => ({ serverTime: new Date().toISOString(), seq: await rpc('latest_seq', { p_company: companyId }), device: device.name, deviceId: device.id, branchId: device.branch_id, kind: device.kind, companyId }));
  R.get('/sync/weekly-export', { auth: 'device' }, async ({ device, query }) => {
    if (device.kind !== 'server_agent') throw new HttpError(403, 'لجهاز السيرفر المحلي فقط');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(query.to ?? '')) throw new HttpError(400, 'from و to بصيغة YYYY-MM-DD');
    return rpc('weekly_export', { p_company: companyId, p_from: query.from, p_to: query.to });
  });

  // ═════════ المعالج الرئيسي ═════════
  async function authenticate(req, opts) {
    const h = req.headers.get('authorization') ?? '';
    if (opts.auth === 'user') {
      const claims = h.startsWith('Bearer ') ? await verifyJwt(h.slice(7), config.jwtSecret) : null;
      if (!claims) throw new HttpError(401, 'سجّل الدخول من جديد');
      const user = { id: claims.sub, role: claims.role, branchId: claims.branchId, name: claims.name };
      if (opts.perm) { const perms = Array.isArray(opts.perm) ? opts.perm : [opts.perm]; need(user, ...perms); }
      return { user };
    }
    if (opts.auth === 'device') {
      const [id, secret] = (h.startsWith('Device ') ? h.slice(7) : '').split('.');
      if (!isUuid(id) || !secret) throw new HttpError(401, 'جهاز غير مصرّح');
      const [dev] = await list('devices', { id });
      if (!dev || dev.status !== 'active' || dev.token_hash !== (await sha256Hex(secret))) throw new HttpError(401, 'جهاز غير مصرّح أو موقوف');
      return { device: dev };
    }
    return {};
  }

  async function fetch(req) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, allowedOrigins);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
    try {
      let matched = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) { matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
      }
      if (!matched) throw new HttpError(404, 'المسار غير موجود');
      const auth = await authenticate(req, matched.r.opts);
      const out = await matched.r.handler({ req, url, ip, params: matched.params, query: Object.fromEntries(url.searchParams), ...auth });
      const res = out instanceof Response ? out : json(out);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      let status = 500; let payload = { error: 'خطأ غير متوقع في الخادم' };
      if (e instanceof HttpError) { status = e.status; payload = { error: e.message, ...e.extra }; }
      else if (e?.name === 'DbError') {
        const map = { P0001: 400, P0002: 409, '23505': 409, '23503': 400, '23514': 400, '22P02': 400, '42501': 403, '22007': 400 };
        status = map[e.code] ?? 500;
        payload = status === 500 ? payload : { error: e.code === '23505' ? 'السجل موجود بالفعل' : e.code === '23503' ? 'مرجع غير موجود' : e.message };
        if (status === 500) console.error('[db]', e.code, e.message);
      } else console.error('[api]', e);
      return json(payload, status, cors);
    }
  }

  return { fetch, routes };
}
