#!/usr/bin/env python3
"""Unit tests for athena/stats.py: the pure parts, with payload shapes seen in Blotato on 2026-10-21.
Run: python3 athena/test_stats.py"""
import datetime, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stats  # noqa: E402

IG_METRICS = {"commentsCount": "0", "followsCount": "0", "interactionsSum": "0", "likesCount": "0", "profileActivityCount": "0",
              "profileVisitsCount": "0", "reachCount": "28", "savesCount": "0", "sharesCount": "0", "viewsCount": "44"}
FB_METRICS = {"commentsCount": "0", "likesCount": "0", "viewsCount": "2"}


class Snapshots(unittest.TestCase):
    def test_instagram_maps_every_column(self):
        s = stats.snapshot(IG_METRICS)
        self.assertEqual(s, {'views': 44, 'reach': 28, 'likes': 0, 'comments': 0, 'saves': 0, 'shares': 0, 'follows': 0, 'clicks': None})

    def test_facebook_leaves_uncollected_blank(self):
        s = stats.snapshot(FB_METRICS)
        self.assertEqual(s['views'], 2)
        self.assertIsNone(s['reach'])
        self.assertIsNone(s['saves'])

    def test_empty_snapshot_is_skipped(self):
        self.assertIsNone(stats.snapshot({}))
        self.assertIsNone(stats.snapshot(None))
        self.assertIsNone(stats.snapshot({'viewsCount': ''}))

    def test_impressions_count_as_views(self):
        self.assertEqual(stats.snapshot({'impressionsCount': '120'})['views'], 120)

    def test_iso_normalizes_spellings(self):
        self.assertEqual(stats.iso('2026-10-09T20:17:09.962Z'), stats.iso('2026-10-09T20:17:09+00:00'))
        self.assertEqual(stats.iso('2026-10-09T14:17:09-06:00'), '2026-10-09T20:17:09+00:00')
        self.assertIsNone(stats.iso('soon'))


class Matching(unittest.TestCase):
    pieces = [
        {'id': 'p1', 'title': 'Webinar day 8', 'body': '8 days until the ColibriOS Beta Tester Webinar.\n\nBring one real thing', 'target_date': '2026-09-25', 'posted_at': None, 'post_url': None},
        {'id': 'p2', 'title': 'Linked by hand', 'body': 'Something else entirely', 'target_date': None, 'posted_at': '2026-10-01T15:00:00+00:00',
         'post_url': 'https://www.instagram.com/p/Dd6mytvFH-b/?igsh=abc'},
        {'id': 'p3', 'title': 'Old twin', 'body': '8 days until the ColibriOS Beta Tester Webinar.  Bring one real thing', 'target_date': '2026-08-01', 'posted_at': None, 'post_url': None},
    ]

    def test_link_wins(self):
        post = {'post_url': 'https://instagram.com/p/Dd6mytvFH-b', 'caption': 'whatever', 'posted_at': '2026-09-30T15:00:29Z'}
        self.assertEqual(stats.match_content(post, self.pieces), 'p2')

    def test_caption_within_three_days(self):
        post = {'post_url': 'https://www.instagram.com/p/Ddtu1HLlNhm/', 'posted_at': '2026-09-25T15:00:36Z',
                'caption': '8 days until the ColibriOS Beta Tester Webinar. Bring one real thing you want to move into ColibriOS'}
        self.assertEqual(stats.match_content(post, self.pieces), 'p1')

    def test_caption_too_far_in_time(self):
        post = {'post_url': None, 'posted_at': '2026-09-25T15:00:36Z', 'caption': 'Something else entirely'}
        self.assertIsNone(stats.match_content(post, self.pieces))  # p2's date is 6 days off and the caption is short anyway

    def test_short_caption_never_matches(self):
        post = {'post_url': None, 'posted_at': '2026-09-25T15:00:36Z', 'caption': 'Hi'}
        self.assertIsNone(stats.match_content(post, self.pieces))

    def test_norm_url(self):
        self.assertEqual(stats.norm_url('https://WWW.linkedin.com/feed/update/urn:li:share:75/?x=1#y'), 'linkedin.com/feed/update/urn:li:share:75')
        self.assertEqual(stats.norm_url(None), '')

    def test_post_key(self):
        self.assertEqual(stats.post_key('https://www.linkedin.com/posts/stephanie_x-activity-7509030561882148865-abcd'), 'a7509030561882148865')
        self.assertIsNone(stats.post_key('https://www.linkedin.com/in/someone/'))


