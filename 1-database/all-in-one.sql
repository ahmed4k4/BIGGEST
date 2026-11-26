-- ===== 001_core.sql =====
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


-- ===== 002_triggers.sql =====
-- 002_triggers.sql  |  رصيد المخزون من الدفتر + تسجيل التغييرات للمزامنة + حماية السجلات

begin;

-- ① تحديث الرصيد من دفتر الحركات
create or replace function trg_apply_stock_movement() returns trigger language plpgsql as $$
begin
  insert into stock_balances (branch_id, variant_id, qty)
  values (new.branch_id, new.variant_id, new.qty_delta)
  on conflict (branch_id, variant_id)
  do update set qty = stock_balances.qty + excluded.qty, updated_at = now();
  return new;
end $$;

create trigger stock_movements_apply
  after insert on stock_movements
  for each row execute function trg_apply_stock_movement();

-- الدفتر لا يُعدَّل ولا يُحذف
create or replace function trg_forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'الجدول % للإضافة فقط (Append-only). التصحيح بسجل جديد.', tg_table_name using errcode = 'P0001';
end $$;

create trigger stock_movements_immutable before update or delete on stock_movements
  for each row execute function trg_forbid_mutation();
create trigger attendance_events_immutable before update or delete on attendance_events
  for each row execute function trg_forbid_mutation();
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function trg_forbid_mutation();
create trigger invoice_lines_immutable before update or delete on invoice_lines
  for each row execute function trg_forbid_mutation();
create trigger payments_immutable before update or delete on payments
  for each row execute function trg_forbid_mutation();

-- الفواتير لا تُحذف. يُسمح فقط بتغيير الحالة إلى voided وحقول الإيصال الإلكتروني وعدد الطباعة
create or replace function trg_invoice_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'الفواتير لا تُحذف، تُلغى بتسوية مع تسجيل السبب' using errcode = 'P0001';
  end if;
  if (new.gross, new.discount, new.tax, new.total, new.paid, new.number, new.branch_id, new.customer_id)
     is distinct from
     (old.gross, old.discount, old.tax, old.total, old.paid, old.number, old.branch_id, old.customer_id) then
    raise exception 'لا يمكن تعديل مبالغ فاتورة مرحّلة' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on invoices
  for each row execute function trg_invoice_guard();

-- ② تسجيل التغييرات (Change Log) لجداول البيانات الأساسية التي تنزل للأجهزة
create or replace function trg_log_change() returns trigger language plpgsql as $$
declare
  r jsonb;
  scope uuid := null;
  rid text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  -- التكلفة سرّية: لا تصل لأجهزة الفروع أبدًا
  if tg_table_name = 'models' then r := r - 'cost_piasters'; end if;
  rid := coalesce(r->>'id', r->>'branch_id' || ':' || coalesce(r->>'variant_id', ''));

  -- جداول مقصورة على فرع بعينه
  if tg_table_name = 'stock_movements' then scope := (r->>'branch_id')::uuid; end if;

  -- التحويل يُسجَّل مرتين: واحدة لكل طرف (المرسِل والمستلِم) فلا يراه إلا الفرعان المعنيان
  if tg_table_name = 'transfers' then
    insert into change_log (company_id, table_name, row_id, op, data, branch_scope)
    select (r->>'company_id')::uuid, 'transfers', rid, 'upsert', r, b
    from unnest(array[(r->>'from_branch_id')::uuid, (r->>'to_branch_id')::uuid]) as b;
    return coalesce(new, old);
  end if;

  -- لا ننزّل كلمات السر الكاملة: للمستخدمين نص مبسّط (للدخول Offline) عبر الجدول branch_users
  if tg_table_name = 'users' then
    insert into change_log (company_id, table_name, row_id, op, data, branch_scope)
    values ((r->>'company_id')::uuid, 'branch_users', r->>'id',
            case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
            jsonb_build_object('id', r->>'id', 'username', r->>'username', 'display_name', r->>'display_name',
                               'role', r->>'role', 'branch_id', r->>'branch_id', 'is_active', r->'is_active',
                               'verifier', r->>'password_hash', 'pin_verifier', r->>'pin_hash'),
            (r->>'branch_id')::uuid);
    return coalesce(new, old);
  end if;

  insert into change_log (company_id, table_name, row_id, op, data, branch_scope)
  values ((r->>'company_id')::uuid, tg_table_name, rid,
          case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
          case when tg_op = 'DELETE' then null else r end, scope);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['branches','categories','models','variants','model_images','code_templates',
                           'customers','settings','shift_templates','schedules','transfers','stock_movements']
  loop
    execute format('create trigger %I_changelog after insert or update or delete on %I
                    for each row execute function trg_log_change()', t, t);
  end loop;
end $$;
create trigger users_changelog after insert or update on users
  for each row execute function trg_log_change();

-- model_images ليس فيه company_id: نعالجه بدالة منفصلة
drop trigger model_images_changelog on model_images;
create or replace function trg_log_model_image() returns trigger language plpgsql as $$
declare r jsonb; cid uuid;
begin
  r := to_jsonb(coalesce(new, old));
  select company_id into cid from models where id = (r->>'model_id')::uuid;
  insert into change_log (company_id, table_name, row_id, op, data)
  values (cid, 'model_images', r->>'id', case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
          case when tg_op = 'DELETE' then null else r end);
  return coalesce(new, old);
end $$;
create trigger model_images_changelog after insert or update or delete on model_images
  for each row execute function trg_log_model_image();

-- بنود التحويل (ليس فيها company_id ولا branch): نأخذها من التحويل الأب
create or replace function trg_log_transfer_line() returns trigger language plpgsql as $$
declare r jsonb; t transfers%rowtype;
begin
  r := to_jsonb(coalesce(new, old));
  select * into t from transfers where id = (r->>'transfer_id')::uuid;
  insert into change_log (company_id, table_name, row_id, op, data, branch_scope)
  select t.company_id, 'transfer_lines', r->>'id', case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
         case when tg_op = 'DELETE' then null else r end, b
  from unnest(array[t.from_branch_id, t.to_branch_id]) as b;
  return coalesce(new, old);
end $$;
create trigger transfer_lines_changelog after insert or update or delete on transfer_lines
  for each row execute function trg_log_transfer_line();

-- ③ updated_at تلقائيًا
create or replace function trg_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['branches','categories','models','variants','customers','users','settings','transfers','code_templates']
  loop
    execute format('create trigger %I_touch before update on %I for each row execute function trg_touch()', t, t);
  end loop;
end $$;

commit;


-- ===== 003_functions.sql =====
-- 003_functions.sql  |  العمليات الثقيلة كدوال SQL واحدة (Transaction)، بدل عدة مكالمات من الـ Worker.
-- كل دالة تأخذ p_company صراحة: لا شيء يعتمد على جلسة المستخدم لأن الوصول بمفتاح الخدمة من الـ Backend فقط.

begin;

alter table order_lines add column fulfil_branch_id uuid references branches(id);

create table doc_counters (
  company_id uuid not null,
  doc_type text not null,
  last_no bigint not null default 0,
  primary key (company_id, doc_type)
);

create or replace function next_doc_number(p_company uuid, p_type text, p_prefix text) returns text
language plpgsql as $$
declare n bigint;
begin
  insert into doc_counters (company_id, doc_type, last_no) values (p_company, p_type, 1)
  on conflict (company_id, doc_type) do update set last_no = doc_counters.last_no + 1
  returning last_no into n;
  return p_prefix || '-' || lpad(n::text, 6, '0');
end $$;

-- معرّف العميل حتمي من (الشركة + الرقم): كل الأجهزة تولّد نفس الـ UUID لنفس العميل، فلا يتكرر ولا يحتاج دمجًا
create or replace function customer_id_for(p_company uuid, p_phone text) returns uuid
language sql immutable as $$
  select substr(encode(digest(p_company::text || ':' || p_phone, 'sha256'), 'hex'), 1, 32)::uuid
$$;

create or replace function get_setting(p_company uuid, p_key text, p_default jsonb default null) returns jsonb
language sql stable as $$
  select coalesce((select value from settings where company_id = p_company and key = p_key), p_default)
$$;

-- ───────────── تطبيق عمليات الفروع (Outbox) ─────────────
create or replace function apply_customer(p_company uuid, p_branch uuid, p jsonb) returns uuid
language plpgsql as $$
declare v_id uuid := customer_id_for(p_company, p->>'phone');
begin
  insert into customers (id, company_id, name, phone_e164, address, governorate, notes, tags, source, source_branch_id,
                         marketing_consent, created_at, updated_at)
  values (v_id, p_company, p->>'name', p->>'phone', p->>'address', p->>'governorate', p->>'notes',
          coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}'),
          coalesce(p->>'source', 'branch'), p_branch, coalesce((p->>'marketingConsent')::boolean, false),
          coalesce((p->>'createdAt')::timestamptz, now()), coalesce((p->>'updatedAt')::timestamptz, now()))
  on conflict (id) do update set
    -- لو اختلف الاسم يُحتفظ بالأحدث، والقديم يُسجَّل في ملاحظة التدقيق
    name = case when excluded.updated_at > customers.updated_at then excluded.name else customers.name end,
    address = coalesce(excluded.address, customers.address),
    governorate = coalesce(excluded.governorate, customers.governorate),
    tags = (select array(select distinct unnest(customers.tags || excluded.tags))),
    marketing_consent = customers.marketing_consent or excluded.marketing_consent;
  if exists (select 1 from customers where id = v_id and name <> p->>'name') then
    insert into audit_log (company_id, action, entity, entity_id, after)
    values (p_company, 'customer.name_conflict', 'customers', v_id::text, jsonb_build_object('incoming_name', p->>'name'));
  end if;
  return v_id;
