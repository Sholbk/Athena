import { useMemo, useState } from 'react';
import { useRows } from '../lib/rows.js';
import { Markdown } from '../lib/markdown.jsx';
import { mdLabel, todayYMD } from '../lib/dates.js';
import { ISSUE_STATUSES, ISSUE_TONE, MEASURABLES, QUARTERS, ROCK_STATUSES, ROCK_TONE, currentQuarter, fridayOf } from '../lib/eos.js';
import { Panel, Skel } from '../components/bits.jsx';

const VIEWS = [['rocks', 'Rocks'], ['scorecard', 'Scorecard'], ['issues', 'Issues'], ['l10', 'Level 10'], ['vto', 'V/TO']];

export default function EOS() {
  const [view, setView] = useState(() => { try { return localStorage.getItem('athena:eos-view') || 'rocks'; } catch { return 'rocks'; } });
  const pick = (v) => { setView(v); try { localStorage.setItem('athena:eos-view', v); } catch {} };
  return (
    <section>
      <div className="week-head">
        <div><p className="eyebrow">Metis · ColibriOS EOS</p><h2>EOS</h2></div>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>Metis runs the Level 10 every Friday at 9:00 AM and updates all of this. You can edit anything here too. Changes reach Obsidian on the next sync. New Rocks get set at the quarterly, not mid-quarter.</p>
      <div className="seg" role="tablist" aria-label="EOS views">
        {VIEWS.map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pick(v)}>{label}</button>)}
      </div>
      {view === 'rocks' && <Rocks />}
      {view === 'scorecard' && <Scorecard />}
      {view === 'issues' && <Issues />}
      {view === 'l10' && <Level10 />}
      {view === 'vto' && <Vto />}
    </section>
  );
}

function Err({ store }) {
  return store.error ? <div className="notice"><strong>Something did not load</strong><p>{store.error}</p></div> : null;
}

/* ---------- Rocks ---------- */
function Rocks() {
  const store = useRows('rocks', 'id,title,quarter,status,owner,due,athena_tasks,notes,body,updated_at,vault_path', { column: 'due', ascending: true });
  const [quarter, setQuarter] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  if (!store.rows) return <><Err store={store} /><Skel /></>;
  const quarters = [...new Set(store.rows.map((r) => r.quarter).filter(Boolean))].sort((a, b) => sortQ(b) - sortQ(a));
  const q = quarter || quarters[0] || currentQuarter(todayYMD());
  const rows = store.rows.filter((r) => (r.quarter || '') === q);
  const counts = ROCK_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]);
  const nowQ = currentQuarter(todayYMD());
  const current = open ? store.rows.find((r) => r.id === open) : null;

  return (
    <>
      <Err store={store} />
      <div className="eos-bar">
        <label className="f inline">Quarter
          <select value={q} onChange={(e) => setQuarter(e.target.value)}>{[...new Set([...quarters, nowQ])].sort((a, b) => sortQ(b) - sortQ(a)).map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <div className="legend">{counts.map(([s, n]) => <span key={s}><span className={'pill ' + ROCK_TONE[s]}>{s}</span> <b>{n}</b></span>)}</div>
        <button className="btn ghost small" type="button" onClick={() => setAdding(true)}>Add a Rock</button>
      </div>
      {q !== nowQ && !store.rows.some((r) => r.quarter === nowQ) && (
        <div className="notice soft"><strong>No {nowQ} Rocks yet</strong><p>These are {q} Rocks. {nowQ} Rocks get set at the quarterly with Metis.</p></div>
      )}
      <div className="groups mt">
        {rows.length === 0 ? <p className="empty">No Rocks for {q}.</p> : rows.map((r) => (
          <button key={r.id} type="button" className="panel rock-card" onClick={() => setOpen(r.id)}>
            <span className="meta"><span className={'pill ' + (ROCK_TONE[r.status] || '')}>{r.status || 'No status'}</span>{r.due && <span>Due {mdLabel(r.due)}</span>}{r.owner && <span>{r.owner}</span>}</span>
            <span className="card-title big">{r.title}</span>
            {r.notes && <span className="muted small clamp3">{r.notes}</span>}
            {r.athena_tasks?.length > 0 && <span className="small muted">{r.athena_tasks.length} linked task{r.athena_tasks.length > 1 ? 's' : ''}</span>}
          </button>
        ))}
      </div>
      {current && <RockEditor row={current} store={store} onClose={() => setOpen(null)} />}
      {adding && <RockEditor row={{ title: '', quarter: nowQ, status: 'On track', owner: 'Stephanie', due: quarterEnd(nowQ), notes: '', athena_tasks: [] }} store={store} onClose={() => setAdding(false)} isNew />}
    </>
  );
}
const sortQ = (q) => { const m = /Q(\d) (\d{4})/.exec(q || ''); return m ? Number(m[2]) * 10 + Number(m[1]) : 0; };
const quarterEnd = (q) => { const m = /Q(\d) (\d{4})/.exec(q); const end = ['03-31', '06-30', '09-30', '12-31'][Number(m[1]) - 1]; return `${m[2]}-${end}`; };

