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
