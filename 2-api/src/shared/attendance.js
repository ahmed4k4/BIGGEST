/**
 * الحضور والانصراف: ألوان ونقاط. النظام يحسب فقط ولا يخصم من الراتب تلقائيًا.
 * كل الأوقات بالدقائق من منتصف الليل (بتوقيت المحل) لتفادي أخطاء المناطق الزمنية.
 */

export const DEFAULT_RULES = {
  colors: { green: { points: 1 }, blue: { points: 0 }, red: { points: -2 } },
  unexcusedAbsencePoints: -4,
  excusedAbsencePoints: 0,
  period: 'monthly', // monthly | cumulative
  thresholds: [
    { at: -2, action: 'notice' },
    { at: -6, action: 'warning' },
    { at: -10, action: 'report_to_management' },
  ],
  autoDeductSalary: false,
};

export const hhmmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  if (!m) throw new RangeError('وقت غير صالح، الصيغة HH:MM');
  return Number(m[1]) * 60 + Number(m[2]);
};

/** الدقائق من منتصف الليل بتوقيت معيّن. */
export function minutesOfDay(date, timeZone = 'Africa/Cairo') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

const make = (color, rules, minutesDiff, label) => ({ color, points: rules.colors[color].points, minutesDiff, label });

/**
 * @param {{startMin:number, endMin:number, graceLateMin?:number}} shift
 * @param {number} minute وقت الدخول بالدقائق
 */
export function classifyCheckIn(shift, minute, rules = DEFAULT_RULES) {
  const grace = shift.graceLateMin ?? 0;
  const diff = minute - shift.startMin;
  if (diff < 0) return make('blue', rules, diff, 'قبل الموعد');
  if (diff <= grace) return make('green', rules, diff, 'في الموعد');
  return make('red', rules, diff, 'متأخر');
}

/**
 * @param {{startMin:number, endMin:number, graceEarlyLeaveMin?:number, graceLateLeaveMin?:number}} shift
 */
export function classifyCheckOut(shift, minute, rules = DEFAULT_RULES) {
  let end = shift.endMin;
  let m = minute;
  if (end <= shift.startMin) { // وردية تعبر منتصف الليل
    end += 1440;
    if (m < shift.startMin) m += 1440;
  }
  const early = shift.graceEarlyLeaveMin ?? 0;
  const late = shift.graceLateLeaveMin ?? 0;
  if (m < end - early) return make('red', rules, m - end, 'انصراف مبكر');
  if (m <= end + late) return make('green', rules, m - end, 'في الموعد');
  return make('blue', rules, m - end, 'وقت إضافي');
}

/** مجموع نقاط فترة. events: [{color}] + غيابات. */
export function scorePeriod({ events = [], unexcusedAbsences = 0, excusedAbsences = 0 }, rules = DEFAULT_RULES) {
  const fromEvents = events.reduce((s, e) => s + (rules.colors[e.color]?.points ?? 0), 0);
  return fromEvents + unexcusedAbsences * rules.unexcusedAbsencePoints + excusedAbsences * rules.excusedAbsencePoints;
}

/** أشد إجراء تنطبق حدوده على النقاط (القيم السالبة: أقل = أشد). */
export function evaluateThresholds(score, rules = DEFAULT_RULES) {
  const hit = rules.thresholds.filter((t) => score <= t.at).sort((a, b) => a.at - b.at)[0];
  return hit ? hit.action : null;
}

/** تسجيل جديد غير مسموح لو الموظف سجّل دخولًا بدون انصراف (أو العكس). */
export function nextExpectedEvent(lastEvent) {
  return !lastEvent || lastEvent.kind === 'out' ? 'in' : 'out';
}
