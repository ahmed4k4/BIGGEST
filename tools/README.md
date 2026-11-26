# tools — أدوات المطوّر (ليست للتركيب)

| الأمر | وظيفته |
|---|---|
| `node tools/sync-shared.mjs` | ينسخ `shared/src` إلى `src/shared` داخل كل مشروع (شغّله بعد أي تعديل في shared) |
| `node tools/check-syntax.mjs` | فحص صياغة كل ملفات JS |
| `node tools/run-tests.mjs` | كل الاختبارات (تحتاج PostgreSQL: `PGHOST PGPORT PGUSER PGPASSWORD`) |
| `node tools/dev-all.mjs` | تشغيل API + الإدارة + المتجر محليًا |
| `node tools/make-zip.mjs` | يبني `dist/BIGGEST-v1.0.0.zip` بدون `.env` أو بيانات |
| `integration/` | اختبارات تكامل الفرع والنسخ، واختبارات المتصفح (Playwright) |
