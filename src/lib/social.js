// The Social Media page's scoring, kept apart from the page so it can be tested (tests/social.test.mjs).
// Every post is compared with her own usual on that platform and format: views where the platform
// shows them, likes + comments + shares + saves on LinkedIn, which shows no views.

export const NAMES = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube', twitter: 'X', other: 'Other' };
export const WORKED = 1.5;     // 1.5 times usual or more
export const MISSED = 0.5;     // half of usual or less
export const TOO_NEW_HOURS = 48;
const DAY = 86400000;

export function median(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function engagement(m) {
  if (!m) return null;
  const vals = ['likes', 'comments', 'shares', 'saves'].map((k) => m[k]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export const usesViews = (platform) => platform !== 'linkedin';
export const scoreOf = (platform, m) => (m ? (usesViews(platform) ? m.views ?? null : engagement(m)) : null);

export function formatWord(platform, format) {
  if (platform === 'instagram') return { video: 'reel', image: 'post', carousel: 'carousel', text: 'post' }[format] || 'post';
  if (platform === 'youtube') return 'video';
  if (format === 'video') return 'video';
  if (format === 'carousel') return 'carousel';
  return 'post';
}

export function shortNum(n) {
  if (n == null) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function times(r) {
  if (r == null) return null;
  return `${r >= 10 ? r.toFixed(1).replace(/\.0$/, '') : r.toFixed(1)}×`;
}

const FIELDS = ['views', 'reach', 'likes', 'comments', 'saves', 'shares'];

// One set of numbers per post: for each number, the newest snapshot that has it. Apify sends fresh
// likes and comments every refresh; Blotato's weekly snapshot may be the only one with photo views.
export function mergeLatest(metrics) {
  const out = {};
  const sorted = metrics.slice().sort((a, b) => (a.fetched_at < b.fetched_at ? 1 : -1));
  for (const m of sorted) {
    const cur = out[m.post_id] || (out[m.post_id] = { post_id: m.post_id, fetched_at: m.fetched_at });
    for (const k of FIELDS) if (cur[k] == null && m[k] != null) cur[k] = m[k];
  }
  return out;
}

// posts: rows of posts; metrics: rows of post_metrics, any order. Returns everything the page shows.
export function scorecard(posts, metrics, now = new Date()) {
  const t = now.getTime();
  const latest = mergeLatest(metrics);

  const rows = posts.map((p) => {
    const m = latest[p.id] || null;
    const age = (t - new Date(p.posted_at).getTime()) / 3600000;
    return { ...p, m, ageHours: age, score: scoreOf(p.platform, m), eng: engagement(m), views: m?.views ?? null };
  });

  // Her usual: the median score of judged posts (48 hours or older) on the same platform and format,
  // or the whole platform when that format has fewer than 3 posts.
  const judged = rows.filter((r) => r.ageHours >= TOO_NEW_HOURS && r.score != null);
  const usualFor = (r) => {
    const same = judged.filter((x) => x.platform === r.platform && (x.format || null) === (r.format || null));
    const pool = same.length >= 3 ? same : judged.filter((x) => x.platform === r.platform);
    return median(pool.map((x) => x.score));
  };
  for (const r of rows) {
    r.usual = usualFor(r);
    r.ratio = r.score != null && r.usual ? r.score / r.usual : null;
    r.verdict = r.ageHours < TOO_NEW_HOURS ? 'new' : r.ratio == null ? 'unknown' : r.ratio >= WORKED ? 'worked' : r.ratio <= MISSED ? 'missed' : 'normal';
  }

  const inRange = (r, fromDays, toDays) => {
    const age = t - new Date(r.posted_at).getTime();
    return age >= toDays * DAY && age < fromDays * DAY;
  };
  const week = rows.filter((r) => inRange(r, 7, 0)).sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));
  const last = rows.filter((r) => inRange(r, 14, 7));

  const graded = week.filter((r) => r.ratio != null && r.verdict !== 'new');
  const worked = graded.filter((r) => r.verdict === 'worked').sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  const missed = graded.filter((r) => r.ratio < 1).sort((a, b) => a.ratio - b.ratio).slice(0, 2);
  const strongest = graded.slice().sort((a, b) => b.ratio - a.ratio)[0] || null;

  const platforms = [...new Set([...week, ...last].map((r) => r.platform))].sort((a, b) => (NAMES[a] || a).localeCompare(NAMES[b] || b));
  const sum = (list, k) => { const v = list.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const compare = platforms.map((pl) => {
    const a = week.filter((r) => r.platform === pl);
    const b = last.filter((r) => r.platform === pl);
    return {
      platform: pl, posts: a.length, postsBefore: b.length,
      views: usesViews(pl) ? sum(a, 'views') : null, viewsBefore: usesViews(pl) ? sum(b, 'views') : null,
      eng: sum(a, 'eng'), engBefore: sum(b, 'eng'),
    };
  });

  return { rows, week, worked, missed, strongest, compare };
}

export function pct(now, before) {
  if (now == null || before == null || before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

// accounts: social_accounts rows; snaps: follower_snapshots rows. Newest count, the one before it, and up to 8 points.
export function audience(accounts, snaps) {
  const cards = accounts.map((a) => {
    const mine = snaps.filter((s) => s.account_id === a.id && s.followers != null).sort((x, y) => (x.taken_on < y.taken_on ? -1 : 1));
    const now = mine[mine.length - 1] || null;
    const prev = mine.length > 1 ? mine[mine.length - 2] : null;
    const delta = now && prev ? now.followers - prev.followers : null;
    return {
      ...a, followers: now?.followers ?? null, since: prev?.taken_on || null, delta,
      deltaPct: delta != null && prev.followers ? Math.round((delta / prev.followers) * 1000) / 10 : null,
      series: mine.slice(-8).map((s) => s.followers),
    };
  });
  const counted = cards.filter((c) => c.followers != null);
  const withDelta = counted.filter((c) => c.delta != null);
  return {
    cards,
    total: counted.length ? counted.reduce((s, c) => s + c.followers, 0) : null,
    totalDelta: withDelta.length ? withDelta.reduce((s, c) => s + c.delta, 0) : null,
  };
}

export function strongestLine(s) {
  if (!s) return null;
  const name = `${NAMES[s.platform] || s.platform} ${formatWord(s.platform, s.format)}`;
  const what = `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
  if (s.ratio >= WORKED) return `Your strongest post this week was ${what} at ${times(s.ratio)} your usual. Make another one like it.`;
  if (s.ratio >= 1) return `Your strongest post this week was ${what} at ${times(s.ratio)} your usual. Nothing broke out yet, so keep posting.`;
  return 'Every post this week came in under your usual. Look at what worked last month and do that again.';
}

export function nextWeekTip(card) {
  if (card.worked.length) return { title: 'Do more of what worked.', body: 'Take your best post, keep its format, change the topic, and post it again. Repeat what works before you try something new.' };
  if (card.week.length === 0) return { title: 'Post something this week.', body: 'There is nothing to compare yet. Two posts this week gives next week\'s scorecard something to grade.' };
  return { title: 'Try one new opening.', body: 'Keep your usual format and change only the first line or the first 3 seconds. One change at a time shows what moves the numbers.' };
}
