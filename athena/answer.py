#!/usr/bin/env python3
"""Answer queued messages and run queued jobs for Athena with Claude Code.

Run by .github/workflows/athena.yml. For each queued row in athena_requests:
mark it running, build the prompt, run `claude -p`, and save the result (or the error).

Three kinds of row:
  - chat: a message from the Athena tab. Guide is PROMPT.md, the reply shows in the chat.
  - report job (daily brief, Monday plan, Friday wrap): queued by the database clock or a
    Run now button. Guide is the job's prompt in athena_jobs. The reply is the document,
    and this script saves it where the Today page reads it.
  - meeting job (Level 10 with Metis): a chat thread whose first row names the job. Guide is
    the job's prompt, and Metis may change Rocks, Scorecard, Issues and Level 10.

Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CLAUDE_CODE_OAUTH_TOKEN.
"""
import datetime, json, os, re, subprocess, sys, traceback, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

import calendar_feed

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TZ = ZoneInfo('America/Denver')
HISTORY = 12             # earlier messages in the thread that Athena sees
TIMEOUT = 12 * 60        # seconds per chat message
JOB_TIMEOUT = 25 * 60    # seconds per report job

ALLOWED_TOOLS = ['Read', 'Write', 'Glob', 'Grep', 'Bash(python3 athena/db.py:*)']
BRIEF_TYPES = {'monday_plan': 'Monday plan', 'friday_wrap': 'Friday wrap'}
FIELDS = ['client_hours', 'colibrios_hours', 'decision_needed', 'gone_quiet', 'carry_over']


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
        raise RuntimeError(f'Database said {e.code}: {e.read().decode()[:300]}') from None


def q(value):
    # Timestamps end in +00:00, and a bare + in a URL reads as a space.
    return urllib.parse.quote(str(value), safe='')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def local_now():
    return datetime.datetime.now(TZ)


def mountain_now():
    return local_now().strftime('%A, %B %-d, %Y, %-I:%M %p Mountain')


def read(name):
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()


def week_label(d):
    # Matches the titles already in Briefs: "Monday plan, week of Oct 12, 2026", "Sept" for September.
    month = 'Sept' if d.month == 9 else d.strftime('%b')
    return f'{month} {d.day}, {d.year}'


# ---------- Which job a row belongs to ----------
def job_for(req):
    key = req.get('job')
    if not key:  # a follow-up in a Level 10 thread carries no job, its first message does
        first = api('GET', f'athena_requests?thread_id=eq.{q(req["thread_id"])}&job=not.is.null'
                           f'&order=created_at.asc&limit=1&select=job')
        key = first[0]['job'] if first else None
    if not key:
        return None
    rows = api('GET', f'athena_jobs?key=eq.{q(key)}&select=*')
    return rows[0] if rows else None


def calendar_for(key):
    today = local_now().date()
    if key == 'daily_brief':
        return calendar_feed.block(api, today, 1, 'today')
    if key == 'monday_plan':
        monday = today - datetime.timedelta(days=today.weekday())
        return calendar_feed.block(api, monday, 7, 'this week')
    if key == 'friday_wrap':
        next_sunday = today + datetime.timedelta(days=(6 - today.weekday()) + 7)
        return calendar_feed.block(api, today, (next_sunday - today).days + 1, 'today and next week')
    if key == 'level10':
        return ''
    return calendar_feed.block(api, today, 7, 'the next 7 days')


# ---------- Prompts ----------
def conversation(history, who='Athena'):
    if not history:
        return ''
    lines = []
    for h in history:
        lines.append(f'Stephanie: {h["message"]}')
        if h.get('reply'):
            lines.append(f'{who}: {h["reply"]}')
    return 'Earlier in this conversation:\n\n' + '\n\n'.join(lines) + '\n\n'


def chat_prompt(req, history, job):
    if job:  # a meeting, such as the Level 10 with Metis
        guide = job['prompt'] + '\n\n' + read('JOBS.md')
    else:
        guide = read('PROMPT.md') + '\n\n' + calendar_for(None)
    convo = conversation(history, 'Metis' if job else 'Athena')
    return f'{guide}\n\nRight now it is {mountain_now()}.\n\n{convo}Stephanie\'s new message:\n\n{req["message"]}'


def report_prompt(job):
    title = job['title']
    hand_back = (f'## What to hand back\n\nYour final reply is the {title} itself, in Markdown, ready for her to read on '
                 f'her Today page. The app saves it for you, so do not save it with db.py, and do not add anything '
                 f'before or after it: no "Here is your brief", no notes about what you did. Start with the content.')
    if job['key'] in BRIEF_TYPES:
        hand_back += ('\n\nAfter it, end with one fenced json block, which the app reads and removes:\n\n'
                      '```json\n{"client_hours": number or null, "colibrios_hours": number or null, '
                      '"decision_needed": "one line, or null", "gone_quiet": "one line, or null", "carry_over": "one line, or null"}\n```')
    return (f'{job["prompt"]}\n\n{read("JOBS.md")}\n\n{hand_back}\n\n'
            f'Right now it is {mountain_now()}.\n\n{calendar_for(job["key"])}')


