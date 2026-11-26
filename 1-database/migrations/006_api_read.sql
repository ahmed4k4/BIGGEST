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