function RockEditor({ row, store, onClose, isNew }) {
  const [f, setF] = useState({ title: row.title || '', quarter: row.quarter || '', status: row.status || '', owner: row.owner || '', due: row.due || '', notes: row.notes || '' });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.title.trim()) return setMsg('Give the Rock a name.');
    const patch = { title: f.title.trim(), quarter: f.quarter || null, status: f.status || null, owner: f.owner || null, due: f.due || null, notes: f.notes || null };
    try { isNew ? await store.create(patch) : await store.save(row.id, patch); onClose(); } catch (e) { setMsg(e.message); }
  };
  return (
    <Drawer title={isNew ? 'New Rock' : 'Rock'} onClose={onClose}>
      <label className="f">Rock<input type="text" value={f.title} onChange={set('title')} placeholder="Specific, measurable, done by the end of the quarter" /></label>
      <div className="fields">
        <Sel label="Status" v={f.status} on={set('status')} opts={ROCK_STATUSES} />
        <Sel label="Quarter" v={f.quarter} on={set('quarter')} opts={QUARTERS} />
        <label className="f">Due<input type="date" value={f.due} onChange={set('due')} /></label>
        <label className="f">Owner<input type="text" value={f.owner} onChange={set('owner')} /></label>
      </div>
      <label className="f">Notes<textarea rows="8" value={f.notes} onChange={set('notes')} /></label>
      {row.athena_tasks?.length > 0 && <div><p className="eyebrow">Linked tasks</p><ul className="plain">{row.athena_tasks.map((t) => <li key={t}>{t}</li>)}</ul></div>}
      {row.body && <div><p className="eyebrow">More</p><Markdown text={row.body} /></div>}
      <div className="d-actions"><button className="btn" type="button" onClick={save}>{isNew ? 'Add Rock' : 'Save'}</button>
        {!isNew && <button className="linkbtn danger" type="button" onClick={async () => { if (confirm('Delete this Rock?')) { await store.remove(row.id); onClose(); } }}>Delete</button>}</div>
      <p className="form-msg">{msg}</p>
    </Drawer>
  );
}

