-- smoke.sql  |  اختبار دخان لدوال القاعدة على PostgreSQL حقيقي.
-- التشغيل: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/smoke.sql   (على قاعدة جديدة بعد الـ migrations + seed)
-- أي فشل يرفع exception. في النهاية يُرجع كل شيء بـ rollback فلا يترك بيانات.

begin;

do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000001';
  main uuid := '00000000-0000-4000-8000-0000000000a1';
  cai uuid := '00000000-0000-4000-8000-0000000000b1';
  web uuid := '00000000-0000-4000-8000-0000000000c1';
  u uuid := gen_random_uuid(); dev uuid := gen_random_uuid();
  m uuid := gen_random_uuid(); va uuid := gen_random_uuid();
  rc uuid; tr uuid; inv uuid := gen_random_uuid(); inv2 uuid := gen_random_uuid(); res jsonb; bal int; n int;
  ord jsonb; ord2 jsonb; g uuid; phone text := '+201012345678';
begin
  -- ── بيانات أساسية
  insert into users (id, company_id, username, display_name, role, password_hash) values (u, c, 'smoke', 'اختبار', 'admin', 'x');
  insert into devices (id, company_id, branch_id, name, token_hash) values (dev, c, cai, 'POS-1', 'x');
  insert into models (id, company_id, code, name, price_piasters, template_version) values (m, c, '0142', 'قميص', 50000, 1);
  insert into variants (id, company_id, model_id, sku, color_code, color_name, size_code, size_name, template_version)
  values (va, c, m, '0142-05-M', '05', 'أحمر', 'M', 'M', 1);

  -- ── إدخال بضاعة 10 قطع بالمخزن الرئيسي (ولا يُقبل في فرع عادي)
  rc := create_receipt(c, u, main, 'اختبار', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 10)));
  begin
    perform create_receipt(c, u, cai, 'x', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 1)));
    raise exception 'FAIL: الإدخال في فرع عادي يجب أن يُرفض';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  select qty into bal from stock_balances where branch_id = main and variant_id = va;
  assert bal = 10, format('رصيد الرئيسي بعد الإدخال = %s', bal);

  -- ── تحويل 4 قطع للفرع: اعتماد ثم خروج ثم استلام
  tr := create_transfer(c, u, main, cai, null, jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 4)));
  perform transition_transfer(c, tr, 'approved', u);
  perform transition_transfer(c, tr, 'in_transit', u);
  select qty into bal from stock_balances where branch_id = main and variant_id = va;
  assert bal = 6, format('رصيد الرئيسي بعد الخروج = %s', bal);
  perform receive_transfer(c, tr, jsonb_build_array(jsonb_build_object('variantId', va, 'qtyReceived', 3)), u);   -- عجز قطعة
  assert (select status from transfers where id = tr) = 'partially_received', 'التحويل يجب أن يكون مستلمًا جزئيًا';
  perform receive_transfer(c, tr, jsonb_build_array(jsonb_build_object('variantId', va, 'qtyReceived', 1)), u);
  assert (select status from transfers where id = tr) = 'completed', 'التحويل يجب أن يكتمل';
  select qty into bal from stock_balances where branch_id = cai and variant_id = va;
  assert bal = 4, format('رصيد الفرع بعد الاستلام = %s', bal);
  begin
    perform transition_transfer(c, tr, 'approved', u);
    raise exception 'FAIL: انتقال غير مسموح يجب أن يُرفض';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- ── بيع من الفرع عبر Outbox
  res := apply_ops(c, dev, jsonb_build_array(
    jsonb_build_object('opId', gen_random_uuid(), 'type', 'customer.upsert',
      'payload', jsonb_build_object('phone', phone, 'name', 'أحمد')),
    jsonb_build_object('opId', '11111111-1111-4111-8111-111111111111', 'type', 'sale.create', 'payload', jsonb_build_object(
      'invoice', jsonb_build_object('id', inv, 'number', 'CAI-A-000001', 'customerId', customer_id_for(c, phone),
        'gross', 100000, 'discount', 0, 'tax', 0, 'total', 100000, 'paid', 100000, 'createdAtDevice', now()),
      'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'sku', '0142-05-M', 'modelName', 'قميص', 'colorName', 'أحمر',
        'sizeName', 'M', 'qty', 2, 'unitPrice', 50000, 'lineTotal', 100000, 'movementId', gen_random_uuid())),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100000))))));
  assert (res->0->>'status') = 'ok' and (res->1->>'status') = 'ok', format('نتيجة العمليات: %s', res);
  select qty into bal from stock_balances where branch_id = cai and variant_id = va;
  assert bal = 2, format('رصيد الفرع بعد البيع = %s', bal);

  -- إعادة إرسال نفس العملية لا تكرر الفاتورة
  res := apply_ops(c, dev, jsonb_build_array(jsonb_build_object('opId', '11111111-1111-4111-8111-111111111111', 'type', 'sale.create',
    'payload', '{}'::jsonb)));
  assert (res->0->>'status') = 'duplicate', 'إعادة الإرسال يجب أن تُرجع duplicate';
  assert (select count(*) from invoices where id = inv) = 1, 'الفاتورة تكررت';

  -- بيع زيادة أثناء الانقطاع: يُقبل ويُعلَّم oversold (لا نضيع مبيعات حقيقية)
  res := apply_ops(c, dev, jsonb_build_array(jsonb_build_object('opId', gen_random_uuid(), 'type', 'sale.create', 'payload', jsonb_build_object(
      'invoice', jsonb_build_object('id', inv2, 'number', 'CAI-A-000002', 'gross', 250000, 'discount', 0, 'tax', 0, 'total', 250000,
        'paid', 250000, 'createdAtDevice', now()),
      'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'sku', '0142-05-M', 'modelName', 'قميص', 'colorName', 'أحمر',
        'sizeName', 'M', 'qty', 5, 'unitPrice', 50000, 'lineTotal', 250000, 'movementId', gen_random_uuid()))))));
  assert (res->0->>'status') = 'ok', format('بيع الزيادة: %s', res);
  assert (select oversold from invoices where id = inv2), 'يجب تعليم الفاتورة oversold';

  -- عملية فاشلة لا تُسقط الدفعة ولا تترك أثرًا ناقصًا
  res := apply_ops(c, dev, jsonb_build_array(
    jsonb_build_object('opId', gen_random_uuid(), 'type', 'nope', 'payload', '{}'::jsonb),
    jsonb_build_object('opId', gen_random_uuid(), 'type', 'attendance.record', 'payload', jsonb_build_object(
      'id', gen_random_uuid(), 'userId', u, 'kind', 'in', 'color', 'green', 'points', 1, 'deviceTime', now()))));
  assert (res->0->>'status') = 'error' and (res->1->>'status') = 'ok', format('عزل الأخطاء: %s', res);

  -- ── الحماية: لا تعديل/حذف للفواتير والدفتر
  begin update invoices set total = 1 where id = inv; raise exception 'FAIL: تعديل مبلغ فاتورة'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin delete from invoices where id = inv; raise exception 'FAIL: حذف فاتورة'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin update stock_movements set qty_delta = 99; raise exception 'FAIL: تعديل الدفتر'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  update invoices set reprint_count = 1 where id = inv;  -- مسموح

  -- ── Change Log: تغيير موديل يظهر، وحركات الفرع مقصورة عليه
  assert exists (select 1 from change_log where table_name = 'models' and row_id = m::text), 'models لم يُسجَّل في change_log';
  assert exists (select 1 from change_log where table_name = 'stock_movements' and branch_scope = cai), 'حركات الفرع بدون scope';
  assert not exists (select 1 from change_log where table_name = 'users' and data ? 'password_hash'), 'كلمة السر نزلت في change_log';
  assert exists (select 1 from change_log where table_name = 'branch_users' and data ? 'verifier'), 'branch_users مفقود';

  -- ── الطلبات الإلكترونية: وضع 1 (المخزن الرئيسي فقط) برصيد 6 وهامش أمان 1
  insert into settings (company_id, key, value) values (c, 'site_stock.mode', '1'), (c, 'site_stock.safety_margin', '1');
  ord := create_online_order(c, jsonb_build_object('clientToken', 'tok-1', 'paymentMethod', 'cod',
    'customer', jsonb_build_object('name', 'سارة', 'phone', '+201199999999', 'address', 'القاهرة', 'governorate', 'القاهرة'),
    'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 5))));
  assert (ord->>'total')::bigint = 250000, format('إجمالي الطلب من سعر السيرفر: %s', ord);
  assert (select reserved from stock_balances where branch_id = main and variant_id = va) = 5, 'الحجز لم يُسجَّل';

  ord2 := create_online_order(c, jsonb_build_object('clientToken', 'tok-1', 'customer', jsonb_build_object('name', 'x', 'phone', '+201199999999'),
    'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 5))));
  assert (ord2->>'duplicate')::boolean, 'الضغط مرتين يجب ألا ينشئ طلبًا ثانيًا';
  assert (select reserved from stock_balances where branch_id = main and variant_id = va) = 5, 'الحجز تضاعف عند التكرار';

  begin
    perform create_online_order(c, jsonb_build_object('clientToken', 'tok-2', 'customer', jsonb_build_object('name', 'x', 'phone', '+201188888888'),
      'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 1))));
    raise exception 'FAIL: يجب رفض الطلب بعد نفاد المتاح';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select count(*) from orders where client_token = 'tok-2') = 0, 'الطلب الفاشل ترك أثرًا';

  perform set_order_status(c, (ord->>'orderId')::uuid, 'cancelled', u);
  assert (select reserved from stock_balances where branch_id = main and variant_id = va) = 0, 'الإلغاء لم يُفرج عن الحجز';

  ord := create_online_order(c, jsonb_build_object('clientToken', 'tok-3', 'customer', jsonb_build_object('name', 'منى', 'phone', '+201177777777'),
    'lines', jsonb_build_array(jsonb_build_object('variantId', va, 'qty', 2))));
  perform set_order_status(c, (ord->>'orderId')::uuid, 'confirmed', u);
  perform set_order_status(c, (ord->>'orderId')::uuid, 'preparing', u);
  perform set_order_status(c, (ord->>'orderId')::uuid, 'shipped', u);
  select qty, reserved into bal, n from stock_balances where branch_id = main and variant_id = va;
  assert bal = 4 and n = 0, format('الشحن يحوّل الحجز لخروج فعلي: qty=%s reserved=%s', bal, n);

  assert jsonb_array_length(catalog_snapshot(c)->'models') >= 1, 'لقطة الكتالوج فارغة';
  assert (availability_snapshot(c)->(va::text)->>'a')::int = 3, format('لقطة التوفر: %s', availability_snapshot(c));

  -- ── التصاريح لمرة واحدة
  insert into permission_grants (company_id, feature, status, uses_left, expires_at, requested_by, decided_by, reason)
  values (c, 'site_stock.mode', 'approved', 1, now() + interval '10 minutes', u, u, 'اختبار');
  g := consume_grant(c, 'site_stock.mode', u);
  assert g is not null, 'التصريح لم يُستهلك';
  assert consume_grant(c, 'site_stock.mode', u) is null, 'التصريح استُخدم مرتين!';
  assert (select status from permission_grants where id = g) = 'used', 'حالة التصريح';

  raise notice 'SMOKE OK ✔';
end $$;

rollback;
