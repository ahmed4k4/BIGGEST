-- 001_core.sql  |  الجداول الأساسية (PostgreSQL 15+ / Supabase)
-- المبالغ بالقروش (bigint). الفواتير والحركات المالية لا تُحذف. المخزون = دفتر حركات (Ledger).

begin;

create extension if not exists pgcrypto;

-- ───────────── الشركة والمواقع ─────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_number text,
  created_at timestamptz not null default now()
);

-- موقع = المخزن الرئيسي | فرع | مخزون الموقع المنفصل (للمتجر)
create table branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,                      -- بادئة الفواتير مثل CAI
  name text not null,
  kind text not null check (kind in ('main_warehouse','branch','web_stock')),
  address text,
  phone text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  username text not null,
  display_name text not null,
  role text not null check (role in ('super_admin','admin','branch_manager','storekeeper','accountant','cashier')),
  branch_id uuid references branches(id),
  password_hash text not null,             -- pbkdf2$iterations$salt$hash
  pin_hash text,                           -- لتسجيل الحضور وموافقة الخصم
  is_active boolean not null default true,
  failed_logins int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, username)
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  name text not null,
  kind text not null default 'branch_agent' check (kind in ('branch_agent','server_agent')),
  token_hash text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  last_seen timestamptz,
  last_pulled_seq bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ───────────── الكتالوج ─────────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  sort int not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- نسخ قالب الكود: تعديل القالب ينشئ نسخة جديدة والأكواد القديمة تبقى بتفسيرها
create table code_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  version int not null,
  definition jsonb not null,
  is_current boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, version)
);
create unique index one_current_template on code_templates(company_id) where is_current;

create table models (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,                      -- جزء الموديل فقط (0142)
  name text not null,
  category_id uuid references categories(id),
  price_piasters bigint not null check (price_piasters >= 0),
  cost_piasters bigint check (cost_piasters >= 0),
  description text,
  is_active boolean not null default true,
  show_on_web boolean not null default true,
  template_version int not null,
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table model_images (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models(id),
  url_thumb text not null,                 -- 200px
  url_card text not null,                  -- 600px
  url_full text not null,                  -- 1200px
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- القطعة (SKU) = موديل + لون + مقاس. الحقول هي الحقيقة، والكود مفتاح قراءة فقط.
create table variants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  model_id uuid not null references models(id),
  sku text not null,
  color_code text not null,
  color_name text not null,
  size_code text not null,
  size_name text not null,
  extra_barcodes text[] not null default '{}',
  price_override_piasters bigint check (price_override_piasters >= 0),
  template_version int not null,
  is_active boolean not null default true,  -- المسح تعطيل وليس حذفًا
  printed_at timestamptz,                   -- متى طُبع ملصقها (لقاعدة تغيير البنية)
  updated_at timestamptz not null default now(),
  unique (company_id, sku)
);
create index variants_model_idx on variants(model_id);

-- ───────────── العملاء ─────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  phone_e164 text not null,
  address text,
  governorate text,
  notes text,
  tags text[] not null default '{}',
  source text not null default 'branch' check (source in ('branch','web','campaign')),
  source_branch_id uuid references branches(id),
  marketing_consent boolean not null default false,
  merged_into uuid references customers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, phone_e164)
);

-- ───────────── المخزون (Ledger) ─────────────
create type stock_move_kind as enum
  ('receipt','transfer_out','transfer_in','sale','return_in','count_adjust','web_reserve_release','manual_adjust');

create table stock_movements (
  id uuid primary key,                      -- يُولَّد من الجهاز (UUID) فلا يتكرر عند إعادة الإرسال
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  variant_id uuid not null references variants(id),
  qty_delta int not null check (qty_delta <> 0),
  kind stock_move_kind not null,
  doc_type text,
  doc_id uuid,
  note text,
  device_id uuid references devices(id),
  created_at_device timestamptz,
  created_at_server timestamptz not null default now()
);
create index stock_mov_branch_variant on stock_movements(branch_id, variant_id);
create index stock_mov_doc on stock_movements(doc_type, doc_id);

-- الرصيد يُحدَّث بـ trigger من الدفتر (للقراءة السريعة)
create table stock_balances (
  branch_id uuid not null references branches(id),
  variant_id uuid not null references variants(id),
  qty int not null default 0,
  reserved int not null default 0 check (reserved >= 0),
  min_qty int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, variant_id)
);

create table stock_receipts (              -- إدخال بضاعة (بدل المشتريات)
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  branch_id uuid not null references branches(id),   -- المخزن الرئيسي
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create table stock_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references stock_receipts(id),
  variant_id uuid not null references variants(id),
  qty int not null check (qty > 0)
);

create type transfer_status as enum
  ('draft','approved','preparing','in_transit','partially_received','completed','cancelled');

create table transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  from_branch_id uuid not null references branches(id),
  to_branch_id uuid not null references branches(id),
  status transfer_status not null default 'draft',
  note text,
  created_by uuid references users(id),
  approved_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_branch_id <> to_branch_id),
  unique (company_id, number)
);
create table transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id),
  variant_id uuid not null references variants(id),
  qty_sent int not null check (qty_sent > 0),
  qty_received int,                        -- يُسجَّل عند الاستلام (عجز/زيادة)
  unique (transfer_id, variant_id)
);

-- ───────────── المبيعات ─────────────
create table cashier_shifts (
  id uuid primary key,
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  device_id uuid references devices(id),
  cashier_id uuid references users(id),
  opening_cash bigint not null default 0,
  closing_cash bigint,
  expected_cash bigint,
  opened_at timestamptz not null,
  closed_at timestamptz
);

