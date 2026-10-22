import { useEffect, useMemo, useState } from 'react';
import { useRows } from '../lib/rows.js';
import { runJob, useJobs } from '../lib/jobs.js';
import { addDays, mdLabel, todayYMD } from '../lib/dates.js';
import { Skel } from '../components/bits.jsx';
import { NAMES, audience, formatWord, nextWeekTip, pct, scorecard, shortNum, strongestLine, times } from '../lib/social.js';

// Social Media: a weekly scorecard of how her own posts did, each one compared with her own usual
// on that platform and format, plus her audience on every account. The Post numbers job
// (athena/stats.py pull) fills posts, post_metrics and follower_snapshots. This page only reads.
const JOB = 'post_numbers';
const POST_COLS = 'id,platform,source,post_url,posted_at,caption,format';
const METRIC_COLS = 'id,post_id,fetched_at,views,reach,likes,comments,saves,shares';
const fDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const VERDICT = { worked: ['Worked', 'ok'], missed: ["Didn't land", 'danger'], normal: ['Normal', ''], new: ['Too new to judge', 'info'], unknown: ['No numbers yet', ''] };
const clip = (t, n = 120) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s || '(no caption)'; };
const where = (r) => `${NAMES[r.platform] || r.platform} ${formatWord(r.platform, r.format)}`;

