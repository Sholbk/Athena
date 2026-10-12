import { useState } from 'react';
import { useRows } from '../lib/rows.js';
import { Markdown } from '../lib/markdown.jsx';
import { diffDays, longLabel, todayYMD } from '../lib/dates.js';

// Shows the newest brief Athena wrote: the weekday Daily brief page, or the latest
// Monday plan / Friday wrap if that is newer. Both arrive through the vault sync.
export default function BriefCard() {
  const pages = useRows('pages', 'id,title,folder,body,extra,updated_at', { column: 'updated_at', ascending: false });
  const briefs = useRows('briefs', 'id,title,type,week_of,body,decision_needed,created_at', { column: 'created_at', ascending: false });
  const [open, setOpen] = useState(false);

  const daily = (pages.rows || []).find((p) => p.title === 'Daily brief' && p.folder === 'Athena');
  const latest = (briefs.rows || []).find((b) => b.body && b.body.trim());
  const dailyDate = daily?.extra?.Date ? String(daily.extra.Date).slice(0, 10) : null;
  const latestDate = latest ? String(latest.created_at).slice(0, 10) : null;
  const useDaily = daily && (!latestDate || (dailyDate && dailyDate >= latestDate));

  if (!pages.rows || !briefs.rows) return <article className="panel brief"><p className="eyebrow">Athena's brief</p><p className="empty">Loading…</p></article>;
  if (!daily && !latest) return <article className="panel brief"><p className="eyebrow">Athena's brief</p><p className="empty">No brief yet. Athena writes one every weekday morning.</p></article>;

  const title = useDaily ? 'Daily brief' : latest.title;
  const date = useDaily ? dailyDate : latestDate;
  const body = useDaily ? daily.body : latest.body;
  const age = date ? diffDays(todayYMD(), date) : null;
  const preview = body.length > 1400 && !open;

  return (
    <article className="panel brief">
      <div className="panel-head">
        <div><p className="eyebrow">Athena's brief{date ? `, ${longLabel(date)}` : ''}</p><h2>{title}</h2></div>
        {age > 0 && <span className="pill warn">{age === 1 ? 'From yesterday' : `${age} days old`}</span>}
      </div>
      {!useDaily && latest.decision_needed && <div className="notice soft"><strong>Decision needed</strong><p>{latest.decision_needed}</p></div>}
      <div className={preview ? 'clip' : ''}><Markdown text={preview ? body.slice(0, 1400) : body} /></div>
      {body.length > 1400 && <button className="linkbtn" type="button" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read the whole brief'}</button>}
    </article>
  );
}
