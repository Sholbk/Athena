// node --test tests/social.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { audience, median, mergeLatest, nextWeekTip, pct, scorecard, shortNum, strongestLine, times, weekOf } from '../src/lib/social.js';

const NOW = new Date('2026-10-23T14:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const post = (id, platform, d, format = 'video') => ({ id, platform, format, posted_at: daysAgo(d), caption: id });
const met = (post_id, views, likes = 1, comments = 0, shares = null) => ({ post_id, fetched_at: NOW.toISOString(), views, likes, comments, shares, saves: null });

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null]), null);
});

test('verdicts against her median for the platform', () => {
  const posts = [post('a', 'instagram', 3), post('b', 'instagram', 4), post('c', 'instagram', 5, 'image'), post('d', 'instagram', 6), post('e', 'instagram', 1)];
  const s = scorecard(posts, [met('a', 1000), met('b', 100), met('c', 100), met('d', 40), met('e', 5000)], NOW);
  const by = Object.fromEntries(s.rows.map((r) => [r.id, r]));
  assert.equal(by.a.usual, 100);   // one median for Instagram, whatever the format; e is under 48 hours
  assert.equal(by.a.verdict, 'worked');
  assert.equal(by.b.verdict, 'normal');
  assert.equal(by.d.verdict, 'missed');
  assert.equal(by.e.verdict, 'new');
});

test('a post with no views is compared on likes + comments + shares, against that median', () => {
  const posts = [post('v1', 'instagram', 3), post('v2', 'instagram', 4), post('p1', 'instagram', 5, 'image'), post('p2', 'instagram', 6, 'image'), post('p3', 'instagram', 8, 'image')];
  const metrics = [met('v1', 100), met('v2', 300), met('p1', null, 12, 3, 0), met('p2', null, 2, 1, 0), met('p3', null, 4, 0, 1)];
  const s = scorecard(posts, metrics, NOW);
  const p1 = s.rows.find((r) => r.id === 'p1');
  assert.equal(p1.metric, 'engagement');
  assert.equal(p1.usual, 5);         // median of 15, 3, 5
  assert.equal(p1.ratio, 3);
  assert.equal(s.rows.find((r) => r.id === 'v2').usual, 200);
});

test('LinkedIn and Facebook, which show no views, use likes + comments + shares', () => {
  const posts = [post('l1', 'linkedin', 3, 'text'), post('l2', 'linkedin', 4, 'text'), post('l3', 'linkedin', 5, 'text')];
  const s = scorecard(posts, [met('l1', null, 9, 3, 0), met('l2', null, 2, 0, 0), met('l3', null, 3, 1, 0)], NOW);
  assert.equal(s.rows.find((r) => r.id === 'l1').ratio, 3);
});

test('best 3 and worst 3 of the week never share a post, the rest follow', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const posts = ids.map((id, i) => post(id, 'youtube', 2 + i * 0.5));
  const s = scorecard(posts, ids.map((id, i) => met(id, [500, 100, 50, 400, 10][i])), NOW);
  assert.deepEqual(s.best.map((r) => r.id), ['a', 'd', 'b']);
  assert.deepEqual(s.worst.map((r) => r.id), ['e', 'c']);
  assert.equal(s.restOfWeek.length, 0);
});

test('only the last 30 days count', () => {
  const s = scorecard([post('old', 'youtube', 40), post('new', 'youtube', 10)], [met('old', 1), met('new', 1)], NOW);
  assert.deepEqual(s.rows.map((r) => r.id), ['new']);
  assert.deepEqual(s.earlier.map((r) => r.id), ['new']);
});

test('numbers merge: newest value of each number, from whichever snapshot has it', () => {
  const m = mergeLatest([
    { post_id: 'a', fetched_at: '2026-10-15T00:00:00Z', views: 37, reach: 23, likes: 0, comments: 0 },
    { post_id: 'a', fetched_at: '2026-10-22T00:00:00Z', views: null, likes: 4, comments: 1 },
  ]);
  assert.deepEqual([m.a.views, m.a.reach, m.a.likes, m.a.comments], [37, 23, 4, 1]);
});

test('posts with no numbers are not graded and never count as zero', () => {
  const s = scorecard([post('a', 'facebook', 3)], [], NOW);
  assert.equal(s.rows[0].verdict, 'unknown');
  assert.equal(s.compare[0].views, null);
});

test('followers: one count per week, change since the week before', () => {
  assert.equal(weekOf('2026-10-23'), '2026-10-19');
  const accounts = [{ id: 'ig', platform: 'instagram', label: 'Instagram' }, { id: 'fb', platform: 'facebook', label: 'Facebook' }];
  const snaps = [
    { account_id: 'ig', taken_on: '2026-10-16', followers: 1800 }, { account_id: 'ig', taken_on: '2026-10-22', followers: 1830 },
    { account_id: 'ig', taken_on: '2026-10-23', followers: 1838 }, { account_id: 'fb', taken_on: '2026-10-23', followers: 24 },
  ];
  const a = audience(accounts, snaps);
  assert.deepEqual(a.cards[0].series, [1800, 1838]);
  assert.equal(a.cards[0].delta, 38);
  assert.equal(a.total, 1862);
  assert.equal(a.cards[1].delta, null);
});

test('words', () => {
  assert.equal(shortNum(241000), '241K');
  assert.equal(shortNum(null), '–');
  assert.equal(times(375.4), '375.4×');
  assert.equal(pct(40, 20), 100);
  assert.match(strongestLine({ platform: 'instagram', format: 'video', ratio: 5.9 }), /was an Instagram reel at 5\.9× your median/);
  assert.equal(nextWeekTip({ best: [], week: [] }).title, 'Post something this week.');
});
