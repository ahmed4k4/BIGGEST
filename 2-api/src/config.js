/** قراءة الإعدادات من المتغيرات. على Workers تأتي من env، وعلى Node من process.env. */
export function readConfig(env) {
  const need = (k) => { if (!env[k]) throw new Error(`المتغير ${k} مطلوب`); return env[k]; };
  const jwtSecret = need('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET يجب ألا يقل عن 32 حرفًا');
  return {
    companyId: need('COMPANY_ID'),
    jwtSecret,
    sessionHours: Number(env.SESSION_HOURS ?? 8),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()),
    publicApiUrl: env.PUBLIC_API_URL ?? '',
    whatsapp: env.SHOP_WHATSAPP ?? '',
  };
}
