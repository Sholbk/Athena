import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRows } from '../lib/rows.js';
import { runJob, useJobs } from '../lib/jobs.js';
import { mdLabel, ymdOf } from '../lib/dates.js';
import { Markdown } from '../lib/markdown.jsx';
import { Panel, Skel } from '../components/bits.jsx';

// Viral Outlier Review: which recent reels from the accounts she watches did far better than usual.
// The job "Viral Outlier Review" (athena/outliers.py, Mondays 6:30 AM or Refresh now) fills
// outlier_reels with the last 14 days through Apify. This page only reads. Nothing here posts.
const JOB = 'outlier_review';
const NOTE_PAGE = 'Viral Outlier Review';
const REEL_COLS = 'id,short_code,account_url,creator,url,posted_at,views,likes,comments,caption,hook,hook_from,creator_median,times_usual,is_outlier,outlier_reason,fetched_at';
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const n = (v) => (v == null ? '·' : Number(v).toLocaleString('en-US'));
const day = (iso) => mdLabel(ymdOf(new Date(iso)));
const handle = (url) => ((url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || url || '').toLowerCase();

export default function Outliers() {
  const reels = useRows('outlier_reels', REEL_COLS, { column: 'times_usual', ascending: false });
  const accounts = useRows('outlier_accounts', 'id,url,label,created_at', { column: 'created_at', ascending: true });
  const [note, setNote] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const loadNote = useCallback(async () => {
    const { data } = await supabase.from('pages').select('body,extra,updated_at')
      .eq('title', NOTE_PAGE).eq('folder', 'Athena').is('deleted_at', null).maybeSingle();
    setNote(data || null);
  }, []);
  useEffect(() => { loadNote(); }, [loadNote]);
  const reloadAll = useCallback(() => { reels.reload(); loadNote(); }, [reels.reload, loadNote]);

  const rows = reels.rows || [];
  const outliers = useMemo(() => rows.filter((r) => r.is_outlier).sort(rank), [rows]);
  const lastRun = rows.reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), '');

  if (reels.error || accounts.error) {
    return <div className="notice"><strong>This page did not load</strong><p>{reels.error || accounts.error}</p><p>If it says the table does not exist, the database step for this page has not been run yet.</p></div>;
  }

  return (
    <section className="outliers">
      <div className="week-head">
        <div><p className="eyebrow">Instagram reels, last 14 days</p><h2>Viral Outlier Review</h2></div>
      </div>
      <RunBar lastRun={lastRun} onDone={reloadAll} />
      {!reels.rows ? <Skel /> : (
        <>
          <div className="strip" aria-label="This review">
            <Stat label="Reels checked" value={rows.length} />
            <Stat label="Outliers" value={outliers.length} />
            <Stat label="Biggest" value={outliers[0]?.times_usual ? `${fmtX(outliers[0].times_usual)} usual` : '·'} />
            <Stat label="Refreshed" value={lastRun ? day(lastRun) : '·'} sub={lastRun ? fWhen.format(new Date(lastRun)) : 'Not yet'} />
          </div>
          {outliers.length === 0 ? (
            <p className="empty mt">{rows.length ? 'No reel in the last 14 days beat 3 times its creator\'s usual views or reached 10,000 likes.' : 'Nothing here yet. Press Refresh now and the reels show up in a few minutes.'}</p>
          ) : (
            <ol className="ol-list mt">{outliers.map((r, i) => <OutlierCard key={r.id} r={r} rank={i + 1} />)}</ol>
          )}
          <Watching accounts={accounts.rows} rows={rows} />
          <div className="mt">
            <label className="calopt"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every reel checked</label>
            {showAll && <AllReels rows={rows} />}
          </div>
          <Panel title="Latest run" eyebrow={note?.extra?.Date ? mdLabel(note.extra.Date) : 'Not run yet'} className="mt">
            {note ? <div className="md"><Markdown text={note.body} /></div>
              : <p className="empty">After each run, a short note shows here: how many reels came in, the biggest outlier, and what it cost.</p>}
          </Panel>
          <p className="small muted">An outlier has 10,000 likes or more, or at least 3 times that creator's usual views. Usual means the middle value of their reels from the same 14 days. Only outliers get a transcript, and each run is capped at $3 in Apify costs. A dot means Instagram did not show the number.</p>
        </>
      )}
    </section>
  );
}

