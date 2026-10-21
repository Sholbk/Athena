#!/usr/bin/env python3
"""Athena's hands for the LinkedIn Comment desk (Marketing page).

  python3 athena/linkedin.py people                      the people Stephanie watches (stage not Stop)
  python3 athena/linkedin.py comments                    drafts on the desk, posted ones included
  python3 athena/linkedin.py prune                       retire unposted drafts whose post is older than 14 days
  python3 athena/linkedin.py scan --out FILE [--cap 1.00] [--days 14]
                                                         read their newest public posts through Apify
  python3 athena/linkedin.py add --person ID --link URL --date YYYY-MM-DD --summary TEXT
                                 --comment-file FILE [--tier2]
                                                         put one draft comment on the desk

The scan runs the Apify Actor harvestapi/linkedin-profile-posts (public posts, no LinkedIn login)
and needs her Apify token (Settings > Apify in the app, or the APIFY_TOKEN secret). It never writes to LinkedIn. Each person costs about $0.002 a post found
and $0.001 when nothing is found; the cap is passed to Apify as maxTotalChargeUsd and checked
here first, so a scan never costs more than the cap. Output is JSON. Standard library only.
"""
import argparse, datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Denver')
ACTOR = 'harvestapi~linkedin-profile-posts'
APIFY = 'https://api.apify.com/v2'
POST_PRICE, EMPTY_PRICE, START_PRICE = 0.002, 0.001, 0.00005
MAX_POSTS = 6
PEOPLE_COLS = 'id,name,title,company,url,tier,score,stage,notes,last_scanned_on,last_post_on'
COMMENT_COLS = 'id,person_id,post_url,post_key,post_date,staged_on,kind,summary,comment,posted_at'


def today():
    return datetime.datetime.now(TZ).date()


# ---------- Database ----------
def api(method, path, body=None):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    r = urllib.request.Request(url, data=json.dumps(body, default=str).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f'Database said no: {e.code} {e.read().decode()[:400]}')


def q(v):
    return urllib.parse.quote(str(v), safe='')


def people(active=True):
    where = '&stage=neq.Stop' if active else ''
    return api('GET', f'linkedin_people?deleted_at=is.null{where}&select={PEOPLE_COLS}&order=score.desc,name.asc')


def comments():
    return api('GET', f'linkedin_comments?deleted_at=is.null&select={COMMENT_COLS}&order=post_date.desc')


def slug(url):
    """The profile name in a LinkedIn URL: https://www.linkedin.com/in/jane-doe-123/ -> jane-doe-123."""
    m = re.search(r'linkedin\.com/in/([^/?#]+)', url or '', re.I)
    return urllib.parse.unquote(m.group(1)).lower().strip() if m else ''


def post_key(link):
    m = re.search(r'activity[-:](\d+)', link or '')
    return 'a' + m.group(1) if m else None


def apify_token():
    """Her Apify token: Settings > Apify in the app first (connections key apify), then the
    APIFY_TOKEN secret. Empty when neither is set."""
    rows = api('GET', 'connections?key=eq.apify&select=data')
    saved = ((rows[0].get('data') or {}).get('token') if rows else None) or ''
    return saved.strip() or (os.environ.get('APIFY_TOKEN') or '').strip()


# ---------- Apify ----------
def apify(method, path, body=None, params=None):
    token = apify_token()
    if not token:
        sys.exit('Apify is not connected: paste the token in Settings > Apify in the app. Say so in the brief and stage nothing new.')
    params = dict(params or {}, token=token)
    url = f'{APIFY}/{path}?' + urllib.parse.urlencode(params)
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        sys.exit(f'Apify said {e.code}: {e.read().decode()[:300]}')
    except urllib.error.URLError as e:
        sys.exit(f'Could not reach Apify: {e.reason}')


def estimate(n):
    return round(START_PRICE + n * (MAX_POSTS * POST_PRICE), 3)


