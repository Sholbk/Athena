#!/usr/bin/env python3
"""The Viral Outlier Review page (/outliers): which recent Instagram reels did far better than usual.

  python3 athena/outliers.py refresh      pull the last 14 days, mark outliers, transcribe outliers

Run by answer.py for the job "Viral Outlier Review" (Mondays 6:30 AM, or Refresh now on the page).
No Claude is involved. It reads the watched accounts from outlier_accounts, pulls their reels from
the last 14 days through the Apify Actor apify/instagram-reel-scraper with her token from
Settings > Apify (connections key apify), and saves them to outlier_reels.

A reel is an outlier when it has at least 3 times its creator's median likes, or at least 3 times
their median views, over the same 14 days. Both tests are relative to the creator, so an account with
500,000 followers is only flagged when a reel beats its own usual, not on every reel. Only outliers get a spoken transcript (an Apify add-on charged per
minute of audio), and a reel that already has one is never transcribed again. Every run stays under
COST_CAP dollars: the pull is capped by maxTotalChargeUsd, and transcripts go to the biggest
outliers first until the estimate reaches what is left.

It reads only. It never posts, likes, comments or follows anywhere. It prints a short Markdown
note (answer.py saves it as the page "Viral Outlier Review"), and exits non-zero when the pull
itself fails. Standard library only, Python 3.9 or newer.
"""
import argparse, datetime, json, math, os, re, sys, time, urllib.error, urllib.parse, urllib.request

APIFY = 'https://api.apify.com/v2'
ACTOR = 'apify~instagram-reel-scraper'
DAYS = 14
TIMES_BAR = 3            # an outlier beats its creator's median likes or median views by this much
COST_CAP = 3.00          # dollars per run, pull and transcripts together (her cap, Oct 22)
PULL_CAP = 1.00          # 19 accounts read about 150 to 400 reels in 14 days at $0.0023 each; the rest goes to transcripts
MAX_REELS = 30           # per account; the busiest post about 2 a day
REEL_PRICE, START_PRICE, TRANSCRIPT_MINUTE = 0.0023, 0.001, 0.041   # Apify BRONZE prices, Oct 2026


# ---------- Database ----------
def api(method, path, body=None, prefer='return=representation'):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': prefer}
    r = urllib.request.Request(url, data=json.dumps(body, default=str).encode() if body is not None else None,
                               method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f'Database said no: {e.code} {e.read().decode()[:400]}')


def q(v):
    return urllib.parse.quote(str(v), safe='')


def in_list(values):
    """A PostgREST in.() list with every value quoted, so short codes with - or _ are safe."""
    return 'in.(' + ','.join('"' + str(v).replace('"', '') + '"' for v in values) + ')'


def apify_token():
    """Her Apify token: Settings > Apify in the app first, then the APIFY_TOKEN secret."""
    rows = api('GET', 'connections?key=eq.apify&select=data')
    saved = ((rows[0].get('data') or {}).get('token') if rows else None) or ''
    return saved.strip() or (os.environ.get('APIFY_TOKEN') or '').strip()


# ---------- Pure helpers (tested in test_outliers.py) ----------
def to_int(v):
    if v in (None, ''):
        return None
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None   # Instagram reports hidden likes as -1


def median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2


def handle_of(url_or_name):
    """'https://www.instagram.com/ivorey.io/' -> 'ivorey.io'. A bare name comes back lowercased."""
    s = (url_or_name or '').strip()
    m = re.search(r'instagram\.com/([^/?#]+)', s, re.I)
    return (m.group(1) if m else s.strip('@/')).lower()


def reel_link(short_code):
    """The reel scraper only reads a single reel from a /reel/ link (a /p/ link returns nothing)."""
    return f'https://www.instagram.com/reel/{short_code}/'


def first_sentence(text, limit=220):
    """The opening sentence, on one line. Long run-ons are cut at a word near the limit."""
    s = ' '.join((text or '').split())
    if not s:
        return ''
    m = re.search(r'^(.+?[.!?])(\s|$)', s)
    out = m.group(1) if m else s
    if len(out) > limit:
        out = out[:limit].rsplit(' ', 1)[0] + '…'
    return out


def hook_for(transcript, caption):
    if (transcript or '').strip():
        return first_sentence(transcript), 'transcript'
    first_line = next((ln for ln in (caption or '').splitlines() if ln.strip()), '')
    return (first_sentence(first_line), 'caption') if first_line else ('', None)


def mark(reels):
    """Adds creator_median, times_usual, is_outlier and outlier_reason to each reel (in place).
    Median views and median likes are per creator over the reels given. creator_median and times_usual
    stay about views (they are what the page shows); the likes test only feeds is_outlier and the reason.
    Returns the reels."""
    by_creator = {}
    for r in reels:
        by_creator.setdefault(r['creator'], []).append(r)
    for group in by_creator.values():
        med = median([r.get('views') for r in group])
        med_likes = median([r.get('likes') for r in group])
        for r in group:
            v, likes = r.get('views'), r.get('likes')
            r['creator_median'] = int(round(med)) if med is not None else None
            r['times_usual'] = round(v / med, 2) if (v is not None and med) else None
            by_likes = likes is not None and bool(med_likes) and likes / med_likes >= TIMES_BAR
            by_views = r['times_usual'] is not None and r['times_usual'] >= TIMES_BAR
            r['is_outlier'] = by_likes or by_views
            r['outlier_reason'] = 'both' if (by_likes and by_views) else 'likes' if by_likes else 'views' if by_views else None
    return reels


