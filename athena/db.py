#!/usr/bin/env python3
"""Athena's hands: read and change the Athena database from inside a chat run.

  python3 athena/db.py ls TABLE [--open] [--where COL=VALUE ...] [--limit N] [--fields a,b,c]
  python3 athena/db.py get TABLE ID_OR_TITLE [--out FILE]
  python3 athena/db.py new TABLE --set COL=VALUE ... [--set-file COL=PATH ...]
  python3 athena/db.py set TABLE ID --set COL=VALUE ... [--set-file COL=PATH ...]
  python3 athena/db.py delete TABLE ID

Tables: tasks, briefs, money, content, pages (read and write);
rocks, scorecard, issues, l10 (Metis owns these: read only, except inside a Level 10,
when answer.py sets ATHENA_METIS=1). scorecard metrics take JSON.
media (her photo and finished post library: titles, tags and notes, read only).
posts and post_metrics (how her social posts did, filled by athena/stats.py, read only).
Output is JSON. Changes reach the app at once and Obsidian on the next sync.
Standard library only.
"""
import argparse, datetime, json, os, sys, urllib.error, urllib.parse, urllib.request

WRITABLE = {
    'tasks': ['title', 'status', 'priority', 'bucket', 'client', 'source', 'eos_flag', 'due', 'est_hours', 'serves_rock', 'notes', 'body'],
    'briefs': ['title', 'type', 'week_of', 'client_hours', 'colibrios_hours', 'decision_needed', 'gone_quiet', 'carry_over', 'body'],
    'money': ['title', 'kind', 'status', 'client', 'amount', 'sent', 'due', 'last_nudge', 'notes', 'body'],
    'content': ['title', 'status', 'channel', 'product', 'target_date', 'cta', 'notes', 'body', 'posted_at', 'post_url'],
    'pages': ['title', 'folder', 'body'],
}
METIS = {
    'rocks': ['title', 'quarter', 'status', 'owner', 'due', 'athena_tasks', 'notes', 'body'],
    'scorecard': ['title', 'week_ending', 'metrics', 'body'],
    'issues': ['title', 'priority', 'status', 'owner', 'raised', 'solved_on', 'solution', 'body'],
    'l10': ['title', 'meeting_date', 'rating', 'issue_solved', 'body'],
}
if os.environ.get('ATHENA_METIS') == '1':
    WRITABLE.update(METIS)
READ_ONLY = (set(METIS) - set(WRITABLE)) | {'media', 'posts', 'post_metrics'}
OPEN = {
    'tasks': 'status=not.in.(Done,Dropped)',
    'money': 'status=not.in.(Paid,Won,Lost)',
    'content': 'status=not.in.(Shipped,Skipped)',
    'issues': 'status=eq.Open',
    'rocks': 'status=neq.Done',
}
# Newest or most urgent first, so --limit keeps the rows that matter.
ORDER = {
    'tasks': 'due.asc.nullslast', 'briefs': 'created_at.desc', 'money': 'due.asc.nullslast',
    'content': 'target_date.asc.nullslast', 'pages': 'title.asc', 'rocks': 'due.asc.nullslast',
    'scorecard': 'week_ending.desc.nullslast', 'issues': 'priority.asc.nullslast', 'l10': 'meeting_date.desc.nullslast',
    'media': 'created_at.desc', 'posts': 'posted_at.desc', 'post_metrics': 'fetched_at.desc',
}
HIDE = {'extra', 'synced_hash', 'synced_at', 'deleted_at', 'vault_path', 'path', 'thumb_path'}
ARRAYS = {'serves_rock', 'athena_tasks'}
JSONS = {'metrics'}


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
        sys.exit(f'Database said no: {e.code} {e.read().decode()[:400]}')


def clean(rows, fields=None):
    out = []
    for r in rows:
        r = {k: v for k, v in r.items() if k not in HIDE and v not in (None, '', [])}
        if fields:
            r = {k: v for k, v in r.items() if k in fields or k in ('id', 'title')}
        out.append(r)
    return out


def table_ok(t, write=False):
    if t not in WRITABLE and t not in READ_ONLY:
        sys.exit(f'Unknown table {t}. Use one of: {", ".join(sorted(set(WRITABLE) | READ_ONLY))}')
    if write and t in READ_ONLY:
        sys.exit(f'{t} is her media library. Athena reads it but never changes it.' if t == 'media'
                 else f'{t} is filled by athena/stats.py. Athena reads it but never changes it by hand.' if t in ('posts', 'post_metrics')
                 else f'{t} belongs to Metis. Athena reads it but never changes it.')