/* ---------- Scorecard ---------- */
function Scorecard() {
  const store = useRows('scorecard', 'id,title,week_ending,metrics,body,updated_at', { column: 'week_ending', ascending: true });
  const [editing, setEditing] = useState(null);
  const rows = useMemo(() => (store.rows || []).filter((r) => r.week_ending).slice(-13), [store.rows]);
  if (!store.rows) return <><Err store={store} /><Skel /></>;
  const names = [...MEASURABLES, ...new Set(rows.flatMap((r) => Object.keys(r.metrics || {})).filter((k) => !MEASURABLES.includes(k)))];
  const thisFriday = fridayOf(todayYMD());
  const hasThisWeek = store.rows.some((r) => r.week_ending === thisFriday);
  const filled = (r) => Object.values(r.metrics || {}).filter((v) => v !== null && v !== '').length;

  return (
    <>
      <Err store={store} />
      <div className="eos-bar">
        <p className="muted small" style={{ margin: 0 }}>One column per week, named by the Friday it ends. Blank means nobody recorded it, never zero.</p>
        <button className="btn small" type="button" onClick={() => setEditing(hasThisWeek ? store.rows.find((r) => r.week_ending === thisFriday) : { week_ending: thisFriday, metrics: {} })}>
          {hasThisWeek ? `Edit week of ${mdLabel(thisFriday)}` : `Enter this week's numbers`}
        </button>
      </div>
      {rows.length === 0 ? <p className="empty">No Scorecard weeks yet.</p> : (
        <div className="panel flush table-wrap mt">
          <table className="sc">
            <thead><tr><th>Measurable</th>{rows.map((r) => <th key={r.id}><button className="linkbtn" type="button" onClick={() => setEditing(r)}>{mdLabel(r.week_ending)}</button></th>)}</tr></thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}><td>{n}</td>{rows.map((r) => { const v = r.metrics?.[n]; return <td key={r.id} className={v == null ? 'blank' : ''}>{v == null ? '·' : v}</td>; })}</tr>
              ))}
              <tr className="foot"><td>Filled in</td>{rows.map((r) => <td key={r.id}>{filled(r)} of {names.length}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      {rows.some((r) => r.body) && (
        <Panel title="Notes on these weeks" className="mt">
          {[...rows].reverse().filter((r) => r.body).map((r) => <details key={r.id} className="more"><summary>Week of {mdLabel(r.week_ending)}</summary><Markdown text={r.body} /></details>)}
        </Panel>
      )}
      {editing && <ScoreEditor row={editing} names={names} store={store} onClose={() => setEditing(null)} />}
    </>
  );
}

function ScoreEditor({ row, names, store, onClose }) {
  const [week, setWeek] = useState(row.week_ending);
  const [vals, setVals] = useState(() => Object.fromEntries(names.map((n) => [n, row.metrics?.[n] ?? ''])));
  const [msg, setMsg] = useState('');
  const save = async () => {
    const metrics = {};
    for (const [k, v] of Object.entries(vals)) {
      if (v === '' || v == null) continue;
      const num = Number(String(v).replace(/[%,$\s]/g, ''));
      if (Number.isNaN(num)) return setMsg(`"${k}" needs a number.`);
      metrics[k] = num;
    }
    const patch = { title: week, week_ending: week, metrics: { ...stripUnknown(row.metrics, names), ...metrics } };
    for (const n of names) if (!(n in metrics)) delete patch.metrics[n];
    try { row.id ? await store.save(row.id, patch) : await store.create(patch); onClose(); } catch (e) { setMsg(e.message.includes('duplicate') ? 'That week already has a column. Click its date to edit it.' : e.message); }
  };
  return (
    <Drawer title={row.id ? `Week of ${mdLabel(row.week_ending)}` : 'New Scorecard week'} onClose={onClose}>
      {!row.id && <label className="f">Week ending (Friday)<input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></label>}
      <p className="muted small" style={{ margin: 0 }}>Leave anything you don't know blank. Blank is honest, a guess isn't.</p>
      <div className="fields">
        {names.map((n) => (
          <label key={n} className="f">{n}<input type="text" inputMode="decimal" value={vals[n]} onChange={(e) => setVals({ ...vals, [n]: e.target.value })} /></label>
        ))}
      </div>
      <div className="d-actions"><button className="btn" type="button" onClick={save}>Save week</button></div>
      <p className="form-msg">{msg}</p>
    </Drawer>
  );
}
const stripUnknown = (m, names) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => !names.includes(k)));

