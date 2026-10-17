import { useMemo, useState } from 'react';
import { useRows } from '../lib/rows.js';
import { runJob, useJobs } from '../lib/jobs.js';
import { diffDays, mdLabel, todayYMD } from '../lib/dates.js';
import { Markdown } from '../lib/markdown.jsx';
import { Panel, Skel } from './bits.jsx';

// The LinkedIn Comment desk. Athena drafts a comment for each recent post by someone Stephanie
// watches (job "LinkedIn comments", athena/LINKEDIN.md). Stephanie copies, edits and posts every
// comment on LinkedIn herself, then presses "I posted it". The app never touches LinkedIn.
const JOB = 'linkedin_comments';
const BRIEF_PAGE = 'LinkedIn comments';
const PEOPLE_COLS = 'id,name,title,company,url,tier,score,stage,notes,last_scanned_on,last_post_on,updated_at';
const COMMENT_COLS = 'id,person_id,post_url,post_key,post_date,staged_on,kind,summary,comment,posted_at,updated_at';
const STAGES = ['Watching', 'Commented', 'Connected', 'Replied', 'Stop'];
const BATCH_TARGET = 30;

export default function CommentDesk({ pages }) {
  const people = useRows('linkedin_people', PEOPLE_COLS, { column: 'score', ascending: false });
  const comments = useRows('linkedin_comments', COMMENT_COLS, { column: 'post_date', ascending: false });
  const [msg, setMsg] = useState('');
  if (people.error || comments.error) return <div className="notice"><strong>The Comment desk did not load</strong><p>{people.error || comments.error}</p></div>;
  if (!people.rows || !comments.rows) return <Skel />;

  const byId = Object.fromEntries(people.rows.map((p) => [p.id, p]));
  const today = todayYMD();
  const open = comments.rows.filter((c) => !c.posted_at && byId[c.person_id]);
  const staged = comments.rows.filter((c) => c.kind === 'staged').length;
  const brief = (pages.rows || []).find((p) => p.title === BRIEF_PAGE && p.folder === 'Athena');

  // Ready to connect: a comment posted at least a day ago and within the last 14 days, person not connected yet.
  const connect = Object.values(comments.rows.filter((c) => c.posted_at).reduce((acc, c) => {
    const cur = acc[c.person_id];
    if (!cur || c.posted_at > cur.posted_at) acc[c.person_id] = c;
    return acc;
  }, {})).map((c) => ({ c, p: byId[c.person_id], days: diffDays(today, c.posted_at.slice(0, 10)) }))
    .filter(({ p, days }) => p && days >= 1 && days <= 14 && !['Connected', 'Replied', 'Stop'].includes(p.stage))
    .sort((a, b) => b.days - a.days);

  const posted = async (c) => {
    try { await comments.save(c.id, { posted_at: new Date().toISOString(), updated_at: new Date().toISOString() }); setMsg(`Marked as posted. ${byId[c.person_id].name} shows under Ready to connect from tomorrow.`); }
    catch (e) { setMsg(e.message); }
  };
  const drop = async (c) => {
    try { await comments.remove(c.id); setMsg('Taken off the desk.'); } catch (e) { setMsg(e.message); }
  };
  const stage = async (p, value) => {
    try { await people.save(p.id, { stage: value, updated_at: new Date().toISOString() }); } catch (e) { setMsg(e.message); }
  };

  return (
    <div className="desk">
      <RunBar staged={staged} brief={brief} />
      {msg && <p className="d-msg">{msg}</p>}
      <Panel title="Comments to post" eyebrow={`${open.length} waiting`} extra={<span className="small muted">1 minute each</span>}>
        {open.length === 0
          ? <p className="empty">Nothing waiting. Athena adds drafts on weekday mornings when the job is on, or press Run now.</p>
          : groupByPerson(open, byId).map(({ p, list }) => (
            <div key={p.id} className="desk-person">
              <div className="desk-head">
                <span className="card-title">{p.name}</span>
                <span className="meta">
                  {p.title && <span>{p.title}</span>}
                  {p.company && <span>{p.company}</span>}
                  {p.tier === 2 && <span className="pill">Tier 2 extra</span>}
                  <a className="linkbtn" href={p.url} target="_blank" rel="noreferrer">Profile</a>
                </span>
                {list.length > 1 && <span className="small muted">Two posts: comment on one now and the other in a few days.</span>}
              </div>
              {list.map((c) => <Draft key={c.id} c={c} onPosted={() => posted(c)} onDrop={() => drop(c)} />)}
            </div>
          ))}
      </Panel>
      <div className="groups mt">
        <Panel title="Ready to connect" extra={<span className="small muted">{connect.length}</span>}>
          {connect.length === 0 ? <p className="empty">Nobody yet. A person shows here the day after you post a comment on their post.</p>
            : connect.map(({ c, p, days }) => (
              <div key={p.id} className="job">
                <div className="job-main">
                  <span className="card-title">{p.name}</span>
                  <span className="meta">{p.title && <span>{p.title}</span>}{p.company && <span>{p.company}</span>}<span>Commented {days === 1 ? 'yesterday' : `${days} days ago`} ({mdLabel(c.posted_at.slice(0, 10))})</span></span>
                </div>
                <div className="btn-row">
                  <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer">Open profile</a>
                  <button className="linkbtn" type="button" onClick={() => stage(p, 'Connected')}>I sent the request</button>
                </div>
              </div>
            ))}
        </Panel>
        <People people={people} comments={comments.rows} onStage={stage} />
      </div>
      <Panel title="Latest run" eyebrow={brief?.extra?.Date ? mdLabel(brief.extra.Date) : 'Not run yet'} className="mt">
        {brief ? <div className="md"><Markdown text={brief.body} /></div>
          : <p className="empty">Athena's brief shows here after the first run: who is not active, what was skipped, and what the scan cost.</p>}
      </Panel>
    </div>
  );
}

function groupByPerson(list, byId) {
  const groups = new Map();
  for (const c of list) {
    if (!groups.has(c.person_id)) groups.set(c.person_id, { p: byId[c.person_id], list: [] });
    groups.get(c.person_id).list.push(c);
  }
  return [...groups.values()].sort((a, b) => (b.p.score - a.p.score) || a.p.name.localeCompare(b.p.name));
}

function Draft({ c, onPosted, onDrop }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.comment); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* the text is right there to select */ }
  };
  return (
    <div className="draft">
      <div className="meta">
        <a href={c.post_url} target="_blank" rel="noreferrer">Open the post</a>
        <span>Posted {mdLabel(c.post_date)}</span>
        <span>Drafted {mdLabel(c.staged_on)}</span>
      </div>
      <p className="small muted" style={{ margin: '4px 0' }}>{c.summary}</p>
      <div className="draft-text">{c.comment}</div>
      <div className="btn-row">
        <button className="btn small" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy comment'}</button>
        <button className="btn ghost small" type="button" onClick={onPosted}>I posted it</button>
        <button className="linkbtn quiet" type="button" onClick={onDrop}>Skip this one</button>
      </div>
    </div>
  );
}

