import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRows } from '../lib/rows.js';
import { clock, runJob, useJobs } from '../lib/jobs.js';
import { addDays, mdLabel, todayYMD } from '../lib/dates.js';
import { Markdown } from '../lib/markdown.jsx';
import { Skel } from '../components/bits.jsx';
import { NAMES, WINDOW_DAYS, audience, formatWord, nextWeekTip, pct, scorecard, shortNum, strongestLine, times } from '../lib/social.js';

// Social Media: her weekly scorecard. Every post from the last 30 days on Instagram, Facebook and
// LinkedIn (plus YouTube) is compared with her own median for that platform. The Social scorecard job
// (athena/stats.py scorecard, Fridays, no Claude) pulls everything through Apify. This page only reads.
const JOB = 'social_scorecard';
const NOTE_PAGE = 'Social scorecard';
const POST_COLS = 'id,platform,source,post_url,posted_at,caption,format,account_id';
const METRIC_COLS = 'id,post_id,fetched_at,views,reach,likes,comments,saves,shares';
const fDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });
const fWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const VERDICT = { worked: ['Worked', 'ok'], missed: ["Didn't land", 'danger'], normal: ['Normal', ''], new: ['Too new', 'info'], unknown: ['No numbers yet', ''] };
const clip = (t, n = 120) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s || '(no caption)'; };

