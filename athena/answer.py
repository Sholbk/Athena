#!/usr/bin/env python3
"""Answer queued messages to Athena with Claude Code.

Run by .github/workflows/athena.yml. For each queued row in athena_requests:
mark it running, build the prompt from the thread so far, run `claude -p`,
and save the reply (or the error). Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
and CLAUDE_CODE_OAUTH_TOKEN. Standard library only.
"""
import datetime, json, os, subprocess, sys, traceback, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HISTORY = 12          # earlier messages in the thread that Athena sees
TIMEOUT = 12 * 60     # seconds per message

ALLOWED_TOOLS = ['Read', 'Write', 'Glob', 'Grep', 'Bash(python3 athena/db.py:*)']


def api(method, path, body=None):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
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


def mountain_now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo('America/Denver')).strftime('%A, %B %-d, %Y, %-I:%M %p Mountain')
    except Exception:
        return now()


def build_prompt(req, history):
    with open(os.path.join(HERE, 'PROMPT.md'), encoding='utf-8') as f:
        guide = f.read()
    convo = ''
    if history:
        lines = []
        for h in history:
            lines.append(f'Stephanie: {h["message"]}')
            if h.get('reply'):
                lines.append(f'Athena: {h["reply"]}')
        convo = 'Earlier in this conversation:\n\n' + '\n\n'.join(lines) + '\n\n'
    return f'{guide}\n\nRight now it is {mountain_now()}.\n\n{convo}Stephanie\'s new message:\n\n{req["message"]}'


def run_claude(prompt):
    env = {k: v for k, v in os.environ.items()}
    cmd = ['claude', '-p', prompt, '--output-format', 'json', '--max-turns', '40',
           '--allowedTools', *ALLOWED_TOOLS]
    p = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=TIMEOUT)
    out = p.stdout.strip()
    try:
        data = json.loads(out.splitlines()[-1]) if out else {}
    except (ValueError, IndexError):
        data = {}
    if data.get('result') and not data.get('is_error'):
        return data['result'].strip(), None
    err = data.get('result') or p.stderr.strip()[-800:] or out[-800:] or f'Claude Code exited with code {p.returncode}'
    return None, err


def answer(req):
    history = api('GET', f'athena_requests?thread_id=eq.{q(req["thread_id"])}&status=eq.done'
                         f'&created_at=lt.{q(req["created_at"])}&order=created_at.desc&limit={HISTORY}&select=message,reply')
    history.reverse()
    try:
        return run_claude(build_prompt(req, history))
    except subprocess.TimeoutExpired:
        return None, 'Athena ran out of time on this one. Try asking in a smaller piece.'


def main():
    # A run that died mid-answer leaves rows at running. Put them back in line.
    stale = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=25)).isoformat(timespec='seconds')
    api('PATCH', f'athena_requests?status=eq.running&started_at=lt.{q(stale)}', {'status': 'queued'})

    queued = api('GET', 'athena_requests?status=eq.queued&order=created_at.asc&select=*')
    if not queued:
        print('Nothing queued.')
        return
    failures = 0
    for req in queued:
        rid = q(req['id'])
        api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'running', 'started_at': now()})
        print(f'Answering {req["id"]}')
        try:
            reply, err = answer(req)
        except Exception as e:  # never leave a message stuck at running
            traceback.print_exc()
            reply, err = None, f'Something broke on my side: {e}'
        if reply:
            api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'done', 'reply': reply, 'error': None, 'finished_at': now()})
        else:
            failures += 1
            print(f'  failed: {err}', file=sys.stderr)
            api('PATCH', f'athena_requests?id=eq.{rid}', {'status': 'failed', 'error': (err or 'Unknown error')[:2000], 'finished_at': now()})
    if failures:
        sys.exit(f'{failures} message(s) failed. Each one shows its error in the Athena tab.')


if __name__ == '__main__':
    main()