def values(t, sets, set_files):
    data = {}
    for item in sets or []:
        k, _, v = item.partition('=')
        data[k.strip()] = v
    for item in set_files or []:
        k, _, p = item.partition('=')
        with open(p, encoding='utf-8') as f:
            data[k.strip()] = f.read().strip('\n')
    for k in list(data):
        if k not in WRITABLE[t]:
            sys.exit(f'{t} has no column {k}. Columns: {", ".join(WRITABLE[t])}')
        if data[k] == '':
            data[k] = [] if k in ARRAYS else None
        elif k in ARRAYS:
            data[k] = [x.strip() for x in data[k].split('|') if x.strip()]
        elif k in JSONS:
            try:
                data[k] = json.loads(data[k])
            except ValueError:
                sys.exit(f'{k} must be JSON, like {{"Waitlist total": 120}}')
    return data


def find(t, ref):
    q = urllib.parse.quote(ref)
    if len(ref) == 36 and ref.count('-') == 4:
        rows = api('GET', f'{t}?id=eq.{q}&deleted_at=is.null&select=*')
    else:
        rows = api('GET', f'{t}?title=ilike.*{q}*&deleted_at=is.null&select=*&limit=5')
    if not rows:
        sys.exit(f'Nothing in {t} matches "{ref}".')
    if len(rows) > 1:
        sys.exit('More than one match, use the id:\n' + json.dumps([{'id': r['id'], 'title': r['title']} for r in rows], indent=1))
    return rows[0]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('ls'); s.add_argument('table'); s.add_argument('--open', action='store_true')
    s.add_argument('--where', action='append'); s.add_argument('--limit', type=int, default=200); s.add_argument('--fields')
    s = sub.add_parser('get'); s.add_argument('table'); s.add_argument('ref'); s.add_argument('--out')
    for name in ('new', 'set'):
        s = sub.add_parser(name); s.add_argument('table')
        if name == 'set':
            s.add_argument('ref')
        s.add_argument('--set', action='append'); s.add_argument('--set-file', action='append')
    s = sub.add_parser('delete'); s.add_argument('table'); s.add_argument('ref')
    a = p.parse_args()

    if a.cmd == 'ls':
        table_ok(a.table)
        parts = ['deleted_at=is.null', 'select=*', f'limit={a.limit}', f'order={ORDER[a.table]}']
        if a.open and a.table in OPEN:
            parts.append(OPEN[a.table])
        for w in a.where or []:
            k, _, v = w.partition('=')
            parts.append(f'{urllib.parse.quote(k.strip())}=eq.{urllib.parse.quote(v.strip())}')
        rows = api('GET', a.table + '?' + '&'.join(parts))
        fields = set(a.fields.split(',')) if a.fields else None
        if a.table == 'pages' and not fields:
            fields = {'folder'}  # page bodies are long, read one with get
        print(json.dumps(clean(rows, fields), indent=1, ensure_ascii=False, default=str))
    elif a.cmd == 'get':
        table_ok(a.table)
        row = clean([find(a.table, a.ref)])[0]
        if a.out:  # long pages, such as class transcripts: save the body, then search it with Grep or Read
            with open(a.out, 'w', encoding='utf-8') as f:
                f.write(row.pop('body', ''))
            row['body_saved_to'] = a.out
        print(json.dumps(row, indent=1, ensure_ascii=False, default=str))
    elif a.cmd == 'new':
        table_ok(a.table, write=True)
        data = values(a.table, a.set, a.set_file)
        if not data.get('title'):
            sys.exit('A new row needs --set title=...')
        if a.table == 'tasks':
            data.setdefault('status', 'Not started'); data.setdefault('source', 'Athena')
            if not data.get('bucket'):
                sys.exit('Every task needs a bucket: Client work, ColibriOS, Gray Bear, DiscoverSWNM, Admin, Personal.')
        row = api('POST', a.table, data)[0]
        print(json.dumps({'created': row['id'], 'title': row['title']}))
    elif a.cmd == 'set':
        table_ok(a.table, write=True)
        row = find(a.table, a.ref)
        data = values(a.table, a.set, a.set_file)
        if not data:
            sys.exit('Nothing to change. Pass --set COL=VALUE.')
        api('PATCH', f'{a.table}?id=eq.{urllib.parse.quote(row["id"])}', data)
        print(json.dumps({'updated': row['id'], 'title': row['title'], 'changed': sorted(data)}))
    elif a.cmd == 'delete':
        table_ok(a.table, write=True)
        row = find(a.table, a.ref)
        api('PATCH', f'{a.table}?id=eq.{row["id"]}', {'deleted_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        print(json.dumps({'deleted': row['id'], 'title': row['title']}))


if __name__ == '__main__':
    main()
