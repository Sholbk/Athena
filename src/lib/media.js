import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Her media library: her own photos, and finished posts to reuse, in the private "media" bucket.
// The project is on Supabase's free plan (1 GB in all, 50 MB a file), so a photo is shrunk to
// 2048 pixels on its longest side before upload. A finished post keeps its file as it is.

export const BUCKET = 'media';
export const SPACE = 1024 ** 3;
export const MAX_FILE = 50 * 1024 ** 2;
export const SHELVES = [['photo', 'My photos'], ['finished', 'Finished posts']];
export const MEDIA_COLS = 'id,shelf,title,tags,notes,seed,path,thumb_path,mime,bytes,width,height,created_at,updated_at';
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'];
const PHOTO_EDGE = 2048;
const THUMB_EDGE = 480;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

export const bucket = () => supabase.storage.from(BUCKET);
export const extOf = (row) => EXT[row.mime] || 'bin';
export const tagList = (text) => [...new Set(String(text || '').split(',').map((t) => t.trim()).filter(Boolean))];

export function sizeText(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The rows, plus short-lived links to their previews.
export function useMedia() {
  const [rows, setRows] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('media').select(MEDIA_COLS).is('deleted_at', null).order('created_at', { ascending: false });
    if (error) { setError(error.message); return; }
    setRows(data); setError(null);
    const paths = data.map((r) => r.thumb_path).filter(Boolean);
    if (!paths.length) { setThumbs({}); return; }
    const { data: signed } = await bucket().createSignedUrls(paths, 3600);
    setThumbs(Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl])));
  }, []);

  useEffect(() => {
    load();
    // Preview links last an hour, so refresh well before they run out.
    const t = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const save = useCallback(async (id, patch) => {
    setRows((cur) => cur && cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from('media').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { await load(); throw error; }
  }, [load]);

  // Deletes for real, files first, so the space comes back.
  const remove = useCallback(async (row) => {
    const { error: e1 } = await bucket().remove([row.path, row.thumb_path].filter(Boolean));
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('media').delete().eq('id', row.id);
    if (e2) throw e2;
    setRows((cur) => cur && cur.filter((r) => r.id !== row.id));
  }, []);

  return { rows, thumbs, error, reload: load, save, remove };
}

// Uploads a batch one file at a time. A file that cannot be used is skipped with a reason;
// it never stops the rest. Returns { added, skipped: [{ name, why }] }.
export async function uploadFiles(files, { shelf, tags }, onProgress = () => {}) {
  let added = 0;
  const skipped = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress(i + 1, files.length, file.name);
    try {
      const item = await prepare(file, shelf);
      if (item.main.size > MAX_FILE) throw new Error(`over 50 MB (${sizeText(item.main.size)}), the most the free plan takes for one file`);
      await store(item, file, shelf, tags);
      added++;
    } catch (e) {
      skipped.push({ name: file.name, why: e.message });
    }
  }
  return { added, skipped };
}

async function store(item, file, shelf, tags) {
  const id = crypto.randomUUID();
  const path = `${shelf}/${id}.${EXT[item.type]}`;
  const thumbPath = item.thumb ? `thumbs/${id}.jpg` : null;
  const done = [];
  try {
    if (item.thumb) { await put(thumbPath, item.thumb, 'image/jpeg'); done.push(thumbPath); }
    await put(path, item.main, item.type); done.push(path);
    const { error } = await supabase.from('media').insert({
      shelf, title: file.name.replace(/\.[^.]+$/, '') || 'Untitled', tags,
      path, thumb_path: thumbPath, mime: item.type,
      bytes: item.main.size + (item.thumb ? item.thumb.size : 0), width: item.width || null, height: item.height || null,
    });
    if (error) throw error;
  } catch (e) {
    if (done.length) await bucket().remove(done);  // leave nothing behind that the library cannot show
    throw e;
  }
}

async function put(path, blob, contentType) {
  const { error } = await bucket().upload(path, blob, { contentType, upsert: false, cacheControl: '3600' });
  if (error) throw error;
}

async function prepare(file, shelf) {
  const type = file.type;
  if (!TYPES.includes(type)) {
    if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(file.name)) throw new Error('an HEIC photo. In Photos, export it as JPEG, then upload that');
    throw new Error('not a picture or video type this library takes (JPEG, PNG, WebP, GIF, MP4, MOV or WebM)');
  }
  if (type.startsWith('video/')) {
    const v = await videoPreview(file);
    return { main: file, type, thumb: v.thumb, width: v.width, height: v.height };
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('this picture could not be read'); }
  const { width, height } = bitmap;
  try {
    const thumb = await toJpeg(bitmap, width, height, THUMB_EDGE, 0.8);
    // Photos are shrunk to fit the free plan. Small ones, GIFs and finished posts stay as they are.
    if (shelf === 'photo' && type !== 'image/gif' && (Math.max(width, height) > PHOTO_EDGE || file.size > 4 * 1024 ** 2)) {
      const scale = Math.min(1, PHOTO_EDGE / Math.max(width, height));
      const main = await toJpeg(bitmap, width, height, PHOTO_EDGE, 0.86);
      return { main, type: 'image/jpeg', thumb, width: Math.round(width * scale), height: Math.round(height * scale) };
    }
    return { main: file, type, thumb, width, height };
  } finally {
    bitmap.close?.();
  }
}

// Draws a picture or a video frame at most `edge` pixels on its longest side, as a JPEG.
function toJpeg(source, width, height, edge, quality) {
  const scale = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';  // see-through parts of a PNG would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the preview could not be made'))), 'image/jpeg', quality));
}

// A frame from about one second in. Some videos (HEVC .mov) do not play in every browser:
// those are still saved, with no preview.
function videoPreview(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let finished = false;
    const finish = (out) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => finish({}), 8000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onerror = () => finish({});
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 0) / 2); };
    v.onseeked = async () => {
      const size = { width: v.videoWidth || null, height: v.videoHeight || null };
      if (!v.videoWidth) return finish(size);
      try { finish({ ...size, thumb: await toJpeg(v, v.videoWidth, v.videoHeight, THUMB_EDGE, 0.8) }); }
      catch { finish(size); }
    };
    v.src = url;
  });
}

// Short-lived link to the full file, to show it or to save it.
export async function fileUrl(row, download = false) {
  const opts = download ? { download: `${row.title}.${extOf(row)}` } : undefined;
  const { data, error } = await bucket().createSignedUrl(row.path, 3600, opts);
  if (error) throw error;
  return data.signedUrl;
}
