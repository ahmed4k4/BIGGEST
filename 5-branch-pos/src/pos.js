/**
 * منطق الكاشير المحلي. كل عملية: تحقق صلاحية → معاملة SQLite واحدة (فاتورة + حركات مخزون + outbox) → تُرفع لاحقًا.
 * المبالغ بالقروش (أعداد صحيحة).
 */
import {
  computeInvoice, effectiveDiscountPct, can, OP_TYPES, verifySecret, normalizePhone, normalizeDigits, maskPhone, customerIdFor,
  DEFAULT_RULES, classifyCheckIn, classifyCheckOut, nextExpectedEvent, minutesOfDay, DEFAULT_SETTINGS,
} from './shared/index.js';

export class PosError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (m, code, status) => { throw new PosError(m, code, status); };
const pad = (n, w = 6) => String(n).padStart(w, '0');

export class Pos {
  /** @param {{db:import('./db.js').BranchDb, branchId:string, deviceId?:string, posNo?:number, now?:()=>Date, uuid?:()=>string, isOnline?:()=>boolean}} o */
  constructor({ db, branchId, deviceId = null, posNo = 1, now = () => new Date(), uuid = () => crypto.randomUUID(), isOnline = () => true }) {
    Object.assign(this, { db, branchId, deviceId, posNo, now, uuid, isOnline });
    this.locks = new Map();
  }

  // ───────────── إعدادات ─────────────
  setting(key) {
    const row = this.db.mirrorAll('settings').find((s) => s.key === key);
    return row ? row.value : DEFAULT_SETTINGS[key];
  }
  get branch() { return this.branchId ? this.db.mirrorOne('branches', this.branchId) : null; }
  config() { return this.db.meta('config', {}) ?? {}; }
  get tz() { return this.setting('general.timezone') ?? 'Africa/Cairo'; }
  iso() { return this.now().toISOString(); }

  // ───────────── الدخول (يعمل بدون إنترنت على بصمات منزّلة) ─────────────
  async login(username, secret, { pin = false } = {}) {
    const key = String(username ?? '').trim().toLowerCase();
    const lock = this.locks.get(key);
    if (lock && lock.until > Date.now()) fail('تم إيقاف المحاولة مؤقتًا بعد أخطاء متكررة، حاول بعد دقيقة', 'LOCKED', 429);
    const u = this.db.mirrorAll('branch_users').find((x) => String(x.username).toLowerCase() === key && x.is_active);
    const stored = u ? (pin ? u.pin_verifier : u.verifier) : null;
    const ok = stored ? await verifySecret(String(secret ?? ''), stored) : false;
    if (!ok) {
      const n = (lock?.n ?? 0) + 1;
      this.locks.set(key, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      fail('بيانات الدخول غير صحيحة', 'AUTH', 401);
    }
    this.locks.delete(key);
    return { id: u.id, username: u.username, name: u.display_name, role: u.role };
  }

  need(user, perm) { if (!user || !can(user.role, perm)) fail('ليس لديك صلاحية لهذه العملية', 'FORBIDDEN', 403); }

  // ───────────── الأصناف ─────────────
  #variantRows(where, params, limit) {
    return this.db.all(
      `SELECT v.id, v.sku, v.model_id, v.color_name, v.color_code, v.size_name, v.size_code, m.name model_name, m.code model_code,
              COALESCE(v.price_override, m.price) price, COALESCE(sb.qty, 0) stock
       FROM variants v JOIN models m ON m.id = v.model_id LEFT JOIN stock_balance sb ON sb.variant_id = v.id
       WHERE v.is_active = 1 AND m.is_active = 1 AND ${where} ORDER BY m.name, v.color_name, v.size_code LIMIT ?`, ...params, limit);
  }

  /** باركود دقيق أو بحث نصي بكلمات متعددة. */
  search(q, limit = 40) {
    const text = normalizeDigits(String(q ?? '')).trim();
    if (!text) return [];
    const exact = this.#variantRows(`(lower(v.sku) = lower(?) OR v.extra_barcodes LIKE ?)`, [text, `%"${text.replaceAll('"', '')}"%`], 5);
    if (exact.length) return exact;
    const tokens = text.split(/\s+/).filter(Boolean).slice(0, 5);
    const where = tokens.map(() => `(m.name || ' ' || IFNULL(m.code,'') || ' ' || v.sku || ' ' || IFNULL(v.color_name,'') || ' ' || IFNULL(v.size_name,'')) LIKE ?`).join(' AND ');
    return this.#variantRows(where, tokens.map((t) => `%${t.replaceAll('%', '')}%`), limit);
  }

