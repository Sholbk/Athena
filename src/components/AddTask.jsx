import { useState } from 'react';
import { BUCKETS, CLIENTS, PRIORITIES } from '../lib/constants.js';
import { todayYMD } from '../lib/dates.js';

export default function AddTask({ store, inline }) {
  const blank = { title: '', due: todayYMD(), priority: 'This week', bucket: '', client: 'None', est_hours: '' };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return setMsg('Give the task a name.');
    if (!f.bucket) return setMsg('Pick a bucket so the hours split can count it.');
    setBusy(true); setMsg('');
    try {
      await store.create({
        title: f.title.trim(), due: f.due || null, priority: f.priority, bucket: f.bucket,
        client: f.client || null, est_hours: f.est_hours === '' ? null : Number(f.est_hours),
        status: 'Not started', source: 'Stephanie',
      });
      setF(blank);
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  };

  return (
    <form className={'add' + (inline ? ' inline' : '')} onSubmit={submit}>
      <label className="f wide">What needs doing<input type="text" value={f.title} onChange={set('title')} placeholder="Call Brian about the four contact forms" /></label>
      <label className="f">Due<input type="date" value={f.due} onChange={set('due')} /></label>
      <label className="f">Priority<select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="f">Bucket<select value={f.bucket} onChange={set('bucket')}><option value="">Pick one</option>{BUCKETS.map((b) => <option key={b.name}>{b.name}</option>)}</select></label>
      <label className="f">Est. hours<input type="number" min="0" step="0.25" inputMode="decimal" value={f.est_hours} onChange={set('est_hours')} /></label>
      <label className="f">Client<select value={f.client} onChange={set('client')}>{CLIENTS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add task'}</button>
        <p className="form-msg">{msg}</p>
      </div>
    </form>
  );
}
