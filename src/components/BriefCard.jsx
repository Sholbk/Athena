import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRows } from '../lib/rows.js';
import { Markdown } from '../lib/markdown.jsx';
import { diffDays, longLabel, todayYMD, ymdOf } from '../lib/dates.js';
import { runJob, useJobs } from '../lib/jobs.js';

// Shows the newest brief Athena wrote: the weekday Daily brief page, or the Monday plan /
// Friday wrap when that is newer. Athena's jobs write both straight into the app.
export default function BriefCard() {
  const pages = useRows('pages', 'id,title,folder,body,extra,updated_at', { column: 'updated_at', ascending: false });
  const briefs = useRows('briefs', 'id,title,type,week_of,body,decision_needed,created_at', { column: 'created_at', ascending: false });
  const jobs = useJobs();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const daily = (pages.rows || []).find((p) => p.title === 'Daily brief' && p.folder === 'Athena');
  const latest = (briefs.rows || []).find((b) => b.body && b.body.trim());
  const dailyDate = daily?.extra?.Date ? String(daily.extra.Date).slice(0, 10) : null;
  const latestDate = latest ? ymdOf(new Date(latest.created_at)) : null;
  // A Monday plan or Friday wrap written today wins over that day's daily brief.
  const useDaily = daily && (!latestDate || (dailyDate && dailyDate > latestDate));

  const job = (jobs.jobs || []).find((j) => j.key === 'daily_brief');
  const run = job && jobs.runs[job.key];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const failed = run && run.status === 'failed' && run.created_at > (daily?.updated_at || '');

  const refresh = async () => {
    setMsg('');
    try { const { startError } = await runJob(job); if (startError) setMsg(startError); await jobs.reload(); } catch (e) { setMsg(e.message); }
  };
  // When a run finishes, pull the new brief in.
  const was = useRef(working);
  useEffect(() => {
    if (was.current && !working) { pages.reload(); briefs.reload(); }
    was.current = working;
  }, [working, pages.reload, briefs.reload]);

  const action = job && (
    working ? <span className="pill info">Athena is writing it…</span>
      : <button className="btn ghost small" type="button" onClick={refresh}>Write a fresh brief</button>
  );

  if (!pages.rows || !briefs.rows) return <article className="panel brief"><p className="eyebrow">Athena's brief</p><p className="empty">Loading…</p></article>;
  if (!daily && !latest) {
    return (
      <article className="panel brief">
        <div className="panel-head"><div><p className="eyebrow">Athena's brief</p><h2>No brief yet</h2></div>{action}</div>
        <p className="empty">Athena writes one Tuesday to Friday at 7:58 AM. <Link to="/settings">Change the times in Settings.</Link></p>
      </article>
    );
  }

  const title = useDaily ? 'Daily brief' : latest.title;
  const date = useDaily ? dailyDate : latestDate;
  const body = useDaily ? daily.body : latest.body;
  const age = date ? diffDays(todayYMD(), date) : null;
  const preview = body.length > 1400 && !open;

  return (
    <article className="panel brief">
      <div className="panel-head">
        <div><p className="eyebrow">Athena's brief{date ? `, ${longLabel(date)}` : ''}</p><h2>{title}</h2></div>
        <div className="btn-row">
          {age > 0 && <span className="pill warn">{age === 1 ? 'From yesterday' : `${age} days old`}</span>}
          {action}
        </div>
      </div>
      {failed && <div className="notice"><strong>The last brief did not finish</strong><p>{run.error}</p></div>}
      {msg && <p className="form-msg">{msg}</p>}
      {!useDaily && latest.decision_needed && <div className="notice soft"><strong>Decision needed</strong><p>{latest.decision_needed}</p></div>}
      <div className={preview ? 'clip' : ''}><Markdown text={preview ? body.slice(0, 1400) : body} /></div>
      {body.length > 1400 && <button className="linkbtn" type="button" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read the whole brief'}</button>}
    </article>
  );
}
