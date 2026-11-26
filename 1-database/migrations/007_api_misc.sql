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
