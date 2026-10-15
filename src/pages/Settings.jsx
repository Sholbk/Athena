import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { DAY_NAMES, runJob, scheduleText, useJobs } from '../lib/jobs.js';
import { Panel, Skel } from '../components/bits.jsx';

const ORDER = ['daily_brief', 'monday_plan', 'friday_wrap', 'level10'];
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Settings() {
  return (
    <section>
      <div className="week-head"><div><p className="eyebrow">Settings</p><h2>Athena's schedule and your calendar</h2></div></div>
      <div className="settings">
        <Jobs />
        <div className="settings-side">
          <Calendars />
          <WonderReel />
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
    try { const { startError } = await runJob(job); setMsg(startError || 'Started. It shows on your Today page when it is done, usually within 5 minutes.'); await store.reload(); }
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