/* ---------- Issues ---------- */
function Issues() {
  const store = useRows('issues', 'id,title,priority,status,owner,raised,solved_on,solution,body,updated_at', { column: 'priority', ascending: true });
  const [show, setShow] = useState('Open');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  if (!store.rows) return <><Err store={store} /><Skel /></>;
  const rows = store.rows.filter((r) => r.status === show).sort((a, b) => (a.priority || 9) - (b.priority || 9) || String(a.raised).localeCompare(String(b.raised)));
  const current = open ? store.rows.find((r) => r.id === open) : null;
  return (
    <>
      <Err store={store} />
      <div className="eos-bar">
        <div className="seg small" role="group" aria-label="Which issues">
          {ISSUE_STATUSES.map((s) => <button key={s} type="button" aria-pressed={show === s} aria-selected={show === s} onClick={() => setShow(s)}>{s} <b className="mono">{store.rows.filter((r) => r.status === s).length}</b></button>)}
        </div>
        <button className="btn ghost small" type="button" onClick={() => setAdding(true)}>Add an issue</button>
      </div>
      <div className="panel mt">
        {rows.length === 0 ? <p className="empty">No {show.toLowerCase()} issues.</p> : rows.map((r) => (
          <button key={r.id} type="button" className="issue" onClick={() => setOpen(r.id)}>
            <span className={'prio p' + (r.priority || 0)}>{r.priority ? `P${r.priority}` : '·'}</span>
            <span>
              <span className="card-title">{r.title}</span>
              <span className="meta">{r.raised && <span>Raised {mdLabel(r.raised)}</span>}{r.solved_on && <span>Solved {mdLabel(r.solved_on)}</span>}{r.owner && <span>{r.owner}</span>}</span>
            </span>
          </button>
        ))}
      </div>
      {current && <IssueEditor row={current} store={store} onClose={() => setOpen(null)} />}
      {adding && <IssueEditor row={{ title: '', priority: 2, status: 'Open', owner: 'Stephanie', raised: todayYMD(), solution: '' }} store={store} onClose={() => setAdding(false)} isNew />}
    </>
  );
}

function IssueEditor({ row, store, onClose, isNew }) {
  const [f, setF] = useState({ title: row.title || '', priority: row.priority ? String(row.priority) : '', status: row.status || 'Open', owner: row.owner || '', raised: row.raised || '', solved_on: row.solved_on || '', solution: row.solution || '' });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => {
    const next = { ...f, [k]: e.target.value };
    if (k === 'status' && e.target.value === 'Solved' && !f.solved_on) next.solved_on = todayYMD();
    setF(next);
  };
  const save = async () => {
    if (!f.title.trim()) return setMsg('Name the issue.');
    const patch = { title: f.title.trim(), priority: f.priority ? Number(f.priority) : null, status: f.status, owner: f.owner || null, raised: f.raised || null, solved_on: f.solved_on || null, solution: f.solution || null };
    try { isNew ? await store.create(patch) : await store.save(row.id, patch); onClose(); } catch (e) { setMsg(e.message); }
  };
  return (
    <Drawer title={isNew ? 'New issue' : 'Issue'} onClose={onClose}>
      <label className="f">Issue<input type="text" value={f.title} onChange={set('title')} /></label>
      <div className="fields">
        <Sel label="Status" v={f.status} on={set('status')} opts={ISSUE_STATUSES} />
        <Sel label="Priority" v={f.priority} on={set('priority')} opts={['1', '2', '3', '4']} />
        <label className="f">Raised<input type="date" value={f.raised} onChange={set('raised')} /></label>
        <label className="f">Solved on<input type="date" value={f.solved_on} onChange={set('solved_on')} /></label>
        <label className="f">Owner<input type="text" value={f.owner} onChange={set('owner')} /></label>
      </div>
      <label className="f">Solution, or where IDS got to<textarea rows="8" value={f.solution} onChange={set('solution')} /></label>
      {row.body && <div><p className="eyebrow">More</p><Markdown text={row.body} /></div>}
      <div className="d-actions"><button className="btn" type="button" onClick={save}>{isNew ? 'Add issue' : 'Save'}</button>
        {!isNew && <button className="linkbtn danger" type="button" onClick={async () => { if (confirm('Delete this issue?')) { await store.remove(row.id); onClose(); } }}>Delete</button>}</div>
      <p className="form-msg">{msg}</p>
    </Drawer>
  );
}

