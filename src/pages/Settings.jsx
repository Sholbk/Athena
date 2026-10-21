import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPABASE_URL, supabase } from '../lib/supabase.js';
import { DAY_NAMES, runJob, scheduleText, useJobs } from '../lib/jobs.js';
import { Panel, Skel } from '../components/bits.jsx';

const ORDER = ['daily_brief', 'monday_plan', 'friday_wrap', 'linkedin_comments', 'post_numbers', 'level10'];
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Settings() {
  return (
    <section>
      <div className="week-head"><div><p className="eyebrow">Settings</p><h2>Athena's schedule and your calendar</h2></div></div>
      <div className="settings">
        <Jobs />
        <div className="settings-side">
          <Calendars />
          <PostingDays />
          <GoogleCalendar />
          <WonderReel />
          <Apify />
          <LinkedInProfile />
        </div>
      </div>
    </section>
  );
}

/* ---------- Jobs ---------- */
function Jobs() {
  const store = useJobs();
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();
  if (store.error) return <div className="notice"><strong>Could not load Athena's schedule</strong><p>{store.error}</p></div>;
  if (!store.jobs) return <Panel title="Athena's schedule"><Skel /></Panel>;
  const jobs = [...store.jobs].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const current = editing && jobs.find((j) => j.key === editing);

  return (
    <Panel title="Athena's schedule" eyebrow="Runs inside this app">
      <p className="muted small" style={{ marginTop: 0 }}>Athena writes these on her own at the times below. What she writes shows on your Today page. Nothing runs anywhere else.</p>
      <div className="jobs">
        {jobs.map((j) => <JobRow key={j.key} job={j} run={store.runs[j.key]} store={store} onEdit={() => setEditing(j.key)}
          onStart={() => navigate('/athena', { state: { level10: true } })} />)}
      </div>
      {current && <JobEditor job={current} store={store} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function JobRow({ job, run, store, onEdit, onStart }) {
  const [msg, setMsg] = useState('');
  const working = run && (run.status === 'queued' || run.status === 'running');
  const timed = !!job.run_at;
  const go = async () => {
    setMsg('');
    const lands = job.key === 'linkedin_comments' ? 'the Comment desk on your Marketing page'
      : job.key === 'post_numbers' ? 'the Results tab on your Marketing page' : 'your Today page';
    try { const { startError } = await runJob(job); setMsg(startError || `Started. It shows on ${lands} when it is done, usually within 5 minutes.`); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  const toggle = async (e) => { try { await store.save(job.key, { enabled: e.target.checked }); } catch (err) { setMsg(err.message); } };

  return (
    <div className="job">
      <div className="job-main">
        <span className="card-title">{job.title}</span>
        <span className="meta">
          <span>{scheduleText(job)}</span>
          {run && <span>Last ran {fWhen.format(new Date(run.created_at))}</span>}
          {working && <span className="pill info">Working…</span>}
          {run?.status === 'failed' && <span className="pill danger">Did not finish</span>}
        </span>
        {run?.status === 'failed' && run.error && <span className="small muted">{run.error}</span>}
        {msg && <span className="small">{msg}</span>}
      </div>
      <div className="btn-row">
        {timed && (
          <label className="switch"><input type="checkbox" checked={job.enabled} onChange={toggle} /> {job.enabled ? 'On' : 'Off'}</label>
        )}
        {job.kind === 'meeting'
          ? <button className="btn small" type="button" onClick={onStart}>Start Level 10</button>
          : <button className="btn ghost small" type="button" onClick={go} disabled={working}>Run now</button>}
        <button className="linkbtn" type="button" onClick={onEdit}>Change</button>
      </div>
    </div>
  );
}

function JobEditor({ job, store, onClose }) {
  const [f, setF] = useState({ run_at: job.run_at ? job.run_at.slice(0, 5) : '', days: job.days || [], prompt: job.prompt || '' });
  const [msg, setMsg] = useState('');
  const flip = (d) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) });
  const save = async () => {
    if (!f.prompt.trim()) return setMsg('The instructions cannot be empty.');
    const patch = { prompt: f.prompt, days: f.days };
    if (job.run_at) {
      if (!f.run_at) return setMsg('Pick a time.');
      patch.run_at = f.run_at;
    }
    try { await store.save(job.key, patch); onClose(); } catch (e) { setMsg(e.message); }
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-label={job.title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="d-head"><p className="eyebrow">{job.title}</p><button className="linkbtn" type="button" onClick={onClose}>Close</button></div>
        {job.run_at && (
          <>
            <label className="f">Time, Mountain<input type="time" value={f.run_at} onChange={(e) => setF({ ...f, run_at: e.target.value })} /></label>
            <div className="f"><span>Days</span>
              <div className="seg small" role="group" aria-label="Days">
                {DAY_NAMES.map((n, i) => <button key={n} type="button" aria-pressed={f.days.includes(i + 1)} onClick={() => flip(i + 1)}>{n}</button>)}
              </div>
            </div>
          </>
        )}
        <label className="f">Instructions for {job.kind === 'meeting' ? 'Metis' : 'Athena'}
          <textarea rows="22" value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />
        </label>
        <p className="small muted">This is exactly what {job.kind === 'meeting' ? 'Metis' : 'Athena'} reads before every run. The app adds how to read your data, the time and your calendar.</p>
        <div className="d-actions"><button className="btn" type="button" onClick={save}>Save</button></div>
        <p className="form-msg">{msg}</p>
      </aside>
    </>
  );
}

/* ---------- Calendars ---------- */
function Calendars() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const load = useCallback(async () => {
    // The private link is never read back into the page.
    const { data, error } = await supabase.from('calendar_feeds').select('id,name,enabled,created_at').order('created_at');
    if (error) setErr(error.message); else setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault(); setErr('');
    const link = url.trim().replace(/^webcal:/i, 'https:');
    if (!/^https:\/\/\S+$/i.test(link)) return setErr('Paste the full link. It starts with https:// and usually ends in basic.ics.');
    if (/\/public\/basic\.ics$/i.test(link)) return setErr('That is the public address, which only works for a calendar shared with everyone. Copy the Secret address in iCal format instead.');
    const { error } = await supabase.from('calendar_feeds').insert({ name: name.trim() || 'Google Calendar', ical_url: link });
    if (error) return setErr(error.message);
    setName(''); setUrl(''); load();
  };
  const setOn = async (row, on) => { await supabase.from('calendar_feeds').update({ enabled: on }).eq('id', row.id); load(); };
  const remove = async (row) => { if (confirm(`Remove the ${row.name} calendar?`)) { await supabase.from('calendar_feeds').delete().eq('id', row.id); load(); } };

  return (
    <Panel title="Your calendar" eyebrow="Read only">
      <p className="muted small" style={{ marginTop: 0 }}>Link your Google Calendar so the briefs know your meetings and your Week page shows them. Athena only reads it. She never adds or changes events.</p>
      {!rows ? <Skel /> : rows.length === 0 ? <p className="empty">No calendar linked yet.</p> : (
        <div className="jobs">
          {rows.map((r) => (
            <div key={r.id} className="job">
              <div className="job-main"><span className="card-title">{r.name}</span></div>
              <div className="btn-row">
                <label className="switch"><input type="checkbox" checked={r.enabled} onChange={(e) => setOn(r, e.target.checked)} /> {r.enabled ? 'On' : 'Off'}</label>
                <button className="linkbtn danger" type="button" onClick={() => remove(r)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="cal-add" onSubmit={add}>
        <label className="f">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" /></label>
        <label className="f">Private address in iCal format<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /></label>
        <button className="btn" type="submit" disabled={!url.trim()}>Add calendar</button>
      </form>
      <details className="small muted">
        <summary>Where to find the link</summary>
        <ol>
          <li>Open Google Calendar on a computer and click the gear, then <b>Settings</b>.</li>
          <li>On the left, click the calendar's name under <b>Settings for my calendars</b>.</li>
          <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li>
          <li>Paste it above. Add one link per calendar you want Athena to see.</li>
        </ol>
      </details>
      {err && <p className="form-msg">{err}</p>}
    </Panel>
  );
}

/* ---------- WonderReel ---------- */
// Her WonderReel connect link lets Media import her newest WonderReel work. It holds her personal
// WonderReel key, so it is saved but never read back into the page.
function WonderReel() {
  const [linked, setLinked] = useState(undefined);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('connections').select('key,updated_at').eq('key', 'wonderreel').maybeSingle();
    if (error) setMsg(error.message); else setLinked(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setMsg(''); setNote('');
    const link = url.trim();
    if (!/^https:\/\/wonderreel\.io\/mcp\/\S+$/.test(link)) return setMsg('Paste the connect URL from WonderReel. It starts with https://wonderreel.io/mcp/');
    const { error } = await supabase.from('connections').upsert({ key: 'wonderreel', url: link, updated_at: new Date().toISOString() });
    if (error) return setMsg(error.message);
    setUrl(''); setNote('Saved. Media can now import from WonderReel.'); load();
  };
  const remove = async () => {
    if (!confirm('Disconnect WonderReel? Files you already imported stay in Media.')) return;
    const { error } = await supabase.from('connections').delete().eq('key', 'wonderreel');
    setNote('');
    if (error) setMsg(error.message); else { setNote('Disconnected.'); load(); }
  };

  return (
    <Panel title="WonderReel" eyebrow="Import only">
      <p className="muted small" style={{ marginTop: 0 }}>Connect WonderReel so Marketing, Media can import your newest images and videos. Athena only lists and copies them. It never makes anything in WonderReel, so it never uses your credits.</p>
      {linked === undefined ? <Skel /> : linked
        ? <div className="job"><div className="job-main"><span className="card-title">Connected</span><span className="small muted">Since {fWhen.format(new Date(linked.updated_at))}</span></div><button className="linkbtn danger" type="button" onClick={remove}>Disconnect</button></div>
        : <p className="empty">Not connected yet.</p>}
      <form className="cal-add wr-add" onSubmit={save}>
        <label className="f">{linked ? 'Replace the connect URL' : 'Your WonderReel connect URL'}<input type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://wonderreel.io/mcp/…" /></label>
        <button className="btn" type="submit" disabled={!url.trim()}>Save</button>
      </form>
      <details className="small muted">
        <summary>Where to find it</summary>
        <ol>
          <li>In WonderReel, click your email at the top left to open Settings.</li>
          <li>Find <b>Claude MCP Access (Pro)</b>. Under <b>Step 2</b>, click <b>Copy URL</b>.</li>
          <li>Paste it above and click Save. It holds your WonderReel key, so it stays hidden here.</li>
        </ol>
      </details>
      {note && <p className="small">{note}</p>}
      {msg && <p className="form-msg">{msg}</p>}
    </Panel>
  );
}

/* ---------- Apify ---------- */
// Her Apify token lets the LinkedIn comments job and Post numbers read public LinkedIn posts.
// Saved here, never read back into the page.
function Apify() {
  const [linked, setLinked] = useState(undefined);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('connections').select('key,updated_at').eq('key', 'apify').maybeSingle();
    if (error) setMsg(error.message); else setLinked(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setMsg(''); setNote('');
    const value = token.trim();
    if (!/^apify_api_[A-Za-z0-9]{20,}$/.test(value)) return setMsg('That is not an Apify API token. It starts with apify_api_ and has no spaces. Find it in Apify under Settings, API & Integrations.');
    const { error } = await supabase.from('connections').upsert({ key: 'apify', data: { token: value }, updated_at: new Date().toISOString() });
    if (error) return setMsg(error.message);
    setToken(''); setNote('Saved. The next LinkedIn comments run and Post numbers run use it.'); load();
  };
  const remove = async () => {
    if (!confirm('Remove the Apify token? LinkedIn scans stop until you add one again.')) return;
    const { error } = await supabase.from('connections').delete().eq('key', 'apify');
    setNote('');
    if (error) setMsg(error.message); else { setNote('Removed.'); load(); }
  };

  return (
    <Panel title="Apify" eyebrow="Reads public LinkedIn posts">
      <p className="muted small" style={{ marginTop: 0 }}>Your Apify API token. The Comment desk and Post numbers use it to read public LinkedIn posts, a few cents a run. Nothing signs in to LinkedIn.</p>
      {linked === undefined ? <Skel /> : linked
        ? <div className="job"><div className="job-main"><span className="card-title">Saved</span><span className="small muted">Since {fWhen.format(new Date(linked.updated_at))}</span></div><button className="linkbtn danger" type="button" onClick={remove}>Remove</button></div>
        : <p className="empty">Not saved yet.</p>}
      <form className="cal-add wr-add" onSubmit={save}>
        <label className="f">{linked ? 'Replace the token' : 'Your Apify API token'}<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="apify_api_…" /></label>
        <button className="btn" type="submit" disabled={!token.trim()}>Save</button>
      </form>
      <details className="small muted">
        <summary>Where to find it</summary>
        <ol>
          <li>In Apify, open <b>Settings</b>, then <b>API &amp; Integrations</b>.</li>
          <li>Under <b>Personal API tokens</b>, click the copy icon on your token, or create a new one and copy it.</li>
          <li>Paste it above and click Save. It stays hidden here.</li>
        </ol>
      </details>
      {note && <p className="small">{note}</p>}
      {msg && <p className="form-msg">{msg}</p>}
    </Panel>
  );
}

/* ---------- LinkedIn profile ---------- */
// Her own profile link, so the Post numbers job knows whose public posts to read. Not a secret.
function LinkedInProfile() {
  const [saved, setSaved] = useState(undefined);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('connections').select('url,updated_at').eq('key', 'linkedin_profile').maybeSingle();
    if (error) setMsg(error.message); else { setSaved(data); setUrl(data?.url || ''); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setMsg(''); setNote('');
    const link = url.trim().replace(/\?.*$/, '');
    if (!/^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i.test(link)) return setMsg('Paste your LinkedIn profile link, like https://www.linkedin.com/in/your-name/');
    const { error } = await supabase.from('connections').upsert({ key: 'linkedin_profile', url: link, updated_at: new Date().toISOString() });
    if (error) return setMsg(error.message);
    setNote('Saved. The next Post numbers run reads your LinkedIn posts.'); load();
  };
  const remove = async () => {
    if (!confirm('Remove your LinkedIn profile link? Results keeps the LinkedIn numbers it already has.')) return;
    const { error } = await supabase.from('connections').delete().eq('key', 'linkedin_profile');
    setNote('');
    if (error) setMsg(error.message); else { setNote('Removed.'); setUrl(''); load(); }
  };

  return (
    <Panel title="LinkedIn profile" eyebrow="For Results">
      <p className="muted small" style={{ marginTop: 0 }}>Your own profile link, so Post numbers can read the reactions, comments and shares on your public LinkedIn posts. It reads only, through a public scan. Nothing signs in to LinkedIn.</p>
      {saved === undefined ? <Skel /> : saved
        ? <div className="job"><div className="job-main"><span className="card-title">Saved</span><span className="small muted">Since {fWhen.format(new Date(saved.updated_at))}</span></div><button className="linkbtn danger" type="button" onClick={remove}>Remove</button></div>
        : <p className="empty">Not set yet, so Results shows Instagram and Facebook only.</p>}
      <form className="cal-add wr-add" onSubmit={save}>
        <label className="f">Your LinkedIn profile link<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/your-name/" /></label>
        <button className="btn" type="submit" disabled={!url.trim() || url.trim() === (saved?.url || '')}>Save</button>
      </form>
      {note && <p className="small">{note}</p>}
      {msg && <p className="form-msg">{msg}</p>}
    </Panel>
  );
}

function CopyLine({ value, label = 'Copy' }) {
  const [said, setSaid] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setSaid('Copied'); } catch { setSaid('Select it and copy'); }
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <div className="copy-line">
      <input type="text" readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
      <button className="btn ghost small" type="button" onClick={copy}>{said || label}</button>
    </div>
  );
}

/* ---------- Posting days ---------- */
// A private calendar link Google Calendar subscribes to: each post with a target date shows on
// that day (edge function athena-calendar-feed). Google only reads it.
function PostingDays() {
  const [token, setToken] = useState(undefined);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('connections').select('data').eq('key', 'calendar_feed').maybeSingle();
    if (error) setMsg(error.message); else setToken(data?.data?.token || null);
  }, []);
  useEffect(() => { load(); }, [load]);
  const make = async () => {
    if (token && !confirm('Make a new link? The old one stops working, so Google Calendar needs the new one.')) return;
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const next = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { error } = await supabase.from('connections').upsert({ key: 'calendar_feed', data: { token: next }, updated_at: new Date().toISOString() });
    if (error) setMsg(error.message); else { setMsg(''); setToken(next); }
  };
  const link = token && `${SUPABASE_URL}/functions/v1/athena-calendar-feed?k=${token}`;
  return (
    <Panel title="Posting days in Google Calendar" eyebrow="Your posts on your calendar">
      <p className="muted small" style={{ marginTop: 0 }}>Every post with a target date shows on that day in your Google Calendar, with the caption inside. Google checks for changes every few hours. It only reads: nothing in your calendar changes your posts.</p>
      {token === undefined ? <Skel /> : !token
        ? <button className="btn" type="button" onClick={make}>Make my calendar link</button>
        : (
          <>
            <CopyLine value={link} label="Copy link" />
            <details className="small muted">
              <summary>Add it to Google Calendar</summary>
              <ol>
                <li>Open Google Calendar on a computer.</li>
                <li>On the left, next to <b>Other calendars</b>, click <b>+</b>, then <b>From URL</b>.</li>
                <li>Paste the link and click <b>Add calendar</b>. It shows up as "Athena posts".</li>
              </ol>
            </details>
            <button className="linkbtn quiet" type="button" onClick={make}>Make a new link</button>
          </>
        )}
      {msg && <p className="form-msg">{msg}</p>}
    </Panel>
  );
}

/* ---------- Google Calendar: Athena adds events ---------- */
// Her own Google OAuth client, then a one-time Google sign-in. Athena then adds events when she
// asks (athena/gcal.py, edge function google-oauth). The secret parts are never read back.
const GOOGLE_RESULT = {
  connected: 'Connected. Ask Athena in chat to put something on your calendar.',
  declined: 'Google was not connected: the sign-in was cancelled.',
  expired: 'That sign-in took too long or was already used. Click Connect Google Calendar again.',
  'bad-client': 'Google did not accept the Client ID and secret. Paste them again, then connect.',
  'no-client': 'Save your Client ID and secret first, then connect.',
  error: 'Google did not finish connecting. Try Connect Google Calendar again.',
};
function GoogleCalendar() {
  const [g, setG] = useState(undefined);
  const [f, setF] = useState({ id: '', secret: '' });
  const [msg, setMsg] = useState(() => GOOGLE_RESULT[new URLSearchParams(window.location.search).get('google')] || '');
  const redirect = `${SUPABASE_URL}/functions/v1/google-oauth`;
  const load = useCallback(async () => {
    // Only the parts that are safe to show: never the secret or the refresh token.
    const { data, error } = await supabase.from('connections')
      .select('client_id:data->>client_id,email:data->>email,connected_at:data->>connected_at').eq('key', 'google').maybeSingle();
    if (error) setMsg(error.message); else setG(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const id = f.id.trim(), secret = f.secret.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) return setMsg('The Client ID ends in .apps.googleusercontent.com.');
    if (secret.length < 10) return setMsg('Paste the Client secret too.');
    const { error } = await supabase.from('connections').upsert({ key: 'google', data: { client_id: id, client_secret: secret }, updated_at: new Date().toISOString() });
    if (error) return setMsg(error.message);
    setF({ id: '', secret: '' }); setMsg('Saved. Now click Connect Google Calendar.'); load();
  };
  const connect = async () => {
    const state = crypto.randomUUID();
    const { error } = await supabase.from('connections').upsert({ key: 'google_state', data: { state, at: Date.now() }, updated_at: new Date().toISOString() });
    if (error) return setMsg(error.message);
    const q = new URLSearchParams({
      client_id: g.client_id, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events', state,
    });
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  };
  const remove = async () => {
    if (!confirm('Disconnect Google Calendar? Athena will stop adding events. Events already added stay.')) return;
    const { error } = await supabase.from('connections').delete().eq('key', 'google');
    if (error) setMsg(error.message); else { setMsg('Disconnected.'); load(); }
  };

  return (
    <Panel title="Google Calendar: Athena adds events" eyebrow="When you ask">
      <p className="muted small" style={{ marginTop: 0 }}>Ask Athena in chat, such as "put a 30 minute call on Tuesday at 2 PM on my calendar", and she adds it. She only adds events. She never changes or deletes one.</p>
      {g === undefined ? <Skel /> : g?.connected_at ? (
        <div className="job"><div className="job-main"><span className="card-title">Connected{g.email ? ` as ${g.email}` : ''}</span><span className="small muted">Since {fWhen.format(new Date(g.connected_at))}</span></div>
          <div className="btn-row"><button className="linkbtn" type="button" onClick={connect}>Reconnect</button><button className="linkbtn danger" type="button" onClick={remove}>Disconnect</button></div></div>
      ) : g?.client_id ? (
        <div className="btn-row"><button className="btn" type="button" onClick={connect}>Connect Google Calendar</button><button className="linkbtn quiet" type="button" onClick={() => setG(null)}>Use a different Client ID</button></div>
      ) : (
        <>
          <details className="small muted" open>
            <summary>One-time setup in Google Cloud</summary>
            <ol>
              <li>Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a> and create a project named Athena.</li>
              <li>Turn on the <b>Google Calendar API</b> for it.</li>
              <li>Under <b>Google Auth Platform</b>, set up the app: name Athena, audience <b>External</b>. Then under <b>Audience</b>, click <b>Publish app</b>, so the connection does not expire every 7 days.</li>
              <li>Under <b>Clients</b>, create a <b>Web application</b> client. Add this as an authorized redirect URI:</li>
            </ol>
            <CopyLine value={redirect} label="Copy" />
            <ol start="5"><li>Paste the Client ID and Client secret below and click Save.</li></ol>
          </details>
          <form className="g-add" onSubmit={save}>
            <label className="f">Client ID<input type="text" autoComplete="off" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="…apps.googleusercontent.com" /></label>
            <label className="f">Client secret<input type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
            <button className="btn" type="submit" disabled={!f.id.trim() || !f.secret.trim()}>Save</button>
          </form>
        </>
      )}
      {msg && <p className={/^(Connected|Saved|Disconnected)/.test(msg) ? 'small' : 'form-msg'}>{msg}</p>}
    </Panel>
  );
}
