#!/usr/bin/env python3
"""Two-way sync between Athena's Supabase tables and the Obsidian vault.

Run from a checkout of this repo with the vault checked out next to it:

  python3 sync/sync.py --vault ../athena-vault            # sync both ways
  python3 sync/sync.py --vault ../athena-vault --dry-run  # show what would change
  python3 sync/sync.py --vault ../athena-vault --emit-sql FILE  # first import as SQL, no Supabase calls

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (not for --emit-sql).
Standard library only, so the GitHub Action needs no installs.

How a note and a row stay matched:
  every row stores the note's path (vault_path), a hash of the file at the last sync
  (synced_hash) and when that sync happened (synced_at). The app bumps updated_at on
  every edit. So on each run:
    file hash changed, row not edited   -> copy the note into the row
    row edited, file unchanged          -> write the row into the note
    both changed                        -> the newer edit wins (git commit time vs updated_at)
    new note                            -> new row
    new row (no vault_path)             -> new note
    row deleted in the app              -> note removed
    note removed in Obsidian            -> row removed, unless the app edited it since
"""
import argparse, datetime, hashlib, json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

try:
    from zoneinfo import ZoneInfo
    MOUNTAIN = ZoneInfo('America/Denver')
except Exception:  # pragma: no cover
    MOUNTAIN = datetime.timezone(datetime.timedelta(hours=-6))

# ---------- Field maps: frontmatter key -> (column, type, allowed values or None) ----------
TASK_STATUS = {'Not started', 'In progress', 'Waiting on someone', 'Done', 'Dropped'}
TABLES = {
    'tasks': {
        'folder': 'Athena/Tasks', 'base': 'Tasks.base', 'created': True,
        'fields': {
            'Status': ('status', 'text', TASK_STATUS),
            'Priority': ('priority', 'text', {'Today', 'This week', 'Backlog'}),
            'Bucket': ('bucket', 'text', {'Client work', 'ColibriOS', 'Gray Bear', 'DiscoverSWNM', 'Admin', 'Personal'}),
            'Client': ('client', 'text', {'SENERGY360', 'Vive Management', 'Loma del Mar', 'ColibriOS', 'Dragonfly', 'None'}),
            'Source': ('source', 'text', {'Meeting', 'Email', 'Brief', 'Stephanie', 'Athena'}),
            'EOS flag': ('eos_flag', 'text', {'Off track Rock', 'Off pace measurable', 'Rolled twice', 'L10 to-do'}),
            'Due': ('due', 'date', None),
            'Est hours': ('est_hours', 'num', None),
            'Serves Rock': ('serves_rock', 'list', None),
            'Notes': ('notes', 'text', None),
        },
        'required': {'status': 'Not started'},
    },
    'briefs': {
        'folder': 'Athena/Briefs', 'base': 'Briefs.base', 'created': True,
        'fields': {
            'Type': ('type', 'text', {'Monday plan', 'Wednesday check', 'Friday wrap', 'Monthly review'}),
            'Week of': ('week_of', 'date', None),
            'Client hours': ('client_hours', 'num', None),
            'ColibriOS hours': ('colibrios_hours', 'num', None),
            'Decision needed': ('decision_needed', 'text', None),
            'Gone quiet': ('gone_quiet', 'text', None),
            'Carry over': ('carry_over', 'text', None),
        },
    },
    'money': {
        'folder': 'Athena/Money', 'base': 'Money.base', 'created': False,
        'fields': {
            'Kind': ('kind', 'text', {'Invoice', 'Pipeline', 'Recurring'}),
            'Status': ('status', 'text', {'Draft', 'Sent', 'Paid', 'Overdue', 'Open', 'Won', 'Lost'}),
            'Client': ('client', 'text', None),
            'Amount': ('amount', 'num', None),
            'Sent': ('sent', 'date', None),
            'Due': ('due', 'date', None),
            'Last nudge': ('last_nudge', 'date', None),
            'Notes': ('notes', 'text', None),
        },
    },
    'content': {
        'folder': 'Athena/Content', 'base': 'Content.base', 'created': True,
        'fields': {
            'Status': ('status', 'text', {'Idea', 'Drafted', 'Awaiting approval', 'Scheduled', 'Shipped', 'Skipped'}),
            'Channel': ('channel', 'text', None),
            'Product': ('product', 'text', None),
            'Target date': ('target_date', 'date', None),
            'CTA': ('cta', 'text', None),
            'Notes': ('notes', 'text', None),
        },
        'required': {'status': 'Idea'},
    },
    'rocks': {
        'folder': 'Metis/Rocks', 'base': 'Rocks.base', 'created': False,
        'fields': {
            'Quarter': ('quarter', 'text', {'Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027'}),
            'Status': ('status', 'text', {'On track', 'Off track', 'Done'}),
            'Owner': ('owner', 'text', None),
            'Due': ('due', 'date', None),
            'Athena tasks': ('athena_tasks', 'list', None),
            'Notes': ('notes', 'text', None),
        },
    },
    'scorecard': {
        'folder': 'Metis/Scorecard', 'base': 'Scorecard.base', 'created': False,
        'fields': {},  # every measurable goes into metrics
    },
    'issues': {
        'folder': 'Metis/Issues List', 'base': 'Issues List.base', 'created': False,
        'fields': {
            'Priority': ('priority', 'int', {1, 2, 3, 4}),
            'Status': ('status', 'text', {'Open', 'Solved', 'Parked'}),
            'Owner': ('owner', 'text', None),
            'Raised': ('raised', 'date', None),
            'Solved on': ('solved_on', 'date', None),
            'Solution': ('solution', 'text', None),
        },
        'required': {'status': 'Open'},
    },
    'l10': {
        'folder': 'Metis/Level 10 Log', 'base': 'Level 10 Log.base', 'created': False,
        'fields': {
            'Date': ('meeting_date', 'date', None),
            'Rating': ('rating', 'num', None),
            'Issue solved': ('issue_solved', 'text', None),
        },
    },
}
TABLE_FOLDERS = {cfg['folder'] for cfg in TABLES.values()}
SKIP_PAGES = {'README.md'}
NUMERIC_KEYS = {'Est hours', 'Client hours', 'ColibriOS hours', 'Amount', 'Rating', 'Priority'}
HIDDEN = {'notion-id', 'base'}
MAX_DELETE_SHARE = 0.5  # refuse to delete more than half of a table in one run


