import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { newThread } from './athena.js';

// Athena's jobs: the daily brief, Monday plan, Friday wrap and the Level 10 with Metis.
// The database clock runs the timed ones; these helpers run them on demand and show their state.

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function scheduleText(job) {
  if (!job.run_at) return 'Starts from a button';
  const days = [...(job.days || [])].sort((a, b) => a - b);
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const when = days.length === 0 ? 'No days picked'
    : days.length === 1 ? `${FULL_DAYS[days[0] - 1]}s`
    : run ? `${DAY_NAMES[days[0] - 1]} to ${DAY_NAMES[days[days.length - 1] - 1]}`
    : days.map((d) => DAY_NAMES[d - 1]).join(', ');
  return `${when} at ${clock(job.run_at)}`;
}

export function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Saves a job request and asks GitHub to start Athena, the same way a chat message does.
export async function runJob(job, message = `Run now: ${job.title}`, threadId = newThread()) {
  const { data, error } = await supabase.from('athena_requests')
    .insert({ message, job: job.key, thread_id: threadId }).select('*').single();
  if (error) throw error;
  const { error: fnError } = await supabase.functions.invoke('athena-dispatch', { body: { request_id: data.id } });
  return { request: data, startError: fnError ? 'Saved, but Athena did not start yet. She will pick it up on the next run.' : null };
}

// The jobs, plus the latest request for each, refreshed often while one is running.
export function useJobs() {
  const [jobs, setJobs] = useState(null);
  const [runs, setRuns] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('athena_jobs').select('key,title,kind,prompt,days,run_at,enabled,last_queued_on,last_request_id,updated_at').order('run_at', { nullsFirst: false });
    if (error) { setError(error.message); return; }
    setJobs(data); setError(null);
    const ids = data.map((j) => j.last_request_id).filter(Boolean);
    if (ids.length) {
      const { data: reqs } = await supabase.from('athena_requests').select('id,job,status,error,created_at,finished_at').in('id', ids);
      setRuns(Object.fromEntries((reqs || []).map((r) => [r.job, r])));
    } else setRuns({});
  }, []);

  const busy = Object.values(runs).some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    load();
    const t = setInterval(load, busy ? 5000 : 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load, busy]);

  const save = useCallback(async (key, patch) => {
    setJobs((cur) => cur && cur.map((j) => (j.key === key ? { ...j, ...patch } : j)));
    const { error } = await supabase.from('athena_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) { await load(); throw error; }
  }, [load]);

  return { jobs, runs, error, busy, reload: load, save };
}
