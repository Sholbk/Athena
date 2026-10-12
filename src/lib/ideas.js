// The idea bank lives in the "## Idea bank" section of the ColibriOS Brand Files page,
// as numbered seeds under "### Pillar ..." headings, with a "### Used" list at the end.
// Reading and editing it here keeps that page the one source of truth.

const SECTION = /^## Idea bank\s*$/m;

function bounds(body) {
  const m = SECTION.exec(body);
  if (!m) return null;
  const start = m.index;
  const rest = body.slice(start + m[0].length);
  const next = rest.search(/^## (?!#)/m);
  const end = next === -1 ? body.length : start + m[0].length + next;
  return { start, end };
}

export function parseIdeas(body) {
  const b = bounds(body || '');
  if (!b) return null;
  const lines = body.slice(b.start, b.end).split('\n');
  const groups = [];
  const used = [];
  let cur = null, inUsed = false;
  for (const ln of lines) {
    const h = ln.match(/^###\s+(.*)$/);
    if (h) {
      inUsed = /^used\b/i.test(h[1].trim());
      cur = inUsed ? null : { title: h[1].trim(), ideas: [] };
      if (cur) groups.push(cur);
      continue;
    }
    const n = ln.match(/^(\d+)\.\s+(.*)$/);
    if (inUsed) {
      const u = ln.match(/^\s*(?:[-*]\s+)?(?:(\d+)\.\s+)?(.*)$/);
      if (u && (n || /^\s*[-*]\s+/.test(ln))) used.push({ num: u[1] ? Number(u[1]) : null, text: u[2].trim(), line: ln });
    } else if (cur && n) cur.ideas.push({ num: Number(n[1]), text: n[2].trim(), line: ln });
  }
  const all = groups.flatMap((g) => g.ideas);
  const nextNum = Math.max(0, ...all.map((x) => x.num), ...used.map((x) => x.num || 0)) + 1;
  return { groups, used, nextNum };
}

// Moves one seed to the Used list with a date and a note.
export function markUsed(body, idea, note) {
  const b = bounds(body);
  if (!b) return body;
  let section = body.slice(b.start, b.end);
  section = section.replace(idea.line + '\n', '').replace(idea.line, '');
  const entry = `- ${idea.num}. ${idea.text} Used ${note}.`;
  const usedHead = section.match(/^### Used\s*$/m);
  if (usedHead) {
    const after = section.slice(usedHead.index + usedHead[0].length);
    const nextHead = after.search(/^(###|---)/m);
    const insertAt = usedHead.index + usedHead[0].length + (nextHead === -1 ? after.length : nextHead);
    const before = section.slice(0, insertAt).replace(/\s*$/, '');
    const lastLine = before.split('\n').pop();
    const gap = /^\s*[-*]\s/.test(lastLine) ? '\n' : '\n\n';
    section = `${before}${gap}${entry}\n\n${section.slice(insertAt).replace(/^\s*/, '')}`;
  } else {
    section = section.replace(/\s*$/, '') + `\n\n### Used\n\n${entry}\n\n`;
  }
  return body.slice(0, b.start) + section + body.slice(b.end);
}

// Adds a new seed at the end of one pillar's list.
export function addIdea(body, groupTitle, num, text) {
  const b = bounds(body);
  if (!b) return body;
  const section = body.slice(b.start, b.end);
  const lines = section.split('\n');
  let inGroup = false, lastIdx = -1, headIdx = -1;
  lines.forEach((ln, idx) => {
    const h = ln.match(/^###\s+(.*)$/);
    if (h) { inGroup = h[1].trim() === groupTitle; if (inGroup) headIdx = idx; return; }
    if (inGroup && /^\d+\.\s/.test(ln)) lastIdx = idx;
  });
  const at = lastIdx >= 0 ? lastIdx + 1 : headIdx + 2;
  if (headIdx < 0) return body;
  lines.splice(at, 0, `${num}. ${text.trim()}`);
  return body.slice(0, b.start) + lines.join('\n') + body.slice(b.end);
}
