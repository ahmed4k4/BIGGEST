# 2 — الـ API (الواجهة الخلفية)

## ما هذا؟
الوسيط الوحيد بين كل البرامج وقاعدة البيانات: يتحقق من الدخول والصلاحيات ثم ينفّذ العمليات. تتصل به لوحة الإدارة والمتجر وتطبيق الفرع والسيرفر المحلي. لا يحتوي واجهة.

## أين يُركَّب؟
- **الإنتاج (مجانًا):** Cloudflare Workers.
- **التجربة / سيرفر خاص:** أي جهاز عليه Node 22.13+.

## المتطلبات
أنجز **`1-database`** أولًا. ثم حساب Cloudflare (للإنتاج) أو Node 22.13+ و`psql` (للتجربة).

## أ) تشغيل تجريبي على جهازك
```bash
cp .env.example .env          # عدّل DATABASE_URL و JWT_SECRET
node scripts/seed-dev.mjs     # بيانات تجريبية + جهاز فرع (يطبع التوكن مرة واحدة)
node scripts/dev.mjs          # http://127.0.0.1:8787  (الفحص: /health)
```
ويندوز: `start.bat`.

## ب) النشر على Cloudflare Workers
```bash
npx wrangler login
# عدّل wrangler.toml: SUPABASE_URL ، ALLOWED_ORIGINS (عنوان الإدارة والمتجر بالضبط) ، PUBLIC_API_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put JWT_SECRET            # 32+ حرفًا عشوائيًا
npx wrangler r2 bucket create erp-images      # لصور المنتجات
npx wrangler deploy
```
سيظهر عنوان مثل `https://erp-api.<حسابك>.workers.dev`: **هذا عنوان الـ API** الذي تضعه في بقية البرامج. الـ Cron المضمَّن يحرر حجوزات الطلبات المنتهية وينظف السجلات.

## إنشاء أول مدير (الإنتاج)
```bash
node scripts/create-owner.mjs --username owner --password "كلمة-سر-قوية"
```
لا تستخدم `seed-dev` في الإنتاج: كلمات سره معروفة.

## إنشاء أجهزة الفروع
من لوحة الإدارة ← الأجهزة. **التوكن يظهر مرة واحدة**؛ انسخه إلى `5-branch-pos` أو `6-backup-server`.

## الاختبارات
```bash
PGHOST=127.0.0.1 PGUSER=postgres node --test test/*.test.js
```
تحتاج مجلد `1-database` بجواره (أو متغير `DB_DIR`). تنشئ قاعدة مؤقتة وتحذفها.

## أعطال شائعة
| العرَض | الحل |
|---|---|
| `JWT_SECRET` ناقص أو قصير | اضبطه في `.env` أو `wrangler secret` |
| الإدارة تقول «تعذّر الاتصال» | `ALLOWED_ORIGINS` لا يطابق عنوان الإدارة بالضبط |
| خطأ بعد تعديل SQL | نفّذ في Supabase: `notify pgrst, 'reload schema';` |
