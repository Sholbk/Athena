// Settings > Granola: connects Granola straight to the app with Granola's standard sign-in, the
// same one the Obsidian Granola add-on uses. The page registers itself with Granola, sends her to
// Granola to say yes, then swaps the one-time code for a lasting sign-in and saves it in the
// owner-only connections table (key granola). athena/granola.py, in the Vault sync run every
// 15 minutes, uses it to bring new calls into the Meetings folder. Read only in Granola.
//
// Granola answers at /granola-callback.html (public/), which passes the answer on to Settings
// as granola_code, granola_state and granola_error. A plain ?error_description in the app's own
// address would make the Supabase client think a sign-in failed and sign her out.
import { supabase } from './supabase.js';

const AUTH = 'https://mcp-auth.granola.ai/oauth2';
const RESOURCE = 'https://mcp.granola.ai/mcp';
const SCOPE = 'openid email profile offline_access mcp';
const FRESH_MS = 15 * 60 * 1000;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function startGranola() {
  const redirect_uri = `${window.location.origin}/granola-callback.html`;
  const r = await fetch(`${AUTH}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Athena', redirect_uris: [redirect_uri], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
  }).catch(() => null);
  const reg = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !reg.client_id) throw new Error('Granola did not answer. Try again in a minute.');

  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = random(24);
  const { error } = await supabase.from('connections').upsert({
    key: 'granola_state', data: { state, verifier, client_id: reg.client_id, redirect_uri, at: Date.now() },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  const q = new URLSearchParams({
    response_type: 'code', client_id: reg.client_id, redirect_uri, code_challenge: challenge,
    code_challenge_method: 'S256', state, scope: SCOPE, resource: RESOURCE, prompt: 'consent',
  });
  window.location.assign(`${AUTH}/authorize?${q}`);
}

// When Settings opens with Granola's answer, finish connecting. Returns connected, declined,
// expired or error, or null when the address holds no Granola answer.
let finishing = null;
export function finishGranola(params) {
  if (!params.get('granola_state')) return Promise.resolve(null);
  finishing ??= finish(params);  // once, even if the page runs its effects twice
  return finishing;
}

async function finish(params) {
  const { data: st } = await supabase.from('connections').select('data').eq('key', 'granola_state').maybeSingle();
  await supabase.from('connections').delete().eq('key', 'granola_state');  // one use only
  const s = st?.data;
  if (!s?.state || s.state !== params.get('granola_state') || Date.now() - Number(s.at || 0) > FRESH_MS) return 'expired';
  if (params.get('granola_error')) return params.get('granola_error') === 'access_denied' ? 'declined' : 'error';
  if (!params.get('granola_code')) return 'error';

  const r = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: params.get('granola_code'), redirect_uri: s.redirect_uri,
      client_id: s.client_id, code_verifier: s.verifier, resource: RESOURCE,
    }),
  }).catch(() => null);
  const tok = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !tok.refresh_token) {
    // For fixing a failed connect from the browser console: the answer's field names, never values.
    console.warn('Granola token answer', r?.status ?? 'no answer', Object.keys(tok), tok.error || '');
    return 'error';
  }

  let email = null;
  try { email = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null; } catch { /* no id token */ }
  // A reconnect keeps the list of calls already handled, so nothing comes in twice.
  const { data: old } = await supabase.from('connections')
    .select('seen:data->seen,saved_total:data->saved_total').eq('key', 'granola').maybeSingle();
  const at = new Date();
  const { error } = await supabase.from('connections').upsert({
    key: 'granola',
    data: {
      client_id: s.client_id, refresh_token: tok.refresh_token, access_token: tok.access_token,
      expires_at: new Date(at.getTime() + Number(tok.expires_in || 3600) * 1000).toISOString(),
      email, connected_at: at.toISOString(), status: 'new', seen: old?.seen || {}, saved_total: Number(old?.saved_total || 0),
    },
    updated_at: at.toISOString(),
  });
  return error ? 'error' : 'connected';
}
