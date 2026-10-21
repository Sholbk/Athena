import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { checks, choices, defaultWhen, mountainToUtc, whenText } from '../lib/blotatoPost.js';

// "Send to Blotato" inside the content drawer. She picks accounts and a time, confirms, and the
// blotato-post edge function sends it with her key. Every send starts with her click here.
const STATUS = { 'in-progress': ['Posting…', 'info'], scheduled: ['Scheduled', 'ok'], published: ['Published', 'ok'], failed: ['Failed', 'danger'], cancelled: ['Cancelled', ''] };

async function call(body) {
  const { data, error } = await supabase.functions.invoke('blotato-post', { body });
  if (error) {
    let why = error.message;
    try { why = (await error.context?.json?.())?.error || why; } catch { /* keep */ }
    throw new Error(why);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function SendToBlotato({ row, media, onChanged }) {
  const [accounts, setAccounts] = useState(undefined);   // undefined = loading, null = not connected
  const [picked, setPicked] = useState({});
  const [mode, setMode] = useState('schedule');
  const [when, setWhen] = useState(() => defaultWhen(row.target_date));
  const [subs, setSubs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await call({ action: 'check', content_id: row.id });
      setSubs(r.submissions || []);
      if (r.piece) onChanged?.(r.piece);
    } catch (e) { setMsg(e.message); }
  }, [row.id, onChanged]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase.from('post_submissions').select('*').eq('content_id', row.id).is('deleted_at', null).order('created_at');
      if (live) setSubs(data || []);
      try {
        const r = await call({ action: 'accounts' });
        if (!live) return;
        const list = choices(r.items || []);
        setAccounts(list);
        setPicked(Object.fromEntries(list.map((c) => [c.key, c.on])));
      } catch (e) {
        if (!live) return;
        setAccounts(null); setMsg(e.message);
      }
    })();
    return () => { live = false; };
  }, [row.id]);

  const open = subs.filter((s) => s.status === 'in-progress' || s.status === 'scheduled');
  useEffect(() => {   // while something is posting, ask Blotato every 20 seconds
    if (!open.some((s) => s.status === 'in-progress')) return undefined;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [open.length, refresh]);

  const chosen = (accounts || []).filter((c) => picked[c.key]);
  const problems = accounts ? checks({ text: row.body, media, picked: chosen }) : [];
  const scheduledTime = mode === 'schedule' ? mountainToUtc(when) : null;
  const tooSoon = mode === 'schedule' && (!scheduledTime || Date.parse(scheduledTime) < Date.now() + 60000);

  const send = async () => {
    const list = chosen.map((c) => c.label).join(', ');
    const timing = mode === 'now' ? 'right now' : `on ${whenText(scheduledTime)} Mountain`;
    if (!confirm(`Send "${row.title}" to ${list}, ${timing}?${mode === 'now' ? ' This posts for real.' : ''}`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await call({ action: 'post', content_id: row.id, choices: chosen.map(({ accountId, platform, pageId, label }) => ({ accountId, platform, pageId, label })), scheduledTime });
      const sent = r.results.filter((x) => x.submission_id).length;
      const bad = r.results.filter((x) => !x.submission_id);
      setMsg(`${sent === 0 ? 'Nothing was sent.' : `Sent to ${sent} ${sent === 1 ? 'account' : 'accounts'}.`}${bad.length ? ' ' + bad.map((b) => `${b.label}: ${b.error}`).join(' ') : ''}`);
      if (sent > 0) onChanged?.({ status: 'Scheduled' });
      await refresh();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const drop = async (s) => {
    if (!confirm(`Cancel the ${s.account_name} post scheduled for ${whenText(s.scheduled_time)}?`)) return;
    setBusy(true); setMsg('');
    try { await call({ action: 'cancel', submission_id: s.submission_id }); setMsg('Cancelled.'); await refresh(); const { data } = await supabase.from('content').select('status').eq('id', row.id).maybeSingle(); if (data) onChanged?.(data); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <section className="send" aria-label="Send to Blotato">
      <div className="label-row"><strong>Send to Blotato</strong>{subs.length > 0 && <button className="linkbtn" type="button" onClick={refresh} disabled={busy}>Check status</button>}</div>
      {subs.length > 0 && (
        <ul className="sends">
          {subs.map((s) => (
            <li key={s.id}>
              <span className={'pill ' + (STATUS[s.status]?.[1] || '')}>{STATUS[s.status]?.[0] || s.status}</span>
              <span>{s.account_name}</span>
              {s.scheduled_time && s.status === 'scheduled' && <span className="muted">{whenText(s.scheduled_time)}</span>}
              {s.public_url && <a href={s.public_url} target="_blank" rel="noreferrer">Open</a>}
              {s.status === 'scheduled' && <button className="linkbtn quiet" type="button" onClick={() => drop(s)} disabled={busy}>Cancel</button>}
              {s.error && <span className="late small">{s.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {accounts === undefined && <p className="small muted">Asking Blotato for your accounts…</p>}
      {accounts === null && <p className="small muted">Blotato is not reachable. Paste your Blotato API key in Settings, then reopen this post.</p>}
      {accounts && (
        <>
          <div className="acct-list">
            {accounts.map((c) => (
              <label key={c.key} className="calopt"><input type="checkbox" checked={!!picked[c.key]} onChange={(e) => setPicked({ ...picked, [c.key]: e.target.checked })} /> {c.label}</label>
            ))}
          </div>
          <div className="row-input">
            <label className="calopt"><input type="radio" name="mode" checked={mode === 'schedule'} onChange={() => setMode('schedule')} /> Schedule for</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={mode !== 'schedule'} aria-label="Schedule time, Mountain" />
            <label className="calopt"><input type="radio" name="mode" checked={mode === 'now'} onChange={() => setMode('now')} /> Post now</label>
          </div>
          {problems.length > 0 && <ul className="small late plain-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {tooSoon && problems.length === 0 && <p className="small late">Pick a time at least a minute from now.</p>}
          <div className="btn-row">
            <button className="btn" type="button" onClick={send} disabled={busy || problems.length > 0 || tooSoon}>{busy ? 'Sending…' : mode === 'now' ? 'Post now' : 'Schedule it'}</button>
            <span className="small muted">Times are Mountain. YouTube and Facebook are not here: YouTube needs a video with a title, and your Facebook has no Page.</span>
          </div>
        </>
      )}
      {msg && <p className="d-msg" role="status">{msg}</p>}
    </section>
  );
}
