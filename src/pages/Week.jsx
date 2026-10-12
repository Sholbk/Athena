import { useState } from 'react';
import { CLOSED } from '../lib/constants.js';
import { addDays, dayLabel, diffDays, mdLabel, mondayOf, todayYMD } from '../lib/dates.js';
import { Panel, TaskRow, toggler } from '../components/bits.jsx';
import Split from '../components/Split.jsx';

export default function Week({ store, onOpen }) {
  const today = todayYMD();
  const [mon, setMon] = useState(mondayOf(today));
  const toggle = toggler(store);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const sun = days[6];
  const tasks = store.tasks || [];
  const inWeek = tasks.filter((t) => t.due && t.due >= mon && t.due <= sun);
  const undated = tasks.filter((t) => !t.due && !CLOSED.has(t.status) && t.priority !== 'Backlog');
  const offset = diffDays(mon, mondayOf(today)) / 7;
  const label = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : offset === 1 ? 'Next week' : 'Week of';

  return (
    <section>
      <div className="week-head">
        <div><p className="eyebrow">{label}</p><h2>{mdLabel(mon)} to {mdLabel(sun)}</h2></div>
        <div className="week-nav">
          <button className="btn ghost small" type="button" onClick={() => setMon(addDays(mon, -7))}>‹ Last week</button>
          <button className="btn ghost small" type="button" onClick={() => setMon(mondayOf(today))}>This week</button>
          <button className="btn ghost small" type="button" onClick={() => setMon(addDays(mon, 7))}>Next week ›</button>
        </div>
      </div>
      <div className="week-top">
        <Panel title="Planned hours"><Split tasks={inWeek.filter((t) => t.status !== 'Dropped')} /></Panel>
        <Panel title="Needs a date" extra={<span className="small muted">{undated.length}</span>}>
          {undated.length === 0 ? <p className="empty">Every open task has a date or sits in Backlog.</p>
            : undated.slice(0, 8).map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} compact />)}
        </Panel>
      </div>
      <div className="days">
        {days.map((d) => {
          const rows = inWeek.filter((t) => t.due === d);
          return (
            <div key={d} className={'day' + (d === today ? ' today' : d < today ? ' past' : '')}>
              <h3>{dayLabel(d).split(',')[0]} <small>{mdLabel(d)}</small></h3>
              {rows.length === 0 ? <p className="empty small">Nothing due</p>
                : rows.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} compact />)}
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Your calendar events join this view once you paste your Google Calendar iCal links in Settings. That's coming in a later step.</p>
    </section>
  );
}
