import { useCallback, useEffect, useState } from 'react';
import { askAthena } from './athena.js';
import { supabase } from './supabase.js';

// "Find new ideas" on the idea bank: Athena reads colibrios.com and adds seeds (athena/IDEAS.md).
// The run is kept in the browser so it survives switching tabs: { req, at } while Athena reads,
// then { status, reply } or { status, error } when she is done.
const KEY = 'athena:find-ideas';
const PATIENCE = 25 * 60 * 1000;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function keep(job) {
  try { localStorage.setItem(KEY, JSON.stringify(job)); } catch {}
}

export function useFindIdeas(reload) {
  const [job, setJob] = useState(load);
  const running = !!job && !job.status && Date.now() - job.at < PATIENCE;
  const update = (next) => { setJob(next); keep(next); };

  const check = useCallback(async () => {
    if (!job?.req) return;
    const { data } = await supabase.from('athena_requests').select('id,status,reply,error').eq('id', job.req).single();
    if (data?.status === 'done' || data?.status === 'failed') {
      update({ ...job, status: data.status, reply: data.reply, error: data.error });
      await reload();
    }
  }, [job, reload]);

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [running, check]);

  // Its own conversation, so it does not land in the middle of her chat with Athena.
  const find = useCallback(async () => {
    const { request, startError } = await askAthena('Find new idea bank seeds on colibrios.com. Follow "Finding ideas".', crypto.randomUUID());
    update({ req: request.id, at: Date.now() });
    return startError;
  }, []);

  return { running, last: job?.status ? job : null, timedOut: !!job && !job.status && !running, find };
}
