import { useEffect, useState } from 'react';
import { CHANNELS, CONTENT_STATUSES, DEFAULT_CTA, copyChecks } from '../lib/content.js';

// The next step for a piece, so the common move is one click.
const NEXT = {
  Idea: { to: 'Drafted', label: 'Mark drafted' },
  Drafted: { to: 'Awaiting approval', label: 'Send for my approval' },
  'Awaiting approval': { to: 'Scheduled', label: 'Approve and schedule' },
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
        <label className="f">The copy<textarea rows="12" value={f.body} onChange={set('body')} placeholder="Write the post here, or ask Athena to draft it once chat is on." /></label>
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
        <button className="btn ghost" type="button" disabled title="Arrives with Athena chat">Ask Athena to draft this (coming with chat)</button>
        {row.vault_path && <p className="small muted">In Obsidian: {row.vault_path}</p>}
      </aside>
    </>
  );
}

function pick(r) {
  return {
    title: r.title || '', status: r.status || 'Idea', channel: r.channel || '', product: r.product || 'ColibriOS',
    target_date: r.target_date || '', cta: r.cta || '', notes: r.notes || '', body: r.body || '',
  };
}
