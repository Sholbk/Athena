import { CLOSED } from '../lib/constants.js';
import { addDays, diffDays, greeting, mondayOf, todayYMD } from '../lib/dates.js';
import { Panel, Skel, TaskRow, toggler } from '../components/bits.jsx';
import AddTask from '../components/AddTask.jsx';
import Split from '../components/Split.jsx';

export default function Today({ store, onOpen }) {
  const { tasks } = store;
  const today = todayYMD();
  const toggle = toggler(store);
  const open = (tasks || []).filter((t) => !CLOSED.has(t.status));
  const late = open.filter((t) => t.due && diffDays(t.due, today) < 0);
  const dueToday = open.filter((t) => t.due === today || (t.priority === 'Today' && (!t.due || t.due >= today)));
  const flagged = open.filter((t) => t.eos_flag);
  const mon = mondayOf(today), sun = addDays(mon, 6);
  const thisWeek = open.filter((t) => t.due && t.due >= mon && t.due <= sun);
  const waiting = open.filter((t) => t.status === 'Waiting on someone');

  return (
    <section>
      <div className="hello">
        <h2>{greeting()}, Stephanie</h2>
        {tasks ? (
          <div className="summary">
            <span><b>{dueToday.length}</b> for today</span>
            <span><b>{late.length}</b> late</span>
            <span><b>{thisWeek.length}</b> due this week</span>
            <span><b>{waiting.length}</b> waiting on someone</span>
          </div>
        ) : <div className="summary">Pulling today together…</div>}
      </div>
      <div className="grid-today">
        <div className="col">
          <Panel title="Today" eyebrow={late.length ? `${late.length} late` : null}>
            {!tasks ? <Skel /> : (late.length + dueToday.length === 0
              ? <p className="empty">Nothing due today. Pick something from this week.</p>
              : [...late, ...dueToday.filter((t) => !late.includes(t))].map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} />))}
          </Panel>
          <Panel title="Add a task"><AddTask store={store} /></Panel>
        </div>
        <div className="col">
          <Panel title="Planned hours this week"><Split tasks={thisWeek} /></Panel>
          <Panel title="EOS flags">
            {!tasks ? <Skel /> : flagged.length === 0 ? <p className="empty">No flagged tasks.</p>
              : flagged.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} compact />)}
          </Panel>
          <Panel title="Waiting on someone">
            {!tasks ? <Skel /> : waiting.length === 0 ? <p className="empty">Nobody owes you anything right now.</p>
              : waiting.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} compact />)}
          </Panel>
        </div>
      </div>
    </section>
  );
}