end $$;

create or replace function apply_sale(p_company uuid, p_device uuid, p_branch uuid, p jsonb) returns void
language plpgsql as $$
declare
  inv jsonb := p->'invoice';
  l jsonb; pay jsonb;
  v_kind text := coalesce(inv->>'kind', 'sale');
  v_sign int := case when v_kind = 'return' then 1 else -1 end;
  v_oversold boolean := false;
  v_bal int;
  v_day date;
begin
  if coalesce((inv->>'isTraining')::boolean, false) then return; end if;   -- فواتير التدريب لا تُسجَّل

  -- الوردية لا تصل للسيرفر إلا عند إغلاقها، فننشئ حاجزًا لتصحّ العلاقة (يُستكمل عند shift.close)
  if nullif(inv->>'shiftId', '') is not null then
    insert into cashier_shifts (id, company_id, branch_id, device_id, cashier_id, opening_cash, opened_at)
    values ((inv->>'shiftId')::uuid, p_company, p_branch, p_device, nullif(inv->>'cashierId', '')::uuid, 0, (inv->>'createdAtDevice')::timestamptz)
    on conflict (id) do nothing;
  end if;

  insert into invoices (id, company_id, branch_id, device_id, number, kind, ref_invoice_id, customer_id, cashier_id, shift_id,
                        gross, discount, tax, total, paid, change_due, created_at_device)
  values ((inv->>'id')::uuid, p_company, p_branch, p_device, inv->>'number', v_kind,
          nullif(inv->>'refInvoiceId', '')::uuid, nullif(inv->>'customerId', '')::uuid, nullif(inv->>'cashierId', '')::uuid,
          nullif(inv->>'shiftId', '')::uuid,
          (inv->>'gross')::bigint, (inv->>'discount')::bigint, (inv->>'tax')::bigint, (inv->>'total')::bigint,
          (inv->>'paid')::bigint, coalesce((inv->>'changeDue')::bigint, 0), (inv->>'createdAtDevice')::timestamptz);

  for l in select * from jsonb_array_elements(p->'lines') loop
    insert into invoice_lines (invoice_id, variant_id, sku, model_name, color_name, size_name, qty, unit_price, line_discount, line_total)
    values ((inv->>'id')::uuid, (l->>'variantId')::uuid, l->>'sku', l->>'modelName', l->>'colorName', l->>'sizeName',
            (l->>'qty')::int, (l->>'unitPrice')::bigint, coalesce((l->>'lineDiscount')::bigint, 0), (l->>'lineTotal')::bigint);

    insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id, device_id, created_at_device)
    values ((l->>'movementId')::uuid, p_company, p_branch, (l->>'variantId')::uuid, v_sign * (l->>'qty')::int,
            case when v_kind = 'return' then 'return_in'::stock_move_kind else 'sale'::stock_move_kind end,
            'invoice', (inv->>'id')::uuid, p_device, (inv->>'createdAtDevice')::timestamptz);

    select qty into v_bal from stock_balances where branch_id = p_branch and variant_id = (l->>'variantId')::uuid;
    if coalesce(v_bal, 0) < 0 then v_oversold := true; end if;
  end loop;

  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    insert into payments (invoice_id, method, amount, reference)
    values ((inv->>'id')::uuid, pay->>'method', (pay->>'amount')::bigint, pay->>'reference');
  end loop;

  if v_oversold then update invoices set oversold = true where id = (inv->>'id')::uuid; end if;

  v_day := ((inv->>'createdAtDevice')::timestamptz at time zone 'Africa/Cairo')::date;
  insert into daily_summaries (day, branch_id, invoices_count, returns_count, gross, discount, total)
  values (v_day, p_branch, case when v_kind = 'sale' then 1 else 0 end, case when v_kind = 'return' then 1 else 0 end,
          v_sign * -1 * (inv->>'gross')::bigint, v_sign * -1 * (inv->>'discount')::bigint, v_sign * -1 * (inv->>'total')::bigint)
  on conflict (day, branch_id) do update set
    invoices_count = daily_summaries.invoices_count + excluded.invoices_count,
    returns_count = daily_summaries.returns_count + excluded.returns_count,
    gross = daily_summaries.gross + excluded.gross,
    discount = daily_summaries.discount + excluded.discount,
    total = daily_summaries.total + excluded.total;
end $$;

create or replace function apply_attendance(p_company uuid, p_device uuid, p_branch uuid, p jsonb) returns void
language plpgsql as $$
begin
  insert into attendance_events (id, company_id, user_id, branch_id, device_id, kind, color, points, device_time, clock_source)
  values ((p->>'id')::uuid, p_company, (p->>'userId')::uuid, p_branch, p_device, p->>'kind', p->>'color',
          (p->>'points')::numeric, (p->>'deviceTime')::timestamptz, coalesce(p->>'clockSource', 'device'));
end $$;

create or replace function apply_count(p_company uuid, p_device uuid, p_branch uuid, p jsonb) returns void
language plpgsql as $$
declare l jsonb;
begin
  for l in select * from jsonb_array_elements(p->'lines') loop
    if (l->>'delta')::int <> 0 then
      insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id, device_id, note)
      values ((l->>'movementId')::uuid, p_company, p_branch, (l->>'variantId')::uuid, (l->>'delta')::int,
              'count_adjust', 'count', nullif(p->>'countId', '')::uuid, p_device, p->>'note');
    end if;
  end loop;
end $$;

create or replace function receive_transfer(p_company uuid, p_transfer uuid, p_lines jsonb, p_actor uuid) returns void
language plpgsql as $$
declare
  t transfers%rowtype;
  l jsonb;
  v_short boolean := false;
