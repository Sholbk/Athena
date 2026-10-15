import { useCallback, useEffect, useState } from 'react';
import { askAthena } from './athena.js';

// Image prompts for the idea bank live on the page "Image prompts", which Athena writes
// (rules in athena/IMAGES.md): a "## Seed N" section per seed, with a ChatGPT prompt and a
// Claude prompt, each in a fenced code block under a **ChatGPT** or **Claude** line.

export const PROMPTS_PAGE = 'Image prompts';
const KEY = 'athena:prompt-asks';
const PATIENCE = 20 * 60 * 1000;  // stop showing "writing" if nothing came back in 20 minutes

function block(section, label) {
  const m = section.match(new RegExp(`\\*\\*${label}\\*\\*\\s*\\n+(\`{3,})[^\\n]*\\n([\\s\\S]*?)\\n\\1`));
  return m ? m[2].trim() : '';
}

// { 4: { chatgpt, claude }, ... }
export function parsePrompts(body) {
  const out = {};
  const parts = String(body || '').split(/^## Seed (\d+)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const chatgpt = block(parts[i + 1], 'ChatGPT');
    const claude = block(parts[i + 1], 'Claude');
    if (chatgpt || claude) out[Number(parts[i])] = { chatgpt, claude };
  }
  return out;
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function keep(asks) {
  try { localStorage.setItem(KEY, JSON.stringify(asks)); } catch {}
}

// Which seeds Athena is writing prompts for. Kept in the browser so it survives switching
// tabs. A seed stops showing as "writing" when its prompts arrive (or change, for a redo),
// or after 20 minutes.
export function usePromptAsks(prompts, reload) {
  const [asks, setAsks] = useState(load);
  const isWriting = (n) => {
    const a = asks[n];
    if (!a || Date.now() - a.at > PATIENCE) return false;
    return a.had == null ? !prompts[n] : (prompts[n]?.chatgpt || '') === a.had;
  };
  const writing = Object.keys(asks).filter(isWriting).map(Number);

  // Forget the ones that are done.
  useEffect(() => {
    const left = Object.fromEntries(Object.entries(asks).filter(([n]) => isWriting(n)));
    if (Object.keys(left).length !== Object.keys(asks).length) { setAsks(left); keep(left); }
  });

  useEffect(() => {
    if (!writing.length) return undefined;
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [writing.length, reload]);

  // nums: the seeds asked for. redo: true when replacing prompts that are already there.
  const ask = useCallback(async (nums, message, redo = false) => {
    const now = Date.now();
    const next = { ...load(), ...Object.fromEntries(nums.map((n) => [n, { at: now, had: redo ? (prompts[n]?.chatgpt || '') : null }])) };
    setAsks(next); keep(next);
    // Its own conversation, so it does not land in the middle of her chat with Athena.
    const { startError } = await askAthena(message, crypto.randomUUID());
    return startError;
  }, [prompts]);

  return { writing: new Set(writing), ask };
}