function rank(a, b) {
  return (Number(b.times_usual) || 0) - (Number(a.times_usual) || 0) || (b.likes || 0) - (a.likes || 0);
}
const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
const fmtX = (x) => `${Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 })}x`;

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <p className="eyebrow">{label}</p>
      <strong>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</strong>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function OutlierCard({ r, rank: place }) {
  const likesOnly = r.outlier_reason === 'likes';
  return (
    <li className="ol-card">
      <div className="ol-score">
        <span className="ol-rank">{place}</span>
        <strong>{r.times_usual != null ? fmtX(r.times_usual) : '·'}</strong>
        <span className="small muted">{r.times_usual != null ? 'usual views' : 'no views shown'}</span>
        {(likesOnly || r.outlier_reason === 'both') && <span className="pill ok">10,000+ likes</span>}
      </div>
      <div className="ol-body">
        <div className="ol-top">
          <span className="chip">@{r.creator}</span>
          {handle(r.account_url) && handle(r.account_url) !== r.creator && <span className="small muted">watched as @{handle(r.account_url)}</span>}
          <span className="small muted">{day(r.posted_at)}</span>
        </div>
        {r.hook ? (
          <p className="ol-hook">“{r.hook}”{r.hook_from === 'caption' && <span className="small muted"> (no transcript, from the caption)</span>}</p>
        ) : <p className="ol-hook muted">No hook found.</p>}
        {r.caption && (
          <details className="ol-cap">
            <summary><span className="clamp2">{r.caption}</span></summary>
            <p>{r.caption}</p>
          </details>
        )}
        <dl className="ol-nums">
          <div><dt>Views</dt><dd>{n(r.views)}</dd></div>
          <div><dt>Usual</dt><dd>{n(r.creator_median)}</dd></div>
          <div><dt>Likes</dt><dd>{n(r.likes)}</dd></div>
          <div><dt>Comments</dt><dd>{n(r.comments)}</dd></div>
        </dl>
      </div>
      <a className="btn small ol-watch" href={r.url} target="_blank" rel="noreferrer">Watch on Instagram</a>
    </li>
  );
}

function Watching({ accounts, rows }) {
  if (!accounts) return null;
  return (
    <Panel title="Accounts watched" className="mt">
      <ul className="plain">
        {accounts.map((a) => {
          const h = handle(a.url);
          const mine = rows.filter((r) => handle(r.account_url) === h || r.creator === h);
          const names = [...new Set(mine.map((r) => r.creator))].filter((c) => c !== h);
          return (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer">@{a.label || h}</a>
              {names.length > 0 && <span className="muted"> (posts as @{names.join(', @')})</span>}
              <span className="muted">: {mine.length ? `${plural(mine.length, 'reel')}, usual views ${n(mine[0].creator_median)}, ${plural(mine.filter((r) => r.is_outlier).length, 'outlier')}` : 'no reels in the last 14 days'}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function AllReels({ rows }) {
  const sorted = [...rows].sort(rank);
  return (
    <div className="panel flush table-wrap mt">
      <table className="sc results-table">
        <thead><tr><th>Posted</th><th className="post-cell">Reel</th><th>Views</th><th>Times usual</th><th>Likes</th><th>Comments</th></tr></thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{day(r.posted_at)}</td>
              <td className="post-cell small"><a href={r.url} target="_blank" rel="noreferrer">@{r.creator}</a> <span className="muted">{(r.hook || '').slice(0, 80)}</span> {r.is_outlier && <span className="pill ok">Outlier</span>}</td>
              <td className={r.views == null ? 'blank' : ''}>{n(r.views)}</td>
              <td className={r.times_usual == null ? 'blank' : ''}>{r.times_usual == null ? '·' : fmtX(r.times_usual)}</td>
              <td className={r.likes == null ? 'blank' : ''}>{n(r.likes)}</td>
              <td className={r.comments == null ? 'blank' : ''}>{n(r.comments)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunBar({ lastRun, onDone }) {
  const store = useJobs();
  const job = store.jobs && store.jobs.find((j) => j.key === JOB);
  const run = store.runs[JOB];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const [msg, setMsg] = useState('');
  const [was, setWas] = useState(null);
  useEffect(() => {
    if (was && (was === 'queued' || was === 'running') && run?.status === 'done') { onDone(); setMsg(''); }
    setWas(run?.status || null);
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setMsg('');
    try { const { startError } = await runJob(job); setMsg(startError || 'Athena is pulling the reels. They show here in a few minutes.'); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="notice soft find-ideas">
      <div>
        <strong>Fresh every Monday</strong>
        <p>{job ? (job.enabled ? 'This refreshes by itself every Monday at 6:30 AM.' : 'The Monday refresh is off in Settings, so it only runs from this button.') : 'Reads the last 14 days of reels through Apify.'}{lastRun ? ` Last refreshed ${fWhen.format(new Date(lastRun))}.` : ''}</p>
        {working && <p className="small">Pulling reels now.</p>}
        {run?.status === 'failed' && !working && <p className="small late">The last run did not finish: {(run.error || '').slice(0, 200)}</p>}
        {msg && <p className="small">{msg}</p>}
        {!job && store.jobs && <p className="small late">The Viral Outlier Review job is not in the database yet. Run the database step first.</p>}
      </div>
      {working ? <span className="pill info">Working…</span>
        : <button className="btn small" type="button" onClick={go} disabled={!job}>Refresh now</button>}
    </div>
  );
}
