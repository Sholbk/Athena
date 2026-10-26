#!/usr/bin/env python3
"""Brings Stephanie's Granola calls into the app, with no need for Obsidian to be open.

  python3 athena/granola.py            pull new calls (the Vault sync run does this every 15 minutes)
  python3 athena/granola.py --status   one line: connected, needs reconnecting, or not connected

She connects Granola once in Settings > Granola, which saves a Granola sign-in in the
connections table (key granola). Each pull:
  1. swaps the saved refresh token for an access token, and saves the new tokens at once,
  2. lists her calls from the last 30 days through Granola's official MCP connection,
  3. saves each call the app does not have yet as a page in the folder Meetings, titled
     "{date} {title}", with the front matter the Obsidian Granola add-on used (granola_id, ...),
  4. records what it did in the same connections row (status, last_run_at, seen).
The Vault sync step that runs next copies the new pages into Obsidian too.

A call waits until Granola has written its summary. If a day passes with no summary, it comes in
with whatever notes or transcript it has. A call with nothing at all is skipped.
Read only: it never changes anything in Granola. The Athena repo and its Actions logs are public,
so this prints counts only, never call titles.
Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Standard library only.
"""
import argparse, datetime, html, json, os, re, sys, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, '..', 'sync'))
from db import api  # noqa: E402
from sync import safe_name  # noqa: E402

MCP = 'https://mcp.granola.ai/mcp'
TOKEN = 'https://mcp-auth.granola.ai/oauth2/token'
MOUNTAIN = ZoneInfo('America/Denver')
FOLDER = 'Meetings'
MAX_SAVE = 10                               # calls saved per run; the rest come in on the next run
WAIT_FOR_NOTES = datetime.timedelta(hours=24)
KEEP_SEEN = datetime.timedelta(days=45)     # longer than the 30 days the list looks back


class Reconnect(Exception):
    """Granola no longer accepts the saved sign-in. She reconnects in Settings."""


class GranolaDown(Exception):
    """Granola did not answer properly this time. The next run tries again."""


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def when(text):
    try:
        d = datetime.datetime.fromisoformat((text or '').replace('Z', '+00:00'))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


# ---------- Granola's replies (pure, tested in test_granola.py) ----------
def attr(attrs, name):
    m = re.search(r'(?:^|\s)' + name + r'="([^"]*)"', attrs)
    return html.unescape(m.group(1)) if m else ''


def checkboxes(text):
    """Granola writes to-dos as "[ ] thing". Make them Markdown list items, as the add-on did."""
    return re.sub(r'^([ \t]*)(\[[ xX]\]\s)', r'\1- \2', text, flags=re.M)


def parse_people(text):
    """Names of everyone on the call except Stephanie (the note creator). Never emails."""
    names = []
    for part in re.split(r',\s*(?=[A-Z])', text.strip()):
        if not part.strip() or '(note creator)' in part:
            continue
        name = re.sub(r'\s*\([^()]*@[^()]*\)\s*$', '', part).strip()   # drop "(email)"
        name = re.sub(r'\s+from\s+.+$', '', name).strip()                # drop "from Company"
        if name:
            names.append(name)
    return names


def parse_meetings(text):
    """list_meetings and get_meetings answer with <meeting ...> blocks."""
    out = []
    for m in re.finditer(r'<meeting\s+((?:"[^"]*"|[^>"])*?)>([\s\S]*?)</meeting>', text):
        attrs, inner = m.group(1), m.group(2)
        mid = attr(attrs, 'id')
        if not mid:
            continue
        people = re.search(r'<known_participants[^>]*>([\s\S]*?)</known_participants>', inner)
        notes = re.search(r'<private_notes>([\s\S]*?)</private_notes>', inner)
        summary = re.search(r'<summary>([\s\S]*?)</summary>', inner)
        summary = html.unescape(summary.group(1)).strip() if summary else ''
        if summary.startswith('No summary.'):
            summary = ''
        out.append({
            'id': mid,
            'title': re.sub(r'\s+', ' ', attr(attrs, 'title')).strip() or 'Untitled call',
            'meeting_at': attr(attrs, 'meeting_at'),
            'updated_at': attr(attrs, 'updated_at'),
            'url': attr(attrs, 'url') or f'https://notes.granola.ai/d/{mid}',
            'people': parse_people(html.unescape(people.group(1))) if people else [],
            'notes': checkboxes(html.unescape(notes.group(1)).strip()) if notes else '',
            'summary': checkboxes(summary),
        })
    return out


