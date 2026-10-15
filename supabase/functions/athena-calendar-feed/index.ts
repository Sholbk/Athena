// Her posting days as a calendar Google Calendar can subscribe to (Settings, "Posting days").
// Google fetches this link with no login, so the link carries a secret token, checked against the
// connections table. Each content piece with a target date is an all-day event on that date.
// Deploy with "Verify JWT" turned off. Read only: Google cannot change anything through it.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const APP = 'https://athenaprojectmanager.netlify.app/marketing';

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('GET only', { status: 405 });
  const token = new URL(req.url).searchParams.get('k') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: feed } = await db.from('connections').select('data').eq('key', 'calendar_feed').maybeSingle();
  const want = String(feed?.data?.token ?? '');
  if (!want || !same(token, want)) return new Response('Not found', { status: 404 });

  const { data: rows, error } = await db.from('content')
    .select('id,title,status,channel,target_date,body,cta,updated_at')
    .is('deleted_at', null).not('target_date', 'is', null).neq('status', 'Skipped')
    .order('target_date', { ascending: true });
  if (error) return new Response('Could not read the posts', { status: 500 });

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Athena//Posting days//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Athena posts', 'X-WR-TIMEZONE:America/Denver', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const r of rows || []) {
    const day = String(r.target_date).replace(/-/g, '');
    const posted = r.status === 'Shipped';
    const what = `${posted ? 'Posted' : 'Post'}${r.channel ? ` on ${r.channel}` : ''}: ${r.title}`;
    const about = [`Status: ${r.status}`, r.body ? `\n${String(r.body).slice(0, 1500)}` : '', `\nOpen it in Athena: ${APP}`].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@athena`,
      `DTSTAMP:${stamp(r.updated_at)}`,
      `LAST-MODIFIED:${stamp(r.updated_at)}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${nextDay(r.target_date)}`,
      `SUMMARY:${esc(what)}`,
      `DESCRIPTION:${esc(about)}`,
      `URL:${APP}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const body = lines.map(fold).join('\r\n') + '\r\n';
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="athena-posts.ics"' },
  });
});

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const stamp = (t: string) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function nextDay(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes continue on the next line after a space (RFC 5545).
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
