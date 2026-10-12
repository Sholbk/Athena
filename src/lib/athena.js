import { supabase } from './supabase.js';

const KEY = 'athena:thread';
export function currentThread() {
  try {
    let t = localStorage.getItem(KEY);
    if (!t) { t = crypto.randomUUID(); localStorage.setItem(KEY, t); }
    return t;
  } catch { return crypto.randomUUID(); }
}
export function newThread() {
  const t = crypto.randomUUID();
  try { localStorage.setItem(KEY, t); } catch {}
  return t;
}

// Saves the message, then asks GitHub to start Athena. If the start call fails the
// message stays queued and the next run answers it, so nothing is lost.
export async function askAthena(message, threadId = currentThread()) {
  const { data, error } = await supabase.from('athena_requests')
    .insert({ message, thread_id: threadId }).select('*').single();
  if (error) throw error;
  const { error: fnError } = await supabase.functions.invoke('athena-dispatch', { body: { request_id: data.id } });
  return { request: data, startError: fnError ? (await describe(fnError)) : null };
}

async function describe(err) {
  try {
    const body = await err.context?.json?.();
    if (body?.error) return body.error;
  } catch {}
  return err.message || 'Could not start Athena.';
}