begin
  select * into t from transfers where id = p_transfer and company_id = p_company for update;
  if not found then raise exception 'التحويل غير موجود'; end if;
  if t.status not in ('in_transit', 'partially_received') then raise exception 'حالة التحويل لا تسمح بالاستلام: %', t.status; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    update transfer_lines set qty_received = coalesce(qty_received, 0) + (l->>'qtyReceived')::int
    where transfer_id = p_transfer and variant_id = (l->>'variantId')::uuid;
    if not found then raise exception 'صنف غير موجود في التحويل'; end if;
    if (l->>'qtyReceived')::int > 0 then
      insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id)
      values (coalesce(nullif(l->>'movementId', '')::uuid, gen_random_uuid()), p_company, t.to_branch_id,
              (l->>'variantId')::uuid, (l->>'qtyReceived')::int, 'transfer_in', 'transfer', p_transfer);
    end if;
  end loop;

  select exists (select 1 from transfer_lines where transfer_id = p_transfer and coalesce(qty_received, 0) < qty_sent) into v_short;
  update transfers set status = case when v_short then 'partially_received'::transfer_status else 'completed'::transfer_status end
  where id = p_transfer;
  insert into audit_log (company_id, actor_id, action, entity, entity_id, after)
  values (p_company, p_actor, 'transfer.receive', 'transfers', p_transfer::text, jsonb_build_object('short', v_short));
end $$;

create or replace function apply_transfer_receive(p_company uuid, p_branch uuid, p jsonb) returns void
language plpgsql as $$
begin
  if not exists (select 1 from transfers where id = (p->>'transferId')::uuid and to_branch_id = p_branch) then
    raise exception 'هذا التحويل ليس موجّهًا لهذا الفرع';
  end if;
  perform receive_transfer(p_company, (p->>'transferId')::uuid, p->'lines', null);
end $$;

create or replace function apply_ops(p_company uuid, p_device uuid, p_ops jsonb) returns jsonb
language plpgsql as $$
declare
  op jsonb; v_id uuid; v_type text; v_res jsonb := '[]'::jsonb; v_rows int; v_err text; v_branch uuid;
begin
  select branch_id into v_branch from devices where id = p_device and company_id = p_company and status = 'active';
  if not found then raise exception 'الجهاز غير مفعّل'; end if;

  for op in select * from jsonb_array_elements(p_ops) loop
    v_id := (op->>'opId')::uuid;
    v_type := op->>'type';
    begin
      insert into processed_ops (op_id, device_id, type, status) values (v_id, p_device, v_type, 'ok')
      on conflict (op_id) do update set status = 'ok', error = null, device_id = excluded.device_id
        where processed_ops.status = 'error';
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_res := v_res || jsonb_build_object('opId', v_id, 'status', 'duplicate');
        continue;
      end if;

      case v_type
        when 'sale.create' then perform apply_sale(p_company, p_device, v_branch, op->'payload');
        when 'customer.upsert' then perform apply_customer(p_company, v_branch, op->'payload');
        when 'attendance.record' then perform apply_attendance(p_company, p_device, v_branch, op->'payload');
        when 'stock.count' then perform apply_count(p_company, p_device, v_branch, op->'payload');
        when 'transfer.receive' then perform apply_transfer_receive(p_company, v_branch, op->'payload');
        when 'shift.close' then
          -- upsert: قد يكون الصف أُنشئ مسبقًا كحاجز عند وصول أول فاتورة من الوردية
          insert into cashier_shifts (id, company_id, branch_id, device_id, cashier_id, opening_cash, closing_cash, expected_cash, opened_at, closed_at)
          values ((op->'payload'->>'id')::uuid, p_company, v_branch, p_device, (op->'payload'->>'cashierId')::uuid,
                  (op->'payload'->>'openingCash')::bigint, (op->'payload'->>'closingCash')::bigint,
                  (op->'payload'->>'expectedCash')::bigint, (op->'payload'->>'openedAt')::timestamptz, (op->'payload'->>'closedAt')::timestamptz)
          on conflict (id) do update set opening_cash = excluded.opening_cash, closing_cash = excluded.closing_cash,
            expected_cash = excluded.expected_cash, opened_at = excluded.opened_at, closed_at = excluded.closed_at, cashier_id = excluded.cashier_id
            where cashier_shifts.branch_id = v_branch;
        else raise exception 'نوع عملية غير معروف: %', v_type;
      end case;

      v_res := v_res || jsonb_build_object('opId', v_id, 'status', 'ok');
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into processed_ops (op_id, device_id, type, status, error) values (v_id, p_device, v_type, 'error', v_err)
      on conflict (op_id) do update set status = 'error', error = excluded.error;
      v_res := v_res || jsonb_build_object('opId', v_id, 'status', 'error', 'error', v_err);
    end;
  end loop;

  update devices set last_seen = now() where id = p_device;
  return v_res;
end $$;

-- ───────────── إدخال البضاعة والتحويلات (من لوحة الإدارة) ─────────────
create or replace function create_receipt(p_company uuid, p_actor uuid, p_branch uuid, p_note text, p_lines jsonb) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb;
begin
  if not exists (select 1 from branches where id = p_branch and company_id = p_company and kind = 'main_warehouse') then
    raise exception 'إدخال البضاعة يتم في المخزن الرئيسي فقط';
  end if;
  insert into stock_receipts (id, company_id, number, branch_id, note, created_by)
  values (v_id, p_company, next_doc_number(p_company, 'receipt', 'RC'), p_branch, p_note, p_actor);
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into stock_receipt_lines (receipt_id, variant_id, qty) values (v_id, (l->>'variantId')::uuid, (l->>'qty')::int);
    insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id)
    values (gen_random_uuid(), p_company, p_branch, (l->>'variantId')::uuid, (l->>'qty')::int, 'receipt', 'receipt', v_id);
  end loop;
  insert into audit_log (company_id, actor_id, action, entity, entity_id) values (p_company, p_actor, 'receipt.create', 'stock_receipts', v_id::text);
  return v_id;
end $$;

create or replace function create_transfer(p_company uuid, p_actor uuid, p_from uuid, p_to uuid, p_note text, p_lines jsonb) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb;
begin
  insert into transfers (id, company_id, number, from_branch_id, to_branch_id, note, created_by)
  values (v_id, p_company, next_doc_number(p_company, 'transfer', 'TR'), p_from, p_to, p_note, p_actor);
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into transfer_lines (transfer_id, variant_id, qty_sent) values (v_id, (l->>'variantId')::uuid, (l->>'qty')::int);
  end loop;
  return v_id;
end $$;

create or replace function transition_transfer(p_company uuid, p_transfer uuid, p_to text, p_actor uuid) returns void
language plpgsql as $$
declare t transfers%rowtype; l record; v_bal int;
begin
  select * into t from transfers where id = p_transfer and company_id = p_company for update;
  if not found then raise exception 'التحويل غير موجود'; end if;
  if not ((t.status = 'draft' and p_to in ('approved', 'cancelled'))
       or (t.status = 'approved' and p_to in ('preparing', 'in_transit', 'cancelled'))
       or (t.status = 'preparing' and p_to in ('in_transit', 'cancelled'))) then
    raise exception 'انتقال غير مسموح: % ← %', t.status, p_to;
  end if;

  if p_to = 'in_transit' then   -- الخروج من المخزن: يخصم الكمية ويأخذ رقم مستند
    for l in select * from transfer_lines where transfer_id = p_transfer loop
      select coalesce(qty, 0) into v_bal from stock_balances where branch_id = t.from_branch_id and variant_id = l.variant_id;
      if coalesce(v_bal, 0) < l.qty_sent then raise exception 'الرصيد لا يكفي للصنف % (المتاح %)', l.variant_id, coalesce(v_bal, 0); end if;
      insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id)
      values (gen_random_uuid(), p_company, t.from_branch_id, l.variant_id, -l.qty_sent, 'transfer_out', 'transfer', p_transfer);
    end loop;
  end if;

  update transfers set status = p_to::transfer_status, approved_by = case when p_to = 'approved' then p_actor else approved_by end
  where id = p_transfer;
  insert into audit_log (company_id, actor_id, action, entity, entity_id, after)
  values (p_company, p_actor, 'transfer.' || p_to, 'transfers', p_transfer::text, jsonb_build_object('from', t.status));
