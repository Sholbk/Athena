import { useEffect, useState } from 'react';
import { BUCKETS, CLIENTS, EOS_FLAGS, PRIORITIES, STATUSES } from '../lib/constants.js';
import { FlagPill } from './bits.jsx';

export default function TaskDrawer({ task, store, onClose }) {
  const [f, setF] = useState(() => pick(task));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(pick(task)); setMsg(''); }, [task.id]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.bucket) return setMsg('Every task needs a bucket.');
    setBusy(true); setMsg('');
    try {
      await store.save(task.id, {
        title: f.title.trim() || task.title, status: f.status, priority: f.priority || null, due: f.due || null,
        est_hours: f.est_hours === '' ? null : Number(f.est_hours), bucket: f.bucket, client: f.client || null,
        eos_flag: f.eos_flag || null, notes: f.notes,
      });
      setMsg('Saved. It reaches Obsidian on the next sync.');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const drop = async () => {
    if (!confirm('Delete this task? It is removed from Obsidian on the next sync too.')) return;
    try { await store.remove(task.id); onClose(); } catch (e) { setMsg(e.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Task">
        <div className="d-head"><p className="eyebrow">Task</p><button className="linkbtn" type="button" onClick={onClose}>Close</button></div>
        <label className="f">Title<input type="text" value={f.title} onChange={set('title')} /></label>
        <div className="meta"><FlagPill flag={task.eos_flag} /></div>
        <div className="fields">
          <Sel label="Status" v={f.status} on={set('status')} opts={STATUSES} />
          <Sel label="Priority" v={f.priority} on={set('priority')} opts={PRIORITIES} blank />
          <label className="f">Due<input type="date" value={f.due} onChange={set('due')} /></label>
          <label className="f">Est. hours<input type="number" min="0" step="0.25" inputMode="decimal" value={f.est_hours} onChange={set('est_hours')} /></label>
          <Sel label="Bucket" v={f.bucket} on={set('bucket')} opts={BUCKETS.map((b) => b.name)} blank />
          <Sel label="Client" v={f.client} on={set('client')} opts={CLIENTS} blank />
          <Sel label="EOS flag" v={f.eos_flag} on={set('eos_flag')} opts={EOS_FLAGS} blank />
        </div>
        <label className="f">Notes<textarea rows="8" value={f.notes} onChange={set('notes')} /></label>
        <div className="d-actions">
          <button className="btn" type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="linkbtn danger" type="button" onClick={drop}>Delete</button>
        </div>
        <p className="d-msg" role="status">{msg}</p>
        {task.vault_path && <p className="small muted">In Obsidian: {task.vault_path}</p>}
      </aside>
    </>
  );
}

function pick(t) {
  return {
    title: t.title || '', status: t.status || 'Not started', priority: t.priority || '', due: t.due || '',
    est_hours: t.est_hours ?? '', bucket: t.bucket || '', client: t.client || '', eos_flag: t.eos_flag || '', notes: t.notes || '',
  };
}

function Sel({ label, v, on, opts, blank }) {
  return (
    <label className="f">{label}
      <select value={v} onChange={on}>{blank && <option value="">None</option>}{opts.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
}