  variant(id) { return this.#variantRows('v.id = ?', [id], 1)[0] ?? null; }

  // ───────────── العملاء ─────────────
  searchCustomers(q, user) {
    const t = normalizeDigits(String(q ?? '')).trim();
    if (t.length < 2) return [];
    const rows = this.db.all(`SELECT id, name, phone, governorate FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 20`, `%${t}%`, `%${t}%`);
    const digits = Number(this.setting('customers.cashier_visible_digits') ?? 4);
    const full = can(user?.role, 'customers.full');
    return rows.map((r) => ({ id: r.id, name: r.name, governorate: r.governorate, phone: full ? r.phone : maskPhone(r.phone, digits) }));
  }

  async upsertCustomer(input, user) {
    this.need(user, 'customers.create');
    const phone = normalizePhone(input.phone);
    if (!phone) fail('رقم الهاتف غير صالح', 'VALIDATION');
    const name = String(input.name ?? '').trim();
    if (name.length < 2) fail('اكتب اسم العميل', 'VALIDATION');
    const companyId = this.branch?.company_id;
    if (!companyId) fail('بيانات الفرع لم تُنزَّل بعد، شغّل المزامنة مرة', 'NOT_READY', 409);
    const id = await customerIdFor(companyId, phone);
    const now = this.iso();
    this.db.tx(() => {
      this.db.run(`INSERT INTO customers (id, name, phone, address, governorate, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=COALESCE(excluded.address, address), governorate=COALESCE(excluded.governorate, governorate), updated_at=excluded.updated_at`,
      id, name, phone, input.address ?? null, input.governorate ?? null, now);
      this.db.enqueue(this.uuid(), OP_TYPES.CUSTOMER_UPSERT, {
        phone, name, address: input.address ?? null, governorate: input.governorate ?? null, marketingConsent: Boolean(input.marketingConsent),
        source: 'branch', createdAt: now, updatedAt: now,
      }, now);
    });
    return { id, name, phone };
  }

  // ───────────── الورديات ─────────────
  currentShift() { return this.db.get(`SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`) ?? null; }

  openShift(user, openingCash = 0) {
    this.need(user, 'sales.create');
    if (!Number.isInteger(openingCash) || openingCash < 0) fail('رصيد الدرج الافتتاحي غير صالح', 'VALIDATION');
    const cur = this.currentShift();
    if (cur) fail('هناك وردية مفتوحة بالفعل، أغلقها أولًا', 'CONFLICT', 409);
    const id = this.uuid();
    this.db.run('INSERT INTO shifts (id, cashier_id, opening_cash, opened_at) VALUES (?,?,?,?)', id, user.id, openingCash, this.iso());
    return this.currentShift();
  }

  shiftSummary(shiftId) {
    const sh = this.db.get('SELECT * FROM shifts WHERE id = ?', shiftId);
    if (!sh) fail('الوردية غير موجودة', 'NOT_FOUND', 404);
    const one = (sql) => this.db.get(sql, shiftId)?.n ?? 0;
    const cashIn = one(`SELECT COALESCE(SUM(p.amount),0) n FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.shift_id=? AND i.kind='sale' AND p.method='cash'`)
      - one(`SELECT COALESCE(SUM(change_due),0) n FROM invoices WHERE shift_id=? AND kind='sale'`);
    const cashOut = one(`SELECT COALESCE(SUM(total),0) n FROM invoices WHERE shift_id=? AND kind='return'`);
    const salesTotal = one(`SELECT COALESCE(SUM(total),0) n FROM invoices WHERE shift_id=? AND kind='sale'`);
    const cardTotal = one(`SELECT COALESCE(SUM(p.amount),0) n FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.shift_id=? AND i.kind='sale' AND p.method<>'cash'`);
    return { shift: sh, invoices: one(`SELECT COUNT(*) n FROM invoices WHERE shift_id=? AND kind='sale'`), returns: one(`SELECT COUNT(*) n FROM invoices WHERE shift_id=? AND kind='return'`),
      salesTotal, cashIn, cardTotal, cashOut, expectedCash: sh.opening_cash + cashIn - cashOut };
  }

  closeShift(user, closingCash) {
    this.need(user, 'sales.create');
    const sh = this.currentShift();
    if (!sh) fail('لا توجد وردية مفتوحة', 'NOT_FOUND', 404);
    if (!Number.isInteger(closingCash) || closingCash < 0) fail('المبلغ المعدود غير صالح', 'VALIDATION');
    const sum = this.shiftSummary(sh.id);
    const closedAt = this.iso();
    this.db.tx(() => {
      this.db.run('UPDATE shifts SET closed_at=?, closing_cash=?, expected_cash=? WHERE id=?', closedAt, closingCash, sum.expectedCash, sh.id);
      this.db.enqueue(this.uuid(), OP_TYPES.SHIFT_CLOSE, { id: sh.id, cashierId: sh.cashier_id, openingCash: sh.opening_cash, closingCash, expectedCash: sum.expectedCash, openedAt: sh.opened_at, closedAt }, closedAt);
    });
    return { ...sum, closingCash, difference: closingCash - sum.expectedCash, closedAt };
  }

  // ───────────── البيع ─────────────
  #resolveLines(inputLines) {
    if (!Array.isArray(inputLines) || !inputLines.length) fail('الفاتورة بدون أصناف', 'VALIDATION');
    const merged = new Map();
    for (const l of inputLines) {
      const key = l.variantId;
      const prev = merged.get(key);
      merged.set(key, { variantId: key, qty: (prev?.qty ?? 0) + Number(l.qty), lineDiscount: (prev?.lineDiscount ?? 0) + Number(l.lineDiscount ?? 0) });
    }
    return [...merged.values()].map((l) => {
      const v = this.variant(l.variantId);
      if (!v) fail('صنف غير موجود أو متوقف', 'NOT_FOUND', 404);
      return { ...l, v, unitPrice: v.price };
    });
  }