# ---------- Running Claude ----------
def run_claude(prompt, timeout, metis=False):
    env = {k: v for k, v in os.environ.items()}
    if metis:
        env['ATHENA_METIS'] = '1'  # lets db.py change Rocks, Scorecard, Issues and Level 10
    cmd = ['claude', '-p', prompt, '--output-format', 'json', '--max-turns', '60',
           '--allowedTools', *ALLOWED_TOOLS]
    p = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=timeout)
    out = p.stdout.strip()
    try:
        data = json.loads(out.splitlines()[-1]) if out else {}
    except (ValueError, IndexError):
        data = {}
    if data.get('result') and not data.get('is_error'):
        return data['result'].strip(), None
    err = data.get('result') or p.stderr.strip()[-800:] or out[-800:] or f'Claude Code exited with code {p.returncode}'
    return None, err


# ---------- Saving a report ----------
def split_fields(text):
    """Pull the trailing ```json block off a brief. Returns (body, fields)."""
    m = re.search(r'```json\s*(\{.*?\})\s*```\s*$', text, re.S)
    if not m:
        return text.strip(), {}
    try:
        raw = json.loads(m.group(1))
    except ValueError:
        return text[:m.start()].strip(), {}
    fields = {}
    for k in FIELDS:
        v = raw.get(k)
        if v in (None, '', 'null'):
            continue
        if k.endswith('_hours'):
            try:
                v = round(float(v), 2)
            except (TypeError, ValueError):
                continue
        fields[k] = v
    return text[:m.start()].strip(), fields


def save_report(job, text):
    today = local_now().date()
    if job['key'] == 'daily_brief':
        rows = api('GET', 'pages?title=eq.Daily%20brief&folder=eq.Athena&deleted_at=is.null&select=id,extra&limit=1')
        if rows:
            extra = dict(rows[0].get('extra') or {})
            extra['Date'] = today.isoformat()
            api('PATCH', f'pages?id=eq.{q(rows[0]["id"])}', {'body': text, 'extra': extra})
        else:
            api('POST', 'pages', {'title': 'Daily brief', 'folder': 'Athena', 'body': text, 'extra': {'Date': today.isoformat()}})
        return 'Saved to the Daily brief on the Today page.'
    if job['key'] in BRIEF_TYPES:
        kind = BRIEF_TYPES[job['key']]
        monday = today - datetime.timedelta(days=today.weekday())
        title = f'{kind}, week of {week_label(monday)}'
        body, fields = split_fields(text)
        row = {'title': title, 'type': kind, 'week_of': monday.isoformat(), 'body': body, **fields}
        same = api('GET', f'briefs?title=eq.{q(title)}&deleted_at=is.null&select=id&limit=1')
        if same:
            api('PATCH', f'briefs?id=eq.{q(same[0]["id"])}', row)
        else:
            api('POST', 'briefs', row)
        return f'Saved as "{title}" in Briefs.'
    return None


# ---------- One row ----------
def handle(req):
    job = job_for(req)
    if job and job['kind'] == 'report':
        try:
            text, err = run_claude(report_prompt(job), JOB_TIMEOUT)
        except subprocess.TimeoutExpired:
            return None, f'The {job["title"]} ran out of time.'
        if not text:
            return None, err
        note = save_report(job, text)
        return (f'{text}\n\n_{note}_' if note else text), None
    history = api('GET', f'athena_requests?thread_id=eq.{q(req["thread_id"])}&status=eq.done'
                         f'&created_at=lt.{q(req["created_at"])}&order=created_at.desc&limit={HISTORY}&select=message,reply')
    history.reverse()
    try:
        return run_claude(chat_prompt(req, history, job), TIMEOUT, metis=bool(job))
    except subprocess.TimeoutExpired:
        return None, 'Athena ran out of time on this one. Try asking in a smaller piece.'


def main():
    # A run that died mid-answer leaves rows at running. Put them back in line.
    stale = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=35)).isoformat(timespec='seconds')
    api('PATCH', f'athena_requests?status=eq.running&started_at=lt.{q(stale)}', {'status': 'queued'})

    queued = api('GET', 'athena_requests?status=eq.queued&order=created_at.asc&select=*')
    if not queued:
        print('Nothing queued.')
        return
    failures = 0
    for req in queued:
        rid = q(req['id'])
        api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'running', 'started_at': now()})
        print(f'Working on {req["id"]}' + (f' (job {req["job"]})' if req.get('job') else ''))
        try:
            reply, err = handle(req)
        except Exception as e:  # never leave a row stuck at running
            traceback.print_exc()
            reply, err = None, f'Something broke on my side: {e}'
        if reply:
            api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'done', 'reply': reply, 'error': None, 'finished_at': now()})
        else:
            failures += 1
            print(f'  failed: {err}', file=sys.stderr)
            api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'failed', 'error': (err or 'Unknown error')[:2000], 'finished_at': now()})
    if failures:
        sys.exit(f'{failures} request(s) failed. Each one shows its error in the app.')


if __name__ == '__main__':
    main()