function RunBar({ staged, brief }) {
  const store = useJobs();
  const job = store.jobs && store.jobs.find((j) => j.key === JOB);
  const run = store.runs[JOB];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setMsg('');
    try { const { startError } = await runJob(job); setMsg(startError || 'Athena is reading their posts. New drafts show here in a few minutes.'); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="notice soft find-ideas">
      <div>
        <strong>Comment first, then connect</strong>
        <p>Athena finds recent posts by the people you watch and drafts a comment for each. You copy, edit and post them on LinkedIn yourself. Nothing here posts for you.</p>
        <p className="small">Batch 1: {staged} of {BATCH_TARGET} comments drafted{job ? (job.enabled ? '. The job runs weekday mornings.' : '. The job is off in Settings, so it only runs from this button.') : '.'}{brief?.extra?.Date ? ` Last run ${mdLabel(brief.extra.Date)}.` : ''}</p>
        {working && <p className="small">Athena is working on it now.</p>}
        {run?.status === 'failed' && !working && <p className="small late">The last run did not finish: {(run.error || '').slice(0, 200)}</p>}
        {msg && <p className="small">{msg}</p>}
        {!job && store.jobs && <p className="small late">The LinkedIn comments job is not in the database yet. Run the migration first.</p>}
      </div>
      {working ? <span className="pill info">Working…</span>
        : <button className="btn small" type="button" onClick={go} disabled={!job}>Run now</button>}
    </div>
  );
}