  #totals(lines, discount) {
    const taxOn = Boolean(this.setting('tax.enabled'));
    return computeInvoice(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, lineDiscount: l.lineDiscount })), {
      discountPct: discount?.pct ?? 0, discountAmount: discount?.amount ?? 0,
      taxRatePct: taxOn ? Number(this.setting('tax.rate_pct') ?? 14) : 0, taxInclusive: this.setting('tax.inclusive') !== false,
    });
  }

  /** معاينة الإجماليات قبل الدفع (نفس الحساب الذي يُحفظ). */
  quote({ lines, discount }) {
    const rl = this.#resolveLines(lines);
    const totals = this.#totals(rl, discount);
    return { totals, warnings: rl.filter((l) => l.v.stock < l.qty).map((l) => ({ variantId: l.variantId, sku: l.v.sku, stock: l.v.stock, qty: l.qty })) };
  }

  #nextNumber() {
    const code = this.branch?.code ?? 'BR';
    return `${code}${this.posNo > 1 ? `P${this.posNo}` : ''}-${pad(this.db.nextCounter('invoice'))}`;
  }

  /**
   * @param {{lines:{variantId:string,qty:number,lineDiscount?:number}[], discount?:{pct?:number,amount?:number},
   *          payments?:{method:'cash'|'card'|'wallet',amount:number}[], customerId?:string, isTraining?:boolean}} input
   */
  createSale(input, user) {
    this.need(user, 'sales.create');
    const rl = this.#resolveLines(input.lines);
    for (const l of rl) if (!Number.isInteger(l.qty) || l.qty <= 0) fail('الكمية يجب أن تكون عددًا صحيحًا موجبًا', 'VALIDATION');
    if (!this.isOnline()) {
      const max = Number(this.setting('offline.max_qty_per_item') ?? 5);
      const over = rl.find((l) => l.qty > max);
      if (over && !can(user.role, 'discount.high')) fail(`بدون إنترنت: الحد الأقصى ${max} قطع من نفس الصنف، استدعِ المدير`, 'OFFLINE_LIMIT', 403);
    }
    const totals = this.#totals(rl, input.discount);
    const maxPct = Number(this.setting('discount.cashier_max_pct') ?? 10);
    if (effectiveDiscountPct(totals) > maxPct + 1e-9 && !can(user.role, 'discount.high')) fail(`الخصم أعلى من حدّك (${maxPct}%)، يلزم موافقة المدير`, 'DISCOUNT_LIMIT', 403);

    const payments = (input.payments?.length ? input.payments : [{ method: 'cash', amount: totals.total }]).map((p) => ({ method: p.method, amount: Number(p.amount) }));
    if (payments.some((p) => !['cash', 'card', 'wallet'].includes(p.method) || !Number.isInteger(p.amount) || p.amount <= 0)) fail('بيانات الدفع غير صالحة', 'VALIDATION');
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    if (paid < totals.total) fail('المبلغ المدفوع أقل من إجمالي الفاتورة', 'UNDERPAID');
    const cash = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    const changeDue = paid - totals.total;
    if (changeDue > cash) fail('الباقي لا يُرد إلا من النقدي', 'VALIDATION');

    const training = Boolean(input.isTraining);
    const id = this.uuid(); const createdAt = this.iso(); const shift = this.currentShift();
    const number = training ? `TRAIN-${pad(this.db.nextCounter('training'), 4)}` : this.#nextNumber();
    const lines = rl.map((l) => ({
      variantId: l.variantId, sku: l.v.sku, modelName: l.v.model_name, colorName: l.v.color_name, sizeName: l.v.size_name, qty: l.qty, unitPrice: l.unitPrice,
      lineDiscount: l.lineDiscount, lineTotal: l.qty * l.unitPrice - l.lineDiscount, movementId: this.uuid(),
    }));
    const invoice = { id, number, kind: 'sale', gross: totals.gross, discount: totals.discount, tax: totals.tax, total: totals.total, paid, changeDue, createdAtDevice: createdAt,
      cashierId: user.id, customerId: input.customerId ?? null, shiftId: shift?.id ?? null, ...(training ? { isTraining: true } : {}) };

    this.db.tx(() => {
      if (!training) this.#insertInvoice(invoice, lines, payments);
      if (!training) {
        for (const l of lines) this.db.addLocalMovement({ id: l.movementId, variantId: l.variantId, qtyDelta: -l.qty, kind: 'sale', docType: 'invoice', docId: id, createdAt });
        this.db.enqueue(this.uuid(), OP_TYPES.SALE_CREATE, { invoice, lines, payments }, createdAt);
      }
    });
    return { invoice, lines, payments, totals, training, warnings: rl.filter((l) => l.v.stock < l.qty).map((l) => ({ sku: l.v.sku, stock: l.v.stock, qty: l.qty })) };
  }

  #insertInvoice(inv, lines, payments) {
    this.db.run(`INSERT INTO invoices (id, number, kind, ref_invoice_id, customer_id, cashier_id, shift_id, gross, discount, tax, total, paid, change_due, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      inv.id, inv.number, inv.kind, inv.refInvoiceId ?? null, inv.customerId ?? null, inv.cashierId, inv.shiftId ?? null, inv.gross, inv.discount, inv.tax, inv.total, inv.paid, inv.changeDue, inv.createdAtDevice);
    for (const l of lines) this.db.run(`INSERT INTO invoice_lines (invoice_id, variant_id, sku, model_name, color_name, size_name, qty, unit_price, line_discount, line_total) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      inv.id, l.variantId, l.sku, l.modelName, l.colorName, l.sizeName, l.qty, l.unitPrice, l.lineDiscount, l.lineTotal);
    for (const p of payments) this.db.run('INSERT INTO payments (invoice_id, method, amount) VALUES (?,?,?)', inv.id, p.method, p.amount);
  }

  // ───────────── المرتجع ─────────────
  /** @param {{refInvoiceId:string, lines:{variantId:string, qty:number}[], override?:boolean}} input */
  createReturn(input, user) {
    this.need(user, 'returns.create');
    const orig = this.db.get(`SELECT * FROM invoices WHERE id = ? AND kind = 'sale'`, input.refInvoiceId);
    if (!orig) fail('الفاتورة الأصلية غير موجودة في هذا الفرع', 'NOT_FOUND', 404);
    const maxDays = Number(this.setting('returns.max_days') ?? 14);
    const ageDays = (this.now() - new Date(orig.created_at)) / 86_400_000;
    if (ageDays > maxDays && !(input.override && can(user.role, 'discount.high'))) fail(`مدة الاسترجاع (${maxDays} يومًا) انتهت، يلزم المدير`, 'RETURN_WINDOW', 403);

    const origLines = this.db.all('SELECT * FROM invoice_lines WHERE invoice_id = ?', orig.id);
    const returned = this.db.all(`SELECT il.variant_id, SUM(il.qty) qty FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.ref_invoice_id = ? AND i.kind = 'return' GROUP BY il.variant_id`, orig.id);
    const sub = origLines.reduce((s, l) => s + l.line_total, 0);
    const invDisc = Math.max(0, orig.discount - origLines.reduce((s, l) => s + l.line_discount, 0));
    const factor = sub > 0 ? (sub - invDisc) / sub : 1;

    const lines = [];
    for (const want of input.lines) {
      const ol = origLines.find((l) => l.variant_id === want.variantId);
      if (!ol) fail('الصنف ليس في الفاتورة الأصلية', 'VALIDATION');
      const left = ol.qty - (returned.find((r) => r.variant_id === want.variantId)?.qty ?? 0);
      if (!Number.isInteger(want.qty) || want.qty <= 0 || want.qty > left) fail(`المتاح للإرجاع من ${ol.model_name} هو ${left} فقط`, 'VALIDATION');
      const lineTotal = Math.round((ol.line_total * want.qty * factor) / ol.qty);
      lines.push({ variantId: ol.variant_id, sku: ol.sku, modelName: ol.model_name, colorName: ol.color_name, sizeName: ol.size_name, qty: want.qty, unitPrice: ol.unit_price,
        lineDiscount: want.qty * ol.unit_price - lineTotal, lineTotal, movementId: this.uuid() });
    }
    if (!lines.length) fail('اختر أصنافًا للإرجاع', 'VALIDATION');
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    const gross = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const tax = orig.total > 0 ? Math.round((orig.tax * total) / orig.total) : 0;
    const id = this.uuid(); const createdAt = this.iso();
    const invoice = { id, number: this.#nextNumber(), kind: 'return', refInvoiceId: orig.id, gross, discount: gross - total, tax, total, paid: total, changeDue: 0,
      createdAtDevice: createdAt, cashierId: user.id, customerId: orig.customer_id, shiftId: this.currentShift()?.id ?? null };
    const payments = [{ method: 'cash', amount: total }];
    this.db.tx(() => {
      this.#insertInvoice(invoice, lines, payments);
      for (const l of lines) this.db.addLocalMovement({ id: l.movementId, variantId: l.variantId, qtyDelta: l.qty, kind: 'return_in', docType: 'invoice', docId: id, createdAt });
      this.db.enqueue(this.uuid(), OP_TYPES.SALE_CREATE, { invoice, lines, payments }, createdAt);
    });
    return { invoice, lines, payments };
  }

  // ───────────── الفواتير والطباعة ─────────────
  listInvoices({ q = '', limit = 50 } = {}) {
    const t = normalizeDigits(String(q)).trim();
    return this.db.all(`SELECT id, number, kind, total, created_at, ref_invoice_id, reprints FROM invoices ${t ? 'WHERE number LIKE ?' : ''} ORDER BY created_at DESC LIMIT ?`, ...(t ? [`%${t}%`] : []), Math.min(limit, 200));
  }

  getInvoice(id) {
    const inv = this.db.get('SELECT * FROM invoices WHERE id = ? OR number = ?', id, id);
    if (!inv) fail('الفاتورة غير موجودة', 'NOT_FOUND', 404);
    const lines = this.db.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', inv.id);
    const returned = this.db.all(`SELECT il.variant_id, SUM(il.qty) qty FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.ref_invoice_id = ? AND i.kind='return' GROUP BY il.variant_id`, inv.id);
    return { ...inv, lines: lines.map((l) => ({ ...l, returnable: l.qty - (returned.find((r) => r.variant_id === l.variant_id)?.qty ?? 0) })), payments: this.db.all('SELECT method, amount FROM payments WHERE invoice_id = ?', inv.id) };
  }

  /** بيانات جاهزة لمولّد الفاتورة. إعادة الطباعة محدودة (invoice.max_reprints) إلا للمدير. */
  receiptData(id, { reprint = false, user } = {}) {
    const inv = this.getInvoice(id);
    if (reprint) {
      const max = Number(this.setting('invoice.max_reprints') ?? 3);
      if (inv.reprints >= max && !can(user?.role, 'discount.high')) fail(`وصلت الحد الأقصى لإعادة الطباعة (${max})`, 'REPRINT_LIMIT', 403);
      this.db.run('UPDATE invoices SET reprints = reprints + 1 WHERE id = ?', inv.id);
    }
    const cfg = this.config();
    const cashier = this.db.mirrorAll('branch_users').find((u) => u.id === inv.cashier_id);
    const cust = inv.customer_id ? this.db.get('SELECT name FROM customers WHERE id = ?', inv.customer_id) : null;
    return {
      shop: { name: cfg.shopName ?? 'BIGGEST', phone: cfg.shopPhone ?? this.branch?.phone ?? '', address: cfg.shopAddress ?? this.branch?.address ?? '' },
      branchName: this.branch?.name, invoice: { number: inv.number, createdAt: inv.created_at, kind: inv.kind }, cashierName: cashier?.display_name, customerName: cust?.name,
      lines: inv.lines.map((l) => ({ name: l.model_name, detail: [l.color_name, l.size_name].filter(Boolean).join(' • '), qty: l.qty, unitPrice: l.unit_price, lineTotal: l.line_total })),
      totals: { gross: inv.gross, discount: inv.discount, tax: inv.tax, total: inv.total, paid: inv.paid, changeDue: inv.change_due }, payments: inv.payments,
      footer: cfg.footer, qrText: cfg.trackUrl ? `${cfg.trackUrl}${cfg.trackUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(inv.number)}` : undefined,
      reprint,
    };
  }

  todaySummary() {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.tz }).format(this.now());
    const rows = this.db.all(`SELECT kind, total, created_at FROM invoices`).filter((r) => new Intl.DateTimeFormat('en-CA', { timeZone: this.tz }).format(new Date(r.created_at)) === day);
    const sum = (k) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.total, 0);
    return { day, invoices: rows.filter((r) => r.kind === 'sale').length, returns: rows.filter((r) => r.kind === 'return').length, sales: sum('sale'), refunds: sum('return'), net: sum('sale') - sum('return') };
  }

  // ───────────── الجرد ─────────────
  /** @param {{variantId:string, counted:number}[]} lines */
  submitCount(lines, note, user) {
    this.need(user, 'stock.count');
    if (!Array.isArray(lines) || !lines.length) fail('لا توجد أصناف في الجرد', 'VALIDATION');
    const countId = this.uuid(); const createdAt = this.iso();
    const out = lines.map((l) => {
      if (!Number.isInteger(l.counted) || l.counted < 0) fail('الكمية المعدودة غير صالحة', 'VALIDATION');
      const v = this.variant(l.variantId) ?? fail('صنف غير موجود', 'NOT_FOUND', 404);
      const before = this.db.stockOf(l.variantId);
      return { variantId: l.variantId, sku: v.sku, before, counted: l.counted, delta: l.counted - before, movementId: this.uuid() };
    });
    this.db.tx(() => {
      for (const l of out) if (l.delta !== 0) this.db.addLocalMovement({ id: l.movementId, variantId: l.variantId, qtyDelta: l.delta, kind: 'count_adjust', docType: 'count', docId: countId, createdAt });
      this.db.enqueue(this.uuid(), OP_TYPES.STOCK_COUNT, { countId, note: note ?? null, lines: out.map((l) => ({ variantId: l.variantId, delta: l.delta, movementId: l.movementId })) }, createdAt);
    });
    return { countId, lines: out, differences: out.filter((l) => l.delta !== 0).length };
  }

  // ───────────── استلام التحويلات ─────────────
  incomingTransfers() {
    const lines = this.db.mirrorAll('transfer_lines');
    const from = (id) => this.db.mirrorOne('branches', id)?.name ?? '';
    return this.db.mirrorAll('transfers')
      .filter((t) => t.to_branch_id === this.branchId && ['in_transit', 'partially_received'].includes(t.status))
      .map((t) => ({ id: t.id, number: t.number, from: from(t.from_branch_id), status: t.status,
        lines: lines.filter((l) => l.transfer_id === t.id).map((l) => {
          const v = this.db.get(`SELECT v.sku, v.color_name, v.size_name, m.name model_name FROM variants v JOIN models m ON m.id = v.model_id WHERE v.id = ?`, l.variant_id);
          return { variantId: l.variant_id, sku: v?.sku, name: v ? `${v.model_name} ${v.color_name ?? ''} ${v.size_name ?? ''}`.trim() : l.variant_id, qtySent: l.qty_sent, qtyReceived: l.qty_received ?? 0 };
        }) }));
  }

  /** @param {{variantId:string, qtyReceived:number}[]} lines */
  receiveTransfer(transferId, lines, user) {
    this.need(user, 'stock.transfer.receive');
    const t = this.incomingTransfers().find((x) => x.id === transferId) ?? fail('تحويل غير موجود أو ليس بانتظار الاستلام', 'NOT_FOUND', 404);
    const createdAt = this.iso();
    const out = lines.map((l) => {
      const tl = t.lines.find((x) => x.variantId === l.variantId) ?? fail('صنف ليس في التحويل', 'VALIDATION');
      if (!Number.isInteger(l.qtyReceived) || l.qtyReceived < 0 || l.qtyReceived > tl.qtySent - tl.qtyReceived) fail(`الكمية المستلمة من ${tl.name} أكبر من المتبقي (${tl.qtySent - tl.qtyReceived})`, 'VALIDATION');
      return { variantId: l.variantId, qtyReceived: l.qtyReceived, movementId: this.uuid() };
    }).filter((l) => l.qtyReceived > 0);
    if (!out.length) fail('اكتب الكميات المستلمة', 'VALIDATION');
    this.db.tx(() => {
      for (const l of out) this.db.addLocalMovement({ id: l.movementId, variantId: l.variantId, qtyDelta: l.qtyReceived, kind: 'transfer_in', docType: 'transfer', docId: transferId, createdAt });
      for (const l of out) {
        const row = this.db.mirrorAll('transfer_lines').find((x) => x.transfer_id === transferId && x.variant_id === l.variantId);
        if (row) this.db.run('UPDATE mirror SET json = ? WHERE tbl = ? AND id = ?', JSON.stringify({ ...row, qty_received: (row.qty_received ?? 0) + l.qtyReceived }), 'transfer_lines', String(row.id));
      }
      this.db.enqueue(this.uuid(), OP_TYPES.TRANSFER_RECEIVE, { transferId, lines: out }, createdAt);
    });
    return { transferId, received: out.length };
  }

  // ───────────── الحضور ─────────────
  lastAttendance(userId) { return this.db.get('SELECT * FROM attendance WHERE user_id = ? ORDER BY device_time DESC LIMIT 1', userId) ?? null; }

  recordAttendance(user) {
    this.need(user, 'attendance.record');
    const last = this.lastAttendance(user.id);
    if (last && this.now() - new Date(last.device_time) < 60_000) fail('تم التسجيل للتو، انتظر دقيقة', 'TOO_SOON', 429);
    const kind = nextExpectedEvent(last);
    const at = this.now();
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: this.tz, weekday: 'short' }).format(at));
    const sch = this.db.mirrorAll('schedules').find((s) => s.user_id === user.id && s.branch_id === this.branchId && s.weekday === weekday && s.template_id);
    const tpl = sch ? this.db.mirrorOne('shift_templates', sch.template_id) : null;
    const rules = this.setting('attendance.rules') ?? DEFAULT_RULES;
    let res;
    if (!tpl) res = { color: 'blue', points: rules.colors.blue.points, label: 'بدون وردية مجدولة اليوم' };
    else {
      const shift = { startMin: tpl.start_min, endMin: tpl.end_min, graceLateMin: tpl.grace_late_min, graceEarlyLeaveMin: tpl.grace_early_leave_min, graceLateLeaveMin: tpl.grace_late_leave_min };
      const minute = minutesOfDay(at, this.tz);
      res = kind === 'in' ? classifyCheckIn(shift, minute, rules) : classifyCheckOut(shift, minute, rules);
    }
    const id = this.uuid(); const deviceTime = at.toISOString();
    this.db.tx(() => {
      this.db.run('INSERT INTO attendance (id, user_id, kind, color, points, device_time) VALUES (?,?,?,?,?,?)', id, user.id, kind, res.color, res.points, deviceTime);
      this.db.enqueue(this.uuid(), OP_TYPES.ATTENDANCE_RECORD, { id, userId: user.id, kind, color: res.color, points: res.points, deviceTime, clockSource: 'device' }, deviceTime);
    });
    return { id, kind, color: res.color, points: res.points, label: res.label, at: deviceTime };
  }
}