class LinkedIn(unittest.TestCase):
    me = 'https://www.linkedin.com/in/stephanie-holbrook/'

    def item(self, **over):
        base = {'type': 'post', 'linkedinUrl': 'https://www.linkedin.com/posts/stephanie-holbrook_x-activity-7509030561882148865-abcd?utm=1',
                'content': 'You are invited to the ColibriOS Beta Tester Webinar', 'postedAt': {'date': '2026-09-24T23:26:37.658Z'},
                'author': {'linkedinUrl': 'https://www.linkedin.com/in/stephanie-holbrook/', 'name': 'Stephanie Holbrook'},
                'engagement': {'likes': 4, 'comments': 1, 'shares': 0}}
        base.update(over)
        return base

    def test_own_post_becomes_row_and_snapshot(self):
        [(row, s)] = stats.linkedin_posts([self.item()], self.me)
        self.assertEqual(row['external_id'], 'a7509030561882148865')
        self.assertEqual(row['post_url'], 'https://www.linkedin.com/posts/stephanie-holbrook_x-activity-7509030561882148865-abcd')
        self.assertEqual(row['platform'], 'linkedin')
        self.assertEqual(s['likes'], 4); self.assertEqual(s['comments'], 1); self.assertEqual(s['shares'], 0)
        self.assertIsNone(s['reach'])

    def test_reposts_and_other_authors_are_left_out(self):
        items = [self.item(repost=True), self.item(author={'linkedinUrl': 'https://www.linkedin.com/in/someone-else/'}),
                 self.item(type='comment')]
        self.assertEqual(stats.linkedin_posts(items, self.me), [])

    def test_no_engagement_means_no_snapshot(self):
        [(row, s)] = stats.linkedin_posts([self.item(engagement={})], self.me)
        self.assertIsNone(s)


class Summary(unittest.TestCase):
    def test_weeks_and_best(self):
        posts = [
            {'id': 'a', 'platform': 'instagram', 'posted_at': '2026-09-25T15:00:36+00:00', 'caption': '8 days until', 'post_url': 'u1'},
            {'id': 'b', 'platform': 'instagram', 'posted_at': '2026-09-24T23:03:35+00:00', 'caption': 'Invited', 'post_url': 'u2'},
            {'id': 'c', 'platform': 'linkedin', 'posted_at': '2026-09-24T23:26:37+00:00', 'caption': 'Invited LI', 'post_url': 'u3'},
            {'id': 'd', 'platform': 'facebook', 'posted_at': '2026-09-30T15:00:07+00:00', 'caption': '3 days', 'post_url': 'u4'},
        ]
        latest = {'a': stats.snapshot(IG_METRICS), 'b': stats.snapshot({'reachCount': '28', 'viewsCount': '40', 'likesCount': '1'}),
                  'c': {'likes': 4, 'comments': 1, 'shares': 0, 'views': None, 'reach': None, 'saves': None, 'follows': None, 'clicks': None}}
        out = stats.summarize(posts, latest, 4, today_=datetime.date(2026, 10, 1))
        self.assertEqual(list(out), ['2026-09-28', '2026-09-21'])
        wk = out['2026-09-21']
        self.assertEqual(wk['platforms']['instagram'], {'posts': 2, 'with_numbers': 2, 'reach': 56, 'views': 84, 'engagement': 1})
        self.assertEqual(wk['best']['instagram']['posted_on'], '2026-09-25')  # reach ties at 28, then views 44 beats 40
        self.assertEqual(wk['best']['linkedin']['likes'], 4)
        self.assertEqual(out['2026-09-28']['platforms']['facebook'], {'posts': 1, 'with_numbers': 0, 'reach': 0, 'views': 0, 'engagement': 0})
        self.assertNotIn('_score', wk['best']['instagram'])

    def test_old_weeks_drop_off(self):
        posts = [{'id': 'a', 'platform': 'instagram', 'posted_at': '2026-07-01T15:00:36+00:00', 'caption': 'old', 'post_url': None}]
        self.assertEqual(stats.summarize(posts, {}, 4, today_=datetime.date(2026, 10, 1)), {})


if __name__ == '__main__':
    unittest.main(verbosity=1)
