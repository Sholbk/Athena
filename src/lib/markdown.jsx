// A small Markdown renderer for vault pages. Builds React elements, never raw HTML.
// Covers what the vault uses: headings, paragraphs, bullet and numbered lists, quotes,
// rules, bold, italics, code, links, bare URLs, [[wikilinks]] and ![[embeds]].
import { Fragment } from 'react';

const INLINE = /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()\]]+)/g;

export function inline(text, keyBase = 'i') {
  const out = [];
  let last = 0, m, k = 0;
  const s = String(text);
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<strong key={key}>{inline(m[1].slice(2, -2), key)}</strong>);
    else if (m[2]) out.push(<em key={key}>{inline(m[2].slice(1, -1), key)}</em>);
    else if (m[3]) out.push(<code key={key}>{m[3].slice(1, -1)}</code>);
    else if (m[4]) {
      const inner = m[4].replace(/^!?\[\[|\]\]$/g, '');
      const [target, alias] = inner.split('|');
      out.push(<span key={key} className="wikilink" title={`In Obsidian: ${target}`}>{alias || target}</span>);
    } else if (m[5]) {
      const label = m[5].slice(1, m[5].indexOf(']('));
      out.push(<a key={key} href={m[6]} target="_blank" rel="noopener noreferrer">{inline(label, key)}</a>);
    } else if (m[7]) {
      let url = m[7], trail = '';
      while (/[.,;:!?'"]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
      out.push(<a key={key} href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\/(www\.)?/, '')}</a>);
      if (trail) out.push(trail);
    }
    last = INLINE.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    const key = `b${k++}`;
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = `h${Math.min(h[1].length + 1, 5)}`;
      blocks.push(<Tag key={key}>{inline(h[2], key)}</Tag>);
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { blocks.push(<hr key={key} />); i++; continue; }
    if (/^\s*>/.test(ln)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(<blockquote key={key}>{q.filter((x) => x.trim()).map((x, j) => <p key={j}>{inline(x, `${key}-${j}`)}</p>)}</blockquote>);
      continue;
    }
    const isBullet = (s) => /^\s*[-*•]\s+/.test(s);
    const isNum = (s) => /^\s*\d+[.)]\s+/.test(s);
    if (isBullet(ln) || isNum(ln)) {
      const numbered = isNum(ln);
      const items = [];
      while (i < lines.length && (numbered ? isNum(lines[i]) : isBullet(lines[i]))) {
        const m = lines[i].match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
        items.push({ n: m[1], text: m[2] });
        i++;
      }
      const List = numbered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} start={numbered ? Number(items[0].n) : undefined}>
          {items.map((it, j) => <li key={j}>{inline(it.text, `${key}-${j}`)}</li>)}
        </List>
      );
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*[-*•]\s|\s*\d+[.)]\s|\s*-{3,}\s*$)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    if (!para.length) { para.push(ln); i++; }
    blocks.push(<p key={key}>{para.map((x, j) => <Fragment key={j}>{j > 0 && <br />}{inline(x, `${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
