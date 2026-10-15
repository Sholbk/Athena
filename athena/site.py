#!/usr/bin/env python3
"""Athena's eyes on colibrios.com, Stephanie's public ColibriOS site.

  python3 athena/site.py pages
  python3 athena/site.py read PATH --out FILE

pages lists every page in the site's sitemap. read saves one page as plain text, with the menus
and footer left out, so it can be read with Read or searched with Grep. Only colibrios.com.
Standard library only.
"""
import argparse, html.parser, json, re, sys, urllib.error, urllib.parse, urllib.request

SITE = 'https://colibrios.com'
SKIP = {'script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'form', 'button'}
BLOCK = {'p', 'div', 'section', 'article', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'dt', 'dd', 'summary'}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'athena-site-reader'}), timeout=30) as r:
            return r.read(5 * 1024 ** 2).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        sys.exit(f'colibrios.com said {e.code} for {url}')
    except urllib.error.URLError as e:
        sys.exit(f'Could not reach colibrios.com: {e.reason}')


class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.title, self.in_title = [], 0, '', False

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        elif tag == 'title':
            self.in_title = True
        elif not self.skip and tag in ('td', 'th'):
            self.out.append(' | ')
        elif not self.skip and tag in BLOCK:
            self.out.append('\n' + ('#' * int(tag[1]) + ' ' if re.fullmatch(r'h[1-6]', tag) else '- ' if tag == 'li' else ''))

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.out.append(data)

    def text(self):
        lines = [re.sub(r'[ \t\r\f\v]+', ' ', ln).strip() for ln in ''.join(self.out).split('\n')]
        lines = [ln for ln in lines if ln not in ('', '-', '#', '##', '###')]
        return '\n'.join(lines)


def pages(_a):
    xml = get(f'{SITE}/sitemap.xml')
    paths = [urllib.parse.urlparse(u).path or '/' for u in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml)]
    print(json.dumps(paths, indent=1))


def read(a):
    path = a.path.strip()
    if path.startswith(('http://', 'https://')):
        u = urllib.parse.urlparse(path)
        if u.netloc not in ('colibrios.com', 'www.colibrios.com'):
            sys.exit('Only colibrios.com pages can be read.')
        path = u.path or '/'
    if not re.fullmatch(r'/[A-Za-z0-9/_-]*', path) or '..' in path:
        sys.exit('Give a path from site.py pages, such as /pricing.')
    t = Text()
    t.feed(get(SITE + path))
    body = t.text()
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(f'Page: colibrios.com{path}\nTitle: {t.title.strip()}\n\n{body}\n')
    print(json.dumps({'page': path, 'title': t.title.strip(), 'saved': a.out, 'characters': len(body)}))


def main():
    p = argparse.ArgumentParser(description='Read pages of colibrios.com.')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('pages')
    r = sub.add_parser('read'); r.add_argument('path'); r.add_argument('--out', required=True)
    a = p.parse_args()
    {'pages': pages, 'read': read}[a.cmd](a)


if __name__ == '__main__':
    main()
