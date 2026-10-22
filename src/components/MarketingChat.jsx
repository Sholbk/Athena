import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { askAthena } from '../lib/athena.js';
import { Markdown } from '../lib/markdown.jsx';

// The marketing desk: a chat box on the Marketing hub for requests and ideas. Each message goes to
// Athena marked as coming from here (athena/PROMPT.md, "From the Marketing hub"), so she makes
// posts, adds idea bank seeds, or answers, and what she makes shows in Pipeline. Its own
// conversation, kept apart from the Athena tab.
export const MARK = 'From the Marketing hub: ';
const KEY = 'athena:mkt-thread';
const SUGGESTIONS = ['Write a post about the bank import', 'Give me 5 post ideas for Black Friday', 'Add this idea to the idea bank: ', 'What should I post this week?'];
const fTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function thread() {
  try {
    let t = localStorage.getItem(KEY);
    if (!t) { t = crypto.randomUUID(); localStorage.setItem(KEY, t); }
    return t;
  } catch { return crypto.randomUUID(); }
}

export default function MarketingChat({ onReply }) {
  const [tid, setTid] = useState(thread);
  const [rows, setRows] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('athena:mkt-chat-open') !== 'no'; } catch { return true; } });
  const logRef = useRef(null);
  const doneRef = useRef(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('athena_requests').select('id,message,reply,status,error,created_at,finished_at').eq('thread_id', tid).order('created_at');
    if (error) { setErr(error.message); return; }
    setRows(data);
    const done = data.filter((r) => r.status === 'done').length;
    if (doneRef.current && done > doneRef.current) onReply?.();   // a new answer: Pipeline and the idea bank may have changed
    doneRef.current = done;
  }, [tid, onReply]);

  const busy = (rows || []).some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, busy ? 5000 : 60000);
    return () => clearInterval(t);
  }, [load, busy]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [rows?.length, busy, open]);

  const send = async (msg) => {
    msg = msg.trim();
    if (!msg) return;
    setErr(''); setText('');
    try {
      const { request, startError } = await askAthena(MARK + msg, tid);
      setRows((cur) => [...(cur || []), request]);
      if (startError) setErr(`Saved, but Athena did not start: ${startError}`);
    } catch (e) { setErr(e.message); setText(msg); }
  };
  const fresh = () => { const t = crypto.randomUUID(); try { localStorage.setItem(KEY, t); } catch {} setTid(t); setRows([]); setErr(''); doneRef.current = 0; };
  const toggle = () => { setOpen(!open); try { localStorage.setItem('athena:mkt-chat-open', open ? 'no' : 'yes'); } catch {} };
  const shown = (m) => (m.startsWith(MARK) ? m.slice(MARK.length) : m);
  const recent = (rows || []).slice(-6);

  return (
    <section className={'mkt-chat' + (open ? '' : ' closed')} aria-label="Marketing desk">
      <div className="label-row">
        <div><strong>Marketing desk</strong> <span className="small muted">Tell Athena what to make, or drop an idea. Posts land in Pipeline, ideas in the idea bank.</span></div>
        <div className="btn-row">
          {open && rows && rows.length > 0 && <button className="linkbtn quiet" type="button" onClick={fresh}>Fresh start</button>}
          <button className="linkbtn" type="button" onClick={toggle} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      {open && (
        <>
          {rows && rows.length > 0 && (
            <div className="panel chat-log short" ref={logRef} aria-live="polite">
              {rows.length > 6 && <p className="bubble note">Earlier messages are kept; showing the last 6.</p>}
              {recent.map((r) => (
                <div key={r.id} className="turn">
                  <div className="bubble me">{shown(r.message)}<span className="when">{fTime.format(new Date(r.created_at))}</span></div>
                  {r.status === 'done' && <div className="bubble athena"><Markdown text={r.reply} /><span className="when">{r.finished_at && fTime.format(new Date(r.finished_at))}</span></div>}
                  {r.status === 'failed' && (
                    <div className="bubble athena failed"><strong>That one did not go through.</strong><p className="small">{r.error}</p>
                      <button className="linkbtn" type="button" onClick={() => send(shown(r.message))}>Try again</button></div>
                  )}
                </div>
              ))}
            </div>
          )}
          {busy && <div className="working"><span className="dots"><i /><i /><i /></span><span>Athena is on it. A post takes 2 to 3 minutes, an answer about 1.</span></div>}
          {err && <p className="form-msg">{err}</p>}
          {(!rows || rows.length === 0) && (
            <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => (s.endsWith(': ') ? setText(s) : send(s))}>{s.trim()}</button>)}</div>
          )}
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <textarea rows="2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a post about… / Idea: … / What should I post this week?" aria-label="Message to Athena about marketing"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            <button className="btn" type="submit" disabled={!text.trim() || busy}>Send</button>
          </form>
        </>
      )}
    </section>
  );
}
