# 4 — المتجر الإلكتروني

## ما هذا؟
متجر العملاء (موبايل أولًا): تصفح، اختيار اللون والمقاس، سلة، طلب بالدفع عند الاستلام، وتتبع الطلب. ملفات ثابتة بلا build.

## أين يُركَّب؟
على استضافة ملفات ثابتة — الأنسب مجانًا **Cloudflare Pages** (يمكن ربطه بدومين المحل). لا يُركَّب على جهاز الفرع.

## المتطلبات
`2-api` منشور ولديك عنوانه. المنتجات تظهر بعد إضافتها من الإدارة ووضع بضاعة في «مخزون الموقع».

## التركيب
1. افتح `public/config.js`:
   ```js
   window.SHOP_CONFIG = { apiUrl: 'https://erp-api.xxx.workers.dev', returnsPolicy: '' };
   ```
2. انشر مجلد **`public`**: Cloudflare Pages ← Direct upload، أو
   `npx wrangler pages deploy public --project-name biggest-shop`.
3. أضف عنوان المتجر إلى `ALLOWED_ORIGINS` في `2-api/wrangler.toml` ثم أعد `wrangler deploy`.

## تجربة محلية
```bash
node scripts/serve.mjs      # http://127.0.0.1:5174
```
ويندوز: `start.bat`.

## الهوية
الشعار في `public/assets/`. اسم المتجر من الإدارة ← الإعدادات.

## أعطال شائعة
- لا منتجات: تأكد أن للموديل صورة/سعر وأن «مخزون الموقع» به كمية.
- خطأ CORS: `ALLOWED_ORIGINS` لا يطابق العنوان.