export default function Social() {
  const posts = useRows('posts', POST_COLS, { column: 'posted_at', ascending: false });
  const metrics = useRows('post_metrics', METRIC_COLS, { column: 'fetched_at', ascending: false });
  const accounts = useRows('social_accounts', 'id,platform,url,label,created_at', { column: 'created_at', ascending: true });
  const snaps = useRows('follower_snapshots', 'id,account_id,taken_on,followers,taken_at', { column: 'taken_on', ascending: true });

  const card = useMemo(() => (posts.rows && metrics.rows ? scorecard(posts.rows, metrics.rows) : null), [posts.rows, metrics.rows]);
  const aud = useMemo(() => (accounts.rows && snaps.rows ? audience(accounts.rows, snaps.rows) : null), [accounts.rows, snaps.rows]);
  const lastPull = (metrics.rows || []).reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), '');
  const reloadAll = () => { posts.reload(); metrics.reload(); snaps.reload(); };

  const err = posts.error || metrics.error || accounts.error || snaps.error;
  if (err) return <div className="notice"><strong>This page did not load</strong><p>{err}</p><p>If it says a table or column does not exist, the database step for this page has not been run yet.</p></div>;
  if (!card || !aud) return <Skel />;

  const today = todayYMD();
  const tip = nextWeekTip(card);
  const line = strongestLine(card.strongest);

  return (
    <section className="social">
      <header className="sc-hero">
        <div className="sc-hero-text">
          <p className="sc-kicker">✦ ColibriOS · Social scorecard</p>
          <h2>How your posts <em>actually did</em> this week.</h2>
          <p>Instagram, Facebook, LinkedIn and YouTube in one place. Every post is compared with your own usual on that platform, so you can see what to make more of.</p>
        </div>
        <div className="sc-week">
          <strong>Week of {mdLabel(addDays(today, -6))} to {mdLabel(today)}</strong>
          <span>{card.week.length === 1 ? '1 post' : `${card.week.length} posts`} this week</span>
        </div>
      </header>

      <RunBar lastPull={lastPull} onDone={reloadAll} />

      <h3 className="sc-label">✦ Your audience</h3>
      <div className="sc-aud">
        <div className="sc-acard all">
          <span className="sc-pill dark">All platforms</span>
          <strong>{aud.total == null ? '·' : aud.total.toLocaleString('en-US')}</strong>
          <span className="small muted">total audience</span>
          <Delta d={aud.totalDelta} tail="since last check" />
        </div>
        {aud.cards.map((c) => (
          <div key={c.id} className="sc-acard">
            <div className="sc-acard-top"><span className={'sc-pill ' + c.platform}>{c.label}</span><Spark points={c.series} /></div>
            <strong>{c.followers == null ? '·' : c.followers.toLocaleString('en-US')}</strong>
            <span className="small muted">{c.platform === 'youtube' ? 'subscribers' : 'followers'}</span>
            {c.followers == null ? <span className="small muted">Shows after the next refresh</span>
              : c.delta == null ? <span className="small muted">Change shows after the next refresh</span>
                : <Delta d={c.delta} pctV={c.deltaPct} tail={`since ${mdLabel(c.since)}`} />}
          </div>
        ))}
      </div>

      {line && <p className="sc-callout">{line}</p>}

      <div className="sc-two">
        <div>
          <h3 className="sc-label">✦ What worked</h3>
          {card.worked.length === 0 ? <p className="empty">Nothing hit 1.5 times your usual this week yet.</p>
            : card.worked.map((r) => <Highlight key={r.id} r={r} good />)}
        </div>
        <div>
          <h3 className="sc-label">✦ What didn't</h3>
          {card.missed.length === 0 ? <p className="empty">Nothing came in under your usual this week.</p>
            : card.missed.map((r) => <Highlight key={r.id} r={r} />)}
        </div>
      </div>

      <h3 className="sc-label">✦ This week vs last week</h3>
      {card.compare.length === 0 ? <p className="empty">No posts in the last two weeks.</p> : (
        <div className="panel flush table-wrap">
          <table className="sc sc-table">
            <thead><tr><th>Platform</th><th>Posts</th><th>Views</th><th>Likes + comments + shares</th></tr></thead>
            <tbody>
              {card.compare.map((c) => (
                <tr key={c.platform}>
                  <td>{NAMES[c.platform] || c.platform}</td>
                  <td>{c.posts} vs {c.postsBefore}</td>
                  <td>{c.views == null ? <span className="muted">n/a</span> : <>{shortNum(c.views)} <Pct v={pct(c.views, c.viewsBefore)} /></>}</td>
                  <td>{c.eng == null ? <span className="muted">·</span> : <>{shortNum(c.eng)} <Pct v={pct(c.eng, c.engBefore)} /></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Last week's posts have had more time to grow, so the fair comparison is posts made and engagement earned. LinkedIn does not show views publicly.</p>

      <h3 className="sc-label">✦ Every post this week</h3>
      {card.week.length === 0 ? <p className="empty">No posts in the last 7 days.</p> : (
        <div className="panel flush table-wrap">
          <table className="sc sc-table sc-posts">
            <thead><tr><th>Where</th><th className="post-cell">Post</th><th>Posted</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Verdict</th></tr></thead>
            <tbody>
              {card.week.map((r) => {
                const [label, tone] = VERDICT[r.verdict];
                return (
                  <tr key={r.id}>
                    <td><span className={'sc-pill ' + r.platform}>{NAMES[r.platform] || r.platform}</span><span className="small muted sc-fmt">{formatWord(r.platform, r.format)}</span></td>
                    <td className="post-cell small">{r.post_url ? <a href={r.post_url} target="_blank" rel="noreferrer">{clip(r.caption)}</a> : clip(r.caption)}</td>
                    <td className="small">{fDay.format(new Date(r.posted_at))}</td>
                    <td>{shortNum(r.m?.views)}</td><td>{shortNum(r.m?.likes)}</td><td>{shortNum(r.m?.comments)}</td><td>{shortNum(r.m?.shares)}</td>
                    <td className="sc-verdict"><span className={'pill ' + tone}>{label}</span>{r.ratio != null && r.verdict !== 'new' && <span className="small muted">{times(r.ratio)} your usual</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">"Worked" means 1.5 times your usual or more for that platform and format. "Didn't land" means half or less. Posts under 48 hours old are too new to judge and get graded next week. A dash means the platform did not share that number.</p>

      <div className="sc-next">
        <p className="sc-kicker">Next week 🧡</p>
        <h3>{tip.title}</h3>
        <p>{tip.body}</p>
      </div>
      <p className="small muted sc-foot">Social scorecard · {lastPull ? `numbers from ${fWhen.format(new Date(lastPull))}` : 'no numbers yet'}</p>
    </section>
  );
}

function Delta({ d, pctV, tail }) {
  if (d == null) return null;
  const up = d >= 0;
  return (
    <span className={'sc-delta ' + (up ? 'up' : 'down')}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{d.toLocaleString('en-US')}{pctV != null && <span className="muted"> ({up ? '+' : ''}{pctV}%)</span>} <span className="muted">{tail}</span>
    </span>
  );
}

function Pct({ v }) {
  if (v == null) return null;
  return <span className={'sc-pct ' + (v >= 0 ? 'up' : 'down')}>{v >= 0 ? '+' : ''}{v}%</span>;
}

function Spark({ points }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 60},${18 - ((p - min) / span) * 16}`).join(' ');
  return <svg className="sc-spark" viewBox="0 0 60 20" aria-hidden="true"><polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function Highlight({ r, good }) {
  return (
    <a className={'sc-hl' + (good ? ' good' : '')} href={r.post_url || undefined} target="_blank" rel="noreferrer">
      <span className="small muted">{where(r)} · {fDay.format(new Date(r.posted_at))}</span>
      <span className="sc-hl-cap">{clip(r.caption, 110)}</span>
      <strong>{times(r.ratio)} your usual</strong>
      <span className="small muted">{r.platform === 'linkedin' ? `${shortNum(r.score)} reactions, comments and shares` : `${shortNum(r.score)} views`} · usual {shortNum(r.usual)}</span>
    </a>
  );
}

function RunBar({ lastPull, onDone }) {
  const store = useJobs();
  const job = store.jobs && store.jobs.find((j) => j.key === JOB);
  const run = store.runs[JOB];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const [msg, setMsg] = useState('');
  const [was, setWas] = useState(null);
  useEffect(() => {
    if ((was === 'queued' || was === 'running') && run?.status === 'done') { onDone(); setMsg(''); }
    setWas(run?.status || null);
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setMsg('');
    try { const { startError } = await runJob(job); setMsg(startError || 'Athena is bringing the numbers in. They show here in a few minutes.'); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="notice soft find-ideas">
      <div>
        <strong>{lastPull ? `Numbers from ${fWhen.format(new Date(lastPull))}` : 'No numbers yet'}</strong>
        <p>{job?.enabled ? 'These refresh by themselves every Monday at 7:00 AM.' : 'Automatic refresh is off (Settings, Post numbers), so they refresh from this button.'} Instagram and Facebook numbers come from Blotato about once a week.</p>
        {working && <p className="small">Athena is working on it now.</p>}
        {run?.status === 'failed' && !working && <p className="small late">The last run did not finish: {(run.error || '').slice(0, 200)}</p>}
        {msg && <p className="small">{msg}</p>}
      </div>
      {working ? <span className="pill info">Working…</span>
        : <button className="btn small" type="button" onClick={go} disabled={!job}>Refresh numbers</button>}
    </div>
  );
}