end $$;

-- ───────────── الطلبات الإلكترونية: حجز ذري ─────────────
-- المواقع المسموح بها حسب وضع المخزون (يطابق computeAvailability في الحزمة المشتركة)
create or replace function site_locations(p_company uuid) returns table (branch_id uuid)
language plpgsql stable as $$
declare v_mode int := coalesce((get_setting(p_company, 'site_stock.mode', '1'::jsonb))::text::int, 1);
begin
  if v_mode = 1 then
    return query select b.id from branches b where b.company_id = p_company and b.kind = 'main_warehouse' and b.is_active;
  elsif v_mode = 2 then
    return query select b.id from branches b where b.company_id = p_company and b.is_active and
      (b.kind = 'main_warehouse' or b.id::text in (select jsonb_array_elements_text(get_setting(p_company, 'site_stock.branches', '[]'::jsonb))));
  elsif v_mode = 3 then
    return query select b.id from branches b where b.company_id = p_company and b.is_active;
  else
    return query select b.id from branches b where b.company_id = p_company and b.kind = 'web_stock' and b.is_active;
  end if;
end $$;

create or replace function create_online_order(p_company uuid, p jsonb) returns jsonb
language plpgsql as $$
declare
  v_cust uuid; v_order uuid; v_existing orders%rowtype; l jsonb;
  v_phone text := p->'customer'->>'phone';
  v_price bigint; v_total bigint := 0; v_margin int := coalesce((get_setting(p_company, 'site_stock.safety_margin', '1'::jsonb))::text::int, 0);
  v_loc uuid; v_qty int; v_vid uuid; v_num text;
begin
  select * into v_existing from orders where company_id = p_company and client_token = p->>'clientToken';
  if found then return jsonb_build_object('orderId', v_existing.id, 'number', v_existing.number, 'duplicate', true); end if;

  v_cust := customer_id_for(p_company, v_phone);
  insert into customers (id, company_id, name, phone_e164, address, governorate, source, marketing_consent)
  values (v_cust, p_company, p->'customer'->>'name', v_phone, p->'customer'->>'address', p->'customer'->>'governorate', 'web',
          coalesce((p->'customer'->>'marketingConsent')::boolean, false))
  on conflict (id) do update set name = excluded.name, address = coalesce(excluded.address, customers.address),
                                 governorate = coalesce(excluded.governorate, customers.governorate);

  v_order := gen_random_uuid();
  v_num := next_doc_number(p_company, 'order', 'WEB');
  insert into orders (id, company_id, number, client_token, customer_id, payment_method, ship_address, ship_governorate, total,
                      utm_source, utm_medium, utm_campaign, utm_content, fbclid, note)
  values (v_order, p_company, v_num, p->>'clientToken', v_cust, p->>'paymentMethod', p->'customer'->>'address',
          p->'customer'->>'governorate', 0, p->'utm'->>'source', p->'utm'->>'medium', p->'utm'->>'campaign',
          p->'utm'->>'content', p->'utm'->>'fbclid', p->>'note');

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_vid := (l->>'variantId')::uuid;
    v_qty := (l->>'qty')::int;
    if v_qty <= 0 or v_qty > 20 then raise exception 'كمية غير صالحة'; end if;

    select coalesce(v.price_override_piasters, m.price_piasters) into v_price
    from variants v join models m on m.id = v.model_id
    where v.id = v_vid and v.company_id = p_company and v.is_active and m.is_active and m.show_on_web;
    if not found then raise exception 'الصنف غير متاح: %', v_vid using errcode = 'P0002'; end if;

    -- حجز ذري من أفضل موقع مسموح: الشرط داخل الـ UPDATE نفسه فلا يتجاوز الرصيد حتى مع طلبين متزامنين
    v_loc := null;
    update stock_balances sb set reserved = sb.reserved + v_qty, updated_at = now()
    where (sb.branch_id, sb.variant_id) = (
      select s.branch_id, s.variant_id from stock_balances s
      where s.variant_id = v_vid and s.branch_id in (select branch_id from site_locations(p_company))
        and s.qty - s.reserved - v_margin >= v_qty
      order by s.qty - s.reserved desc limit 1 for update)
      -- شرط ثانٍ في الـ UPDATE نفسه: حتى لو تغيّر الرصيد أثناء الانتظار لا يمكن تجاوزه أبدًا
      and sb.qty - sb.reserved - v_margin >= v_qty
    returning sb.branch_id into v_loc;
    if v_loc is null then raise exception 'نفدت الكمية للصنف %', v_vid using errcode = 'P0002'; end if;

    insert into order_lines (order_id, variant_id, qty, unit_price, fulfil_branch_id) values (v_order, v_vid, v_qty, v_price, v_loc);
    v_total := v_total + v_price * v_qty;
  end loop;

  update orders set total = v_total, fulfil_branch_id = (select fulfil_branch_id from order_lines where order_id = v_order limit 1)
  where id = v_order;
  return jsonb_build_object('orderId', v_order, 'number', v_num, 'total', v_total, 'duplicate', false);
end $$;

create or replace function set_order_status(p_company uuid, p_order uuid, p_to text, p_actor uuid, p_payment_status text default null) returns void
language plpgsql as $$
declare o orders%rowtype; l record;
begin
  select * into o from orders where id = p_order and company_id = p_company for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not ((o.status = 'pending' and p_to in ('confirmed', 'cancelled'))
       or (o.status = 'confirmed' and p_to in ('preparing', 'cancelled'))
       or (o.status = 'preparing' and p_to in ('shipped', 'cancelled'))
       or (o.status = 'shipped' and p_to in ('delivered', 'returned'))
       or (o.status = 'delivered' and p_to = 'returned')) then
    raise exception 'انتقال غير مسموح: % ← %', o.status, p_to;
  end if;

  if p_to = 'cancelled' then      -- يُفرج عن الحجز
    for l in select * from order_lines where order_id = p_order loop
      update stock_balances set reserved = greatest(0, reserved - l.qty) where branch_id = l.fulfil_branch_id and variant_id = l.variant_id;
    end loop;
  elsif p_to = 'shipped' then     -- يتحول الحجز إلى خروج فعلي من المخزون
    for l in select * from order_lines where order_id = p_order loop
      update stock_balances set reserved = greatest(0, reserved - l.qty) where branch_id = l.fulfil_branch_id and variant_id = l.variant_id;
      insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id)
      values (gen_random_uuid(), p_company, l.fulfil_branch_id, l.variant_id, -l.qty, 'sale', 'order', p_order);
    end loop;
  elsif p_to = 'returned' then
    for l in select * from order_lines where order_id = p_order loop
      insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, doc_id)
      values (gen_random_uuid(), p_company, l.fulfil_branch_id, l.variant_id, l.qty, 'return_in', 'order', p_order);
    end loop;
  end if;

  update orders set status = p_to::order_status, payment_status = coalesce(p_payment_status, payment_status), updated_at = now()
  where id = p_order;
  insert into audit_log (company_id, actor_id, action, entity, entity_id, after)
  values (p_company, p_actor, 'order.' || p_to, 'orders', p_order::text, jsonb_build_object('from', o.status));
end $$;

