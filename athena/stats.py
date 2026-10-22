#!/usr/bin/env python3
"""Athena's hands for the Results tab (Marketing page): how Stephanie's social posts did.

  python3 athena/stats.py pull [--cap 0.20]      copy the numbers in from Blotato and LinkedIn
  python3 athena/stats.py summary [--weeks 4]    posts, reach, views and engagement per week and platform
  python3 athena/stats.py scorecard              the Friday social scorecard: Apify only, last 30 days, no Blotato

pull reads her published Instagram and Facebook posts from Blotato (GET /published-posts and
/posts/{id}/analytics, BLOTATO_API_KEY) with the numbers Blotato collected, and her own public
LinkedIn posts through the Apify Actor harvestapi/linkedin-profile-posts (token from Settings > Apify,
profile link from the connections row linkedin_profile): reactions, comments and shares, since LinkedIn
shows impressions only to her. Everything lands in the tables posts and post_metrics, and each
post is tied to the content piece it came from when the post link or the caption matches.

For the Social Media page it also reads her own Instagram posts through Apify on every run (likes,
comments, reel views; Blotato's weekly snapshots still add photo views and reach), her YouTube videos
from YouTube's free channel feed (views
and likes, no Apify), marks each post's format (video, image, carousel or text), and saves one
follower count a day for each row in social_accounts (Instagram, YouTube, LinkedIn and Facebook
pages through small Apify runs, together under FOLLOWER_CAP).

It reads only. It never posts, schedules, likes, comments or follows anywhere, and the LinkedIn
scan is capped by maxTotalChargeUsd so it never costs more than --cap. Output is JSON.
Standard library only.
"""
import argparse, datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Denver')
BLOTATO = 'https://backend.blotato.com/v2'
APIFY = 'https://api.apify.com/v2'
ACTOR = 'harvestapi~linkedin-profile-posts'
LOOKBACK_DAYS = 90       # Blotato keeps refreshing old posts for weeks, so every run re-reads this window
PAGE = 50                # published-posts page size (Blotato allows up to 100)
MAX_LINKEDIN_POSTS = 20
POST_PRICE, START_PRICE = 0.002, 0.00005
FOLLOWER_CAP = 0.05       # dollars per run for all follower checks together
INSTAGRAM_CAP = 0.15      # dollars per run for her own Instagram posts (about $0.0023 a post)
FACEBOOK_CAP = 0.15       # dollars per run for her Facebook posts (about $0.005 a post)
SOCIAL_DAYS = 30          # the scorecard's window: every Apify pull reads the last 30 days
MAX_INSTAGRAM_POSTS = 40
YOUTUBE_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id='
BLOTATO_PLATFORMS = {'instagram', 'facebook', 'twitter', 'youtube'}   # what posts.platform allows; the rest become 'other'
POST_COLS = 'id,platform,source,external_id,post_url,posted_at,caption,content_id,format,account_id'
CONTENT_COLS = 'id,title,body,target_date,posted_at,post_url'
# Our column -> Blotato's field names, first one found wins.
METRICS = {
    'views': ('viewsCount', 'impressionsCount'), 'reach': ('reachCount',), 'likes': ('likesCount',),
    'comments': ('commentsCount', 'repliesCount'), 'saves': ('savesCount',), 'shares': ('sharesCount',),
    'follows': ('followsCount',), 'clicks': ('clicksCount',),
}


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def today():
    return datetime.datetime.now(TZ).date()


# ---------- Database ----------
def api(method, path, body=None, prefer='return=representation'):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': prefer}
    r = urllib.request.Request(url, data=json.dumps(body, default=str).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f'Database said no: {e.code} {e.read().decode()[:400]}')


def q(v):
    return urllib.parse.quote(str(v), safe='')


# ---------- Pure helpers (tested in test_stats.py) ----------
def to_int(v):
    if v in (None, ''):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def snapshot(metrics):
    """Blotato's metric names -> our columns. None when the snapshot carries no number at all."""
    out = {}
    for col, names in METRICS.items():
        val = None
        for n in names:
            val = to_int((metrics or {}).get(n))
            if val is not None:
                break
        out[col] = val
    return out if any(v is not None for v in out.values()) else None


