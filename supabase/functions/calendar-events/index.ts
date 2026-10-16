// Returns Stephanie's calendar events for a date range, for the Week page.
// Google's private iCal links cannot be read from the browser (no CORS), so this reads them here.
// Her login is used to read calendar_feeds, so only she gets anything back. Links never leave this function.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { expand, type Ev } from './expand.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let from = '', to = '';
  try { ({ from, to } = await req.json()); } catch { /* handled below */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json(400, { error: 'from and to are required, as YYYY-MM-DD' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: feeds, error } = await supabase.from('calendar_feeds').select('name,ical_url').eq('enabled', true);
  if (error) return json(401, { error: 'Sign in again to see your calendar.' });

  const events: Ev[] = [];
  const problems: string[] = [];
  // The same link added twice is read once.
  const unique = [...new Map((feeds || []).map((f) => [f.ical_url, f])).values()];
  await Promise.all(unique.map(async (f) => {
    try {
      const r = await fetch(f.ical_url, { headers: { 'User-Agent': 'Athena calendar reader' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      events.push(...expand(await r.text(), f.name, from, to));
    } catch (e) {
      // Network errors can quote the private link, so only an HTTP status is passed on.
      const why = e instanceof Error && /^HTTP \d+$/.test(e.message) ? e.message : 'could not connect';
      problems.push(`The ${f.name} calendar could not be read (${why}).`);
    }
  }));
  events.sort((a, b) => (a.date + (a.allDay ? '0' : '1') + a.start).localeCompare(b.date + (b.allDay ? '0' : '1') + b.start));
  return json(200, { linked: unique.length > 0, events, problems });
});
