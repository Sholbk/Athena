// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { checks, choices, defaultWhen, mountainToUtc, payload } from '../src/lib/blotatoPost.js';

const accounts = [
  { id: '19360', platform: 'facebook', fullname: 'Stephanie Blair Holbrook', username: '', subaccounts: [] },
  { id: '42881', platform: 'youtube', fullname: 'Stephanie Holbrook', username: '', subaccounts: [{ id: 'PL1', name: 'Marketing' }] },
  { id: '78454', platform: 'instagram', fullname: '', username: 'colibrios.app', subaccounts: [] },
  { id: '12675', platform: 'linkedin', fullname: 'Stephanie Holbrook', username: '', subaccounts: [{ accountId: '12675', id: '105672948', name: 'Dragonfly Web Designs LLC' }] },
  { id: '21787', platform: 'twitter', fullname: '', username: 'sholbk', subaccounts: [] },
];

test('choices: Instagram, LinkedIn, the LinkedIn page and X; never Facebook or YouTube', () => {
  const c = choices(accounts);
  assert.deepEqual(c.map((x) => x.label), ['Instagram @colibrios.app', 'LinkedIn Stephanie Holbrook', 'LinkedIn page Dragonfly Web Designs LLC', 'X @sholbk']);
  assert.deepEqual(c.map((x) => x.on), [true, true, false, false]);
  assert.equal(c[2].pageId, '105672948');
});

test('checks: Instagram needs media, X has a limit, dashes stop it', () => {
  const picked = choices(accounts);
  assert.deepEqual(checks({ text: 'Hello', media: [], picked: [picked[0]] }), ['Instagram needs at least one image or video.']);
  assert.deepEqual(checks({ text: 'x'.repeat(281), media: [], picked: [picked[3]] }), ['X allows 280 characters and this caption has 281.']);
  assert.deepEqual(checks({ text: 'Fine — not', media: [{ mime: 'image/png' }], picked: [picked[1]] }), ['The caption has a dash (— or –). Swap it for a comma, period or parentheses first.']);
  assert.deepEqual(checks({ text: '', media: [], picked: [] }), ['The post has no caption yet.', 'Pick at least one account.']);
  assert.deepEqual(checks({ text: 'Fine', media: [{ mime: 'image/png' }], picked: [picked[0], picked[1]] }), []);
});

test('payload: targets per platform, reel for a lone Instagram video, scheduledTime only when set', () => {
  const [ig, li, page, x] = choices(accounts);
  const urls = ['https://database.blotato.io/a.jpg'];
  assert.deepEqual(payload(ig, { text: ' Hi ', mediaUrls: urls }), { post: { accountId: '78454', content: { text: 'Hi', mediaUrls: urls, platform: 'instagram' }, target: { targetType: 'instagram' } } });
  assert.deepEqual(payload(page, { text: 'Hi', mediaUrls: [], scheduledTime: '2026-10-28T15:00:00.000Z' }).post.target, { targetType: 'linkedin', pageId: '105672948' });
  assert.equal(payload(page, { text: 'Hi', mediaUrls: [], scheduledTime: '2026-10-28T15:00:00.000Z' }).scheduledTime, '2026-10-28T15:00:00.000Z');
  assert.deepEqual(payload(li, { text: 'Hi', mediaUrls: [] }).post.target, { targetType: 'linkedin' });
  assert.deepEqual(payload(x, { text: 'Hi', mediaUrls: [] }).post.target, { targetType: 'twitter' });
  assert.deepEqual(payload(ig, { text: 'Hi', mediaUrls: ['https://database.blotato.io/v.mp4'] }).post.target, { targetType: 'instagram', mediaType: 'reel' });
  assert.equal('scheduledTime' in payload(x, { text: 'Hi', mediaUrls: [] }), false);
});

test('mountainToUtc: MDT in October, MST in December, null when empty', () => {
  assert.equal(mountainToUtc('2026-10-28T09:00'), '2026-10-28T15:00:00.000Z');
  assert.equal(mountainToUtc('2026-12-01T09:00'), '2026-12-01T16:00:00.000Z');
  assert.equal(mountainToUtc(''), null);
});

test('defaultWhen: the target date at 9 AM when ahead, else tomorrow 9 AM', () => {
  const now = new Date('2026-10-21T20:00:00Z');  // Oct 21, 2 PM Mountain
  assert.equal(defaultWhen('2026-10-28', now), '2026-10-28T09:00');
  assert.equal(defaultWhen('2026-10-21', now), '2026-10-22T09:00');
  assert.equal(defaultWhen(null, now), '2026-10-22T09:00');
});
