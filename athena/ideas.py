#!/usr/bin/env python3
"""Athena's hands for the idea bank: the "## Idea bank" section of the ColibriOS Brand Files page.

  python3 athena/ideas.py list
  python3 athena/ideas.py add --pillar "PILLAR HEADING" --text "THE SEED"

list prints the pillars, every seed, the Used list and the next seed number.
add puts one new seed at the end of one pillar, numbered after the highest seed, the same way
"Add an idea" does on her Marketing page (src/lib/ideas.js). It never changes or removes a seed.
Standard library only.
"""
import argparse, json, re, sys, urllib.parse

from db import api

PAGE = 'ColibriOS Brand Files'
SECTION = re.compile(r'^## Idea bank\s*$', re.M)


def bounds(body):
    m = SECTION.search(body)
    if not m:
        return None
    rest = body[m.end():]
    nxt = re.search(r'^## (?!#)', rest, re.M)
    return m.start(), (len(body) if not nxt else m.end() + nxt.start())


def parse(body):
    b = bounds(body)
    if not b:
        return None
    groups, used, cur, in_used = [], [], None, False
    for ln in body[b[0]:b[1]].split('\n'):
        h = re.match(r'^###\s+(.*)$', ln)
        if h:
            in_used = bool(re.match(r'used\b', h.group(1).strip(), re.I))
            cur = None if in_used else {'pillar': h.group(1).strip(), 'seeds': []}
            if cur:
                groups.append(cur)
            continue
        n = re.match(r'^(\d+)\.\s+(.*)$', ln)
        if in_used:
            u = re.match(r'^\s*(?:[-*]\s+)?(?:(\d+)\.\s+)?(.*)$', ln)
            if u and (n or re.match(r'^\s*[-*]\s+', ln)):
                used.append({'num': int(u.group(1)) if u.group(1) else None, 'text': u.group(2).strip()})
        elif cur and n:
            cur['seeds'].append({'num': int(n.group(1)), 'text': n.group(2).strip()})
    nums = [s['num'] for g in groups for s in g['seeds']] + [u['num'] or 0 for u in used]
    return {'pillars': groups, 'used': used, 'next': max([0] + nums) + 1}


def page():
    rows = api('GET', f'pages?title=eq.{urllib.parse.quote(PAGE)}&deleted_at=is.null&select=id,body')
    if not rows:
        sys.exit(f'The page "{PAGE}" is missing.')
    bank = parse(rows[0]['body'] or '')
    if not bank:
        sys.exit(f'The page "{PAGE}" has no "## Idea bank" section.')
    return rows[0], bank


def add_seed(body, pillar, num, text):
    start, end = bounds(body)
    lines = body[start:end].split('\n')
    in_group, last, head = False, -1, -1
    for i, ln in enumerate(lines):
        h = re.match(r'^###\s+(.*)$', ln)
        if h:
            in_group = h.group(1).strip() == pillar
            if in_group:
                head = i
            continue
        if in_group and re.match(r'^\d+\.\s', ln):
            last = i
    lines.insert(last + 1 if last >= 0 else head + 2, f'{num}. {text}')
    return body[:start] + '\n'.join(lines) + body[end:]


def words(text):
    return re.sub(r'[^a-z0-9 ]', '', re.sub(r'\(from colibrios\.com[^)]*\)', '', text.lower())).split()


def main():
    p = argparse.ArgumentParser(description='Read and add to the idea bank. Never changes or removes a seed.')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('list')
    a_ = sub.add_parser('add'); a_.add_argument('--pillar', required=True); a_.add_argument('--text', required=True)
    a = p.parse_args()

    row, bank = page()
    if a.cmd == 'list':
        print(json.dumps(bank, indent=1, ensure_ascii=False))
        return
    text = ' '.join(a.text.split())
    if len(text) < 20:
        sys.exit('A seed needs a full angle, at least a sentence.')
    if re.search(r'[–—]', text):
        sys.exit('No dashes (— or –) in a seed. Use a comma, period or parentheses.')
    names = [g['pillar'] for g in bank['pillars']]
    if a.pillar not in names:
        sys.exit('No pillar is called that. Use one of these exactly:\n' + '\n'.join(names))
    mine = set(words(text))
    for s in [s for g in bank['pillars'] for s in g['seeds']] + bank['used']:
        theirs = set(words(s['text']))
        if mine and theirs and len(mine & theirs) / len(mine | theirs) > 0.6:
            sys.exit(f'Too close to seed {s["num"]}: {s["text"][:120]}')
    body = add_seed(row['body'], a.pillar, bank['next'], text)
    api('PATCH', f'pages?id=eq.{row["id"]}', {'body': body})
    print(json.dumps({'added': bank['next'], 'pillar': a.pillar, 'text': text}, ensure_ascii=False))


if __name__ == '__main__':
    main()
