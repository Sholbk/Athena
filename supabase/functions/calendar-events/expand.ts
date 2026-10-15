// Expands one iCal file into the events and repeats that fall between two Mountain dates.
import IcalExpander from 'npm:ical-expander@3.2.0';

const TZ = 'America/Denver';
export type Ev = { title: string; start: string; end: string; allDay: boolean; date: string; calendar: string };

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// Every event and repeat of an event between from and to (YYYY-MM-DD, Mountain).
export function expand(ics: string, calendar: string, from: string, to: string): Ev[] {
  const lo = new Date(`${from}T00:00:00-07:00`);
  const hi = new Date(`${to}T23:59:59-06:00`);
  const { events, occurrences } = new IcalExpander({ ics, maxIterations: 2000 }).between(lo, hi);
  const out: Ev[] = [];
  const add = (summary: string, status: string, s: any, e: any) => {
    if (String(status || '').toUpperCase() === 'CANCELLED') return;
    const allDay = !!s.isDate;
    const date = allDay ? s.toString().slice(0, 10) : ymd.format(s.toJSDate());
    if (date < from || date > to) return;
    out.push({ title: summary || '(no title)', start: s.toJSDate().toISOString(), end: (e || s).toJSDate().toISOString(), allDay, date, calendar });
  };
  for (const e of events) add(e.summary, e.component.getFirstPropertyValue('status'), e.startDate, e.endDate);
  for (const o of occurrences) add(o.item.summary, o.item.component.getFirstPropertyValue('status'), o.startDate, o.endDate);
  return out;
}
