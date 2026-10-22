// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { audience, median, mergeLatest, nextWeekTip, pct, scorecard, shortNum, strongestLine, times } from '../src/lib/social.js';

const NOW = new Date('2026-10-22T18:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const post = (id, platform, d, format = 'video') => ({ id, platform, format, posted_at: daysAgo(d), caption: id });
const met = (post_id, views, likes = 1, comments = 0, shares = null) => ({ post_id, fetched_at: NOW.toISOString(), views, likes, comments, shares, saves: null });

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null]), null);
});

test('verdicts against her usual for the platform and format', () => {
  const posts = [post('a', 'instagram', 3), post('b', 'instagram', 4), post('c', 'instagram', 5), post('d', 'instagram', 6), post('e', 'instagram', 1)];
  const metrics = [met('a', 1000), met('b', 100), met('c', 100), met('d', 40), met('e', 5000)];
  const s = scorecard(posts, metrics, NOW);
  const by = Object.fromEntries(s.rows.map((r) => [r.id, r]));
  assert.equal(by.a.usual, 100);                 // median of a, b, c, d (e is under 48 hours)
  assert.equal(by.a.verdict, 'worked');
  assert.equal(by.b.verdict, 'normal');
  assert.equal(by.d.verdict, 'missed');
  assert.equal(by.e.verdict, 'new');
  assert.equal(s.strongest.id, 'a');
  assert.deepEqual(s.worked.map((r) => r.id), ['a']);
  assert.deepEqual(s.missed.map((r) => r.id), ['d']);
});

test('LinkedIn is scored on engagement because it shows no views', () => {
  const posts = [post('l1', 'linkedin', 3, 'text'), post('l2', 'linkedin', 4, 'text'), post('l3', 'linkedin', 5, 'text')];
  const metrics = [met('l1', null, 9, 3, 0), met('l2', null, 2, 0, 0), met('l3', null, 3, 1, 0)];
  const s = scorecard(posts, metrics, NOW);
  const l1 = s.rows.find((r) => r.id === 'l1');
  assert.equal(l1.usual, 4);
  assert.equal(l1.ratio, 3);
});

test('a format with fewer than 3 posts falls back to the whole platform', () => {
  const posts = [post('v1', 'instagram', 3), post('v2', 'instagram', 4), post('i1', 'instagram', 5, 'image')];
  const s = scorecard(posts, [met('v1', 100), met('v2', 300), met('i1', 200)], NOW);
  assert.equal(s.rows.find((r) => r.id === 'i1').usual, 200);
});

test('this week vs last week by platform', () => {
  const posts = [post('a', 'youtube', 2), post('b', 'youtube', 3), post('c', 'youtube', 9)];
  const s = scorecard(posts, [met('a', 10), met('b', 30), met('c', 20)], NOW);
  assert.deepEqual(s.compare, [{ platform: 'youtube', posts: 2, postsBefore: 1, views: 40, viewsBefore: 20, eng: 2, engBefore: 1 }]);
  assert.equal(pct(40, 20), 100);
  assert.equal(pct(5, 0), null);
});

test('posts with no numbers are not graded and never count as zero', () => {
  const s = scorecard([post('a', 'facebook', 3)], [], NOW);
  assert.equal(s.rows[0].verdict, 'unknown');
  assert.equal(s.compare[0].views, null);
});

test('audience: newest count, change since the one before, total', () => {
  const accounts = [{ id: 'ig', platform: 'instagram', label: 'Instagram' }, { id: 'yt', platform: 'youtube', label: 'YouTube' }];
  const snaps = [
    { account_id: 'ig', taken_on: '2026-10-15', followers: 1800 }, { account_id: 'ig', taken_on: '2026-10-22', followers: 1838 },
    { account_id: 'yt', taken_on: '2026-10-22', followers: 22 },
  ];
  const a = audience(accounts, snaps);
  assert.equal(a.total, 1860);
  assert.equal(a.totalDelta, 38);
  assert.equal(a.cards[0].delta, 38);
  assert.equal(a.cards[0].deltaPct, 2.1);
  assert.equal(a.cards[1].delta, null);
});

test('words', () => {
  assert.equal(shortNum(241000), '241K');
  assert.equal(shortNum(4100), '4.1K');
  assert.equal(shortNum(null), '–');
  assert.equal(times(375.4), '375.4×');
  assert.match(strongestLine({ platform: 'instagram', format: 'video', ratio: 5.9 }), /was an Instagram reel at 5\.9× your usual/);
  assert.match(strongestLine({ platform: 'youtube', format: 'video', ratio: 2 }), /was a YouTube video/);
  assert.equal(nextWeekTip({ worked: [], week: [] }).title, 'Post something this week.');
});

test('numbers merge: newest value of each number, from whichever snapshot has it', () => {
  const m = mergeLatest([
    { post_id: 'a', fetched_at: '2026-10-15T00:00:00Z', views: 37, reach: 23, likes: 0, comments: 0 },
    { post_id: 'a', fetched_at: '2026-10-22T00:00:00Z', views: null, likes: 4, comments: 1 },
  ]);
  assert.deepEqual([m.a.views, m.a.reach, m.a.likes, m.a.comments, m.a.fetched_at], [37, 23, 4, 1, '2026-10-22T00:00:00Z']);
});
