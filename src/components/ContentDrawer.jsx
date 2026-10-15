import { useEffect, useState } from 'react';
import { CHANNELS, CONTENT_STATUSES, DEFAULT_CTA, copyChecks } from '../lib/content.js';
import { askAthena } from '../lib/athena.js';
import { downloadFile, usePieceMedia } from '../lib/media.js';

// The next step for a piece, so the common move is one click. The app never posts:
// she posts by hand or in Blotato, then marks it here.
const NEXT = {
  Idea: { to: 'Drafted', label: 'Mark drafted' },
  Drafted: { to: 'Awaiting approval', label: 'Send for my approval' },
  'Awaiting approval': { to: 'Shipped', label: 'I posted it' },
  Scheduled: { to: 'Shipped', label: 'Mark shipped' },
};

export default function ContentDrawer({ row, store, onClose }) {
  const [f, setF] = useState(() => pick(row));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(pick(row)); setMsg(''); }, [row.id]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const checks = copyChecks(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(pick(row));

  const save = async (patch = {}) => {
    const next = { ...f, ...patch };
    setBusy(true); setMsg('');
    try {
      await store.save(row.id, {
        title: next.title.trim() || row.title, status: next.status, channel: next.channel || null,
        product: next.product || null, target_date: next.target_date || null, cta: next.cta || null,
        notes: next.notes || null, body: next.body,
      });
      setF(next);
      setMsg(patch.status ? `Moved to ${patch.status}.` : 'Saved. It reaches Obsidian on the next sync.');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const step = NEXT[f.status];
  const [brief, setBrief] = useState('');
  const [drafting, setDrafting] = useState(false);
  const draft = async () => {
    if (dirty && !confirm('You have unsaved edits. Athena will work from the saved version. Continue?')) return;
    setDrafting(true); setMsg('');
    const ask = `Draft the copy for the content piece with id ${row.id}, titled "${row.title}"` +
      (row.channel ? ` for ${row.channel}` : '') + '. Read it with db.py first, including its notes. ' +
      'Read the ColibriOS Brand Files page before writing. Save the copy into its body, keep or set the one CTA, ' +
      'and set the status to Awaiting approval. Then tell me in two lines what angle you took.' +
      (brief.trim() ? ` Stephanie adds: ${brief.trim()}` : '');
    try {
      const { startError } = await askAthena(ask);
      setMsg(startError ? `Saved for Athena, but she did not start: ${startError}` : 'Athena is drafting. The copy appears here when she is done, and her note is in the Athena tab.');
    } catch (e) { setMsg(e.message); setDrafting(false); }
  };
  const drop = async () => {
    if (!confirm('Delete this piece? It is removed from Obsidian on the next sync too.')) return;
    try { await store.remove(row.id); onClose(); } catch (e) { setMsg(e.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-label="Content piece">
        <div className="d-head"><p className="eyebrow">Content · {f.status}</p><button className="linkbtn" type="button" onClick={onClose}>Close</button></div>
        <label className="f">Title<input type="text" value={f.title} onChange={set('title')} /></label>
        <div className="fields three">
          <label className="f">Status<select value={f.status} onChange={set('status')}>{CONTENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="f">Channel<select value={f.channel} onChange={set('channel')}><option value="">Pick one</option>{[...new Set([...CHANNELS, f.channel].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Target date<input type="date" value={f.target_date} onChange={set('target_date')} /></label>
        </div>
        <label className="f">The one CTA
          <div className="row-input">
            <input type="text" value={f.cta} onChange={set('cta')} placeholder={DEFAULT_CTA} />
            {f.cta !== DEFAULT_CTA && <button className="btn ghost small" type="button" onClick={() => setF({ ...f, cta: DEFAULT_CTA })}>Use the trial CTA</button>}
          </div>
        </label>
        <label className="f">The copy<textarea rows="12" value={f.body} onChange={set('body')} placeholder="Write the post here, or ask Athena to draft it." /></label>
        <div className="btn-row"><CopyButton text={f.body} /></div>
        <PieceMedia contentId={row.id} refresh={`${row.status}|${row.updated_at}`} />
        {checks.length > 0 && (
          <div className="checks" role="status">
            <strong>Before it goes out</strong>
            <ul>{checks.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        <label className="f">Notes<textarea rows="4" value={f.notes} onChange={set('notes')} placeholder="Which seed it came from, who needs to say yes, how it did" /></label>
        <div className="d-actions">
          <div className="btn-row">
            <button className="btn" type="button" onClick={() => save()} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
            {step && <button className="btn ghost" type="button" disabled={busy} onClick={() => save({ status: step.to })}>{step.label}</button>}
            {f.status !== 'Skipped' && f.status !== 'Shipped' && <button className="linkbtn" type="button" disabled={busy} onClick={() => save({ status: 'Skipped' })}>Skip it</button>}
          </div>
          <button className="linkbtn danger" type="button" onClick={drop}>Delete</button>
        </div>
        <p className="d-msg" role="status">{msg}</p>
        <div className="draft-ask">
          <label className="f">Anything Athena should know for the draft? (optional)
            <input type="text" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Angle, length, who it's for" />
          </label>
          <button className="btn ghost" type="button" disabled={drafting} onClick={draft}>{drafting ? 'Sent to Athena…' : 'Ask Athena to draft this'}</button>
          <p className="small muted">She writes in your voice from the brand files, saves the copy here, and sets it to Awaiting approval. About 2 to 3 minutes. Save your own edits first.</p>
        </div>
        {row.vault_path && <p className="small muted">In Obsidian: {row.vault_path}</p>}
      </aside>
    </>
  );
}

function CopyButton({ text }) {
  const [said, setSaid] = useState('');
  const copy = async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(text); setSaid('Copied'); }
    catch { setSaid('Select the text and copy it'); }
    setTimeout(() => setSaid(''), 2500);
  };
  return <button className="btn ghost small" type="button" onClick={copy} disabled={!text.trim()}>{said || 'Copy caption'}</button>;
}

// The images and videos that go with this piece, from Media, ready to download.
function PieceMedia({ contentId, refresh }) {
  const { rows, thumbs } = usePieceMedia(contentId, refresh);
  const [msg, setMsg] = useState('');
  if (!rows || rows.length === 0) return null;
  const blotato = rows.find((r) => r.source_url)?.source_url;
  const save = async (r) => { setMsg(''); try { await downloadFile(r); } catch (e) { setMsg(e.message); } };
  return (
    <section className="piece-media" aria-label="Images for this post">
      <div className="label-row"><strong>{rows.length === 1 ? 'The image' : `The images (${rows.length})`}</strong>
        {blotato && /^https:\/\/my\.blotato\.com\//.test(blotato) && <a className="btn ghost small" href={blotato} target="_blank" rel="noopener noreferrer">Open in Blotato</a>}
      </div>
      <div className="media-grid">
        {rows.map((r, i) => (
          <div key={r.id} className="tile">
            {thumbs[r.thumb_path]
              ? <img src={thumbs[r.thumb_path]} alt={`Slide ${i + 1}`} loading="lazy" />
              : <span className="tile-none">{r.mime.startsWith('video/') ? 'Video' : 'No preview'}</span>}
            <button className="linkbtn" type="button" onClick={() => save(r)}>Download{rows.length > 1 ? ` ${i + 1}` : ''}</button>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Also saved in Media, Finished posts.</p>
      {msg && <p className="d-msg">{msg}</p>}
    </section>
  );
}

function pick(r) {
  return {
    title: r.title || '', status: r.status || 'Idea', channel: r.channel || '', product: r.product || 'ColibriOS',
    target_date: r.target_date || '', cta: r.cta || '', notes: r.notes || '', body: r.body || '',
  };
}
