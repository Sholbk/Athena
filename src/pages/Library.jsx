import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Markdown } from '../lib/markdown.jsx';
import { Skel } from '../components/bits.jsx';

// The AI Bootcamp notes from the vault's AI Bootcamp folder, to browse and read.
// Read only here: a note is changed in Obsidian and reaches the app on the next sync.
const FOLDER = 'AI Bootcamp';
const SECTIONS = ['Guides', 'Class notes', 'Transcripts'];

// "Class notes, Session 1 (Sep 29)" sits under Class notes as "Session 1 (Sep 29)".
function sortOf(title) {
  if (/^Class notes, /i.test(title)) return ['Class notes', title.replace(/^Class notes, /i, '')];
  if (/^Transcript, /i.test(title)) return ['Transcripts', title.replace(/^Transcript, /i, '')];
  return ['Guides', title.replace(/^The A[EI]{2}B /, '')];
}

function useNotes() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('pages').select('id,title,body,updated_at')
      .eq('folder', FOLDER).is('deleted_at', null).order('title');
    if (error) setError(error.message); else { setRows(data); setError(null); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  return { rows, error };
}

export default function Library() {
  const { rows, error } = useNotes();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const navRef = useRef(null);
  const docRef = useRef(null);

  const notes = useMemo(() => (rows || [])
    .map((r) => { const [section, label] = sortOf(r.title); return { ...r, section, label }; })
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.label.localeCompare(b.label)), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? notes.filter((n) => `${n.title}\n${n.body || ''}`.toLowerCase().includes(needle)) : notes;
  const note = shown.find((n) => n.id === sel) || shown[0];

  // Scrolls so the top of el sits just under the app's sticky header.
  const scrollTo = (el) => {
    const head = document.querySelector('.top')?.offsetHeight || 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - head - 12, behavior: 'smooth' });
  };
  // On a phone the note sits below the list, so jump to it. On a computer they sit side by
  // side, so only scroll when the page is already deep into a long note.
  const open = (id) => {
    setSel(id);
    requestAnimationFrame(() => {
      const doc = docRef.current, nav = navRef.current;
      if (!doc || !nav) return;
      const stacked = doc.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 1;
      const head = document.querySelector('.top')?.offsetHeight || 0;
      if (stacked || doc.getBoundingClientRect().top < head) scrollTo(doc);
    });
  };

  return (
    <section>
      <div className="week-head"><div><p className="eyebrow">Library</p><h2>AI Bootcamp</h2></div></div>
      {error && <div className="notice"><strong>The notes did not load</strong><p>{error}</p></div>}
      {!rows ? (!error && <Skel />) : notes.length === 0 ? <p className="empty">The AI Bootcamp notes have not synced yet.</p> : (
        <>
          <div className="filters">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the notes" aria-label="Search the notes" />
            {needle && <span className="small muted">{shown.length === 1 ? '1 note' : `${shown.length} notes`}</span>}
          </div>
          {shown.length === 0 ? <p className="empty">No notes mention "{q.trim()}".</p> : (
            <div className="brand-view library">
              <nav className="side" aria-label="AI Bootcamp notes" ref={navRef}>
                {SECTIONS.map((s) => {
                  const list = shown.filter((n) => n.section === s);
                  return list.length > 0 && (
                    <Fragment key={s}>
                      <p className="eyebrow">{s}</p>
                      {list.map((n) => (
                        <button key={n.id} type="button" className={n.id === note.id ? 'on' : ''} aria-current={n.id === note.id || undefined}
                          onClick={() => open(n.id)}>{n.label}</button>
                      ))}
                    </Fragment>
                  );
                })}
              </nav>
              <article className="panel doc" ref={docRef}>
                <div className="lib-head">
                  <p className="eyebrow">{note.section}</p>
                  <button className="linkbtn lib-back" type="button" onClick={() => scrollTo(navRef.current)}>Back to the list</button>
                </div>
                <Markdown text={note.body || ''} />
                <p className="small muted">To change this note, edit it in Obsidian, in the AI Bootcamp folder.</p>
              </article>
            </div>
          )}
        </>
      )}
    </section>
  );
}
