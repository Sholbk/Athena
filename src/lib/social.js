// The Social Media page's scoring, kept apart from the page so it can be tested (tests/social.test.mjs).
// Her rules (Oct 22): every post from the last 30 days is compared with HER median for that platform,
// using views, or likes + comments + shares when a post has no views. "Worked" at 1.5x or more,
// "Didn't land" at half or less, "Too new" under 48 hours.

export const NAMES = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube', twitter: 'X', other: 'Other' };
export const WORKED = 1.5;
export const MISSED = 0.5;
export const TOO_NEW_HOURS = 48;
export const WINDOW_DAYS = 30;
const DAY = 86400000;
const FIELDS = ['views', 'reach', 'likes', 'comments', 'saves', 'shares'];

export function median(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Likes + comments + shares. Null when none of the three was collected.
export function engagement(m) {
  if (!m) return null;
  const vals = ['likes', 'comments', 'shares'].map((k) => m[k]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

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

// posts: rows of posts; metrics: rows of post_metrics, any order. Returns everything the page shows.
export function scorecard(posts, metrics, now = new Date()) {
  const t = now.getTime();
  const latest = mergeLatest(metrics);
  const rows = posts
    .filter((p) => t - new Date(p.posted_at).getTime() < WINDOW_DAYS * DAY)
    .map((p) => {
      const m = latest[p.id] || null;
      return { ...p, m, ageHours: (t - new Date(p.posted_at).getTime()) / 3600000, views: m?.views ?? null, eng: engagement(m) };
    });

  // Her medians, per platform, from posts old enough to judge. Two of them, so views are only ever
  // compared with views and likes + comments + shares only with likes + comments + shares.
  const old = rows.filter((r) => r.ageHours >= TOO_NEW_HOURS);
  const medians = {};
  for (const pl of new Set(rows.map((r) => r.platform))) {
    const mine = old.filter((r) => r.platform === pl);
    const noViews = mine.filter((r) => r.views == null);
    medians[pl] = {
      views: median(mine.map((r) => r.views)),
      eng: median((noViews.some((r) => r.eng != null) ? noViews : mine).map((r) => r.eng)),
    };
  }
  for (const r of rows) {
    const md = medians[r.platform];
    if (r.views != null && md.views) { r.metric = 'views'; r.score = r.views; r.usual = md.views; }
    else if (r.eng != null && md.eng) { r.metric = 'engagement'; r.score = r.eng; r.usual = md.eng; }
    else { r.metric = r.views != null ? 'views' : 'engagement'; r.score = r.views ?? r.eng; r.usual = null; }
    r.ratio = r.score != null && r.usual ? r.score / r.usual : null;
    r.verdict = r.ageHours < TOO_NEW_HOURS ? 'new' : r.ratio == null ? 'unknown' : r.ratio >= WORKED ? 'worked' : r.ratio <= MISSED ? 'missed' : 'normal';
  }

  const byNewest = (a, b) => (a.posted_at < b.posted_at ? 1 : -1);
  const ageDays = (r) => (t - new Date(r.posted_at).getTime()) / DAY;
  const week = rows.filter((r) => ageDays(r) < 7).sort(byNewest);
  const lastWeek = rows.filter((r) => ageDays(r) >= 7 && ageDays(r) < 14);
  const earlier = rows.filter((r) => ageDays(r) >= 7).sort(byNewest);

  // Best 3, then worst 3 from what is left, so a post is never in both.
  const graded = week.filter((r) => r.ratio != null && r.verdict !== 'new');
  const best = graded.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  const worst = graded.filter((r) => !best.includes(r)).sort((a, b) => a.ratio - b.ratio).slice(0, 3);
  const restOfWeek = week.filter((r) => !best.includes(r) && !worst.includes(r));

  const platforms = [...new Set([...week, ...lastWeek].map((r) => r.platform))].sort((a, b) => (NAMES[a] || a).localeCompare(NAMES[b] || b));
  const sum = (list, k) => { const v = list.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const compare = platforms.map((pl) => {
    const a = week.filter((r) => r.platform === pl);
    const b = lastWeek.filter((r) => r.platform === pl);
    return { platform: pl, posts: a.length, postsBefore: b.length, views: sum(a, 'views'), viewsBefore: sum(b, 'views'), eng: sum(a, 'eng'), engBefore: sum(b, 'eng') };
  });

  return { rows, medians, week, best, worst, restOfWeek, earlier, compare };
}

export function pct(now, before) {
  if (now == null || before == null || before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

// Monday of the week a YYYY-MM-DD falls in.
export function weekOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// accounts: social_accounts rows; snaps: follower_snapshots rows. One count per week (the newest that
// week), the change since the week before, and the last 6 weeks for the trend.
export function audience(accounts, snaps) {
  const cards = accounts.map((a) => {
    const byWeek = new Map();
    for (const s of snaps.filter((x) => x.account_id === a.id && x.followers != null).sort((x, y) => (x.taken_on < y.taken_on ? -1 : 1))) {
      byWeek.set(weekOf(s.taken_on), s);
    }
    const weeks = [...byWeek.entries()].map(([wk, s]) => ({ week: wk, followers: s.followers, taken_on: s.taken_on }));
    const now = weeks[weeks.length - 1] || null;
    const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
    const delta = now && prev ? now.followers - prev.followers : null;
    return {
      ...a, followers: now?.followers ?? null, since: prev?.taken_on || null, delta,
      deltaPct: delta != null && prev.followers ? Math.round((delta / prev.followers) * 1000) / 10 : null,
      weeks: weeks.slice(-6), series: weeks.slice(-6).map((w) => w.followers),
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
  if (s.ratio >= WORKED) return `Your strongest post this week was ${what} at ${times(s.ratio)} your median. Make another one like it.`;
  if (s.ratio >= 1) return `Your strongest post this week was ${what} at ${times(s.ratio)} your median. Nothing broke out yet, so keep posting.`;
  return 'Every post this week came in under your median. Look at what worked last month and do that again.';
}

export function nextWeekTip(card) {
  if (card.best.some((r) => r.verdict === 'worked')) return { title: 'Do more of what worked.', body: 'Take your best post, keep its format, change the topic, and post it again. Repeat what works before you try something new.' };
  if (card.week.length === 0) return { title: 'Post something this week.', body: 'There is nothing to grade yet. Two posts this week gives next Friday\'s scorecard something to compare.' };
  return { title: 'Try one new opening.', body: 'Keep your usual format and change only the first line or the first 3 seconds. One change at a time shows what moves the numbers.' };
}
