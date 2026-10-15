// Lists Stephanie's newest WonderReel images and videos, for "Import from WonderReel" in Media.
// Her WonderReel connect link (saved in Settings, table connections) holds her personal key, so it
// is read here with her login and never sent to the browser. This only lists: it never makes
// anything in WonderReel, so it never spends her WonderReel credits.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

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
  let kind = 'all';
  try { kind = (await req.json()).kind ?? 'all'; } catch { /* default */ }
  if (!['all', 'image', 'video'].includes(kind)) return json(400, { error: 'kind is all, image or video' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: link, error } = await supabase.from('connections').select('url').eq('key', 'wonderreel').maybeSingle();
  if (error) return json(401, { error: 'Sign in again to reach WonderReel.' });
  if (!link) return json(404, { error: 'WonderReel is not connected yet. Add your connect link in Settings.' });

  try {
    const items = await gallery(link.url, kind);
    return json(200, { items });
  } catch (e) {
    // Errors can quote the link, which holds her key, so only a short reason is passed on.
    const why = e instanceof Error && /^(HTTP \d+|WonderReel: .{0,160})$/.test(e.message) ? e.message : 'could not connect';
    return json(502, { error: `WonderReel did not answer (${why}).` });
  }
});

// One MCP conversation: initialize, then call list_gallery (WonderReel returns at most 20).
async function gallery(url: string, kind: string) {
  const init = await rpc(url, { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'athena', version: '1' } } });
  await rpc(url, { method: 'notifications/initialized' }, init.session);
  const call = await rpc(url, { id: 2, method: 'tools/call', params: { name: 'list_gallery', arguments: { kind, limit: 20 } } }, init.session);
  const result = call.msg?.result;
  if (call.msg?.error || !result) throw new Error(`WonderReel: ${String(call.msg?.error?.message || 'no answer').slice(0, 160)}`);
  const text = (result.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  if (result.isError) throw new Error(`WonderReel: ${text.slice(0, 160)}`);
  const items = JSON.parse(text).items || [];
  return items
    .filter((i: Item) => (i.kind === 'image' || i.kind === 'video') && i.status === 'done' && /^https:\/\//.test(i.url || ''))
    .map((i: Item) => ({ id: String(i.id), kind: i.kind, model: i.model || null, prompt: i.prompt || '', url: i.url }));
}

type Item = { id: string; kind: string; model?: string; status?: string; prompt?: string; url?: string };

async function rpc(url: string, body: Record<string, unknown>, session?: string) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
  });
  if (!r.ok && r.status !== 202) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  let msg = null;
  if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { const m = JSON.parse(line.slice(5)); if (m.id === body.id) msg = m; } catch { /* not JSON */ }
    }
  } else if (text.trim()) {
    try { msg = JSON.parse(text); } catch { /* notification replies can be empty */ }
  }
  return { msg, session: r.headers.get('mcp-session-id') ?? session };
}
