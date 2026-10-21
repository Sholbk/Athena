import { useMemo, useState } from 'react';
import { useRows } from '../lib/rows.js';
import { CONTENT_COLS, CONTENT_STATUSES, DEFAULT_CTA, STATUS_TONE } from '../lib/content.js';
import { addDays, dueText, mdLabel, todayYMD } from '../lib/dates.js';
import { addIdea, markUsed, parseIdeas } from '../lib/ideas.js';
import { usePostAsks } from '../lib/postAsks.js';
import { useFindIdeas } from '../lib/findIdeas.js';
import { Markdown } from '../lib/markdown.jsx';
import { Panel, Skel } from '../components/bits.jsx';
import ContentDrawer from '../components/ContentDrawer.jsx';
import MediaLibrary from '../components/MediaLibrary.jsx';
import CommentDesk from '../components/CommentDesk.jsx';
import Results from '../components/Results.jsx';

const VIEWS = [['pipeline', 'Pipeline'], ['calendar', 'Calendar'], ['ideas', 'Idea bank'], ['brand', 'Brand files'], ['media', 'Media'], ['linkedin', 'Comment desk'], ['results', 'Results']];
const BRAND_PAGE = 'ColibriOS Brand Files';
const PAGE_COLS = 'id,title,folder,body,updated_at,vault_path';

