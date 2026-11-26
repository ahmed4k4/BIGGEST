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