-- يُستدعى دوريًا (Cron Trigger): إلغاء الطلبات المعلّقة بعد مهلة وإفراج حجزها
create or replace function release_stale_orders(p_company uuid, p_minutes int) returns int
language plpgsql as $$
declare o record; n int := 0;
begin
  for o in select id from orders where company_id = p_company and status = 'pending'
           and created_at < now() - make_interval(mins => p_minutes) loop
    perform set_order_status(p_company, o.id, 'cancelled', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── التصاريح ─────────────
create or replace function consume_grant(p_company uuid, p_feature text, p_user uuid) returns uuid
language plpgsql as $$
declare g permission_grants%rowtype;
begin
  select * into g from permission_grants
  where company_id = p_company and feature = p_feature and requested_by = p_user and status = 'approved'
    and uses_left > 0 and (expires_at is null or expires_at > now())
  order by created_at limit 1 for update;
  if not found then return null; end if;
  update permission_grants set uses_left = uses_left - 1,
    status = case when uses_left - 1 <= 0 then 'used' else status end where id = g.id;
  insert into audit_log (company_id, actor_id, action, entity, entity_id, reason)
  values (p_company, p_user, 'grant.consume', 'permission_grants', g.id::text, p_feature);
  return g.id;
end $$;

create or replace function expire_grants(p_company uuid) returns int
language plpgsql as $$
declare n int;
begin
  update permission_grants set status = 'expired'
  where company_id = p_company and status in ('approved', 'pending') and expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────── لقطات الموقع (تُنشر ملفات ثابتة على R2/Pages) ─────────────
create or replace function catalog_snapshot(p_company uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort) from categories c
                            where c.company_id = p_company and c.is_active), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'code', m.code, 'name', m.name, 'categoryId', m.category_id, 'price', m.price_piasters,
        'description', m.description,
        'images', coalesce((select jsonb_agg(jsonb_build_object('thumb', i.url_thumb, 'card', i.url_card, 'full', i.url_full) order by i.sort)
                            from model_images i where i.model_id = m.id), '[]'::jsonb),
        'variants', coalesce((select jsonb_agg(jsonb_build_object(
            'id', v.id, 'sku', v.sku, 'color', v.color_name, 'colorCode', v.color_code, 'size', v.size_name, 'sizeCode', v.size_code,
            'price', coalesce(v.price_override_piasters, m.price_piasters)) order by v.color_code, v.size_code)
                              from variants v where v.model_id = m.id and v.is_active), '[]'::jsonb)))
      from models m where m.company_id = p_company and m.is_active and m.show_on_web), '[]'::jsonb)
  )
$$;

create or replace function availability_snapshot(p_company uuid) returns jsonb
language sql stable as $$
  with loc as (select branch_id from site_locations(p_company)),
  agg as (
    select sb.variant_id, sum(sb.qty) as qty, sum(sb.reserved) as reserved
    from stock_balances sb where sb.branch_id in (select branch_id from loc) group by sb.variant_id)
  select coalesce(jsonb_object_agg(a.variant_id,
      jsonb_build_object('a', greatest(0, a.qty - a.reserved - coalesce((get_setting(p_company, 'site_stock.safety_margin', '1'::jsonb))::text::int, 0)))), '{}'::jsonb)
  from agg a
$$;

commit;


-- ===== 005_api.sql =====
-- 005_api.sql  |  دوال يستدعيها الـ API (كلها select-form حتى يعمل نفس الكود على أي driver)

begin;

alter table variants add column attrs jsonb not null default '{}';   -- قيم أجزاء الكود الإضافية (الموسم…)

-- CRUD عام: أسماء الجداول والأعمدة تأتي من قائمة بيضاء في الـ API، والقيم تمر كـ JSON (لا تُدمج في النص)
create or replace function api_insert(p_table text, p_row jsonb) returns jsonb
language plpgsql as $$
declare cols text; r jsonb;
begin
  select string_agg(format('%I', k), ',') into cols from jsonb_object_keys(p_row) k;
  execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) returning to_jsonb(%I)',
                 p_table, cols, cols, p_table, p_table) into r using p_row;
  return r;
end $$;

create or replace function api_update(p_table text, p_id uuid, p_company uuid, p_patch jsonb) returns jsonb
language plpgsql as $$
declare cols text; r jsonb;
begin
  select string_agg(format('%I', k), ',') into cols from jsonb_object_keys(p_patch) k;
  if cols is null then raise exception 'لا توجد حقول للتحديث'; end if;
  execute format('update %I t set (%s) = (select %s from jsonb_populate_record(null::%I, $1)) where t.id = $2 and t.company_id = $3 returning to_jsonb(t)',
                 p_table, cols, cols, p_table) into r using p_patch, p_id, p_company;
  return r;
end $$;

create or replace function set_setting(p_company uuid, p_key text, p_value jsonb, p_actor uuid, p_level text default null) returns jsonb
language plpgsql as $$
declare s settings%rowtype;
begin
  insert into settings (company_id, key, value, level, updated_by) values (p_company, p_key, p_value, p_level, p_actor)
  on conflict (company_id, key) do update set value = excluded.value, version = settings.version + 1,
    level = coalesce(excluded.level, settings.level), updated_by = excluded.updated_by, effective_from = now()
  returning * into s;
  insert into settings_history (company_id, key, version, value, changed_by) values (p_company, p_key, s.version, p_value, p_actor);
  insert into audit_log (company_id, actor_id, action, entity, entity_id, after) values (p_company, p_actor, 'setting.set', 'settings', p_key, p_value);
  return to_jsonb(s);
end $$;

create or replace function create_code_template(p_company uuid, p_definition jsonb, p_actor uuid) returns jsonb
language plpgsql as $$
declare v int; r code_templates%rowtype;
begin
  select coalesce(max(version), 0) + 1 into v from code_templates where company_id = p_company;
  update code_templates set is_current = false where company_id = p_company and is_current;
  insert into code_templates (company_id, version, definition, is_current, created_by)
  values (p_company, v, jsonb_set(p_definition, '{version}', to_jsonb(v)), true, p_actor) returning * into r;
  insert into audit_log (company_id, actor_id, action, entity, entity_id) values (p_company, p_actor, 'code_template.create', 'code_templates', v::text);
  return to_jsonb(r);
end $$;

-- القيم المستخدمة فعلًا (في مخزون أو فاتورة أو ملصق مطبوع): لا يُغيَّر معناها ولا تُحذف
create or replace function used_template_values(p_company uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'color', coalesce(jsonb_agg(distinct v.color_code) filter (where v.color_code is not null), '[]'::jsonb),
    'size',  coalesce(jsonb_agg(distinct v.size_code)  filter (where v.size_code  is not null), '[]'::jsonb))
  from variants v
  where v.company_id = p_company and (v.printed_at is not null
    or exists (select 1 from stock_movements m where m.variant_id = v.id)
    or exists (select 1 from invoice_lines il where il.variant_id = v.id))
$$;

create or replace function has_printed_codes(p_company uuid) returns boolean
language sql stable as $$ select exists (select 1 from variants where company_id = p_company and printed_at is not null) $$;

-- مخزون كل موقع لكل قطعة (للوحة الإدارة)
create or replace function stock_report(p_company uuid, p_branch uuid, p_q text, p_limit int, p_offset int) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select sb.branch_id, b.name as branch_name, v.id as variant_id, v.sku, m.name as model_name, v.color_name, v.size_name,
           sb.qty, sb.reserved, sb.min_qty, (sb.qty <= sb.min_qty) as low
    from stock_balances sb
    join variants v on v.id = sb.variant_id and v.company_id = p_company
    join models m on m.id = v.model_id
    join branches b on b.id = sb.branch_id
    where (p_branch is null or sb.branch_id = p_branch)
      and (p_q is null or p_q = '' or v.sku ilike '%' || p_q || '%' or m.name ilike '%' || p_q || '%')
    order by m.name, v.sku, b.name
    limit p_limit offset p_offset) x
