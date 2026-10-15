import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
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
  const cal = useCalendar(mon, sun);

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
              {cal.events?.some((e) => e.date === d) && (
                <div className="cal-events">
                  {cal.events.filter((e) => e.date === d).map((e, i) => (
                    <div key={i} className="cal-ev" title={e.calendar}><b>{e.allDay ? 'All day' : fTime.format(new Date(e.start))}</b>{e.title}</div>
                  ))}
                </div>
              )}
              {rows.length === 0 ? <p className="empty small">Nothing due</p>
                : rows.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} compact />)}
            </div>
          );
        })}
      </div>
      {cal.linked === false && <p className="small muted" style={{ marginTop: 16 }}>Your calendar events show here once you link your Google Calendar in <Link to="/settings">Settings</Link>.</p>}
      {cal.problems?.map((p) => <p key={p} className="small muted" style={{ marginTop: 8 }}>{p}</p>)}
    </section>
  );
}

const fTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });

// Her Google Calendar events for the week, read by the calendar-events edge function.
function useCalendar(from, to) {
  const [cal, setCal] = useState({});
  useEffect(() => {
    let live = true;
    supabase.functions.invoke('calendar-events', { body: { from, to } })
      .then(({ data, error }) => { if (live) setCal(error ? { problems: ['Your calendar could not be read just now.'] } : data); });
    return () => { live = false; };
  }, [from, to]);
  return cal;
}