def next_cursor(text):
    """The cursor for the next page of list_meetings, or '' on the last page."""
    m = re.search(r'<pagination\s+([^>]*?)/?>', text)
    if not m or attr(m.group(1), 'has_more') != 'true':
        return ''
    return attr(m.group(1), 'next_cursor')


def tidy_transcript(text):
    """Speaker labels as the Obsidian add-on wrote them: Microphone is Me, System audio is Them
    or the person's name when Granola knows it."""
    text = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), text or '')

    def label(m):
        source, who = m.group(1), m.group(2)
        name = who or ('Me' if source == 'Microphone' else 'Them')
        return f'**{name}:** '
    text = re.sub(r'^(Microphone|System audio)(?: \(([^:\n]{1,80})\))?: ', label, text, flags=re.M)
    return text.strip()


def call_date(meet):
    d = when(meet['meeting_at'])
    return d.astimezone(MOUNTAIN).date().isoformat() if d else now().astimezone(MOUNTAIN).date().isoformat()


def page_for(meet, transcript, taken):
    """The pages row for one call, the same shape the vault sync makes from an add-on note."""
    date = call_date(meet)
    base = safe_name(f'{date} {meet["title"]}')
    title, n = base, 2
    while title in taken:
        title, n = f'{base} ({n})', n + 1
    parts = []
    if meet['notes']:
        parts.append('## Notes\n\n' + meet['notes'])
    if meet['summary']:
        parts.append('## Summary\n\n' + meet['summary'])
    if transcript:
        parts.append('## Transcript\n\n' + transcript)
    return {
        'title': title,
        'folder': FOLDER,
        'body': '\n\n'.join(parts) + '\n',
        'extra': {
            'granola_id': meet['id'],
            'granola_url': meet['url'],
            'title': meet['title'],
            'date': date,
            'attendees': meet['people'],
            'tags': ['meeting', 'granola'],
        },
    }


def ready(meet, at):
    """save: the summary is written. wait: give Granola time. late: a day with no summary."""
    if meet['summary']:
        return 'save'
    last = when(meet['updated_at']) or when(meet['meeting_at'])
    if last and at - last < WAIT_FOR_NOTES:
        return 'wait'
    return 'late'


def prune_seen(seen, at):
    keep = {}
    for mid, day in (seen or {}).items():
        try:
            d = datetime.date.fromisoformat(day)
        except (TypeError, ValueError):
            continue
        if at.date() - d <= KEEP_SEEN:
            keep[mid] = day
    return keep


# ---------- Talking to Granola ----------
def form_post(url, body):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='ignore')[:300]
        if e.code in (400, 401) and re.search(r'invalid_grant|invalid_client|unauthorized_client', detail):
            raise Reconnect()
        raise GranolaDown(f'sign-in HTTP {e.code}')
    except (urllib.error.URLError, TimeoutError) as e:
        raise GranolaDown(f'sign-in {type(e).__name__}')


def sse_message(text, want_id):
    """Pick the JSON-RPC reply with our id out of a text/event-stream answer."""
    for event in re.split(r'\r?\n\r?\n', text):
        data = '\n'.join(ln[5:].lstrip() for ln in event.splitlines() if ln.startswith('data:'))
        if not data:
            continue
        try:
            msg = json.loads(data)
        except ValueError:
            continue
        if isinstance(msg, dict) and msg.get('id') == want_id:
            return msg
    return None