create table invoices (
  id uuid primary key,                      -- UUID من الجهاز
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  device_id uuid references devices(id),
  number text not null,                     -- CAI-A-000123 (بادئة فرع/جهاز)
  kind text not null default 'sale' check (kind in ('sale','return','exchange')),
  ref_invoice_id uuid references invoices(id),
  status text not null default 'posted' check (status in ('posted','voided')),
  customer_id uuid references customers(id),
  cashier_id uuid references users(id),
  shift_id uuid references cashier_shifts(id),
  gross bigint not null,
  discount bigint not null default 0,
  tax bigint not null default 0,
  total bigint not null,
  paid bigint not null default 0,
  change_due bigint not null default 0,
  is_training boolean not null default false,
  reprint_count int not null default 0,
  void_reason text,
  created_at_device timestamptz not null,
  created_at_server timestamptz not null default now(),
  -- حقول الإيصال الإلكتروني (ETA) تُجهَّز من الآن
  eta_uuid text,
  eta_status text check (eta_status in ('pending','sent','accepted','rejected')),
  eta_qr text,
  eta_sent_at timestamptz,
  oversold boolean not null default false,  -- بيع تجاوز الرصيد أثناء الانقطاع
  unique (company_id, number)
);
create index invoices_branch_date on invoices(branch_id, created_at_device);
create index invoices_customer on invoices(customer_id);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  variant_id uuid not null references variants(id),
  sku text not null,
  model_name text not null,
  color_name text not null,
  size_name text not null,
  qty int not null check (qty > 0),
  unit_price bigint not null,
  line_discount bigint not null default 0,
  line_total bigint not null
);
create index invoice_lines_invoice on invoice_lines(invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  method text not null check (method in ('cash','card','transfer','instapay','cod')),
  amount bigint not null,
  reference text
);

-- ملخصات يومية للتقارير بدل مسح كل الفواتير
create table daily_summaries (
  day date not null,
  branch_id uuid not null references branches(id),
  invoices_count int not null default 0,
  returns_count int not null default 0,
  gross bigint not null default 0,
  discount bigint not null default 0,
  total bigint not null default 0,
  primary key (day, branch_id)
);

-- ───────────── الطلبات الإلكترونية ─────────────
create type order_status as enum ('pending','confirmed','preparing','shipped','delivered','cancelled','returned');

create table orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  client_token text not null,               -- يمنع تكرار الطلب عند الضغط مرتين
  customer_id uuid not null references customers(id),
  status order_status not null default 'pending',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  payment_method text,
  ship_address text,
  ship_governorate text,
  total bigint not null,
  fulfil_branch_id uuid references branches(id),
  utm_source text, utm_medium text, utm_campaign text, utm_content text, fbclid text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, client_token)
);
create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  variant_id uuid not null references variants(id),
  qty int not null check (qty > 0),
  unit_price bigint not null
);

-- ───────────── المالية ─────────────
create table cashboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  name text not null
);
create table cash_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  cashbox_id uuid not null references cashboxes(id),
  kind text not null check (kind in ('expense','income','payment','adjustment')),
  amount bigint not null,
  category text,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────────── الحضور ─────────────
create table shift_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 0 and 1439),
  grace_late_min int not null default 10,
  grace_early_leave_min int not null default 10,
  grace_late_leave_min int not null default 10,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  user_id uuid not null references users(id),
  branch_id uuid not null references branches(id),
  template_id uuid not null references shift_templates(id),
  weekday int not null check (weekday between 0 and 6),   -- 0 = الأحد
  updated_at timestamptz not null default now(),
  unique (user_id, weekday)
);
-- سجلات الحضور Append-only: لا تعديل ولا حذف، التصحيح بسجل جديد مع سبب
create table attendance_events (
  id uuid primary key,
  company_id uuid not null references companies(id),
  user_id uuid not null references users(id),
  branch_id uuid not null references branches(id),
  device_id uuid references devices(id),
  kind text not null check (kind in ('in','out')),
  color text not null check (color in ('green','blue','red')),
  points numeric(6,2) not null,
  device_time timestamptz not null,
  server_time timestamptz not null default now(),
  clock_source text not null default 'server' check (clock_source in ('server','device')),
  corrects_event_id uuid references attendance_events(id),
  correction_reason text,
  corrected_by uuid references users(id)
);
create index attendance_user_time on attendance_events(user_id, device_time);

-- ───────────── الإعدادات والتصاريح والتدقيق ─────────────
create table settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  key text not null,
  value jsonb not null,
  level text check (level in ('free','grant','super')),   -- null = الافتراضي من الكود
  version int not null default 1,
  effective_from timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);
create table settings_history (
  id bigserial primary key,
  company_id uuid not null,
  key text not null,
  version int not null,
  value jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table permission_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  feature text not null,
  scope jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','used','expired','rejected')),
  uses_left int not null default 1,
  expires_at timestamptz,
  requested_by uuid not null references users(id),
  decided_by uuid references users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  company_id uuid not null,
  actor_id uuid,
  device_id uuid,
  action text not null,
  entity text,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);
create index audit_entity on audit_log(entity, entity_id);

-- ───────────── المزامنة ─────────────
create table processed_ops (               -- منع التكرار: كل عملية UUID تُعالَج مرة واحدة
  op_id uuid primary key,
  device_id uuid not null,
  type text not null,
  status text not null check (status in ('ok','error')),
  error text,
  received_at timestamptz not null default now()
);

create table change_log (
  seq bigserial primary key,
  company_id uuid not null,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('upsert','delete')),
  data jsonb,
  branch_scope uuid,                        -- null = لكل الأجهزة
  at timestamptz not null default now()
);
create index change_log_company_seq on change_log(company_id, seq);

commit;