def rank_key(r):
    """Biggest outliers first: times usual, then likes."""
    return (-(r.get('times_usual') or 0), -(r.get('likes') or 0))


def transcript_cost(duration_s):
    minutes = max(1, math.ceil((duration_s or 60) / 60))
    return REEL_PRICE + minutes * TRANSCRIPT_MINUTE


def pick_for_transcripts(outliers, budget):
    """Biggest outliers first, as many as fit the budget. Returns (picked, left_out)."""
    picked, left, spent = [], [], START_PRICE
    for r in sorted(outliers, key=rank_key):
        c = transcript_cost(r.get('duration_s'))
        if spent + c <= budget:
            picked.append(r)
            spent += c
        else:
            left.append(r)
    return picked, left


def reel_row(item, since_iso):
    """One Apify item -> our row, or None for error items, non-reels and anything too old."""
    if item.get('error') or not item.get('shortCode') or not item.get('timestamp'):
        return None
    posted = item['timestamp']
    if posted < since_iso:
        return None
    return {
        'short_code': item['shortCode'],
        'creator': (item.get('ownerUsername') or '').lower() or handle_of(item.get('inputUrl')),
        'url': reel_link(item['shortCode']),
        'posted_at': posted,
        'views': to_int(item.get('videoPlayCount')) if item.get('videoPlayCount') is not None else to_int(item.get('videoViewCount')),
        'likes': to_int(item.get('likesCount')),
        'comments': to_int(item.get('commentsCount')),
        'duration_s': round(float(item['videoDuration']), 1) if item.get('videoDuration') else None,
        'caption': item.get('caption') or '',
        '_input': handle_of(item.get('inputUrl')),
        'raw': {k: item.get(k) for k in ('shortCode', 'ownerUsername', 'ownerFullName', 'inputUrl', 'timestamp', 'videoPlayCount',
                                         'videoViewCount', 'likesCount', 'commentsCount', 'videoDuration', 'productType', 'type')},
    }


# ---------- Apify ----------
def apify(method, path, body=None, params=None, token=''):
    params = dict(params or {}, token=token)
    url = f'{APIFY}/{path}?' + urllib.parse.urlencode(params)
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read().decode() or 'null')


def run_actor(run_input, cap, token):
    """Runs the reel scraper and returns (items, cost, error)."""
    try:
        run = apify('POST', f'acts/{ACTOR}/runs', body=run_input,
                    params={'maxTotalChargeUsd': f'{cap:.2f}', 'waitForFinish': 60}, token=token)['data']
        deadline = time.time() + 12 * 60
        while run['status'] in ('READY', 'RUNNING') and time.time() < deadline:
            time.sleep(10)
            run = apify('GET', f'actor-runs/{run["id"]}', token=token)['data']
        if run['status'] != 'SUCCEEDED':
            return [], run.get('usageTotalUsd'), f'the Apify run ended as {run["status"]} (run {run["id"]})'
        items = apify('GET', f'datasets/{run["defaultDatasetId"]}/items', params={'clean': 'true', 'format': 'json'}, token=token) or []
        return items, run.get('usageTotalUsd'), None
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return [], None, 'the Apify token is not valid: paste a new one in Settings > Apify'
        return [], None, f'Apify said {e.code}: {e.read().decode()[:200]}'
    except (urllib.error.URLError, KeyError, ValueError) as e:
        return [], None, f'could not reach Apify: {e}'


# ---------- The run ----------
def money(v):
    return f'${v:.2f}' if v is not None else 'unknown'


