// Finishes "Connect Google Calendar" in Settings. Google sends her browser here after she says yes,
// with a one-time code. This swaps the code for a lasting refresh token (with her Google OAuth
// client, saved in Settings), keeps it in the owner-only connections table for athena/gcal.py,
// and sends her back to Settings. Deploy with "Verify JWT" turned off: Google's redirect carries
// no Supabase login, so the one-time state value she started with is what proves it is her.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SETTINGS = 'https://athenaprojectmanager.netlify.app/settings';
const back = (result: string) => Response.redirect(`${SETTINGS}?google=${encodeURIComponent(result)}`, 302);

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: st } = await db.from('connections').select('data').eq('key', 'google_state').maybeSingle();
  await db.from('connections').delete().eq('key', 'google_state');  // one use only
  const fresh = st?.data?.state && Date.now() - Number(st.data.at || 0) < 15 * 60 * 1000;
  if (!fresh || q.get('state') !== st.data.state) return back('expired');
  if (q.get('error')) return back(q.get('error') === 'access_denied' ? 'declined' : 'error');

  const { data: g } = await db.from('connections').select('data').eq('key', 'google').maybeSingle();
  const client = g?.data || {};
  if (!client.client_id || !client.client_secret) return back('no-client');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: q.get('code') ?? '', client_id: client.client_id, client_secret: client.client_secret,
      redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-oauth`, grant_type: 'authorization_code',
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.refresh_token) return back(tok.error === 'invalid_client' ? 'bad-client' : 'error');

  let email = null;
  try { email = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null; } catch { /* no id token */ }
  const { error } = await db.from('connections').update({
    data: { ...client, refresh_token: tok.refresh_token, email, connected_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq('key', 'google');
  return back(error ? 'error' : 'connected');
});
