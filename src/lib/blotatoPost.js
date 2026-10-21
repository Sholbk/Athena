// The pure parts of "Send to Blotato": which accounts the app can post to, the checks before a
// send, the payload for each account, and Mountain time to UTC. No network here, so it is testable.
// The edge function blotato-post does the sending with her key.

export const TZ = 'America/Denver';
export const CAN_POST = ['instagram', 'linkedin', 'twitter'];   // YouTube needs a video, title and privacy; Facebook needs a Page she does not have
export const NAMES = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X', facebook: 'Facebook', youtube: 'YouTube' };
const X_LIMIT = 280;

// Blotato accounts -> the choices she sees: one per account, plus one per LinkedIn page.
export function choices(accounts) {
  const out = [];
  for (const a of accounts || []) {
    if (!CAN_POST.includes(a.platform)) continue;
    const name = a.username ? `@${a.username.replace(/^@/, '')}` : a.fullname || a.platform;
    out.push({ key: `${a.id}`, accountId: `${a.id}`, platform: a.platform, pageId: null, label: `${NAMES[a.platform]} ${name}`.trim(), on: a.platform !== 'twitter' });
    if (a.platform === 'linkedin') {
      for (const p of a.subaccounts || []) {
        out.push({ key: `${a.id}:${p.id}`, accountId: `${a.id}`, platform: 'linkedin', pageId: `${p.id}`, label: `LinkedIn page ${p.name}`, on: false });
      }
    }
  }
  return out;
}

// What stops a send before it starts. Returns a list of plain sentences, empty when all is well.
export function checks({ text, media, picked }) {
  const out = [];
  const body = (text || '').trim();
  if (!body) out.push('The post has no caption yet.');
  if (!picked || picked.length === 0) out.push('Pick at least one account.');
  const files = media || [];
  const videos = files.filter((m) => (m.mime || '').startsWith('video/')).length;
  for (const c of picked || []) {
    if (c.platform === 'instagram' && files.length === 0) out.push('Instagram needs at least one image or video.');
    if (c.platform === 'instagram' && videos > 0 && files.length > 1) out.push('Instagram takes one video on its own, not mixed with images.');
    if (c.platform === 'twitter' && body.length > X_LIMIT) out.push(`X allows ${X_LIMIT} characters and this caption has ${body.length}.`);
  }
  if (/[—–]/.test(body)) out.push('The caption has a dash (— or –). Swap it for a comma, period or parentheses first.');
  return [...new Set(out)];
}

// One Blotato post body per picked account. mediaUrls are Blotato links (the function uploads first).
export function payload(choice, { text, mediaUrls, scheduledTime }) {
  const isVideo = (u) => /\.(mp4|mov|webm)(\?|$)/i.test(u);
  const target = { targetType: choice.platform };
  if (choice.platform === 'linkedin' && choice.pageId) target.pageId = choice.pageId;
  if (choice.platform === 'instagram' && mediaUrls.length === 1 && isVideo(mediaUrls[0])) target.mediaType = 'reel';
  const body = {
    post: { accountId: choice.accountId, content: { text: (text || '').trim(), mediaUrls: mediaUrls || [], platform: choice.platform }, target },
  };
  if (scheduledTime) body.scheduledTime = scheduledTime;
  return body;
}

// "2026-10-28T09:00" typed in Mountain time -> the UTC instant, as ISO. Handles the DST change.
export function mountainToUtc(local) {
  if (!local) return null;
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = (t || '00:00').split(':').map(Number);
  const wanted = Date.UTC(y, mo - 1, da, h, mi);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {   // the offset at the guess tells us how far off we are; converges in two passes
    const p = parts(new Date(guess));
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (seen === wanted) break;
    guess += wanted - seen;
  }
  return new Date(guess).toISOString();
}

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parts(date) {
  const g = Object.fromEntries(fmt.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { y: g.year, mo: g.month, d: g.day, h: g.hour === 24 ? 0 : g.hour, mi: g.minute };
}

// The default schedule: the piece's target date at 9:00 AM, or tomorrow 9:00 AM when that is past.
export function defaultWhen(targetDate, now = new Date()) {
  const today = parts(now);
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayYmd = ymd(today.y, today.mo, today.d);
  if (targetDate && targetDate > todayYmd) return `${targetDate}T09:00`;
  const t = new Date(now.getTime() + 86400000);
  const p = parts(t);
  return `${ymd(p.y, p.mo, p.d)}T09:00`;
}

// Shown in Mountain, 12-hour: "Oct 28, 9:00 AM".
const fShow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const whenText = (iso) => (iso ? fShow.format(new Date(iso)) : '');