# ---------- Vault note format (same rules as athena-vault/.claude/vault.py) ----------
def unquote(v):
    v = v.strip()
    if v == '[]':
        return []
    if v.startswith('"') and v.endswith('"'):
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    return v


def parse(text):
    lines = text.split('\n')
    if not lines or lines[0] != '---':
        return {}, text
    fm, blocks, key, mode, i = {}, {}, None, None, 1
    while i < len(lines) and lines[i] != '---':
        ln = lines[i]
        m = re.match(r'^([^\s#][^:]*):(?: (.*))?$', ln)
        if m and not ln.startswith(' '):
            key, val = m.group(1), m.group(2)
            if val is None or val == '':
                fm[key], mode = None, 'list'
            elif val in ('|-', '|', '>-', '>', '|+'):
                fm[key], mode, blocks[key] = '', 'block', []
            else:
                fm[key], mode = unquote(val), None
        elif key and mode == 'block':
            blocks[key].append(ln[2:] if ln.startswith('  ') else ln.strip())
        elif key and mode == 'list' and ln.lstrip().startswith('- '):
            fm[key] = (fm[key] or []) + [unquote(ln.lstrip()[2:])]
        i += 1
    for k, b in blocks.items():
        fm[k] = '\n'.join(b).strip('\n')
    return fm, '\n'.join(lines[i + 1:])


def q(key, s):
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return str(int(s)) if float(s).is_integer() else str(s)  # numbers stay numbers in Obsidian
    s = str(s)
    if s == '':
        return '""'
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?', s):
        return s
    if re.fullmatch(r'-?\d+(\.\d+)?', s):
        return s if key in NUMERIC_KEYS else json.dumps(s)
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ,.()'&/+@!?$%-]*", s) and ': ' not in s \
            and not re.fullmatch(r'(?i)true|false|yes|no|null|on|off|~', s):
        return s
    return json.dumps(s, ensure_ascii=False)


def dump(fm, body):
    out = ['---']
    for k, v in fm.items():
        if v is None:
            out.append(f'{k}:')
        elif isinstance(v, list):
            out.append(f'{k}: []' if not v else f'{k}:\n' + '\n'.join('  - ' + q(k, x) for x in v))
        elif '\n' in str(v):
            out.append(f'{k}: |-\n' + '\n'.join(('  ' + l) if l else '' for l in str(v).split('\n')))
        else:
            out.append(f'{k}: {q(k, v)}')
    out.append('---')
    return '\n'.join(out) + '\n' + body.lstrip('\n')


def safe_name(title):
    t = title.replace('/', '-').replace('\\', '-')
    t = re.sub(r'[:*?"<>|#^\[\]]', '', t)
    return re.sub(r'\s+', ' ', t).strip().rstrip('.')[:180] or 'Untitled'


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


