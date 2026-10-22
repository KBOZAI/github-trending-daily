// Number and date formatting. Data dates are UTC calendar dates (YYYY-MM-DD).

const NF = new Intl.NumberFormat('zh-CN');
const DAY = 864e5;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const int = (n) => (n == null ? '–' : NF.format(n));

function trimmed(value, digits) {
  return Number(value.toFixed(digits)).toString();
}

/** 353813 → 35.4万, 9707 → 9,707 */
export function compact(n) {
  if (n == null) return '–';
  const a = Math.abs(n);
  if (a >= 1e8) return `${trimmed(n / 1e8, 2)}亿`;
  if (a >= 1e4) return `${trimmed(n / 1e4, a >= 1e6 ? 0 : 1)}万`;
  return NF.format(n);
}

export const signed = (n) => (n == null ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${NF.format(Math.abs(n))}`);
export const signedCompact = (n) => (n == null ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${compact(Math.abs(n))}`);
export const percent = (x, digits = 0) => (x == null ? '–' : `${trimmed(x * 100, digits)}%`);

export const toTime = (date) => Date.parse(`${date}T00:00:00Z`);
export const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (date, n) => fromTime(toTime(date) + n * DAY);
export const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);

export function dateParts(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}
export const md = (date) => { const { m, d } = dateParts(date); return `${m}月${d}日`; };
export const longDate = (date) => { const { y, m, d } = dateParts(date); return `${y}年${m}月${d}日`; };
export const shortDate = (date) => date.slice(5);
export const weekday = (date) => WEEKDAYS[new Date(toTime(date)).getUTCDay()];
export const yearMonth = (month) => { const [y, m] = month.split('-'); return `${y}年${Number(m)}月`; };

/** Capture timestamps are shown in Beijing time, the site's primary audience. */
export function beijing(iso, withDate = true) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const time = `${get('hour')}:${get('minute')}`;
  return withDate ? `${get('month')}月${get('day')}日 ${time}` : time;
}

export function ago(date, today) {
  const n = daysBetween(date, today);
  if (n <= 0) return '今天';
  if (n === 1) return '昨天';
  if (n < 31) return `${n} 天前`;
  if (n < 365) return `${Math.round(n / 30.4)} 个月前`;
  return `${trimmed(n / 365, 1)} 年前`;
}

/** Repository age as a short phrase: 12 天 / 6 个月 / 2.5 年 */
export function age(created, today) {
  const n = daysBetween(created, today);
  if (n < 0) return '';
  if (n < 61) return `${n} 天`;
  if (n < 365) return `${Math.round(n / 30.4)} 个月`;
  return `${trimmed(n / 365, n < 3650 ? 1 : 0)} 年`;
}
