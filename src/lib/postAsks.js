import { useCallback, useEffect, useState } from 'react';
import { askAthena } from './athena.js';
import { supabase } from './supabase.js';

// Posts Athena is making (rules in athena/POSTS.md), keyed by content id. Kept in the browser so it
// survives switching tabs. A piece stops showing as "making" when Athena finishes the request or
// moves the piece on from Idea, or after 25 minutes. A request that failed keeps its error until
// she tries again.
const KEY = 'athena:making';
const PATIENCE = 25 * 60 * 1000;
const WORKING = ['Idea', 'Drafted'];

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function keep(asks) {
  try { localStorage.setItem(KEY, JSON.stringify(asks)); } catch {}
}

export function usePostAsks(rows, reload) {
  const [asks, setAsks] = useState(load);
  const [reqs, setReqs] = useState({});  // request id -> { status, error }

  const stateOf = (id) => {
    const a = asks[id];
    if (!a) return null;
    const req = reqs[a.req];
    if (req?.status === 'failed') return 'failed';
    if (req?.status === 'done' || Date.now() - a.at > PATIENCE) return null;
    const row = rows && rows.find((r) => r.id === id);
    if (rows && (!row || !WORKING.includes(row.status))) return null;
    return 'making';
  };
  const ids = Object.keys(asks);
  const making = ids.filter((id) => stateOf(id) === 'making');
  const failed = Object.fromEntries(ids.filter((id) => stateOf(id) === 'failed')
    .map((id) => [id, { seed: asks[id].seed, error: reqs[asks[id].req]?.error || 'Athena did not finish.' }]));

  // Forget the ones that are done.
  useEffect(() => {
    const left = Object.fromEntries(Object.entries(asks).filter(([id]) => stateOf(id)));
    if (Object.keys(left).length !== Object.keys(asks).length) { setAsks(left); keep(left); }
  });

  // While anything is being made, check on it every 15 seconds.
  const pending = making.map((id) => asks[id].req).filter(Boolean).join(',');
  const check = useCallback(async () => {
    const list = pending ? pending.split(',') : [];
    if (!list.length) return;
    const { data } = await supabase.from('athena_requests').select('id,status,error').in('id', list);
    if (data) setReqs((cur) => ({ ...cur, ...Object.fromEntries(data.map((r) => [r.id, r])) }));
    await reload();
  }, [pending, reload]);
  useEffect(() => {
    if (!pending) return undefined;
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [pending, check]);

  // Its own conversation, so it does not land in the middle of her chat with Athena.
  const ask = useCallback(async (contentId, message, seed = null) => {
    const { request, startError } = await askAthena(message, crypto.randomUUID());
    const next = { ...load(), [contentId]: { at: Date.now(), req: request.id, seed } };
    setAsks(next); keep(next);
    return startError;
  }, []);

  const makingSeeds = new Set(making.map((id) => asks[id].seed).filter((n) => n != null));
  return { making: new Set(making), makingSeeds, failed, ask };
}