export default function Marketing() {
  const [view, setView] = useState(() => { try { return localStorage.getItem('athena:mkt-view') || 'pipeline'; } catch { return 'pipeline'; } });
  const content = useRows('content', CONTENT_COLS, { column: 'target_date', ascending: true });
  const pages = useRows('pages', PAGE_COLS, { column: 'title', ascending: true });
  const [open, setOpen] = useState(null);
  const pick = (v) => { setView(v); try { localStorage.setItem('athena:mkt-view', v); } catch {} };
  const current = open && content.rows ? content.rows.find((r) => r.id === open) : null;

  const asks = usePostAsks(content.rows, content.reload);

  const newPiece = async (seed = {}) => {
    const row = await content.create({ title: 'New post', status: 'Idea', product: 'ColibriOS', cta: DEFAULT_CTA, ...seed });
    setOpen(row.id);
  };
  // Athena writes the caption and makes the image in Blotato (athena/POSTS.md). She never posts it.
  // A try after a failed one reuses the same piece.
  const makePost = async (idea) => {
    const retry = Object.entries(asks.failed).find(([, f]) => f.seed === idea.num)?.[0];
    const row = retry ? { id: retry } : await content.create({
      title: `Seed ${idea.num}: ${idea.text.split('.')[0].slice(0, 80)}`, status: 'Idea', product: 'ColibriOS', cta: DEFAULT_CTA,
      notes: `From idea bank seed ${idea.num}: ${idea.text}`,
    });
    return asks.ask(row.id, `Make the post for content piece ${row.id} (idea bank seed ${idea.num}). Follow "Making posts".`, idea.num);
  };
  // For a file already in Media, such as a reel she made in WonderReel: Athena writes the caption.
  const captionFor = async (file, link) => {
    const row = await content.create({
      title: file.title, status: 'Idea', product: 'ColibriOS', cta: DEFAULT_CTA, notes: `From Media: ${file.title}`,
    });
    await link(row.id);
    const startError = await asks.ask(row.id, `Write a caption for the Media file ${file.id}, for content piece ${row.id}. Follow "Making posts".`);
    return startError ? `Saved for Athena, but she did not start yet: ${startError}` : 'Athena is writing it. It shows in Pipeline in a few minutes.';
  };

  return (
    <section>
      <div className="week-head">
        <div><p className="eyebrow">ColibriOS marketing</p><h2>Marketing hub</h2></div>
        <button className="btn" type="button" onClick={() => newPiece().catch((e) => alert(e.message))}>New post</button>
      </div>
      <div className="seg" role="tablist" aria-label="Marketing views">
        {VIEWS.map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pick(v)}>{label}</button>)}
      </div>
      {(content.error || pages.error) && <div className="notice"><strong>Something did not load</strong><p>{content.error || pages.error}</p></div>}
      {view === 'pipeline' && <Pipeline rows={content.rows} making={asks.making} onOpen={setOpen} />}
      {view === 'calendar' && <Calendar rows={content.rows} onOpen={setOpen} />}
      {view === 'ideas' && <Ideas pages={pages} content={content.rows} onStart={newPiece} onMake={makePost} asks={asks} />}
      {view === 'brand' && <Brand pages={pages} />}
      {view === 'media' && <MediaLibrary onCaption={captionFor} />}
      {view === 'linkedin' && <CommentDesk pages={pages} />}
      {view === 'results' && <Results content={content.rows} pages={pages} />}
      {current && <ContentDrawer row={current} store={content} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Card({ r, making, onOpen }) {
  const late = r.target_date && r.target_date < todayYMD() && !['Shipped', 'Skipped'].includes(r.status);
  return (
    <button type="button" className="card" onClick={() => onOpen(r.id)}>
      <span className="card-title">{r.title}</span>
      <span className="meta">
        {r.channel && <span className="chip">{r.channel}</span>}
        <span className={late ? 'late' : ''}>{r.target_date ? dueText(r.target_date).replace('Due today', 'Today') : 'No date'}</span>
      </span>
      {making && <span className="pill info">Athena is making it…</span>}
    </button>
  );
}

function Pipeline({ rows, making, onOpen }) {
  const [showDone, setShowDone] = useState(false);
  if (!rows) return <Skel />;
  const cols = CONTENT_STATUSES.filter((s) => showDone || !['Shipped', 'Skipped'].includes(s));
  const waiting = rows.filter((r) => r.status === 'Awaiting approval');
  return (
    <>
      {waiting.length > 0 && (
        <div className="notice soft"><strong>{waiting.length} ready to post</strong><p>Open each one, copy the caption and grab the images, then post it yourself or in Blotato. Click "I posted it" after.</p></div>
      )}
      <label className="calopt" style={{ margin: '12px 0' }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show shipped and skipped</label>
      <div className="board">
        {cols.map((s) => {
          const list = rows.filter((r) => r.status === s);
          return (
            <div key={s} className="lane">
              <h3><span className={'pill ' + (STATUS_TONE[s] || '')}>{s}</span> <small>{list.length}</small></h3>
              {list.length === 0 ? <p className="empty small">Nothing here</p> : list.map((r) => <Card key={r.id} r={r} making={making.has(r.id)} onOpen={onOpen} />)}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Calendar({ rows, onOpen }) {
  const today = todayYMD();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = useMemo(() => {
    const first = `${month}-01`;
    const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
    const start = addDays(first, -dow);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);
  const shift = (n) => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00Z`));
  if (!rows) return <Skel />;
  const undated = rows.filter((r) => !r.target_date && !['Shipped', 'Skipped'].includes(r.status));
  return (
    <>
      <div className="week-head" style={{ marginTop: 14 }}>
        <h2>{label}</h2>
        <div className="week-nav">
          <button className="btn ghost small" type="button" onClick={() => shift(-1)}>‹ Last month</button>
          <button className="btn ghost small" type="button" onClick={() => setMonth(today.slice(0, 7))}>This month</button>
          <button className="btn ghost small" type="button" onClick={() => shift(1)}>Next month ›</button>
        </div>
      </div>
      <div className="month">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          const list = rows.filter((r) => r.target_date === d && r.status !== 'Skipped');
          return (
            <div key={d} className={'mday' + (d.slice(0, 7) !== month ? ' other' : '') + (d === today ? ' today' : '')}>
              <span className="mnum">{Number(d.slice(8))}<span className="mobile-only"> {mdLabel(d).split(' ')[0]}</span></span>
              {list.map((r) => (
                <button key={r.id} type="button" className={'mitem ' + (STATUS_TONE[r.status] || '')} onClick={() => onOpen(r.id)} title={`${r.title} (${r.status})`}>
                  {r.channel ? `${r.channel}: ` : ''}{r.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <Panel title="No date yet" className="mt">
          {undated.map((r) => <Card key={r.id} r={r} onOpen={onOpen} />)}
        </Panel>
      )}
    </>
  );
}

function Ideas({ pages, content, onStart, onMake, asks }) {
  const page = (pages.rows || []).find((p) => p.title === BRAND_PAGE);
  const bank = page ? parseIdeas(page.body) : null;
  const [adding, setAdding] = useState({ group: '', text: '' });
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(null);
  const finder = useFindIdeas(pages.reload);
  const [findMsg, setFindMsg] = useState('');
  if (!pages.rows) return <Skel />;
  if (!page) return <p className="empty">The ColibriOS Brand Files page has not synced yet.</p>;
  if (!bank) return <p className="empty">No "Idea bank" section found in the Brand Files page.</p>;

  const inUse = new Set((content || []).flatMap((r) => [...`${r.title} ${r.notes || ''}`.matchAll(/[Ss]eed #?(\d+)/g)].map((m) => Number(m[1]))));
  const start = (idea) => onStart({
    title: `Seed ${idea.num}: ${idea.text.split('.')[0].slice(0, 80)}`,
    notes: `From idea bank seed ${idea.num}: ${idea.text}`,
  }).catch((e) => alert(e.message));
  const used = async (idea) => {
    const how = prompt(`Mark seed ${idea.num} as used. Add a short note (date and how it did):`, `${mdLabel(todayYMD())}`);
    if (how == null) return;
    try { await pages.save(page.id, { body: markUsed(page.body, idea, how.trim() || mdLabel(todayYMD())) }); setMsg(`Seed ${idea.num} moved to Used.`); }
    catch (e) { setMsg(e.message); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!adding.group || !adding.text.trim()) return setMsg('Pick a pillar and write the idea.');
    try {
      await pages.save(page.id, { body: addIdea(page.body, adding.group, bank.nextNum, adding.text) });
      setMsg(`Added as seed ${bank.nextNum}.`); setAdding({ group: adding.group, text: '' });
    } catch (err) { setMsg(err.message); }
  };

  const failedSeeds = Object.fromEntries(Object.values(asks.failed).filter((f) => f.seed != null).map((f) => [f.seed, f.error]));
  const make = async (idea) => {
    setMsg(''); setSent(idea.num);
    try {
      const err = await onMake(idea);
      setMsg(err ? `Saved for Athena, but she did not start yet: ${err}` : `Athena is making seed ${idea.num}. It shows in Pipeline, ready to post, in a few minutes.`);
    } catch (e) { setMsg(e.message); }
    setSent(null);
  };

  const find = async () => {
    setFindMsg('');
    try { const err = await finder.find(); if (err) setFindMsg(`Saved for Athena, but she did not start yet: ${err}`); }
    catch (e) { setFindMsg(e.message); }
  };

  return (
    <div className="ideas">
      <p className="muted small" style={{ margin: '14px 0' }}>Each seed is an angle to write from, not a finished post. Anything that names a real person needs their yes first. Edits here save into your Brand Files page in Obsidian.</p>
      <div className="notice soft find-ideas">
        <div>
          <strong>New ideas from colibrios.com</strong>
          <p>Athena reads pages of your site she has not read yet and adds up to 8 new seeds, each one marked with the page it came from.</p>
          {finder.running && <p className="small">Athena is reading colibrios.com. New seeds show up here in a few minutes.</p>}
          {!finder.running && finder.last?.status === 'done' && finder.last.reply && <div className="small md"><Markdown text={finder.last.reply} /></div>}
          {!finder.running && finder.last?.status === 'failed' && <p className="small late">Athena did not finish: {(finder.last.error || '').slice(0, 200)}</p>}
          {finder.timedOut && <p className="small late">The last search never came back. Try again.</p>}
          {findMsg && <p className="small late">{findMsg}</p>}
        </div>
        {finder.running ? <span className="pill info">Reading…</span> : <button className="btn small" type="button" onClick={find}>Find new ideas</button>}
      </div>
      <Panel title="Add an idea">
        <form className="add" onSubmit={add}>
          <label className="f">Pillar<select value={adding.group} onChange={(e) => setAdding({ ...adding, group: e.target.value })}><option value="">Pick one</option>{bank.groups.map((g) => <option key={g.title}>{g.title}</option>)}</select></label>
          <label className="f wide">The idea<input type="text" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} placeholder="An onboarding question, an objection, a 'wait, you can do that?' moment" /></label>
          <div className="actions"><button className="btn" type="submit">Add as seed {bank.nextNum}</button><p className="d-msg">{msg}</p></div>
        </form>
      </Panel>
      <div className="groups mt">
        {bank.groups.map((g) => (
          <Panel key={g.title} title={g.title} extra={<span className="small muted">{g.ideas.length}</span>}>
            {g.ideas.map((idea) => (
              <div key={idea.num} className="idea">
                <span className="num">{idea.num}</span>
                <div>
                  <div className="md">{inlineIdea(idea.text)}</div>
                  <div className="btn-row">
                    <button className="linkbtn" type="button" onClick={() => start(idea)}>Start a post</button>
                    {asks.makingSeeds.has(idea.num) || sent === idea.num
                      ? <span className="pill info">Making it…</span>
                      : <button className="linkbtn" type="button" onClick={() => make(idea)}>{failedSeeds[idea.num] ? 'Try again' : 'Make this post'}</button>}
                    <button className="linkbtn quiet" type="button" onClick={() => used(idea)}>Mark used</button>
                    {inUse.has(idea.num) && <span className="pill info">In the pipeline</span>}
                  </div>
                  {failedSeeds[idea.num] && <p className="small late" style={{ margin: '4px 0 0' }}>Athena did not finish this one: {failedSeeds[idea.num].slice(0, 160)}</p>}
                </div>
              </div>
            ))}
          </Panel>
        ))}
        <Panel title="Used" extra={<span className="small muted">{bank.used.length}</span>}>
          {bank.used.length === 0 ? <p className="empty">Nothing marked used yet. Ideas move here after they ship.</p>
            : <ul className="plain">{bank.used.map((u, i) => <li key={i}>{u.text}</li>)}</ul>}
        </Panel>
      </div>
    </div>
  );
}

function inlineIdea(text) {
  return <Markdown text={text} />;
}

function Brand({ pages }) {
  const list = (pages.rows || []).filter((p) => /Brand Files|Marketing Plan|Offer/i.test(p.title + ' ' + p.folder));
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  if (!pages.rows) return <Skel />;
  const page = list.find((p) => p.id === sel) || list.find((p) => p.title === BRAND_PAGE) || list[0];
  if (!page) return <p className="empty">No brand pages have synced yet.</p>;
  const save = async () => {
    try { await pages.save(page.id, { body: edit }); setEdit(null); setMsg('Saved. It reaches Obsidian on the next sync.'); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="brand-view">
      <nav className="side">
        {list.map((p) => (
          <button key={p.id} type="button" className={p.id === page.id ? 'on' : ''} onClick={() => { setSel(p.id); setEdit(null); setMsg(''); }}>{p.title}</button>
        ))}
      </nav>
      <article className="panel doc">
        <div className="panel-head">
          <h2>{page.title}</h2>
          {edit == null
            ? <button className="btn ghost small" type="button" onClick={() => setEdit(page.body)}>Edit</button>
            : <div className="btn-row"><button className="btn small" type="button" onClick={save}>Save</button><button className="linkbtn" type="button" onClick={() => setEdit(null)}>Cancel</button></div>}
        </div>
        {msg && <p className="d-msg">{msg}</p>}
        {edit == null ? <Markdown text={page.body} /> : <textarea className="doc-edit" value={edit} onChange={(e) => setEdit(e.target.value)} />}
      </article>
    </div>
  );
}
