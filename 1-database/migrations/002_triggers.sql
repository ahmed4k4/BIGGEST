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
