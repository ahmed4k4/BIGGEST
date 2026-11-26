/**
 * قاعدة بيانات الفرع المحلية (SQLite عبر node:sqlite — بدون أي مكتبة خارجية).
 * - جداول ساخنة للبحث السريع: models / variants / customers.
 * - mirror: نسخة عامة (جدول، id، json) لباقي الجداول المنزّلة من السحابة.
 * - stock_movements + stock_balance: دفتر مخزون محلي. المفتاح id واحد محليًا وعلى السيرفر، فلا يُحتسب مرتين.
 * - outbox: العمليات المنتظرة للرفع.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS mirror (tbl TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (tbl, id));
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL, category_id TEXT, price INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, sku TEXT NOT NULL, color_code TEXT, color_name TEXT, size_code TEXT, size_name TEXT,
  extra_barcodes TEXT NOT NULL DEFAULT '[]', price_override INTEGER, is_active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS variants_sku ON variants(sku);
CREATE INDEX IF NOT EXISTS variants_model ON variants(model_id);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, governorate TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS customers_phone ON customers(phone);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, qty_delta INTEGER NOT NULL, kind TEXT NOT NULL, doc_type TEXT, doc_id TEXT,
  created_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'server');
CREATE INDEX IF NOT EXISTS movements_variant ON stock_movements(variant_id);
CREATE TABLE IF NOT EXISTS stock_balance (variant_id TEXT PRIMARY KEY, qty INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox (
  op_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, device_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, synced_at TEXT);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, seq);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, ref_invoice_id TEXT, customer_id TEXT, cashier_id TEXT, shift_id TEXT,
  gross INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, paid INTEGER NOT NULL, change_due INTEGER NOT NULL,
  created_at TEXT NOT NULL, reprints INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS invoices_created ON invoices(created_at);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(id), variant_id TEXT NOT NULL, sku TEXT NOT NULL,
  model_name TEXT NOT NULL, color_name TEXT, size_name TEXT, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL, line_discount INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS invoice_lines_inv ON invoice_lines(invoice_id);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(id), method TEXT NOT NULL, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, cashier_id TEXT NOT NULL, opening_cash INTEGER NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, closing_cash INTEGER, expected_cash INTEGER);
CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, color TEXT, points REAL, device_time TEXT NOT NULL);
`;

export const MIRROR_TABLES = ['branches', 'categories', 'model_images', 'code_templates', 'settings', 'branch_users', 'transfers', 'transfer_lines', 'shift_templates', 'schedules'];

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return new BranchDb(db);
}

const bool = (v) => (v ? 1 : 0);

export class BranchDb {
  constructor(db) { this.db = db; this.q = new Map(); }
  prep(sql) { let s = this.q.get(sql); if (!s) { s = this.db.prepare(sql); this.q.set(sql, s); } return s; }
  run(sql, ...p) { return this.prep(sql).run(...p); }
  get(sql, ...p) { return this.prep(sql).get(...p); }
  all(sql, ...p) { return this.prep(sql).all(...p); }
  close() { this.db.close(); }

  /** معاملة ذرية (إما كل شيء أو لا شيء). تدعم التداخل بحارس بسيط. */
  tx(fn) {
    if (this._inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this._inTx = true;
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } finally { this._inTx = false; }
  }

  meta(key, fallback = null) { const r = this.get('SELECT value FROM meta WHERE key = ?', key); return r ? JSON.parse(r.value) : fallback; }
  setMeta(key, value) { this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value)); }
  nextCounter(name) { return this.tx(() => { const n = (this.meta(`counter.${name}`, 0) ?? 0) + 1; this.setMeta(`counter.${name}`, n); return n; }); }

  // ───────────── تطبيق بيانات السحابة ─────────────
  /** يطبّق تغييرًا واحدًا من السحابة. @returns {boolean} هل تغيّر شيء */
  applyChange(table, rowId, op, data, branchId) {
    if (op === 'delete') return this.#remove(table, rowId);
    return this.#upsert(table, rowId, data, branchId);
  }

  #remove(table, id) {
    if (table === 'models') this.run('DELETE FROM models WHERE id = ?', id);
    else if (table === 'variants') this.run('DELETE FROM variants WHERE id = ?', id);
    else if (table === 'customers') this.run('DELETE FROM customers WHERE id = ?', id);
    else if (table !== 'stock_movements') this.run('DELETE FROM mirror WHERE tbl = ? AND id = ?', table, id);
    return true;
  }

  #upsert(table, id, d, branchId) {
    switch (table) {
      case 'models':
        this.run(`INSERT INTO models (id, code, name, category_id, price, is_active) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, category_id=excluded.category_id, price=excluded.price, is_active=excluded.is_active`,
        id, d.code ?? null, d.name, d.category_id ?? null, Number(d.price_piasters), bool(d.is_active));
        return true;
      case 'variants':
        this.run(`INSERT INTO variants (id, model_id, sku, color_code, color_name, size_code, size_name, extra_barcodes, price_override, is_active) VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET model_id=excluded.model_id, sku=excluded.sku, color_code=excluded.color_code, color_name=excluded.color_name,
            size_code=excluded.size_code, size_name=excluded.size_name, extra_barcodes=excluded.extra_barcodes, price_override=excluded.price_override, is_active=excluded.is_active`,
        id, d.model_id, d.sku, d.color_code ?? null, d.color_name ?? null, d.size_code ?? null, d.size_name ?? null,
        JSON.stringify(d.extra_barcodes ?? []), d.price_override_piasters == null ? null : Number(d.price_override_piasters), bool(d.is_active));
        return true;
      case 'customers':
        if (d.deleted_at || d.merged_into) { this.run('DELETE FROM customers WHERE id = ?', id); return true; }
        this.run(`INSERT INTO customers (id, name, phone, address, governorate, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, address=excluded.address, governorate=excluded.governorate, updated_at=excluded.updated_at`,
        id, d.name, d.phone_e164 ?? null, d.address ?? null, d.governorate ?? null, d.updated_at ?? null);
        return true;
      case 'stock_movements': {
        if (branchId && d.branch_id && d.branch_id !== branchId) return false;
        const ins = this.run(`INSERT OR IGNORE INTO stock_movements (id, variant_id, qty_delta, kind, doc_type, doc_id, created_at, source) VALUES (?,?,?,?,?,?,?, 'server')`,
          id, d.variant_id, d.qty_delta, d.kind, d.doc_type ?? null, d.doc_id ?? null, d.created_at_server ?? d.created_at_device ?? new Date().toISOString());
        if (ins.changes) this.#bump(d.variant_id, d.qty_delta);
        else this.run(`UPDATE stock_movements SET source = 'server' WHERE id = ?`, id); // أكّدها السيرفر
        return Boolean(ins.changes);
      }
      default:
        this.run('INSERT INTO mirror (tbl, id, json) VALUES (?,?,?) ON CONFLICT(tbl, id) DO UPDATE SET json = excluded.json', table, id, JSON.stringify(d));
        return true;
    }
  }

  #bump(variantId, delta) {
    this.run('INSERT INTO stock_balance (variant_id, qty) VALUES (?, ?) ON CONFLICT(variant_id) DO UPDATE SET qty = qty + excluded.qty', variantId, delta);
  }

  /** حركة مخزون محلية (بيع/مرتجع/جرد/استلام) بنفس id الذي يُرسل للسيرفر. */
  addLocalMovement({ id, variantId, qtyDelta, kind, docType, docId, createdAt }) {
    const r = this.run(`INSERT OR IGNORE INTO stock_movements (id, variant_id, qty_delta, kind, doc_type, doc_id, created_at, source) VALUES (?,?,?,?,?,?,?, 'local')`,
      id, variantId, qtyDelta, kind, docType ?? null, docId ?? null, createdAt);
    if (r.changes) this.#bump(variantId, qtyDelta);
  }

  stockOf(variantId) { return this.get('SELECT qty FROM stock_balance WHERE variant_id = ?', variantId)?.qty ?? 0; }

  /** لقطة كاملة: تستبدل بيانات السحابة وتحتفظ بالحركات المحلية التي لم يؤكدها السيرفر. */
  applySnapshot(snap, branchId) {
    this.tx(() => {
      for (const t of ['models', 'variants', 'customers', 'mirror']) this.run(`DELETE FROM ${t}`);
      this.run(`DELETE FROM stock_movements WHERE source = 'server'`);
      for (const [table, rows] of Object.entries(snap.tables ?? {})) {
        for (const row of rows) this.#upsert(table, rowIdOf(table, row), row, branchId);
      }
      this.run('DELETE FROM stock_balance');
      this.run('INSERT INTO stock_balance (variant_id, qty) SELECT variant_id, SUM(qty_delta) FROM stock_movements GROUP BY variant_id');
      this.setMeta('last_seq', Number(snap.seq ?? 0));
      this.setMeta('snapshot_at', new Date().toISOString());
    });
  }

  // ───────────── outbox ─────────────
  enqueue(opId, type, payload, deviceTime = new Date().toISOString()) {
    const seq = this.nextCounter('outbox');
    this.run('INSERT INTO outbox (op_id, seq, type, payload, device_time) VALUES (?,?,?,?,?)', opId, seq, type, JSON.stringify(payload), deviceTime);
  }
  pendingOps(limit = 100) { return this.all(`SELECT op_id, type, payload, device_time FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?`, limit); }
  markOps(results) {
    this.tx(() => {
      for (const r of results) {
        if (r.status === 'ok' || r.status === 'duplicate') this.run(`UPDATE outbox SET status='synced', synced_at=?, error=NULL WHERE op_id=?`, new Date().toISOString(), r.opId);
        else this.run(`UPDATE outbox SET status='failed', error=?, attempts=attempts+1 WHERE op_id=?`, String(r.error ?? 'خطأ'), r.opId);
      }
    });
  }
  retryFailed() { return this.run(`UPDATE outbox SET status='pending', error=NULL WHERE status='failed'`).changes; }
  outboxStats() {
    const c = (s) => this.get(`SELECT COUNT(*) n FROM outbox WHERE status = ?`, s).n;
    return { pending: c('pending'), failed: c('failed'), synced: c('synced') };
  }
  mirrorAll(table) { return this.all('SELECT json FROM mirror WHERE tbl = ?', table).map((r) => JSON.parse(r.json)); }
  mirrorOne(table, id) { const r = this.get('SELECT json FROM mirror WHERE tbl = ? AND id = ?', table, id); return r ? JSON.parse(r.json) : null; }
}

function rowIdOf(table, row) { return String(row.id ?? `${row.transfer_id}:${row.variant_id}`); }
