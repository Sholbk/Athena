#!/usr/bin/env python3
"""Athena's design hands: make a post's image in Stephanie's Blotato account.

  python3 athena/blotato.py templates [--search WORDS]
  python3 athena/blotato.py make --template ID --title TITLE [--prompt-file FILE] [--inputs-file FILE]
  python3 athena/blotato.py wait ID

make starts a design from one of Blotato's templates and prints its id. wait checks on it
for up to 90 seconds; run it again until it says done. When done it prints the image links
and the page where Stephanie can open the design in Blotato.

This only makes designs. It has no way to post or schedule anything: Stephanie posts herself.
Needs BLOTATO_API_KEY. Standard library only.
"""
import argparse, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

API = 'https://backend.blotato.com/v2'
DONE = 'done'
STOPPED = {'creation-from-template-failed', 'insufficient-credits', 'draft'}
PATIENCE = 90   # seconds per wait call, so one call stays inside a tool call's time limit
EVERY = 15      # Blotato asks for at least 15 seconds between checks


def call(method, path, body=None):
    key = os.environ.get('BLOTATO_API_KEY')
    if not key:
        sys.exit('BLOTATO_API_KEY is not set, so no image can be made. Save the caption and say the image is waiting on the Blotato key.')
    h = {'blotato-api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json'}
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        sys.exit(f'Blotato said no: {e.code} {e.read().decode()[:400]}')
    except urllib.error.URLError as e:
        sys.exit(f'Could not reach Blotato: {e.reason}')


def page(id_):
    return f'https://my.blotato.com/videos/{id_}'


def templates(a):
    data = call('GET', '/videos/templates')
    items = data.get('items', data if isinstance(data, list) else [])
    pat = re.compile(a.search, re.I) if a.search else None
    out = []
    for t in items:
        if pat and not pat.search(f'{t.get("title", "")} {t.get("description", "")}'):
            continue
        out.append({'id': t.get('id'), 'name': t.get('description') or t.get('title'),
                    'inputs': [i.get('name') for i in t.get('inputs', [])]})
    print(json.dumps(out, indent=1))


def make(a):
    body = {'templateId': a.template, 'title': a.title, 'inputs': {}, 'render': True}
    if a.prompt_file:
        with open(a.prompt_file, encoding='utf-8') as f:
            body['prompt'] = f.read().strip()
    if a.inputs_file:
        with open(a.inputs_file, encoding='utf-8') as f:
            try:
                body['inputs'] = json.load(f)
            except ValueError as e:
                sys.exit(f'The inputs file is not JSON: {e}')
    if not body.get('prompt') and not body['inputs']:
        sys.exit('Give a --prompt-file, an --inputs-file, or both.')
    item = call('POST', '/videos/from-templates', body).get('item', {})
    if not item.get('id'):
        sys.exit('Blotato did not return an id for the design.')
    print(json.dumps({'id': item['id'], 'status': item.get('status'), 'blotato_page': page(item['id']),
                      'next': f'python3 athena/blotato.py wait {item["id"]}'}, indent=1))


def wait(a):
    if not re.fullmatch(r'[A-Za-z0-9_-]{6,80}', a.id):
        sys.exit('That does not look like a Blotato design id.')
    end = time.time() + PATIENCE
    while True:
        item = call('GET', f'/videos/creations/{urllib.parse.quote(a.id)}').get('item', {})
        status = item.get('status') or 'unknown'
        if item.get('error') or status in STOPPED:
            print(json.dumps({'id': a.id, 'status': status, 'error': item.get('error') or status,
                              'blotato_page': page(a.id), 'done': False, 'stopped': True}, indent=1))
            return
        if status == DONE:
            print(json.dumps({'id': a.id, 'status': status, 'done': True, 'image_urls': item.get('imageUrls') or [],
                              'video_url': item.get('mediaUrl'), 'blotato_page': page(a.id)}, indent=1))
            return
        if time.time() + EVERY > end:
            print(json.dumps({'id': a.id, 'status': status, 'done': False,
                              'next': f'Still working. Run python3 athena/blotato.py wait {a.id} again.'}, indent=1))
            return
        time.sleep(EVERY)


def main():
    p = argparse.ArgumentParser(description='Make a post image in Blotato. Never posts.')
    sub = p.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('templates'); t.add_argument('--search')
    m = sub.add_parser('make')
    m.add_argument('--template', required=True)
    m.add_argument('--title', required=True)
    m.add_argument('--prompt-file')
    m.add_argument('--inputs-file')
    w = sub.add_parser('wait'); w.add_argument('id')
    a = p.parse_args()
    {'templates': templates, 'make': make, 'wait': wait}[a.cmd](a)


if __name__ == '__main__':
    main()