$$;

create or replace function sales_report(p_company uuid, p_from date, p_to date, p_branch uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.day desc), '[]'::jsonb) from (
    select d.day, d.branch_id, b.name as branch_name, d.invoices_count, d.returns_count, d.gross, d.discount, d.total
    from daily_summaries d join branches b on b.id = d.branch_id and b.company_id = p_company
    where d.day between p_from and p_to and (p_branch is null or d.branch_id = p_branch)) x
$$;

create or replace function top_models_report(p_company uuid, p_from date, p_to date, p_limit int) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select il.model_name, il.color_name, il.size_name, sum(il.qty) as qty, sum(il.line_total) as total
    from invoice_lines il join invoices i on i.id = il.invoice_id
    where i.company_id = p_company and i.kind = 'sale' and i.status = 'posted'
      and (i.created_at_device at time zone 'Africa/Cairo')::date between p_from and p_to
    group by il.model_name, il.color_name, il.size_name order by qty desc limit p_limit) x
$$;

create or replace function usage_report(p_company uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select relname as name, pg_total_relation_size(c.oid) as bytes, c.reltuples::bigint as approx_rows
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 8) t),
    'invoices', (select count(*) from invoices where company_id = p_company),
    'change_log_rows', (select count(*) from change_log where company_id = p_company))
$$;

-- حذف قديم من change_log (بعد استلام الأجهزة أو مدة): فكرة "احذف أول ما يُزامَن" لا تصلح للتنزيل
create or replace function prune_change_log(p_company uuid, p_days int) returns int
language plpgsql as $$
declare n int; min_dev bigint;
begin
  select min(last_pulled_seq) into min_dev from devices where company_id = p_company and status = 'active' and last_seen > now() - make_interval(days => p_days);
  delete from change_log where company_id = p_company and at < now() - make_interval(days => p_days)
    and seq <= coalesce(min_dev, (select max(seq) from change_log));
  get diagnostics n = row_count;
  return n;
end $$;

-- اللقطة الكاملة للجهاز الجديد (أو المتأخر عن حد الحذف)
create or replace function device_snapshot(p_company uuid, p_branch uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('seq', coalesce((select max(seq) from change_log where company_id = p_company), 0), 'tables', jsonb_build_object(
    'branches',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from branches t where company_id = p_company),
    'categories',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from categories t where company_id = p_company),
    'models',        (select coalesce(jsonb_agg(to_jsonb(t) - 'cost_piasters'), '[]') from models t where company_id = p_company),
    'variants',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from variants t where company_id = p_company),
    'model_images',  (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from model_images i join models m on m.id = i.model_id where m.company_id = p_company),
    'code_templates',(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from code_templates t where company_id = p_company and is_current),
    'customers',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from customers t where company_id = p_company and deleted_at is null),
    'settings',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from settings t where company_id = p_company),
    'branch_users',  (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name,
                        'role', u.role, 'branch_id', u.branch_id, 'is_active', u.is_active, 'verifier', u.password_hash, 'pin_verifier', u.pin_hash)), '[]')
                      from users u where u.company_id = p_company and (u.branch_id is null or u.branch_id = p_branch)),
    'stock_movements',(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from stock_movements t where company_id = p_company and branch_id = p_branch),
    'transfers',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from transfers t where company_id = p_company and p_branch in (from_branch_id, to_branch_id)),
    'transfer_lines',(select coalesce(jsonb_agg(to_jsonb(l)), '[]') from transfer_lines l join transfers t on t.id = l.transfer_id
                      where t.company_id = p_company and p_branch in (t.from_branch_id, t.to_branch_id)),
    'shift_templates',(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from shift_templates t where company_id = p_company),
    'schedules',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from schedules t where company_id = p_company and branch_id = p_branch)))
$$;

commit;


-- ===== 006_api_read.sql =====
-- 006_api_read.sql  |  دوال القراءة والتقارير للـ API (كلها RPC حتى يعمل نفس الكود عبر PostgREST أو psql أو pg)
-- ملاحظة: هذا الملف يسبق 099_security.sql الذي يقفل الدوال والجداول لمفتاح الخدمة فقط.

begin;

-- قائمة عامة بقائمة بيضاء: لا يمكن طلب جدول غير مسموح، والفلتر احتواء JSON (مفاتيح الأعمدة تمر كقيم لا كنص SQL)
create or replace function api_list(p_table text, p_company uuid, p_where jsonb default '{}', p_q text default null,
                                    p_limit int default 100, p_offset int default 0) returns jsonb
language plpgsql stable as $$
declare
  v_order text; v_search text; r jsonb;
begin
  if p_table not in ('categories','models','variants','customers','users','devices','branches','code_templates','orders',
                     'transfers','stock_receipts','shift_templates','schedules','permission_grants','settings','settings_history',
                     'audit_log','attendance_events','cashier_shifts','invoices','cashboxes','cash_entries') then
    raise exception 'جدول غير مسموح: %', p_table using errcode = '42501';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_order := case p_table
    when 'audit_log' then 'id desc' when 'settings_history' then 'id desc'
    when 'invoices' then 'created_at_server desc, id' when 'attendance_events' then 'device_time desc, id'
    when 'cashier_shifts' then 'opened_at desc, id'
    when 'orders' then 'created_at desc, id' when 'permission_grants' then 'created_at desc, id'
    when 'cash_entries' then 'created_at desc, id' when 'stock_receipts' then 'created_at desc, id'
    when 'transfers' then 'created_at desc, id'
    when 'customers' then 'name, id' when 'models' then 'code' when 'variants' then 'sku'
    when 'branches' then 'code' when 'categories' then 'sort, name' else 'id' end;
  v_search := case p_table
    when 'models' then '(t.name ilike $3 or t.code ilike $3)'
    when 'customers' then '(t.name ilike $3 or t.phone_e164 like $3)'
    when 'variants' then 't.sku ilike $3'
    when 'users' then '(t.username ilike $3 or t.display_name ilike $3)'
    when 'orders' then 't.number ilike $3'
    when 'invoices' then 't.number ilike $3'
    else 'true' end;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (
       select t.* from %I t where t.company_id = $1 and to_jsonb(t) @> $2
         and ($3 is null or %s) order by %s limit $4 offset $5) x', p_table, v_search, v_order)
  into r using p_company, coalesce(p_where, '{}'), case when p_q is null or p_q = '' then null else '%' || p_q || '%' end, p_limit, p_offset;
  return r;
end $$;

create or replace function api_delete_soft(p_table text, p_id uuid, p_company uuid) returns void
language plpgsql as $$
begin
  if p_table = 'customers' then
    if exists (select 1 from invoices where customer_id = p_id) then raise exception 'لا يُحذف عميل له فواتير'; end if;
    update customers set deleted_at = now() where id = p_id and company_id = p_company;
  elsif p_table in ('categories','models','variants','shift_templates') then
    execute format('update %I set is_active = false where id = $1 and company_id = $2', p_table) using p_id, p_company;
  else raise exception 'الحذف غير مسموح لهذا الجدول'; end if;
end $$;

create or replace function transfer_detail(p_company uuid, p_transfer uuid) returns jsonb
language sql stable as $$
  select to_jsonb(t) || jsonb_build_object(
    'from_name', (select name from branches where id = t.from_branch_id),
    'to_name', (select name from branches where id = t.to_branch_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variant_id', l.variant_id, 'sku', v.sku,
        'model_name', m.name, 'color_name', v.color_name, 'size_name', v.size_name, 'qty_sent', l.qty_sent, 'qty_received', l.qty_received))
      from transfer_lines l join variants v on v.id = l.variant_id join models m on m.id = v.model_id where l.transfer_id = t.id), '[]'::jsonb))
  from transfers t where t.id = p_transfer and t.company_id = p_company
