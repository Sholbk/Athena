"""Tests for the pure helpers in outliers.py. Run: python3 -m unittest athena/test_outliers.py"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import outliers as o


def reel(code, creator, views, likes=10):
    return {'short_code': code, 'creator': creator, 'views': views, 'likes': likes, 'duration_s': 45}


class Helpers(unittest.TestCase):
    def test_median(self):
        self.assertEqual(o.median([3, 1, 2]), 2)
        self.assertEqual(o.median([4, 1, 3, 2]), 2.5)
        self.assertEqual(o.median([None, 5]), 5)
        self.assertIsNone(o.median([None]))

    def test_to_int_hidden_likes(self):
        self.assertIsNone(o.to_int(-1))
        self.assertEqual(o.to_int('12.0'), 12)
        self.assertIsNone(o.to_int(None))

    def test_handle_of(self):
        self.assertEqual(o.handle_of('https://www.instagram.com/ivorey.io/'), 'ivorey.io')
        self.assertEqual(o.handle_of('https://www.instagram.com/FunnelGorgeous'), 'funnelgorgeous')
        self.assertEqual(o.handle_of('@mindbody'), 'mindbody')

    def test_reel_link(self):
        self.assertEqual(o.reel_link('DeVQ2oxBWwq'), 'https://www.instagram.com/reel/DeVQ2oxBWwq/')

    def test_first_sentence(self):
        self.assertEqual(o.first_sentence('This is just for you. If not, scroll.'), 'This is just for you.')
        self.assertEqual(o.first_sentence('  no stop at all  '), 'no stop at all')
        self.assertEqual(o.first_sentence(''), '')
        self.assertTrue(o.first_sentence('word ' * 100).endswith('…'))

    def test_hook_falls_back_to_caption(self):
        self.assertEqual(o.hook_for('Said out loud. More.', 'Caption'), ('Said out loud.', 'transcript'))
        self.assertEqual(o.hook_for(None, '\nMeet The Romantic 🌷 She is soft.\nmore'), ('Meet The Romantic 🌷 She is soft.', 'caption'))
        self.assertEqual(o.hook_for('', ''), ('', None))


class Marking(unittest.TestCase):
    def test_real_week(self):
        # funnelgorgeous (cathyfunnels), Oct 8 to Oct 19: one reel far above the rest.
        views = [2578, 4388, 16996, 5690, 2872, 2631, 2016]
        rs = o.mark([reel(f'c{i}', 'cathyfunnels', v) for i, v in enumerate(views)])
        self.assertEqual(rs[0]['creator_median'], 2872)
        out = [r for r in rs if r['is_outlier']]
        self.assertEqual([r['short_code'] for r in out], ['c2'])
        self.assertEqual(out[0]['times_usual'], 5.92)
        self.assertEqual(out[0]['outlier_reason'], 'views')

    def test_likes_alone(self):
        # 3 times the creator's median likes counts, even with flat views.
        rs = o.mark([reel('a', 'x', 100, likes=300), reel('b', 'x', 100, likes=100), reel('c', 'x', 100, likes=100)])
        self.assertTrue(rs[0]['is_outlier'])
        self.assertEqual(rs[0]['outlier_reason'], 'likes')
        self.assertFalse(rs[1]['is_outlier'])

    def test_big_account_not_flagged_on_every_reel(self):
        # Modeled on a 500,000-follower account: every reel clears 10,000 likes (the old rule flagged
        # all six). Only the reel at 3 times its usual likes is an outlier now.
        likes = [14000, 15500, 16000, 17000, 18000, 60000]
        views = [210000, 230000, 240000, 250000, 260000, 380000]
        rs = o.mark([reel(f'b{i}', 'big', v, likes=l) for i, (v, l) in enumerate(zip(views, likes))])
        out = [r for r in rs if r['is_outlier']]
        self.assertEqual([r['short_code'] for r in out], ['b5'])
        self.assertEqual(out[0]['outlier_reason'], 'likes')
        self.assertTrue(all(r['likes'] >= 10000 for r in rs))

    def test_both_reasons(self):
        rs = o.mark([reel('a', 'x', 900, likes=90), reel('b', 'x', 100, likes=10), reel('c', 'x', 100, likes=10)])
        self.assertEqual(rs[0]['outlier_reason'], 'both')

    def test_hidden_or_zero_likes(self):
        rs = o.mark([reel('a', 'x', 100, likes=None), reel('b', 'x', 100, likes=None)])
        self.assertFalse(any(r['is_outlier'] for r in rs))
        rs = o.mark([reel('a', 'x', 100, likes=0), reel('b', 'x', 100, likes=0), reel('c', 'x', 100, likes=5)])
        self.assertFalse(any(r['is_outlier'] for r in rs))

    def test_exactly_three_times_counts(self):
        rs = o.mark([reel('a', 'x', 300), reel('b', 'x', 100), reel('c', 'x', 100)])
        self.assertTrue(rs[0]['is_outlier'])

    def test_medians_are_per_creator(self):
        rs = o.mark([reel('a', 'big', 90000), reel('b', 'big', 100000), reel('c', 'small', 200), reel('d', 'small', 900), reel('e', 'small', 250)])
        self.assertFalse(any(r['is_outlier'] for r in rs if r['creator'] == 'big'))
        self.assertTrue(next(r for r in rs if r['short_code'] == 'd')['is_outlier'])

    def test_no_views(self):
        rs = o.mark([reel('a', 'x', None), reel('b', 'x', None)])
        self.assertIsNone(rs[0]['times_usual'])
        self.assertFalse(rs[0]['is_outlier'])

    def test_rank_and_budget(self):
        rs = [dict(reel('a', 'x', 1), times_usual=4, duration_s=50), dict(reel('b', 'x', 1), times_usual=9, duration_s=50),
              dict(reel('c', 'x', 1), times_usual=6, duration_s=50)]
        self.assertEqual([r['short_code'] for r in sorted(rs, key=o.rank_key)], ['b', 'c', 'a'])
        picked, left = o.pick_for_transcripts(rs, 0.10)
        self.assertEqual([r['short_code'] for r in picked], ['b', 'c'])
        self.assertEqual([r['short_code'] for r in left], ['a'])


class Items(unittest.TestCase):
    item = {'shortCode': 'DeVQ2oxBWwq', 'ownerUsername': 'cathyfunnels', 'inputUrl': 'https://www.instagram.com/funnelgorgeous',
            'timestamp': '2026-10-10T23:28:48.000Z', 'videoPlayCount': 16996, 'videoViewCount': None, 'likesCount': 307,
            'commentsCount': 27, 'videoDuration': 47.088615, 'caption': 'Here is the plot twist'}

    def test_reel_row(self):
        r = o.reel_row(self.item, '2026-10-08T00:00:00Z')
        self.assertEqual(r['creator'], 'cathyfunnels')
        self.assertEqual(r['_input'], 'funnelgorgeous')
        self.assertEqual(r['views'], 16996)
        self.assertEqual(r['url'], 'https://www.instagram.com/reel/DeVQ2oxBWwq/')
        self.assertEqual(r['duration_s'], 47.1)

    def test_skips_old_and_error_items(self):
        self.assertIsNone(o.reel_row(self.item, '2026-10-11T00:00:00Z'))
        self.assertIsNone(o.reel_row({'url': 'https://www.instagram.com/mindbody', 'error': 'no_items'}, '2026-10-01T00:00:00Z'))

    def test_in_list_quotes(self):
        self.assertEqual(o.in_list(['a-b', 'c_d']), 'in.("a-b","c_d")')


if __name__ == '__main__':
    unittest.main()
