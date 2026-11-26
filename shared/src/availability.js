/** أوضاع مخزون الموقع (المتجر الإلكتروني). تغيير الوضع يحتاج تصريح السوبر أدمن. */
export const SITE_MODES = Object.freeze({
  MAIN_ONLY: 1,
  MAIN_PLUS_BRANCHES: 2,
  ALL: 3,
  SEPARATE: 4,
});

/**
 * التوفر = مجموع المواقع المسموح بها − المحجوز − هامش الأمان.
 * @param {object} p
 * @param {1|2|3|4} p.mode
 * @param {Record<string, number>} p.stock رصيد كل موقع لهذه القطعة
 * @param {string} p.mainId المخزن الرئيسي
 * @param {string} [p.webId] مخزون الموقع المنفصل
 * @param {string[]} [p.selectedLocations] للوضع 2
 */
export function computeAvailability({
  mode, stock, mainId, webId, selectedLocations = [], reserved = 0,
  safetyMargin = 0, hideUnavailable = false, lastThreshold = 3, allowPreorder = false,
}) {
  const qty = (id) => Math.max(0, stock[id] ?? 0);
  let base;
  switch (mode) {
    case SITE_MODES.MAIN_ONLY: base = qty(mainId); break;
    case SITE_MODES.MAIN_PLUS_BRANCHES:
      base = qty(mainId) + selectedLocations.filter((l) => l !== mainId).reduce((s, l) => s + qty(l), 0); break;
    case SITE_MODES.ALL: base = Object.keys(stock).reduce((s, id) => s + qty(id), 0); break;
    case SITE_MODES.SEPARATE: base = webId ? qty(webId) : 0; break;
    default: throw new RangeError('وضع مخزون غير معروف');
  }
  const available = Math.max(0, base - reserved - safetyMargin);
  let status = 'in';
  if (available <= 0) status = allowPreorder ? 'preorder' : 'out';
  else if (available <= lastThreshold) status = 'last';
  return { available, status, visible: !(hideUnavailable && status === 'out') };
}