$$;

create or replace function order_detail(p_company uuid, p_order uuid) returns jsonb
language sql stable as $$
  select to_jsonb(o) || jsonb_build_object(
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone_e164, 'address', c.address) from customers c where c.id = o.customer_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'sku', v.sku, 'model_name', m.name,
        'color_name', v.color_name, 'size_name', v.size_name, 'qty', l.qty, 'unit_price', l.unit_price, 'fulfil_branch_id', l.fulfil_branch_id))
      from order_lines l join variants v on v.id = l.variant_id join models m on m.id = v.model_id where l.order_id = o.id), '[]'::jsonb))
  from orders o where o.id = p_order and o.company_id = p_company
$$;

create or replace function invoice_detail(p_company uuid, p_invoice uuid) returns jsonb
language sql stable as $$
  select to_jsonb(i) || jsonb_build_object(
    'lines', coalesce((select jsonb_agg(to_jsonb(l)) from invoice_lines l where l.invoice_id = i.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from payments p where p.invoice_id = i.id), '[]'::jsonb))
  from invoices i where i.id = p_invoice and i.company_id = p_company
$$;

create or replace function create_variants_bulk(p_company uuid, p_model uuid, p_version int, p_rows jsonb) returns int
language plpgsql as $$
declare r jsonb; n int := 0; k int;
begin
  if not exists (select 1 from models where id = p_model and company_id = p_company) then raise exception 'الموديل غير موجود'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into variants (company_id, model_id, sku, color_code, color_name, size_code, size_name, template_version, attrs)
    values (p_company, p_model, r->>'sku', r->>'colorCode', r->>'colorName', r->>'sizeCode', r->>'sizeName', p_version,
            coalesce(r->'attrs', '{}'))
    on conflict (company_id, sku) do update set is_active = true;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

create or replace function mark_printed(p_company uuid, p_skus jsonb) returns int
language sql as $$
  with u as (update variants set printed_at = now() where company_id = p_company
               and sku in (select jsonb_array_elements_text(p_skus)) and printed_at is null returning 1)
  select count(*)::int from u
$$;

create or replace function set_min_qty(p_company uuid, p_branch uuid, p_variant uuid, p_min int) returns void
language sql as $$
  insert into stock_balances (branch_id, variant_id, min_qty)
  select p_branch, p_variant, p_min where exists (select 1 from branches where id = p_branch and company_id = p_company)
  on conflict (branch_id, variant_id) do update set min_qty = excluded.min_qty
$$;

-- تسوية يدوية (من الإدارة): حركة في الدفتر بسبب مسجل
create or replace function manual_adjust(p_company uuid, p_actor uuid, p_branch uuid, p_variant uuid, p_delta int, p_reason text) returns void
language plpgsql as $$
begin
  if p_delta = 0 then raise exception 'الفرق صفر'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب التسوية مطلوب'; end if;
  if not exists (select 1 from branches where id = p_branch and company_id = p_company) then raise exception 'الموقع غير موجود'; end if;
  insert into stock_movements (id, company_id, branch_id, variant_id, qty_delta, kind, doc_type, note)
  values (gen_random_uuid(), p_company, p_branch, p_variant, p_delta, 'manual_adjust', 'adjust', p_reason);
  insert into audit_log (company_id, actor_id, action, entity, entity_id, reason, after)
  values (p_company, p_actor, 'stock.manual_adjust', 'variants', p_variant::text, p_reason, jsonb_build_object('branch', p_branch, 'delta', p_delta));
end $$;

-- ───────────── المزامنة (تنزيل) ─────────────
create or replace function pull_changes(p_company uuid, p_device uuid, p_after bigint, p_limit int) returns jsonb
language plpgsql as $$
declare v_branch uuid; v_kind text; v_min bigint; v_max bigint; v_rows jsonb; v_last bigint; v_n int;
begin
  select branch_id, kind into v_branch, v_kind from devices where id = p_device and company_id = p_company and status = 'active';
  if not found then raise exception 'الجهاز غير مفعّل'; end if;
  select min(seq), max(seq) into v_min, v_max from change_log where company_id = p_company;
  if p_after > 0 and v_min is not null and p_after < v_min - 1 then
    return jsonb_build_object('needsSnapshot', true);   -- السجل قُصّ بعد هذا المؤشر: يلزم لقطة كاملة
  end if;
  p_limit := least(greatest(coalesce(p_limit, 500), 1), 500);
  select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'table', table_name, 'rowId', row_id, 'op', op, 'data', data) order by seq), '[]'::jsonb),
         max(seq), count(*) into v_rows, v_last, v_n
  from (select * from change_log where company_id = p_company and seq > p_after
          and (branch_scope is null or branch_scope = v_branch or v_kind = 'server_agent')
        order by seq limit p_limit) c;
  update devices set last_seen = now(), last_pulled_seq = greatest(last_pulled_seq, coalesce(v_last, p_after)) where id = p_device;
  return jsonb_build_object('changes', v_rows, 'nextSeq', coalesce(v_last, p_after),
                            'hasMore', coalesce(v_last, p_after) < coalesce(v_max, 0) and v_n = p_limit, 'serverTime', now());
end $$;

create or replace function latest_seq(p_company uuid) returns bigint
language sql stable as $$ select coalesce(max(seq), 0) from change_log where company_id = p_company $$;

-- ───────────── تقارير ─────────────
create or replace function dashboard(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'sales_total', coalesce((select sum(total) from daily_summaries d join branches b on b.id = d.branch_id
                             where b.company_id = p_company and d.day between p_from and p_to), 0),
    'invoices', coalesce((select sum(invoices_count) from daily_summaries d join branches b on b.id = d.branch_id
                          where b.company_id = p_company and d.day between p_from and p_to), 0),
    'returns', coalesce((select sum(returns_count) from daily_summaries d join branches b on b.id = d.branch_id
                         where b.company_id = p_company and d.day between p_from and p_to), 0),
    'orders_pending', (select count(*) from orders where company_id = p_company and status = 'pending'),
    'orders_open', (select count(*) from orders where company_id = p_company and status in ('confirmed','preparing','shipped')),
    'low_stock', (select count(*) from stock_balances sb join branches b on b.id = sb.branch_id
                  where b.company_id = p_company and sb.qty <= sb.min_qty and sb.min_qty > 0),
    'stock_units', coalesce((select sum(qty) from stock_balances sb join branches b on b.id = sb.branch_id where b.company_id = p_company), 0),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch_id', d.branch_id, 'name', b.name, 'total', d.t, 'count', d.c))
        from (select branch_id, sum(total) t, sum(invoices_count) c from daily_summaries where day between p_from and p_to group by branch_id) d
        join branches b on b.id = d.branch_id and b.company_id = p_company), '[]'::jsonb))
$$;

create or replace function attendance_report(p_company uuid, p_from timestamptz, p_to timestamptz, p_branch uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'user_id', e.user_id, 'name', u.display_name, 'branch_id', e.branch_id,
      'kind', e.kind, 'color', e.color, 'points', e.points, 'device_time', e.device_time, 'clock_source', e.clock_source,
      'corrects_event_id', e.corrects_event_id, 'correction_reason', e.correction_reason) order by e.device_time), '[]'::jsonb)
  from attendance_events e join users u on u.id = e.user_id
  where e.company_id = p_company and e.device_time >= p_from and e.device_time < p_to and (p_branch is null or e.branch_id = p_branch)
$$;

