import { BUCKETS, CLOSED } from '../lib/constants.js';
import { diffDays, dueText, hrs, todayYMD } from '../lib/dates.js';

export function BucketChip({ name }) {
  if (!name) return <span className="pill warn" title="Every task needs a bucket so the hours split counts it">No bucket</span>;
  const b = BUCKETS.find((x) => x.name === name);
  return <span className="chip" style={{ '--c': `var(${b ? b.c : '--muted'})` }}><i />{name}</span>;
}

export function FlagPill({ flag }) {
  if (!flag) return null;
  const cls = { 'Off track Rock': 'danger', 'Off pace measurable': 'warn', 'Rolled twice': 'warn', 'L10 to-do': 'info' }[flag] || '';
  return <span className={'pill ' + cls}>{flag}</span>;
}

export function StatusPill({ status }) {
  if (status === 'In progress') return <span className="pill info">In progress</span>;
  if (status === 'Waiting on someone') return <span className="pill warn">Waiting on someone</span>;
  return null;
}

export function TaskRow({ task, onOpen, onToggle, compact }) {
  const done = CLOSED.has(task.status);
  const late = task.due && !done && diffDays(task.due, todayYMD()) < 0;
  return (
    <div className={'task' + (compact ? ' compact' : '') + (done ? ' is-done' : '')}>
      <input className="tick" type="checkbox" checked={task.status === 'Done'} aria-label={`Mark ${task.title} done`}
        onChange={(e) => onToggle(task, e.target.checked)} />
      <div>
        <button className="task-title" type="button" onClick={() => onOpen(task)}>{task.title}</button>
        <div className="meta">
          <span className={late ? 'late' : ''}>{dueText(task.due)}</span>
          {!compact && <BucketChip name={task.bucket} />}
          {task.est_hours ? <span className="mono">{hrs(task.est_hours)}</span> : null}
          <StatusPill status={task.status} />
          <FlagPill flag={task.eos_flag} />
        </div>
      </div>
    </div>
  );
}

// Checking a box marks the task Done; unchecking puts it back to Not started.
export function toggler(store) {
  return (task, checked) => store.save(task.id, { status: checked ? 'Done' : 'Not started' }).catch((e) => alert(e.message));
}

export function Panel({ title, eyebrow, extra, children, className = '' }) {
  return (
    <article className={'panel ' + className}>
      <div className="panel-head">
        <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
        {extra}
      </div>
      {children}
    </article>
  );
}

export function Skel() {
  return <div className="skel"><span /><span /><span /></div>;
}
