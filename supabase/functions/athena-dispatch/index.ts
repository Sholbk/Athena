// Starts the Athena workflow on GitHub after the app queues a message or a job.
// Two callers:
//   - the app, with Stephanie's login. Her login is used to read the request, so only she can start a run.
//   - the database clock (athena_tick, through pg_net), with the public anon key. That caller can only
//     start a run for a scheduled job request that is still queued and was made in the last 15 minutes.
// The clock also asks for a vault sync every 15 minutes ({ vault_sync: true }), signed with the
// x-athena-key header that only Supabase Vault knows. That starts the Vault sync workflow.
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

  let body: { request_id?: string; vault_sync?: boolean } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (body.vault_sync) {
    if (!(await isClock(req.headers.get('x-athena-key') ?? ''))) return json(403, { error: 'Only the database clock can ask for a vault sync.' });
    return dispatch(token, 'vault-sync', {});
  }
  const requestId = body.request_id ?? '';
  if (!requestId) return json(400, { error: 'request_id is required' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data } = await supabase.from('athena_requests').select('id').eq('id', requestId).maybeSingle();
  if (!data && !(await isFreshJob(requestId))) return json(404, { error: 'No such request for this account.' });

  return dispatch(token, 'athena', { request_id: requestId });
});

async function dispatch(token: string, eventType: string, payload: Record<string, unknown>) {
  const gh = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'athena-dispatch',
    },
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });
  if (!gh.ok) return json(502, { error: `GitHub said ${gh.status}: ${(await gh.text()).slice(0, 300)}` });
  return json(200, { ok: true });
}

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// The database clock signs its vault sync calls with a key kept in Supabase Vault.
async function isClock(key: string) {
  if (!key) return false;
  const { data } = await admin().rpc('athena_cron_key_ok', { p_key: key });
  return data === true;
}

// A scheduled job the database clock just queued.
async function isFreshJob(id: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data } = await admin().from('athena_requests').select('id')
    .eq('id', id).eq('status', 'queued').not('job', 'is', null).gte('created_at', since).maybeSingle();
  return !!data;
}
