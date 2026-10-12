// Every date shows in Mountain time. Plain YYYY-MM-DD strings are treated as calendar days.
export const TZ = 'America/Denver';

const fParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function ymdOf(d) {
  const p = fParts.formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export const todayYMD = () => ymdOf(new Date());
const utc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export function addDays(ymd, n) { const t = utc(ymd); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export const mondayOf = (ymd) => addDays(ymd, -((utc(ymd).getUTCDay() + 6) % 7));
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 86400000);

const fDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const fLong = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const fMD = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const fHour = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
export const dayLabel = (ymd) => fDay.format(utc(ymd));
export const longLabel = (ymd) => fLong.format(utc(ymd));
export const mdLabel = (ymd) => (ymd ? fMD.format(utc(ymd)) : '');

export function dueText(due) {
  if (!due) return 'No date';
  const d = diffDays(due, todayYMD());
  if (d === 0) return 'Due today';
  if (d === -1) return '1 day late';
  if (d < 0) return `${-d} days late`;
  if (d === 1) return 'Tomorrow';
  return dayLabel(due);
}
export function greeting() {
  const hr = Number(fHour.format(new Date()));
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}
export const hrs = (n) => `${Math.round(Number(n || 0) * 100) / 100} hr`;