# ---------- Value conversion ----------
def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def to_col(raw, typ, allowed):
    """Return (value, ok). ok=False means keep the raw value in extra."""
    if raw is None or raw == '' or raw == []:
        return (None if typ != 'list' else []), True
    try:
        if typ == 'text':
            v = '\n'.join(map(str, raw)) if isinstance(raw, list) else str(raw)
        elif typ == 'date':
            v = str(raw)[:10]
            datetime.date.fromisoformat(v)
        elif typ == 'num':
            v = float(raw)
            v = int(v) if v.is_integer() else v
        elif typ == 'int':
            v = int(float(raw))
        elif typ == 'list':
            v = [str(x) for x in raw] if isinstance(raw, list) else [str(raw)]
        else:
            return None, False
    except (ValueError, TypeError):
        return None, False
    if allowed is not None and v not in allowed:
        return None, False
    return v, True


def from_col(v, typ):
    if v is None:
        return None
    if typ == 'num':
        f = float(v)
        return str(int(f)) if f.is_integer() else str(f)
    if typ == 'int':
        return str(int(float(v)))
    if typ == 'list':
        return list(v or [])
    return str(v)


def created_to_iso(raw):
    try:
        d = datetime.datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=MOUNTAIN)
    return d.astimezone(datetime.timezone.utc).isoformat(timespec='seconds')


def created_to_vault(iso):
    d = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return d.astimezone(MOUNTAIN).strftime('%Y-%m-%dT%H:%M:%S')


# ---------- Note <-> row ----------
def note_to_row(table, rel, text):
    cfg = TABLES.get(table)
    fm, body = parse(text)
    title = os.path.splitext(os.path.basename(rel))[0]
    row = {'title': title, 'body': body.strip('\n'), 'vault_path': rel}
    extra = {}
    if table == 'pages':
        row['folder'] = os.path.dirname(rel)
        extra = {k: v for k, v in fm.items()}
    else:
        used = set(HIDDEN)
        for key, (col, typ, allowed) in cfg['fields'].items():
            if key not in fm:
                row[col] = [] if typ == 'list' else None  # a field removed in Obsidian clears the column
                continue
            used.add(key)
            v, ok = to_col(fm[key], typ, allowed)
            row[col] = v
            if not ok:
                extra[key] = fm[key]
        if cfg['created'] and fm.get('Created'):
            used.add('Created')
            iso = created_to_iso(fm['Created'])
            if iso:
                row['created_at'] = iso
            else:
                extra['Created'] = fm['Created']
        if table == 'scorecard':
            metrics = {}
            for k, v in fm.items():
                if k in used:
                    continue
                used.add(k)
                n, ok = to_col(v, 'num', None)
                if ok and n is not None:
                    metrics[k] = n
                elif v not in (None, ''):
                    extra[k] = v
            row['metrics'] = metrics
            try:
                datetime.date.fromisoformat(title)
                row['week_ending'] = title
            except ValueError:
                row['week_ending'] = None
        for k, v in fm.items():
            if k not in used:
                extra[k] = v
        for col, default in cfg.get('required', {}).items():
            if row.get(col) is None:
                row[col] = default
        # notion-id and base stay in extra so the note keeps them when written back.
        for k in HIDDEN:
            if k in fm:
                extra[k] = fm[k]
    row['extra'] = extra
    return row


def row_to_note(table, row, old_text):
    old_fm, _ = parse(old_text) if old_text else ({}, '')
    extra = dict(row.get('extra') or {})
    fm = {}
    if table == 'pages':
        fm = extra
    else:
        cfg = TABLES[table]
        if 'notion-id' in old_fm or 'notion-id' in extra:
            fm['notion-id'] = old_fm.get('notion-id', extra.get('notion-id'))
        fm['base'] = f'[[{cfg["base"]}]]'
        created = None
        if cfg['created']:
            created = created_to_vault(row['created_at']) if row.get('created_at') else extra.get('Created')
            if 'Created' not in old_fm and created is not None:
                fm['Created'] = created
        # Keep the old note's key order, then add anything new.
        order = [k for k in old_fm if k not in HIDDEN]
        for key in cfg['fields']:
            if key not in order:
                order.append(key)
        for k in extra:
            if k not in order and k not in HIDDEN and k != 'Created':
                order.append(k)
        metrics = row.get('metrics') or {} if table == 'scorecard' else {}
        for k in metrics:
            if k not in order:
                order.append(k)
        for key in order:
            if key in cfg['fields']:
                col, typ, _ = cfg['fields'][key]
                v = from_col(row.get(col), typ)
                if v is None or v == []:
                    if key in extra:
                        fm[key] = extra[key]
                    elif key in old_fm or typ == 'list':
                        fm[key] = [] if typ == 'list' else None
                else:
                    fm[key] = v
            elif key == 'Created':
                if created is not None:
                    fm['Created'] = created
            elif key in metrics:
                v = metrics[key]
                fm[key] = v if isinstance(v, (int, float)) else from_col(v, 'num')
            elif key in extra:
                fm[key] = extra[key]
    body = row.get('body') or ''
    return dump(fm, body + ('\n' if body and not body.endswith('\n') else ''))


