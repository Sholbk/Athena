import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_FILE, SHELVES, SPACE, fileUrl, sizeText, tagList, uploadFiles, useMedia } from '../lib/media.js';
import { Panel, Skel } from './bits.jsx';

// The Media view on the Marketing page: her own photos, and finished posts to use again.
export default function MediaLibrary() {
  const store = useMedia();
  const [shelf, setShelf] = useState(() => { try { return localStorage.getItem('athena:media-shelf') || 'photo'; } catch { return 'photo'; } });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const pick = (s) => { setShelf(s); setOpen(null); try { localStorage.setItem('athena:media-shelf', s); } catch {} };

  const rows = store.rows || [];
  const used = rows.reduce((n, r) => n + Number(r.bytes || 0), 0);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => r.shelf === shelf
    && (!needle || `${r.title} ${(r.tags || []).join(' ')} ${r.notes || ''}`.toLowerCase().includes(needle))), [rows, shelf, needle]);
  const current = open && rows.find((r) => r.id === open);

  return (
    <div className="media">
      <p className="muted small" style={{ margin: '14px 0' }}>Your own photos for posts, and the finished posts you made, saved to use again. Only you can see them. Athena sees the titles and tags, not the pictures.</p>
      <div className="media-top">
        <div className="seg small" role="tablist" aria-label="Media shelves">
          {SHELVES.map(([s, label]) => (
            <button key={s} type="button" role="tab" aria-selected={shelf === s} onClick={() => pick(s)}>
              {label} {store.rows && <span className="muted">{rows.filter((r) => r.shelf === s).length}</span>}
            </button>
          ))}
        </div>
        {store.rows && <Meter used={used} />}
      </div>
      {store.error && <div className="notice"><strong>The library did not load</strong><p>{store.error}</p></div>}
      <Uploader shelf={shelf} onDone={store.reload} />
      {!store.rows ? (!store.error && <Skel />) : (
        <>
          <div className="filters">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, tags and notes" aria-label="Search the library" />
            {needle && <span className="small muted">{shown.length === 1 ? '1 match' : `${shown.length} matches`}</span>}
          </div>
          {shown.length === 0
            ? <p className="empty">{needle ? `Nothing here matches "${q.trim()}".` : shelf === 'photo' ? 'No photos yet. Drop some in above.' : 'No finished posts yet. Drop in what you made so you can use it again.'}</p>
            : (
              <div className="media-grid">
                {shown.map((r) => (
                  <button key={r.id} type="button" className="tile" onClick={() => setOpen(r.id)}>
                    {store.thumbs[r.thumb_path]
                      ? <img src={store.thumbs[r.thumb_path]} alt="" loading="lazy" />
                      : <span className="tile-none">{r.mime.startsWith('video/') ? 'Video' : 'No preview'}</span>}
                    {r.mime.startsWith('video/') && store.thumbs[r.thumb_path] && <span className="tile-badge">Video</span>}
                    <span className="tile-title">{r.title}</span>
                    {r.tags?.length > 0 && <span className="tile-tags">{r.tags.join(', ')}</span>}
                  </button>
                ))}
              </div>
            )}
        </>
      )}
      {current && <MediaDrawer key={current.id} row={current} store={store} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Meter({ used }) {
  const pct = Math.min(100, (used / SPACE) * 100);
  return (
    <div className="meter" title="The free plan holds 1 GB in all">
      <span className="small muted">About {sizeText(used)} of 1 GB used</span>
      <span className="meter-bar"><i style={{ width: `${pct}%` }} className={pct > 85 ? 'full' : ''} /></span>
    </div>
  );
}

function Uploader({ shelf, onDone }) {
  const [tags, setTags] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const input = useRef(null);
  const label = shelf === 'photo' ? 'photos' : 'finished posts';

  const go = async (list) => {
    const files = [...(list || [])];
    if (!files.length || busy) return;
    setMsg(null);
    const res = await uploadFiles(files, { shelf, tags: tagList(tags) }, (n, total) => setBusy(`Uploading ${n} of ${total}…`));
    setBusy(null);
    if (input.current) input.current.value = '';
    setMsg(res);
    await onDone();
  };

  return (
    <Panel title={`Add ${label}`}>
      <label className={'drop' + (over ? ' over' : '') + (busy ? ' busy' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files); }}>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          onChange={(e) => go(e.target.files)} disabled={!!busy} />
        <strong>{busy || `Drop ${label} here, or click to choose`}</strong>
        <span className="small muted">
          {shelf === 'photo' ? 'Photos are shrunk to 2048 pixels on the longest side, still sharp for any post.' : 'Saved as they are.'}
          {` Up to ${sizeText(MAX_FILE)} a file. JPEG, PNG, WebP, GIF, MP4, MOV or WebM.`}
        </span>
      </label>
      <label className="f mt">Tags for this upload (optional)<input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="retreat, headshot, studio" /></label>
      {msg && (
        <div className="small mt">
          <p style={{ margin: 0 }}>{msg.added === 1 ? '1 added.' : `${msg.added} added.`}{msg.skipped.length > 0 && ` ${msg.skipped.length} skipped:`}</p>
          {msg.skipped.length > 0 && <ul className="plain">{msg.skipped.map((s, i) => <li key={i}><b>{s.name}</b>: {s.why}</li>)}</ul>}
        </div>
      )}
    </Panel>
  );
}

function MediaDrawer({ row, store, onClose }) {
  const [f, setF] = useState({ title: row.title, tags: (row.tags || []).join(', '), notes: row.notes || '', seed: row.seed ?? '' });
  const [src, setSrc] = useState(null);
  const [msg, setMsg] = useState('');
  const video = row.mime.startsWith('video/');
  useEffect(() => { let live = true; fileUrl(row).then((u) => live && setSrc(u)).catch((e) => live && setMsg(e.message)); return () => { live = false; }; }, [row]);

  const save = async () => {
    if (!f.title.trim()) return setMsg('Give it a title.');
    const seed = String(f.seed).trim();
    if (seed && !/^\d+$/.test(seed)) return setMsg('The seed is a number from the idea bank.');
    try { await store.save(row.id, { title: f.title.trim(), tags: tagList(f.tags), notes: f.notes.trim() || null, seed: seed ? Number(seed) : null }); setMsg('Saved.'); }
    catch (e) { setMsg(e.message); }
  };
  const download = async () => {
    try { const a = document.createElement('a'); a.href = await fileUrl(row, true); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
    catch (e) { setMsg(e.message); }
  };
  const remove = async () => {
    if (!confirm(`Delete "${row.title}"? The file is removed for good.`)) return;
    try { await store.remove(row); onClose(); } catch (e) { setMsg(e.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-label={row.title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="d-head"><p className="eyebrow">{row.shelf === 'photo' ? 'My photo' : 'Finished post'}</p><button className="linkbtn" type="button" onClick={onClose}>Close</button></div>
        <div className="media-view">
          {!src ? <Skel /> : video ? <video src={src} controls playsInline /> : <img src={src} alt={row.title} />}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {[row.width && row.height ? `${row.width} × ${row.height}` : null, sizeText(Number(row.bytes || 0))].filter(Boolean).join(' · ')}
        </p>
        <label className="f">Title<input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="f">Tags, separated by commas<input type="text" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
        {row.shelf === 'finished' && (
          <label className="f">Idea bank seed (optional)<input type="text" inputMode="numeric" value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} placeholder="4" /></label>
        )}
        <label className="f">Notes<textarea rows="3" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={row.shelf === 'finished' ? 'Where it ran and how it did' : 'Where it was taken, who is in it'} /></label>
        <div className="d-actions">
          <div className="btn-row">
            <button className="btn" type="button" onClick={save}>Save</button>
            <button className="btn ghost" type="button" onClick={download}>Download</button>
          </div>
          <button className="linkbtn danger" type="button" onClick={remove}>Delete</button>
        </div>
        <p className="d-msg">{msg}</p>
      </aside>
    </>
  );
}
