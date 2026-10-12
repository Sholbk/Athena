import { BUCKETS } from '../lib/constants.js';
import { hrs } from '../lib/dates.js';

// Planned hours by bucket, from the estimates on tasks due in the range.
export default function Split({ tasks }) {
  const by = {};
  let total = 0, missing = 0;
  for (const t of tasks) {
    if (!t.bucket) { missing++; continue; }
    const h = Number(t.est_hours || 0);
    by[t.bucket] = (by[t.bucket] || 0) + h;
    total += h;
  }
  if (!total) return <p className="empty">No estimated hours on these tasks yet.</p>;
  return (
    <>
      <div className="split">
        {BUCKETS.filter((b) => by[b.name]).map((b) => (
          <span key={b.name} style={{ '--c': `var(${b.c})`, width: `${(by[b.name] / total) * 100}%` }} title={`${b.name}: ${hrs(by[b.name])}`} />
        ))}
      </div>
      <div className="legend">
        {BUCKETS.filter((b) => by[b.name]).map((b) => (
          <span key={b.name} style={{ '--c': `var(${b.c})` }}><i />{b.name} <b>{hrs(by[b.name])}</b></span>
        ))}
      </div>
      {missing > 0 && <p className="logged">{missing} task{missing > 1 ? 's have' : ' has'} no bucket and {missing > 1 ? 'are' : 'is'} not counted.</p>}
    </>
  );
}
