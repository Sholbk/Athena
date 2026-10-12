import { useState } from 'react';
import { BUCKETS, CLOSED, PRIORITIES } from '../lib/constants.js';
import { Panel, Skel, TaskRow, toggler } from '../components/bits.jsx';
import AddTask from '../components/AddTask.jsx';

export default function Tasks({ store, onOpen }) {
  const { tasks } = store;
  const [bucket, setBucket] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState('');
  const toggle = toggler(store);

  const all = tasks || [];
  const live = all.filter((t) => showDone || !CLOSED.has(t.status));
  const shown = live.filter((t) => (!bucket || (bucket === '-' ? !t.bucket : t.bucket === bucket))
    && (!q || (t.title + ' ' + (t.notes || '')).toLowerCase().includes(q.toLowerCase())));
  const count = (name) => live.filter((t) => (name === '-' ? !t.bucket : t.bucket === name)).length;
  const groups = [...PRIORITIES, null].map((p) => ({ p, rows: shown.filter((t) => (t.priority || null) === p) }));

  return (
    <section>
      <Panel title="Add a task"><AddTask store={store} inline /></Panel>
      <div className="filters" role="group" aria-label="Filter by bucket">
        <button type="button" className="fchip" aria-pressed={!bucket} onClick={() => setBucket('')}>All <b>{live.length}</b></button>
        {BUCKETS.map((b) => (
          <button key={b.name} type="button" className="fchip" style={{ '--c': `var(${b.c})` }} aria-pressed={bucket === b.name} onClick={() => setBucket(bucket === b.name ? '' : b.name)}>
            <i />{b.name} <b>{count(b.name)}</b>
          </button>
        ))}
        {count('-') > 0 && <button type="button" className="fchip" aria-pressed={bucket === '-'} onClick={() => setBucket(bucket === '-' ? '' : '-')}>No bucket <b>{count('-')}</b></button>}
        <input type="search" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        <label className="calopt"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!tasks ? <Skel /> : (
        <div className="groups">
          {groups.filter((g) => g.rows.length).map((g) => (
            <Panel key={g.p || 'none'} title={g.p || 'No priority'} extra={<span className="small muted">{g.rows.length}</span>}>
              {g.rows.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} />)}
            </Panel>
          ))}
          {shown.length === 0 && <p className="empty">No tasks match.</p>}
        </div>
      )}
    </section>
  );
}
