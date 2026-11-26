/** الأسماء العربية لكل الحالات والأدوار والإعدادات (مكان واحد لتوحيد المصطلحات). */
export const ROLE_LABEL = { super_admin: 'سوبر أدمن', admin: 'أدمن', branch_manager: 'مدير فرع', storekeeper: 'أمين مخزن', accountant: 'محاسب', cashier: 'كاشير' };
export const TRANSFER_STATUS = { draft: 'مسودة', approved: 'معتمد', preparing: 'قيد التجهيز', in_transit: 'في الطريق', partially_received: 'مستلم جزئيًا', completed: 'مكتمل', cancelled: 'ملغي' };
export const ORDER_STATUS = { pending: 'جديد', confirmed: 'مؤكد', preparing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي', returned: 'مرتجع' };
export const PAY_STATUS = { unpaid: 'غير مدفوع', paid: 'مدفوع', refunded: 'مسترد' };
export const PAY_METHOD = { cod: 'عند الاستلام', transfer: 'تحويل بنكي', instapay: 'إنستاباي', cash: 'نقدي', card: 'بطاقة' };
export const BRANCH_KIND = { main_warehouse: 'مخزن رئيسي', branch: 'فرع', web_stock: 'مخزون الموقع' };
export const MOVE_KIND = { receipt: 'إدخال بضاعة', sale: 'بيع', return_in: 'مرتجع', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', count_adjust: 'تسوية جرد', manual_adjust: 'تسوية يدوية' };
export const GRANT_STATUS = { pending: 'بانتظار الموافقة', approved: 'موافق عليه', rejected: 'مرفوض', used: 'مستخدم', expired: 'منتهٍ' };
export const COLOR_LABEL = { green: 'أخضر (في الموعد)', blue: 'أزرق (قبل الموعد/إضافي)', red: 'أحمر (تأخير/انصراف مبكر)' };
export const ACTION_LABEL = { notice: 'تنبيه', warning: 'إنذار', report_to_management: 'تقرير للإدارة' };
export const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const CASH_KIND = { expense: 'مصروف', income: 'إيراد', payment: 'دفعة', adjustment: 'تسوية' };

export const SITE_MODE_LABEL = { 1: 'المخزن الرئيسي فقط', 2: 'المخزن الرئيسي + فروع محددة', 3: 'كل المواقع', 4: 'مخزون منفصل للموقع' };

/** إعدادات لها قيمة (تظهر في صفحة الإعدادات): نوع الحقل والوصف. */
export const SETTING_META = {
  'shop.name': { label: 'اسم المتجر', type: 'text', group: 'المتجر' },
  'shop.whatsapp': { label: 'رقم واتساب الطلبات (بالصيغة الدولية بدون +)', type: 'text', group: 'المتجر' },
  'shop.shipping_piasters': { label: 'سعر الشحن (بالقروش)', type: 'number', group: 'المتجر' },
  'shop.payment_methods': { label: 'طرق الدفع المتاحة', type: 'json', group: 'المتجر', hint: 'قائمة مثل ["cod","transfer","instapay"]' },
  'site_stock.mode': { label: 'مصدر مخزون الموقع', type: 'select', options: SITE_MODE_LABEL, group: 'مخزون الموقع', hint: 'تغييره يحتاج تصريح السوبر أدمن' },
  'site_stock.safety_margin': { label: 'هامش الأمان (قطع لا تُعرض للمتجر)', type: 'number', group: 'مخزون الموقع' },
  'site_stock.last_threshold': { label: 'إظهار «آخر القطع» عند', type: 'number', group: 'مخزون الموقع' },
  'site_stock.hide_unavailable': { label: 'إخفاء الصنف غير المتوفر', type: 'bool', group: 'مخزون الموقع' },
  'site_stock.allow_preorder': { label: 'السماح بالطلب المسبق', type: 'bool', group: 'مخزون الموقع' },
  'general.currency': { label: 'العملة', type: 'text', group: 'عام' },
  'general.timezone': { label: 'المنطقة الزمنية', type: 'text', group: 'عام' },
  'tax.enabled': { label: 'تفعيل الضريبة', type: 'bool', group: 'الضرائب' },
  'tax.rate_pct': { label: 'نسبة الضريبة (%)', type: 'number', group: 'الضرائب' },
  'tax.inclusive': { label: 'الأسعار شاملة الضريبة', type: 'bool', group: 'الضرائب' },
  'discount.cashier_max_pct': { label: 'أقصى خصم يمنحه الكاشير (%)', type: 'number', group: 'الفواتير والمرتجعات' },
  'returns.max_days': { label: 'مهلة المرتجع (أيام)', type: 'number', group: 'الفواتير والمرتجعات' },
  'invoice.max_reprints': { label: 'أقصى عدد لإعادة طباعة الفاتورة', type: 'number', group: 'الفواتير والمرتجعات' },
  'offline.max_qty_per_item': { label: 'أقصى كمية للصنف عند انقطاع الاتصال', type: 'number', group: 'الفروع' },
  'customers.cashier_visible_digits': { label: 'أرقام هاتف العميل الظاهرة للكاشير', type: 'number', group: 'الفروع' },
  'sync.poll_seconds': { label: 'فترة مزامنة الفروع (ثانية)', type: 'number', group: 'الفروع' },
  'usage.warn_pct': { label: 'تنبيه استهلاك الخدمات عند (%)', type: 'number', group: 'الاستهلاك' },
  'usage.critical_pct': { label: 'تنبيه حرج عند (%)', type: 'number', group: 'الاستهلاك' },
  'attendance.rules': { label: 'قواعد النقاط والحدود (الحضور)', type: 'json', group: 'الحضور', hint: 'ألوان ونقاط وحدود الإجراءات. النظام يحسب فقط ولا يخصم من الراتب.' },
};

/** عمليات حسّاسة لها مستوى (حر / تصريح / سوبر). */
export const GATE_LABEL = {
  'site_stock.mode': 'تغيير مصدر مخزون الموقع', 'code_template.structure': 'تغيير بنية قالب الكود بعد طباعة ملصقات',
  'invoice.fiscal_fields': 'تغيير الحقول الضريبية في الفاتورة', 'sales.edit_posted': 'تعديل فاتورة مرحّلة', 'sales.hard_delete': 'حذف نهائي لفاتورة',
  'discount.over_limit': 'خصم أو تعديل سعر فوق الحد', 'attendance.edit_closed_month': 'تعديل حضور شهر مغلق', 'users.change_admin': 'إنشاء أو تغيير مستخدم أدمن',
  'device.register': 'تسجيل جهاز جديد', 'backup.restore': 'استعادة نسخة احتياطية', 'customers.export': 'تصدير بيانات العملاء',
  'settings.restore_version': 'استرجاع نسخة قديمة من إعداد', 'settings.levels': 'تغيير مستويات الإعدادات', 'grants.decide': 'الموافقة على التصاريح',
};
export const LEVEL_LABEL = { free: 'حر', grant: 'بتصريح', super: 'سوبر أدمن فقط' };