def scan(out, cap, days):
    rows = [p for p in people() if slug(p['url'])]
    skipped_urls = [p['name'] for p in people() if not slug(p['url'])]
    if not rows:
        sys.exit('Nobody to scan: add people with a LinkedIn profile link on the Comment desk first.')
    # Highest score first; drop from the bottom until the worst case fits the cap.
    fits = rows[:]
    while fits and estimate(len(fits)) > cap:
        fits.pop()
    left_out = [p['name'] for p in rows[len(fits):]]
    if not fits:
        sys.exit(f'Even one profile would cost more than the cap of ${cap:.2f}.')

    run = apify('POST', f'acts/{ACTOR}/runs',
                body={'targetUrls': [p['url'] for p in fits], 'postedLimit': 'month', 'includeReposts': False,
                      'includeQuotePosts': False, 'maxPosts': MAX_POSTS},
                params={'maxTotalChargeUsd': f'{cap:.2f}', 'waitForFinish': 60})['data']
    deadline = time.time() + 10 * 60
    while run['status'] in ('READY', 'RUNNING') and time.time() < deadline:
        time.sleep(10)
        run = apify('GET', f'actor-runs/{run["id"]}')['data']
    if run['status'] != 'SUCCEEDED':
        sys.exit(f'The Apify run ended as {run["status"]} (run {run["id"]}). Nothing was scanned.')
    items = apify('GET', f'datasets/{run["defaultDatasetId"]}/items', params={'clean': 'true', 'format': 'json'}) or []

    by_slug = {slug(p['url']): p for p in fits}
    by_name = {p['name'].lower().strip(): p for p in fits}
    found = {p['id']: [] for p in fits}
    unmatched = set()
    since = today() - datetime.timedelta(days=days)
    for it in items:
        if it.get('type') not in (None, 'post'):
            continue
        author = it.get('author') or {}
        person = by_slug.get(slug(author.get('linkedinUrl') or '')) or by_slug.get((author.get('publicIdentifier') or '').lower()) \
            or by_name.get((author.get('name') or '').lower().strip())
        if not person:
            unmatched.add(author.get('name') or '?')
            continue
        link = it.get('linkedinUrl') or (it.get('socialContent') or {}).get('shareUrl') or ''
        key = post_key(link)
        date = ((it.get('postedAt') or {}).get('date') or '')[:10]
        text = ' '.join((it.get('content') or '').split())
        if not key or not date or not text:
            continue
        if it.get('repost') or it.get('reposted') or it.get('isRepost'):
            continue
        found[person['id']].append({'key': key, 'link': link.split('?')[0], 'date': date, 'text': text,
                                    'author_title': author.get('info') or '', 'days_old': (today() - datetime.date.fromisoformat(date)).days,
                                    'fresh': datetime.date.fromisoformat(date) >= since})

    result = {'run_id': run['id'], 'scanned': len(fits), 'posts': sum(len(v) for v in found.values()),
              'cost_usd': run.get('usageTotalUsd'), 'cost_estimate_usd': estimate(len(fits)), 'cap_usd': cap,
              'left_out_for_cap': left_out, 'no_profile_link': skipped_urls, 'unmatched_authors': sorted(unmatched),
              'people': [], 'no_posts': []}
    for p in fits:
        posts = sorted(found[p['id']], key=lambda x: x['date'], reverse=True)
        patch = {'last_scanned_on': today().isoformat(), 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if posts:
            patch['last_post_on'] = posts[0]['date']
            result['people'].append({**p, 'posts': posts})
        else:
            result['no_posts'].append({k: p[k] for k in ('id', 'name', 'title', 'company', 'url', 'tier')})
        api('PATCH', f'linkedin_people?id=eq.{q(p["id"])}', patch)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: result[k] for k in ('run_id', 'scanned', 'posts', 'cost_usd', 'cost_estimate_usd', 'left_out_for_cap',
                                             'no_profile_link', 'unmatched_authors')}, ensure_ascii=False))
    print(f'Posts saved to {out}: people with posts {len(result["people"])}, no recent posts {len(result["no_posts"])}.')


# ---------- The desk ----------
BANNED = [
    (r'[–—;]', 'no em dashes, en dashes or semicolons'),
    (r'https?://|www\.|linkedin\.com', 'no links'),
    (r'\bcolibri', 'never name ColibriOS'),
    (r'\bcongrat|\bwell done\b|\bgreat (post|job|work)\b|\bamazing\b|\bimpressive\b|\blove this\b', 'no praise'),
    (r'\bmy take\b|\bi think\b|\bin my opinion\b|\bpersonally\b|\bimho\b', 'no framing phrases: state the view directly'),
    (r"\blet'?s connect\b|\bconnect with\b|\bdm me\b|\bbook a\b|\bfree trial\b|\bsign up\b", 'never pitch or ask to connect'),
    (r'\d+\s?%|\bstud(y|ies)\b|\bresearch shows\b|\bdata shows\b', 'no statistics or studies'),
]