class Mcp:
    def __init__(self, token):
        self.token, self.session, self.n = token, None, 0

    def rpc(self, method, params=None, notify=False):
        body = {'jsonrpc': '2.0', 'method': method}
        if params is not None:
            body['params'] = params
        if not notify:
            self.n += 1
            body['id'] = self.n
        h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
             'Authorization': f'Bearer {self.token}'}
        if self.session:
            h['Mcp-Session-Id'] = self.session
        req = urllib.request.Request(MCP, data=json.dumps(body).encode(), method='POST', headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                self.session = r.headers.get('mcp-session-id') or self.session
                ctype, text = r.headers.get('content-type') or '', r.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise Reconnect()
            raise GranolaDown(f'{method} HTTP {e.code}')
        except (urllib.error.URLError, TimeoutError) as e:
            raise GranolaDown(f'{method} {type(e).__name__}')
        if notify:
            return None
        if 'text/event-stream' in ctype:
            msg = sse_message(text, body['id'])
        else:
            try:
                msg = json.loads(text) if text.strip() else None
            except ValueError:
                msg = None
        if not msg or 'error' in msg:
            code = (msg or {}).get('error', {}).get('code', 'no answer')
            raise GranolaDown(f'{method} {code}')
        return msg.get('result') or {}

    def start(self):
        self.rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                'clientInfo': {'name': 'athena', 'version': '1'}})
        self.rpc('notifications/initialized', notify=True)

    def tool(self, name, args):
        result = self.rpc('tools/call', {'name': name, 'arguments': args})
        text = ''.join(c.get('text', '') for c in result.get('content') or [] if c.get('type') == 'text')
        if result.get('isError'):
            raise GranolaDown(f'{name} said no')
        return text


def list_calls(m):
    calls, cursor = [], ''
    for _ in range(10):
        args = {'time_range': 'last_30_days', 'max_participants': 0}
        if cursor:
            args['cursor'] = cursor
        text = m.tool('list_meetings', args)
        calls += parse_meetings(text)
        cursor = next_cursor(text)
        if not cursor:
            break
    return list({c['id']: c for c in calls}.values())  # a call on two pages counts once


def details(m, ids):
    found = {}
    for i in range(0, len(ids), 10):
        for meet in parse_meetings(m.tool('get_meetings', {'meeting_ids': ids[i:i + 10], 'max_participants': 30})):
            found[meet['id']] = meet
    return found


def transcript(m, mid):
    """The whole transcript, page by page, or '' when Granola has none."""
    parts, offset = [], 0
    for _ in range(20):
        args = {'meeting_id': mid, 'max_chars': 80000}
        if offset:
            args['offset'] = offset
        try:
            d = json.loads(m.tool('get_meeting_transcript', args))
        except (ValueError, GranolaDown):
            return ''
        if not isinstance(d, dict) or not d.get('transcript'):
            return ''
        parts.append(d['transcript'])
        if not d.get('truncated') or d.get('next_offset') is None:
            break
        offset = d['next_offset']
    return tidy_transcript(''.join(parts))


# ---------- The saved sign-in ----------
def load():
    rows = api('GET', 'connections?key=eq.granola&select=data')
    return (rows or [{}])[0].get('data') or None


def save(data, connected_at):
    """Write back, unless she reconnected or disconnected while this run was going."""
    q = urllib.parse.quote(connected_at or '', safe='')
    api('PATCH', f'connections?key=eq.granola&data->>connected_at=eq.{q}', {'data': data})


def access_token(data, fresh=False):
    exp = when(data.get('expires_at'))
    if not fresh and data.get('access_token') and exp and exp - now() > datetime.timedelta(minutes=5):
        return data['access_token']
    t = form_post(TOKEN, {'grant_type': 'refresh_token', 'refresh_token': data['refresh_token'],
                          'client_id': data['client_id'], 'resource': MCP})
    if not t.get('access_token'):
        raise GranolaDown('sign-in gave no token')
    data['access_token'] = t['access_token']
    data['refresh_token'] = t.get('refresh_token') or data['refresh_token']
    data['expires_at'] = (now() + datetime.timedelta(seconds=int(t.get('expires_in') or 3600))).isoformat()
    save(data, data.get('connected_at'))  # at once: Granola may have retired the old refresh token
    return data['access_token']