# ---------- Supabase REST ----------
class Supa:
    def __init__(self, url, key, dry):
        self.url, self.key, self.dry = url.rstrip('/'), key, dry

    def req(self, method, path, body=None, prefer=None):
        h = {'apikey': self.key, 'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json'}
        if prefer:
            h['Prefer'] = prefer
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(f'{self.url}/rest/v1/{path}', data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                txt = resp.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'{method} {path}: {e.code} {e.read().decode()[:500]}') from None

    def rows(self, table):
        return self.req('GET', f'{table}?select=*&limit=100000')

    def insert(self, table, row):
        if self.dry:
            return {**row, 'id': 'dry'}
        return self.req('POST', table, row, 'return=representation')[0]

    def update(self, table, rid, patch):
        if not self.dry:
            self.req('PATCH', f'{table}?id=eq.{rid}', patch, 'return=minimal')

    def delete(self, table, rid):
        if not self.dry:
            self.req('DELETE', f'{table}?id=eq.{rid}', None, 'return=minimal')


# ---------- Vault scan ----------
def scan(vault):
    """Return {table: {rel_path: text}} for every note the sync owns."""
    out = {t: {} for t in TABLES}
    out['pages'] = {}
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for fn in filenames:
            if not fn.endswith('.md'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, vault).replace(os.sep, '/')
            folder = os.path.dirname(rel)
            table = next((t for t, c in TABLES.items() if c['folder'] == folder), None)
            if table is None:
                if rel in SKIP_PAGES or any(folder.startswith(f + '/') for f in TABLE_FOLDERS):
                    continue
                table = 'pages'
            with open(full, encoding='utf-8') as f:
                out[table][rel] = f.read()
    return out


def git_time(vault, rel):
    try:
        out = subprocess.run(['git', '-C', vault, 'log', '-1', '--format=%cI', '--', rel],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        return out or None
    except Exception:
        return None


def ts(s):
    if not s:
        return None
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))


def folder_for(table, row):
    if table == 'pages':
        return row.get('folder') or 'Athena'
    return TABLES[table]['folder']


def free_path(vault, folder, title, taken):
    base = f'{folder}/{safe_name(title)}'
    rel, n = f'{base}.md', 2
    while rel in taken or os.path.exists(os.path.join(vault, rel)):
        rel, n = f'{base} ({n}).md', n + 1
    return rel


