import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { askAthena, currentThread, newThread } from '../lib/athena.js';
import { Markdown } from '../lib/markdown.jsx';

const SUGGESTIONS = ['What should I do first today?', "What's due this week?", 'Plan my ColibriOS time this week', 'Give me ten hooks for seed 4'];
const fTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });

export default function Athena() {
  const [thread, setThread] = useState(currentThread);
  const [rows, setRows] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const logRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('athena_requests').select('*').eq('thread_id', thread).order('created_at');
    if (error) setErr(error.message); else setRows(data);
  }, [thread]);

  const busy = (rows || []).some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { load(); setTick((n) => n + 1); }, busy ? 4000 : 30000);
    return () => clearInterval(t);
  }, [load, busy]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [rows?.length, busy]);

  const send = useCallback(async (msg) => {
    msg = msg.trim();
    if (!msg) return;
    setErr(''); setText('');
    try {
      const { request, startError } = await askAthena(msg, thread);
      setRows((cur) => [...(cur || []), request]);
      if (startError) setErr(`Your message is saved, but Athena did not start: ${startError}`);
    } catch (e) { setErr(e.message); setText(msg); }
  }, [thread]);

  // A message handed over from another page (Today's quick ask) is sent once.
  useEffect(() => {
    const msg = location.state?.ask;
    if (msg) { navigate('.', { replace: true, state: null }); send(msg); }
  }, [location.state, navigate, send]);

  const working = (rows || []).find((r) => r.status === 'running') || (rows || []).find((r) => r.status === 'queued');
  const since = working ? Math.max(0, Math.round((Date.now() - Date.parse(working.started_at || working.created_at)) / 1000)) : 0;
  void tick;

  return (
    <section className="chat">
      <div className="chat-head">
        <div><p className="eyebrow">Your Chief of Staff</p><h2>Talk to Athena</h2></div>
        <button className="linkbtn" type="button" onClick={() => { setThread(newThread()); setRows([]); setErr(''); }}>Start a fresh conversation</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Athena reads and updates your tasks, briefs, money, content and brand files. She drafts but never sends. Replies take 1 to 3 minutes. She can't see Gmail or your calendar from here.</p>
      <div className="panel chat-log" ref={logRef} aria-live="polite">
        {rows && rows.length === 0 && <p className="bubble note">Ask anything, or tell her what to change.</p>}
        {(rows || []).map((r) => (
          <div key={r.id} className="turn">
            <div className="bubble me">{r.message}<span className="when">{fTime.format(new Date(r.created_at))}</span></div>
            {r.status === 'done' && <div className="bubble athena"><Markdown text={r.reply} /><span className="when">{r.finished_at && fTime.format(new Date(r.finished_at))}</span></div>}
            {r.status === 'failed' && (
              <div className="bubble athena failed">
                <strong>That one didn't go through.</strong>
                <p className="small">{r.error}</p>
                <button className="linkbtn" type="button" onClick={() => send(r.message)}>Try again</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {working && (
        <div className="working">
          <span className="dots"><i /><i /><i /></span>
          <span>{working.status === 'queued' ? 'Waking Athena up' : 'Athena is working'}… {Math.floor(since / 60)}:{String(since % 60).padStart(2, '0')}</span>
        </div>
      )}
      {err && <p className="form-msg">{err}</p>}
      {rows && rows.length === 0 && (
        <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
      )}
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea rows="2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Athena anything, or tell her what to change" aria-label="Message to Athena"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="btn" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
