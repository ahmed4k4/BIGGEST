# 1 — قاعدة البيانات (PostgreSQL / Supabase)

## ما هذا؟
كل جداول النظام ومنطق الأعمال (البيع، المخزون، التحويلات، الحجز، المزامنة، الصلاحيات) مكتوب هنا كملفات SQL. هذا هو **القلب**: لا يعمل أي برنامج آخر بدونه.

## أين يُركَّب؟
على **Supabase** (الباقة المجانية) مرة واحدة فقط، أو على أي PostgreSQL 15+ إن أردت سيرفرك الخاص.

## التركيب — الطريقة السهلة (بدون تثبيت أي شيء)
1. ادخل [supabase.com](https://supabase.com) وأنشئ مشروعًا جديدًا.
2. من القائمة اليسرى: **SQL Editor** ← New query.
3. افتح `all-in-one.sql` من هذا المجلد، انسخ **كل** محتواه والصقه، ثم **Run**.
4. انتظر «Success». الجداول والدوال والبيانات الأولية (شركة BIGGEST، المخزن الرئيسي، فرع القاهرة، قالب الأكواد، الإعدادات) جاهزة.

> شغّل الملف **مرة واحدة فقط** على قاعدة جديدة فارغة.

انسخ من Supabase (Project Settings):
- `Project URL` و`service_role key` ← للـ API (مجلد `2-api`). **سرّي: لا يوضع في أي موقع أو تطبيق فرع.**
- `Direct connection string` ← للنسخ الاحتياطي (`6-backup-server`) ولإنشاء المدير.

## التركيب — الطريقة الآلية
المتطلبات: Node 22.13+ وأداة `psql`.
```bash
cp .env.example .env        # ضع DATABASE_URL
node scripts/migrate.mjs --seed
```
ويندوز: اضغط مرتين على `setup.bat`. السكربت يتذكر ما طُبّق، فإعادة التشغيل آمنة.

## محتويات المجلد
| الملف | وظيفته |
|---|---|
| `migrations/001…099_*.sql` | المخطط والدوال بالترتيب |
| `seed.sql` | البيانات الأولية |
| `all-in-one.sql` | كل ما سبق في ملف واحد للصقه في Supabase |
| `scripts/migrate.mjs` | تطبيق آلي |
| `scripts/build-single-sql.mjs` | إعادة توليد `all-in-one.sql` بعد أي تعديل |
| `tests/smoke.sql` | اختبار دخان بصيغة SQL |

## بعد التركيب
انتقل إلى **`2-api`**.

## أعطال شائعة
- `psql: command not found`: ثبّت PostgreSQL client أو استخدم الطريقة السهلة.
- `permission denied`: استخدم Direct connection بمستخدم `postgres`.
