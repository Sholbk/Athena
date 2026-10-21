// Send to Blotato, from the content drawer. Runs with Stephanie's login, so row security proves
// it is her, and reads her Blotato key from Settings (connections key blotato) without ever
// sending it to the browser. Four actions, all POST with JSON:
//   { action: 'accounts' }                                  her Blotato accounts and LinkedIn pages
//   { action: 'post', content_id, choices, scheduledTime? } upload the piece's media, one post per choice
//   { action: 'check', content_id }                          refresh each send's state from Blotato
//   { action: 'cancel', submission_id }                      take a scheduled send off Blotato's queue
// Athena (the Claude runs) never calls this. Every send starts with her click in the drawer.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const API = 'https://backend.blotato.com/v2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const OPEN = ['in-progress', 'scheduled'];

type Choice = { accountId: string; platform: string; pageId: string | null; label: string };
type Sub = { id: string; content_id: string; account_id: string; platform: string; page_id: string | null; account_name: string | null;
  submission_id: string; scheduled_time: string | null; status: string; public_url: string | null; error: string | null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'Send JSON.' }); }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: conn, error: cErr } = await db.from('connections').select('data').eq('key', 'blotato').maybeSingle();
  if (cErr) return json(401, { error: 'Sign in again to reach Blotato.' });
  const key = (conn?.data?.token || '').trim();
  if (!key) return json(404, { error: 'Blotato is not connected yet. Paste your Blotato API key in Settings.' });
  const blotato = (method: string, path: string, payload?: unknown) =>
    fetch(API + path, { method, headers: { 'blotato-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });

  try {
    switch (body.action) {
      case 'accounts': return json(200, { items: await accounts(blotato) });
      case 'post': return json(200, await post(db, blotato, body));
      case 'check': return json(200, await check(db, blotato, String(body.content_id || '')));
      case 'cancel': return json(200, await cancel(db, blotato, String(body.submission_id || '')));
      default: return json(400, { error: 'action is accounts, post, check or cancel' });
    }
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 300) : 'something broke';
    return json(502, { error: why });
  }
});

async function say(r: Response) {
  let msg = `HTTP ${r.status}`;
  try { const j = await r.json(); msg = j.message || j.error || (typeof j === 'string' ? j : msg); if (j.details && typeof j.details === 'object') msg += ` (${JSON.stringify(j.details).slice(0, 160)})`; } catch { /* no body */ }
  return `Blotato said: ${msg}`;
}

async function accounts(blotato: (m: string, p: string, b?: unknown) => Promise<Response>) {
  const r = await blotato('GET', '/users/me/accounts');
  if (!r.ok) throw new Error(await say(r));
  const items = ((await r.json()).items || []) as { id: string; platform: string; fullname: string; username: string }[];
  const out = [];
  for (const a of items) {
    let subaccounts: { id: string; name: string }[] = [];
    if (a.platform === 'linkedin') {
      const s = await blotato('GET', `/users/me/accounts/${encodeURIComponent(a.id)}/subaccounts`);
      if (s.ok) subaccounts = ((await s.json()).items || []).map((p: { id: string; name: string }) => ({ id: String(p.id), name: p.name }));
    }
    out.push({ id: String(a.id), platform: a.platform, fullname: a.fullname || '', username: a.username || '', subaccounts });
  }
  return out;
}

async function post(db: any, blotato: (m: string, p: string, b?: unknown) => Promise<Response>, body: Record<string, any>) {
  const contentId = String(body.content_id || '');
  const choices = (Array.isArray(body.choices) ? body.choices : []) as Choice[];
  const scheduledTime = body.scheduledTime ? String(body.scheduledTime) : null;
  if (!contentId || choices.length === 0) throw new Error('content_id and at least one choice are required.');
  if (scheduledTime && (Number.isNaN(Date.parse(scheduledTime)) || Date.parse(scheduledTime) < Date.now() + 60_000)) throw new Error('The schedule time must be at least a minute from now.');
  const { data: piece, error: pErr } = await db.from('content').select('id,title,body,status').eq('id', contentId).is('deleted_at', null).maybeSingle();
  if (pErr || !piece) throw new Error('That post was not found.');
  const text = String(piece.body || '').trim();
  if (!text) throw new Error('The post has no caption yet.');
  if (/[—–]/.test(text)) throw new Error('The caption has a dash. Fix it first.');

  const { data: files } = await db.from('media').select('id,path,mime,blotato_url').eq('content_id', contentId).is('deleted_at', null).order('created_at', { ascending: true });
  const mediaUrls: string[] = [];
  for (const f of files || []) {
    if (f.blotato_url) { mediaUrls.push(f.blotato_url); continue; }
    const { data: signed, error: sErr } = await db.storage.from('media').createSignedUrl(f.path, 3600);
    if (sErr || !signed?.signedUrl) throw new Error('Could not make a link for one of the images.');
    const up = await blotato('POST', '/media', { url: signed.signedUrl });
    if (!up.ok) throw new Error(`Upload failed. ${await say(up)}`);
    const url = (await up.json()).url;
    if (!url) throw new Error('Blotato did not return a link for an image.');
    await db.from('media').update({ blotato_url: url, updated_at: new Date().toISOString() }).eq('id', f.id);
    mediaUrls.push(url);
  }

  const { data: open } = await db.from('post_submissions').select('account_id,page_id,status').eq('content_id', contentId).is('deleted_at', null).in('status', OPEN);
  const results = [];
  for (const c of choices) {
    const already = (open || []).some((s: Sub) => s.account_id === String(c.accountId) && (s.page_id || null) === (c.pageId || null));
    if (already) { results.push({ label: c.label, status: 'skipped', error: 'Already sent to this account and still in progress or scheduled.' }); continue; }
    if (c.platform === 'instagram' && mediaUrls.length === 0) { results.push({ label: c.label, status: 'skipped', error: 'Instagram needs an image or video.' }); continue; }
    if (c.platform === 'twitter' && text.length > 280) { results.push({ label: c.label, status: 'skipped', error: 'Over 280 characters for X.' }); continue; }
    const target: Record<string, unknown> = { targetType: c.platform };
    if (c.platform === 'linkedin' && c.pageId) target.pageId = String(c.pageId);
    if (c.platform === 'instagram' && mediaUrls.length === 1 && /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrls[0])) target.mediaType = 'reel';
    const payload: Record<string, unknown> = { post: { accountId: String(c.accountId), content: { text, mediaUrls, platform: c.platform }, target } };
    if (scheduledTime) payload.scheduledTime = scheduledTime;
    const r = await blotato('POST', '/posts', payload);
    if (!r.ok) { results.push({ label: c.label, status: 'failed', error: await say(r) }); continue; }
    const got = await r.json();
    const row = {
      content_id: contentId, account_id: String(c.accountId), platform: c.platform, page_id: c.pageId ? String(c.pageId) : null, account_name: c.label,
      submission_id: String(got.postSubmissionId), scheduled_time: got.scheduledTime || scheduledTime, status: scheduledTime ? 'scheduled' : 'in-progress',
    };
    const { error: iErr } = await db.from('post_submissions').insert(row);
    results.push({ label: c.label, status: row.status, submission_id: row.submission_id, scheduled_time: row.scheduled_time, error: iErr ? `Sent, but not recorded: ${iErr.message}` : null });
  }
  if (results.some((x) => x.submission_id) && piece.status !== 'Shipped') {
    await db.from('content').update({ status: 'Scheduled' }).eq('id', contentId);
  }
  return { results, media: mediaUrls.length };
}

