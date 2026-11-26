# 6 — سيرفر النسخ الاحتياطي والتصدير

## ما هذا؟
برنامج صغير يعمل باستمرار على جهاز مكتبي: ينسخ قاعدة البيانات احتياطيًا (pg_dump) ويتحقق من سلامة النسخة باستعادتها في قاعدة مؤقتة، ويدوّر النسخ (7 يومية / 4 أسبوعية / 12 شهرية)، ويصدّر تقرير Excel أسبوعيًا، ويراقب الاتصال.

## أين يُركَّب؟
على **جهاز في المحل أو المكتب** يبقى شغالًا (يفضّل ليس جهاز الكاشير)، وبه قرص يتسع للنسخ.

## المتطلبات
- Node.js 22.13+.
- أدوات PostgreSQL: `pg_dump` و`pg_restore` و`psql` (من PostgreSQL client، نسخة مساوية أو أحدث من نسخة Supabase).
- Direct connection من Supabase وجهاز منشأ بنوع `server_agent` من لوحة الإدارة.

## التركيب
1. انسخ المجلد إلى الجهاز (مثلًا `D:\BIGGEST\backup`).
2. انسخ `.env.example` إلى `.env` واملأ `SOURCE_DATABASE_URL` (اتصال Supabase المباشر) و`CLOUD_URL` و`DEVICE_TOKEN` و`BACKUP_DIR` (يفضَّل قرص خارجي). اختياريًا `ADMIN_DATABASE_URL` لاختبار استعادة كل نسخة تلقائيًا، و`ALERT_WEBHOOK` للتنبيهات.
3. شغّل `start.bat` (لينكس: `./start.sh`) وأبقِ النافذة تعمل، أو ضعه في بدء التشغيل.
4. لنسخة فورية الآن: `backup-now.bat`.

## الاستعادة
```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" مسار-النسخة.dump
```
جرّب الاستعادة على قاعدة اختبار مرة قبل أن تحتاجها فعلًا.

## الاختبارات
```bash
node --test test/*.test.js
```

## أعطال شائعة
| العرَض | الحل |
|---|---|
| `pg_dump` غير موجود | ثبّت PostgreSQL client وأضفه إلى PATH |
| `server version mismatch` | استخدم نسخة pg_dump مساوية أو أحدث من الخادم |
| لا يصدّر Excel | تأكد من `CLOUD_URL` والتوكن (نوع `server_agent`) |
