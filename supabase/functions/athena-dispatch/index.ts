// Starts the Athena workflow on GitHub after the app queues a message.
// The caller's own login is used to read the request, so only Stephanie can trigger a run.
// Needs one secret set in Supabase (Edge Functions > Secrets): GITHUB_DISPATCH_TOKEN,
// a fine-grained GitHub token with Contents read and write on Sholbk/Athena.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const REPO = 'Sholbk/Athena';
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

  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!token) return json(500, { error: 'GITHUB_DISPATCH_TOKEN is not set in Supabase Edge Function secrets.' });

  let requestId = '';
  try { requestId = (await req.json()).request_id; } catch { /* handled below */ }
  if (!requestId) return json(400, { error: 'request_id is required' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data, error } = await supabase.from('athena_requests').select('id,status').eq('id', requestId).maybeSingle();
  if (error || !data) return json(404, { error: 'No such request for this account.' });

  const gh = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'athena-dispatch',
    },
    body: JSON.stringify({ event_type: 'athena', client_payload: { request_id: requestId } }),
  });
  if (!gh.ok) return json(502, { error: `GitHub said ${gh.status}: ${(await gh.text()).slice(0, 300)}` });
  return json(200, { ok: true });
});
