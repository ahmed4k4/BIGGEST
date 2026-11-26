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
