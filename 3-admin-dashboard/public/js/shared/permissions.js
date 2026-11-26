/** الأدوار والصلاحيات ومستويات الإعدادات (حر / يحتاج تصريحًا / للسوبر أدمن فقط). */

export const ROLES = Object.freeze(['super_admin', 'admin', 'branch_manager', 'storekeeper', 'accountant', 'cashier']);

const ALL = '*';
export const ROLE_PERMISSIONS = Object.freeze({
  super_admin: [ALL],
  admin: [
    'sales.create', 'sales.view', 'returns.create', 'customers.view', 'customers.create', 'customers.full', 'customers.export',
    'stock.receive', 'stock.transfer', 'stock.count', 'models.manage', 'codes.manage', 'settings.manage',
    'finance.view', 'finance.manage', 'attendance.record', 'attendance.manage', 'reports.view',
    'users.manage', 'devices.manage', 'orders.manage', 'discount.high', 'grants.request', 'audit.view',
  ],
  branch_manager: [
    'sales.create', 'sales.view', 'returns.create', 'customers.view', 'customers.create', 'customers.full',
    'stock.count', 'stock.transfer.receive', 'attendance.record', 'attendance.manage.branch', 'reports.view.branch', 'discount.high',
  ],
  storekeeper: ['stock.receive', 'stock.transfer', 'stock.transfer.receive', 'stock.count', 'reports.view.stock'],
  accountant: ['finance.view', 'finance.manage', 'reports.view', 'sales.view'],
  cashier: ['sales.create', 'sales.view.own', 'returns.create', 'customers.view', 'customers.create', 'attendance.record'],
});

export function can(role, permission) {
  const list = ROLE_PERMISSIONS[role];
  if (!list) return false;
  return list.includes(ALL) || list.includes(permission);
}

/** مستويات الإعدادات الافتراضية. السوبر أدمن وحده يغيّر هذه المستويات. */
export const SETTING_LEVELS = Object.freeze({
  'site_stock.mode': 'grant',
  'code_template.structure': 'grant',
  'invoice.fiscal_fields': 'grant',
  'sales.edit_posted': 'grant',
  'sales.hard_delete': 'super',
  'discount.over_limit': 'grant',
  'attendance.edit_closed_month': 'grant',
  'users.change_admin': 'grant',
  'device.register': 'grant',
  'backup.restore': 'grant',
  'customers.export': 'grant',
  'settings.restore_version': 'grant',
  'settings.levels': 'super',
  'grants.decide': 'super',
});

export const levelOf = (key, overrides = {}) => overrides[key] ?? SETTING_LEVELS[key] ?? 'free';

export const DEFAULT_SETTINGS = Object.freeze({
  'general.currency': 'EGP',
  'general.timezone': 'Africa/Cairo',
  'tax.rate_pct': 14,
  'tax.inclusive': true,
  'tax.enabled': false,
  'discount.cashier_max_pct': 10,
  'returns.max_days': 14,
  'invoice.max_reprints': 3,
  'offline.max_qty_per_item': 5,
  'customers.cashier_visible_digits': 4,
  'site_stock.mode': 1,
  'site_stock.safety_margin': 1,
  'site_stock.last_threshold': 3,
  'site_stock.hide_unavailable': false,
  'site_stock.allow_preorder': false,
  'sync.poll_seconds': 300,
  'usage.warn_pct': 70,
  'usage.critical_pct': 90,
});
