#!/usr/bin/env python3
"""Athena's hands for Stephanie's Media library (Marketing > Media).

  python3 athena/media.py link ID
  python3 athena/media.py fetch ID --out FILE
  python3 athena/media.py add --url URL [--url URL ...] --title TITLE --content CONTENT_ID
                              [--seed N] [--source LINK] [--tags a|b]
  python3 athena/media.py attach ID --content CONTENT_ID

link   prints a link to one file that works for one hour, so a Blotato design can use her photo.
fetch  saves one file to disk, so Athena can look at a photo with Read.
add    saves finished images (from Blotato) into Finished posts, tied to a content row.
attach ties a file already in Media to a content row.

Never deletes and never changes her titles, tags or notes. Find files with
`python3 athena/db.py ls media`. Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and Pillow.
"""
import argparse, io, json, mimetypes, os, re, sys, urllib.error, urllib.parse, urllib.request, uuid

BUCKET = 'media'
MAX_FILE = 50 * 1024 ** 2   # the free plan's limit for one file
THUMB_EDGE = 480            # same preview size the app makes
EXT = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
       'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'}
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def base():
    return os.environ['SUPABASE_URL'].rstrip('/')


def headers(extra=None):
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}'}
    h.update(extra or {})
    return h


def send(method, url, data=None, extra=None):
    r = urllib.request.Request(url, data=data, method=method, headers=headers(extra))
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f'Supabase said no: {e.code} {e.read().decode()[:400]}')


def rest(method, path, body=None):
    t = send(method, f'{base()}/rest/v1/{path}', json.dumps(body).encode() if body is not None else None,
             {'Content-Type': 'application/json', 'Prefer': 'return=representation'})
    return json.loads(t) if t else None


def need_id(value, what):
    if not UUID.fullmatch(value or ''):
        sys.exit(f'{what} must be an id (36 characters), not "{value}".')
    return value


def media_row(id_):
    rows = rest('GET', f'media?id=eq.{need_id(id_, "The media id")}&select=id,title,path,mime')
    if not rows:
        sys.exit(f'Nothing in Media has the id {id_}.')
    return rows[0]


def content_row(id_):
    rows = rest('GET', f'content?id=eq.{need_id(id_, "The content id")}&deleted_at=is.null&select=id,title')
    if not rows:
        sys.exit(f'No content piece has the id {id_}.')
    return rows[0]


def signed(path, seconds=3600):
    t = send('POST', f'{base()}/storage/v1/object/sign/{BUCKET}/{urllib.parse.quote(path)}',
             json.dumps({'expiresIn': seconds}).encode(), {'Content-Type': 'application/json'})
    rel = json.loads(t).get('signedURL') or json.loads(t).get('signedUrl')
    if not rel:
        sys.exit('Supabase did not return a link.')
    return f'{base()}/storage/v1{rel}'


def link(a):
    row = media_row(a.id)
    print(json.dumps({'id': row['id'], 'title': row['title'], 'mime': row['mime'], 'url': signed(row['path']),
                      'lasts': '1 hour'}, indent=1))


def fetch(a):
    row = media_row(a.id)
    data = send('GET', f'{base()}/storage/v1/object/{BUCKET}/{urllib.parse.quote(row["path"])}')
    with open(a.out, 'wb') as f:
        f.write(data)
    print(json.dumps({'id': row['id'], 'title': row['title'], 'mime': row['mime'], 'saved': a.out, 'bytes': len(data)}, indent=1))


def download(url):
    if not url.startswith('https://'):
        sys.exit(f'Only https links can be saved: {url[:80]}')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'athena-media'}), timeout=120) as r:
            data = r.read(MAX_FILE + 1)
            mime = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
    except urllib.error.URLError as e:
        sys.exit(f'Could not download {url[:80]}: {e}')
    if len(data) > MAX_FILE:
        sys.exit('That file is over 50 MB, more than the free plan takes for one file.')
    if mime not in EXT:
        mime = mimetypes.guess_type(urllib.parse.urlparse(url).path)[0] or mime
    if mime not in EXT:
        sys.exit(f'Not a picture or video type the library takes ({mime or "unknown"}).')
    return data, mime


def preview(data):
    """(thumbnail JPEG bytes, width, height) for a picture. Videos get no preview."""
    from PIL import Image
    with Image.open(io.BytesIO(data)) as im:
        width, height = im.size
        im.seek(0)
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, (255, 255, 255))  # see-through parts would otherwise turn black
        flat.paste(im, mask=im.split()[-1])
        flat.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        out = io.BytesIO()
        flat.save(out, 'JPEG', quality=80)
        return out.getvalue(), width, height


def put(path, data, mime):
    send('POST', f'{base()}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}', data,
         {'Content-Type': mime, 'x-upsert': 'false', 'cache-control': '3600'})


def remove(paths):
    if paths:
        send('DELETE', f'{base()}/storage/v1/object/{BUCKET}', json.dumps({'prefixes': paths}).encode(),
             {'Content-Type': 'application/json'})


def add(a):
    piece = content_row(a.content)
    tags = [t.strip() for t in (a.tags or '').split('|') if t.strip()]
    if a.seed is not None:
        tags.append(f'seed {a.seed}')
    tags = list(dict.fromkeys(tags))
    saved = []
    for n, url in enumerate(a.url, 1):
        data, mime = download(url)
        id_ = str(uuid.uuid4())
        path = f'finished/{id_}.{EXT[mime]}'
        thumb, width, height = (None, None, None)
        if mime.startswith('image/'):
            thumb, width, height = preview(data)
        thumb_path = f'thumbs/{id_}.jpg' if thumb else None
        done = []
        try:
            if thumb:
                put(thumb_path, thumb, 'image/jpeg'); done.append(thumb_path)
            put(path, data, mime); done.append(path)
            title = a.title if len(a.url) == 1 else f'{a.title} ({n} of {len(a.url)})'
            row = rest('POST', 'media', {
                'shelf': 'finished', 'title': title, 'tags': tags, 'seed': a.seed, 'path': path,
                'thumb_path': thumb_path, 'mime': mime, 'bytes': len(data) + len(thumb or b''),
                'width': width, 'height': height, 'content_id': piece['id'], 'source_url': a.source,
            })[0]
        except SystemExit:
            remove(done)  # leave nothing behind that the library cannot show
            raise
        saved.append({'id': row['id'], 'title': title})
    print(json.dumps({'content': piece['title'], 'saved': saved}, indent=1))


def attach(a):
    row = media_row(a.id)
    piece = content_row(a.content)
    rest('PATCH', f'media?id=eq.{row["id"]}', {'content_id': piece['id']})
    print(json.dumps({'media': row['title'], 'now_with': piece['title']}, indent=1))


def main():
    p = argparse.ArgumentParser(description='Read and add to her Media library. Never deletes.')
    sub = p.add_subparsers(dest='cmd', required=True)
    l = sub.add_parser('link'); l.add_argument('id')
    f = sub.add_parser('fetch'); f.add_argument('id'); f.add_argument('--out', required=True)
    d = sub.add_parser('add')
    d.add_argument('--url', action='append', required=True)
    d.add_argument('--title', required=True)
    d.add_argument('--content', required=True)
    d.add_argument('--seed', type=int)
    d.add_argument('--source')
    d.add_argument('--tags')
    t = sub.add_parser('attach'); t.add_argument('id'); t.add_argument('--content', required=True)
    a = p.parse_args()
    {'link': link, 'fetch': fetch, 'add': add, 'attach': attach}[a.cmd](a)


if __name__ == '__main__':
    main()