function People({ people, comments, onStage }) {
  const [f, setF] = useState({ name: '', title: '', company: '', url: '', tier: '1', score: '5', notes: '' });
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => comments.reduce((acc, c) => { acc[c.person_id] = (acc[c.person_id] || 0) + 1; return acc; }, {}), [comments]);
  const rows = people.rows.filter((p) => showAll || p.stage !== 'Stop');

  const add = async (e) => {
    e.preventDefault();
    const url = f.url.trim();
    if (!f.name.trim()) return setMsg('A name, please.');
    if (!/^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i.test(url)) return setMsg('The link must be a LinkedIn profile, like https://www.linkedin.com/in/their-name/');
    if (people.rows.some((p) => p.url.replace(/\/$/, '').toLowerCase() === url.replace(/\/$/, '').toLowerCase())) return setMsg('That person is already on the list.');
    try {
      await people.create({ name: f.name.trim(), title: f.title.trim() || null, company: f.company.trim() || null, url, tier: Number(f.tier), score: Number(f.score) || 0, notes: f.notes.trim() || null });
      setF({ ...f, name: '', title: '', company: '', url: '', notes: '' }); setMsg(`Added ${f.name.trim()}. Athena reads their posts on the next run.`);
    } catch (err) { setMsg(err.message); }
  };
  const remove = async (p) => {
    if (!confirm(`Take ${p.name} off the list? Their drafts go too.`)) return;
    try { await people.remove(p.id); } catch (e) { setMsg(e.message); }
  };

  return (
    <Panel title="People to watch" extra={<span className="small muted">{rows.length}</span>}>
      <form className="add" onSubmit={add}>
        <label className="f">Name<input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="f">What they do<input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Breathwork facilitator" /></label>
        <label className="f">Business<input type="text" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className="f">LinkedIn profile link<input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://www.linkedin.com/in/their-name/" /></label>
        <label className="f">Tier<select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}><option value="1">1, the people this is for</option><option value="2">2, extras</option></select></label>
        <label className="f">Priority 1 to 10<input type="number" min="0" max="10" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></label>
        <label className="f wide">Notes for Athena<input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="How you know them, what they post about" /></label>
        <div className="actions"><button className="btn" type="submit">Add</button><p className="d-msg">{msg}</p></div>
      </form>
      {rows.length === 0 ? <p className="empty">Nobody yet. Add the people you want to be seen by, highest priority first.</p>
        : <div className="jobs">
          {rows.map((p) => (
            <div key={p.id} className="job">
              <div className="job-main">
                <span className="card-title"><a href={p.url} target="_blank" rel="noreferrer">{p.name}</a></span>
                <span className="meta">
                  {p.title && <span>{p.title}</span>}
                  {p.company && <span>{p.company}</span>}
                  <span>Tier {p.tier}, priority {p.score}</span>
                  {counts[p.id] ? <span>{counts[p.id]} {counts[p.id] === 1 ? 'comment' : 'comments'}</span> : null}
                  {p.last_scanned_on && <span>{p.last_post_on ? `Last post ${mdLabel(p.last_post_on)}` : `No recent posts as of ${mdLabel(p.last_scanned_on)}`}</span>}
                </span>
                {p.notes && <span className="small muted">{p.notes}</span>}
              </div>
              <div className="btn-row">
                <select aria-label={`Stage for ${p.name}`} value={p.stage} onChange={(e) => onStage(p, e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
                <button className="linkbtn quiet" type="button" onClick={() => remove(p)}>Remove</button>
              </div>
            </div>
          ))}
        </div>}
      {people.rows.some((p) => p.stage === 'Stop') && (
        <button className="linkbtn quiet" type="button" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide the Stop list' : 'Show the Stop list'}</button>
      )}
    </Panel>
  );
}
