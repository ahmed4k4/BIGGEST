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