/* ---------- Level 10 ---------- */
function Level10() {
  const store = useRows('l10', 'id,title,meeting_date,rating,issue_solved,body,updated_at', { column: 'meeting_date', ascending: false });
  const [openId, setOpenId] = useState(null);
  if (!store.rows) return <><Err store={store} /><Skel /></>;
  const rated = store.rows.filter((r) => r.rating != null);
  const avg = rated.length ? (rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length).toFixed(1) : null;
  const first = store.rows[0]?.id;
  return (
    <>
      <Err store={store} />
      <div className="eos-bar">
        <p className="muted small" style={{ margin: 0 }}>{store.rows.length} meetings logged{avg ? `, average rating ${avg} of 10 (${rated.length} rated)` : ', none rated yet'}.</p>
      </div>
      <div className="l10-list mt">
        {store.rows.length === 0 ? <p className="empty">No Level 10s logged yet.</p> : store.rows.map((r) => {
          const isOpen = (openId ?? first) === r.id;
          return (
            <article key={r.id} className="panel">
              <button type="button" className="l10-head" onClick={() => setOpenId(isOpen ? '' : r.id)} aria-expanded={isOpen}>
                <span><span className="card-title big">{r.title}</span>
                  <span className="meta">{r.meeting_date && <span>{mdLabel(r.meeting_date)}</span>}<span>{r.rating != null ? `Rated ${r.rating}` : 'Not rated'}</span></span></span>
                <span className="linkbtn">{isOpen ? 'Hide' : 'Open'}</span>
              </button>
              {isOpen && (
                <div className="mt">
                  {r.issue_solved && <div className="notice soft"><strong>Issue solved</strong><p>{r.issue_solved}</p></div>}
                  <Markdown text={r.body} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ---------- V/TO ---------- */
function Vto() {
  const store = useRows('pages', 'id,title,folder,body,updated_at', { column: 'title', ascending: true });
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  if (!store.rows) return <><Err store={store} /><Skel /></>;
  const page = store.rows.find((p) => p.folder === 'Metis' && /V-?TO/i.test(p.title));
  if (!page) return <p className="empty">The V/TO page has not synced yet.</p>;
  const save = async () => { try { await store.save(page.id, { body: edit }); setEdit(null); setMsg('Saved. It reaches Obsidian on the next sync.'); } catch (e) { setMsg(e.message); } };
  return (
    <article className="panel doc mt">
      <div className="panel-head">
        <h2>Vision/Traction Organizer</h2>
        {edit == null ? <button className="btn ghost small" type="button" onClick={() => setEdit(page.body)}>Edit</button>
          : <div className="btn-row"><button className="btn small" type="button" onClick={save}>Save</button><button className="linkbtn" type="button" onClick={() => setEdit(null)}>Cancel</button></div>}
      </div>
      {msg && <p className="d-msg">{msg}</p>}
      {edit == null ? <Markdown text={page.body} /> : <textarea className="doc-edit" value={edit} onChange={(e) => setEdit(e.target.value)} />}
    </article>
  );
}

/* ---------- Shared ---------- */
function Drawer({ title, onClose, children }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="d-head"><p className="eyebrow">{title}</p><button className="linkbtn" type="button" onClick={onClose}>Close</button></div>
        {children}
      </aside>
    </>
  );
}
function Sel({ label, v, on, opts }) {
  return <label className="f">{label}<select value={v} onChange={on}><option value="">None</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>;
}