def norm_url(u):
    """Same post, same key: no query string, no fragment, no trailing slash, lowercase host."""
    if not u:
        return ''
    p = urllib.parse.urlsplit(u.strip())
    host = (p.netloc or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    return f'{host}{p.path.rstrip("/")}'.lower() if host else u.strip().rstrip('/').lower()


def caption_key(text):
    return ' '.join((text or '').split()).lower()[:80]


def post_key(link):
    m = re.search(r'activity[-:](\d+)', link or '')
    return 'a' + m.group(1) if m else None


def apify_token():
    """Her Apify token: Settings > Apify in the app first (connections key apify), then the
    APIFY_TOKEN secret. Empty when neither is set."""
    rows = api('GET', 'connections?key=eq.apify&select=data')
    saved = ((rows[0].get('data') or {}).get('token') if rows else None) or ''
    return saved.strip() or (os.environ.get('APIFY_TOKEN') or '').strip()


def iso(ts):
    """Blotato timestamps to the second, in UTC, so two spellings of one moment compare equal."""
    if not ts:
        return None
    try:
        d = datetime.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(datetime.timezone.utc).isoformat(timespec='seconds')


def match_content(post, pieces):
    """The content piece a post came from: its pasted link first, then the caption's opening (40 to 80
    characters, same words) on a piece dated within 3 days. Returns the piece id or None."""
    link = norm_url(post.get('post_url'))
    if link:
        for c in pieces:
            if norm_url(c.get('post_url')) == link:
                return c['id']
    key = caption_key(post.get('caption'))
    posted = (iso(post.get('posted_at')) or '')[:10]
    for c in pieces:
        other = caption_key(c.get('body'))
        n = min(len(key), len(other))   # the draft may run a little shorter or longer than what went out
        if n < 40 or key[:n] != other[:n]:
            continue
        anchors = [(iso(c.get('posted_at')) or '')[:10], c.get('target_date') or '']
        if not posted or not any(anchors):
            return c['id']
        for a in anchors:
            if a and abs((datetime.date.fromisoformat(posted) - datetime.date.fromisoformat(a)).days) <= 3:
                return c['id']
    return None


def dedupe_pairs(pairs):
    """One snapshot per moment. Blotato's latestMetrics repeats the last history entry, and a unique
    index on (post_id, fetched_at) would refuse the twin. First one in wins; order is kept."""
    seen, out = set(), []
    for at, s in pairs:
        if at and s and at not in seen:
            seen.add(at)
            out.append((at, s))
    return out


def week_of(ymd):
    d = datetime.date.fromisoformat(ymd[:10])
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def engagement(m):
    return sum(m.get(k) or 0 for k in ('likes', 'comments', 'saves', 'shares'))


def summarize(posts, latest, weeks, today_=None):
    """Per week (Monday start, Mountain) and platform: posts, reach, views, engagement; plus the best post.
    posts: rows with posted_at, platform, caption; latest: post_id -> snapshot dict (or missing)."""
    today_ = today_ or today()
    start = today_ - datetime.timedelta(days=today_.weekday() + 7 * (weeks - 1))
    out = {}
    for p in posts:
        day = datetime.datetime.fromisoformat(p['posted_at'].replace('Z', '+00:00')).astimezone(TZ).date()
        if day < start:
            continue
        wk = out.setdefault(week_of(day.isoformat()), {'platforms': {}, 'best': {}})
        m = latest.get(p['id']) or {}
        pl = wk['platforms'].setdefault(p['platform'], {'posts': 0, 'with_numbers': 0, 'reach': 0, 'views': 0, 'engagement': 0})
        pl['posts'] += 1
        if m:
            pl['with_numbers'] += 1
            pl['reach'] += m.get('reach') or 0
            pl['views'] += m.get('views') or 0
            pl['engagement'] += engagement(m)
            score = (m.get('reach') or 0, m.get('views') or 0, engagement(m)) if p['platform'] != 'linkedin' else (engagement(m), m.get('likes') or 0, 0)
            best = wk['best'].get(p['platform'])
            if not best or score > best['_score']:
                wk['best'][p['platform']] = {'_score': score, 'posted_on': day.isoformat(), 'starts': caption_key(p.get('caption'))[:60],
                                             'post_url': p.get('post_url'), **{k: m.get(k) for k in METRICS}}
    for wk in out.values():
        for b in wk['best'].values():
            b.pop('_score', None)
    return dict(sorted(out.items(), reverse=True))


VIDEO_EXT = ('.mp4', '.mov', '.m4v', '.webm')
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic')


def format_of(media_urls=None, post_url=None):
    """video, image, carousel or text, from the post's media files first, then its link."""
    urls = [u for u in (media_urls or []) if isinstance(u, str)]
    paths = [urllib.parse.urlsplit(u).path.lower() for u in urls]
    if any(x.endswith(VIDEO_EXT) for x in paths):
        return 'video'
    if len(paths) > 1:
        return 'carousel'
    if paths and paths[0].endswith(IMAGE_EXT):
        return 'image'
    link = (post_url or '').lower()
    if '/reel/' in link or '/reels/' in link or '/shorts/' in link or 'youtube.com/watch' in link or '/videos/' in link:
        return 'video'
    return None


def linkedin_format(it):
    if it.get('postVideo') or it.get('video') or (it.get('type') or '') == 'video':
        return 'video'
    imgs = it.get('postImages') or it.get('images') or []
    if isinstance(imgs, list) and len(imgs) > 1:
        return 'carousel'
    if imgs:
        return 'image'
    return 'text'


def youtube_channel_id(url):
    m = re.search(r'youtube\.com/channel/(UC[\w-]+)', url or '')
    return m.group(1) if m else ''


def youtube_entries(xml_text):
    """YouTube's channel feed -> [(post row, snapshot)]. Views and likes come with each entry."""
    out = []
    for e in re.findall(r'<entry>(.*?)</entry>', xml_text or '', re.S):
        vid = re.search(r'<yt:videoId>([^<]+)<', e)
        pub = re.search(r'<published>([^<]+)<', e)
        if not vid or not pub:
            continue
        link = re.search(r'<link rel="alternate" href="([^"]+)"', e)
        title = re.search(r'<title>([^<]*)<', e)
        views = re.search(r'<media:statistics views="(\d+)"', e)
        likes = re.search(r'<media:starRating count="(\d+)"', e)
        url = link.group(1) if link else f'https://www.youtube.com/watch?v={vid.group(1)}'
        row = {'platform': 'youtube', 'source': 'youtube', 'external_id': vid.group(1), 'post_url': url,
               'posted_at': iso(pub.group(1)), 'caption': html_unescape(title.group(1)) if title else None, 'format': 'video'}
        s = snapshot({'viewsCount': views.group(1) if views else None, 'likesCount': likes.group(1) if likes else None})
        out.append((row, s))
    return out


def html_unescape(t):
    return (t or '').replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<').replace('&gt;', '>')


def instagram_rows(items, handle):
    """Apify instagram-post-scraper items -> [(post row, snapshot)] for her own posts.
    Views only exist for videos; Instagram hides photo views from outside readers."""
    out = []
    for it in items:
        code = it.get('shortCode')
        posted = iso(it.get('timestamp'))
        if it.get('error') or not code or not posted:
            continue
        if handle and (it.get('ownerUsername') or handle).lower() != handle.lower():
            continue
        kind = (it.get('type') or '').lower()
        fmt = 'video' if kind == 'video' else 'carousel' if kind == 'sidecar' else 'image' if kind == 'image' else None
        link = it.get('url') or f'https://www.instagram.com/p/{code}/'
        pos = lambda v: v if (to_int(v) or 0) >= 0 else None   # Instagram reports hidden likes as -1
        s = snapshot({'viewsCount': it.get('videoViewCount') or it.get('videoPlayCount'), 'likesCount': pos(it.get('likesCount')),
                      'commentsCount': pos(it.get('commentsCount'))})
        out.append(({'platform': 'instagram', 'source': 'apify', 'external_id': code, 'post_url': link, 'posted_at': posted,
                     'caption': ' '.join((it.get('caption') or '').split()) or None, 'format': fmt}, s))
    return out


def facebook_rows(items):
    """Apify facebook-posts-scraper items -> [(post row, snapshot)]. Facebook leaves out a number when
    it is zero or hidden, so a missing number is not collected, never zero."""
    out = []
    for it in items:
        if it.get('error') or not it.get('postId'):
            continue
        posted = iso(it.get('time'))
        if not posted and it.get('timestamp'):
            posted = iso(datetime.datetime.fromtimestamp(int(it['timestamp']), tz=datetime.timezone.utc).isoformat())
        if not posted:
            continue
        kinds = [(m.get('__typename') or '').lower() for m in (it.get('media') or []) if isinstance(m, dict)]
        fmt = 'video' if 'video' in kinds else 'carousel' if len(kinds) > 1 else 'image' if kinds else 'text'
        likes = it.get('likes') if it.get('likes') is not None else it.get('reactionLikeCount')
        s = snapshot({'viewsCount': it.get('viewsCount') or it.get('videoViewCount'), 'likesCount': likes,
                      'commentsCount': it.get('comments'), 'sharesCount': it.get('shares')})
        out.append(({'platform': 'facebook', 'source': 'apify', 'external_id': str(it['postId']),
                     'post_url': it.get('url') or it.get('topLevelUrl'), 'posted_at': posted,
                     'caption': ' '.join((it.get('text') or '').split()) or None, 'format': fmt}, s))
    return out


def match_by_caption(row, candidates):
    """The same post sent in by another source: same opening words (at least 20 characters) within a day.
    Blotato and Apify spell Facebook links differently, so the words are the only match. Returns a candidate or None."""
    key = caption_key(row.get('caption'))
    if len(key) < 20 or not row.get('posted_at'):
        return None
    day = datetime.date.fromisoformat(row['posted_at'][:10])
    for c in candidates:
        other = caption_key(c.get('caption'))
        n = min(len(key), len(other))
        if n < 20 or key[:n] != other[:n] or not c.get('posted_at'):
            continue
        if abs((datetime.date.fromisoformat(str(c['posted_at'])[:10]) - day).days) <= 1:
            return c
    return None


FOLLOWER_KEYS = ('followersCount', 'followers', 'numberOfSubscribers', 'followerCount', 'numberOfFollowers', 'likes')


def follower_count(item):
    """The follower number from any of the profile scrapers' items, or None."""
    for k in FOLLOWER_KEYS:
        n = to_int((item or {}).get(k))
        if n is not None:
            return n
    return None


# ---------- Blotato ----------
_BLOTATO_KEY = None


def blotato_key():
    """Her Blotato key: Settings > Blotato in the app (connections key blotato) first, then the secret."""
    global _BLOTATO_KEY
    if _BLOTATO_KEY is None:
        rows = api('GET', 'connections?key=eq.blotato&select=data')
        saved = ((rows[0].get('data') or {}).get('token') if rows else None) or ''
        _BLOTATO_KEY = saved.strip() or (os.environ.get('BLOTATO_API_KEY') or '').strip()
    return _BLOTATO_KEY


def blotato(path, params=None):
    """GET from Blotato. Returns (status, body). No key -> (0, None). Errors are answers, not crashes."""
    key = blotato_key()
    if not key:
        return 0, None
    url = BLOTATO + path + ('?' + urllib.parse.urlencode(params) if params else '')
    r = urllib.request.Request(url, headers={'blotato-api-key': key, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, ValueError):
        return -1, None


def published_posts(since):
    """Every published post in the window, newest first. Stops at the first page that is all older."""
    items, offset, limit = [], 0, PAGE
    while True:
        status, data = blotato('/published-posts', {'sortBy': 'newest', 'limit': limit, 'offset': offset})
        if status in (400, 422) and limit != 20:
            limit = 20  # the page size was refused, use Blotato's default
            continue
        if status == 0:
            return None, 'Blotato is not connected: paste the key in Settings > Blotato in the app.'
        if status != 200 or not isinstance(data, dict):
            return None, f'Blotato did not answer (HTTP {status}).'
        page = data.get('items') or []
        fresh = [i for i in page if (iso(i.get('createdAt')) or '') >= since]
        items.extend(fresh)
        if len(fresh) < len(page) or len(page) < limit:
            return items, None
        offset += limit


def post_history(pid):
    status, data = blotato(f'/posts/{q(pid)}/analytics')
    if status != 200 or not isinstance(data, dict):
        return []  # 404 or an empty body: no numbers yet, not an error
    out = []
    for h in data.get('history') or []:
        s = snapshot(h.get('metrics'))
        if s and iso(h.get('fetchedAt')):
            out.append((iso(h['fetchedAt']), s))
    if data.get('metrics') and iso(data.get('lastFetchedAt')):
        s = snapshot(data['metrics'])
        if s:
            out.append((iso(data['lastFetchedAt']), s))
    return out


# ---------- Apify (LinkedIn) ----------
def apify(method, path, body=None, params=None, token=''):
    params = dict(params or {}, token=token)
    url = f'{APIFY}/{path}?' + urllib.parse.urlencode(params)
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read().decode() or 'null')


def profile_slug(url):
    m = re.search(r'linkedin\.com/(?:in|company)/([^/?#]+)', url or '', re.I)
    return urllib.parse.unquote(m.group(1)).lower().strip() if m else ''


def linkedin_items(profile_url, cap):
    """Her newest public posts through Apify, for one profile or page link or a list of them, in one run.
    Returns (items, cost, error)."""
    targets = [profile_url] if isinstance(profile_url, str) else list(profile_url)
    token = apify_token()
    if not token:
        return [], None, 'Apify is not connected: paste the token in Settings > Apify in the app. LinkedIn was skipped.'
    estimate = round(START_PRICE + len(targets) * MAX_LINKEDIN_POSTS * POST_PRICE, 3)
    if estimate > cap:
        return [], None, f'The LinkedIn scan would cost about ${estimate:.2f}, more than the cap of ${cap:.2f}, so it was skipped.'
    try:
        run = apify('POST', f'acts/{ACTOR}/runs',
                    body={'targetUrls': targets, 'postedLimit': 'month', 'includeReposts': False,
                          'includeQuotePosts': False, 'maxPosts': MAX_LINKEDIN_POSTS},
                    params={'maxTotalChargeUsd': f'{cap:.2f}', 'waitForFinish': 60}, token=token)['data']
        deadline = time.time() + 8 * 60
        while run['status'] in ('READY', 'RUNNING') and time.time() < deadline:
            time.sleep(10)
            run = apify('GET', f'actor-runs/{run["id"]}', token=token)['data']
        if run['status'] != 'SUCCEEDED':
            return [], run.get('usageTotalUsd'), f'The Apify run ended as {run["status"]} (run {run["id"]}), so LinkedIn was skipped.'
        items = apify('GET', f'datasets/{run["defaultDatasetId"]}/items', params={'clean': 'true', 'format': 'json'}, token=token) or []
        return items, run.get('usageTotalUsd'), None
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return [], None, 'The Apify token is not valid. Paste a new one in Settings > Apify in the app.'
        return [], None, f'Apify said {e.code}: {e.read().decode()[:200]}'
    except (urllib.error.URLError, KeyError, ValueError) as e:
        return [], None, f'Could not reach Apify: {e}'


def linkedin_posts(items, profile_url):
    """Apify items -> (post row, snapshot) pairs for her own posts (her profile and her company page),
    reposts left out. Each row carries _who, the profile or page slug it came from."""
    mine = {profile_slug(u) for u in ([profile_url] if isinstance(profile_url, str) else profile_url)} - {''}
    out = []
    for it in items:
        if it.get('type') not in (None, 'post'):
            continue
        if it.get('repost') or it.get('reposted') or it.get('isRepost'):
            continue
        author = it.get('author') or {}
        who = (profile_slug(author.get('linkedinUrl') or '') or (author.get('universalName') or '').lower()
               or (author.get('publicIdentifier') or '').lower())
        if who and mine and who not in mine:
            continue
        link = (it.get('linkedinUrl') or (it.get('socialContent') or {}).get('shareUrl') or '').split('?')[0]
        key = post_key(link)
        posted = iso((it.get('postedAt') or {}).get('date'))
        if not key or not posted:
            continue
        eng = it.get('engagement') or {}
        s = snapshot({'likesCount': eng.get('likes'), 'commentsCount': eng.get('comments'), 'sharesCount': eng.get('shares')})
        out.append(({'platform': 'linkedin', 'source': 'linkedin', 'external_id': key, 'post_url': link, 'posted_at': posted,
                     'caption': ' '.join((it.get('content') or '').split()), 'format': linkedin_format(it), '_who': who}, s))
    return out


def small_run(actor, run_input, cap, token):
    """One short Apify run. Returns (items, cost, error)."""
    try:
        run = apify('POST', f'acts/{actor}/runs', body=run_input,
                    params={'maxTotalChargeUsd': f'{cap:.2f}', 'waitForFinish': 60}, token=token)['data']
        deadline = time.time() + 4 * 60
        while run['status'] in ('READY', 'RUNNING') and time.time() < deadline:
            time.sleep(5)
            run = apify('GET', f'actor-runs/{run["id"]}', token=token)['data']
        if run['status'] != 'SUCCEEDED':
            return [], run.get('usageTotalUsd'), f'ended as {run["status"]}'
        items = apify('GET', f'datasets/{run["defaultDatasetId"]}/items', params={'clean': 'true', 'format': 'json'}, token=token) or []
        return items, run.get('usageTotalUsd'), None
    except urllib.error.HTTPError as e:
        return [], None, 'the Apify token is not valid' if e.code == 401 else f'Apify said {e.code}'
    except (urllib.error.URLError, KeyError, ValueError) as e:
        return [], None, f'could not reach Apify: {e}'


def follower_input(platform, url):
    """(actor, input) for one account's follower count, or None when there is no reader for it."""
    if platform == 'instagram':
        m = re.search(r'instagram\.com/([^/?#]+)', url)
        return 'apify~instagram-profile-scraper', {'usernames': [m.group(1) if m else url]}
    if platform == 'youtube':
        return 'streamers~youtube-channel-scraper', {'startUrls': [{'url': url}], 'maxResults': 1, 'maxResultsShorts': 0, 'maxResultStreams': 0}
    if platform == 'linkedin' and '/company/' in url:
        return 'apt_marble~linkedin-company-details', {'companyUrls': [url]}
    if platform == 'linkedin':
        return 'apt_marble~linkedIn-profile-scraper', {'profileUrls': [url]}
    if platform == 'facebook':
        return 'apify~facebook-pages-scraper', {'startUrls': [{'url': url}]}
    return None


def followers(accounts):
    """One follower count per account for today (Mountain). Returns (saved, cost, skipped)."""
    token = apify_token()
    saved, cost, skipped = 0, 0.0, []
    if not token:
        return 0, None, ['Follower counts were skipped: Apify is not connected (Settings > Apify).']
    left = FOLLOWER_CAP
    for a in accounts:
        spec = follower_input(a['platform'], a['url'])
        if not spec:
            skipped.append(f'{a["label"]}: no follower reader for {a["platform"]}.')
            continue
        if left < 0.01:
            skipped.append(f'{a["label"]}: skipped to stay under ${FOLLOWER_CAP:.2f} for follower counts.')
            continue
        items, c, err = small_run(spec[0], spec[1], max(0.01, round(left, 2)), token)
        cost += c or 0
        left -= c or 0.01
        n = next((follower_count(i) for i in items if follower_count(i) is not None), None)
        if err or n is None:
            why = err or ((items[0].get('errorDescription') or items[0].get('status') or 'no number came back') if items else 'no number came back')
            skipped.append(f'{a["label"]}: follower count not read ({str(why)[:120]}).')
            continue
        api('POST', 'follower_snapshots?on_conflict=account_id,taken_on',
            {'account_id': a['id'], 'taken_on': today().isoformat(), 'followers': n, 'taken_at': utcnow().isoformat(timespec='seconds')},
            prefer='resolution=merge-duplicates,return=minimal')
        saved += 1
    return saved, round(cost, 4), skipped


def instagram_pull(store, accounts, since, cap):  # since: ISO time, the start of the window
    """Her own Instagram posts through Apify, every run. A post Blotato already sent in gets the
    new numbers on its existing row (matched by the post's short code in its link). Returns (seen, cost, error)."""
    token = apify_token()
    if not token:
        return 0, None, 'Instagram through Apify was skipped: Apify is not connected (Settings > Apify).'
    seen, cost = 0, 0.0
    now_ = utcnow().isoformat(timespec='seconds')
    for a in [x for x in accounts if x['platform'] == 'instagram']:
        m = re.search(r'instagram\.com/([^/?#]+)', a['url'])
        handle = m.group(1) if m else a['url']
        days = max(1, (utcnow() - datetime.datetime.fromisoformat(since.replace('Z', '+00:00'))).days)
        items, c, err = small_run('apify~instagram-post-scraper', {'username': [handle], 'resultsLimit': MAX_INSTAGRAM_POSTS,
                                  'onlyPostsNewerThan': f'{days} days', 'dataDetailLevel': 'detailedData'}, cap, token)
        cost += c or 0
        if err:
            return seen, round(cost, 4), f'Instagram through Apify did not finish: {err}.'
        for row, s in instagram_rows(items, handle):
            row['account_id'] = a['id']
            same = api('GET', f'posts?platform=eq.instagram&source=neq.apify&post_url=like.*{q(row["external_id"])}*&select=id,format,account_id,deleted_at&limit=1')
            if same:
                pid = None if same[0].get('deleted_at') else same[0]['id']
                patch = {k: row[k] for k in ('format', 'account_id') if row.get(k) and not same[0].get(k)}
                if pid and patch:
                    api('PATCH', f'posts?id=eq.{q(pid)}', patch)
            else:
                pid, _ = store.upsert(row)
            seen += 1
            if pid and s:
                store.add_snapshots(pid, [(now_, s)])
    return seen, round(cost, 4), None


def facebook_pull(store, accounts, since, cap):
    """Her Facebook posts through Apify. A post Blotato already sent in (same words, same day) keeps its
    row and gets the new numbers. Returns (seen, cost, error)."""
    token = apify_token()
    fb = [x for x in accounts if x['platform'] == 'facebook']
    if not fb or not token:
        return 0, None, None if not fb else 'Facebook was skipped: Apify is not connected (Settings > Apify).'
    seen, cost = 0, 0.0
    now_ = utcnow().isoformat(timespec='seconds')
    days = max(1, (utcnow() - datetime.datetime.fromisoformat(since.replace('Z', '+00:00'))).days)
    others = api('GET', f'posts?platform=eq.facebook&source=neq.apify&posted_at=gte.{q(since)}&select=id,caption,posted_at,format,account_id,deleted_at') or []
    for a in fb:
        items, c, err = small_run('apify~facebook-posts-scraper', {'startUrls': [{'url': a['url']}], 'resultsLimit': 40,
                                  'onlyPostsNewerThan': f'{days} days'}, cap, token)
        cost += c or 0
        if err:
            return seen, round(cost, 4), f'{a["label"]} posts did not finish: {err}.'
        for row, s in facebook_rows(items):
            row['account_id'] = a['id']
            twin = match_by_caption(row, others)
            if twin:
                pid = None if twin.get('deleted_at') else twin['id']
                patch = {k: row[k] for k in ('format', 'account_id') if row.get(k) and not twin.get(k)}
                if pid and patch:
                    api('PATCH', f'posts?id=eq.{q(pid)}', patch)
            else:
                pid, _ = store.upsert(row)
            seen += 1
            if pid and s:
                store.add_snapshots(pid, [(now_, s)])
    return seen, round(cost, 4), None


def linkedin_pull(store, accounts, cap):
    """Her LinkedIn profile and company page through Apify in one run. Falls back to the profile link in
    Settings when social_accounts has no LinkedIn row. Returns (seen, cost, error)."""
    li = [x for x in accounts if x['platform'] == 'linkedin']
    if not li:
        link = api('GET', 'connections?key=eq.linkedin_profile&select=url')
        url = (link[0].get('url') if link else None) or ''
        if not profile_slug(url):
            return 0, None, 'LinkedIn was skipped: no LinkedIn link in Settings or in social_accounts.'
        li = [{'id': None, 'url': url, 'label': 'LinkedIn'}]
    items, cost, err = linkedin_items([a['url'] for a in li], cap)
    by_slug = {profile_slug(a['url']): a['id'] for a in li}
    now_ = utcnow().isoformat(timespec='seconds')
    rows = linkedin_posts(items, [a['url'] for a in li])
    for row, s in rows:
        aid = by_slug.get(row.pop('_who', ''))
        if aid:
            row['account_id'] = aid
        pid, _ = store.upsert(row)
        if pid and s:
            store.add_snapshots(pid, [(now_, s)])
    return len(rows), cost, err


def social_pull(store, result, days=SOCIAL_DAYS, linkedin_cap=0.20):
    """Everything the Social Media page needs from outside Blotato, for the last `days` days:
    Instagram, Facebook and LinkedIn through Apify, YouTube from its free feed, and follower counts."""
    accounts = api('GET', 'social_accounts?deleted_at=is.null&select=id,platform,url,label&order=created_at.asc') or []
    since = iso((utcnow() - datetime.timedelta(days=days)).isoformat())
    for name, fn in (('instagram', lambda: instagram_pull(store, accounts, since, INSTAGRAM_CAP)),
                     ('facebook', lambda: facebook_pull(store, accounts, since, FACEBOOK_CAP)),
                     ('linkedin', lambda: linkedin_pull(store, accounts, linkedin_cap))):
        seen, cost, err = fn()
        result[name] = {'posts_seen': seen, 'cost_usd': cost}
        if err:
            result['skipped'].append(err)
    yt_seen = 0
    now_ = utcnow().isoformat(timespec='seconds')
    for a in [x for x in accounts if x['platform'] == 'youtube']:
        cid = youtube_channel_id(a['url'])
        if not cid:
            result['skipped'].append(f'{a["label"]}: use the channel link that has /channel/UC in it.')
            continue
        xml, err = youtube_feed(cid)
        if err:
            result['skipped'].append(err)
            continue
        for row, s in youtube_entries(xml):
            if not row['posted_at'] or row['posted_at'] < since:
                continue
            row['account_id'] = a['id']
            pid, _ = store.upsert(row)
            yt_seen += 1
            if pid and s:
                store.add_snapshots(pid, [(now_, s)])
    result['youtube'] = {'posts_seen': yt_seen}
    saved, f_cost, f_skipped = followers(accounts)
    result['followers'] = {'accounts': len(accounts), 'saved': saved, 'cost_usd': f_cost}
    result['skipped'].extend(f_skipped)
    return accounts


def youtube_feed(channel_id):
    """Fetch YouTube's free channel feed. Returns (xml text, error)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(YOUTUBE_FEED + channel_id, headers={'User-Agent': 'Athena'}), timeout=60) as r:
            return r.read().decode('utf-8', 'replace'), None
    except (urllib.error.URLError, ValueError) as e:
        return '', f'YouTube feed did not answer: {e}'


# ---------- Saving ----------
class Store:
    def __init__(self):
        self.pieces = api('GET', f'content?deleted_at=is.null&select={CONTENT_COLS}&order=updated_at.desc&limit=500') or []
        self.new_posts = 0
        self.snapshots = 0
        self.matched = 0

    def upsert(self, row):
        """Returns (post id, is_new)."""
        rows = api('GET', f'posts?source=eq.{q(row["source"])}&external_id=eq.{q(row["external_id"])}&select={POST_COLS}')
        if rows:
            cur = rows[0]
            patch = {k: row[k] for k in ('post_url', 'caption', 'posted_at', 'format', 'account_id') if row.get(k) and row[k] != cur.get(k)}
            if not cur.get('content_id'):
                cid = match_content(row, self.pieces)
                if cid:
                    patch['content_id'] = cid
                    self.matched += 1
            if patch:
                patch['updated_at'] = utcnow().isoformat(timespec='seconds')
                api('PATCH', f'posts?id=eq.{q(cur["id"])}', patch)
            if cur.get('deleted_at'):
                return None, False
            return cur['id'], False
        cid = match_content(row, self.pieces)
        if cid:
            self.matched += 1
        made = api('POST', 'posts', {**row, 'content_id': cid})[0]
        self.new_posts += 1
        return made['id'], True

    def add_snapshots(self, post_id, pairs):
        """pairs: [(fetched_at iso, snapshot)]. Skips moments already saved."""
        if not pairs:
            return 0
        have = {iso(r['fetched_at']) for r in api('GET', f'post_metrics?post_id=eq.{q(post_id)}&select=fetched_at') or []}
        rows = [{'post_id': post_id, 'fetched_at': at, **s} for at, s in dedupe_pairs(pairs) if at not in have]
        if rows:
            api('POST', 'post_metrics', rows, prefer='return=minimal')
            self.snapshots += len(rows)
        return len(rows)

    def latest(self, post_id):
        rows = api('GET', f'post_metrics?post_id=eq.{q(post_id)}&select=fetched_at&order=fetched_at.desc&limit=1')
        return iso(rows[0]['fetched_at']) if rows else None


def pull(cap):
    store = Store()
    result = {'blotato': {}, 'linkedin': {}, 'skipped': []}
    since = iso((utcnow() - datetime.timedelta(days=LOOKBACK_DAYS)).isoformat())

    # Blotato: Instagram, Facebook and the rest. LinkedIn is read below, so it is left out here.
    items, err = published_posts(since)
    if err:
        result['skipped'].append(err)
    else:
        seen = 0
        for it in items:
            platform = (it.get('platform') or 'other').lower()
            if platform == 'linkedin':
                continue
            if platform not in BLOTATO_PLATFORMS:
                platform = 'other'
            posted = iso(it.get('createdAt'))
            if not it.get('id') or not posted:
                continue
            seen += 1
            media = it.get('mediaUrls') or it.get('media') or ([it['mediaUrl']] if it.get('mediaUrl') else [])
            row = {'platform': platform, 'source': 'blotato', 'external_id': str(it['id']), 'post_url': it.get('postUrl') or None,
                   'posted_at': posted, 'caption': ' '.join((it.get('content') or '').split()) or None,
                   'format': format_of(media if isinstance(media, list) else [media], it.get('postUrl'))}
            pid, new = store.upsert(row)
            if not pid:
                continue
            pairs = post_history(it['id']) if new else []
            lm = it.get('latestMetrics') or {}
            s = snapshot(lm.get('metrics'))
            at = iso(lm.get('fetchedAt'))
            if s and at and all(at != a for a, _ in pairs):
                last = store.latest(pid)
                if not last or at > last:
                    pairs.append((at, s))
            store.add_snapshots(pid, pairs)
        result['blotato'] = {'posts_seen': seen, 'since': since[:10]}

    # Instagram, Facebook and LinkedIn through Apify, YouTube and follower counts (also run alone on Fridays).
    social_pull(store, result, linkedin_cap=cap)

    result.update({'posts_new': store.new_posts, 'snapshots_added': store.snapshots, 'tied_to_content': store.matched})
    print(json.dumps(result, ensure_ascii=False))


def scorecard():
    """The Friday social scorecard: no Blotato, no Claude. Prints a short Markdown note (the app saves it
    as the page "Social scorecard") and the details as JSON on stderr. Exits non-zero when Apify is missing."""
    if not apify_token():
        sys.exit('Apify is not connected: paste your token in Settings > Apify in the app.')
    store = Store()
    result = {'skipped': []}
    accounts = social_pull(store, result)
    cost = sum((result.get(k) or {}).get('cost_usd') or 0 for k in ('instagram', 'facebook', 'linkedin', 'followers'))
    snaps = {r['account_id']: r['followers'] for r in api('GET', f'follower_snapshots?taken_on=eq.{today().isoformat()}&select=account_id,followers') or []}
    lines = [f'Pulled the last {SOCIAL_DAYS} days of posts.', '']
    for k, name in (('instagram', 'Instagram'), ('facebook', 'Facebook'), ('linkedin', 'LinkedIn'), ('youtube', 'YouTube')):
        n = (result.get(k) or {}).get('posts_seen')
        if n is not None:
            lines.append(f'- {name}: {n} post{"" if n == 1 else "s"}')
    counted = [f'{a["label"]} {snaps[a["id"]]:,}' for a in accounts if snaps.get(a['id']) is not None]
    if counted:
        lines.append('- Followers: ' + ', '.join(counted))
    lines.append('')
    for s_ in result['skipped']:
        lines.append(f'Did not work: {s_}')
    lines.append(f'Apify cost: ${cost:.2f}.')
    print('\n'.join(lines))
    print(json.dumps(result, ensure_ascii=False), file=sys.stderr)


def summary(weeks):
    start = (utcnow() - datetime.timedelta(days=7 * weeks + 7)).isoformat(timespec='seconds')
    posts = api('GET', f'posts?deleted_at=is.null&posted_at=gte.{q(start)}&select={POST_COLS}&order=posted_at.desc') or []
    latest = {}
    if posts:
        ids = ','.join(p['id'] for p in posts)
        for m in api('GET', f'post_metrics?post_id=in.({ids})&select=post_id,fetched_at,views,reach,likes,comments,saves,shares,follows,clicks&order=fetched_at.desc') or []:
            latest.setdefault(m['post_id'], {k: m.get(k) for k in METRICS})
    out = summarize(posts, latest, weeks)
    first = today() - datetime.timedelta(days=today().weekday() + 7 * (weeks - 1))
    older = sum(1 for p in posts if datetime.datetime.fromisoformat(p['posted_at'].replace('Z', '+00:00')).astimezone(TZ).date() < first)
    print(json.dumps({'window': {'from': first.isoformat(), 'to': today().isoformat(), 'weeks': weeks},
                      'posts_in_window': sum(v['posts'] for wk in out.values() for v in wk['platforms'].values()),
                      'older_posts_left_out': older,
                      'weeks': out, 'note': f'Only posts from {first.isoformat()} on are counted; older posts on record are left out on purpose. '
                      'Each week starts on its Monday. Blank means not collected, never zero. LinkedIn has reactions, comments and shares only.'},
                     ensure_ascii=False, indent=1))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('pull'); s.add_argument('--cap', type=float, default=0.20)
    s = sub.add_parser('summary'); s.add_argument('--weeks', type=int, default=4)
    sub.add_parser('scorecard')
    a = p.parse_args()
    if a.cmd == 'pull':
        pull(max(0.01, a.cap))
    elif a.cmd == 'scorecard':
        scorecard()
    else:
        summary(max(1, min(a.weeks, 26)))


if __name__ == '__main__':
    main()