# ---------- One run ----------
def pull(data):
    at = now()
    m = Mcp(access_token(data))
    try:
        m.start()
    except Reconnect:  # the saved access token may have been retired early: get a new one once
        m = Mcp(access_token(data, fresh=True))
        m.start()
    have = api('GET', 'pages?select=title,folder,gid:extra->>granola_id') or []
    known = {r['gid'] for r in have if r.get('gid')}
    taken = {r['title'] for r in have if r.get('folder') == FOLDER}
    seen = prune_seen(data.get('seen'), at)
    fresh = [c for c in list_calls(m) if c['id'] not in known and c['id'] not in seen]
    fresh.sort(key=lambda c: when(c['meeting_at']) or at)

    counts = {'saved': 0, 'waiting': 0, 'empty': 0, 'later': 0}
    full = details(m, [c['id'] for c in fresh[:MAX_SAVE * 2]])
    for c in fresh:
        meet = full.get(c['id'])
        if meet is None or counts['saved'] >= MAX_SAVE:
            counts['later'] += 1
            continue
        state = ready(meet, at)
        if state == 'wait':
            counts['waiting'] += 1
            continue
        text = transcript(m, meet['id'])
        if state == 'late' and not meet['notes'] and not text:
            seen[meet['id']] = call_date(meet)
            counts['empty'] += 1
            continue
        row = page_for(meet, text, taken)
        api('POST', 'pages', row)
        taken.add(row['title'])
        seen[meet['id']] = row['extra']['date']
        counts['saved'] += 1

    data['seen'] = seen
    data['status'] = 'ok'
    data['last_run_at'] = at.isoformat()
    data.pop('last_error', None)
    if counts['saved']:
        data['last_saved_at'] = at.isoformat()
        data['saved_total'] = int(data.get('saved_total') or 0) + counts['saved']
    save(data, data.get('connected_at'))
    return counts


def status_line(data):
    if not data or not data.get('refresh_token'):
        return 'Granola: not connected in the app. Calls only arrive through Obsidian.'
    last = when(data.get('last_run_at'))
    stamp = last.astimezone(MOUNTAIN).strftime('%a %b %-d, %-I:%M %p') if last else 'never'
    if data.get('status') == 'reconnect':
        return ('Granola: disconnected, so no new calls are coming in. Tell Stephanie in one line '
                'to reconnect it in Settings, under Granola.')
    if data.get('status') == 'error':
        return f'Granola: the last check did not work ({stamp}). New calls may be late.'
    if not last:
        return 'Granola: connected, first check coming up.'
    if now() - last > datetime.timedelta(hours=2):
        return f'Granola: not checked since {stamp}. New calls may be late.'
    return f'Granola: connected, last checked {stamp}.'


def main():
    p = argparse.ArgumentParser(description='Bring new Granola calls into the app.')
    p.add_argument('--status', action='store_true', help='print one line about the Granola connection')
    a = p.parse_args()
    data = load()
    if a.status:
        print(status_line(data))
        return
    if not data or not data.get('refresh_token') or not data.get('client_id'):
        print('Granola: not connected, nothing to do.')
        return
    try:
        c = pull(data)
    except Reconnect:
        data.update(status='reconnect', last_run_at=now().isoformat())
        data.pop('access_token', None)
        save(data, data.get('connected_at'))
        sys.exit('Granola: the sign-in no longer works. She reconnects it in Settings, under Granola.')
    except GranolaDown as e:
        data.update(status='error', last_run_at=now().isoformat(), last_error=str(e)[:80])
        save(data, data.get('connected_at'))
        sys.exit(f'Granola: did not answer properly ({e}). The next run tries again.')
    print(f'Granola: {c["saved"]} new calls saved, {c["waiting"]} waiting for notes, '
          f'{c["empty"]} empty skipped, {c["later"]} left for the next run.')


if __name__ == '__main__':
    main()