export default function Social() {
  const posts = useRows('posts', POST_COLS, { column: 'posted_at', ascending: false });
  const metrics = useRows('post_metrics', METRIC_COLS, { column: 'fetched_at', ascending: false });
  const accounts = useRows('social_accounts', 'id,platform,url,label,created_at', { column: 'created_at', ascending: true });
  const snaps = useRows('follower_snapshots', 'id,account_id,taken_on,followers,taken_at', { column: 'taken_on', ascending: true });
  const [note, setNote] = useState(null);
  const loadNote = useCallback(async () => {
    const { data } = await supabase.from('pages').select('body,extra').eq('title', NOTE_PAGE).eq('folder', 'Athena').is('deleted_at', null).maybeSingle();
    setNote(data || null);
  }, []);
  useEffect(() => { loadNote(); }, [loadNote]);

  const card = useMemo(() => (posts.rows && metrics.rows ? scorecard(posts.rows, metrics.rows) : null), [posts.rows, metrics.rows]);
  const aud = useMemo(() => (accounts.rows && snaps.rows ? audience(accounts.rows, snaps.rows) : null), [accounts.rows, snaps.rows]);
  const labels = useMemo(() => Object.fromEntries((accounts.rows || []).map((a) => [a.id, a.label])), [accounts.rows]);
  const lastPull = (metrics.rows || []).reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), '');
  const reloadAll = () => { posts.reload(); metrics.reload(); snaps.reload(); loadNote(); };

  const err = posts.error || metrics.error || accounts.error || snaps.error;
  if (err) return <div className="notice"><strong>This page did not load</strong><p>{err}</p><p>If it says a table or column does not exist, the database step for this page has not been run yet.</p></div>;
  if (!card || !aud) return <Skel />;

  const today = todayYMD();
  const tip = nextWeekTip(card);
  const line = strongestLine(card.best[0]);
  const where = (r) => labels[r.account_id] && labels[r.account_id] !== (NAMES[r.platform] || r.platform)
    ? `${labels[r.account_id]} ${formatWord(r.platform, r.format)}` : `${NAMES[r.platform] || r.platform} ${formatWord(r.platform, r.format)}`;

  return (
    <section className="social">
      <header className="sc-hero">
        <div className="sc-hero-text">
          <p className="sc-kicker">✦ ColibriOS · Weekly social scorecard</p>
          <h2>How your posts <em>actually did</em> this week.</h2>
          <p>Instagram, Facebook and LinkedIn in one place. Every post from the last {WINDOW_DAYS} days is compared with your own median on that platform, so you can see what to make more of.</p>
        </div>
        <div className="sc-week">
          <strong>Week of {mdLabel(addDays(today, -6))} to {mdLabel(today)}</strong>
          <span>{card.week.length === 1 ? '1 post' : `${card.week.length} posts`} this week</span>
        </div>
      </header>

      <RunBar lastPull={lastPull} onDone={reloadAll} />

      {line && <p className="sc-callout">{line}</p>}

      <div className="sc-two">
        <div>
          <h3 className="sc-label">✦ Best 3 this week</h3>
          {card.best.length === 0 ? <p className="empty">No post this week is old enough to grade yet. Posts are graded once they are 48 hours old.</p>
            : card.best.map((r, i) => <Highlight key={r.id} r={r} where={where(r)} rank={i + 1} good />)}
        </div>
        <div>
          <h3 className="sc-label">✦ Worst 3 this week</h3>
          {card.worst.length === 0 ? <p className="empty">{card.best.length ? 'Every graded post this week is already in your best 3.' : 'Nothing to grade yet.'}</p>
            : card.worst.map((r, i) => <Highlight key={r.id} r={r} where={where(r)} rank={i + 1} />)}
        </div>
      </div>

      <h3 className="sc-label">✦ Everything else this week</h3>
      {card.restOfWeek.length === 0 ? <p className="empty">{card.week.length ? 'Every post this week is in the best or worst 3 above.' : 'No posts in the last 7 days.'}</p>
        : <PostTable rows={card.restOfWeek} where={where} />}

      <h3 className="sc-label">✦ Earlier in the last {WINDOW_DAYS} days</h3>
      {card.earlier.length === 0 ? <p className="empty">No earlier posts in the window.</p> : <PostTable rows={card.earlier} where={where} />}
      <p className="small muted">Each post is compared with your median for its platform over the last {WINDOW_DAYS} days: views when the post has views, otherwise likes + comments + shares (compared with your median of those). "Worked" means 1.5 times your median or more, "Didn't land" means half or less, and "Too new" means under 48 hours old. LinkedIn and most Facebook posts show no views publicly. A dash means the number was not shared.</p>

      <h3 className="sc-label">✦ Your followers, week by week</h3>
      <div className="sc-aud">
        <div className="sc-acard all">
          <span className="sc-pill dark">All platforms</span>
          <strong>{aud.total == null ? '·' : aud.total.toLocaleString('en-US')}</strong>
          <span className="small muted">total audience</span>
          <Delta d={aud.totalDelta} tail="since last week" />
        </div>
        {aud.cards.map((c) => (
          <div key={c.id} className="sc-acard">
            <div className="sc-acard-top"><span className={'sc-pill ' + c.platform}>{c.label}</span></div>
            <strong>{c.followers == null ? '·' : c.followers.toLocaleString('en-US')}</strong>
            <span className="small muted">{c.platform === 'youtube' ? 'subscribers' : 'followers'}</span>
            {c.followers == null ? <span className="small muted">Shows after the next refresh</span>
              : c.delta == null ? <span className="small muted">The trend shows after next Friday</span>
                : <Delta d={c.delta} pctV={c.deltaPct} tail={`since ${mdLabel(c.since)}`} />}
            <Trend weeks={c.weeks} />
          </div>
        ))}
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

      <div className="sc-next">
        <p className="sc-kicker">Next week 🧡</p>
        <h3>{tip.title}</h3>
        <p>{tip.body}</p>
      </div>
      {note && (
        <details className="sc-note">
          <summary className="small muted">Latest refresh{note.extra?.Date ? `, ${mdLabel(note.extra.Date)}` : ''}</summary>
          <div className="md small"><Markdown text={note.body} /></div>
        </details>
      )}
      <p className="small muted sc-foot">Weekly social scorecard · {lastPull ? `numbers from ${fWhen.format(new Date(lastPull))}` : 'no numbers yet'}</p>
    </section>
  );
}