async function check(db: any, blotato: (m: string, p: string, b?: unknown) => Promise<Response>, contentId: string) {
  if (!contentId) throw new Error('content_id is required.');
  const { data: subs } = await db.from('post_submissions').select('*').eq('content_id', contentId).is('deleted_at', null).order('created_at', { ascending: true });
  const rows = (subs || []) as Sub[];
  for (const s of rows) {
    if (!OPEN.includes(s.status)) continue;
    const r = await blotato('GET', `/posts/${encodeURIComponent(s.submission_id)}`);
    if (!r.ok) continue;
    const got = await r.json();
    const status = ['in-progress', 'failed', 'published', 'scheduled'].includes(got.status) ? got.status : s.status;
    const patch = { status, public_url: got.publicUrl || s.public_url, error: got.errorMessage || null, scheduled_time: got.scheduledTime || s.scheduled_time, updated_at: new Date().toISOString() };
    await db.from('post_submissions').update(patch).eq('id', s.id);
    Object.assign(s, patch);
  }
  const live = rows.filter((s) => s.status !== 'cancelled');
  let piece = null;
  if (live.length > 0 && live.every((s) => s.status === 'published')) {
    const url = live.find((s) => s.public_url)?.public_url || null;
    const { data: cur } = await db.from('content').select('status,posted_at,post_url').eq('id', contentId).maybeSingle();
    const patch: Record<string, unknown> = { status: 'Shipped' };
    if (!cur?.posted_at) patch.posted_at = new Date().toISOString();
    if (!cur?.post_url && url) patch.post_url = url;
    await db.from('content').update(patch).eq('id', contentId);
    piece = patch;
  }
  return { submissions: rows, piece };
}

async function cancel(db: any, blotato: (m: string, p: string, b?: unknown) => Promise<Response>, submissionId: string) {
  if (!submissionId) throw new Error('submission_id is required.');
  const { data: s } = await db.from('post_submissions').select('*').eq('submission_id', submissionId).is('deleted_at', null).maybeSingle();
  if (!s) throw new Error('That send was not found.');
  if (s.status !== 'scheduled') throw new Error(`It is ${s.status}, so there is nothing to cancel.`);
  let r = await blotato('DELETE', `/schedules/${encodeURIComponent(submissionId)}`);
  if (r.status === 404) {
    // The schedule id can differ from the submission id: find it by account and time.
    const list = await blotato('GET', '/schedules?limit=100');
    const items = list.ok ? ((await list.json()).items || []) : [];
    const want = s.scheduled_time ? Date.parse(s.scheduled_time) : 0;
    const match = items.find((it: any) => String(it.account?.id) === s.account_id && Math.abs(Date.parse(it.scheduledAt) - want) < 60_000
      && (!s.page_id || String(it.account?.subaccountId || '') === s.page_id));
    if (!match) throw new Error('Blotato no longer lists this scheduled post. Check Blotato itself.');
    r = await blotato('DELETE', `/schedules/${encodeURIComponent(match.id)}`);
  }
  if (!r.ok) throw new Error(await say(r));
  await db.from('post_submissions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', s.id);
  const { data: rest } = await db.from('post_submissions').select('status').eq('content_id', s.content_id).is('deleted_at', null).in('status', [...OPEN, 'published']);
  if (!rest || rest.length === 0) await db.from('content').update({ status: 'Awaiting approval' }).eq('id', s.content_id).eq('status', 'Scheduled');
  return { cancelled: submissionId };
}
