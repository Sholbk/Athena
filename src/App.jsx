import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './lib/supabase.js';
import { useTasks } from './lib/tasks.js';
import { longLabel, todayYMD } from './lib/dates.js';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';
import Tasks from './pages/Tasks.jsx';
import Week from './pages/Week.jsx';
import Soon from './pages/Soon.jsx';
import Marketing from './pages/Marketing.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';
import Owl from './components/Owl.jsx';

const NAV = [
  ['/', 'Today'], ['/tasks', 'Tasks'], ['/week', 'Week'],
  ['/marketing', 'Marketing'], ['/eos', 'EOS'], ['/athena', 'Athena'],
];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [allowed, setAllowed] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setAllowed(undefined); return; }
    // The allowlist table only answers for people on it, so one row back means you are in.
    supabase.from('allowed_users').select('email').limit(1)
      .then(({ data, error }) => setAllowed(!error && data && data.length > 0));
  }, [session]);

  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  if (allowed === undefined) return <Splash />;
  if (!allowed) return <NotAllowed email={session.user.email} />;
  return <Shell email={session.user.email} />;
}

function Shell({ email }) {
  const store = useTasks();
  const [open, setOpen] = useState(null);
  const openTask = (t) => setOpen(t.id);
  const current = open && store.tasks ? store.tasks.find((t) => t.id === open) : null;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div className="brand">
              <Owl />
              <div>
                <h1>Athena</h1>
                <p>{longLabel(todayYMD())}, Mountain time</p>
              </div>
            </div>
            <div className="who">
              <span className="small muted">{email}</span>
              <button className="linkbtn" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </div>
          <nav className="tabs" aria-label="Sections">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>{label}</NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap">
        {store.error && <div className="notice"><strong>Could not load your tasks</strong><p>{store.error}</p></div>}
        <Routes>
          <Route path="/" element={<Today store={store} onOpen={openTask} />} />
          <Route path="/tasks" element={<Tasks store={store} onOpen={openTask} />} />
          <Route path="/week" element={<Week store={store} onOpen={openTask} />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/eos" element={<Soon title="EOS" what="Rocks, Scorecard, Issues List and the Level 10 log, all editable here." />} />
          <Route path="/athena" element={<Soon title="Talk to Athena" what="Ask Athena anything. She answers through Claude Code on your subscription, in a minute or two." />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {current && <TaskDrawer task={current} store={store} onClose={() => setOpen(null)} />}
    </>
  );
}

function Splash() {
  return <div className="center"><Owl size={44} /><p className="muted">Opening Athena…</p></div>;
}

function NotAllowed({ email }) {
  return (
    <div className="center">
      <Owl size={44} />
      <h2>This account is not on Athena's list</h2>
      <p className="muted">You signed in as {email}. Only approved accounts can open Athena.</p>
      <button className="btn" type="button" onClick={() => supabase.auth.signOut()}>Sign in with a different account</button>
    </div>
  );
}