def check_comment(text):
    text = text.strip()
    if len(text) < 150:
        sys.exit(f'The comment is {len(text)} characters. It needs about 250 or more: a point of view, one reason, at most one question.')
    if len(text) > 700:
        sys.exit(f'The comment is {len(text)} characters. Keep it to 2 to 4 sentences.')
    sentences = [s for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    if not 2 <= len(sentences) <= 4:
        sys.exit(f'The comment has {len(sentences)} sentences. It needs 2 to 4.')
    if text.count('?') > 1:
        sys.exit('At most one question in a comment.')
    for pat, why in BANNED:
        m = re.search(pat, text, re.I)
        if m:
            sys.exit(f'The comment says "{m.group(0)}": {why}.')
    return text


def add(person_id, link, date, summary, comment_file, tier2):
    rows = api('GET', f'linkedin_people?id=eq.{q(person_id)}&deleted_at=is.null&select={PEOPLE_COLS}')
    if not rows:
        sys.exit(f'No person has the id {person_id}.')
    person = rows[0]
    if person['stage'] == 'Stop':
        sys.exit(f'{person["name"]} is marked Stop. Nothing gets staged for them.')
    key = post_key(link)
    if not key:
        sys.exit('The link must be the post itself, with "activity-" and the digits in it.')
    try:
        post_date = datetime.date.fromisoformat(date)
    except ValueError:
        sys.exit('The date must be YYYY-MM-DD.')
    if (today() - post_date).days > 14:
        sys.exit('That post is older than 14 days. Only recent posts go on the desk.')
    if api('GET', f'linkedin_comments?post_key=eq.{q(key)}&select=id,deleted_at'):
        sys.exit('That post already has a comment on the desk, or had one. Skip it.')
    summary = ' '.join(summary.split())
    if len(summary) < 30 or re.search(r'[–—;]', summary):
        sys.exit('The summary needs a sentence or two in plain words, no dashes or semicolons.')
    with open(comment_file, encoding='utf-8') as f:
        comment = check_comment(f.read())
    row = api('POST', 'linkedin_comments', {
        'person_id': person['id'], 'post_url': link.split('?')[0], 'post_key': key, 'post_date': post_date.isoformat(),
        'staged_on': today().isoformat(), 'kind': 'tier2' if tier2 else 'staged', 'summary': summary, 'comment': comment,
    })[0]
    if person['stage'] == 'Watching':
        api('PATCH', f'linkedin_people?id=eq.{q(person["id"])}', {'stage': 'Commented', 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print(json.dumps({'added': row['id'], 'person': person['name'], 'post_key': key, 'kind': row['kind'], 'staged_on': row['staged_on']}, ensure_ascii=False))


def prune():
    cutoff = (today() - datetime.timedelta(days=14)).isoformat()
    gone = api('PATCH', f'linkedin_comments?deleted_at=is.null&posted_at=is.null&post_date=lt.{cutoff}',
               {'deleted_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}) or []
    print(json.dumps({'retired': len(gone), 'older_than': cutoff}))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('people')
    sub.add_parser('comments')
    sub.add_parser('prune')
    s = sub.add_parser('scan'); s.add_argument('--out', required=True); s.add_argument('--cap', type=float, default=1.0)
    s.add_argument('--days', type=int, default=14)
    s = sub.add_parser('add'); s.add_argument('--person', required=True); s.add_argument('--link', required=True)
    s.add_argument('--date', required=True); s.add_argument('--summary', required=True); s.add_argument('--comment-file', required=True)
    s.add_argument('--tier2', action='store_true')
    a = p.parse_args()
    if a.cmd == 'people':
        print(json.dumps(people(), indent=1, ensure_ascii=False))
    elif a.cmd == 'comments':
        print(json.dumps(comments(), indent=1, ensure_ascii=False))
    elif a.cmd == 'prune':
        prune()
    elif a.cmd == 'scan':
        scan(a.out, a.cap, a.days)
    elif a.cmd == 'add':
        add(a.person, a.link, a.date, a.summary, a.comment_file, a.tier2)


if __name__ == '__main__':
    main()