function PostTable({ rows, where }) {
  return (
    <div className="panel flush table-wrap">
      <table className="sc sc-table sc-posts">
        <thead><tr><th>Where</th><th className="post-cell">Post</th><th>Posted</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Verdict</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const [label, tone] = VERDICT[r.verdict];
            return (
              <tr key={r.id}>
                <td><span className={'sc-pill ' + r.platform}>{NAMES[r.platform] || r.platform}</span><span className="small muted sc-fmt">{where(r).replace(/^(Instagram|Facebook|LinkedIn|YouTube|X) /, '')}</span></td>
                <td className="post-cell small">{r.post_url ? <a href={r.post_url} target="_blank" rel="noreferrer">{clip(r.caption)}</a> : clip(r.caption)}</td>
                <td className="small">{fDay.format(new Date(r.posted_at))}</td>
                <td>{shortNum(r.m?.views)}</td><td>{shortNum(r.m?.likes)}</td><td>{shortNum(r.m?.comments)}</td><td>{shortNum(r.m?.shares)}</td>
                <td className="sc-verdict"><span className={'pill ' + tone}>{label}</span>{r.ratio != null && r.verdict !== 'new' && <span className="small muted">{times(r.ratio)} your median</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Highlight({ r, where, rank, good }) {
  const unit = r.metric === 'views' ? 'views' : 'likes + comments + shares';
  return (
    <a className={'sc-hl' + (good ? ' good' : '')} href={r.post_url || undefined} target="_blank" rel="noreferrer">
      <span className="small muted">#{rank} · {where} · {fDay.format(new Date(r.posted_at))}</span>
      <span className="sc-hl-cap">{clip(r.caption, 110)}</span>
      <strong>{times(r.ratio)} your median</strong>
      <span className="small muted">{shortNum(r.score)} {unit} · median {shortNum(r.usual)} · <span className={'pill ' + VERDICT[r.verdict][1]}>{VERDICT[r.verdict][0]}</span></span>
    </a>
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

function Trend({ weeks }) {
  if (!weeks || weeks.length === 0) return null;
  const pts = weeks.map((w) => w.followers);
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const x = (i) => (weeks.length === 1 ? 50 : 4 + (i / (weeks.length - 1)) * 92);
  const y = (v) => 26 - ((v - min) / span) * 20;
  return (
    <div className="sc-trend">
      <svg viewBox="0 0 100 30" aria-hidden="true">
        {weeks.length > 1 && <polyline points={weeks.map((w, i) => `${x(i)},${y(w.followers)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        {weeks.map((w, i) => <circle key={w.week} cx={x(i)} cy={y(w.followers)} r="2" fill="currentColor" />)}
      </svg>
      <ol className="sc-weeks">
        {weeks.map((w) => <li key={w.week}><span>{mdLabel(w.taken_on)}</span><b>{w.followers.toLocaleString('en-US')}</b></li>)}
      </ol>
    </div>
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
    try { const { startError } = await runJob(job); setMsg(startError || 'Pulling your posts through Apify. They show here in a few minutes.'); await store.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="notice soft find-ideas">
      <div>
        <strong>{lastPull ? `Numbers from ${fWhen.format(new Date(lastPull))}` : 'No numbers yet'}</strong>
        <p>{job ? (job.enabled ? `This refreshes by itself every Friday at ${clock(job.run_at)}.` : 'The Friday refresh is off in Settings, so it only runs from this button.') : 'The Friday refresh is not set up yet: run the database step first.'} Your posts and follower counts come from Apify; YouTube comes from its free feed.</p>
        {working && <p className="small">Pulling your posts now.</p>}
        {run?.status === 'failed' && !working && <p className="small late">The last run did not finish: {(run.error || '').slice(0, 200)}</p>}
        {msg && <p className="small">{msg}</p>}
      </div>
      {working ? <span className="pill info">Working…</span>
        : <button className="btn small" type="button" onClick={go} disabled={!job}>Refresh now</button>}
    </div>
  );
}