def md_day(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return f'{d.strftime("%b")} {d.day}'


def refresh():
    token = apify_token()
    if not token:
        sys.exit('Apify is not connected: paste your token in Settings > Apify in the app.')
    accounts = api('GET', 'outlier_accounts?deleted_at=is.null&select=url,label&order=created_at.asc') or []
    if not accounts:
        sys.exit('No accounts to watch yet: add rows to outlier_accounts.')

    now = datetime.datetime.now(datetime.timezone.utc)
    since = (now - datetime.timedelta(days=DAYS)).isoformat(timespec='seconds').replace('+00:00', 'Z')
    items, pull_cost, err = run_actor({'username': [a['url'] for a in accounts], 'resultsLimit': MAX_REELS,
                                       'onlyPostsNewerThan': f'{DAYS} days', 'skipPinnedPosts': True}, PULL_CAP, token)
    if err:
        sys.exit(f'The reel pull did not work: {err}.')

    seen, reels = set(), []
    for it in items:
        row = reel_row(it, since)
        if row and row['short_code'] not in seen:
            seen.add(row['short_code'])
            reels.append(row)
    mark(reels)

    known = {}
    if reels:
        for r in api('GET', f'outlier_reels?short_code={q(in_list([x["short_code"] for x in reels]))}&select=short_code,transcript') or []:
            if r.get('transcript'):
                known[r['short_code']] = r['transcript']
    for r in reels:
        r['transcript'] = known.get(r['short_code'])

    need = [r for r in reels if r['is_outlier'] and not r['transcript']]
    budget = max(0.0, COST_CAP - (pull_cost or PULL_CAP))
    picked, left_out = pick_for_transcripts(need, budget)
    t_cost, t_err = None, None
    if picked:
        t_items, t_cost, t_err = run_actor({'username': [r['url'] for r in picked], 'includeTranscript': True},
                                           round(budget, 2), token)
        got = {i.get('shortCode'): (i.get('transcript') or '').strip() for i in t_items if i.get('shortCode')}
        for r in picked:
            r['transcript'] = got.get(r['short_code']) or None

    stamp = now.isoformat(timespec='seconds')
    by_handle = {handle_of(a['url']): a['url'] for a in accounts}
    rows = []
    for r in reels:
        hook, src = hook_for(r['transcript'], r['caption'])
        rows.append({
            'short_code': r['short_code'], 'account_url': by_handle.get(r['_input']) or by_handle.get(r['creator']),
            'creator': r['creator'], 'url': r['url'], 'posted_at': r['posted_at'], 'views': r['views'], 'likes': r['likes'],
            'comments': r['comments'], 'duration_s': r['duration_s'], 'caption': r['caption'], 'transcript': r['transcript'],
            'hook': hook or None, 'hook_from': src, 'creator_median': r['creator_median'], 'times_usual': r['times_usual'],
            'is_outlier': r['is_outlier'], 'outlier_reason': r['outlier_reason'], 'raw': r['raw'],
            'fetched_at': stamp, 'updated_at': stamp, 'deleted_at': None,
        })
    if rows:
        api('POST', 'outlier_reels?on_conflict=short_code', rows, prefer='resolution=merge-duplicates,return=minimal')
        api('PATCH', f'outlier_reels?deleted_at=is.null&short_code=not.{q(in_list([r["short_code"] for r in rows]))}',
            {'deleted_at': stamp}, prefer='return=minimal')
    else:
        api('PATCH', 'outlier_reels?deleted_at=is.null', {'deleted_at': stamp}, prefer='return=minimal')

    # The note on the page.
    outliers = sorted([r for r in reels if r['is_outlier']], key=rank_key)
    new_t = sum(1 for r in picked if r.get('transcript'))
    start = (now - datetime.timedelta(days=DAYS)).date().isoformat()
    lines = [f'{len(reels)} reels from {len(accounts)} accounts, {md_day(start)} to {md_day(now.date().isoformat())}. '
             f'{len(outliers)} outlier{"" if len(outliers) == 1 else "s"}.', '']
    for a in accounts:
        h = handle_of(a['url'])
        mine = [r for r in reels if r['_input'] == h or r['creator'] == h]
        if not mine:
            lines.append(f'- {a.get("label") or h}: no reels in the last {DAYS} days.')
            continue
        names = sorted({r['creator'] for r in mine})
        posts_as = f' (posts as {", ".join(names)})' if names != [h] else ''
        n_out = sum(1 for r in mine if r['is_outlier'])
        med = mine[0]['creator_median']
        lines.append(f'- {a.get("label") or h}{posts_as}: {len(mine)} reels, usual views {med:,}' if med is not None
                     else f'- {a.get("label") or h}{posts_as}: {len(mine)} reels')
        if n_out:
            lines[-1] += f', {n_out} outlier{"" if n_out == 1 else "s"}'
        lines[-1] += '.'
    lines.append('')
    if outliers:
        top = outliers[0]
        lines.append(f'Biggest outlier: {top["creator"]} on {md_day(top["posted_at"])}, '
                     + (f'{top["times_usual"]} times usual views.' if top['times_usual'] else f'{top["likes"]:,} likes.'))
    lines.append(f'Transcripts: {new_t} new, {sum(1 for r in outliers if r["short_code"] in known)} reused from earlier runs.')
    if t_err:
        lines.append(f'Transcripts did not finish: {t_err}.')
    if left_out:
        lines.append(f'{len(left_out)} outlier{"" if len(left_out) == 1 else "s"} left without a transcript to stay under {money(COST_CAP)} this run.')
    total = (pull_cost or 0) + (t_cost or 0)
    lines.append(f'Apify cost: {money(total)} (cap {money(COST_CAP)} a run).')
    print('\n'.join(lines))
    print(json.dumps({'reels': len(reels), 'outliers': len(outliers), 'new_transcripts': new_t, 'cost': round(total, 4)}),
          file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('command', choices=['refresh'])
    p.parse_args()
    refresh()


if __name__ == '__main__':
    main()
