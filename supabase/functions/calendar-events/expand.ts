// Expands one iCal file into the events and repeats that fall between two Mountain dates.
import IcalExpander from 'npm:ical-expander@3.2.0';

const TZ = 'America/Denver';
export type Ev = { title: string; start: string; end: string; allDay: boolean; date: string; calendar: string };

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// Every event and repeat of an event between from and to (YYYY-MM-DD, Mountain).
export function expand(ics: string, calendar: string, from: string, to: string): Ev[] {
  const lo = new Date(`${from}T00:00:00-07:00`);
  const hi = new Date(`${to}T23:59:59-06:00`);
  const { events, occurrences } = new IcalExpander({ ics: trim(ics, from, to), maxIterations: 5000 }).between(lo, hi);
  const out: Ev[] = [];
  const seen = new Set<string>();
  const add = (summary: string, status: string, s: any, e: any) => {
    if (String(status || '').toUpperCase() === 'CANCELLED') return;
    const allDay = !!s.isDate;
    const date = allDay ? s.toString().slice(0, 10) : ymd.format(s.toJSDate());
    if (date < from || date > to) return;
    // A changed repeat comes back both as an event and as a repeat. Show it once.
    const key = `${summary}|${s.toString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: summary || '(no title)', start: s.toJSDate().toISOString(), end: (e || s).toJSDate().toISOString(), allDay, date, calendar });
  };
  for (const e of events) add(e.summary, e.component.getFirstPropertyValue('status'), e.startDate, e.endDate);
  for (const o of occurrences) add(o.item.summary, o.item.component.getFirstPropertyValue('status'), o.startDate, o.endDate);
  return out;
}

// A calendar with years of events is too much to parse whole on Supabase's free plan, so only the
// events that can touch the range are kept: one-off events near it, repeats still running, and
// changed repeats (RECURRENCE-ID) near it. Two days of margin cover time zones.
function trim(ics: string, from: string, to: string) {
  const lo = shift(from, -2), hi = shift(to, 2);
  const first = ics.indexOf('BEGIN:VEVENT');
  if (first < 0) return ics;
  const last = ics.lastIndexOf('END:VEVENT') + 'END:VEVENT'.length;
  const keep: string[] = [];
  const START = /^DTSTART[^:\r\n]*:(\d{8})/m, MOVED = /^RECURRENCE-ID[^:\r\n]*:(\d{8})/m;
  const RULE = /^RRULE[;:]/m, UNTIL = /^RRULE[;:].*UNTIL=(\d{8})/m;
  for (const block of ics.slice(first, last).split(/(?=BEGIN:VEVENT)/)) {
    const flat = block.replace(/\r?\n[ \t]/g, '');
    const start = flat.match(START)?.[1];
    if (!start) continue;
    if (RULE.test(flat)) {
      const until = flat.match(UNTIL)?.[1];
      if (start <= hi && (!until || until >= lo)) keep.push(block);
    } else {
      const moved = flat.match(MOVED)?.[1];
      if ((start >= lo && start <= hi) || (moved && moved >= lo && moved <= hi)) keep.push(block);
    }
  }
  const body = keep.map((b) => b.replace(/\s+$/, '')).join('\r\n');
  return ics.slice(0, first) + body + (body ? ics.slice(last) : ics.slice(last).replace(/^\s+/, ''));
}

// YYYY-MM-DD plus n days, as YYYYMMDD.
function shift(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
