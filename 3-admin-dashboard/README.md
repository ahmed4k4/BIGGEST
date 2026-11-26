# 3 — لوحة الإدارة

## ما هذا؟
واجهة صاحب المحل ومديري الفروع: المنتجات وقالب الأكواد، المخزن والتحويلات، الفواتير والتقارير، المستخدمون والأجهزة والصلاحيات، الحضور، طلبات الموقع. ملفات ثابتة (HTML/JS/CSS) بلا build.

## أين تُركَّب؟
على أي استضافة ملفات ثابتة — الأنسب مجانًا **Cloudflare Pages**. لا تُركَّب على جهاز الفرع.

## المتطلبات
`2-api` منشور ولديك عنوانه.

## التركيب
1. افتح `public/config.js` وضع عنوان الـ API:
   ```js
   window.ERP_CONFIG = { apiUrl: 'https://erp-api.xxx.workers.dev' };
   ```
2. انشر مجلد **`public`** كاملًا: في Cloudflare Pages ← Direct upload ← اسحب `public`، أو
   `npx wrangler pages deploy public --project-name biggest-admin`.
3. أضف عنوان الموقع النهائي إلى `ALLOWED_ORIGINS` في `2-api/wrangler.toml` ثم أعد `wrangler deploy`.

## تجربة محلية
```bash
node scripts/serve.mjs      # http://127.0.0.1:5173
```
ويندوز: `start.bat`. بعد `seed-dev` الدخول `owner` / `Owner#2026` (غيّرها فورًا). في الإنتاج استعمل المدير الذي أنشأته بـ `create-owner`.

## الهوية
الشعار في `public/assets/` (`logo-white.png` للخلفيات الداكنة، `logo-black.png` للفاتحة). استبدل الملفات بنفس الأسماء لتغيير الهوية.

## أعطال شائعة
- صفحة بيضاء: افتح Console؛ غالبًا `apiUrl` خاطئ أو CORS.
- الخط العربي يُحمَّل من Google Fonts؛ بدون إنترنت يُستبدل بخط النظام ولا يتعطل شيء.