# ---------- One table ----------
def sync_table(table, vault, files, supa, log):
    rows = supa.rows(table)
    by_path = {r['vault_path']: r for r in rows if r.get('vault_path')}
    stamp = now_iso()
    deletes = []
    counts = {'to_row': 0, 'to_note': 0, 'new_row': 0, 'new_note': 0, 'del_row': 0, 'del_note': 0}

    def write_note(rel, text):
        full = os.path.join(vault, rel)
        if not supa.dry:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, 'w', encoding='utf-8') as f:
                f.write(text)

    def mark(rid, extra_patch, text):
        supa.update(table, rid, {**extra_patch, 'synced_hash': sha(text), 'synced_at': stamp, 'updated_at': stamp})

    for rel, text in files.items():
        h = sha(text)
        row = by_path.pop(rel, None)
        if row is None:
            new = note_to_row(table, rel, text)
            supa.insert(table, {**new, 'synced_hash': h, 'synced_at': stamp, 'updated_at': stamp})
            counts['new_row'] += 1
            log(f'  + row   {rel}')
            continue
        file_changed = h != row.get('synced_hash')
        app_changed = row.get('synced_at') is None or ts(row['updated_at']) > ts(row['synced_at'])
        if row.get('deleted_at'):
            if file_changed:  # edited in Obsidian after the app deleted it: keep the note, restore the row
                mark(row['id'], {**note_to_row(table, rel, text), 'deleted_at': None}, text)
                counts['to_row'] += 1
                log(f'  ~ row   {rel} (restored, edited in Obsidian after delete)')
            else:
                deletes.append(('note', row, rel))
            continue
        winner = None
        if file_changed and app_changed:
            gt = ts(git_time(vault, rel))
            winner = 'note' if gt and gt > ts(row['updated_at']) else 'row'
            log(f'  ! both  {rel}: both changed, keeping the {"Obsidian" if winner == "note" else "app"} edit')
        elif file_changed:
            winner = 'note'
        elif app_changed:
            winner = 'row'
        if winner == 'note':
            mark(row['id'], note_to_row(table, rel, text), text)
            counts['to_row'] += 1
            log(f'  ~ row   {rel}')
        elif winner == 'row':
            want = rel
            if table != 'pages' and safe_name(row['title']) != os.path.splitext(os.path.basename(rel))[0]:
                want = free_path(vault, folder_for(table, row), row['title'], set(files) | set(by_path))
            new_text = row_to_note(table, row, text)
            if want != rel:
                if not supa.dry:
                    os.remove(os.path.join(vault, rel))
                log(f'  > note  {rel} -> {want} (renamed)')
            else:
                log(f'  ~ note  {rel}')
            write_note(want, new_text)
            mark(row['id'], {'vault_path': want}, new_text)
            counts['to_note'] += 1

    # Rows whose note is gone, and rows the app created.
    for rel, row in by_path.items():
        app_changed = row.get('synced_at') is None or ts(row['updated_at']) > ts(row['synced_at'])
        if row.get('deleted_at') or not app_changed:
            deletes.append(('row', row, rel))
        else:
            text = row_to_note(table, row, '')
            write_note(rel, text)
            mark(row['id'], {}, text)
            counts['new_note'] += 1
            log(f'  + note  {rel} (recreated, edited in the app after it left Obsidian)')
    taken = set(files)
    for row in rows:
        if row.get('vault_path'):
            continue
        if row.get('deleted_at'):
            supa.delete(table, row['id'])
            continue
        rel = free_path(vault, folder_for(table, row), row['title'], taken)
        taken.add(rel)
        text = row_to_note(table, row, '')
        write_note(rel, text)
        mark(row['id'], {'vault_path': rel}, text)
        counts['new_note'] += 1
        log(f'  + note  {rel}')

    live = len([r for r in rows if r.get('vault_path')])
    if deletes and live and len(deletes) > 3 and len(deletes) / live > MAX_DELETE_SHARE:
        raise RuntimeError(f'{table}: refusing to delete {len(deletes)} of {live} notes in one run. '
                           'Check the vault checkout before running again.')
    for kind, row, rel in deletes:
        if kind == 'note':
            if not supa.dry and os.path.exists(os.path.join(vault, rel)):
                os.remove(os.path.join(vault, rel))
            counts['del_note'] += 1
            log(f'  - note  {rel}')
        else:
            counts['del_row'] += 1
            log(f'  - row   {rel}')
        supa.delete(table, row['id'])
    return counts


# ---------- First import as SQL ----------
def sql_lit(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict,)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    if isinstance(v, list):
        inner = ','.join('"' + str(x).replace('\\', '\\\\').replace('"', '\\"') + '"' for x in v)
        return "'{" + inner.replace("'", "''") + "}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def emit_sql(vault, path):
    data = scan(vault)
    stamp = now_iso()
    out = ['begin;']
    for table, files in data.items():
        for rel, text in sorted(files.items()):
            row = note_to_row(table, rel, text)
            row.update({'synced_hash': sha(text), 'synced_at': stamp, 'updated_at': stamp})
            cols = list(row)
            out.append(f'insert into public.{table} ({", ".join(cols)}) values ({", ".join(sql_lit(row[c]) for c in cols)}) '
                       'on conflict (vault_path) do nothing;')
    out.append('commit;')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    print(f'wrote {sum(len(v) for v in data.values())} inserts to {path}', file=sys.stderr)
    for t, files in data.items():
        print(f'  {t}: {len(files)}', file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--vault', required=True)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--emit-sql')
    a = p.parse_args()
    vault = os.path.abspath(a.vault)
    if a.emit_sql:
        return emit_sql(vault, a.emit_sql)
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        sys.exit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    supa = Supa(url, key, a.dry_run)
    data = scan(vault)
    total = {}
    for table in list(TABLES) + ['pages']:
        print(f'{table}:')
        c = sync_table(table, vault, data[table], supa, print)
        for k, v in c.items():
            total[k] = total.get(k, 0) + v
    print('summary: ' + ', '.join(f'{k}={v}' for k, v in total.items()))


if __name__ == '__main__':
    main()
