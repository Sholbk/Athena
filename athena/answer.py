#!/usr/bin/env python3
"""Answer queued messages to Athena with Claude Code.

Run by .github/workflows/athena.yml. For each queued row in athena_requests:
mark it running, build the prompt from the thread so far, run `claude -p`,
and save the reply (or the error). Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
and CLAUDE_CODE_OAUTH_TOKEN. Standard library only.
"""
import datetime, json, os, subprocess, sys, urllib.request, urllib.error

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
    with urllib.request.urlopen(r, timeout=60) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else None


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


def main():
    queued = api('GET', 'athena_requests?status=eq.queued&order=created_at.asc&select=*')
    if not queued:
        print('Nothing queued.')
        return
    for req in queued:
        api('PATCH', f'athena_requests?id=eq.{req["id"]}', {'status': 'running', 'started_at': now()})
        history = api('GET', f'athena_requests?thread_id=eq.{req["thread_id"]}&status=eq.done'
                             f'&created_at=lt.{req["created_at"]}&order=created_at.desc&limit={HISTORY}&select=message,reply')
        history.reverse()
        print(f'Answering {req["id"]}')
        try:
            reply, err = run_claude(build_prompt(req, history))
        except subprocess.TimeoutExpired:
            reply, err = None, 'Athena ran out of time on this one. Try asking in a smaller piece.'
        if reply:
            api('PATCH', f'athena_requests?id=eq.{req["id"]}', {'status': 'done', 'reply': reply, 'finished_at': now()})
        else:
            print(f'  failed: {err}', file=sys.stderr)
            api('PATCH', f'athena_requests?id=eq.{req["id"]}', {'status': 'failed', 'error': err[:2000], 'finished_at': now()})


if __name__ == '__main__':
    main()
