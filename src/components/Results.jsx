import { useMemo, useState } from 'react';
import { useRows } from '../lib/rows.js';
import { runJob, useJobs } from '../lib/jobs.js';
import { addDays, mdLabel, todayYMD, ymdOf } from '../lib/dates.js';
import { Markdown } from '../lib/markdown.jsx';
import { Panel, Skel } from './bits.jsx';

// Results: how her social posts did. The job "Post numbers" (athena/stats.py) copies Instagram and
// Facebook numbers from Blotato and her own LinkedIn posts from a public scan into posts and
// post_metrics, about once a week. This tab only reads them. Nothing here posts anywhere.
const JOB = 'post_numbers';
const NOTE_PAGE = 'Post numbers';
const POST_COLS = 'id,platform,source,external_id,post_url,posted_at,caption,content_id,updated_at';
const METRIC_COLS = 'id,post_id,fetched_at,views,reach,likes,comments,saves,shares,follows,clicks';
const NAMES = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube', twitter: 'X', other: 'Other' };
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Results({ content, pages }) {
  const posts = useRows('posts', POST_COLS, { column: 'posted_at', ascending: false });
  const metrics = useRows('post_metrics', METRIC_COLS, { column: 'fetched_at', ascending: false });
  const [open, setOpen] = useState(null);
  const note = (pages.rows || []).find((p) => p.title === NOTE_PAGE && p.folder === 'Athena');

  const { groups, strip } = useMemo(() => build(posts.rows || [], metrics.rows || [], content || []), [posts.rows, metrics.rows, content]);

  if (posts.error || metrics.error) return <div className="notice"><strong>Results did not load</strong><p>{posts.error || metrics.error}</p></div>;
  if (!posts.rows || !metrics.rows) return <Skel />;

  return (
    <div className="results">
      <RunBar note={note} count={posts.rows.length} />
      <div className="strip" aria-label="Last 7 days">
        {strip.map((s) => (
          <div key={s.label} className="stat">
            <p className="eyebrow">{s.label}</p>
            <strong>{s.now == null ? '·' : s.now.toLocaleString('en-US')}</strong>
            <span className="small muted">{s.before == null ? 'Last 7 days' : `Last 7 days, ${s.before.toLocaleString('en-US')} the week before`}</span>
          </div>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="empty">No posts yet. Press Refresh numbers once your Blotato posts and LinkedIn profile are set up, and they show here.</p>
      ) : (
        <div className="panel flush table-wrap mt">
          <table className="sc results-table">
            <thead><tr><th>Posted</th><th className="post-cell">Post</th><th className="chan">Channels</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Saves + shares</th><th>As of</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Group key={g.key} g={g} open={open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Instagram and Facebook come from Blotato, which refreshes about once a week. LinkedIn comes from a public scan of your profile: reactions, comments and shares only. A dot means not collected, never zero.</p>
      <Panel title="Latest run" eyebrow={note?.extra?.Date ? mdLabel(note.extra.Date) : 'Not run yet'} className="mt">
        {note ? <div className="md"><Markdown text={note.body} /></div>
          : <p className="empty">Athena's note shows here after the first run: what came in, the best post of the week, and anything that did not work.</p>}
      </Panel>
    </div>
  );
}

function Group({ g, open, onToggle }) {
  return (
    <>
      <tr className={'grp' + (open ? ' open' : '')}>
        <td>{mdLabel(g.day)}</td>
        <td className="post-cell"><button className="linkbtn left" type="button" onClick={onToggle} aria-expanded={open}>{g.title}</button></td>
        <td className="chan">{g.posts.map((p) => <span key={p.id} className="chip">{NAMES[p.platform] || p.platform}</span>)}</td>
        <Num v={g.sum.reach} /><Num v={g.sum.views} /><Num v={g.sum.likes} /><Num v={g.sum.comments} /><Num v={g.sum.shares} />
        <td className="small muted">{g.asOf ? mdLabel(ymdOf(new Date(g.asOf))) : '·'}</td>
      </tr>
      {open && g.posts.map((p) => (
        <tr key={p.id} className="sub">
          <td className="small muted">{fWhen.format(new Date(p.posted_at))}</td>
          <td className="post-cell small">
            {p.post_url ? <a href={p.post_url} target="_blank" rel="noreferrer">Open on {NAMES[p.platform] || p.platform}</a> : <span className="muted">{NAMES[p.platform] || p.platform}</span>}
            {p.history.length > 0 && <span className="muted"> · {p.history.length === 1 ? '1 snapshot' : `${p.history.length} snapshots, first ${mdLabel(ymdOf(new Date(p.history[p.history.length - 1].fetched_at)))}`}</span>}
          </td>
          <td className="chan"><span className="chip">{NAMES[p.platform] || p.platform}</span></td>
          <Num v={p.latest?.reach} /><Num v={p.latest?.views} /><Num v={p.latest?.likes} /><Num v={p.latest?.comments} /><Num v={sumOf(p.latest, ['saves', 'shares'])} />
          <td className="small muted">{p.latest ? mdLabel(ymdOf(new Date(p.latest.fetched_at))) : 'No numbers yet'}</td>
        </tr>
      ))}
    </>
  );
}

function Num({ v }) {
  return <td className={v == null ? 'blank' : ''}>{v == null ? '·' : v.toLocaleString('en-US')}</td>;
}

function sumOf(m, keys) {
  if (!m) return null;
  const vals = keys.map((k) => m[k]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

// One row per post group: the same piece (content_id) or the same caption on the same day across channels.
function build(posts, metrics, content) {
  const byPost = {};
  for (const m of metrics) (byPost[m.post_id] ||= []).push(m);  // newest first, as loaded
  const titles = Object.fromEntries(content.map((c) => [c.id, c.title]));
  const groups = new Map();
  for (const p of posts) {
    const history = byPost[p.id] || [];
    const row = { ...p, history, latest: history[0] || null };
    const day = ymdOf(new Date(p.posted_at));
    const key = p.content_id || `${day}|${capKey(p.caption)}`;
    if (!groups.has(key)) groups.set(key, { key, day, title: titles[p.content_id] || start(p.caption), posts: [], sum: {}, asOf: null });
    const g = groups.get(key);
    g.posts.push(row);
    if (day < g.day) g.day = day;
    if (row.latest) {
      for (const k of ['reach', 'views', 'likes', 'comments']) if (row.latest[k] != null) g.sum[k] = (g.sum[k] || 0) + row.latest[k];
      const sh = sumOf(row.latest, ['saves', 'shares']);
      if (sh != null) g.sum.shares = (g.sum.shares || 0) + sh;
      if (!g.asOf || row.latest.fetched_at > g.asOf) g.asOf = row.latest.fetched_at;
    }
  }
  const list = [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const today = todayYMD();
  const week = (from, to) => {
    const rows = posts.filter((p) => { const d = ymdOf(new Date(p.posted_at)); return d >= from && d <= to; });
    const tot = (k) => { const vals = rows.map((p) => (byPost[p.id] || [])[0]?.[k]).filter((v) => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; };
    const eng = rows.map((p) => sumOf((byPost[p.id] || [])[0], ['likes', 'comments', 'saves', 'shares'])).filter((v) => v != null);
    return { posts: rows.length, reach: tot('reach'), views: tot('views'), engagement: eng.length ? eng.reduce((a, b) => a + b, 0) : null };
  };
  const now = week(addDays(today, -6), today);
  const before = week(addDays(today, -13), addDays(today, -7));
  const strip = [
    { label: 'Posts', now: now.posts, before: before.posts },
    { label: 'Reach', now: now.reach, before: before.reach },
    { label: 'Views', now: now.views, before: before.views },
    { label: 'Engagement', now: now.engagement, before: before.engagement },
  ];
  return { groups: list, strip };
}

const capKey = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
const start = (t) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > 70 ? s.slice(0, 70).replace(/\s\S*$/, '') + '…' : s || 'Untitled post'; };

function RunBar({ note, count }) {
  const store = useJobs();
  const job = store.jobs && store.jobs.find((j) => j.key === JOB);
  const run = store.runs[JOB];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setMsg('');
    try { const { startError } = await runJob(job); setMsg(startError || 'Athena is bringing the numbers in. They show here in a few minutes.'); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="notice soft find-ideas">
      <div>
        <strong>How your posts did</strong>
        <p>Athena copies the numbers in from Blotato and LinkedIn. Nothing here posts or schedules anything.</p>
        <p className="small">{count === 1 ? '1 post' : `${count} posts`} on record{job ? (job.enabled ? '. The job runs Mondays at 7:00 AM.' : '. The job is off in Settings, so it only runs from this button.') : '.'}{note?.extra?.Date ? ` Last run ${mdLabel(note.extra.Date)}.` : ''}</p>
        {working && <p className="small">Athena is working on it now.</p>}
        {run?.status === 'failed' && !working && <p className="small late">The last run did not finish: {(run.error || '').slice(0, 200)}</p>}
        {msg && <p className="small">{msg}</p>}
        {!job && store.jobs && <p className="small late">The Post numbers job is not in the database yet. Run the migration first.</p>}
      </div>
      {working ? <span className="pill info">Working…</span>
        : <button className="btn small" type="button" onClick={go} disabled={!job}>Refresh numbers</button>}
    </div>
  );
}