-- تصحيح حضور: سجل جديد يشير للأصلي مع سبب (الأصلي لا يُعدَّل)
create or replace function correct_attendance(p_company uuid, p_actor uuid, p_user uuid, p_branch uuid, p_kind text, p_color text,
                                              p_points numeric, p_time timestamptz, p_corrects uuid, p_reason text) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب التصحيح مطلوب'; end if;
  insert into attendance_events (id, company_id, user_id, branch_id, kind, color, points, device_time, clock_source, corrects_event_id, correction_reason, corrected_by)
  values (v_id, p_company, p_user, p_branch, p_kind, p_color, p_points, p_time, 'server', p_corrects, p_reason, p_actor);
  insert into audit_log (company_id, actor_id, action, entity, entity_id, reason) values (p_company, p_actor, 'attendance.correct', 'attendance_events', v_id::text, p_reason);
  return v_id;
end $$;

create or replace function cash_summary(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'category', category, 'total', t)), '[]'::jsonb)
  from (select kind, category, sum(amount) t from cash_entries
        where company_id = p_company and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by kind, category) x
$$;

create or replace function weekly_export(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'sales', coalesce((select jsonb_agg(jsonb_build_object('الرقم', i.number, 'الفرع', b.name, 'النوع', i.kind, 'الإجمالي', i.total / 100.0,
        'الخصم', i.discount / 100.0, 'المدفوع', i.paid / 100.0, 'التاريخ', i.created_at_device) order by i.created_at_device)
      from invoices i join branches b on b.id = i.branch_id
      where i.company_id = p_company and (i.created_at_device at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'::jsonb),
    'stock-movements', coalesce((select jsonb_agg(jsonb_build_object('الفرع', b.name, 'الكود', v.sku, 'الكمية', m.qty_delta, 'النوع', m.kind,
        'التاريخ', m.created_at_server) order by m.created_at_server)
      from stock_movements m join branches b on b.id = m.branch_id join variants v on v.id = m.variant_id
      where m.company_id = p_company and (m.created_at_server at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'::jsonb),
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('الرقم', t.number, 'من', fb.name, 'إلى', tb.name, 'الحالة', t.status, 'التاريخ', t.created_at))
      from transfers t join branches fb on fb.id = t.from_branch_id join branches tb on tb.id = t.to_branch_id
      where t.company_id = p_company and (t.created_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'::jsonb),
    'stock-receipts', coalesce((select jsonb_agg(jsonb_build_object('الرقم', r.number, 'الكود', v.sku, 'الكمية', l.qty, 'التاريخ', r.created_at))
      from stock_receipts r join stock_receipt_lines l on l.receipt_id = r.id join variants v on v.id = l.variant_id
      where r.company_id = p_company and (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'::jsonb),
    'cashbox', coalesce((select jsonb_agg(jsonb_build_object('النوع', e.kind, 'التصنيف', e.category, 'المبلغ', e.amount / 100.0, 'ملاحظة', e.note, 'التاريخ', e.created_at))
      from cash_entries e where e.company_id = p_company and (e.created_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'::jsonb))
$$;

-- حالة طلب للعميل (بدون بيانات حساسة): الرقم + آخر 4 أرقام من الهاتف
create or replace function public_order_status(p_company uuid, p_number text, p_phone_tail text) returns jsonb
language sql stable as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'payment_status', o.payment_status, 'total', o.total, 'created_at', o.created_at)
  from orders o join customers c on c.id = o.customer_id
  where o.company_id = p_company and o.number = p_number and right(c.phone_e164, 4) = p_phone_tail
$$;

notify pgrst, 'reload schema';
commit;


-- ===== 007_api_misc.sql =====
-- 007_api_misc.sql  |  دوال مساعدة للـ API: صور الموديلات والجداول الأسبوعية
begin;

create or replace function model_images_of(p_company uuid, p_model uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.sort), '[]'::jsonb)
  from model_images i join models m on m.id = i.model_id where m.id = p_model and m.company_id = p_company
$$;

create or replace function add_model_image(p_company uuid, p_model uuid, p_thumb text, p_card text, p_full text) returns jsonb
language plpgsql as $$
declare r model_images%rowtype; n int;
begin
  if not exists (select 1 from models where id = p_model and company_id = p_company) then raise exception 'الموديل غير موجود'; end if;
  select count(*) into n from model_images where model_id = p_model;
  if n >= 8 then raise exception 'الحد الأقصى 8 صور للموديل'; end if;
  insert into model_images (model_id, url_thumb, url_card, url_full, sort) values (p_model, p_thumb, p_card, p_full, n) returning * into r;
  return to_jsonb(r);
end $$;

create or replace function delete_model_image(p_company uuid, p_image uuid) returns void
language sql as $$
  delete from model_images i using models m where i.id = p_image and m.id = i.model_id and m.company_id = p_company
$$;

create or replace function api_delete_schedule(p_company uuid, p_id uuid) returns boolean
language sql as $$
  with d as (delete from schedules where id = p_id and company_id = p_company returning 1) select exists (select 1 from d)
$$;

notify pgrst, 'reload schema';
commit;


-- ===== 099_security.sql =====
-- 004_security.sql  |  RLS: كل الجداول مقفلة. الوصول الوحيد عبر الـ Backend بمفتاح الخدمة (Service Role).
-- لا policies للـ anon ولا authenticated، فلا يمكن لأي عميل يملك المفتاح العام قراءة أو كتابة شيء.

begin;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- دوال النظام لا تُنفَّذ إلا بالأدوار الخاصة بالـ Backend (دوال الإضافات مثل pgcrypto لا نلمسها)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

commit;


-- ===== seed.sql =====
-- seed.sql  |  بيانات أولية للتجربة المحلية. غيّر كلمات السر فورًا في الإنتاج.
-- كلمة سر السوبر أدمن تُنشأ من سكربت: node scripts/seed-dev.mjs  (لأن الـ hash يُحسب بنفس خوارزمية الـ Worker)

begin;

insert into companies (id, name) values ('00000000-0000-4000-8000-000000000001', 'BIGGEST Fashion Collection')
on conflict do nothing;

insert into branches (id, company_id, code, name, kind) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'MAIN', 'المخزن الرئيسي', 'main_warehouse'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'CAI',  'فرع القاهرة', 'branch'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'WEB',  'مخزون الموقع', 'web_stock')
on conflict do nothing;

insert into code_templates (company_id, version, is_current, definition) values
 ('00000000-0000-4000-8000-000000000001', 1, true, $json$
 {"version":1,"separator":"-","checkDigit":false,"parts":[
  {"key":"model","label":"الموديل","kind":"sequence","charset":"digits","length":4},
  {"key":"color","label":"اللون","kind":"enum","charset":"digits","length":2,"values":[
    {"code":"01","name":"أسود","active":true,"display":"#111111"},
    {"code":"02","name":"أبيض","active":true,"display":"#f5f5f5"},
    {"code":"03","name":"كحلي","active":true,"display":"#1f2a44"},
    {"code":"04","name":"بيج","active":true,"display":"#d8c3a5"},
    {"code":"05","name":"أحمر","active":true,"display":"#b3261e"}]},
  {"key":"size","label":"المقاس","kind":"enum","charset":"alnum","minLength":1,"maxLength":3,"values":[
    {"code":"S","name":"S","active":true},{"code":"M","name":"M","active":true},
    {"code":"L","name":"L","active":true},{"code":"XL","name":"XL","active":true}]}]}
 $json$::jsonb)
on conflict do nothing;

insert into shift_templates (company_id, name, start_min, end_min) values
  ('00000000-0000-4000-8000-000000000001', 'وردية صباحية', 540, 1020),
  ('00000000-0000-4000-8000-000000000001', 'وردية مسائية', 840, 1320);

commit;
